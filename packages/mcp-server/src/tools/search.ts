import { CollectorClient } from "@kryfto/sdk-ts";
import {
    buildDuckDuckGoSearchUrl,
    parseDuckDuckGoSearchResults,
    buildBingHtmlSearchUrl,
    parseBingHtmlSearchResults,
    buildYahooSearchUrl,
    parseYahooSearchResults,
    buildGoogleHtmlSearchUrl,
    parseGoogleHtmlSearchResults,
    buildBraveHtmlSearchUrl,
    parseBraveHtmlSearchResults,
    getRandomUA,
    getStealthHeaders,
    resolveEngineRedirect,
    engineDelay,
    getGoogleConsentCookieHeader,
} from "@kryfto/shared";
import type { Browser, BrowserContext, Page } from "playwright";
import { solveGoogleSorryPage } from "@kryfto/shared";
import type {
    SearchEngine,
    DirectSearchResult,
    EnrichedResult,
    ErrorCategory,
} from "../types.js";
import { FALLBACK_ENGINES } from "../types.js";
import {
    analyzeIntent,
    detectStrictProfile,
    rewriteQueryForIntent,
    buildSearchQuery,
    extractQueryTerms,
    getDomainWeight,
    canonicalDomainBonus,
    noisePenalty,
    snippetOverlapBonus,
    titleMatchBonus,
    authorityBonus,
    urlOfficialScore,
    diversityPenalty,
    isRecencyQuery,
    isOfficialSource,
    isStrictOfficialSource,
} from "../scoring.js";
import {
    extractDomain,
    normalizeUrl,
    isUrlAllowed,
    HARD_BLOCK_DOMAINS,
} from "../url-utils.js";
import {
    shouldSkipEngine,
    recordEngineSuccess,
    recordEngineFailure,
    getEngineHealth,
    resetAllCircuits,
} from "../circuit-breaker.js";
import {
    withRetry,
    classifyError,
    logEngineError,
    extractDateFromText,
} from "../helpers.js";
import { createTrace, startSpan, endSpan, finalizeTrace } from "../trace.js";
import { RERANKER_VERSION, TRUST_RULES_VERSION, SERVER_VERSION } from "../version.js";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:8080";
const API_TOKEN = process.env.API_TOKEN ?? process.env.KRYFTO_API_TOKEN;
const searchToken = process.env.KRYFTO_SEARCH_TOKEN;
/** Skip the API entirely and always use direct HTTP search. */
const SEARCH_MODE = process.env.KRYFTO_SEARCH_MODE ?? "auto"; // "auto" | "api" | "direct"

function getSearchClient(): CollectorClient {
    return new CollectorClient({
        baseUrl: API_BASE_URL,
        token: searchToken ?? API_TOKEN,
    });
}

// ── API availability tracking ───────────────────────────────────────
// Avoids wasting ~35s retrying all engines against a dead API server.
let _apiAvailable: boolean | null = null; // null = unknown
let _apiCheckedAt = 0;
const API_RECHECK_INTERVAL_MS = 60_000; // re-probe every 60s

function isApiConnectionError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(msg);
}

async function isApiAvailable(): Promise<boolean> {
    if (SEARCH_MODE === "direct") return false;
    if (SEARCH_MODE === "api") return true;
    // "auto" mode: probe and cache
    if (_apiAvailable !== null && Date.now() - _apiCheckedAt < API_RECHECK_INTERVAL_MS) {
        return _apiAvailable;
    }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${API_BASE_URL}/v1/healthz`, {
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        _apiAvailable = res.ok;
    } catch {
        _apiAvailable = false;
    }
    _apiCheckedAt = Date.now();
    return _apiAvailable;
}

function markApiDown(): void {
    _apiAvailable = false;
    _apiCheckedAt = Date.now();
}

const DOMAIN_BLOCKLIST = new Set(
    (process.env.KRYFTO_DOMAIN_BLOCKLIST ?? "")
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
);
const DOMAIN_ALLOWLIST = new Set(
    (process.env.KRYFTO_DOMAIN_ALLOWLIST ?? "")
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
);

// ── Browser-based Google Search ─────────────────────────────────────
// Google now requires JS execution. We use a lazy-loaded Playwright
// browser with stealth to render the page and extract results.

let _googleBrowser: Browser | null = null;
let _googleBrowserPromise: Promise<Browser> | null = null;

async function getGoogleBrowser(): Promise<Browser> {
    if (_googleBrowser?.isConnected()) return _googleBrowser;
    if (_googleBrowserPromise) return _googleBrowserPromise;
    _googleBrowserPromise = (async () => {
        try {
            const pw = await import("playwright");
            const browser = await pw.chromium.launch({
                headless: true,
                args: [
                    "--disable-blink-features=AutomationControlled",
                    "--disable-features=IsolateOrigins,site-per-process",
                    "--disable-dev-shm-usage",
                    "--no-first-run",
                    "--no-default-browser-check",
                ],
            });
            _googleBrowser = browser;
            return browser;
        } finally {
            _googleBrowserPromise = null;
        }
    })();
    return _googleBrowserPromise;
}

async function applyMinimalStealth(page: Page, ua: string): Promise<void> {
    const platform = ua.includes("Mac") ? "MacIntel" : ua.includes("Linux") ? "Linux x86_64" : "Win32";
    const audioNoise = (Math.random() * 0.00001) - 0.000005;

    // Use string-based init script to avoid DOM type issues in Node tsconfig
    await page.addInitScript(`(function() {
        var platform = ${JSON.stringify(platform)};
        var audioNoiseSeed = ${audioNoise * 100000};

        // 1. Core automation tells
        Object.defineProperty(navigator, 'webdriver', { get: function() { return false; }, configurable: true });
        try { delete Navigator.prototype.webdriver; } catch(e) {}
        Object.defineProperty(Navigator.prototype, 'webdriver', { get: function() { return false; }, configurable: true });
        Object.defineProperty(navigator, 'platform', { get: function() { return platform; } });
        Object.defineProperty(navigator, 'languages', { get: function() { return Object.freeze(['en-US', 'en']); } });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: function() { return 8; } });
        Object.defineProperty(navigator, 'deviceMemory', { get: function() { return 8; } });
        Object.defineProperty(navigator, 'maxTouchPoints', { get: function() { return 0; } });

        // 2. Chrome runtime (comprehensive)
        if (!window.chrome) {
            window.chrome = {
                app: { isInstalled: false, getDetails: function() { return null; }, getIsInstalled: function() { return false; },
                    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
                csi: function() { return {}; },
                loadTimes: function() { return {
                    commitLoadTime: performance.now()/1000, connectionInfo: 'h2',
                    finishDocumentLoadTime: performance.now()/1000, finishLoadTime: performance.now()/1000,
                    navigationType: 'Other', npnNegotiatedProtocol: 'h2',
                    requestTime: performance.now()/1000 - 0.5, startLoadTime: performance.now()/1000 - 0.3,
                    wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true, wasNpnNegotiated: true }; },
                runtime: { connect: function(){}, sendMessage: function(){}, id: undefined,
                    OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformOs: {} }
            };
        }

        // 3. Permissions API
        if (navigator.permissions && navigator.permissions.query) {
            var origQuery = navigator.permissions.query.bind(navigator.permissions);
            navigator.permissions.query = function(p) {
                if (p.name === 'notifications') return Promise.resolve({ state: 'prompt', onchange: null });
                return origQuery(p);
            };
        }

        // 4. Canvas fingerprint noise
        var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function() {
            var ctx = this.getContext('2d');
            if (ctx && this.width > 0 && this.height > 0 && this.width < 500) {
                var d = ctx.getImageData(0, 0, this.width, this.height);
                for (var i = 0; i < Math.min(d.data.length, 4000); i += 4) {
                    d.data[i] += ((audioNoiseSeed * (i+1) * 9301 + 49297) % 233280) / 233280 > 0.5 ? 1 : -1;
                }
                ctx.putImageData(d, 0, 0);
            }
            return origToDataURL.apply(this, arguments);
        };

        // 5. WebGL vendor/renderer
        function spoofGL(proto) {
            if (!proto) return;
            var orig = proto.getParameter;
            proto.getParameter = function(p) {
                if (p === 37445) return 'Google Inc. (Intel)';
                if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.1)';
                return orig.call(this, p);
            };
        }
        try { spoofGL(WebGLRenderingContext.prototype); } catch(e) {}
        try { if (typeof WebGL2RenderingContext !== 'undefined') spoofGL(WebGL2RenderingContext.prototype); } catch(e) {}

        // 6. WebRTC IP leak prevention
        if (window.RTCPeerConnection) {
            var origRTC = window.RTCPeerConnection;
            window.RTCPeerConnection = function(config) {
                return new origRTC(Object.assign({}, config, { iceServers: [], iceCandidatePoolSize: 0 }));
            };
            window.RTCPeerConnection.prototype = origRTC.prototype;
        }

        // 7. Performance timing noise
        var origNow = performance.now.bind(performance);
        performance.now = function() { return origNow() + (Math.random() * 0.1); };

        // 8. document.hasFocus
        document.hasFocus = function() { return true; };

        // 9. Headless Notification fix
        if (typeof Notification !== 'undefined') {
            Object.defineProperty(Notification, 'permission', { get: function() { return 'default'; } });
        }
    })();`);
}

async function browserSearchGoogle(
    query: string,
    limit: number,
    safeSearch: string,
    locale: string,
): Promise<DirectSearchResult[]> {
    const ss = (safeSearch || "moderate") as "strict" | "moderate" | "off";
    const loc = locale || "us-en";
    const searchUrl = buildGoogleHtmlSearchUrl({ query, safeSearch: ss, locale: loc });
    const ua = getRandomUA();

    const browser = await getGoogleBrowser();
    const context = await browser.newContext({
        userAgent: ua,
        viewport: { width: 1366, height: 768 },
        locale: "en-US",
        timezoneId: "America/New_York",
    });

    const page = await context.newPage();
    await applyMinimalStealth(page, ua);

    // Set Google consent cookie before navigating
    await context.addCookies([{
        name: "SOCS",
        value: "CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjUwMzA0LjA3X3AxGgJlbiACGgYIgJCptgY",
        domain: ".google.com",
        path: "/",
    }]);

    try {
        // Visit Google homepage first to establish session cookies (more natural)
        await page.goto("https://www.google.com", { waitUntil: "domcontentloaded", timeout: 10_000 });
        // Accept consent dialog if shown
        const consentBtn = await page.$('button[id="L2AGLb"], button:has-text("Accept all")');
        if (consentBtn) {
            await consentBtn.click().catch(() => {});
            await page.waitForTimeout(500);
        }

        // Type query in search box like a real user
        const searchBox = await page.$('textarea[name="q"], input[name="q"]');
        if (searchBox) {
            await searchBox.click();
            await page.waitForTimeout(200);
            await page.keyboard.type(query, { delay: 30 + Math.random() * 50 });
            await page.waitForTimeout(300);
            await page.keyboard.press("Enter");
        } else {
            // Fallback: navigate directly
            await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
        }

        // Handle Google /sorry CAPTCHA page (rate limit reCAPTCHA)
        await page.waitForTimeout(1500);
        if (page.url().includes("/sorry")) {
            console.error("[MCP] Google served /sorry CAPTCHA page, attempting to solve...");
            const solved = await solveGoogleSorryPage(page);
            if (!solved) throw new Error("CAPTCHA_UNSOLVED: Google /sorry page could not be bypassed");
        }

        // Wait for search results to render (h3 tags appear in result links)
        await page.waitForSelector("h3", { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(500);

        const html = await page.content();
        const results = parseGoogleHtmlSearchResults(html, limit);
        return results;
    } finally {
        await context.close();
    }
}

// solveGoogleSorryPage is imported from recaptcha-vision.ts
// It handles: checkbox click → audio challenge (Whisper) → image grid (CLIP vision)

/** Close the shared Google browser (call on shutdown). */
export async function closeGoogleBrowser(): Promise<void> {
    if (_googleBrowser) {
        await _googleBrowser.close().catch(() => {});
        _googleBrowser = null;
    }
}

export async function directSearchEngine(
    engine: string,
    query: string,
    limit: number,
    safeSearch: string,
    locale: string
): Promise<DirectSearchResult[]> {
    const ss = (safeSearch || "moderate") as "strict" | "moderate" | "off";
    const loc = locale || "us-en";

    let searchUrl: string;
    let parser: (html: string, limit: number) => DirectSearchResult[];

    // Google requires JS rendering — use Playwright browser
    if (engine === "google") {
        await engineDelay(engine);
        return browserSearchGoogle(query, limit, safeSearch, locale);
    }

    switch (engine) {
        case "duckduckgo":
            searchUrl = buildDuckDuckGoSearchUrl({ query, safeSearch: ss, locale: loc });
            parser = parseDuckDuckGoSearchResults;
            break;
        case "bing":
            searchUrl = buildBingHtmlSearchUrl({ query, safeSearch: ss, locale: loc });
            parser = parseBingHtmlSearchResults;
            break;
        case "yahoo":
            searchUrl = buildYahooSearchUrl({ query, safeSearch: ss, locale: loc });
            parser = parseYahooSearchResults;
            break;
        case "brave":
            searchUrl = buildBraveHtmlSearchUrl({ query, safeSearch: ss, locale: loc });
            parser = parseBraveHtmlSearchResults;
            break;
        default:
            return [];
    }

    // Enforce per-engine request spacing to avoid rate limits
    await engineDelay(engine);

    const ua = getRandomUA();
    const headers = getStealthHeaders(engine, ua);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
        const res = await fetch(searchUrl, {
            headers,
            signal: controller.signal,
            redirect: "follow",
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        const html = await res.text();

        // Detect challenge/CAPTCHA pages in search results
        if (isChallengePage(html)) {
            throw new Error("CHALLENGE_DETECTED: Search engine returned a challenge page");
        }

        return parser(html, limit);
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

function isChallengePage(html: string): boolean {
    // Detect Google JS-only shell (no real content, just a script loader)
    if (html.includes("httpservice/retry/enablejs") && !html.includes("<h3")) {
        return true;
    }
    const markers = [
        "cf-browser-verification",
        "cf_chl_opt",
        "geo.captcha-delivery.com",
        "g-recaptcha",
        "h-captcha",
        "challenges.cloudflare.com",
    ];
    const lower = html.toLowerCase();
    // Only flag as challenge if the page is small (real search results are large)
    if (html.length > 20_000) return false;
    return markers.some((m) => lower.includes(m));
}

export function getCuratedFallback(query: string): EnrichedResult[] {
    const q = encodeURIComponent(query);
    const make = (
        title: string, url: string, domain: string, rank: number, official = true
    ): EnrichedResult => ({
        title, url, normalizedUrl: normalizeUrl(url),
        snippet: `Fallback search for "${query}"`,
        published_at: undefined, source_domain: domain,
        rank, engine_used: "curated_fallback",
        confidence: "low" as const, is_official: official,
    });

    return [
        make(`DuckDuckGo: ${query}`, `https://html.duckduckgo.com/html/?q=${q}`, "duckduckgo.com", 1),
        make(`${query} — Wikipedia`, `https://en.wikipedia.org/wiki/Special:Search?search=${q}`, "en.wikipedia.org", 2),
        make(`GitHub: ${query}`, `https://github.com/search?q=${q}&type=repositories`, "github.com", 3),
        make(`Scholar: ${query}`, `https://scholar.google.com/scholar?q=${q}`, "scholar.google.com", 4),
        make(`Stack Overflow: ${query}`, `https://stackoverflow.com/search?q=${q}`, "stackoverflow.com", 5, false),
        make(`Reddit: ${query}`, `https://www.reddit.com/search/?q=${q}`, "reddit.com", 6, false),
        make(`MDN: ${query}`, `https://developer.mozilla.org/en-US/search?q=${q}`, "developer.mozilla.org", 7),
        make(`Archive.org: ${query}`, `https://archive.org/search?query=${q}`, "archive.org", 8),
    ];
}

function forceCircuitRecoveryIfAllDown(): boolean {
    const engines = FALLBACK_ENGINES;
    const allOpen = engines.every((e) => getEngineHealth(e).state === "open");
    if (allOpen) {
        console.error("[MCP] All engines circuit-open, forcing half-open recovery probe");
        resetAllCircuits();
        return true;
    }
    return false;
}

export interface FederatedSearchOpts {
    limit?: number | undefined;
    engines?: SearchEngine[] | undefined;
    safeSearch?: string | undefined;
    locale?: string | undefined;
    priorityDomains?: string[] | undefined;
    officialOnly?: boolean | undefined;
    sortByDate?: boolean | undefined;
    debug?: boolean | undefined;
    site?: string | undefined;
    exclude?: string[] | undefined;
    inurl?: string | undefined;
    location?: string | undefined;
    topic?: "general" | "news" | "finance" | undefined;
    include_images?: boolean | undefined;
    include_image_descriptions?: boolean | undefined;
    privacy_mode?: "normal" | "zero_trace" | undefined;
    freshness_mode?: "always" | "preferred" | "fallback" | "never" | undefined;
    proxy_profile?: string | undefined;
    country?: string | undefined;
    session_affinity?: boolean | undefined;
    rotation_strategy?: "per_request" | "sticky" | "random" | undefined;
}

type ScoredResult = EnrichedResult & { _score?: number };

export async function federatedSearch(
    query: string,
    opts: FederatedSearchOpts
) {
    const limit = opts.limit ?? 10;
    const internalLimit = opts.officialOnly || opts.sortByDate ? 20 : limit;

    const earlyIntent = analyzeIntent(query);
    const strictProfile = detectStrictProfile(query, earlyIntent);
    if (strictProfile && !opts.officialOnly) {
        opts.officialOnly = strictProfile.officialOnly;
    }

    const rewritten = rewriteQueryForIntent(query, earlyIntent, opts.site);
    const baseQuery = rewritten.query;

    const finalQuery = buildSearchQuery(baseQuery, {
        site: opts.site,
        exclude: opts.exclude,
        inurl: opts.inurl,
    });

    const engineList = opts.engines ?? FALLBACK_ENGINES.slice();
    const allResults: ScoredResult[] = [];
    const seenUrls = new Set<string>();
    const enginesTried: string[] = [];
    const enginesSucceeded: string[] = [];
    const enginesFailed: {
        engine: string;
        error: ErrorCategory;
        message?: string;
    }[] = [];
    const debugSteps: {
        engine: string;
        action: string;
        durationMs: number;
        resultCount: number;
    }[] = [];
    const trace = opts.debug ? createTrace("federatedSearch") : undefined;
    const client = getSearchClient();

    // Fast-path: skip API calls entirely when the API is known to be down
    const apiUp = await isApiAvailable();
    if (!apiUp) {
        if (opts.debug)
            debugSteps.push({
                engine: "api_probe",
                action: "api_unavailable",
                durationMs: 0,
                resultCount: 0,
            });
        console.error("[MCP] API server unavailable, skipping to direct HTTP search...");
    }

    for (const engine of engineList) {
        // Skip API-based search when the API is down
        if (!apiUp) {
            enginesFailed.push({
                engine,
                error: "network_error" as ErrorCategory,
                message: `API server unavailable at ${API_BASE_URL}, skipped`,
            });
            continue;
        }
        if (shouldSkipEngine(engine)) {
            enginesFailed.push({
                engine,
                error: "blocked" as ErrorCategory,
                message: `Circuit open for engine '${engine}', skipping`,
            });
            if (opts.debug)
                debugSteps.push({
                    engine,
                    action: "circuit_open",
                    durationMs: 0,
                    resultCount: 0,
                });
            continue;
        }
        enginesTried.push(engine);
        const t = Date.now();
        const engineSpan = trace ? startSpan(trace, `engine:${engine}`, { engine }) : undefined;
        try {
            const result = await withRetry(() =>
                client.search({
                    query: finalQuery,
                    limit: internalLimit,
                    engine,
                    safeSearch: (opts.safeSearch ?? "moderate") as "strict" | "moderate" | "off",
                    locale: opts.locale ?? "us-en",
                    topic: opts.topic,
                    include_images: opts.include_images,
                    include_image_descriptions: opts.include_image_descriptions,
                    privacy_mode: opts.privacy_mode,
                    freshness_mode: opts.freshness_mode,
                    location: opts.location,
                    proxy_profile: opts.proxy_profile,
                    country: opts.country,
                    session_affinity: opts.session_affinity,
                    rotation_strategy: opts.rotation_strategy,
                })
            );
            const count = result.results?.length ?? 0;
            if (opts.debug)
                debugSteps.push({
                    engine,
                    action: "search",
                    durationMs: Date.now() - t,
                    resultCount: count,
                });
            if (count === 0) {
                if (engine === "google" && finalQuery !== query) {
                    try {
                        const retryResult = await withRetry(
                            () =>
                                client.search({
                                    query,
                                    limit: internalLimit,
                                    engine: "google",
                                    safeSearch: (opts.safeSearch ?? "moderate") as "strict" | "moderate" | "off",
                                    locale: opts.locale ?? "us-en",
                                }),
                            1
                        );
                        const retryCount = retryResult.results?.length ?? 0;
                        if (retryCount > 0) {
                            if (opts.debug)
                                debugSteps.push({
                                    engine: "google_retry",
                                    action: "search",
                                    durationMs: Date.now() - t,
                                    resultCount: retryCount,
                                });
                            recordEngineSuccess(engine);
                            enginesSucceeded.push(engine);
                            for (const r of retryResult.results) {
                                const resolvedUrl = resolveEngineRedirect(r.url);
                                const normalized = normalizeUrl(resolvedUrl);
                                const domain = extractDomain(resolvedUrl);
                                if (seenUrls.has(normalized)) continue;
                                seenUrls.add(normalized);
                                if (!isUrlAllowed(normalized, domain, DOMAIN_BLOCKLIST, DOMAIN_ALLOWLIST)) continue;
                                if (opts.officialOnly && !isStrictOfficialSource(domain)) continue;
                                allResults.push({
                                    title: r.title,
                                    url: resolvedUrl,
                                    normalizedUrl: normalized,
                                    snippet: r.snippet,
                                    published_at: r.snippet ? extractDateFromText(r.snippet) : undefined,
                                    source_domain: domain,
                                    rank: allResults.length + 1,
                                    engine_used: "google",
                                    confidence: "medium",
                                    is_official: isOfficialSource(domain),
                                });
                            }
                            if (engineSpan && trace) endSpan(trace, engineSpan);
                            continue;
                        }
                    } catch {
                        // retry failed
                    }
                }
                if (engine === "google") {
                    try {
                        const sanitizedQuery = query.replace(/[^\x20-\x7E]/g, " ").trim().substring(0, 200);
                        const retryResult2 = await withRetry(
                            () =>
                                client.search({
                                    query: sanitizedQuery,
                                    limit: internalLimit,
                                    engine: "google",
                                    safeSearch: (opts.safeSearch ?? "moderate") as "strict" | "moderate" | "off",
                                    locale: "us-en",
                                }),
                            1
                        );
                        const retryCount2 = retryResult2.results?.length ?? 0;
                        if (retryCount2 > 0) {
                            if (opts.debug)
                                debugSteps.push({
                                    engine: "google_sanitized_retry",
                                    action: "search",
                                    durationMs: Date.now() - t,
                                    resultCount: retryCount2,
                                });
                            recordEngineSuccess(engine);
                            enginesSucceeded.push(engine);
                            for (const r of retryResult2.results) {
                                const resolvedUrl = resolveEngineRedirect(r.url);
                                const normalized = normalizeUrl(resolvedUrl);
                                const domain = extractDomain(resolvedUrl);
                                if (seenUrls.has(normalized)) continue;
                                seenUrls.add(normalized);
                                if (!isUrlAllowed(normalized, domain, DOMAIN_BLOCKLIST, DOMAIN_ALLOWLIST)) continue;
                                if (opts.officialOnly && !isStrictOfficialSource(domain)) continue;
                                allResults.push({
                                    title: r.title,
                                    url: resolvedUrl,
                                    normalizedUrl: normalized,
                                    snippet: r.snippet,
                                    published_at: r.snippet ? extractDateFromText(r.snippet) : undefined,
                                    source_domain: domain,
                                    rank: allResults.length + 1,
                                    engine_used: "google",
                                    confidence: "medium",
                                    is_official: isOfficialSource(domain),
                                });
                            }
                            if (engineSpan && trace) endSpan(trace, engineSpan);
                            continue;
                        }
                    } catch {
                        // sanitized retry failed
                    }
                }
                recordEngineFailure(engine);
                enginesFailed.push({
                    engine,
                    error: "empty_engine",
                    message: `Engine '${engine}' returned 0 results for query: "${finalQuery.substring(
                        0,
                        80
                    )}"`,
                });
                continue;
            }
            recordEngineSuccess(engine);
            enginesSucceeded.push(engine);
            for (const r of result.results) {
                const resolvedUrl = resolveEngineRedirect(r.url);
                const normalized = normalizeUrl(resolvedUrl);
                const domain = extractDomain(resolvedUrl);
                if (seenUrls.has(normalized)) continue;
                seenUrls.add(normalized);
                if (!isUrlAllowed(normalized, domain, DOMAIN_BLOCKLIST, DOMAIN_ALLOWLIST)) continue;
                if (opts.officialOnly && !isStrictOfficialSource(domain)) continue;
                allResults.push({
                    title: r.title,
                    url: resolvedUrl,
                    normalizedUrl: normalized,
                    snippet: r.snippet,
                    published_at: r.snippet ? extractDateFromText(r.snippet) : undefined,
                    source_domain: domain,
                    rank: allResults.length + 1,
                    engine_used: engine,
                    confidence: enginesSucceeded.length === 1 ? "high" : "medium",
                    is_official: isOfficialSource(domain),
                });
            }
            if (engineSpan && trace) endSpan(trace, engineSpan);
        } catch (err) {
            if (engineSpan && trace) endSpan(trace, engineSpan);
            recordEngineFailure(engine);
            const c = classifyError(err);
            enginesFailed.push({ engine, error: c.error, message: c.message });
            if (opts.debug)
                debugSteps.push({
                    engine,
                    action: "search_failed",
                    durationMs: Date.now() - t,
                    resultCount: 0,
                });
            logEngineError(engine, err);

            // If the API itself is unreachable, skip remaining engines immediately
            if (isApiConnectionError(err)) {
                markApiDown();
                console.error(`[MCP] API connection error on engine '${engine}', skipping remaining API engines`);
                break;
            }
        }
    }

    if (allResults.length === 0 && enginesFailed.length > 0) {
        console.error("[MCP] All API-based engines failed, trying direct HTTP search...");
        const directEngines: readonly string[] = ["duckduckgo", "brave", "bing", "yahoo", "google"];
        for (const dEngine of directEngines) {
            if (allResults.length >= limit) break;
            const dt = Date.now();
            try {
                const directResults = await directSearchEngine(
                    dEngine,
                    finalQuery !== query ? query : finalQuery,
                    internalLimit,
                    opts.safeSearch ?? "moderate",
                    opts.locale ?? "us-en"
                );
                if (directResults.length > 0) {
                    recordEngineSuccess(dEngine);
                    enginesSucceeded.push(`${dEngine}_direct`);
                    if (opts.debug)
                        debugSteps.push({
                            engine: `${dEngine}_direct`,
                            action: "direct_http_search",
                            durationMs: Date.now() - dt,
                            resultCount: directResults.length,
                        });
                    for (const r of directResults) {
                        const resolvedUrl = resolveEngineRedirect(r.url);
                        const normalized = normalizeUrl(resolvedUrl);
                        const domain = extractDomain(resolvedUrl);
                        if (seenUrls.has(normalized)) continue;
                        seenUrls.add(normalized);
                        if (!isUrlAllowed(normalized, domain, DOMAIN_BLOCKLIST, DOMAIN_ALLOWLIST)) continue;
                        if (opts.officialOnly && !isStrictOfficialSource(domain)) continue;
                        allResults.push({
                            title: r.title,
                            url: resolvedUrl,
                            normalizedUrl: normalized,
                            snippet: r.snippet,
                            published_at: r.snippet ? extractDateFromText(r.snippet) : undefined,
                            source_domain: domain,
                            rank: allResults.length + 1,
                            engine_used: `${dEngine}_direct`,
                            confidence: "medium",
                            is_official: isOfficialSource(domain),
                        });
                    }
                    break;
                }
            } catch (directErr) {
                logEngineError(`${dEngine}_direct`, directErr);
                if (opts.debug)
                    debugSteps.push({
                        engine: `${dEngine}_direct`,
                        action: "direct_http_failed",
                        durationMs: Date.now() - dt,
                        resultCount: 0,
                    });
            }
        }
    }

    if (allResults.length === 0) {
        console.error("[MCP] All live search failed, returning curated fallback results");
        const curated = getCuratedFallback(query);
        if (curated.length > 0) {
            allResults.push(...curated);
            enginesSucceeded.push("curated_fallback");
            if (opts.debug)
                debugSteps.push({
                    engine: "curated_fallback",
                    action: "degraded_mode",
                    durationMs: 0,
                    resultCount: curated.length,
                });
        }
        forceCircuitRecoveryIfAllDown();
    }

    const scoringSpan = trace ? startSpan(trace, "scoring") : undefined;
    const intent = analyzeIntent(query);
    const wantsRecent = isRecencyQuery(query) || opts.sortByDate || intent === "news";
    const queryTerms = extractQueryTerms(query);
    for (const r of allResults) {
        let domainScore = getDomainWeight(r.source_domain);
        const canonBonus = canonicalDomainBonus(r.source_domain, query, intent);
        domainScore += canonBonus;
        const noise = noisePenalty(r.source_domain, intent);
        domainScore += strictProfile ? noise * strictProfile.noisePenaltyMultiplier : noise;

        if (intent === "troubleshooting") {
            if (r.source_domain.includes("stackoverflow.com") || r.source_domain.includes("github.com")) {
                domainScore += 30;
            }
        } else if (intent === "documentation" || intent === "api_docs") {
            if (r.is_official) {
                domainScore += 40;
            }
        } else if (intent === "legal") {
            if (r.source_domain.endsWith(".gov") || r.source_domain.endsWith(".gov.uk")) {
                domainScore += 60;
            }
        } else if (intent === "release_notes") {
            if (r.is_official) {
                domainScore += 35;
            }
        }

        const officialBonus = r.is_official ? 20 : 0;

        let recencyBonus = 0;
        if (wantsRecent && r.published_at) {
            const ageMs = Date.now() - new Date(r.published_at).getTime();
            if (ageMs < 30 * 86400000) recencyBonus = intent === "news" || intent === "release_notes" ? 60 : 30;
            else if (ageMs < 90 * 86400000) recencyBonus = intent === "news" || intent === "release_notes" ? 40 : 20;
            else if (ageMs < 365 * 86400000) recencyBonus = intent === "news" || intent === "release_notes" ? 20 : 10;
        }

        let versionBonus = 0;
        if (wantsRecent) {
            const match = r.url.match(
                /(?:v|version|release|(?<=-))(\d+)[.-](\d+)(?:[.-](\d+))?/i
            );
            if (match) {
                const major = parseInt(match[1] ?? "0", 10);
                const minor = parseInt(match[2] ?? "0", 10);
                const patch = parseInt(match[3] ?? "0", 10);
                versionBonus = major * 0.1 + minor * 1.0 + patch * 0.1;
            }
        }

        const snippetBonus = snippetOverlapBonus(r.snippet, queryTerms);
        const titleBonus = titleMatchBonus(r.title, queryTerms);
        const authBonus = authorityBonus(r.source_domain, intent);
        const urlScore = urlOfficialScore(r.url, r.source_domain);

        r._score =
            domainScore + officialBonus + recencyBonus + versionBonus + snippetBonus + titleBonus + authBonus + urlScore;
    }

    const domainCounts = new Map<string, number>();
    allResults.sort(
        (a, b) => (b._score ?? 0) - (a._score ?? 0)
    );
    for (const r of allResults) {
        const dp = diversityPenalty(r.source_domain, domainCounts);
        r._score = (r._score ?? 0) + dp;
    }
    allResults.sort(
        (a, b) => (b._score ?? 0) - (a._score ?? 0)
    );

    if (opts.priorityDomains?.length) {
        const p = new Set(
            opts.priorityDomains.map((d) => d.toLowerCase().replace(/^www\./u, ""))
        );
        allResults.sort(
            (a, b) =>
                (p.has(a.source_domain) ? 0 : 1) - (p.has(b.source_domain) ? 0 : 1)
        );
    }
    if (wantsRecent && allResults.length > 1) {
        const top = allResults[0];
        if (top && top.published_at) {
            const topAge = Date.now() - new Date(top.published_at).getTime();
            if (topAge > 365 * 86400000) {
                const newerOfficial = allResults.find(
                    (r, i) =>
                        i > 0 &&
                        r.is_official &&
                        r.published_at &&
                        Date.now() - new Date(r.published_at).getTime() < 180 * 86400000
                );
                if (newerOfficial) {
                    const idx = allResults.indexOf(newerOfficial);
                    allResults.splice(idx, 1);
                    allResults.unshift(newerOfficial);
                }
            }
        }
    }
    if (opts.sortByDate) {
        allResults.sort((a, b) => {
            const cmp = (b.published_at ?? "").localeCompare(a.published_at ?? "");
            if (cmp !== 0) return cmp;
            return (b._score ?? 0) - (a._score ?? 0);
        });
    }
    if (scoringSpan && trace) endSpan(trace, scoringSpan);
    allResults.forEach((r, i) => {
        r.rank = i + 1;
        delete r._score;
    });
    const traceOutput = trace ? finalizeTrace(trace) : undefined;
    return {
        results: allResults.slice(0, limit),
        engines_tried: enginesTried,
        engines_succeeded: enginesSucceeded,
        engines_failed: enginesFailed,
        ...(wantsRecent ? { recency_aware: true } : {}),
        ...(opts.debug ? { debug_steps: debugSteps } : {}),
        ...(traceOutput ? { _trace: traceOutput } : {}),
        _versions: {
            reranker: RERANKER_VERSION,
            trustRules: TRUST_RULES_VERSION,
            server: SERVER_VERSION,
        },
    };
}
