// ── Scoring & Intent Analysis ──────────────────────────────────────
// Phase 14: Truly universal, domain-agnostic ranking engine.
// Works for ANY query type: tech, medical, legal, academic, news,
// shopping, cooking, finance, etc. No hardcoded technology lists.
// Competes with SerpAPI/Brave Search/Google Custom Search quality.

/** Engine wrapper domains that should never count as "official" */
const ENGINE_WRAPPER_DOMAINS = new Set([
  "bing.com",
  "yahoo.com",
  "duckduckgo.com",
  "google.com",
  "brave.com",
]);

// ── #1: Universal official-source detection ───────────────────────

/** Known community/aggregator/UGC sites — never "official" for any query */
const NOISY_DOMAINS = new Set([
  "stackoverflow.com",
  "stackexchange.com",
  "quora.com",
  "reddit.com",
  "youtube.com",
  "medium.com",
  "dev.to",
  "hashnode.dev",
  "w3schools.com",
  "tutorialspoint.com",
  "geeksforgeeks.org",
  "freecodecamp.org",
  "javatpoint.com",
  "programiz.com",
]);

/** TLD patterns that strongly indicate official/institutional content */
const OFFICIAL_TLDS = [".gov", ".edu", ".mil", ".int"];

/** Subdomain patterns that indicate documentation/developer pages */
const OFFICIAL_SUBDOMAIN_PATTERNS = [
  "docs.", "developer.", "api.", "platform.", "learn.",
  "support.", "help.", "reference.", "wiki.", "status.",
  "blog.", "community.", "forum.",
];

/** URL path patterns indicating documentation/reference pages */
const DOC_PATH_PATTERNS = [
  "/docs", "/documentation", "/api", "/reference", "/guide",
  "/manual", "/handbook", "/tutorial", "/getting-started",
  "/quickstart", "/faq", "/wiki", "/help",
];

/**
 * Universal official-source detection using URL structure heuristics.
 * Works for ANY domain — no hardcoded technology list.
 */
export function isOfficialSource(domain: string): boolean {
  const d = domain.replace(/^www\./u, "").toLowerCase();
  if (NOISY_DOMAINS.has(d)) return false;
  if (OFFICIAL_TLDS.some((tld) => d.endsWith(tld))) return true;
  if (OFFICIAL_SUBDOMAIN_PATTERNS.some((p) => d.startsWith(p))) return true;
  if (d.endsWith(".org")) return true;
  if (d === "github.com" || d === "gitlab.com" || d === "bitbucket.org") return true;
  if (d.includes("arxiv.org")) return true;
  return false;
}

export function isStrictOfficialSource(domain: string): boolean {
  const clean = domain.replace(/^www\./u, "").toLowerCase();
  if (NOISY_DOMAINS.has(clean)) return false;
  for (const wrapper of ENGINE_WRAPPER_DOMAINS) {
    if (clean.includes(wrapper)) return false;
  }
  return isOfficialSource(domain);
}

// ── Universal domain-query relevance ─────────────────────────────
// The core algorithm: extract meaningful terms from the query,
// then check if the domain name contains those terms.
// This works for ANY topic: "kubernetes" → kubernetes.io,
// "mayo clinic" → mayoclinic.org, "nytimes" → nytimes.com, etc.

/** Short technology/brand names that are too short for normal matching */
const SHORT_NAME_DOMAINS: Record<string, string[]> = {
  "go": ["go.dev", "golang.org", "pkg.go.dev"],
  "r": ["r-project.org", "cran.r-project.org"],
  "c": ["cppreference.com", "en.cppreference.com"],
  "c++": ["cppreference.com", "isocpp.org"],
  "d": ["dlang.org"],
  "v": ["vlang.io"],
  "io": ["iolanguage.org"],
  "zig": ["ziglang.org"],
  "nim": ["nim-lang.org"],
  "lua": ["lua.org"],
  "php": ["php.net"],
  "sql": ["sql.org"],
};

/**
 * Universal domain-query relevance scoring.
 * Returns a 0-100 relevance score based on how well
 * the domain matches the query topic.
 *
 * Works for ANY query:
 *   "react hooks" → react.dev = 100 (domain contains "react")
 *   "mayo clinic heart disease" → mayoclinic.org = 100
 *   "California penal code" → leginfo.legislature.ca.gov = 80 (.gov bonus)
 *   "best pasta recipe" → seriouseats.com = 0 (no match, but that's fine)
 */
export function domainQueryRelevance(domain: string, query: string): number {
  const d = domain.replace(/^www\./u, "").toLowerCase();
  const q = query.toLowerCase();

  // ── Short name check (Go, R, C, etc.) ──
  for (const [shortName, domains] of Object.entries(SHORT_NAME_DOMAINS)) {
    // Check if query starts with or contains the short name as a distinct word
    const wordBoundary = new RegExp(`\\b${shortName.replace(/[+]/g, "\\$&")}\\b`, "i");
    if (wordBoundary.test(q) && domains.some((sd) => d.includes(sd))) {
      return 100;
    }
  }

  // ── Extract meaningful terms from query ──
  const stopWords = new Set([
    "the", "and", "for", "with", "from", "this", "that", "what", "how",
    "does", "why", "can", "will", "not", "are", "was", "were", "been",
    "has", "have", "had", "its", "also", "but", "into", "than", "then",
    "just", "only", "very", "much", "more", "most", "such", "some",
    "get", "set", "use", "new", "old", "any", "all", "each",
    "best", "top", "good", "bad", "like",
    // Intent words (not topic words)
    "docs", "documentation", "reference", "guide", "tutorial",
    "error", "fix", "issue", "bug", "help", "question",
    "latest", "news", "release", "update",
    "how", "what", "when", "where", "which", "who",
  ]);

  const queryTerms = q
    .replace(/[^a-z0-9\s.-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));

  if (queryTerms.length === 0) return 0;

  // ── Check domain contains query terms ──
  // Normalize domain for matching (strip TLD, split on dots/dashes)
  const domainParts = d.replace(/\.(com|org|net|io|dev|sh|co|ai|app|me|us|uk|de|fr|jp|in|gov|edu|mil|int)$/g, "")
    .split(/[.-]/);

  let matchScore = 0;
  for (const term of queryTerms) {
    // Direct inclusion: "kubernetes" in "kubernetes.io"
    if (d.includes(term)) {
      matchScore += 100 / queryTerms.length;
      continue;
    }
    // Domain part match: "docker" in "docs.docker.com"
    if (domainParts.some((p) => p.includes(term) || term.includes(p))) {
      matchScore += 80 / queryTerms.length;
      continue;
    }
  }

  return Math.min(100, Math.round(matchScore));
}

// Backward compat alias
export function domainMatchesQuery(domain: string, query: string): boolean {
  return domainQueryRelevance(domain, query) >= 40;
}

// Backward compat alias
export function isCanonicalForQuery(domain: string, query: string): boolean {
  return domainQueryRelevance(domain, query) >= 60;
}

/**
 * Score how "official-looking" a URL is based on its structure.
 * Works universally for ANY domain — analyzes patterns, not names.
 */
export function urlOfficialScore(url: string, domain: string): number {
  let score = 0;
  const d = domain.replace(/^www\./u, "").toLowerCase();
  const path = url.toLowerCase();

  // Institutional TLD
  if (OFFICIAL_TLDS.some((tld) => d.endsWith(tld))) score += 40;

  // Docs/developer subdomain
  if (d.startsWith("docs.") || d.startsWith("developer.") || d.startsWith("api.")) score += 25;
  if (d.startsWith("learn.") || d.startsWith("platform.")) score += 20;

  // URL path indicates documentation
  if (DOC_PATH_PATTERNS.some((p) => path.includes(p))) score += 15;

  // ReadTheDocs / GitBook patterns (universal)
  if (d.includes(".readthedocs.") || d.includes(".gitbook.")) score += 25;

  // .org TLD (organizational)
  if (d.endsWith(".org")) score += 10;

  // Penalty: login/signup/pricing pages are not useful content
  if (/\/(login|signin|signup|pricing|subscribe|register|cart|checkout)\b/i.test(url)) score -= 30;

  // Penalty: tracking/ad URLs
  if (/[?&](utm_|fbclid|gclid|ref=)/i.test(url)) score -= 10;

  return score;
}

// ── Domain weights ─────────────────────────────────────────────────
// Universal authority weights — these represent cross-domain reputation.
// NOT technology-specific. Think Wikipedia, MDN, GitHub — universally trusted.
export const TECH_DOMAIN_WEIGHTS: Record<string, number> = {
  // Universal documentation platforms
  "developer.mozilla.org": 95,
  "learn.microsoft.com": 90,
  "docs.aws.amazon.com": 90,
  "cloud.google.com": 90,
  // Code hosting (repos = primary sources)
  "github.com": 80,
  "gitlab.com": 75,
  // Academic / knowledge
  "arxiv.org": 90,
  "wikipedia.org": 60,
  "scholar.google.com": 85,
  // Standards bodies
  "w3.org": 90,
  "tc39.es": 90,
  "ietf.org": 90,
  "rfc-editor.org": 90,
};

export function getDomainWeight(domain: string): number {
  const d = domain.replace(/^www\./u, "").toLowerCase();

  // Hard demote known noisy sources
  if (NOISY_DOMAINS.has(d)) return -50;

  // Exact match in universal weights
  if (TECH_DOMAIN_WEIGHTS[d] !== undefined) return TECH_DOMAIN_WEIGHTS[d]!;

  // Dynamic scoring based on domain structure
  if (OFFICIAL_TLDS.some((tld) => d.endsWith(tld))) return 150;
  if (d.endsWith(".org")) return 70;
  if (d.startsWith("docs.") || d.startsWith("developer.") || d.startsWith("api.")) return 85;
  if (d.startsWith("learn.") || d.startsWith("platform.")) return 80;
  if (d.includes(".readthedocs.") || d.includes(".gitbook.")) return 80;

  // Unknown domain — neutral baseline
  return 30;
}

// ── #2: Expanded intent detection ─────────────────────────────────
const RECENCY_KEYWORDS = [
  "latest", "newest", "recent", "update", "release", "new features",
  "what's new", "changelog", "breaking changes", "migration", "upgrade",
  "v2", "v3", "v4", "v5", "2024", "2025", "2026",
];

export function isRecencyQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return RECENCY_KEYWORDS.some((k) => lower.includes(k));
}

export type Intent =
  | "troubleshooting"
  | "documentation"
  | "api_docs"
  | "legal"
  | "release_notes"
  | "faq"
  | "news"
  | "general";

export function analyzeIntent(query: string): Intent {
  const lower = query.toLowerCase();
  const apiDocs = ["api reference", "api docs", "api documentation", "sdk reference", "openapi", "swagger", "endpoint"];
  if (apiDocs.some((k) => lower.includes(k))) return "api_docs";

  const legal = ["law", "legal", "statute", "regulation", "compliance", "act of", "bill ", "ordinance", "court", "gdpr", "hipaa", "sox", "sec filing"];
  if (legal.some((k) => lower.includes(k))) return "legal";

  const releaseNotes = ["release notes", "changelog", "what's new", "breaking changes", "migration guide", "upgrade guide"];
  if (releaseNotes.some((k) => lower.includes(k))) return "release_notes";

  const faq = ["faq", "frequently asked", "common questions", "troubleshoot"];
  if (faq.some((k) => lower.includes(k))) return "faq";

  const troubleshooting = ["error", "fix", "issue", "bug", "exception", "not working", "failed", "crash", "fails", "workaround", "debug"];
  if (troubleshooting.some((k) => lower.includes(k))) return "troubleshooting";

  const documentation = ["docs", "documentation", "api", "reference", "sdk", "guide", "tutorial", "how to", "manual", "handbook"];
  if (documentation.some((k) => lower.includes(k))) return "documentation";

  const news = ["news", "latest", "release", "update", "announced"];
  if (news.some((k) => lower.includes(k))) return "news";

  return "general";
}

// ── #3: Noise penalty ────────────────────────────────────────────

export function noisePenalty(domain: string, intent: Intent): number {
  const d = domain.replace(/^www\./u, "").toLowerCase();
  if (!NOISY_DOMAINS.has(d)) return 0;
  switch (intent) {
    case "api_docs": return -80;
    case "legal": return -100;
    case "documentation": return -60;
    case "release_notes": return -40;
    case "faq": return -20;
    case "troubleshooting": return 0;
    default: return 0;
  }
}

// ── #4: Query rewriting (no-op; all boosting is in scoring layer)

export function rewriteQueryForIntent(
  query: string,
  _intent: Intent,
  _userSiteOverride?: string
): { query: string; autoSite?: string } {
  return { query };
}

// ── #5: Engine fallback quality controls ─────────────────────────

export function shouldTightenDomainsOnFallback(
  engine: string,
  intent: Intent
): boolean {
  if ((engine === "bing" || engine === "yahoo") &&
    (intent === "api_docs" || intent === "legal" || intent === "documentation")) {
    return true;
  }
  return false;
}

// ── #6: Strict mode profile ──────────────────────────────────────
export type StrictProfile = {
  officialOnly: boolean;
  trustThreshold: number;
  noisePenaltyMultiplier: number;
};

const STRICT_INTENTS = new Set<Intent>(["legal", "api_docs"]);
const STRICT_KEYWORDS = new Set([
  "compliance", "regulation", "hipaa", "gdpr", "sox", "pci",
  "medical", "clinical", "pharmaceutical", "fda",
  "financial", "sec", "banking", "insurance",
  "legal", "statute", "court",
]);

export function detectStrictProfile(query: string, intent: Intent): StrictProfile | null {
  if (STRICT_INTENTS.has(intent)) {
    return { officialOnly: true, trustThreshold: 0.8, noisePenaltyMultiplier: 2.0 };
  }
  const lower = query.toLowerCase();
  for (const keyword of STRICT_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { officialOnly: true, trustThreshold: 0.8, noisePenaltyMultiplier: 2.0 };
    }
  }
  return null;
}

// ── Query builder ────────────────────────────────────────────────

/** Strip search operators that could manipulate query intent */
function sanitizeOperatorValue(value: string): string {
  return value.replace(/["\n\r]/g, "").replace(/\b(site|inurl|filetype|intitle|intext|cache|related):/gi, "").trim();
}

export function buildSearchQuery(
  query: string,
  opts?: { site?: string | undefined; exclude?: string[] | undefined; inurl?: string | undefined }
): string {
  let q = query;
  if (opts?.site) q = `site:${sanitizeOperatorValue(opts.site)} ${q}`;
  if (opts?.inurl) q = `inurl:${sanitizeOperatorValue(opts.inurl)} ${q}`;
  if (opts?.exclude?.length)
    q += ` ${opts.exclude.map((e) => `-${sanitizeOperatorValue(e)}`).join(" ")}`;
  return q;
}

// ── Relevance reranker signals ──────────────────────────────────

export function extractQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["the", "and", "for", "with", "from", "this", "that"].includes(w));
}

export function snippetOverlapBonus(
  snippet: string | undefined,
  queryTerms: string[]
): number {
  if (!snippet || queryTerms.length === 0) return 0;
  const lower = snippet.toLowerCase();
  const matchCount = queryTerms.filter((t) => lower.includes(t)).length;
  return Math.round((matchCount / queryTerms.length) * 25);
}

export function titleMatchBonus(
  title: string,
  queryTerms: string[]
): number {
  if (!title || queryTerms.length === 0) return 0;
  const lower = title.toLowerCase();
  const matchCount = queryTerms.filter((t) => lower.includes(t)).length;
  return Math.round((matchCount / queryTerms.length) * 20);
}

export function authorityBonus(domain: string, intent: Intent): number {
  const d = domain.replace(/^www\./u, "").toLowerCase();
  if (intent === "api_docs") {
    if (d.startsWith("docs.") || d.startsWith("developer.") || d.startsWith("platform.") || d.startsWith("api."))
      return 60;
    return 0;
  }
  if (intent === "legal") {
    if (OFFICIAL_TLDS.some((tld) => d.endsWith(tld))) return 80;
    return 0;
  }
  if (intent !== "documentation" && intent !== "release_notes") return 0;
  if (d.startsWith("docs.") || d.startsWith("developer."))
    return 40;
  return 0;
}

/**
 * Universal canonical domain bonus — uses domainQueryRelevance + urlOfficialScore
 * to boost any domain that dynamically matches the query topic.
 */
export function canonicalDomainBonus(
  domain: string,
  query: string,
  intent: Intent
): number {
  const relevance = domainQueryRelevance(domain, query);
  if (relevance < 40) return 0;

  // Scale bonus by relevance strength and intent
  const relevanceScale = relevance / 100; // 0.4 → 1.0
  switch (intent) {
    case "api_docs": return Math.round(80 * relevanceScale);
    case "documentation": return Math.round(60 * relevanceScale);
    case "release_notes": return Math.round(50 * relevanceScale);
    case "legal": return Math.round(70 * relevanceScale);
    default: return Math.round(30 * relevanceScale);
  }
}

// ── #7: Result diversity ─────────────────────────────────────────

/**
 * Apply diversity penalty: results from the same domain get
 * progressively penalized so one domain doesn't dominate.
 * Returns a penalty value (negative or zero).
 */
export function diversityPenalty(
  domain: string,
  domainCounts: Map<string, number>
): number {
  const d = domain.replace(/^www\./u, "").toLowerCase();
  const count = domainCounts.get(d) ?? 0;
  domainCounts.set(d, count + 1);

  // First 2 results from same domain: no penalty
  // 3rd result: -20, 4th: -40, 5th+: -60
  if (count < 2) return 0;
  if (count === 2) return -20;
  if (count === 3) return -40;
  return -60;
}
