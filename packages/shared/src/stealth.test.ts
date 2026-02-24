import { describe, expect, it, beforeEach } from "vitest";
import {
  UA_POOL,
  getRandomUA,
  getStealthHeaders,
  getStealthJsonHeaders,
  detectBrowserFamily,
  engineDelay,
  resetEngineDelays,
  SimpleCookieJar,
} from "./stealth.js";

describe("stealth: UA pool", () => {
  it("has at least 14 user agents", () => {
    expect(UA_POOL.length).toBeGreaterThanOrEqual(14);
  });

  it("all UAs are non-empty strings", () => {
    for (const ua of UA_POOL) {
      expect(typeof ua).toBe("string");
      expect(ua.length).toBeGreaterThan(20);
    }
  });

  it("getRandomUA returns a string from the pool", () => {
    for (let i = 0; i < 50; i++) {
      const ua = getRandomUA();
      expect(UA_POOL).toContain(ua);
    }
  });

  it("getRandomUA rotates (not always the same)", () => {
    const uas = new Set<string>();
    for (let i = 0; i < 100; i++) {
      uas.add(getRandomUA());
    }
    // Should get at least 3 different UAs in 100 draws
    expect(uas.size).toBeGreaterThanOrEqual(3);
  });
});

describe("stealth: browser family detection", () => {
  it("detects Chrome", () => {
    expect(
      detectBrowserFamily(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
      )
    ).toBe("chrome");
  });

  it("detects Firefox", () => {
    expect(
      detectBrowserFamily(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0"
      )
    ).toBe("firefox");
  });

  it("detects Safari", () => {
    expect(
      detectBrowserFamily(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15"
      )
    ).toBe("safari");
  });

  it("detects Edge", () => {
    expect(
      detectBrowserFamily(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0"
      )
    ).toBe("edge");
  });
});

describe("stealth: getStealthHeaders", () => {
  const chromeUA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
  const firefoxUA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0";
  const safariUA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15";
  const edgeUA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0";

  it("Chrome headers include Sec-Ch-Ua and Sec-Fetch-*", () => {
    const h = getStealthHeaders("google", chromeUA);
    expect(h["User-Agent"]).toBe(chromeUA);
    expect(h["Sec-Ch-Ua"]).toContain("Google Chrome");
    expect(h["Sec-Ch-Ua"]).toContain('v="133"');
    expect(h["Sec-Ch-Ua-Mobile"]).toBe("?0");
    expect(h["Sec-Ch-Ua-Platform"]).toBe('"Windows"');
    expect(h["Sec-Fetch-Dest"]).toBe("document");
    expect(h["Sec-Fetch-Mode"]).toBe("navigate");
    expect(h["Sec-Fetch-User"]).toBe("?1");
    expect(h["Upgrade-Insecure-Requests"]).toBe("1");
    expect(h["Accept-Encoding"]).toBe("gzip, deflate, br");
  });

  it("Edge headers include Microsoft Edge brand", () => {
    const h = getStealthHeaders("bing", edgeUA);
    expect(h["Sec-Ch-Ua"]).toContain("Microsoft Edge");
    expect(h["Sec-Ch-Ua"]).toContain('v="133"');
  });

  it("Firefox headers include Sec-Fetch-* but NOT Sec-Ch-Ua", () => {
    const h = getStealthHeaders("google", firefoxUA);
    expect(h["User-Agent"]).toBe(firefoxUA);
    expect(h["Sec-Fetch-Dest"]).toBe("document");
    expect(h["Sec-Fetch-Mode"]).toBe("navigate");
    expect(h["Sec-Ch-Ua"]).toBeUndefined();
    expect(h["Sec-Ch-Ua-Mobile"]).toBeUndefined();
    expect(h["Sec-Ch-Ua-Platform"]).toBeUndefined();
    expect(h["Accept-Language"]).toBe("en-US,en;q=0.5");
  });

  it("Safari headers have neither Sec-Fetch-* nor Sec-Ch-Ua", () => {
    const h = getStealthHeaders("google", safariUA);
    expect(h["User-Agent"]).toBe(safariUA);
    expect(h["Sec-Fetch-Dest"]).toBeUndefined();
    expect(h["Sec-Fetch-Mode"]).toBeUndefined();
    expect(h["Sec-Ch-Ua"]).toBeUndefined();
    expect(h["Accept"]).toContain("text/html");
  });

  it("includes correct Referer per engine", () => {
    expect(getStealthHeaders("google", chromeUA)["Referer"]).toBe(
      "https://www.google.com/"
    );
    expect(getStealthHeaders("bing", chromeUA)["Referer"]).toBe(
      "https://www.bing.com/"
    );
    expect(getStealthHeaders("duckduckgo", chromeUA)["Referer"]).toBe(
      "https://duckduckgo.com/"
    );
    expect(getStealthHeaders("brave", chromeUA)["Referer"]).toBe(
      "https://search.brave.com/"
    );
    expect(getStealthHeaders("yahoo", chromeUA)["Referer"]).toBe(
      "https://search.yahoo.com/"
    );
  });

  it("unknown engine has no Referer", () => {
    const h = getStealthHeaders("unknown", chromeUA);
    expect(h["Referer"]).toBeUndefined();
  });

  it("unknown engine sets Sec-Fetch-Site to none", () => {
    const h = getStealthHeaders("unknown", chromeUA);
    expect(h["Sec-Fetch-Site"]).toBe("none");
  });

  it("Mac UA produces macOS platform", () => {
    const macUA =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
    const h = getStealthHeaders("google", macUA);
    expect(h["Sec-Ch-Ua-Platform"]).toBe('"macOS"');
  });

  it("Linux UA produces Linux platform", () => {
    const linuxUA =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
    const h = getStealthHeaders("google", linuxUA);
    expect(h["Sec-Ch-Ua-Platform"]).toBe('"Linux"');
  });
});

describe("stealth: getStealthJsonHeaders", () => {
  it("sets Accept to application/json", () => {
    const ua = getRandomUA();
    const h = getStealthJsonHeaders(ua);
    expect(h["Accept"]).toBe("application/json");
    expect(h["User-Agent"]).toBe(ua);
  });

  it("merges extra headers", () => {
    const ua = getRandomUA();
    const h = getStealthJsonHeaders(ua, { "X-Custom": "test" });
    expect(h["X-Custom"]).toBe("test");
    expect(h["Accept"]).toBe("application/json");
  });
});

describe("stealth: engineDelay", () => {
  beforeEach(() => {
    resetEngineDelays();
  });

  it("first call resolves quickly (no prior request)", async () => {
    const start = Date.now();
    await engineDelay("duckduckgo");
    const elapsed = Date.now() - start;
    // First call may still incur a delay based on randomized range,
    // but if there was no prior request it should be under the max
    expect(elapsed).toBeLessThan(600);
  });

  it("second call within delay range waits", async () => {
    await engineDelay("google");
    const start = Date.now();
    await engineDelay("google");
    const elapsed = Date.now() - start;
    // Google delay: 800-1500ms. Second call should wait at least some portion
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it("different engines have independent delays", async () => {
    await engineDelay("google");
    const start = Date.now();
    await engineDelay("duckduckgo"); // Different engine, no wait needed
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(600);
  });
});

describe("stealth: SimpleCookieJar", () => {
  it("stores and retrieves cookies", () => {
    const jar = new SimpleCookieJar();
    jar.set("google.com", "NID", "abc123");
    jar.set("google.com", "CONSENT", "YES");
    expect(jar.get("google.com")).toBe("NID=abc123; CONSENT=YES");
  });

  it("returns undefined for unknown domain", () => {
    const jar = new SimpleCookieJar();
    expect(jar.get("example.com")).toBeUndefined();
  });

  it("is case-insensitive on domain", () => {
    const jar = new SimpleCookieJar();
    jar.set("Google.COM", "NID", "abc");
    expect(jar.get("google.com")).toBe("NID=abc");
  });

  it("overwrites existing cookie by name", () => {
    const jar = new SimpleCookieJar();
    jar.set("google.com", "NID", "old");
    jar.set("google.com", "NID", "new");
    expect(jar.get("google.com")).toBe("NID=new");
  });

  it("clear removes all cookies", () => {
    const jar = new SimpleCookieJar();
    jar.set("google.com", "NID", "abc");
    jar.set("bing.com", "MUID", "def");
    jar.clear();
    expect(jar.get("google.com")).toBeUndefined();
    expect(jar.get("bing.com")).toBeUndefined();
    expect(jar.size).toBe(0);
  });

  it("extractFromResponse parses Set-Cookie headers", () => {
    const jar = new SimpleCookieJar();
    const mockResponse = {
      headers: {
        getSetCookie: () => [
          "NID=abc123; Path=/; HttpOnly; Secure",
          "CONSENT=YES; Expires=Fri, 01 Jan 2027 00:00:00 GMT",
        ],
      },
    };
    jar.extractFromResponse("google.com", mockResponse);
    expect(jar.get("google.com")).toBe("NID=abc123; CONSENT=YES");
  });

  it("extractFromResponse handles empty Set-Cookie", () => {
    const jar = new SimpleCookieJar();
    const mockResponse = {
      headers: {
        getSetCookie: () => [],
      },
    };
    jar.extractFromResponse("google.com", mockResponse);
    expect(jar.get("google.com")).toBeUndefined();
  });

  it("tracks size correctly", () => {
    const jar = new SimpleCookieJar();
    expect(jar.size).toBe(0);
    jar.set("google.com", "a", "1");
    expect(jar.size).toBe(1);
    jar.set("bing.com", "b", "2");
    expect(jar.size).toBe(2);
  });
});
