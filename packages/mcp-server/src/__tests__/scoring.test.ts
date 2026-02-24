import { describe, expect, it } from "vitest";
import {
  getDomainWeight,
  isOfficialSource,
  isStrictOfficialSource,
  analyzeIntent,
  isRecencyQuery,
  buildSearchQuery,
  extractQueryTerms,
  snippetOverlapBonus,
  titleMatchBonus,
  authorityBonus,
} from "../scoring.js";

describe("scoring", () => {
  describe("getDomainWeight", () => {
    it("returns high weight for known tech domains", () => {
      expect(getDomainWeight("react.dev")).toBe(100);
      expect(getDomainWeight("nodejs.org")).toBe(100);
    });

    it("demotes geeksforgeeks", () => {
      expect(getDomainWeight("geeksforgeeks.org")).toBe(-50);
    });

    it("gives high weight to .gov domains", () => {
      expect(getDomainWeight("nist.gov")).toBe(150);
    });

    it("gives weight to docs. prefix", () => {
      expect(getDomainWeight("docs.somelib.io")).toBe(85);
    });

    it("returns 30 for unknown domains", () => {
      expect(getDomainWeight("random-blog.com")).toBe(30);
    });
  });

  describe("isOfficialSource", () => {
    it("recognizes .org domains", () => {
      expect(isOfficialSource("nodejs.org")).toBe(true);
    });

    it("recognizes docs. prefix", () => {
      expect(isOfficialSource("docs.example.com")).toBe(true);
    });

    it("recognizes github.com", () => {
      expect(isOfficialSource("github.com")).toBe(true);
    });

    it("rejects random .com", () => {
      expect(isOfficialSource("random.com")).toBe(false);
    });
  });

  describe("isStrictOfficialSource", () => {
    it("rejects stackoverflow", () => {
      expect(isStrictOfficialSource("stackoverflow.com")).toBe(false);
    });

    it("rejects reddit", () => {
      expect(isStrictOfficialSource("reddit.com")).toBe(false);
    });

    it("rejects engine wrapper domains", () => {
      expect(isStrictOfficialSource("bing.com")).toBe(false);
      expect(isStrictOfficialSource("google.com")).toBe(false);
      expect(isStrictOfficialSource("duckduckgo.com")).toBe(false);
      expect(isStrictOfficialSource("yahoo.com")).toBe(false);
      expect(isStrictOfficialSource("brave.com")).toBe(false);
    });

    it("accepts official .org domains", () => {
      expect(isStrictOfficialSource("nodejs.org")).toBe(true);
    });
  });

  describe("analyzeIntent", () => {
    it("detects troubleshooting", () => {
      expect(analyzeIntent("fix react error")).toBe("troubleshooting");
    });

    it("detects documentation", () => {
      expect(analyzeIntent("react docs api reference")).toBe("documentation");
    });

    it("detects news", () => {
      expect(analyzeIntent("latest react release")).toBe("news");
    });

    it("returns general for ambiguous", () => {
      expect(analyzeIntent("react patterns")).toBe("general");
    });
  });

  describe("isRecencyQuery", () => {
    it("detects latest", () => {
      expect(isRecencyQuery("latest react features")).toBe(true);
    });

    it("detects year", () => {
      expect(isRecencyQuery("python changes 2025")).toBe(true);
    });

    it("returns false for non-recency", () => {
      expect(isRecencyQuery("how to use useState")).toBe(false);
    });
  });

  describe("buildSearchQuery", () => {
    it("adds site: operator", () => {
      expect(buildSearchQuery("test", { site: "react.dev" })).toBe(
        "site:react.dev test"
      );
    });

    it("adds exclude operators", () => {
      expect(buildSearchQuery("test", { exclude: ["ads", "spam"] })).toBe(
        "test -ads -spam"
      );
    });
  });

  describe("reranker signals", () => {
    it("extractQueryTerms filters short and stop words", () => {
      const terms = extractQueryTerms("how to use the React hook");
      expect(terms).toContain("use");
      expect(terms).toContain("react");
      expect(terms).toContain("hook");
      expect(terms).not.toContain("the");
      expect(terms).not.toContain("to");
    });

    it("snippetOverlapBonus returns max 25", () => {
      const terms = ["react", "hook"];
      expect(snippetOverlapBonus("React hook usage guide", terms)).toBe(25);
    });

    it("snippetOverlapBonus returns 0 for no match", () => {
      expect(snippetOverlapBonus("unrelated content", ["react"])).toBe(0);
    });

    it("snippetOverlapBonus returns 0 for undefined snippet", () => {
      expect(snippetOverlapBonus(undefined, ["react"])).toBe(0);
    });

    it("titleMatchBonus returns max 20", () => {
      const terms = ["react", "hook"];
      expect(titleMatchBonus("React Hook Guide", terms)).toBe(20);
    });

    it("authorityBonus returns 40 for docs domain with documentation intent", () => {
      expect(authorityBonus("docs.example.com", "documentation")).toBe(40);
      expect(authorityBonus("developer.mozilla.org", "documentation")).toBe(40);
    });

    it("authorityBonus returns 0 for non-documentation intent", () => {
      expect(authorityBonus("docs.example.com", "general")).toBe(0);
    });
  });
});
