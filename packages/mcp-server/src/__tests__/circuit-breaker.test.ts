import { describe, expect, it, beforeEach } from "vitest";
import {
  shouldSkipEngine,
  recordEngineSuccess,
  recordEngineFailure,
  getEngineHealth,
  resetAllCircuits,
} from "../circuit-breaker.js";

describe("circuit-breaker", () => {
  beforeEach(() => {
    resetAllCircuits();
  });

  it("starts in closed state", () => {
    expect(shouldSkipEngine("bing")).toBe(false);
    expect(getEngineHealth("bing").state).toBe("closed");
  });

  it("opens after 3 consecutive failures", () => {
    recordEngineFailure("bing");
    recordEngineFailure("bing");
    expect(shouldSkipEngine("bing")).toBe(false); // still closed

    recordEngineFailure("bing");
    expect(getEngineHealth("bing").state).toBe("open");
    expect(shouldSkipEngine("bing")).toBe(true);
  });

  it("success resets consecutive failure count", () => {
    recordEngineFailure("bing");
    recordEngineFailure("bing");
    recordEngineSuccess("bing");
    recordEngineFailure("bing");
    // Only 1 consecutive failure after the success reset
    expect(getEngineHealth("bing").state).toBe("closed");
    expect(shouldSkipEngine("bing")).toBe(false);
  });

  it("records success correctly", () => {
    recordEngineSuccess("google");
    const health = getEngineHealth("google");
    expect(health.successes).toBe(1);
    expect(health.failures).toBe(0);
  });

  it("tracks multiple engines independently", () => {
    recordEngineFailure("bing");
    recordEngineFailure("bing");
    recordEngineFailure("bing");

    expect(shouldSkipEngine("bing")).toBe(true);
    expect(shouldSkipEngine("google")).toBe(false);
  });

  it("resetAllCircuits clears state", () => {
    recordEngineFailure("bing");
    recordEngineFailure("bing");
    recordEngineFailure("bing");
    expect(shouldSkipEngine("bing")).toBe(true);

    resetAllCircuits();
    expect(shouldSkipEngine("bing")).toBe(false);
  });
});
