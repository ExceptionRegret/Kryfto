// ── Unified Anti-Bot Stealth Layer ─────────────────────────────────
// Provides browser-realistic HTTP headers, UA rotation, per-engine
// request spacing, and lightweight cookie persistence for search
// engine scraping across all engines.

// ── User-Agent Pool (2025-era versions) ───────────────────────────
export const UA_POOL: readonly string[] = [
  // Chrome 133
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  // Chrome 132
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  // Chrome 131
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // Firefox 134
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0",
  // Firefox 133
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  // Safari 18.3
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
  // Edge 133
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0",
  // Edge 131
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  // Chrome 130 (slightly older, still common)
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
];

// ── Browser Family Detection ──────────────────────────────────────

export type BrowserFamily = "chrome" | "firefox" | "safari" | "edge";

export function detectBrowserFamily(ua: string): BrowserFamily {
  if (ua.includes("Edg/")) return "edge";
  if (ua.includes("Firefox/")) return "firefox";
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "safari";
  return "chrome";
}

function extractChromeVersion(ua: string): string {
  // For Edge, extract the Chrome version (not Edge version)
  const m = ua.match(/Chrome\/(\d+)/);
  return m?.[1] ?? "133";
}

function detectPlatform(ua: string): string {
  if (ua.includes("Macintosh")) return '"macOS"';
  if (ua.includes("Linux")) return '"Linux"';
  return '"Windows"';
}

// ── Engine Referers ───────────────────────────────────────────────

const ENGINE_REFERERS: Record<string, string> = {
  google: "https://www.google.com/",
  bing: "https://www.bing.com/",
  duckduckgo: "https://duckduckgo.com/",
  brave: "https://search.brave.com/",
  yahoo: "https://search.yahoo.com/",
};

// ── Random Selection ──────────────────────────────────────────────

export function getRandomUA(): string {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)]!;
}

// ── Header Generation ─────────────────────────────────────────────

/**
 * Generate browser-realistic HTTP headers for a search engine request.
 * Headers vary by browser family (Chrome/Edge send Sec-Ch-Ua, Firefox
 * sends Sec-Fetch but no client hints, Safari sends minimal headers).
 */
export function getStealthHeaders(
  engine: string,
  ua: string,
): Record<string, string> {
  const family = detectBrowserFamily(ua);
  const referer = ENGINE_REFERERS[engine] ?? "";
  const headers: Record<string, string> = {
    "User-Agent": ua,
    "Upgrade-Insecure-Requests": "1",
    DNT: "1",
    Connection: "keep-alive",
  };

  if (referer) {
    headers["Referer"] = referer;
  }

  switch (family) {
    case "chrome":
    case "edge": {
      const ver = extractChromeVersion(ua);
      const brand = family === "edge"
        ? `"Chromium";v="${ver}", "Microsoft Edge";v="${ver}", "Not-A.Brand";v="24"`
        : `"Chromium";v="${ver}", "Google Chrome";v="${ver}", "Not-A.Brand";v="24"`;

      headers["Accept"] =
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8";
      headers["Accept-Language"] = "en-US,en;q=0.9";
      headers["Accept-Encoding"] = "gzip, deflate, br";
      headers["Sec-Fetch-Dest"] = "document";
      headers["Sec-Fetch-Mode"] = "navigate";
      headers["Sec-Fetch-Site"] = referer ? "same-origin" : "none";
      headers["Sec-Fetch-User"] = "?1";
      headers["Sec-Ch-Ua"] = brand;
      headers["Sec-Ch-Ua-Mobile"] = "?0";
      headers["Sec-Ch-Ua-Platform"] = detectPlatform(ua);
      break;
    }

    case "firefox": {
      headers["Accept"] =
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
      headers["Accept-Language"] = "en-US,en;q=0.5";
      headers["Accept-Encoding"] = "gzip, deflate, br";
      headers["Sec-Fetch-Dest"] = "document";
      headers["Sec-Fetch-Mode"] = "navigate";
      headers["Sec-Fetch-Site"] = "same-origin";
      headers["Sec-Fetch-User"] = "?1";
      // Firefox does NOT send Sec-Ch-Ua client hints
      break;
    }

    case "safari": {
      headers["Accept"] =
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
      headers["Accept-Language"] = "en-US,en;q=0.9";
      headers["Accept-Encoding"] = "gzip, deflate, br";
      // Safari sends neither Sec-Fetch-* nor Sec-Ch-Ua
      break;
    }
  }

  return headers;
}

/**
 * Generate stealth headers for JSON API calls.
 * Same browser fingerprint but Accept: application/json.
 */
export function getStealthJsonHeaders(
  ua: string,
  extraHeaders?: Record<string, string>,
): Record<string, string> {
  const family = detectBrowserFamily(ua);
  const headers: Record<string, string> = {
    "User-Agent": ua,
    Accept: "application/json",
    "Accept-Language": family === "firefox" ? "en-US,en;q=0.5" : "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
    ...extraHeaders,
  };
  return headers;
}

// ── Per-Engine Request Spacing ────────────────────────────────────

const ENGINE_DELAY_RANGES: Record<string, [number, number]> = {
  google: [800, 1500],
  bing: [400, 800],
  duckduckgo: [200, 500],
  brave: [300, 600],
  yahoo: [400, 800],
};

const DEFAULT_DELAY_RANGE: [number, number] = [300, 600];

const lastRequestTime = new Map<string, number>();

/**
 * Enforce minimum spacing between requests to the same search engine.
 * Returns a Promise that resolves after the appropriate delay.
 * No-ops if enough time has already elapsed since the last request.
 */
export async function engineDelay(engine: string): Promise<void> {
  const [min, max] = ENGINE_DELAY_RANGES[engine] ?? DEFAULT_DELAY_RANGE;
  const targetDelay = min + Math.random() * (max - min);
  const last = lastRequestTime.get(engine) ?? 0;
  const elapsed = Date.now() - last;
  const remaining = targetDelay - elapsed;

  if (remaining > 0) {
    await new Promise((r) => setTimeout(r, remaining));
  }

  lastRequestTime.set(engine, Date.now());
}

/** Reset delay tracking (for tests). */
export function resetEngineDelays(): void {
  lastRequestTime.clear();
}

// ── Simple Cookie Jar ─────────────────────────────────────────────

interface CookieEntry {
  name: string;
  value: string;
  expiresAt: number;
}

const COOKIE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Lightweight in-memory cookie store. Persists cookies per-domain
 * for the lifetime of the process (max 30 minutes per cookie).
 * Not persistent across restarts — intentional to avoid fingerprint
 * accumulation.
 */
export class SimpleCookieJar {
  private cookies = new Map<string, CookieEntry[]>();

  /** Store a cookie for a domain. */
  set(domain: string, name: string, value: string): void {
    const key = domain.toLowerCase();
    const entries = this.cookies.get(key) ?? [];
    const existing = entries.findIndex((e) => e.name === name);
    const entry: CookieEntry = { name, value, expiresAt: Date.now() + COOKIE_TTL_MS };
    if (existing >= 0) {
      entries[existing] = entry;
    } else {
      entries.push(entry);
    }
    this.cookies.set(key, entries);
  }

  /** Get the Cookie header string for a domain, or undefined if none. */
  get(domain: string): string | undefined {
    const key = domain.toLowerCase();
    const entries = this.cookies.get(key);
    if (!entries || entries.length === 0) return undefined;

    const now = Date.now();
    const valid = entries.filter((e) => e.expiresAt > now);
    if (valid.length === 0) {
      this.cookies.delete(key);
      return undefined;
    }

    // Update to only keep valid entries
    this.cookies.set(key, valid);
    return valid.map((e) => `${e.name}=${e.value}`).join("; ");
  }

  /**
   * Extract Set-Cookie headers from a fetch Response and store them.
   * Works with both single and multiple Set-Cookie headers.
   */
  extractFromResponse(domain: string, response: { headers: { getSetCookie?: () => string[]; get?: (name: string) => string | null } }): void {
    // getSetCookie() is the standard way to get all Set-Cookie headers
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const raw of setCookies) {
      const parts = raw.split(";")[0]; // Take only name=value, ignore attributes
      if (!parts) continue;
      const eqIdx = parts.indexOf("=");
      if (eqIdx < 0) continue;
      const name = parts.slice(0, eqIdx).trim();
      const value = parts.slice(eqIdx + 1).trim();
      if (name) this.set(domain, name, value);
    }
  }

  /** Clear all cookies. */
  clear(): void {
    this.cookies.clear();
  }

  /** Number of domains with cookies. */
  get size(): number {
    return this.cookies.size;
  }
}
