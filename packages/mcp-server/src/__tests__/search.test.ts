import { describe, expect, it } from "vitest";
import { getCuratedFallback } from "../tools/search.js";

describe("getCuratedFallback", () => {
    it("returns curated results for any query", () => {
        const results = getCuratedFallback("test query");
        expect(results.length).toBeGreaterThan(0);
        expect(results[0]!.engine_used).toBe("curated_fallback");
        expect(results[0]!.confidence).toBe("low");
    });

    it("includes expected curated sources", () => {
        const results = getCuratedFallback("react hooks");
        const domains = results.map((r) => r.source_domain);
        expect(domains).toContain("duckduckgo.com");
        expect(domains).toContain("en.wikipedia.org");
        expect(domains).toContain("github.com");
        expect(domains).toContain("stackoverflow.com");
    });

    it("encodes query in URLs", () => {
        const results = getCuratedFallback("hello world");
        expect(results[0]!.url).toContain("hello%20world");
    });

    it("assigns sequential ranks", () => {
        const results = getCuratedFallback("test");
        for (let i = 0; i < results.length; i++) {
            expect(results[i]!.rank).toBe(i + 1);
        }
    });
});
