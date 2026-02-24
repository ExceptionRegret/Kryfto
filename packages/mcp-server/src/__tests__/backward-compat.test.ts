import { describe, expect, it } from "vitest";

/**
 * Backward compatibility tests.
 * These verify that public module exports and response shapes remain stable
 * across upgrades, preventing silent breaks in accuracy or replayability.
 */

describe("backward-compat: scoring module exports", () => {
  it("exports all required scoring functions", async () => {
    const mod = await import("../scoring.js");
    expect(typeof mod.getDomainWeight).toBe("function");
    expect(typeof mod.isOfficialSource).toBe("function");
    expect(typeof mod.isStrictOfficialSource).toBe("function");
    expect(typeof mod.analyzeIntent).toBe("function");
    expect(typeof mod.isRecencyQuery).toBe("function");
    expect(typeof mod.buildSearchQuery).toBe("function");
    expect(typeof mod.extractQueryTerms).toBe("function");
    expect(typeof mod.snippetOverlapBonus).toBe("function");
    expect(typeof mod.titleMatchBonus).toBe("function");
    expect(typeof mod.authorityBonus).toBe("function");
  });

  it("TECH_DOMAIN_WEIGHTS is a plain object with number values", async () => {
    const { TECH_DOMAIN_WEIGHTS } = await import("../scoring.js");
    expect(typeof TECH_DOMAIN_WEIGHTS).toBe("object");
    for (const [key, val] of Object.entries(TECH_DOMAIN_WEIGHTS)) {
      expect(typeof key).toBe("string");
      expect(typeof val).toBe("number");
    }
  });

  it("analyzeIntent returns one of the 4 known intents", async () => {
    const { analyzeIntent } = await import("../scoring.js");
    const valid = ["troubleshooting", "documentation", "news", "general"];
    expect(valid).toContain(analyzeIntent("hello"));
    expect(valid).toContain(analyzeIntent("fix error"));
    expect(valid).toContain(analyzeIntent("docs api"));
    expect(valid).toContain(analyzeIntent("latest news"));
  });
});

describe("backward-compat: trust module exports", () => {
  it("exports all required trust functions", async () => {
    const mod = await import("../trust.js");
    expect(typeof mod.getDomainTrust).toBe("function");
    expect(typeof mod.recordTrustOutcome).toBe("function");
    expect(typeof mod.resetTrustDecay).toBe("function");
    expect(typeof mod.getTrustDecayFactor).toBe("function");
    expect(typeof mod.DEFAULT_TRUST).toBe("object");
    expect(mod.customTrust instanceof Map).toBe(true);
  });

  it("getDomainTrust returns correct shape", async () => {
    const { getDomainTrust } = await import("../trust.js");
    const result = getDomainTrust("example.com");
    expect(typeof result.domain).toBe("string");
    expect(typeof result.trust).toBe("number");
    expect(result.trust).toBeGreaterThanOrEqual(0);
    expect(result.trust).toBeLessThanOrEqual(1);
    expect(["custom", "builtin", "ecosystem", "default"]).toContain(
      result.source
    );
  });
});

describe("backward-compat: circuit-breaker module exports", () => {
  it("exports all required circuit-breaker functions", async () => {
    const mod = await import("../circuit-breaker.js");
    expect(typeof mod.shouldSkipEngine).toBe("function");
    expect(typeof mod.recordEngineSuccess).toBe("function");
    expect(typeof mod.recordEngineFailure).toBe("function");
    expect(typeof mod.getEngineHealth).toBe("function");
    expect(typeof mod.resetAllCircuits).toBe("function");
  });

  it("getEngineHealth returns correct shape", async () => {
    const { getEngineHealth, resetAllCircuits } = await import(
      "../circuit-breaker.js"
    );
    resetAllCircuits();
    const health = getEngineHealth("test-engine");
    expect(typeof health.failures).toBe("number");
    expect(typeof health.successes).toBe("number");
    expect(typeof health.consecutiveFailures).toBe("number");
    expect(["closed", "open", "half_open"]).toContain(health.state);
  });
});

describe("backward-compat: url-utils module exports", () => {
  it("exports all required url-utils functions", async () => {
    const mod = await import("../url-utils.js");
    expect(typeof mod.normalizeUrl).toBe("function");
    expect(typeof mod.extractDomain).toBe("function");
    expect(typeof mod.isDomainAllowed).toBe("function");
    expect(typeof mod.isUrlAllowed).toBe("function");
    expect(mod.HARD_BLOCK_DOMAINS instanceof Set).toBe(true);
  });
});

describe("backward-compat: trace module exports", () => {
  it("exports all required trace functions", async () => {
    const mod = await import("../trace.js");
    expect(typeof mod.createTrace).toBe("function");
    expect(typeof mod.startSpan).toBe("function");
    expect(typeof mod.endSpan).toBe("function");
    expect(typeof mod.finalizeTrace).toBe("function");
  });
});
