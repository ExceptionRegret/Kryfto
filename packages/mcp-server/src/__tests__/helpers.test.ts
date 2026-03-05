import { describe, expect, it } from "vitest";
import {
    classifyError,
    classifyEngineError,
    extractDateFromText,
    extractDateFromHtml,
    extractSections,
    asText,
    asError,
} from "../helpers.js";

describe("classifyError", () => {
    it("classifies ECONNREFUSED as network_error with helpful message", () => {
        const result = classifyError(new Error("connect ECONNREFUSED 127.0.0.1:8080"));
        expect(result.error).toBe("network_error");
        expect(result.message).toContain("Cannot connect to Kryfto API");
        expect(result.message).toContain("is the server running?");
    });

    it("classifies ENOTFOUND as network_error with DNS message", () => {
        const result = classifyError(new Error("getaddrinfo ENOTFOUND api.example.com"));
        expect(result.error).toBe("network_error");
        expect(result.message).toContain("DNS resolution failed");
    });

    it("classifies 403 as blocked", () => {
        const result = classifyError(new Error("HTTP 403 Forbidden"));
        expect(result.error).toBe("blocked");
    });

    it("classifies 429 as rate_limited", () => {
        const result = classifyError(new Error("HTTP 429 Too Many Requests"));
        expect(result.error).toBe("rate_limited");
        expect(result.message).toContain("Try again");
    });

    it("classifies 404 as not_found", () => {
        const result = classifyError(new Error("HTTP 404"));
        expect(result.error).toBe("not_found");
    });

    it("classifies timeout errors", () => {
        const result = classifyError(new Error("Request timeout after 30000ms"));
        expect(result.error).toBe("timeout");
        expect(result.message).toContain("timeoutMs");
    });

    it("classifies JSON parse errors", () => {
        const result = classifyError(new Error("Unexpected token in JSON"));
        expect(result.error).toBe("parse_failed");
    });

    it("classifies unknown errors", () => {
        const result = classifyError(new Error("something unexpected"));
        expect(result.error).toBe("unknown");
    });

    it("handles non-Error objects", () => {
        const result = classifyError("string error");
        expect(result.error).toBe("unknown");
        expect(result.message).toBe("string error");
    });
});

describe("classifyEngineError", () => {
    it("classifies DNS errors", () => {
        expect(classifyEngineError(new Error("getaddrinfo ENOTFOUND"))).toBe("dns");
    });

    it("classifies TLS errors", () => {
        expect(classifyEngineError(new Error("ERR_TLS_CERT_INVALID"))).toBe("tls");
    });

    it("classifies timeout errors", () => {
        expect(classifyEngineError(new Error("AbortError: timeout"))).toBe("timeout");
    });

    it("classifies network errors", () => {
        expect(classifyEngineError(new Error("ECONNREFUSED"))).toBe("network");
    });

    it("classifies 4xx HTTP errors", () => {
        expect(classifyEngineError(new Error("403 forbidden"))).toBe("http_4xx");
    });

    it("classifies 5xx HTTP errors", () => {
        expect(classifyEngineError(new Error("500 internal server error"))).toBe("http_5xx");
    });
});

describe("extractDateFromText", () => {
    it("extracts ISO dates", () => {
        expect(extractDateFromText("Published on 2024-03-15")).toBe("2024-03-15");
    });

    it("extracts long month dates", () => {
        expect(extractDateFromText("January 5, 2024")).toBe("2024-01-05");
    });

    it("extracts short month dates", () => {
        expect(extractDateFromText("Mar 15, 2024")).toBe("2024-03-15");
    });

    it("extracts day-first short month dates", () => {
        expect(extractDateFromText("15 Mar 2024")).toBe("2024-03-15");
    });

    it("returns undefined for no date", () => {
        expect(extractDateFromText("no date here")).toBeUndefined();
    });
});

describe("extractDateFromHtml", () => {
    it("extracts from meta tags (high confidence)", () => {
        const html = '<meta property="article:published_time" content="2024-03-15T10:00:00Z">';
        const result = extractDateFromHtml(html);
        expect(result.date).toBe("2024-03-15");
        expect(result.confidence).toBe("high");
        expect(result.source).toBe("meta");
    });

    it("extracts from JSON-LD (high confidence)", () => {
        const html = '{"datePublished": "2024-06-01T12:00:00Z"}';
        const result = extractDateFromHtml(html);
        expect(result.date).toBe("2024-06-01");
        expect(result.confidence).toBe("high");
        expect(result.source).toBe("jsonld");
    });

    it("extracts from <time> element (medium confidence)", () => {
        const html = '<time datetime="2024-01-20T08:00:00">Jan 20</time>';
        const result = extractDateFromHtml(html);
        expect(result.date).toBe("2024-01-20");
        expect(result.confidence).toBe("medium");
    });

    it("returns low confidence when no date found", () => {
        const result = extractDateFromHtml("<p>No date info here</p>");
        expect(result.date).toBeUndefined();
        expect(result.confidence).toBe("low");
    });
});

describe("extractSections", () => {
    it("extracts headings", () => {
        const html = "<h1>Title</h1><h2>Subtitle</h2><p>Body</p>";
        const result = extractSections(html);
        expect(result.headings).toEqual(["Title", "Subtitle"]);
    });

    it("extracts code blocks", () => {
        const html = "<pre>const x = 1;</pre><code>foo()</code>";
        const result = extractSections(html);
        expect(result.codeBlocks.length).toBe(2);
    });

    it("extracts links", () => {
        const html = '<a href="https://example.com">Example</a>';
        const result = extractSections(html);
        expect(result.links).toEqual([{ text: "Example", href: "https://example.com" }]);
    });

    it("counts words", () => {
        const html = "<p>Hello world this is a test</p>";
        const result = extractSections(html);
        expect(result.wordCount).toBeGreaterThan(0);
    });
});

describe("asText", () => {
    it("returns MCP-formatted text response", () => {
        const result = asText({ foo: "bar" });
        expect(result.content).toHaveLength(1);
        expect(result.content[0]!.type).toBe("text");
        const parsed = JSON.parse(result.content[0]!.text);
        expect(parsed.foo).toBe("bar");
        expect(parsed._meta).toBeDefined();
        expect(parsed._meta.serverVersion).toBeDefined();
    });
});

describe("asError", () => {
    it("returns MCP-formatted error response", () => {
        const result = asError("timeout", "Request timed out");
        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(result.content[0]!.text);
        expect(parsed.error).toBe("timeout");
        expect(parsed.message).toBe("Request timed out");
    });
});
