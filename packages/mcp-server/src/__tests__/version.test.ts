import { describe, expect, it } from "vitest";
import {
  SERVER_VERSION,
  EVAL_SCHEMA_VERSION,
  RERANKER_VERSION,
  TRUST_RULES_VERSION,
  versionStamp,
} from "../version.js";

describe("version", () => {
  it("exports valid semver SERVER_VERSION", () => {
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exports EVAL_SCHEMA_VERSION", () => {
    expect(EVAL_SCHEMA_VERSION).toBeTruthy();
    expect(EVAL_SCHEMA_VERSION.startsWith("v")).toBe(true);
  });

  it("exports RERANKER_VERSION", () => {
    expect(RERANKER_VERSION).toBeTruthy();
  });

  it("exports TRUST_RULES_VERSION", () => {
    expect(TRUST_RULES_VERSION).toBeTruthy();
  });

  it("versionStamp returns all version fields", () => {
    const stamp = versionStamp();
    expect(stamp.serverVersion).toBe(SERVER_VERSION);
    expect(stamp.evalSchema).toBe(EVAL_SCHEMA_VERSION);
    expect(stamp.rerankerVersion).toBe(RERANKER_VERSION);
    expect(stamp.trustRulesVersion).toBe(TRUST_RULES_VERSION);
  });

  describe("backward-compat: response schema shape", () => {
    it("versionStamp always includes serverVersion field", () => {
      const stamp = versionStamp();
      expect("serverVersion" in stamp).toBe(true);
      expect(typeof stamp.serverVersion).toBe("string");
    });

    it("versionStamp always includes evalSchema field", () => {
      const stamp = versionStamp();
      expect("evalSchema" in stamp).toBe(true);
    });

    it("versionStamp always includes rerankerVersion field", () => {
      const stamp = versionStamp();
      expect("rerankerVersion" in stamp).toBe(true);
    });

    it("versionStamp always includes trustRulesVersion field", () => {
      const stamp = versionStamp();
      expect("trustRulesVersion" in stamp).toBe(true);
    });

    it("SERVER_VERSION is >= 3.2.0", () => {
      const [major, minor] = SERVER_VERSION.split(".").map(Number);
      expect(major).toBeGreaterThanOrEqual(3);
      if (major === 3) expect(minor).toBeGreaterThanOrEqual(2);
    });
  });

  describe("backward-compat: eval suite naming", () => {
    it("eval suite name follows kryfto-eval-{version} format", () => {
      const suiteName = `kryfto-eval-${EVAL_SCHEMA_VERSION}`;
      expect(suiteName).toMatch(/^kryfto-eval-v\d+$/);
    });
  });
});
