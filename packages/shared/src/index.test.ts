import { describe, expect, it } from "vitest";
import {
  CrawlRequestSchema,
  ExtractRequestSchema,
  JobCreateRequestSchema,
  RecipeSchema,
  SearchRequestSchema,
  StepSchema,
} from "./index.js";

describe("shared schemas", () => {
  it("validates a job request with defaults", () => {
    const parsed = JobCreateRequestSchema.parse({ url: "https://example.com" });
    expect(parsed.options.respectRobotsTxt).toBe(true);
    expect(parsed.options.browserEngine).toBe("chromium");
  });

  it("rejects invalid step payload", () => {
    const result = StepSchema.safeParse({ type: "click", args: {} });
    expect(result.success).toBe(false);
  });

  it("validates selectors extraction request", () => {
    const result = ExtractRequestSchema.safeParse({
      mode: "selectors",
      html: "<html><body><h1>Hello</h1></body></html>",
      selectors: { heading: "h1" },
    });
    expect(result.success).toBe(true);
  });

  it("validates crawl request defaults", () => {
    const parsed = CrawlRequestSchema.parse({ seed: "https://example.com" });
    expect(parsed.rules.maxDepth).toBe(1);
    expect(parsed.rules.sameDomainOnly).toBe(true);
  });

  it("validates recipe shape", () => {
    const parsed = RecipeSchema.parse({
      id: "example",
      name: "Example",
      version: "1.0.0",
      match: { patterns: ["example.com/**"] },
      requiresBrowser: false,
    });
    expect(parsed.id).toBe("example");
  });

  it("validates search request defaults", () => {
    const parsed = SearchRequestSchema.parse({ query: "example query" });
    expect(parsed.engine).toBe("duckduckgo");
    expect(parsed.limit).toBe(10);
    expect(parsed.safeSearch).toBe("moderate");
  });

  it("validates non-default search engines", () => {
    const parsed = SearchRequestSchema.parse({
      query: "example query",
      engine: "bing",
      limit: 5,
    });
    expect(parsed.engine).toBe("bing");
    expect(parsed.limit).toBe(5);
  });
});
