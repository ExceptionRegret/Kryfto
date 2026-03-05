// ── Helpers: error classification, retry, date/section extraction ────
import type { ErrorCategory, EngineErrorMetric, McpMeta } from "./types.js";
import { MAX_RETRIES, RETRY_BASE_MS } from "./types.js";
import { versionStamp } from "./version.js";
import { recordSLO, storeReplay } from "./slo.js";
import { randomUUID } from "node:crypto";

// ── Response Helpers ────────────────────────────────────────────────
export function asText(
    data: unknown,
    meta?: McpMeta
) {
    const reqId = meta?.requestId ?? randomUUID().substring(0, 8);
    const latency = meta?.latencyMs ?? 0;
    const isCached = meta?.cached ?? false;
    // Record SLO metrics
    if (meta?.tool) recordSLO(meta.tool, true, latency, isCached, reqId);
    // Store for replay
    if (meta?.tool) storeReplay(reqId, meta.tool, {}, data, latency);
    return {
        content: [
            {
                type: "text" as const,
                text: JSON.stringify(
                    {
                        ...(typeof data === "object" && data !== null ? data : { data }),
                        _meta: {
                            requestId: reqId,
                            latencyMs: latency,
                            cached: isCached,
                            ...(meta?.tool ? { tool: meta.tool } : {}),
                            ...versionStamp(),
                        },
                    },
                    null,
                    2
                ),
            },
        ],
    };
}

export function asError(
    cat: ErrorCategory,
    msg: string,
    ctx?: Record<string, unknown>
) {
    return {
        content: [
            {
                type: "text" as const,
                text: JSON.stringify(
                    {
                        error: cat,
                        message: msg,
                        ...ctx,
                        _meta: { ...versionStamp() },
                    },
                    null,
                    2
                ),
            },
        ],
    };
}

// ── Error Classification ────────────────────────────────────────────
export function classifyError(error: unknown): {
    error: ErrorCategory;
    message: string;
} {
    const msg = error instanceof Error ? error.message : String(error);
    const apiBase = process.env.API_BASE_URL ?? "http://localhost:8080";

    if (msg.includes("403") || msg.includes("blocked") || msg.includes("captcha"))
        return { error: "blocked", message: `Request blocked: ${msg}` };
    if (msg.includes("429") || msg.includes("rate") || msg.includes("throttl"))
        return { error: "rate_limited", message: `Rate limited: ${msg}. Try again in a few seconds.` };
    if (msg.includes("404")) return { error: "not_found", message: `Resource not found: ${msg}` };
    if (msg.includes("timeout") || msg.includes("Timed out"))
        return { error: "timeout", message: `Request timed out: ${msg}. Consider increasing timeoutMs.` };
    if (msg.includes("ECONNREFUSED"))
        return {
            error: "network_error",
            message: `Cannot connect to Kryfto API at ${apiBase} — is the server running? (${msg})`,
        };
    if (msg.includes("ENOTFOUND"))
        return {
            error: "network_error",
            message: `DNS resolution failed for Kryfto API at ${apiBase} — check your API_BASE_URL configuration. (${msg})`,
        };
    if (msg.includes("fetch") || msg.includes("network"))
        return { error: "network_error", message: `Network error connecting to ${apiBase}: ${msg}` };
    if (msg.includes("parse") || msg.includes("JSON"))
        return { error: "parse_failed", message: `Failed to parse response: ${msg}` };
    return { error: "unknown", message: msg };
}

// ── Engine Error Metrics ────────────────────────────────────────────
const engineErrorLog: EngineErrorMetric[] = [];
const MAX_ENGINE_ERROR_LOG = 500;

export function classifyEngineError(err: unknown): EngineErrorMetric["errorClass"] {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return "dns";
    if (/CERT|TLS|SSL|ERR_TLS/i.test(msg)) return "tls";
    if (/ETIMEDOUT|ESOCKETTIMEDOUT|timeout|AbortError/i.test(msg)) return "timeout";
    if (/ECONNREFUSED|ECONNRESET|EPIPE|network/i.test(msg)) return "network";
    if (/4\d{2}|forbidden|blocked|captcha/i.test(msg)) return "http_4xx";
    if (/5\d{2}|internal.server/i.test(msg)) return "http_5xx";
    return "unknown";
}

export function logEngineError(engine: string, err: unknown): void {
    const errorClass = classifyEngineError(err);
    const msg = err instanceof Error ? err.message : String(err);
    engineErrorLog.push({ engine, errorClass, message: msg.substring(0, 200), timestamp: Date.now() });
    if (engineErrorLog.length > MAX_ENGINE_ERROR_LOG) engineErrorLog.splice(0, engineErrorLog.length - MAX_ENGINE_ERROR_LOG);
}

export function getEngineErrorMetrics(windowMinutes = 60): Record<string, Record<string, number>> {
    const cutoff = Date.now() - windowMinutes * 60 * 1000;
    const metrics: Record<string, Record<string, number>> = {};
    for (const e of engineErrorLog) {
        if (e.timestamp < cutoff) continue;
        if (!metrics[e.engine]) metrics[e.engine] = {};
        metrics[e.engine]![e.errorClass] = (metrics[e.engine]![e.errorClass] ?? 0) + 1;
    }
    return metrics;
}

// ── Retry with Backoff ──────────────────────────────────────────────
export async function withRetry<T>(
    fn: () => Promise<T>,
    retries = MAX_RETRIES
): Promise<T> {
    let last: unknown;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            last = err;
            const c = classifyError(err);
            if (c.error === "not_found") throw err;
            if (c.error === "blocked" && i >= retries - 1) throw err;
            if (i < retries - 1) {
                let baseMs = RETRY_BASE_MS;
                if (c.error === "rate_limited" || c.error === "timeout") {
                    baseMs = RETRY_BASE_MS * 3;
                }
                const jitter = Math.random() * 1000;
                const delay = baseMs * Math.pow(2.5, i) + jitter;
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }
    throw last;
}

// ── Date Extraction ─────────────────────────────────────────────────
const MONTHS: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
};
const SHORT_MONTHS: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04",
    may: "05", jun: "06", jul: "07", aug: "08",
    sep: "09", oct: "10", nov: "11", dec: "12",
};

export function extractDateFromText(text: string): string | undefined {
    const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso) return iso[1];
    const long = text.match(
        /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i
    );
    if (long) {
        const mn = MONTHS[long[1]!.toLowerCase()] ?? "01";
        return `${long[3]!}-${mn}-${long[2]!.padStart(2, "0")}`;
    }
    const short1 = text.match(
        /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/i
    );
    if (short1) {
        const mn = SHORT_MONTHS[short1[1]!.toLowerCase().substring(0, 3)] ?? "01";
        return `${short1[3]!}-${mn}-${short1[2]!.padStart(2, "0")}`;
    }
    const short2 = text.match(
        /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i
    );
    if (short2) {
        const mn = SHORT_MONTHS[short2[2]!.toLowerCase().substring(0, 3)] ?? "01";
        return `${short2[3]!}-${mn}-${short2[1]!.padStart(2, "0")}`;
    }
    const us = text.match(/\b(\d{2})[/-](\d{2})[/-](\d{4})\b/);
    if (us && parseInt(us[1]!) <= 12) return `${us[3]!}-${us[1]!}-${us[2]!}`;
    return undefined;
}

export function extractDateFromHtml(html: string): {
    date: string | undefined;
    confidence: "high" | "medium" | "low";
    source: string;
} {
    const meta = html.match(
        /(?:property|name)=["'](?:article:published_time|datePublished|date|DC\.date|og:updated_time)["']\s+content=["']([^"']+)["']/i
    );
    if (meta)
        return { date: meta[1]!.substring(0, 10), confidence: "high", source: "meta" };
    const metaRev = html.match(
        /content=["']([\d]{4}-[\d]{2}-[\d]{2}[^"']*)["']\s+(?:property|name)=["'](?:article:published_time|datePublished|date)["']/i
    );
    if (metaRev)
        return { date: metaRev[1]!.substring(0, 10), confidence: "high", source: "meta" };
    const ld = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
    if (ld) return { date: ld[1]!.substring(0, 10), confidence: "high", source: "jsonld" };
    const ldMod = html.match(/"dateModified"\s*:\s*"([^"]+)"/);
    if (ldMod)
        return { date: ldMod[1]!.substring(0, 10), confidence: "high", source: "jsonld_modified" };
    const timeEl = html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
    if (timeEl)
        return { date: timeEl[1]!.substring(0, 10), confidence: "medium", source: "time_element" };
    const t = extractDateFromText(html.substring(0, 5000));
    if (t) return { date: t, confidence: "medium", source: "text" };
    return { date: undefined, confidence: "low", source: "none" };
}

// ── Section Extraction ──────────────────────────────────────────────
export function extractSections(html: string): {
    headings: string[];
    codeBlocks: string[];
    links: { text: string; href: string }[];
    tables: string[][];
    wordCount: number;
} {
    const headings: string[] = [];
    const codeBlocks: string[] = [];
    const links: { text: string; href: string }[] = [];
    const tables: string[][] = [];
    let m: RegExpExecArray | null;
    const hRe = /<h[1-6][^>]*>(.*?)<\/h[1-6]>/gis;
    while ((m = hRe.exec(html)) !== null)
        headings.push(m[1]!.replace(/<[^>]+>/g, "").trim());
    const cRe = /<(?:pre|code)[^>]*>(.*?)<\/(?:pre|code)>/gis;
    while ((m = cRe.exec(html)) !== null)
        codeBlocks.push(
            m[1]!
                .replace(/<[^>]+>/g, "")
                .trim()
                .substring(0, 500)
        );
    const aRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
    while ((m = aRe.exec(html)) !== null) {
        const t = m[2]!.replace(/<[^>]+>/g, "").trim();
        if (t && m[1]!.startsWith("http")) links.push({ text: t, href: m[1]! });
    }
    const tRe = /<tr[^>]*>(.*?)<\/tr>/gis;
    while ((m = tRe.exec(html)) !== null) {
        const cells: string[] = [];
        const cRe2 = /<t[dh][^>]*>(.*?)<\/t[dh]>/gis;
        let c;
        while ((c = cRe2.exec(m[1]!)) !== null)
            cells.push(c[1]!.replace(/<[^>]+>/g, "").trim());
        if (cells.length > 0) tables.push(cells);
    }
    return {
        headings,
        codeBlocks: codeBlocks.slice(0, 20),
        links: links.slice(0, 50),
        tables: tables.slice(0, 30),
        wordCount: html.replace(/<[^>]+>/g, " ").split(/\s+/).length,
    };
}
