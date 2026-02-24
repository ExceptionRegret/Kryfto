// ── URL Utils ──────────────────────────────────────────────────────

/**
 * Domains permanently blocked from search results.
 * These are low-quality SEO farms, content scrapers, or irrelevant sites.
 */
export const HARD_BLOCK_DOMAINS = new Set([
  "w3schools.com",
  "tutorialspoint.com",
  "pinterest.com",
  "pinterest.co.uk",
  "quora.com",
  "slideshare.net",
  "scribd.com",
  "coursehero.com",
  "chegg.com",
  "brainly.com",
  "answers.com",
  "ehow.com",
]);

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.replace(/^www\./u, "").toLowerCase();
    for (const p of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "ref",
      "source",
    ])
      u.searchParams.delete(p);
    u.pathname = u.pathname.replace(/\/$/u, "") || "/";
    return u.toString();
  } catch {
    return url;
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return "";
  }
}

export function isDomainAllowed(
  domain: string,
  blocklist: Set<string>,
  allowlist: Set<string>
): boolean {
  if (HARD_BLOCK_DOMAINS.has(domain)) return false;
  if (blocklist.has(domain)) return false;
  if (allowlist.size > 0 && !allowlist.has(domain)) return false;
  return true;
}

/** URL-level filtering patterns */
const BLOCKED_URL_PATTERNS = [
  "/login",
  "/signin",
  "/signup",
  "/register",
  "/cookie",
  "/consent",
  "/privacy-policy",
  "/terms-of-service",
  "auth.",
  "accounts.",
  "/adclick",
  "doubleclick.net",
];

export function isUrlAllowed(
  url: string,
  domain: string,
  blocklist: Set<string>,
  allowlist: Set<string>
): boolean {
  if (!isDomainAllowed(domain, blocklist, allowlist)) return false;
  const lowerUrl = url.toLowerCase();
  if (BLOCKED_URL_PATTERNS.some((p) => lowerUrl.includes(p))) {
    return false;
  }
  return true;
}
