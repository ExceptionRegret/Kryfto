import { load } from "cheerio";

export type SafeSearchMode = "strict" | "moderate" | "off";
export type SearchEngineProvider =
  | "duckduckgo"
  | "bing"
  | "yahoo"
  | "google"
  | "brave";

export type ParsedSearchResult = {
  title: string;
  url: string;
  snippet?: string;
  rank: number;
};

function maybeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeDuckDuckGoResultUrl(rawHref: string): string {
  if (!rawHref) return rawHref;

  try {
    const withBase = new URL(rawHref, "https://duckduckgo.com");
    const redirected = withBase.searchParams.get("uddg");
    if (redirected) {
      return unwrapTrackingUrls(maybeDecodeURIComponent(redirected));
    }
    return unwrapTrackingUrls(withBase.toString());
  } catch {
    return unwrapTrackingUrls(rawHref);
  }
}

function normalizeYahooResultUrl(rawHref: string): string {
  if (!rawHref) return rawHref;
  try {
    const withBase = new URL(rawHref, "https://search.yahoo.com");
    const redirected = withBase.searchParams.get("RU");
    if (redirected) {
      return unwrapTrackingUrls(maybeDecodeURIComponent(redirected));
    }
    return unwrapTrackingUrls(withBase.toString());
  } catch {
    return unwrapTrackingUrls(rawHref);
  }
}

export function unwrapTrackingUrls(rawHref: string): string {
  if (!rawHref) return rawHref;
  let url = rawHref;

  try {
    const udUrl = new URL(url);
    if (udUrl.hostname.includes("urldefense.")) {
      const match = url.match(/__([^_]+)__/);
      if (match && match[1]) {
        url = maybeDecodeURIComponent(match[1]);
      }
    }

    const parsed = new URL(url);
    const toRemove = Array.from(parsed.searchParams.keys()).filter(k =>
      k.startsWith("utm_") ||
      k === "gclid" ||
      k === "fbclid" ||
      k === "msclkid" ||
      k === "mc_eid"
    );
    toRemove.forEach(k => parsed.searchParams.delete(k));
    url = parsed.toString();
  } catch { }

  return url;
}

function normalizeBingResultUrl(rawHref: string): string {
  if (!rawHref) return rawHref;
  let url = rawHref;
  try {
    url = new URL(rawHref, "https://www.bing.com").toString();
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/ck/a")) {
      const u = parsed.searchParams.get("u");
      if (u && u.startsWith("a1")) {
        const decoded = Buffer.from(u.substring(2), "base64").toString("utf8");
        if (decoded.startsWith("http")) {
          url = decoded;
        }
      }
    }
  } catch {
    url = rawHref;
  }
  return unwrapTrackingUrls(url);
}

function toLocaleParts(locale: string): {
  region: string;
  language: string;
  mkt: string;
} {
  const fallback = { region: "us", language: "en", mkt: "en-US" };
  const parts = locale.toLowerCase().split("-");
  if (parts.length !== 2) {
    return fallback;
  }
  const [region, language] = parts;
  if (!region || !language) {
    return fallback;
  }
  return {
    region,
    language,
    mkt: `${language}-${region.toUpperCase()}`,
  };
}

export function safeSearchToBing(
  mode: SafeSearchMode
): "Strict" | "Moderate" | "Off" {
  if (mode === "strict") return "Strict";
  if (mode === "off") return "Off";
  return "Moderate";
}

export function safeSearchToGoogle(mode: SafeSearchMode): "active" | "off" {
  return mode === "off" ? "off" : "active";
}

export function safeSearchToBrave(
  mode: SafeSearchMode
): "strict" | "moderate" | "off" {
  if (mode === "strict") return "strict";
  if (mode === "off") return "off";
  return "moderate";
}

export function buildDuckDuckGoSearchUrl(params: {
  query: string;
  safeSearch: SafeSearchMode;
  locale: string;
}): string {
  const safeSearchMap: Record<SafeSearchMode, string> = {
    off: "-1",
    moderate: "0",
    strict: "1",
  };

  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", params.query);
  url.searchParams.set("kl", params.locale);
  url.searchParams.set("kp", safeSearchMap[params.safeSearch]);
  return url.toString();
}

export function buildBingHtmlSearchUrl(params: {
  query: string;
  safeSearch: SafeSearchMode;
  locale: string;
}): string {
  const localeParts = toLocaleParts(params.locale);
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", params.query);
  url.searchParams.set("setlang", localeParts.language);
  url.searchParams.set("cc", localeParts.region.toUpperCase());
  url.searchParams.set(
    "adlt",
    params.safeSearch === "strict" ? "strict" : "off"
  );
  return url.toString();
}

export function buildYahooSearchUrl(params: {
  query: string;
  safeSearch: SafeSearchMode;
  locale: string;
}): string {
  const localeParts = toLocaleParts(params.locale);
  const url = new URL("https://search.yahoo.com/search");
  url.searchParams.set("p", params.query);
  url.searchParams.set("ei", "UTF-8");
  url.searchParams.set("vl", localeParts.language);
  url.searchParams.set("fr2", "piv-web");
  url.searchParams.set("vm", params.safeSearch === "strict" ? "r" : "p");
  return url.toString();
}

export function buildGoogleHtmlSearchUrl(params: {
  query: string;
  safeSearch: SafeSearchMode;
  locale: string;
}): string {
  const localeParts = toLocaleParts(params.locale);
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", params.query);
  url.searchParams.set("hl", localeParts.language);
  url.searchParams.set("gl", localeParts.region);
  url.searchParams.set("safe", safeSearchToGoogle(params.safeSearch));
  url.searchParams.set("gbv", "1");
  // #11: Anti-bot hardening — disable auto-correction, request 10 results,
  // request basic HTML mode to reduce JS-rendered pages
  url.searchParams.set("nfpr", "1");
  url.searchParams.set("num", "10");
  url.searchParams.set("filter", "0");
  return url.toString();
}

export function buildBraveHtmlSearchUrl(params: {
  query: string;
  safeSearch: SafeSearchMode;
  locale: string;
}): string {
  const localeParts = toLocaleParts(params.locale);
  const url = new URL("https://search.brave.com/search");
  url.searchParams.set("q", params.query);
  url.searchParams.set("source", "web");
  url.searchParams.set("country", localeParts.region.toUpperCase());
  url.searchParams.set("search_lang", localeParts.language);
  url.searchParams.set("safesearch", safeSearchToBrave(params.safeSearch));
  return url.toString();
}

function normalizeGoogleResultUrl(rawHref: string): string {
  if (!rawHref) return rawHref;
  try {
    const withBase = new URL(rawHref, "https://www.google.com");
    const redirected = withBase.searchParams.get("q");
    if (withBase.pathname === "/url" && redirected) {
      return unwrapTrackingUrls(redirected);
    }
    return unwrapTrackingUrls(withBase.toString());
  } catch {
    return unwrapTrackingUrls(rawHref);
  }
}

function normalizeBraveResultUrl(rawHref: string): string {
  if (!rawHref) return rawHref;
  return unwrapTrackingUrls(rawHref);
}

export function parseDuckDuckGoSearchResults(
  html: string,
  limit: number
): ParsedSearchResult[] {
  const $ = load(html);
  const results: ParsedSearchResult[] = [];

  $("div.result").each((_index, element) => {
    if (results.length >= limit) {
      return false;
    }

    const anchor = $(element).find("a.result__a").first();
    const title = anchor.text().trim();
    const href = anchor.attr("href")?.trim() ?? "";
    if (!title || !href) {
      return;
    }

    const snippet =
      $(element).find(".result__snippet").first().text().trim() || undefined;
    results.push({
      title,
      url: normalizeDuckDuckGoResultUrl(href),
      ...(snippet ? { snippet } : {}),
      rank: results.length + 1,
    });
  });

  return results;
}

export function parseBingHtmlSearchResults(
  html: string,
  limit: number
): ParsedSearchResult[] {
  const $ = load(html);
  const results: ParsedSearchResult[] = [];

  $("li.b_algo").each((_index, element) => {
    if (results.length >= limit) {
      return false;
    }

    const anchor = $(element).find("h2 a").first();
    const title = anchor.text().trim();
    const href = anchor.attr("href")?.trim() ?? "";
    if (!title || !href) {
      return;
    }

    const snippet =
      $(element).find(".b_caption p").first().text().trim() || undefined;
    results.push({
      title,
      url: normalizeBingResultUrl(href),
      ...(snippet ? { snippet } : {}),
      rank: results.length + 1,
    });
  });

  return results;
}

export function parseYahooSearchResults(
  html: string,
  limit: number
): ParsedSearchResult[] {
  const $ = load(html);
  const results: ParsedSearchResult[] = [];

  $("div#web ol li, div#web .algo").each((_index, element) => {
    if (results.length >= limit) {
      return false;
    }

    const anchor = $(element).find("h3 a").first();
    const title = anchor.text().trim();
    const href = anchor.attr("href")?.trim() ?? "";
    if (!title || !href) {
      return;
    }

    const snippet =
      $(element).find(".compText p").first().text().trim() ||
      $(element).find("p").first().text().trim() ||
      undefined;

    results.push({
      title,
      url: normalizeYahooResultUrl(href),
      ...(snippet ? { snippet } : {}),
      rank: results.length + 1,
    });
  });

  return results;
}

export function parseGoogleHtmlSearchResults(
  html: string,
  limit: number
): ParsedSearchResult[] {
  const $ = load(html);
  const results: ParsedSearchResult[] = [];
  const seen = new Set<string>();

  function pushGoogle(title: string, href: string, snippet?: string): boolean {
    if (results.length >= limit) return false;
    if (!title || !href) return true;
    const normalizedUrl = normalizeGoogleResultUrl(href);
    if (!normalizedUrl.startsWith("http")) return true;
    if (normalizedUrl.includes("google.com/")) return true;
    if (seen.has(normalizedUrl)) return true;
    seen.add(normalizedUrl);
    results.push({
      title,
      url: normalizedUrl,
      ...(snippet ? { snippet } : {}),
      rank: results.length + 1,
    });
    return true;
  }

  // Method 1: Target generalized result blocks in mobile/fallback HTML
  $("div > a:has(h3)").each((_index, element) => {
    if (results.length >= limit) return false;
    const anchor = $(element);
    const title = anchor.find("h3").first().text().trim();
    const href = anchor.attr("href")?.trim() ?? "";
    const snippetNode = anchor.parent().next("div");
    const snippet = snippetNode.text().trim() || undefined;
    pushGoogle(title, href, snippet);
  });
  if (results.length > 0) return results;

  // Method 2: h3 inside anchor tags (standard desktop layout)
  $("a h3").each((_index, heading) => {
    if (results.length >= limit) return false;
    const anchor = $(heading).closest("a");
    const title = $(heading).text().trim();
    const href = anchor.attr("href")?.trim() ?? "";
    pushGoogle(title, href);
  });
  if (results.length > 0) return results;

  // #11 Method 3: Fallback — data-href or cite-based extraction for
  // Google's JS-heavy pages that render minimal HTML server-side
  $("div.g, div[data-hveid]").each((_index, element) => {
    if (results.length >= limit) return false;
    const el = $(element);
    const anchor = el.find("a[href]").first();
    const title =
      el.find("h3").first().text().trim() ||
      anchor.text().trim();
    const href =
      anchor.attr("href")?.trim() ??
      el.find("cite").first().text().trim() ??
      "";
    const snippet =
      el.find("span.st, div.IsZvec, div[data-sncf]").first().text().trim() ||
      el.find("div > span").first().text().trim() ||
      undefined;
    pushGoogle(title, href, snippet);
  });

  return results;
}

export function parseBraveHtmlSearchResults(
  html: string,
  limit: number
): ParsedSearchResult[] {
  const $ = load(html);
  const results: ParsedSearchResult[] = [];
  const seen = new Set<string>();

  const pushResult = (title: string, href: string, snippet?: string): void => {
    if (results.length >= limit) return;
    if (!title || !href) return;
    const normalized = normalizeBraveResultUrl(href);
    if (!normalized.startsWith("http")) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    results.push({
      title,
      url: normalized,
      ...(snippet ? { snippet } : {}),
      rank: results.length + 1,
    });
  };

  $("a.heading-serpresult, a.result-header").each((_index, element) => {
    const anchor = $(element);
    const title = anchor.text().trim();
    const href = anchor.attr("href")?.trim() ?? "";
    const snippet =
      anchor
        .closest(".snippet")
        .find(".snippet-description")
        .first()
        .text()
        .trim() ||
      anchor.closest(".snippet").find("p").first().text().trim() ||
      undefined;
    pushResult(title, href, snippet);
  });

  if (results.length > 0) {
    return results;
  }

  $('a[href^="http"]').each((_index, element) => {
    if (results.length >= limit) {
      return false;
    }
    const anchor = $(element);
    const title = anchor.text().trim();
    const href = anchor.attr("href")?.trim() ?? "";
    if (!title || title.length < 5) {
      return;
    }
    if (href.includes("search.brave.com")) {
      return;
    }
    pushResult(title, href);
  });

  return results;
}

export function parseGoogleCustomSearchResults(
  payload: unknown,
  limit: number
): ParsedSearchResult[] {
  const typed = payload as {
    items?: Array<{ title?: string; link?: string; snippet?: string }>;
  };

  const results: ParsedSearchResult[] = [];
  for (const item of typed.items ?? []) {
    if (results.length >= limit) break;
    if (!item?.title || !item?.link) continue;
    results.push({
      title: item.title,
      url: item.link,
      ...(item.snippet ? { snippet: item.snippet } : {}),
      rank: results.length + 1,
    });
  }
  return results;
}

export function parseBingApiSearchResults(
  payload: unknown,
  limit: number
): ParsedSearchResult[] {
  const typed = payload as {
    webPages?: {
      value?: Array<{ name?: string; url?: string; snippet?: string }>;
    };
  };

  const results: ParsedSearchResult[] = [];
  for (const item of typed.webPages?.value ?? []) {
    if (results.length >= limit) break;
    if (!item?.name || !item?.url) continue;
    results.push({
      title: item.name,
      url: item.url,
      ...(item.snippet ? { snippet: item.snippet } : {}),
      rank: results.length + 1,
    });
  }
  return results;
}

export function parseBraveApiSearchResults(
  payload: unknown,
  limit: number
): ParsedSearchResult[] {
  const typed = payload as {
    web?: {
      results?: Array<{ title?: string; url?: string; description?: string }>;
    };
  };

  const results: ParsedSearchResult[] = [];
  for (const item of typed.web?.results ?? []) {
    if (results.length >= limit) break;
    if (!item?.title || !item?.url) continue;
    results.push({
      title: item.title,
      url: item.url,
      ...(item.description ? { snippet: item.description } : {}),
      rank: results.length + 1,
    });
  }
  return results;
}

export function localeParts(locale: string): {
  region: string;
  language: string;
  mkt: string;
} {
  return toLocaleParts(locale);
}

/**
 * Resolve engine wrapper/redirect URLs to their final destination.
 * Detects Bing, Yahoo, DuckDuckGo, Google, and Brave redirect patterns
 * and delegates to the appropriate normalizer.
 */
export function resolveEngineRedirect(url: string): string {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./u, "").toLowerCase();

    // Bing redirect: /ck/a path with base64 encoded URL
    if (host.includes("bing.com") && parsed.pathname.startsWith("/ck/a")) {
      return normalizeBingResultUrl(url);
    }

    // Yahoo redirect: RU param
    if (host.includes("yahoo.com") && parsed.searchParams.has("RU")) {
      return normalizeYahooResultUrl(url);
    }

    // DuckDuckGo redirect: uddg param
    if (
      host.includes("duckduckgo.com") &&
      parsed.searchParams.has("uddg")
    ) {
      return normalizeDuckDuckGoResultUrl(url);
    }

    // Google redirect: /url path with q param
    if (host.includes("google.com") && parsed.pathname === "/url") {
      return normalizeGoogleResultUrl(url);
    }

    // Otherwise just unwrap tracking params
    return unwrapTrackingUrls(url);
  } catch {
    return unwrapTrackingUrls(url);
  }
}
