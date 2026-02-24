// ── Scoring & Intent Analysis ──────────────────────────────────────

/** Engine wrapper domains that should never count as "official" */
const ENGINE_WRAPPER_DOMAINS = new Set([
  "bing.com",
  "yahoo.com",
  "duckduckgo.com",
  "google.com",
  "brave.com",
]);

const OFFICIAL_PATTERNS = [
  ".org",
  ".edu",
  ".gov",
  ".mil",
  "docs.",
  "developer.",
  "github.com",
  "gitlab.com",
  "arxiv.org",
];

export function isOfficialSource(d: string): boolean {
  return OFFICIAL_PATTERNS.some((p) => d.includes(p));
}

export function isStrictOfficialSource(d: string): boolean {
  if (
    d.includes("stackoverflow.") ||
    d.includes("quora.") ||
    d.includes("reddit.")
  )
    return false;
  // Defense-in-depth: block engine wrapper domains even after redirect resolution
  for (const wrapper of ENGINE_WRAPPER_DOMAINS) {
    if (d.includes(wrapper)) return false;
  }
  return isOfficialSource(d);
}

// Strong default domain weights for technical queries
export const TECH_DOMAIN_WEIGHTS: Record<string, number> = {
  "react.dev": 100,
  "nextjs.org": 100,
  "vuejs.org": 100,
  "angular.dev": 100,
  "svelte.dev": 100,
  "nodejs.org": 100,
  "typescriptlang.org": 100,
  "python.org": 100,
  "rust-lang.org": 100,
  "go.dev": 100,
  "tailwindcss.com": 90,
  "postgresql.org": 100,
  "docs.docker.com": 95,
  "kubernetes.io": 100,
  "github.com": 80,
  "developer.mozilla.org": 95,
  "docs.github.com": 90,
  "vercel.com": 80,
  "deno.land": 90,
};

export function getDomainWeight(domain: string): number {
  const d = domain.replace(/^www\./u, "").toLowerCase();

  // Demote junk / SEO farms (geeksforgeeks demoted but not hard-blocked)
  if (d.includes("geeksforgeeks")) {
    return -50;
  }

  if (TECH_DOMAIN_WEIGHTS[d] !== undefined) return TECH_DOMAIN_WEIGHTS[d]!;

  // Extremely high confidence for official institutional entities
  if (d.endsWith(".gov") || d.endsWith(".edu") || d.endsWith(".mil"))
    return 150;

  // Technical / organizational heuristics
  if (d.endsWith(".org")) return 70;
  if (d.startsWith("docs.") || d.startsWith("developer.")) return 85;

  // Fallback
  if (isOfficialSource(d)) return 60;
  return 30;
}

// Recency detector
const RECENCY_KEYWORDS = [
  "latest",
  "newest",
  "recent",
  "update",
  "release",
  "new features",
  "what's new",
  "changelog",
  "breaking changes",
  "migration",
  "upgrade",
  "v2",
  "v3",
  "v4",
  "v5",
  "2024",
  "2025",
  "2026",
];

export function isRecencyQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return RECENCY_KEYWORDS.some((k) => lower.includes(k));
}

export type Intent =
  | "troubleshooting"
  | "documentation"
  | "news"
  | "general";

export function analyzeIntent(query: string): Intent {
  const lower = query.toLowerCase();
  const troubleshooting = [
    "error",
    "fix",
    "issue",
    "bug",
    "exception",
    "not working",
    "failed",
    "crash",
    "fails",
  ];
  if (troubleshooting.some((k) => lower.includes(k))) return "troubleshooting";

  const documentation = [
    "docs",
    "documentation",
    "api",
    "reference",
    "sdk",
    "guide",
    "tutorial",
    "how to",
  ];
  if (documentation.some((k) => lower.includes(k))) return "documentation";

  const news = ["news", "latest", "release", "update", "announced"];
  if (news.some((k) => lower.includes(k))) return "news";

  return "general";
}

export function buildSearchQuery(
  query: string,
  opts?: { site?: string; exclude?: string[]; inurl?: string }
): string {
  let q = query;
  if (opts?.site) q = `site:${opts.site} ${q}`;
  if (opts?.inurl) q = `inurl:${opts.inurl} ${q}`;
  if (opts?.exclude?.length)
    q += ` ${opts.exclude.map((e) => `-${e}`).join(" ")}`;
  return q;
}

// ── #3 Relevance Reranker Signals ──────────────────────────────────

/** Extract query terms for snippet/title matching (words > 2 chars) */
export function extractQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["the", "and", "for", "with", "from", "this", "that"].includes(w));
}

/** Compute snippet keyword overlap bonus (max +25) */
export function snippetOverlapBonus(
  snippet: string | undefined,
  queryTerms: string[]
): number {
  if (!snippet || queryTerms.length === 0) return 0;
  const lower = snippet.toLowerCase();
  const matchCount = queryTerms.filter((t) => lower.includes(t)).length;
  return Math.round((matchCount / queryTerms.length) * 25);
}

/** Compute title match bonus (max +20) */
export function titleMatchBonus(
  title: string,
  queryTerms: string[]
): number {
  if (!title || queryTerms.length === 0) return 0;
  const lower = title.toLowerCase();
  const matchCount = queryTerms.filter((t) => lower.includes(t)).length;
  return Math.round((matchCount / queryTerms.length) * 20);
}

/** Authority bonus for docs/developer domains when intent is documentation (+40) */
export function authorityBonus(
  domain: string,
  intent: Intent
): number {
  if (intent !== "documentation") return 0;
  if (domain.startsWith("docs.") || domain.startsWith("developer."))
    return 40;
  return 0;
}
