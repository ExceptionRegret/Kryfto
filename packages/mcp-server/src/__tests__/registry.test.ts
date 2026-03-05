import { describe, expect, it } from "vitest";
import { TOOLS, searchArgs, readUrlArgs, browseArgs, crawlArgs, extractArgs } from "../tools/registry.js";

describe("TOOLS registry", () => {
    it("exports a non-empty TOOLS array", () => {
        expect(Array.isArray(TOOLS)).toBe(true);
        expect(TOOLS.length).toBeGreaterThan(30);
    });

    it("every tool has name, description, and inputSchema", () => {
        for (const tool of TOOLS) {
            expect(tool.name).toBeDefined();
            expect(typeof tool.name).toBe("string");
            expect(tool.description).toBeDefined();
            expect(typeof tool.description).toBe("string");
            expect(tool.inputSchema).toBeDefined();
            expect(tool.inputSchema.type).toBe("object");
        }
    });

    it("has no duplicate tool names", () => {
        const names = TOOLS.map((t) => t.name);
        const unique = new Set(names);
        expect(unique.size).toBe(names.length);
    });

    it("includes the kryfto_status health check tool", () => {
        const status = TOOLS.find((t) => t.name === "kryfto_status");
        expect(status).toBeDefined();
        expect(status!.description).toContain("health check");
    });

    it("includes all core tools", () => {
        const names = new Set(TOOLS.map((t) => t.name));
        const required = [
            "search", "read_url", "read_urls", "research",
            "answer_with_evidence", "conflict_detector",
            "github_releases", "github_diff", "github_issues",
            "browse", "crawl", "extract",
            "slo_dashboard", "run_eval_suite",
            "kryfto_status",
        ];
        for (const name of required) {
            expect(names.has(name)).toBe(true);
        }
    });
});

describe("Zod schemas", () => {
    it("searchArgs validates correctly", () => {
        const result = searchArgs.parse({ query: "test" });
        expect(result.query).toBe("test");
    });

    it("searchArgs rejects empty query", () => {
        expect(() => searchArgs.parse({ query: "" })).toThrow();
    });

    it("readUrlArgs validates URL", () => {
        const result = readUrlArgs.parse({ url: "https://example.com" });
        expect(result.url).toBe("https://example.com");
    });

    it("readUrlArgs rejects invalid URL", () => {
        expect(() => readUrlArgs.parse({ url: "not-a-url" })).toThrow();
    });

    it("browseArgs validates", () => {
        const result = browseArgs.parse({ url: "https://example.com" });
        expect(result.url).toBe("https://example.com");
    });

    it("crawlArgs validates seed URL", () => {
        const result = crawlArgs.parse({ seed: "https://example.com" });
        expect(result.seed).toBe("https://example.com");
    });

    it("extractArgs validates mode", () => {
        const result = extractArgs.parse({ mode: "selectors" });
        expect(result.mode).toBe("selectors");
    });

    it("extractArgs rejects invalid mode", () => {
        expect(() => extractArgs.parse({ mode: "invalid" })).toThrow();
    });
});
