import { describe, expect, it } from "vitest";
import {
  buildBingHtmlSearchUrl,
  buildBraveHtmlSearchUrl,
  buildDuckDuckGoSearchUrl,
  buildGoogleHtmlSearchUrl,
  buildYahooSearchUrl,
  parseBingApiSearchResults,
  parseBingHtmlSearchResults,
  parseBraveApiSearchResults,
  parseBraveHtmlSearchResults,
  parseDuckDuckGoSearchResults,
  parseGoogleCustomSearchResults,
  parseGoogleHtmlSearchResults,
  parseYahooSearchResults,
  safeSearchToBing,
  safeSearchToBrave,
  safeSearchToGoogle,
  resolveEngineRedirect,
  unwrapTrackingUrls,
} from "./search.js";

describe("search helpers", () => {
  it("maps safesearch modes", () => {
    expect(safeSearchToBing("strict")).toBe("Strict");
    expect(safeSearchToGoogle("off")).toBe("off");
    expect(safeSearchToBrave("moderate")).toBe("moderate");
  });

  it("builds provider URLs", () => {
    expect(
      buildDuckDuckGoSearchUrl({
        query: "test",
        safeSearch: "moderate",
        locale: "us-en",
      })
    ).toContain("duckduckgo");
    expect(
      buildBingHtmlSearchUrl({
        query: "test",
        safeSearch: "moderate",
        locale: "us-en",
      })
    ).toContain("bing.com");
    expect(
      buildYahooSearchUrl({
        query: "test",
        safeSearch: "moderate",
        locale: "us-en",
      })
    ).toContain("yahoo.com");
    expect(
      buildGoogleHtmlSearchUrl({
        query: "test",
        safeSearch: "moderate",
        locale: "us-en",
      })
    ).toContain("google.com");
    expect(
      buildBraveHtmlSearchUrl({
        query: "test",
        safeSearch: "moderate",
        locale: "us-en",
      })
    ).toContain("search.brave.com");
  });

  it("parses duckduckgo html results", () => {
    const html = `
      <div class="result">
        <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com">Example</a>
        <div class="result__snippet">Snippet</div>
      </div>
    `;
    const parsed = parseDuckDuckGoSearchResults(html, 5);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.url).toContain("example.com");
  });

  it("parses bing html results", () => {
    const html = `
      <li class="b_algo">
        <h2><a href="https://example.com">Example</a></h2>
        <div class="b_caption"><p>Snippet</p></div>
      </li>
    `;
    const parsed = parseBingHtmlSearchResults(html, 5);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.title).toBe("Example");
  });

  it("parses yahoo html results", () => {
    const html = `
      <div id="web">
        <ol>
          <li>
            <h3><a href="https://example.com">Example</a></h3>
            <p>Snippet</p>
          </li>
        </ol>
      </div>
    `;
    const parsed = parseYahooSearchResults(html, 5);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.title).toBe("Example");
  });

  it("parses google api payload", () => {
    const payload = {
      items: [
        { title: "Example", link: "https://example.com", snippet: "Snippet" },
      ],
    };
    const parsed = parseGoogleCustomSearchResults(payload, 5);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.url).toBe("https://example.com");
  });

  it("parses google html payload", () => {
    const html = `
      <div id="search">
        <div class="g">
          <a href="/url?q=https%3A%2F%2Fexample.com"><h3>Example</h3></a>
          <div class="VwiC3b">Snippet</div>
        </div>
      </div>
    `;
    const parsed = parseGoogleHtmlSearchResults(html, 5);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.url).toBe("https://example.com/");
  });

  it("parses bing api payload", () => {
    const payload = {
      webPages: {
        value: [
          { name: "Example", url: "https://example.com", snippet: "Snippet" },
        ],
      },
    };
    const parsed = parseBingApiSearchResults(payload, 5);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.title).toBe("Example");
  });

  it("parses brave api payload", () => {
    const payload = {
      web: {
        results: [
          {
            title: "Example",
            url: "https://example.com",
            description: "Snippet",
          },
        ],
      },
    };
    const parsed = parseBraveApiSearchResults(payload, 5);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.title).toBe("Example");
  });

  it("parses brave html payload", () => {
    const html = `
      <div class="snippet">
        <a class="heading-serpresult" href="https://example.com">Example</a>
        <div class="snippet-description">Snippet</div>
      </div>
    `;
    const parsed = parseBraveHtmlSearchResults(html, 5);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.url).toBe("https://example.com/");
  });
});

describe("resolveEngineRedirect", () => {
  it("resolves DuckDuckGo uddg redirect", () => {
    const url = "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage";
    const result = resolveEngineRedirect(url);
    expect(result).toContain("example.com/page");
    expect(result).not.toContain("duckduckgo");
  });

  it("resolves Yahoo RU redirect", () => {
    const url = "https://search.yahoo.com/r?RU=https%3A%2F%2Fexample.com%2Fdocs";
    const result = resolveEngineRedirect(url);
    expect(result).toContain("example.com/docs");
    expect(result).not.toContain("yahoo");
  });

  it("resolves Bing /ck/a redirect with base64", () => {
    const target = "https://example.com/test";
    const encoded = "a1" + Buffer.from(target).toString("base64");
    const url = `https://www.bing.com/ck/a?u=${encoded}`;
    const result = resolveEngineRedirect(url);
    expect(result).toContain("example.com/test");
  });

  it("resolves Google /url redirect", () => {
    const url = "https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fguide";
    const result = resolveEngineRedirect(url);
    expect(result).toContain("example.com/guide");
    expect(result).not.toContain("google.com");
  });

  it("passes through normal URLs unchanged", () => {
    const url = "https://react.dev/docs/hooks";
    expect(resolveEngineRedirect(url)).toBe("https://react.dev/docs/hooks");
  });

  it("handles empty/null input", () => {
    expect(resolveEngineRedirect("")).toBe("");
  });
});

describe("unwrapTrackingUrls", () => {
  it("removes utm_ params", () => {
    const url = "https://example.com/page?utm_source=test&utm_medium=email&real=1";
    const result = unwrapTrackingUrls(url);
    expect(result).not.toContain("utm_source");
    expect(result).not.toContain("utm_medium");
    expect(result).toContain("real=1");
  });

  it("removes fbclid", () => {
    const url = "https://example.com/page?fbclid=abc123";
    const result = unwrapTrackingUrls(url);
    expect(result).not.toContain("fbclid");
  });

  it("passes through clean URLs", () => {
    const url = "https://example.com/docs";
    expect(unwrapTrackingUrls(url)).toBe("https://example.com/docs");
  });
});
