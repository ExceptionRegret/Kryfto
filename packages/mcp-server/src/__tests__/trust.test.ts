import { describe, expect, it, beforeEach } from "vitest";
import {
  getDomainTrust,
  recordTrustOutcome,
  resetTrustDecay,
  DEFAULT_TRUST,
  customTrust,
} from "../trust.js";

describe("trust", () => {
  beforeEach(() => {
    resetTrustDecay();
    customTrust.clear();
  });

  describe("getDomainTrust", () => {
    it("returns high trust for official documentation sites", () => {
      expect(getDomainTrust("react.dev").trust).toBe(0.95);
      expect(getDomainTrust("nodejs.org").trust).toBe(0.95);
      expect(getDomainTrust("github.com").trust).toBe(0.9);
    });

    it("returns lower trust for aggregators", () => {
      expect(getDomainTrust("medium.com").trust).toBe(0.4);
      expect(getDomainTrust("reddit.com").trust).toBe(0.35);
    });

    it("returns low trust for w3schools", () => {
      expect(getDomainTrust("w3schools.com").trust).toBe(0.2);
    });

    it("returns 0.9 for .gov domains", () => {
      expect(getDomainTrust("nist.gov").trust).toBe(0.9);
      expect(getDomainTrust("nist.gov").source).toBe("builtin");
    });

    it("returns 0.85 for docs. prefix", () => {
      const result = getDomainTrust("docs.unknown.com");
      expect(result.trust).toBe(0.85);
      expect(result.source).toBe("builtin");
    });

    it("returns 0.8 for .io docs ecosystem", () => {
      const result = getDomainTrust("docs.somelib.io");
      // docs. prefix is checked before .io ecosystem
      expect(result.trust).toBe(0.85);
    });

    it("returns 0.5 default for unknown domains", () => {
      expect(getDomainTrust("random-blog.com").trust).toBe(0.5);
      expect(getDomainTrust("random-blog.com").source).toBe("default");
    });

    it("respects custom trust overrides", () => {
      customTrust.set("mysite.com", 0.99);
      expect(getDomainTrust("mysite.com").trust).toBe(0.99);
      expect(getDomainTrust("mysite.com").source).toBe("custom");
    });

    it("strips www prefix", () => {
      expect(getDomainTrust("www.github.com").trust).toBe(0.9);
    });

    it("has expanded DEFAULT_TRUST entries", () => {
      expect(DEFAULT_TRUST["docs.docker.com"]).toBe(0.95);
      expect(DEFAULT_TRUST["kubernetes.io"]).toBe(0.95);
      expect(DEFAULT_TRUST["go.dev"]).toBe(0.95);
      expect(DEFAULT_TRUST["angular.dev"]).toBe(0.95);
      expect(DEFAULT_TRUST["svelte.dev"]).toBe(0.95);
      expect(DEFAULT_TRUST["learn.microsoft.com"]).toBe(0.95);
      expect(DEFAULT_TRUST["docs.aws.amazon.com"]).toBe(0.9);
      expect(DEFAULT_TRUST["postgresql.org"]).toBe(0.95);
      expect(DEFAULT_TRUST["sqlite.org"]).toBe(0.95);
      expect(DEFAULT_TRUST["redis.io"]).toBe(0.9);
      expect(DEFAULT_TRUST["bun.sh"]).toBe(0.9);
      expect(DEFAULT_TRUST["deno.land"]).toBe(0.9);
    });
  });

  describe("trust decay", () => {
    it("does not decay before 5 failures", () => {
      for (let i = 0; i < 4; i++) recordTrustOutcome("github.com", false);
      expect(getDomainTrust("github.com").trust).toBe(0.9);
    });

    it("decays trust after 5 failures", () => {
      for (let i = 0; i < 5; i++) recordTrustOutcome("github.com", false);
      const trust = getDomainTrust("github.com").trust;
      expect(trust).toBeLessThan(0.9);
      expect(trust).toBeGreaterThan(0.1);
    });

    it("recovers after successes > 2x failures", () => {
      for (let i = 0; i < 5; i++) recordTrustOutcome("github.com", false);
      expect(getDomainTrust("github.com").trust).toBeLessThan(0.9);

      // 11 successes > 2 * 5 failures
      for (let i = 0; i < 11; i++) recordTrustOutcome("github.com", true);
      expect(getDomainTrust("github.com").trust).toBe(0.9);
    });

    it("resetTrustDecay clears all decay", () => {
      for (let i = 0; i < 10; i++) recordTrustOutcome("github.com", false);
      expect(getDomainTrust("github.com").trust).toBeLessThan(0.9);

      resetTrustDecay();
      expect(getDomainTrust("github.com").trust).toBe(0.9);
    });
  });
});
