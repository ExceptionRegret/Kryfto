import { describe, expect, it } from "vitest";
import { buildSearchQuery } from "../scoring.js";

describe("search query sanitization", () => {
  it("prevents site: operator injection via site param", () => {
    const q = buildSearchQuery("react hooks", { site: "evil.com site:bank.com" });
    // Should contain the intended site: prefix
    expect(q).toMatch(/^site:/);
    // Should NOT allow a second injected site: operator
    const siteCount = (q.match(/site:/g) ?? []).length;
    expect(siteCount).toBe(1);
  });

  it("prevents filetype: injection via inurl param", () => {
    const q = buildSearchQuery("docs", { inurl: "filetype:exe" });
    expect(q).not.toContain("filetype:");
  });

  it("prevents intitle: injection via exclude param", () => {
    const q = buildSearchQuery("test", { exclude: ["intitle:admin"] });
    expect(q).not.toContain("intitle:");
  });

  it("prevents cache: injection", () => {
    const q = buildSearchQuery("test", { site: "cache:example.com" });
    expect(q).not.toContain("cache:");
  });

  it("prevents related: injection", () => {
    const q = buildSearchQuery("test", { inurl: "related:example.com" });
    expect(q).not.toContain("related:");
  });

  it("prevents intext: injection", () => {
    const q = buildSearchQuery("test", { exclude: ["intext:password"] });
    expect(q).not.toContain("intext:");
  });

  it("strips double quotes from operator values", () => {
    const q = buildSearchQuery("test", { site: '"evil.com"' });
    expect(q).not.toContain('"');
  });

  it("strips newlines from operator values", () => {
    const q = buildSearchQuery("test", { site: "evil.com\nsite:bank.com" });
    expect(q).not.toContain("\n");
  });

  it("passes clean values through unchanged", () => {
    const q = buildSearchQuery("react docs", {
      site: "react.dev",
      inurl: "api",
      exclude: ["w3schools.com", "medium.com"],
    });
    expect(q).toBe("inurl:api site:react.dev react docs -w3schools.com -medium.com");
  });

  it("handles empty/undefined opts gracefully", () => {
    expect(buildSearchQuery("hello")).toBe("hello");
    expect(buildSearchQuery("hello", {})).toBe("hello");
    expect(buildSearchQuery("hello", { site: undefined })).toBe("hello");
  });
});
