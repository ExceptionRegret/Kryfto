// ── In-memory Cache ─────────────────────────────────────────────────
import type { CacheEntry, FreshnessMode } from "./types.js";

export { CACHE_DEFAULT_TTL_MS } from "./types.js";

const cache = new Map<string, CacheEntry>();

export function getCached(
    key: string,
    mode?: FreshnessMode
): {
    hit: boolean;
    stale: boolean;
    data?: unknown;
    cachedAt?: number;
    html?: string | undefined;
} {
    if (mode === "always") return { hit: false, stale: false };
    const e = cache.get(key);
    if (!e) {
        if (mode === "never")
            throw new Error(
                `freshness_mode=never requires cache hit but none found for ${key}`
            );
        return { hit: false, stale: false };
    }
    const expired = Date.now() - e.cachedAt > e.ttlMs;
    if (mode === "never")
        return {
            hit: true,
            stale: expired,
            data: e.data,
            cachedAt: e.cachedAt,
            html: e.html,
        };
    if (expired && mode !== "fallback") {
        cache.delete(key);
        return { hit: false, stale: true };
    }
    return {
        hit: true,
        stale: expired,
        data: e.data,
        cachedAt: e.cachedAt,
        html: e.html,
    };
}

export function setCache(
    key: string,
    data: unknown,
    ttlMs: number,
    html?: string
) {
    cache.set(key, { data, cachedAt: Date.now(), ttlMs, html });
}

/** Inspect the raw cache Map (for truth maintenance, diagnostics, etc.) */
export function getRawCache(): Map<string, CacheEntry> {
    return cache;
}
