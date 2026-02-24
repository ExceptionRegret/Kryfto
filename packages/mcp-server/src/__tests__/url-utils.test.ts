import { describe, expect, it } from "vitest";
import {
  normalizeUrl,
  extractDomain,
  isDomainAllowed,
  isUrlAllowed,
  HARD_BLOCK_DOMAINS,
} from "../url-utils.js";

describe("url-utils", () => {
  describe("normalizeUrl", () => {
    it("strips www prefix", () => {
      expect(normalizeUrl("https://www.example.com/page")).toBe(
        "https://example.com/page"
      );
    });

    it("removes tracking params", () => {
      expect(
        normalizeUrl("https://example.com/page?utm_source=test&fbclid=123")
      ).toBe("https://example.com/page");
    });

    it("strips trailing slash", () => {
      expect(normalizeUrl("https://example.com/page/")).toBe(
        "https://example.com/page"
      );
    });

    it("returns root slash for bare domain", () => {
      expect(normalizeUrl("https://example.com")).toBe(
        "https://example.com/"
      );
    });

    it("returns input for invalid URL", () => {
      expect(normalizeUrl("not-a-url")).toBe("not-a-url");
    });
  });

  describe("extractDomain", () => {
    it("extracts domain without www", () => {
      expect(extractDomain("https://www.example.com/path")).toBe(
        "example.com"
      );
    });

    it("returns empty for invalid URL", () => {
      expect(extractDomain("not-a-url")).toBe("");
    });
  });

  describe("HARD_BLOCK_DOMAINS", () => {
    it("contains expected domains", () => {
      expect(HARD_BLOCK_DOMAINS.has("w3schools.com")).toBe(true);
      expect(HARD_BLOCK_DOMAINS.has("pinterest.com")).toBe(true);
      expect(HARD_BLOCK_DOMAINS.has("quora.com")).toBe(true);
      expect(HARD_BLOCK_DOMAINS.has("chegg.com")).toBe(true);
    });

    it("does not block legitimate domains", () => {
      expect(HARD_BLOCK_DOMAINS.has("github.com")).toBe(false);
      expect(HARD_BLOCK_DOMAINS.has("react.dev")).toBe(false);
    });
  });

  describe("isDomainAllowed", () => {
    const emptySet = new Set<string>();

    it("blocks hard-blocked domains", () => {
      expect(isDomainAllowed("w3schools.com", emptySet, emptySet)).toBe(false);
      expect(isDomainAllowed("pinterest.com", emptySet, emptySet)).toBe(false);
    });

    it("allows normal domains", () => {
      expect(isDomainAllowed("github.com", emptySet, emptySet)).toBe(true);
    });

    it("respects user blocklist", () => {
      const blocklist = new Set(["blocked.com"]);
      expect(isDomainAllowed("blocked.com", blocklist, emptySet)).toBe(false);
    });

    it("respects allowlist when non-empty", () => {
      const allowlist = new Set(["allowed.com"]);
      expect(isDomainAllowed("other.com", emptySet, allowlist)).toBe(false);
      expect(isDomainAllowed("allowed.com", emptySet, allowlist)).toBe(true);
    });
  });

  describe("isUrlAllowed", () => {
    const emptySet = new Set<string>();

    it("blocks login pages", () => {
      expect(
        isUrlAllowed("https://example.com/login", "example.com", emptySet, emptySet)
      ).toBe(false);
    });

    it("blocks signup pages", () => {
      expect(
        isUrlAllowed("https://example.com/signup", "example.com", emptySet, emptySet)
      ).toBe(false);
    });

    it("blocks register pages", () => {
      expect(
        isUrlAllowed("https://example.com/register", "example.com", emptySet, emptySet)
      ).toBe(false);
    });

    it("blocks privacy-policy pages", () => {
      expect(
        isUrlAllowed("https://example.com/privacy-policy", "example.com", emptySet, emptySet)
      ).toBe(false);
    });

    it("blocks terms-of-service pages", () => {
      expect(
        isUrlAllowed("https://example.com/terms-of-service", "example.com", emptySet, emptySet)
      ).toBe(false);
    });

    it("blocks cookie consent pages", () => {
      expect(
        isUrlAllowed("https://example.com/cookie", "example.com", emptySet, emptySet)
      ).toBe(false);
    });

    it("allows normal pages", () => {
      expect(
        isUrlAllowed("https://example.com/docs/api", "example.com", emptySet, emptySet)
      ).toBe(true);
    });

    it("blocks hard-blocked domains via URL", () => {
      expect(
        isUrlAllowed("https://w3schools.com/html", "w3schools.com", emptySet, emptySet)
      ).toBe(false);
    });
  });
});
