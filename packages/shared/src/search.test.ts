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
    expect(parsed[0]?.url).toBe("https://example.com");
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
    expect(parsed[0]?.url).toBe("https://example.com");
  });
});
