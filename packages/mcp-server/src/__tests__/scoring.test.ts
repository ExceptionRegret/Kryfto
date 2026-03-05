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
  domainQueryRelevance,
  urlOfficialScore,
  noisePenalty,
  diversityPenalty,
} from "../scoring.js";

describe("scoring", () => {
  describe("getDomainWeight", () => {
    it("returns high weight for .gov domains", () => {
      expect(getDomainWeight("nist.gov")).toBe(150);
    });

    it("demotes noisy domains", () => {
      expect(getDomainWeight("geeksforgeeks.org")).toBe(-50);
      expect(getDomainWeight("stackoverflow.com")).toBe(-50);
      expect(getDomainWeight("youtube.com")).toBe(-50);
    });

    it("gives weight to docs. prefix", () => {
      expect(getDomainWeight("docs.somelib.io")).toBe(85);
    });

    it("gives weight to .org domains", () => {
      expect(getDomainWeight("nodejs.org")).toBe(70);
    });

    it("gives weight to universal authority platforms", () => {
      expect(getDomainWeight("developer.mozilla.org")).toBe(95);
      expect(getDomainWeight("github.com")).toBe(80);
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

    it("rejects noisy domains even with .org", () => {
      expect(isOfficialSource("geeksforgeeks.org")).toBe(false);
      expect(isOfficialSource("freecodecamp.org")).toBe(false);
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

    it("detects api_docs", () => {
      expect(analyzeIntent("openai api reference")).toBe("api_docs");
    });

    it("detects documentation", () => {
      expect(analyzeIntent("react docs")).toBe("documentation");
    });

    it("detects legal", () => {
      expect(analyzeIntent("gdpr compliance regulation")).toBe("legal");
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

    it("adds inurl: operator", () => {
      expect(buildSearchQuery("test", { inurl: "docs" })).toBe(
        "inurl:docs test"
      );
    });

    it("sanitizes injected search operators in site value", () => {
      const result = buildSearchQuery("test", { site: "evil.com site:bank.com" });
      expect(result).not.toContain("site:bank.com");
      expect(result).toContain("site:evil.com");
    });

    it("sanitizes injected search operators in exclude values", () => {
      const result = buildSearchQuery("test", { exclude: ["site:evil.com"] });
      expect(result).not.toContain("site:evil.com");
    });

    it("sanitizes injected search operators in inurl value", () => {
      const result = buildSearchQuery("test", { inurl: "filetype:pdf secret" });
      expect(result).not.toContain("filetype:pdf");
    });

    it("strips quotes and newlines from operator values", () => {
      const result = buildSearchQuery("test", { site: 'evil.com"\nsite:bank.com' });
      expect(result).not.toContain('"');
      expect(result).not.toContain("\n");
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

  describe("domainQueryRelevance", () => {
    it("matches domain containing query term", () => {
      expect(domainQueryRelevance("react.dev", "react hooks")).toBeGreaterThan(0);
      expect(domainQueryRelevance("kubernetes.io", "kubernetes deployment")).toBeGreaterThan(40);
    });

    it("matches short tech names via word boundary", () => {
      expect(domainQueryRelevance("go.dev", "go error handling")).toBe(100);
      expect(domainQueryRelevance("php.net", "php array functions")).toBe(100);
    });

    it("returns 0 for unrelated domains", () => {
      expect(domainQueryRelevance("random-blog.com", "kubernetes deployment")).toBe(0);
    });

    it("works for non-tech queries", () => {
      expect(domainQueryRelevance("mayoclinic.org", "mayo clinic heart disease")).toBeGreaterThan(0);
    });
  });

  describe("urlOfficialScore", () => {
    it("boosts .gov URLs", () => {
      expect(urlOfficialScore("https://nist.gov/docs/security", "nist.gov")).toBeGreaterThanOrEqual(40);
    });

    it("boosts docs subdomain URLs", () => {
      expect(urlOfficialScore("https://docs.docker.com/engine", "docs.docker.com")).toBeGreaterThan(0);
    });

    it("boosts URLs with /docs path", () => {
      expect(urlOfficialScore("https://example.com/docs/intro", "example.com")).toBeGreaterThan(0);
    });

    it("penalizes login/signup pages", () => {
      expect(urlOfficialScore("https://example.com/login", "example.com")).toBeLessThan(0);
    });
  });

  describe("noisePenalty", () => {
    it("heavily penalizes noisy domains for legal intent", () => {
      expect(noisePenalty("reddit.com", "legal")).toBe(-100);
    });

    it("allows noisy domains for troubleshooting", () => {
      expect(noisePenalty("stackoverflow.com", "troubleshooting")).toBe(0);
    });

    it("returns 0 for non-noisy domains", () => {
      expect(noisePenalty("nodejs.org", "documentation")).toBe(0);
    });
  });

  describe("diversityPenalty", () => {
    it("allows first 2 results from same domain", () => {
      const counts = new Map<string, number>();
      expect(diversityPenalty("example.com", counts)).toBe(0);
      expect(diversityPenalty("example.com", counts)).toBe(0);
    });

    it("penalizes 3rd+ result from same domain", () => {
      const counts = new Map<string, number>();
      diversityPenalty("example.com", counts); // 1st
      diversityPenalty("example.com", counts); // 2nd
      expect(diversityPenalty("example.com", counts)).toBe(-20); // 3rd
      expect(diversityPenalty("example.com", counts)).toBe(-40); // 4th
    });
  });
});
