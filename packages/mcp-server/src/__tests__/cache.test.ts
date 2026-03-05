import { describe, expect, it, beforeEach } from "vitest";
import { getCached, setCache, getRawCache } from "../cache.js";

describe("cache", () => {
    beforeEach(() => {
        getRawCache().clear();
    });

    it("returns miss for unknown key", () => {
        const result = getCached("nonexistent");
        expect(result.hit).toBe(false);
        expect(result.stale).toBe(false);
    });

    it("stores and retrieves data", () => {
        setCache("test-key", { value: 42 }, 60000);
        const result = getCached("test-key");
        expect(result.hit).toBe(true);
        expect(result.stale).toBe(false);
        expect((result.data as Record<string, number>).value).toBe(42);
    });

    it("stores html alongside data", () => {
        setCache("html-key", { url: "test" }, 60000, "<html>content</html>");
        const result = getCached("html-key");
        expect(result.hit).toBe(true);
        expect(result.html).toBe("<html>content</html>");
    });

    it("freshness_mode=always forces cache miss", () => {
        setCache("always-key", { value: 1 }, 60000);
        const result = getCached("always-key", "always");
        expect(result.hit).toBe(false);
    });

    it("freshness_mode=never requires cache hit", () => {
        expect(() => getCached("missing-key", "never")).toThrow(
            "freshness_mode=never requires cache hit"
        );
    });

    it("freshness_mode=never returns even expired entries", () => {
        const cache = getRawCache();
        cache.set("stale-key", {
            data: { old: true },
            cachedAt: Date.now() - 200000,
            ttlMs: 1000,
            html: undefined,
        });
        const result = getCached("stale-key", "never");
        expect(result.hit).toBe(true);
        expect(result.stale).toBe(true);
    });

    it("freshness_mode=fallback keeps expired entries available", () => {
        const cache = getRawCache();
        cache.set("fallback-key", {
            data: { fallback: true },
            cachedAt: Date.now() - 200000,
            ttlMs: 1000,
            html: undefined,
        });
        const result = getCached("fallback-key", "fallback");
        expect(result.hit).toBe(true);
        expect(result.stale).toBe(true);
    });

    it("expired entries are removed on default mode", () => {
        const cache = getRawCache();
        cache.set("expired-key", {
            data: { expired: true },
            cachedAt: Date.now() - 200000,
            ttlMs: 1000,
            html: undefined,
        });
        const result = getCached("expired-key");
        expect(result.hit).toBe(false);
        expect(result.stale).toBe(true);
        expect(cache.has("expired-key")).toBe(false);
    });
});
