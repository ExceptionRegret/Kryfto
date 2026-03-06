// ── Unified Anti-Bot Stealth Layer ─────────────────────────────────
// Provides browser-realistic HTTP headers, UA rotation, per-engine
// request spacing, and lightweight cookie persistence for search
// engine scraping across all engines.

// ── User-Agent Pool (2025-era versions) ───────────────────────────
export const UA_POOL: readonly string[] = [
  // Chrome 133
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  // Chrome 132
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  // Chrome 131
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // NOTE: Firefox/Safari UAs removed — they create fingerprint mismatches in
  // Chromium (window.chrome presence, plugin arrays, etc). Only use Chromium-based UAs.
  // Edge 133
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0",
  // Edge 131
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  // Chrome 130 (slightly older, still common)
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
];

// ── Browser Family Detection ──────────────────────────────────────

export type BrowserFamily = "chrome" | "firefox" | "safari" | "edge";

export function detectBrowserFamily(ua: string): BrowserFamily {
  if (ua.includes("Edg/")) return "edge";
  if (ua.includes("Firefox/")) return "firefox";
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "safari";
  return "chrome";
}

function extractChromeVersion(ua: string): string {
  // For Edge, extract the Chrome version (not Edge version)
  const m = ua.match(/Chrome\/(\d+)/);
  return m?.[1] ?? "133";
}

function detectPlatform(ua: string): string {
  if (ua.includes("Macintosh")) return '"macOS"';
  if (ua.includes("Linux")) return '"Linux"';
  return '"Windows"';
}

// ── Engine Referers ───────────────────────────────────────────────

const ENGINE_REFERERS: Record<string, string> = {
  google: "https://www.google.com/",
  bing: "https://www.bing.com/",
  duckduckgo: "https://duckduckgo.com/",
  brave: "https://search.brave.com/",
  yahoo: "https://search.yahoo.com/",
};

// ── Random Selection ──────────────────────────────────────────────

export function getRandomUA(): string {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)]!;
}

// ── Header Generation ─────────────────────────────────────────────

/**
 * Generate browser-realistic HTTP headers for a search engine request.
 * Headers vary by browser family (Chrome/Edge send Sec-Ch-Ua, Firefox
 * sends Sec-Fetch but no client hints, Safari sends minimal headers).
 */
export function getStealthHeaders(
  engine: string,
  ua: string,
): Record<string, string> {
  const family = detectBrowserFamily(ua);
  const referer = ENGINE_REFERERS[engine] ?? "";
  const headers: Record<string, string> = {
    "User-Agent": ua,
    "Upgrade-Insecure-Requests": "1",
    DNT: "1",
    Connection: "keep-alive",
  };

  if (referer) {
    headers["Referer"] = referer;
  }

  switch (family) {
    case "chrome":
    case "edge": {
      const ver = extractChromeVersion(ua);
      const brand = family === "edge"
        ? `"Chromium";v="${ver}", "Microsoft Edge";v="${ver}", "Not-A.Brand";v="24"`
        : `"Chromium";v="${ver}", "Google Chrome";v="${ver}", "Not-A.Brand";v="24"`;

      headers["Accept"] =
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8";
      headers["Accept-Language"] = "en-US,en;q=0.9";
      headers["Accept-Encoding"] = "gzip, deflate, br";
      headers["Sec-Fetch-Dest"] = "document";
      headers["Sec-Fetch-Mode"] = "navigate";
      // Initial navigation (typing a URL) is "none"; only subsequent
      // same-site requests should be "same-origin". Since we always
      // initiate fresh search-engine requests, use "none".
      headers["Sec-Fetch-Site"] = "none";
      headers["Sec-Fetch-User"] = "?1";
      headers["Sec-Ch-Ua"] = brand;
      headers["Sec-Ch-Ua-Mobile"] = "?0";
      headers["Sec-Ch-Ua-Platform"] = detectPlatform(ua);
      break;
    }

    case "firefox": {
      headers["Accept"] =
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
      headers["Accept-Language"] = "en-US,en;q=0.5";
      headers["Accept-Encoding"] = "gzip, deflate, br";
      headers["Sec-Fetch-Dest"] = "document";
      headers["Sec-Fetch-Mode"] = "navigate";
      // Same fix as Chrome: initial navigation is "none"
      headers["Sec-Fetch-Site"] = "none";
      headers["Sec-Fetch-User"] = "?1";
      // Firefox does NOT send Sec-Ch-Ua client hints
      break;
    }

    case "safari": {
      headers["Accept"] =
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
      headers["Accept-Language"] = "en-US,en;q=0.9";
      headers["Accept-Encoding"] = "gzip, deflate, br";
      // Safari sends neither Sec-Fetch-* nor Sec-Ch-Ua
      break;
    }
  }

  return headers;
}

/**
 * Generate stealth headers for JSON API calls.
 * Same browser fingerprint but Accept: application/json.
 */
export function getStealthJsonHeaders(
  ua: string,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const family = detectBrowserFamily(ua);
  const headers: Record<string, string> = {
    "User-Agent": ua,
    Accept: "application/json",
    "Accept-Language": family === "firefox" ? "en-US,en;q=0.5" : "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
    ...extraHeaders,
  };
  return headers;
}

// ── Per-Engine Request Spacing ────────────────────────────────────

const ENGINE_DELAY_RANGES: Record<string, [number, number]> = {
  google: [1500, 3000],
  bing: [400, 800],
  duckduckgo: [200, 500],
  brave: [300, 600],
  yahoo: [400, 800],
};

const DEFAULT_DELAY_RANGE: [number, number] = [300, 600];

const lastRequestTime = new Map<string, number>();

/**
 * Enforce minimum spacing between requests to the same search engine.
 * Returns a Promise that resolves after the appropriate delay.
 * No-ops if enough time has already elapsed since the last request.
 */
export async function engineDelay(engine: string): Promise<void> {
  const [min, max] = ENGINE_DELAY_RANGES[engine] ?? DEFAULT_DELAY_RANGE;
  const targetDelay = min + Math.random() * (max - min);
  const last = lastRequestTime.get(engine) ?? 0;
  const elapsed = Date.now() - last;
  const remaining = targetDelay - elapsed;

  if (remaining > 0) {
    await new Promise((r) => setTimeout(r, remaining));
  }

  lastRequestTime.set(engine, Date.now());
}

/** Reset delay tracking (for tests). */
export function resetEngineDelays(): void {
  lastRequestTime.clear();
}

// ── Simple Cookie Jar ─────────────────────────────────────────────

interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expiresAt: number;
}

const COOKIE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Lightweight in-memory cookie store. Persists cookies per-domain
 * for the lifetime of the process (max 30 minutes per cookie).
 * Respects Domain, Path, Secure, and HttpOnly attributes (RFC 6265).
 * Not persistent across restarts — intentional to avoid fingerprint
 * accumulation.
 */
export class SimpleCookieJar {
  private cookies = new Map<string, CookieEntry[]>();

  /** Parse Set-Cookie attributes from a raw header string. */
  private parseSetCookie(raw: string, requestDomain: string): CookieEntry | undefined {
    const parts = raw.split(";").map((s) => s.trim());
    const nameValue = parts[0];
    if (!nameValue) return undefined;
    const eqIdx = nameValue.indexOf("=");
    if (eqIdx < 0) return undefined;
    const name = nameValue.slice(0, eqIdx).trim();
    const value = nameValue.slice(eqIdx + 1).trim();
    if (!name) return undefined;

    let domain = requestDomain.toLowerCase();
    let path = "/";
    let secure = false;
    let httpOnly = false;
    let expiresAt = Date.now() + COOKIE_TTL_MS;

    for (let i = 1; i < parts.length; i++) {
      const attr = parts[i]!;
      const attrLower = attr.toLowerCase();
      if (attrLower.startsWith("domain=")) {
        let d = attr.slice(7).trim().toLowerCase();
        if (d.startsWith(".")) d = d.slice(1);
        // Only allow setting domain to self or parent domain
        if (requestDomain.endsWith(d)) domain = d;
      } else if (attrLower.startsWith("path=")) {
        path = attr.slice(5).trim() || "/";
      } else if (attrLower === "secure") {
        secure = true;
      } else if (attrLower === "httponly") {
        httpOnly = true;
      } else if (attrLower.startsWith("max-age=")) {
        const maxAge = parseInt(attr.slice(8).trim(), 10);
        if (!isNaN(maxAge)) expiresAt = Date.now() + maxAge * 1000;
      } else if (attrLower.startsWith("expires=")) {
        const d = new Date(attr.slice(8).trim()).getTime();
        if (!isNaN(d)) expiresAt = d;
      }
    }

    return { name, value, domain, path, secure, httpOnly, expiresAt };
  }

  /** Store a cookie for a domain. */
  set(domain: string, name: string, value: string, path = "/", secure = false, httpOnly = false): void {
    const key = domain.toLowerCase();
    const entries = this.cookies.get(key) ?? [];
    const existing = entries.findIndex((e) => e.name === name && e.path === path);
    const entry: CookieEntry = { name, value, domain: key, path, secure, httpOnly, expiresAt: Date.now() + COOKIE_TTL_MS };
    if (existing >= 0) {
      entries[existing] = entry;
    } else {
      entries.push(entry);
    }
    this.cookies.set(key, entries);
  }

  /** Get the Cookie header string for a URL, or undefined if none. */
  get(domain: string, requestPath = "/", isSecure = true): string | undefined {
    const now = Date.now();
    const matching: CookieEntry[] = [];
    const domainLower = domain.toLowerCase();

    for (const [cookieDomain, entries] of this.cookies) {
      // Domain matching: exact match or subdomain match
      if (domainLower !== cookieDomain && !domainLower.endsWith("." + cookieDomain)) continue;

      const valid = entries.filter((e) => {
        if (e.expiresAt <= now) return false;
        // Path matching: request path must start with cookie path
        if (!requestPath.startsWith(e.path)) return false;
        // Secure cookies only over HTTPS
        if (e.secure && !isSecure) return false;
        return true;
      });

      // Evict expired
      if (valid.length !== entries.length) {
        if (valid.length === 0) this.cookies.delete(cookieDomain);
        else this.cookies.set(cookieDomain, valid);
      }

      matching.push(...valid);
    }

    if (matching.length === 0) return undefined;
    // Sort by path length descending (more specific paths first, per RFC 6265)
    matching.sort((a, b) => b.path.length - a.path.length);
    return matching.map((e) => `${e.name}=${e.value}`).join("; ");
  }

  /**
   * Extract Set-Cookie headers from a fetch Response and store them.
   * Parses Domain, Path, Secure, HttpOnly, Max-Age, and Expires attributes.
   */
  extractFromResponse(domain: string, response: { headers: { getSetCookie?: () => string[]; get?: (name: string) => string | null } }): void {
    let setCookies = response.headers.getSetCookie?.() ?? [];
    // Fallback for older Node/undici versions without getSetCookie
    if (setCookies.length === 0 && response.headers.get) {
      const raw = response.headers.get("set-cookie");
      if (raw) setCookies = raw.split(/,(?=\s*\w+=)/);
    }
    for (const raw of setCookies) {
      const entry = this.parseSetCookie(raw, domain.toLowerCase());
      if (!entry) continue;
      const entries = this.cookies.get(entry.domain) ?? [];
      const existing = entries.findIndex((e) => e.name === entry.name && e.path === entry.path);
      if (existing >= 0) {
        entries[existing] = entry;
      } else {
        entries.push(entry);
      }
      this.cookies.set(entry.domain, entries);
    }
  }

  /** Clear all cookies. */
  clear(): void {
    this.cookies.clear();
  }

  /** Number of domains with cookies. */
  get size(): number {
    return this.cookies.size;
  }
}

// ── Google Consent Cookie ────────────────────────────────────────

/**
 * Pre-set Google consent cookie (SOCS) to bypass the EU consent dialog.
 * This prevents Google from showing a CAPTCHA-like consent interstitial.
 */
export function getGoogleConsentCookieHeader(): string {
  return "SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjUwMjI0LjA1X3AwGgJlbiADGgYIgL2BugY; CONSENT=PENDING+987";
}
