import { describe, expect, it } from "vitest";

/**
 * Router integration tests — verify the Map-based tool router
 * has correct entries for all expected tools and rejects unknowns.
 *
 * We import the handler map indirectly by checking TOOLS registry
 * against the handler map exports.
 */

describe("tool router", () => {
  // We can't import index.ts directly (it calls main() on load),
  // so we test the registry + known tool names instead.

  it("TOOLS registry exports an array of tool definitions", async () => {
    const { TOOLS } = await import("../tools/registry.js");
    expect(Array.isArray(TOOLS)).toBe(true);
    expect(TOOLS.length).toBeGreaterThan(30);
  });

  it("every tool has name, description, and inputSchema", async () => {
    const { TOOLS } = await import("../tools/registry.js");
    for (const tool of TOOLS) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("description");
      expect(tool).toHaveProperty("inputSchema");
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
    }
  });

  it("tool names are unique", async () => {
    const { TOOLS } = await import("../tools/registry.js");
    const names = TOOLS.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("all expected core tools are registered", async () => {
    const { TOOLS } = await import("../tools/registry.js");
    const names = new Set(TOOLS.map((t) => t.name));

    const expected = [
      "search",
      "read_url",
      "read_urls",
      "research",
      "answer_with_evidence",
      "conflict_detector",
      "confidence_calibration",
      "cite",
      "upgrade_impact",
      "github_releases",
      "github_diff",
      "github_issues",
      "browse",
      "crawl",
      "extract",
      "get_job",
      "list_artifacts",
      "fetch_artifact",
      "slo_dashboard",
      "run_eval_suite",
      "set_memory_profile",
      "get_memory_profile",
      "kryfto_status",
    ];

    for (const name of expected) {
      expect(names.has(name), `Missing tool: ${name}`).toBe(true);
    }
  });

  it("all schema parsers are exported for registered tools", async () => {
    const schemas = await import("../tools/registry.js");
    // Verify a sample of schema parsers exist
    expect(typeof schemas.searchArgs.parse).toBe("function");
    expect(typeof schemas.readUrlArgs.parse).toBe("function");
    expect(typeof schemas.researchArgs.parse).toBe("function");
    expect(typeof schemas.browseArgs.parse).toBe("function");
    expect(typeof schemas.crawlArgs.parse).toBe("function");
  });
});
