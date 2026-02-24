import { CollectorClient } from "@kryfto/sdk-ts";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import TurndownService from "turndown";
// @ts-ignore
import { gfm } from "turndown-plugin-gfm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveEngineRedirect, getStealthHeaders, getRandomUA } from "@kryfto/shared";
import {
  normalizeUrl,
  extractDomain,
  isDomainAllowed,
  isUrlAllowed,
  HARD_BLOCK_DOMAINS,
} from "./url-utils.js";
import {
  getDomainWeight,
  TECH_DOMAIN_WEIGHTS,
  analyzeIntent,
  isRecencyQuery,
  isOfficialSource,
  isStrictOfficialSource,
  buildSearchQuery,
  extractQueryTerms,
  snippetOverlapBonus,
  titleMatchBonus,
  authorityBonus,
} from "./scoring.js";
import {
  DEFAULT_TRUST,
  getDomainTrust,
  customTrust,
  recordTrustOutcome,
} from "./trust.js";
import {
  shouldSkipEngine,
  recordEngineSuccess,
  recordEngineFailure,
} from "./circuit-breaker.js";
import {
  createTrace,
  startSpan,
  endSpan,
  finalizeTrace,
} from "./trace.js";
import type { TraceContext } from "./trace.js";
import {
  SERVER_VERSION,
  EVAL_SCHEMA_VERSION,
  RERANKER_VERSION,
  TRUST_RULES_VERSION,
  versionStamp,
} from "./version.js";

// ── Config ──────────────────────────────────────────────────────────
const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:8080";
const API_TOKEN = process.env.API_TOKEN ?? process.env.KRYFTO_API_TOKEN;
const client = new CollectorClient({
  baseUrl: API_BASE_URL,
  token: API_TOKEN,
} as any);

// #25: Scoped tokens — per-tool auth override via env vars
const SCOPED_TOKENS: Record<string, string | undefined> = {
  search: process.env.KRYFTO_SEARCH_TOKEN,
  browse: process.env.KRYFTO_BROWSE_TOKEN,
  crawl: process.env.KRYFTO_CRAWL_TOKEN,
  extract: process.env.KRYFTO_EXTRACT_TOKEN,
  github_releases: process.env.GITHUB_TOKEN,
};

function scopedClient(tool: string): CollectorClient {
  const scopedToken = SCOPED_TOKENS[tool];
  if (scopedToken)
    return new CollectorClient({
      baseUrl: API_BASE_URL,
      token: scopedToken,
    } as any);
  return client;
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
turndown.use(gfm);
turndown.remove([
  "script",
  "style",
  "nav",
  "footer",
  "header",
  "aside",
  "noscript",
  "iframe",
  "svg",
]);

// ── Constants ───────────────────────────────────────────────────────
const FALLBACK_ENGINES = [
  "duckduckgo",
  "brave",
  "bing",
  "yahoo",
  "google",
] as const;
type SearchEngine = (typeof FALLBACK_ENGINES)[number];
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const CACHE_DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

// #26: Domain allowlist/blocklist
const DOMAIN_BLOCKLIST = new Set(
  (process.env.KRYFTO_DOMAIN_BLOCKLIST ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)
);
const DOMAIN_ALLOWLIST = new Set(
  (process.env.KRYFTO_DOMAIN_ALLOWLIST ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)
);

// ── Cache (#16) ─────────────────────────────────────────────────────
interface CacheEntry {
  data: any;
  cachedAt: number;
  ttlMs: number;
  html: string | undefined;
}
const cache = new Map<string, CacheEntry>();
function getCached(
  key: string,
  mode?: "always" | "preferred" | "fallback" | "never"
): {
  hit: boolean;
  stale: boolean;
  data?: any;
  cachedAt?: number;
  html?: string | undefined;
} {
  if (mode === "always") return { hit: false, stale: false };
  const e = cache.get(key);
  if (!e) {
    if (mode === "never")
      throw new Error(
        `freshness_mode=never requires cache hit but none found for ${key}`
      );
    return { hit: false, stale: false };
  }
  const expired = Date.now() - e.cachedAt > e.ttlMs;
  if (mode === "never")
    return {
      hit: true,
      stale: expired,
      data: e.data,
      cachedAt: e.cachedAt,
      html: e.html,
    };
  if (expired && mode !== "fallback") {
    cache.delete(key);
    return { hit: false, stale: true };
  }
  return {
    hit: true,
    stale: expired,
    data: e.data,
    cachedAt: e.cachedAt,
    html: e.html,
  };
}
function setCache(
  key: string,
  data: any,
  ttlMs = CACHE_DEFAULT_TTL_MS,
  html?: string
) {
  cache.set(key, { data, cachedAt: Date.now(), ttlMs, html } as CacheEntry);
}

// ── URL Utils (#7) — now imported from ./url-utils.js ───────────────

// ── Date Utils (#9) ─────────────────────────────────────────────────
const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};
const SHORT_MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};
function extractDateFromText(text: string): string | undefined {
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const long = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i
  );
  if (long) {
    const mn = MONTHS[long[1]!.toLowerCase()] ?? "01";
    return `${long[3]!}-${mn}-${long[2]!.padStart(2, "0")}`;
  }
  const short1 = text.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/i
  );
  if (short1) {
    const mn = SHORT_MONTHS[short1[1]!.toLowerCase().substring(0, 3)] ?? "01";
    return `${short1[3]!}-${mn}-${short1[2]!.padStart(2, "0")}`;
  }
  const short2 = text.match(
    /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i
  );
  if (short2) {
    const mn = SHORT_MONTHS[short2[2]!.toLowerCase().substring(0, 3)] ?? "01";
    return `${short2[3]!}-${mn}-${short2[1]!.padStart(2, "0")}`;
  }
  const us = text.match(/\b(\d{2})[\/-](\d{2})[\/-](\d{4})\b/);
  if (us && parseInt(us[1]!) <= 12) return `${us[3]!}-${us[1]!}-${us[2]!}`;
  return undefined;
}
function extractDateFromHtml(html: string): {
  date: string | undefined;
  confidence: "high" | "medium" | "low";
  source: string;
} {
  const meta = html.match(
    /(?:property|name)=["'](?:article:published_time|datePublished|date|DC\.date|og:updated_time)["']\s+content=["']([^"']+)["']/i
  );
  if (meta)
    return {
      date: meta[1]!.substring(0, 10),
      confidence: "high",
      source: "meta",
    };
  const metaRev = html.match(
    /content=["']([\d]{4}-[\d]{2}-[\d]{2}[^"']*)["']\s+(?:property|name)=["'](?:article:published_time|datePublished|date)["']/i
  );
  if (metaRev)
    return {
      date: metaRev[1]!.substring(0, 10),
      confidence: "high",
      source: "meta",
    };
  const ld = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
  if (ld)
    return {
      date: ld[1]!.substring(0, 10),
      confidence: "high",
      source: "jsonld",
    };
  const ldMod = html.match(/"dateModified"\s*:\s*"([^"]+)"/);
  if (ldMod)
    return {
      date: ldMod[1]!.substring(0, 10),
      confidence: "high",
      source: "jsonld_modified",
    };
  const timeEl = html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  if (timeEl)
    return {
      date: timeEl[1]!.substring(0, 10),
      confidence: "medium",
      source: "time_element",
    };
  const t = extractDateFromText(html.substring(0, 5000));
  if (t) return { date: t, confidence: "medium", source: "text" };
  return { date: undefined, confidence: "low", source: "none" };
}
// ── Section Extraction (#10) ────────────────────────────────────────
function extractSections(html: string): {
  headings: string[];
  codeBlocks: string[];
  links: { text: string; href: string }[];
  tables: string[][];
  wordCount: number;
} {
  const headings: string[] = [];
  const codeBlocks: string[] = [];
  const links: { text: string; href: string }[] = [];
  const tables: string[][] = [];
  let m: RegExpExecArray | null;
  const hRe = /<h[1-6][^>]*>(.*?)<\/h[1-6]>/gis;
  while ((m = hRe.exec(html)) !== null)
    headings.push(m[1]!.replace(/<[^>]+>/g, "").trim());
  const cRe = /<(?:pre|code)[^>]*>(.*?)<\/(?:pre|code)>/gis;
  while ((m = cRe.exec(html)) !== null)
    codeBlocks.push(
      m[1]!
        .replace(/<[^>]+>/g, "")
        .trim()
        .substring(0, 500)
    );
  const aRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
  while ((m = aRe.exec(html)) !== null) {
    const t = m[2]!.replace(/<[^>]+>/g, "").trim();
    if (t && m[1]!.startsWith("http")) links.push({ text: t, href: m[1]! });
  }
  // #10 table extraction
  const tRe = /<tr[^>]*>(.*?)<\/tr>/gis;
  while ((m = tRe.exec(html)) !== null) {
    const cells: string[] = [];
    const cRe2 = /<t[dh][^>]*>(.*?)<\/t[dh]>/gis;
    let c;
    while ((c = cRe2.exec(m[1]!)) !== null)
      cells.push(c[1]!.replace(/<[^>]+>/g, "").trim());
    if (cells.length > 0) tables.push(cells);
  }
  return {
    headings,
    codeBlocks: codeBlocks.slice(0, 20),
    links: links.slice(0, 50),
    tables: tables.slice(0, 30),
    wordCount: html.replace(/<[^>]+>/g, " ").split(/\s+/).length,
  };
}

// ── Error Classification (#5) ───────────────────────────────────────
type ErrorCategory =
  | "blocked"
  | "rate_limited"
  | "empty_engine"
  | "parse_failed"
  | "timeout"
  | "network_error"
  | "not_found"
  | "unknown";
function classifyError(error: unknown): {
  error: ErrorCategory;
  message: string;
} {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes("403") || msg.includes("blocked") || msg.includes("captcha"))
    return { error: "blocked", message: msg };
  if (msg.includes("429") || msg.includes("rate") || msg.includes("throttl"))
    return { error: "rate_limited", message: msg };
  if (msg.includes("404")) return { error: "not_found", message: msg };
  if (msg.includes("timeout") || msg.includes("Timed out"))
    return { error: "timeout", message: msg };
  if (
    msg.includes("ECONNREFUSED") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("fetch")
  )
    return { error: "network_error", message: msg };
  if (msg.includes("parse") || msg.includes("JSON"))
    return { error: "parse_failed", message: msg };
  return { error: "unknown", message: msg };
}

// ── Retry with Backoff (#21 & Phase 9) ────────────────────────────────────────
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const c = classifyError(err);
      // Non-retryable errors — abort immediately
      if (c.error === "not_found") throw err;
      // #11: For blocked/captcha, only abort if not on last retry
      // (Google sometimes returns transient 403s that clear on retry)
      if (c.error === "blocked" && i >= retries - 1) throw err;
      if (i < retries - 1) {
        let baseMs = RETRY_BASE_MS;

        // Phase 10: Aggressive backoff curve for 429s + network hangs
        if (c.error === "rate_limited" || c.error === "timeout") {
          baseMs = RETRY_BASE_MS * 3;
        }

        const jitter = Math.random() * 1000;
        const delay = baseMs * Math.pow(2.5, i) + jitter;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw last;
}

// ── SLO Metrics Tracker ─────────────────────────────────────────────
interface SLORecord {
  tool: string;
  success: boolean;
  latencyMs: number;
  timestamp: number;
  cached: boolean;
  requestId: string;
}
const sloHistory: SLORecord[] = [];
const MAX_SLO_HISTORY = 10000;
function recordSLO(
  tool: string,
  success: boolean,
  latencyMs: number,
  cached: boolean,
  requestId: string
) {
  sloHistory.push({
    tool,
    success,
    latencyMs,
    timestamp: Date.now(),
    cached,
    requestId,
  });
  if (sloHistory.length > MAX_SLO_HISTORY)
    sloHistory.splice(0, sloHistory.length - MAX_SLO_HISTORY);
}
function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((sorted.length * p) / 100) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}
function getSLODashboard(toolFilter?: string, windowMinutes = 60) {
  const cutoff = Date.now() - windowMinutes * 60000;
  const records = sloHistory.filter(
    (r) => r.timestamp >= cutoff && (!toolFilter || r.tool === toolFilter)
  );
  const byTool = new Map<string, SLORecord[]>();
  for (const r of records) {
    const list = byTool.get(r.tool) ?? [];
    list.push(r);
    byTool.set(r.tool, list);
  }
  const tools = Array.from(byTool.entries()).map(([tool, recs]) => {
    const successes = recs.filter((r) => r.success).length;
    const latencies = recs.map((r) => r.latencyMs);
    const cacheHits = recs.filter((r) => r.cached).length;
    return {
      tool,
      totalCalls: recs.length,
      successRate: Math.round((successes / recs.length) * 10000) / 100,
      failureRate:
        Math.round(((recs.length - successes) / recs.length) * 10000) / 100,
      cacheHitRate: Math.round((cacheHits / recs.length) * 10000) / 100,
      latency: {
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
        avg: Math.round(
          latencies.reduce((a, b) => a + b, 0) / latencies.length
        ),
      },
    };
  });
  const allLatencies = records.map((r) => r.latencyMs);
  return {
    windowMinutes,
    totalRequests: records.length,
    overallSuccessRate:
      records.length > 0
        ? Math.round(
          (records.filter((r) => r.success).length / records.length) * 10000
        ) / 100
        : 100,
    latencySummary:
      allLatencies.length > 0
        ? {
          p50: percentile(allLatencies, 50),
          p95: percentile(allLatencies, 95),
          p99: percentile(allLatencies, 99),
        }
        : { p50: 0, p95: 0, p99: 0 },
    freshness: {
      cachedResponses: records.filter((r) => r.cached).length,
      freshResponses: records.filter((r) => !r.cached).length,
    },
    tools,
    generatedAt: new Date().toISOString(),
  };
}

// ── Deterministic Replay Store ──────────────────────────────────────
interface ReplayEntry {
  requestId: string;
  tool: string;
  args: unknown;
  result: unknown;
  timestamp: number;
  latencyMs: number;
}
const replayStore = new Map<string, ReplayEntry>();
const MAX_REPLAY_STORE = 1000;
function storeReplay(
  requestId: string,
  tool: string,
  args: unknown,
  result: unknown,
  latencyMs: number
) {
  replayStore.set(requestId, {
    requestId,
    tool,
    args,
    result,
    timestamp: Date.now(),
    latencyMs,
  });
  if (replayStore.size > MAX_REPLAY_STORE) {
    const oldest = replayStore.keys().next().value;
    if (oldest) replayStore.delete(oldest);
  }
}
function replayRequest(requestId: string): ReplayEntry | undefined {
  return replayStore.get(requestId);
}
function listReplays(limit = 20) {
  return Array.from(replayStore.values()).slice(-limit).reverse();
}

// ── Nightly Eval Suite ──────────────────────────────────────────────
const EVAL_QUERIES = [
  {
    id: "e1",
    query: "React 19 new features",
    expectedDomains: ["react.dev", "github.com"],
    category: "framework",
  },
  {
    id: "e2",
    query: "Node.js latest LTS version",
    expectedDomains: ["nodejs.org"],
    category: "runtime",
  },
  {
    id: "e3",
    query: "TypeScript 5 breaking changes",
    expectedDomains: ["typescriptlang.org", "github.com"],
    category: "language",
  },
  {
    id: "e4",
    query: "Next.js App Router migration guide",
    expectedDomains: ["nextjs.org"],
    category: "framework",
  },
  {
    id: "e5",
    query: "PostgreSQL 16 release notes",
    expectedDomains: ["postgresql.org"],
    category: "database",
  },
  {
    id: "e6",
    query: "Docker Compose v2 changes",
    expectedDomains: ["docs.docker.com", "github.com"],
    category: "devops",
  },
  {
    id: "e7",
    query: "Tailwind CSS v4 migration",
    expectedDomains: ["tailwindcss.com"],
    category: "css",
  },
  {
    id: "e8",
    query: "Python 3.12 new features",
    expectedDomains: ["python.org", "docs.python.org"],
    category: "language",
  },
  {
    id: "e9",
    query: "Rust async programming guide",
    expectedDomains: ["rust-lang.org", "doc.rust-lang.org"],
    category: "language",
  },
  {
    id: "e10",
    query: "GitHub Actions workflow best practices",
    expectedDomains: ["docs.github.com", "github.com"],
    category: "devops",
  },
];

export async function runEvalSuite(subset?: string[]) {
  const queries = subset
    ? EVAL_QUERIES.filter((q) => subset.includes(q.id))
    : EVAL_QUERIES;
  const results: {
    id: string;
    query: string;
    category: string;
    passed: boolean;
    latencyMs: number;
    resultCount: number;
    officialHit: boolean;
    precisionAt5: number;
    readSuccess: { success: number; total: number };
    details: string;
  }[] = [];

  let totalReads = 0;
  let totalReadSuccess = 0;

  for (const q of queries) {
    const start = Date.now();
    try {
      const r = await federatedSearch(q.query, { limit: 5 });
      const domains = r.results.map((res) => res.source_domain);
      const officialHit = q.expectedDomains.some((ed) =>
        domains.some((d) => d.includes(ed))
      );

      // Phase 9: Test Read Success Rate
      const topUrls = r.results.slice(0, 2).map(r => r.url);
      const readResults = await Promise.allSettled(
        topUrls.map(url => readUrl(url, { timeoutMs: 15000 }))
      );

      const successes = readResults.filter(p => p.status === "fulfilled" && !(p.value as any)?.error).length;
      totalReads += topUrls.length;
      totalReadSuccess += successes;

      results.push({
        id: q.id,
        query: q.query,
        category: q.category,
        passed: r.results.length > 0 && officialHit,
        latencyMs: Date.now() - start,
        resultCount: r.results.length,
        officialHit,
        precisionAt5: r.results.length === 0 ? 0 : r.results.slice(0, 5).filter(res => q.expectedDomains.some(ed => res.source_domain.includes(ed))).length / Math.min(r.results.length, 5),
        readSuccess: { success: successes, total: topUrls.length },
        details: officialHit
          ? `Found: ${domains.slice(0, 3).join(", ")}`
          : `Expected: ${q.expectedDomains.join(",")} but got: ${domains
            .slice(0, 3)
            .join(", ")}`,
      });
    } catch (e) {
      results.push({
        id: q.id,
        query: q.query,
        category: q.category,
        passed: false,
        latencyMs: Date.now() - start,
        resultCount: 0,
        officialHit: false,
        precisionAt5: 0,
        readSuccess: { success: 0, total: 0 },
        details: String(e),
      });
    }
  }
  const passCount = results.filter((r) => r.passed).length;
  const avgLatency = Math.round(
    results.reduce((s, r) => s + r.latencyMs, 0) / results.length
  );
  const precision = Math.round((passCount / results.length) * 10000) / 100;

  // Phase 10: precision@5 >= 75%
  const precisionAt5 = Math.round(
    (results.reduce((s, r) => s + r.precisionAt5, 0) / results.length) * 10000
  ) / 100;

  const thresholds = {
    minPrecision: 70,
    minPrecisionAt5: 80,
    maxAvgLatencyMs: 7000,
    minOfficialHitRate: 85,
    minReadSuccessRate: 97,
    minSearchSuccessRate: 99,
  };
  const officialHitRate =
    Math.round(
      (results.filter((r) => r.officialHit).length / results.length) * 10000
    ) / 100;
  const readSuccessRate = totalReads > 0
    ? Math.round((totalReadSuccess / totalReads) * 10000) / 100
    : 100;
  const searchSuccessRate =
    Math.round(
      (results.filter((r) => r.resultCount > 0).length / results.length) * 10000
    ) / 100;

  // #9 Per-metric failure reasons
  const failedMetrics: string[] = [];
  if (precision < thresholds.minPrecision)
    failedMetrics.push(`precision: ${precision}% < ${thresholds.minPrecision}%`);
  if (precisionAt5 < thresholds.minPrecisionAt5)
    failedMetrics.push(`precisionAt5: ${precisionAt5}% < ${thresholds.minPrecisionAt5}%`);
  if (avgLatency > thresholds.maxAvgLatencyMs)
    failedMetrics.push(`avgLatency: ${avgLatency}ms > ${thresholds.maxAvgLatencyMs}ms`);
  if (officialHitRate < thresholds.minOfficialHitRate)
    failedMetrics.push(`officialHitRate: ${officialHitRate}% < ${thresholds.minOfficialHitRate}%`);
  if (readSuccessRate < thresholds.minReadSuccessRate)
    failedMetrics.push(`readSuccessRate: ${readSuccessRate}% < ${thresholds.minReadSuccessRate}%`);
  if (searchSuccessRate < thresholds.minSearchSuccessRate)
    failedMetrics.push(`searchSuccessRate: ${searchSuccessRate}% < ${thresholds.minSearchSuccessRate}%`);

  const sloPass = failedMetrics.length === 0;

  return {
    suiteName: `kryfto-eval-${EVAL_SCHEMA_VERSION}`,
    runAt: new Date().toISOString(),
    totalQueries: results.length,
    passed: passCount,
    failed: results.length - passCount,
    precision,
    precisionAt5,
    avgLatencyMs: avgLatency,
    officialHitRate,
    readSuccessRate,
    searchSuccessRate,
    thresholds,
    sloPass,
    failedMetrics,
    verdict: sloPass
      ? "PASS — meets all SLO thresholds"
      : `FAIL — ${failedMetrics.join("; ")}`,
    ...versionStamp(),
    results,
  };
}

// ── Response Helpers (#23, #24, #29) ────────────────────────────────
function asText(
  data: unknown,
  meta?: {
    requestId?: string;
    latencyMs?: number;
    cached?: boolean;
    tool?: string;
  }
) {
  const reqId = meta?.requestId ?? randomUUID().substring(0, 8);
  const latency = meta?.latencyMs ?? 0;
  const isCached = meta?.cached ?? false;
  // Record SLO metrics
  if (meta?.tool) recordSLO(meta.tool, true, latency, isCached, reqId);
  // Store for replay
  if (meta?.tool) storeReplay(reqId, meta.tool, {}, data, latency);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ...(typeof data === "object" && data !== null ? data : { data }),
            _meta: {
              requestId: reqId,
              latencyMs: latency,
              cached: isCached,
              ...(meta?.tool ? { tool: meta.tool } : {}),
              ...versionStamp(),
            },
          },
          null,
          2
        ),
      },
    ],
  };
}
function asError(
  cat: ErrorCategory,
  msg: string,
  ctx?: Record<string, unknown>
) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            error: cat,
            message: msg,
            ...ctx,
            _meta: { ...versionStamp() },
          },
          null,
          2
        ),
      },
    ],
  };
}

// ── Scoring & Intent — now imported from ./scoring.js ───────────────
// ── Query Operators — now imported from ./scoring.js ────────────────

// ── Zod Schemas ─────────────────────────────────────────────────────
const engineEnum = z.enum(["duckduckgo", "bing", "yahoo", "google", "brave"]);
const browseArgs = z.object({
  url: z.string().url(),
  steps: z.array(z.any()).optional(),
  options: z
    .object({
      wait: z.boolean().optional(),
      timeoutMs: z.number().int().positive().optional(),
      pollMs: z.number().int().positive().optional(),
    })
    .optional(),
  recipeId: z.string().optional(),
});
const crawlArgs = z.object({
  seed: z.string().url(),
  rules: z.record(z.any()).optional(),
  recipeId: z.string().optional(),
  followNav: z.boolean().optional(),
  skipPatterns: z.array(z.string()).optional(),
  maxPages: z.number().int().positive().optional(),
});
const extractArgs = z.object({
  input: z.string().optional(),
  artifactId: z.string().optional(),
  selectors: z.record(z.string()).optional(),
  schema: z.record(z.any()).optional(),
  plugin: z.string().optional(),
  mode: z.enum(["selectors", "schema", "plugin"]),
});
const searchArgs = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
  engine: engineEnum.optional(),
  engines: z.array(engineEnum).optional(),
  safeSearch: z.enum(["strict", "moderate", "off"]).optional(),
  locale: z.string().optional(),
  priorityDomains: z.array(z.string()).optional(),
  officialOnly: z.boolean().optional(),
  site: z.string().optional(),
  exclude: z.array(z.string()).optional(),
  inurl: z.string().optional(),
  sortByDate: z.boolean().optional(),
  debug: z.boolean().optional(),
  topic: z.enum(["general", "news", "finance"]).optional(),
  include_images: z.boolean().optional(),
  include_image_descriptions: z.boolean().optional(),
  privacy_mode: z.enum(["normal", "zero_trace"]).optional(),
  freshness_mode: z
    .enum(["always", "preferred", "fallback", "never"])
    .optional(),
  location: z.string().optional(),
  proxy_profile: z.string().optional(),
  country: z.string().optional(),
  session_affinity: z.boolean().optional(),
  rotation_strategy: z.enum(["per_request", "sticky", "random"]).optional(),
});
const readUrlArgs = z.object({
  url: z.string().url(),
  timeoutMs: z.number().int().positive().optional(),
  sections: z.boolean().optional(),
  debug: z.boolean().optional(),
  privacy_mode: z.enum(["normal", "zero_trace"]).optional(),
  freshness_mode: z
    .enum(["always", "preferred", "fallback", "never"])
    .optional(),
  proxy_profile: z.string().optional(),
  country: z.string().optional(),
  session_affinity: z.boolean().optional(),
  rotation_strategy: z.enum(["per_request", "sticky", "random"]).optional(),
});
const batchReadUrlsArgs = z.object({
  urls: z.array(z.string().url()).min(1).max(10),
  timeoutMs: z.number().int().positive().optional(),
});
const getJobArgs = z.object({ jobId: z.string() });
const listArtifactsArgs = z.object({ jobId: z.string() });
const fetchArtifactArgs = z.object({
  artifactId: z.string(),
  downloadToken: z.string().optional(),
});
const githubReleasesArgs = z.object({
  repo: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
});
const githubDiffArgs = z.object({
  repo: z.string().min(1),
  fromTag: z.string(),
  toTag: z.string(),
});
const githubIssuesArgs = z.object({
  repo: z.string().min(1),
  state: z.enum(["open", "closed", "all"]).optional(),
  limit: z.number().int().min(1).max(30).optional(),
  labels: z.string().optional(),
});
const devIntelArgs = z.object({
  framework: z.string().min(1),
  type: z
    .enum(["latest_changes", "breaking_changes", "upgrade_guide"])
    .optional(),
});
const changeDetectArgs = z.object({
  url: z.string().url(),
  timeoutMs: z.number().int().positive().optional(),
});
const citationArgs = z.object({
  claims: z.array(z.string().min(1)).min(1).max(10),
  limit: z.number().int().min(1).max(5).optional(),
});
const monitorArgs = z.object({
  url: z.string().url(),
  label: z.string().optional(),
});

// ── Enriched Result Type ────────────────────────────────────────────
interface EnrichedResult {
  title: string;
  url: string;
  normalizedUrl: string;
  snippet: string | undefined;
  published_at: string | undefined;
  source_domain: string;
  rank: number;
  engine_used: string;
  confidence: "high" | "medium" | "low";
  is_official: boolean;
}

// ── #1: Federated Search ────────────────────────────────────────────
async function federatedSearch(
  query: string,
  opts: {
    limit?: number;
    engines?: SearchEngine[];
    safeSearch?: string;
    locale?: string;
    priorityDomains?: string[];
    officialOnly?: boolean;
    sortByDate?: boolean;
    debug?: boolean;
    site?: string;
    exclude?: string[];
    inurl?: string;
    location?: string;
  }
) {
  const limit = opts.limit ?? 10;
  // Request more results internally if we are doing aggressive filtering or re-ranking
  const internalLimit = opts.officialOnly || opts.sortByDate ? 20 : limit;
  const finalQuery = buildSearchQuery(query, {
    site: opts.site,
    exclude: opts.exclude,
    inurl: opts.inurl,
  } as any);
  const engineList = opts.engines ?? FALLBACK_ENGINES.slice();
  const allResults: EnrichedResult[] = [];
  const seenUrls = new Set<string>();
  const enginesTried: string[] = [];
  const enginesSucceeded: string[] = [];
  const enginesFailed: {
    engine: string;
    error: ErrorCategory;
    message?: string;
  }[] = [];
  const debugSteps: {
    engine: string;
    action: string;
    durationMs: number;
    resultCount: number;
  }[] = [];
  // #10 Observability: trace context when debug is on
  const trace = opts.debug ? createTrace("federatedSearch") : undefined;

  for (const engine of engineList) {
    // #4 Circuit breaker: skip engines with open circuits
    if (shouldSkipEngine(engine)) {
      enginesFailed.push({
        engine,
        error: "blocked" as ErrorCategory,
        message: `Circuit open for engine '${engine}', skipping`,
      });
      if (opts.debug)
        debugSteps.push({
          engine,
          action: "circuit_open",
          durationMs: 0,
          resultCount: 0,
        });
      continue;
    }
    enginesTried.push(engine);
    const t = Date.now();
    const engineSpan = trace ? startSpan(trace, `engine:${engine}`, { engine }) : undefined;
    try {
      const result = await withRetry(() =>
        scopedClient("search").search({
          query: finalQuery,
          limit: internalLimit,
          engine: engine as any,
          safeSearch: (opts.safeSearch ?? "moderate") as any,
          locale: opts.locale ?? "us-en",
          topic: (opts as any).topic,
          include_images: (opts as any).include_images,
          include_image_descriptions: (opts as any).include_image_descriptions,
          privacy_mode: (opts as any).privacy_mode,
          freshness_mode: (opts as any).freshness_mode,
          location: (opts as any).location,
          proxy_profile: (opts as any).proxy_profile,
          country: (opts as any).country,
          session_affinity: (opts as any).session_affinity,
          rotation_strategy: (opts as any).rotation_strategy,
        })
      );
      console.error(
        `[MCP DEBUG] search response for ${engine}:`,
        JSON.stringify(result, null, 2)
      );
      const count = result.results?.length ?? 0;
      if (opts.debug)
        debugSteps.push({
          engine,
          action: "search",
          durationMs: Date.now() - t,
          resultCount: count,
        });
      if (count === 0) {
        // #11: Google retry — strip operators and retry with plain query once
        if (engine === "google" && finalQuery !== query) {
          try {
            const retryResult = await withRetry(
              () =>
                scopedClient("search").search({
                  query,
                  limit: internalLimit,
                  engine: "google",
                  safeSearch: opts.safeSearch ?? "moderate",
                  locale: opts.locale ?? "us-en",
                } as any),
              1
            );
            const retryCount = retryResult.results?.length ?? 0;
            if (retryCount > 0) {
              if (opts.debug)
                debugSteps.push({
                  engine: "google_retry",
                  action: "search",
                  durationMs: Date.now() - t,
                  resultCount: retryCount,
                });
              recordEngineSuccess(engine);
              enginesSucceeded.push(engine);
              for (const r of retryResult.results) {
                const resolvedUrl = resolveEngineRedirect(r.url);
                const normalized = normalizeUrl(resolvedUrl);
                const domain = extractDomain(resolvedUrl);
                if (seenUrls.has(normalized)) continue;
                seenUrls.add(normalized);
                if (!isUrlAllowed(normalized, domain, DOMAIN_BLOCKLIST, DOMAIN_ALLOWLIST)) continue;
                if (opts.officialOnly && !isStrictOfficialSource(domain)) continue;
                allResults.push({
                  title: r.title,
                  url: resolvedUrl,
                  normalizedUrl: normalized,
                  snippet: r.snippet,
                  published_at: r.snippet ? extractDateFromText(r.snippet) : undefined,
                  source_domain: domain,
                  rank: allResults.length + 1,
                  engine_used: "google",
                  confidence: "medium",
                  is_official: isOfficialSource(domain),
                });
              }
              if (engineSpan && trace) endSpan(trace, engineSpan);
              continue;
            }
          } catch {
            // retry also failed, fall through to failure path
          }
        }
        // #11: Google fallback 2 — sanitize query encoding, drop locale restrictions
        if (engine === "google") {
          try {
            const sanitizedQuery = query.replace(/[^\x20-\x7E]/g, " ").trim().substring(0, 200);
            const retryResult2 = await withRetry(
              () =>
                scopedClient("search").search({
                  query: sanitizedQuery,
                  limit: internalLimit,
                  engine: "google",
                  safeSearch: opts.safeSearch ?? "moderate",
                  locale: "us-en",
                } as any),
              1
            );
            const retryCount2 = retryResult2.results?.length ?? 0;
            if (retryCount2 > 0) {
              if (opts.debug)
                debugSteps.push({
                  engine: "google_sanitized_retry",
                  action: "search",
                  durationMs: Date.now() - t,
                  resultCount: retryCount2,
                });
              recordEngineSuccess(engine);
              enginesSucceeded.push(engine);
              for (const r of retryResult2.results) {
                const resolvedUrl = resolveEngineRedirect(r.url);
                const normalized = normalizeUrl(resolvedUrl);
                const domain = extractDomain(resolvedUrl);
                if (seenUrls.has(normalized)) continue;
                seenUrls.add(normalized);
                if (!isUrlAllowed(normalized, domain, DOMAIN_BLOCKLIST, DOMAIN_ALLOWLIST)) continue;
                if (opts.officialOnly && !isStrictOfficialSource(domain)) continue;
                allResults.push({
                  title: r.title,
                  url: resolvedUrl,
                  normalizedUrl: normalized,
                  snippet: r.snippet,
                  published_at: r.snippet ? extractDateFromText(r.snippet) : undefined,
                  source_domain: domain,
                  rank: allResults.length + 1,
                  engine_used: "google",
                  confidence: "medium",
                  is_official: isOfficialSource(domain),
                });
              }
              if (engineSpan && trace) endSpan(trace, engineSpan);
              continue;
            }
          } catch {
            // sanitized retry also failed, fall through
          }
        }
        recordEngineFailure(engine);
        enginesFailed.push({
          engine,
          error: "empty_engine",
          message: `Engine '${engine}' returned 0 results for query: "${finalQuery.substring(
            0,
            80
          )}"`,
        });
        continue;
      }
      recordEngineSuccess(engine);
      enginesSucceeded.push(engine);
      for (const r of result.results) {
        // #1 Redirect canonicalization: resolve engine wrappers before normalizing
        const resolvedUrl = resolveEngineRedirect(r.url);
        const normalized = normalizeUrl(resolvedUrl);
        const domain = extractDomain(resolvedUrl);
        if (seenUrls.has(normalized)) continue;
        seenUrls.add(normalized);
        if (!isUrlAllowed(normalized, domain, DOMAIN_BLOCKLIST, DOMAIN_ALLOWLIST)) continue;
        if (opts.officialOnly && !isStrictOfficialSource(domain)) continue;
        allResults.push({
          title: r.title,
          url: resolvedUrl,
          normalizedUrl: normalized,
          snippet: r.snippet,
          published_at: r.snippet ? extractDateFromText(r.snippet) : undefined,
          source_domain: domain,
          rank: allResults.length + 1,
          engine_used: engine,
          confidence: enginesSucceeded.length === 1 ? "high" : "medium",
          is_official: isOfficialSource(domain),
        });
      }
      if (engineSpan && trace) endSpan(trace, engineSpan);
      if (!opts.engines && allResults.length >= limit) break;
    } catch (err) {
      if (engineSpan && trace) endSpan(trace, engineSpan);
      recordEngineFailure(engine);
      const c = classifyError(err);
      enginesFailed.push({ engine, error: c.error, message: c.message });
      if (opts.debug)
        debugSteps.push({
          engine,
          action: "search_failed",
          durationMs: Date.now() - t,
          resultCount: 0,
        });
    }
  }
  // Deterministic scoring: combine domain weight + official status + recency + reranker signals
  const scoringSpan = trace ? startSpan(trace, "scoring") : undefined;
  const intent = analyzeIntent(query);
  const wantsRecent = isRecencyQuery(query) || opts.sortByDate || intent === "news";
  const queryTerms = extractQueryTerms(query);
  for (const r of allResults) {
    let domainScore = getDomainWeight(r.source_domain);

    // Phase 10 Intent-based Reranking Shift
    if (intent === "troubleshooting") {
      if (r.source_domain.includes("stackoverflow.com") || r.source_domain.includes("github.com")) {
        domainScore += 30;
      }
    } else if (intent === "documentation") {
      if (r.is_official) {
        domainScore += 30;
      }
    }

    const officialBonus = r.is_official ? 20 : 0;

    let recencyBonus = 0;
    if (wantsRecent && r.published_at) {
      const ageMs = Date.now() - new Date(r.published_at).getTime();
      if (ageMs < 30 * 86400000) recencyBonus = intent === "news" ? 60 : 30;
      else if (ageMs < 90 * 86400000) recencyBonus = intent === "news" ? 40 : 20;
      else if (ageMs < 365 * 86400000) recencyBonus = intent === "news" ? 20 : 10;
    }

    // Version heuristic: if looking for latest, reward URLs with newer semantic versioning patterns
    let versionBonus = 0;
    if (wantsRecent) {
      const match = r.url.match(
        /(?:v|version|release|(?<=-))(\d+)[.-](\d+)(?:[.-](\d+))?/i
      );
      if (match) {
        const major = parseInt(match[1] ?? "0", 10);
        const minor = parseInt(match[2] ?? "0", 10);
        const patch = parseInt(match[3] ?? "0", 10);
        versionBonus = major * 0.1 + minor * 1.0 + patch * 0.1; // significantly bump minor revisions
      }
    }

    // #3 Relevance reranker signals
    const snippetBonus = snippetOverlapBonus(r.snippet, queryTerms);
    const titleBonus = titleMatchBonus(r.title, queryTerms);
    const authBonus = authorityBonus(r.source_domain, intent);

    (r as any)._score =
      domainScore + officialBonus + recencyBonus + versionBonus + snippetBonus + titleBonus + authBonus;
  }
  // Sort by deterministic score (stable ranking across runs)
  allResults.sort(
    (a, b) => ((b as any)._score ?? 0) - ((a as any)._score ?? 0)
  );
  // #2: domain priority boosting (user overrides on top)
  if (opts.priorityDomains?.length) {
    const p = new Set(
      opts.priorityDomains.map((d) => d.toLowerCase().replace(/^www\./u, ""))
    );
    allResults.sort(
      (a, b) =>
        (p.has(a.source_domain) ? 0 : 1) - (p.has(b.source_domain) ? 0 : 1)
    );
  }
  // Quality guardrail: if top result is stale (>1yr) and a newer official exists, swap it in
  if (wantsRecent && allResults.length > 1) {
    const top = allResults[0];
    if (top && top.published_at) {
      const topAge = Date.now() - new Date(top.published_at).getTime();
      if (topAge > 365 * 86400000) {
        const newerOfficial = allResults.find(
          (r, i) =>
            i > 0 &&
            r.is_official &&
            r.published_at &&
            Date.now() - new Date(r.published_at).getTime() < 180 * 86400000
        );
        if (newerOfficial) {
          const idx = allResults.indexOf(newerOfficial);
          allResults.splice(idx, 1);
          allResults.unshift(newerOfficial);
        }
      }
    }
  }
  // #4: explicit recency sort override
  if (opts.sortByDate) {
    allResults.sort((a, b) => {
      const cmp = (b.published_at ?? "").localeCompare(a.published_at ?? "");
      if (cmp !== 0) return cmp;
      return ((b as any)._score ?? 0) - ((a as any)._score ?? 0);
    });
  }
  if (scoringSpan && trace) endSpan(trace, scoringSpan);
  allResults.forEach((r, i) => {
    r.rank = i + 1;
    delete (r as any)._score;
  });
  // #10 Finalize trace
  const traceOutput = trace ? finalizeTrace(trace) : undefined;
  return {
    results: allResults.slice(0, limit),
    engines_tried: enginesTried,
    engines_succeeded: enginesSucceeded,
    engines_failed: enginesFailed,
    ...(wantsRecent ? { recency_aware: true } : {}),
    ...(opts.debug ? { debug_steps: debugSteps } : {}),
    ...(traceOutput ? { _trace: traceOutput } : {}),
    _versions: {
      reranker: RERANKER_VERSION,
      trustRules: TRUST_RULES_VERSION,
      server: SERVER_VERSION,
    },
  };
}

// ── #8: read_url ────────────────────────────────────────────────────
async function readUrl(
  url: string,
  opts?: {
    timeoutMs?: number;
    sections?: boolean;
    debug?: boolean;
    privacy_mode?: "normal" | "zero_trace";
    freshness_mode?: "always" | "preferred" | "fallback" | "never";
    proxy_profile?: string;
    country?: string;
    session_affinity?: boolean;
    rotation_strategy?: string;
  }
): Promise<Record<string, unknown>> {
  const cacheKey = `read:${url}`;
  const cached = getCached(cacheKey, opts?.freshness_mode);
  if (cached.hit && !cached.stale && opts?.privacy_mode !== "zero_trace")
    return {
      ...(cached.data as Record<string, unknown>),
      _cached: true,
      _cachedAt: new Date(cached.cachedAt!).toISOString(),
    };
  const start = Date.now();
  const debugSteps: { step: string; durationMs: number }[] = [];
  try {
    let html = "";

    // In zero_trace mode, bypass jobs completely and read directly via fetch
    if (opts?.privacy_mode === "zero_trace") {
      const t = Date.now();
      const res = await fetch(url, {
        headers: getStealthHeaders("unknown", getRandomUA()),
      });
      if (!res.ok)
        throw new Error(`HTTP_ERROR ${res.status} ${res.statusText}`);
      html = await res.text();
      debugSteps.push({ step: "zero_trace_fetch", durationMs: Date.now() - t });
    } else {
      const t0 = Date.now();
      const jobPayload = {
        url,
        options: {
          timeoutMs: opts?.timeoutMs ?? 20000,
          ...(opts?.proxy_profile ? { proxy_profile: opts.proxy_profile } : {}),
          ...(opts?.country ? { country: opts.country } : {}),
          ...(opts?.session_affinity
            ? { session_affinity: opts.session_affinity }
            : {}),
          ...(opts?.rotation_strategy
            ? { rotation_strategy: opts.rotation_strategy }
            : {}),
        },
      };
      const job = await withRetry(() =>
        scopedClient("browse").createJob(jobPayload as any, {
          wait: true,
          timeoutMs: opts?.timeoutMs ?? 30000,
          pollMs: 1000,
        })
      );
      if (opts?.debug)
        debugSteps.push({ step: "browse", durationMs: Date.now() - t0 });
      if (job.state !== "succeeded")
        return {
          url,
          error: "browse_failed",
          state: job.state,
          message: `Job ended with state: ${job.state}`,
          latencyMs: Date.now() - start,
        };

      const actualJobId = job.id ?? job.jobId;
      if (!actualJobId) throw new Error("No job ID returned from API");

      const artifacts = await client.listArtifacts(actualJobId);
      const htmlArt = artifacts.items?.find(
        (a: any) =>
          a.contentType?.includes("text/html") || a.label?.includes("html")
      );

      // #19: PDF detection
      const pdfArt = artifacts.items?.find(
        (a: any) =>
          a.contentType?.includes("application/pdf") ||
          a.label?.includes(".pdf")
      );
      if (pdfArt && !htmlArt) {
        const buf = await client.getArtifact(pdfArt.id ?? pdfArt.artifactId);
        const pdfText = buf
          .toString("utf-8")
          .replace(/[^\x20-\x7E\n\r\t]/g, " ")
          .replace(/\s{3,}/g, "\n")
          .trim();
        const result: Record<string, unknown> = {
          url,
          title: "PDF Document",
          markdown: pdfText.substring(0, 100000),
          format: "pdf",
          wordCount: pdfText.split(/\s+/).length,
          latencyMs: Date.now() - start,
        };
        setCache(cacheKey, result);
        return result;
      }

      if (!htmlArt)
        return {
          url,
          error: "no_html_artifact",
          message: "No HTML artifact in job output",
          latencyMs: Date.now() - start,
        };
      const s2 = Date.now();
      const buffer = await client.getArtifact(
        (htmlArt as any).id ?? (htmlArt as any).artifactId
      );
      html = buffer.toString("utf-8");
      if (opts?.debug)
        debugSteps.push({
          step: "fetch_artifact",
          durationMs: Date.now() - s2,
        });
    }

    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
    const title = titleMatch ? titleMatch[1]!.replace(/\s+/g, " ").trim() : "";
    const dateInfo = extractDateFromHtml(html);
    const s3 = Date.now();
    const markdown = turndown.turndown(html);
    if (opts?.debug)
      debugSteps.push({
        step: "convert_markdown",
        durationMs: Date.now() - s3,
      });
    const result: Record<string, unknown> = {
      url,
      title,
      markdown: markdown.substring(0, 100000),
      format: "html",
      published_at: dateInfo.date,
      dateConfidence: dateInfo.confidence,
      dateSource: dateInfo.source,
      wordCount: markdown.split(/\s+/).length,
      latencyMs: Date.now() - start,
    };
    if (opts?.sections) result.sections = extractSections(html);
    if (opts?.debug) result.debug_steps = debugSteps;
    if (opts?.privacy_mode !== "zero_trace")
      setCache(cacheKey, result, CACHE_DEFAULT_TTL_MS, html);
    // #8 Trust decay: record success
    recordTrustOutcome(extractDomain(url), true);
    return result;
  } catch (err: unknown) {
    if (
      opts?.freshness_mode === "fallback" &&
      cached.data &&
      opts?.privacy_mode !== "zero_trace"
    ) {
      return {
        ...(cached.data as Record<string, unknown>),
        _cached: true,
        _stale_fallback: true,
        _cachedAt: new Date(cached.cachedAt!).toISOString(),
      };
    }
    // #8 Trust decay: record failure
    recordTrustOutcome(extractDomain(url), false);
    const c = classifyError(err);
    return {
      url,
      error: c.error,
      message: c.message,
      latencyMs: Date.now() - start,
      _failed: true,
    };
  }
}

// ── Unified Research Pipeline (search→read→extract in one call) ────
const RESEARCH_TIMEOUT_MS = 45_000;

async function research(
  query: string,
  opts?: {
    limit?: number | undefined;
    readTop?: number | undefined;
    sections?: boolean | undefined;
    topic?: "general" | "news" | "finance";
    include_images?: boolean;
    include_image_descriptions?: boolean;
    privacy_mode?: "normal" | "zero_trace";
  }
) {
  const researchStart = Date.now();
  const startSearch = Date.now();
  const searchResult = await federatedSearch(query, {
    limit: opts?.limit ?? 5,
    topic: opts?.topic,
    include_images: opts?.include_images,
    include_image_descriptions: opts?.include_image_descriptions,
    privacy_mode: opts?.privacy_mode,
  } as any);
  const searchLatency = Date.now() - startSearch;
  const readTop = opts?.readTop ?? 1;
  const startReadLoop = Date.now();
  const pages: Record<string, unknown>[] = [];
  const failures: { url: string; error: string; reason: string }[] = [];
  let timedOut = false;
  for (let i = 0; i < Math.min(readTop, searchResult.results.length); i++) {
    // #7 Research reliability: check elapsed time before each read
    if (Date.now() - researchStart >= RESEARCH_TIMEOUT_MS) {
      timedOut = true;
      break;
    }
    const sr = searchResult.results[i]!;
    try {
      const readStart = Date.now();
      const page = await readUrl(sr.url, {
        timeoutMs: 20000,
        sections: opts?.sections ?? true,
        ...(opts?.privacy_mode ? { privacy_mode: opts.privacy_mode } : {}),
      });
      if ((page as any)._failed || (page as any).error) {
        const c = classifyError(new Error((page as any).message ?? "read_failed"));
        failures.push({ url: sr.url, error: c.error, reason: c.message });
      }
      pages.push({
        ...page,
        latencyMs: Date.now() - readStart,
        searchRank: sr.rank,
        searchEngine: sr.engine_used,
        searchDomain: sr.source_domain,
        searchIsOfficial: sr.is_official,
      });
    } catch (err) {
      const c = classifyError(err);
      failures.push({ url: sr.url, error: c.error, reason: c.message });
      pages.push({ url: sr.url, error: "read_failed", searchRank: sr.rank });
    }
  }
  return {
    query,
    searchResultCount: searchResult.results.length,
    pagesRead: pages.length,
    ...(timedOut ? { partial: true, failures } : {}),
    ...(failures.length > 0 && !timedOut ? { failures } : {}),
    timings: {
      search: searchLatency,
      readPhase: Date.now() - startReadLoop,
      total: Date.now() - researchStart,
    },
    results: searchResult.results,
    pages,
    engines_tried: searchResult.engines_tried,
    engines_succeeded: searchResult.engines_succeeded,
    engines_failed: searchResult.engines_failed,
  };
}

// ── Async Research Pipeline (#3) ──────────────────────────────────
const researchJobs = new Map<
  string,
  {
    id: string;
    state: "running" | "completed" | "failed" | "cancelled";
    query: string;
    progress: { timestamp: string; message: string }[];
    results: any;
    error?: string;
    abort: AbortController;
  }
>();

function startAsyncResearch(query: string, opts: any) {
  const id = randomUUID().substring(0, 8);
  const ac = new AbortController();
  const job: {
    id: string;
    state: "running" | "completed" | "failed" | "cancelled";
    query: string;
    progress: { timestamp: string; message: string }[];
    results: any;
    error?: string;
    abort: AbortController;
  } = {
    id,
    state: "running",
    query,
    progress: [
      {
        timestamp: new Date().toISOString(),
        message: `Started async research for "${query}"`,
      },
    ],
    results: null,
    abort: ac,
  };
  researchJobs.set(id, job);

  Promise.resolve().then(async () => {
    try {
      if (ac.signal.aborted) throw new Error("Cancelled");
      job.progress.push({
        timestamp: new Date().toISOString(),
        message: "Searching across federated engines...",
      });
      const searchResult = await federatedSearch(query, { ...opts } as any);
      if (ac.signal.aborted) throw new Error("Cancelled");
      job.progress.push({
        timestamp: new Date().toISOString(),
        message: `Found ${searchResult.results.length} results. Reading top pages...`,
      });

      const readTop = opts.readTop ?? 1;
      const pages: Record<string, unknown>[] = [];
      for (let i = 0; i < Math.min(readTop, searchResult.results.length); i++) {
        if (ac.signal.aborted) throw new Error("Cancelled");
        const sr = searchResult.results[i]!;
        job.progress.push({
          timestamp: new Date().toISOString(),
          message: `Reading URL: ${sr.url}`,
        });
        try {
          const page = await readUrl(sr.url, {
            timeoutMs: 20000,
            sections: opts.sections ?? true,
            ...(opts.privacy_mode ? { privacy_mode: opts.privacy_mode } : {}),
          });
          pages.push({
            ...page,
            searchRank: sr.rank,
            searchEngine: sr.engine_used,
          });
        } catch (readErr) {
          const c = classifyError(readErr);
          job.progress.push({
            timestamp: new Date().toISOString(),
            message: `Read error for ${sr.url}: [${c.error}] ${c.message}`,
          });
          pages.push({
            url: sr.url,
            error: "read_failed",
            errorCategory: c.error,
            searchRank: sr.rank,
          });
        }
      }
      job.results = {
        query,
        searchResultCount: searchResult.results.length,
        pagesRead: pages.length,
        results: searchResult.results,
        pages,
      };
      job.state = "completed";
      job.progress.push({
        timestamp: new Date().toISOString(),
        message: "Research completed successfully.",
      });
    } catch (e: any) {
      if (e.message === "Cancelled") {
        job.state = "cancelled";
        job.progress.push({
          timestamp: new Date().toISOString(),
          message: "Job cancelled by user.",
        });
      } else {
        const c = classifyError(e);
        job.state = "failed";
        job.error = `[${c.error}] ${c.message}`;
        job.progress.push({
          timestamp: new Date().toISOString(),
          message: `Error: [${c.error}] ${c.message}`,
        });
      }
    }
  });
  return { jobId: id, state: "running", message: "Job started" };
}

// ── Continuous Research Agent (#10) ─────────────────────────────
const continuousResearchJobs = new Map<
  string,
  {
    id: string;
    state: "running" | "completed" | "failed" | "cancelled";
    query: string;
    intervalMinutes: number;
    webhookUrl: string | undefined;
    progress: { timestamp: string; message: string }[];
    error?: string;
    abort: AbortController;
  }
>();

function startContinuousResearch(query: string, opts: { intervalMinutes?: number | undefined, webhookUrl?: string | undefined }) {
  const id = randomUUID().substring(0, 8);
  const ac = new AbortController();
  const intervalMinutes = opts.intervalMinutes ?? 60;

  const job: {
    id: string;
    state: "running" | "completed" | "failed" | "cancelled";
    query: string;
    intervalMinutes: number;
    webhookUrl: string | undefined;
    progress: { timestamp: string; message: string }[];
    error?: string;
    abort: AbortController;
  } = {
    id,
    state: "running",
    query,
    intervalMinutes,
    webhookUrl: opts.webhookUrl,
    progress: [
      {
        timestamp: new Date().toISOString(),
        message: `Started continuous research for "${query}" every ${intervalMinutes}m`,
      },
    ],
    abort: ac,
  };
  continuousResearchJobs.set(id, job);

  Promise.resolve().then(async () => {
    try {
      const watchedUrls = new Set<string>();

      while (!ac.signal.aborted) {
        job.progress.push({
          timestamp: new Date().toISOString(),
          message: "Starting continuous research cycle...",
        });

        // 1. Detect: Search
        const searchResult = await federatedSearch(query, { limit: 5 });
        if (ac.signal.aborted) throw new Error("Cancelled");

        job.progress.push({
          timestamp: new Date().toISOString(),
          message: `Discovered ${searchResult.results.length} relevant URLs.`,
        });

        const newFindings: string[] = [];

        for (const sr of searchResult.results) {
          if (ac.signal.aborted) throw new Error("Cancelled");

          if (!watchedUrls.has(sr.url)) {
            watchedUrls.add(sr.url);
            // 2. Watch First Time
            try {
              const pageContext = await readUrl(sr.url, { timeoutMs: 20000, sections: true });

              // 3. Cite / Extract
              const md = (pageContext.markdown as string) ?? "";
              const lines = md.split("\n").filter(l => l.trim().length > 30).slice(0, 2);
              if (lines.length > 0) {
                newFindings.push(`New source [${sr.source_domain}]: ${lines[0]}`);
              }
            } catch (e) {
              continue;
            }
          } else {
            // Already watching, do a semantic diff / check watch
            try {
              const changes = (await detectChanges(sr.url, 20000)) as any;
              if (changes.status === "changed") {
                const added = (changes.diff?.addedContent ?? []) as string[];
                const meaningful = added.filter((l: string) => l.length > 40).slice(0, 2);
                if (meaningful.length > 0) {
                  newFindings.push(`Update on [${sr.source_domain}]: ${meaningful[0]}`);
                }
              }
            } catch (e) {
              continue;
            }
          }
        }

        // 4. Alert
        if (newFindings.length > 0 && opts.webhookUrl) {
          job.progress.push({
            timestamp: new Date().toISOString(),
            message: `Alerting webhook on ${newFindings.length} new findings.`,
          });
          try {
            await fetch(opts.webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jobId: id,
                query,
                timestamp: new Date().toISOString(),
                newFindings,
              }),
            });
          } catch { }
        }

        job.progress.push({
          timestamp: new Date().toISOString(),
          message: `Cycle complete. Sleeping for ${intervalMinutes} minutes.`,
        });

        // Sleep loop
        let waitedMs = 0;
        const totalWaitMs = intervalMinutes * 60 * 1000;
        while (waitedMs < totalWaitMs) {
          if (ac.signal.aborted) throw new Error("Cancelled");
          await new Promise((r) => setTimeout(r, 5000));
          waitedMs += 5000;
        }
      }
    } catch (e: any) {
      if (e.message === "Cancelled") {
        job.state = "cancelled";
        job.progress.push({
          timestamp: new Date().toISOString(),
          message: "Job cancelled by user.",
        });
      } else {
        job.state = "failed";
        job.error = e.message;
        job.progress.push({
          timestamp: new Date().toISOString(),
          message: `Error: ${e.message}`,
        });
      }
    }
  });

  return { jobId: id, state: "running", message: "Continuous research job started" };
}

// ── #15: Change Detection ───────────────────────────────────────────
async function detectChanges(
  url: string,
  timeoutMs?: number
): Promise<Record<string, unknown>> {
  const cacheKey = `read:${url}`;
  const cached = getCached(cacheKey);
  // Fetch fresh
  const fresh = await readUrl(url, {
    timeoutMs: timeoutMs ?? 30000,
    sections: true,
  });
  if (!cached.hit || !cached.html)
    return {
      url,
      status: "no_previous_snapshot",
      current: {
        title: fresh.title,
        wordCount: fresh.wordCount,
        published_at: fresh.published_at,
      },
    };
  const oldMd = (cached.data as any)?.markdown ?? "";
  const newMd = fresh.markdown as string;
  const oldLines = new Set(
    oldMd
      .split("\n")
      .map((l: string) => l.trim())
      .filter(Boolean)
  );
  const newLines = newMd
    .split("\n")
    .map((l: string) => l.trim())
    .filter(Boolean);
  const added = newLines.filter((l: string) => !oldLines.has(l));
  const oldLinesArr = oldMd
    .split("\n")
    .map((l: string) => l.trim())
    .filter(Boolean);
  const newSet = new Set(newLines);
  const removed = oldLinesArr.filter((l: string) => !newSet.has(l));
  return {
    url,
    status: "changed",
    previousSnapshot: new Date(cached.cachedAt!).toISOString(),
    diff: {
      linesAdded: added.length,
      linesRemoved: removed.length,
      addedContent: added.slice(0, 30),
      removedContent: removed.slice(0, 30),
    },
    current: {
      title: fresh.title,
      wordCount: fresh.wordCount,
      published_at: fresh.published_at,
    },
  };
}

// ── #12: Citation Mode ──────────────────────────────────────────────
async function citationSearch(claims: string[], limit = 3) {
  const citations = await Promise.all(
    claims.map(async (claim) => {
      try {
        const result = await federatedSearch(claim, {
          limit,
          officialOnly: true,
        });

        const sources = result.results.map((r) => {
          const isHigh = r.is_official;
          const hasSnippet = r.snippet?.toLowerCase().includes(claim.toLowerCase().split(" ").slice(0, 3).join(" "));
          return {
            url: r.url,
            title: r.title,
            snippet: r.snippet ?? "",
            confidence: (isHigh ? "high" : hasSnippet ? "medium" : "low") as "high" | "medium" | "low",
          };
        });

        const hasStrongEvidence = sources.some(s =>
          (s.confidence === "high" || s.confidence === "medium") &&
          getDomainTrust(extractDomain(s.url)).trust >= 0.7
        );
        if (!hasStrongEvidence && sources.length > 0) {
          return {
            claim,
            error: "insufficient_evidence",
            message: "Search yielded results, but none met the necessary confidence threshold. Please broaden the query.",
            sources: [] as any[],
          };
        }

        return {
          claim,
          sources,
        };
      } catch {
        return {
          claim,
          sources: [] as {
            url: string;
            title: string;
            snippet: string;
            confidence: "high" | "medium" | "low";
          }[],
        };
      }
    })
  );
  return { citations };
}

// ── #18: GitHub Tools ───────────────────────────────────────────────
const GH_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "Kryfto-MCP/2.0",
  ...(SCOPED_TOKENS.github_releases
    ? { Authorization: `Bearer ${SCOPED_TOKENS.github_releases}` }
    : {}),
};

async function githubReleases(repo: string, limit = 5) {
  const cacheKey = `gh:${repo}`;
  const cached = getCached(cacheKey);
  if (cached.hit) return { ...(cached.data as any), _cached: true };
  const res = await fetch(
    `https://api.github.com/repos/${repo}/releases?per_page=${limit}`,
    { headers: GH_HEADERS }
  );
  if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
  const releases = (await res.json()) as any[];
  const data = {
    repo,
    releases: releases.map((r: any) => ({
      tag: r.tag_name,
      name: r.name,
      published_at: r.published_at?.substring(0, 10),
      prerelease: r.prerelease,
      body: r.body?.substring(0, 2000),
      url: r.html_url,
    })),
  };
  setCache(cacheKey, data, 30 * 60 * 1000);
  return data;
}

async function githubDiff(repo: string, fromTag: string, toTag: string) {
  const cacheKey = `ghdiff:${repo}:${fromTag}:${toTag}`;
  const cached = getCached(cacheKey);
  if (cached.hit) return { ...(cached.data as any), _cached: true };
  const res = await fetch(
    `https://api.github.com/repos/${repo}/compare/${fromTag}...${toTag}`,
    { headers: GH_HEADERS }
  );
  if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
  const diff = (await res.json()) as any;
  const data = {
    repo,
    from: fromTag,
    to: toTag,
    status: diff.status,
    aheadBy: diff.ahead_by,
    behindBy: diff.behind_by,
    totalCommits: diff.total_commits,
    commits: diff.commits?.slice(0, 20).map((c: any) => ({
      sha: c.sha?.substring(0, 7),
      message: c.commit?.message?.split("\n")[0],
      author: c.commit?.author?.name,
      date: c.commit?.author?.date?.substring(0, 10),
    })),
    files: diff.files?.slice(0, 30).map((f: any) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
  };
  setCache(cacheKey, data, 30 * 60 * 1000);
  return data;
}

async function githubIssues(
  repo: string,
  state = "open",
  limit = 10,
  labels?: string
) {
  const url = `https://api.github.com/repos/${repo}/issues?state=${state}&per_page=${limit}${labels ? `&labels=${labels}` : ""
    }`;
  const res = await fetch(url, { headers: GH_HEADERS });
  if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
  const issues = (await res.json()) as any[];
  return {
    repo,
    state,
    issues: issues.map((i: any) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      labels: i.labels?.map((l: any) => l.name),
      created_at: i.created_at?.substring(0, 10),
      url: i.html_url,
      isPR: !!i.pull_request,
    })),
  };
}

// ── #30: Dev Intel ──────────────────────────────────────────────────
async function devIntel(framework: string, type = "latest_changes") {
  const queries: Record<string, string> = {
    latest_changes: `${framework} latest release changelog ${new Date().getFullYear()}`,
    breaking_changes: `${framework} breaking changes migration guide`,
    upgrade_guide: `${framework} upgrade guide migration steps`,
  };
  const searchResult = await federatedSearch(
    queries[type] ?? queries["latest_changes"]!,
    {
      limit: 5,
      priorityDomains: [
        `${framework.toLowerCase()}.org`,
        `${framework.toLowerCase()}.dev`,
        "github.com",
      ],
    }
  );
  let topPage: Record<string, unknown> | undefined;
  if (searchResult.results.length > 0) {
    try {
      topPage = await readUrl(searchResult.results[0]!.url, {
        timeoutMs: 20000,
      });
    } catch {
      /* best effort */
    }
  }
  return {
    framework,
    type,
    search: searchResult,
    topPage: topPage
      ? {
        title: topPage.title,
        url: topPage.url,
        published_at: topPage.published_at,
        markdown: (topPage.markdown as string)?.substring(0, 15000),
      }
      : undefined,
  };
}

// ── #17: Monitors (In-Memory) ───────────────────────────────────────
const monitors = new Map<
  string,
  {
    url: string;
    label: string;
    lastChecked: string | undefined;
    lastHash: string | undefined;
  }
>();
function addMonitor(
  url: string,
  label?: string
): { id: string; url: string; label: string; status: string } {
  const id = randomUUID().substring(0, 8);
  monitors.set(id, {
    url,
    label: label ?? extractDomain(url),
    lastChecked: undefined,
    lastHash: undefined,
  });
  return { id, url, label: label ?? extractDomain(url), status: "active" };
}
function listMonitors() {
  return Array.from(monitors.entries()).map(([id, m]) => ({ id, ...m }));
}
// ── Phase 5: Advanced Intelligence Tools ────────────────────────────

// #31: Source Trust Graph — now imported from ./trust.js ──────────────

// #32: Memory Profiles — per-project preferences
const memoryProfiles = new Map<
  string,
  {
    preferredSources: string[];
    stack: string[];
    outputFormat: string;
    notes: string[];
  }
>();
function getProfile(projectId: string) {
  return (
    memoryProfiles.get(projectId) ?? {
      preferredSources: [],
      stack: [],
      outputFormat: "markdown",
      notes: [],
    }
  );
}
function setProfile(
  projectId: string,
  profile: {
    preferredSources?: string[];
    stack?: string[];
    outputFormat?: string;
    notes?: string[];
  }
) {
  const existing = getProfile(projectId);
  memoryProfiles.set(projectId, {
    preferredSources: profile.preferredSources ?? existing.preferredSources,
    stack: profile.stack ?? existing.stack,
    outputFormat: profile.outputFormat ?? existing.outputFormat,
    notes: profile.notes ?? existing.notes,
  });
  return memoryProfiles.get(projectId)!;
}

// #33: Answer with Evidence — search + read + extract evidence spans
async function answerWithEvidence(question: string, limit = 3) {
  const searchResult = await federatedSearch(question, {
    limit,
    officialOnly: false,
  });
  const evidence: {
    claim: string;
    source: string;
    sourceUrl: string;
    trust: number;
    published_at: string | undefined;
    evidenceSpan: string;
  }[] = [];
  const pages = await Promise.allSettled(
    searchResult.results
      .slice(0, limit)
      .map((r) => readUrl(r.url, { timeoutMs: 20000 }))
  );
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (page!.status !== "fulfilled") continue;
    const data = (page as PromiseFulfilledResult<Record<string, unknown>>)
      .value;
    const md = (data.markdown as string) ?? "";
    const keywords = question
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const paragraphs = md.split(/\n\n+/).filter((p) => p.length > 50);
    const relevant = paragraphs
      .filter((p) => {
        const lower = p.toLowerCase();
        return keywords.some((k) => lower.includes(k));
      })
      .slice(0, 3);
    const sr = searchResult.results[i]!;
    const trust = getDomainTrust(sr.source_domain);
    for (const span of relevant) {
      evidence.push({
        claim: span.substring(0, 300),
        source: sr.source_domain,
        sourceUrl: sr.url,
        trust: trust.trust,
        published_at: sr.published_at,
        evidenceSpan: span.substring(0, 500),
      });
    }
  }
  evidence.sort((a, b) => b.trust - a.trust);

  // #5 Evidence Quality Gates: filter to trusted evidence only
  const trustedEvidence = evidence.filter((e) => e.trust >= 0.7);
  if (trustedEvidence.length === 0) {
    return {
      question,
      error: "insufficient_evidence",
      message: "No evidence met the trust threshold (>= 0.7). Please try a more specific query or different sources.",
      _rejected_count: evidence.length,
      evidence: [],
      sources: [],
    };
  }

  return {
    question,
    evidenceCount: trustedEvidence.length,
    evidence: trustedEvidence.slice(0, 10),
    sources: searchResult.results.map((r) => ({
      url: r.url,
      domain: r.source_domain,
      trust: getDomainTrust(r.source_domain).trust,
    })),
  };
}

// #34: Conflict Detector — find contradictions across sources
async function detectConflicts(topic: string, limit = 5) {
  const searchResult = await federatedSearch(topic, { limit });
  const sourceData: {
    url: string;
    domain: string;
    trust: number;
    keyPoints: string[];
  }[] = [];
  const pages = await Promise.allSettled(
    searchResult.results
      .slice(0, limit)
      .map((r) => readUrl(r.url, { timeoutMs: 15000, sections: true }))
  );
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (page!.status !== "fulfilled") continue;
    const data = (page as PromiseFulfilledResult<Record<string, unknown>>)
      .value;
    const sections = data.sections as { headings: string[] } | undefined;
    const md = (data.markdown as string) ?? "";
    const keyPoints = md
      .split(/\n/)
      .filter((l) => l.trim().length > 20)
      .slice(0, 10)
      .map((l) => l.trim().substring(0, 200));
    const sr = searchResult.results[i]!;
    sourceData.push({
      url: sr.url,
      domain: sr.source_domain,
      trust: getDomainTrust(sr.source_domain).trust,
      keyPoints,
    });
  }
  // Find potential conflicts: claims that appear in one source but contradict implicit meaning in another
  const allClaims = sourceData.flatMap((s) =>
    s.keyPoints.map((kp) => ({
      point: kp,
      source: s.domain,
      url: s.url,
      trust: s.trust,
    }))
  );
  const potentialConflicts: {
    claim1: { point: string; source: string; trust: number };
    claim2: { point: string; source: string; trust: number };
    reason: string;
  }[] = [];
  // Detect negation conflicts (simple heuristic: same keywords but one has "not"/"no"/"don't")
  const negationWords = [
    "not",
    "no",
    "don't",
    "doesn't",
    "isn't",
    "wasn't",
    "never",
    "without",
    "deprecated",
    "removed",
  ];
  for (let i = 0; i < allClaims.length; i++) {
    for (let j = i + 1; j < allClaims.length; j++) {
      const c1 = allClaims[i]!;
      const c2 = allClaims[j]!;
      if (c1.source === c2.source) continue;
      const w1 = c1.point.toLowerCase().split(/\s+/);
      const w2 = c2.point.toLowerCase().split(/\s+/);
      const common = w1.filter((w) => w.length > 4 && w2.includes(w));
      if (common.length < 2) continue;
      const has1Neg = w1.some((w) => negationWords.includes(w));
      const has2Neg = w2.some((w) => negationWords.includes(w));
      if (has1Neg !== has2Neg)
        potentialConflicts.push({
          claim1: c1,
          claim2: c2,
          reason: `Opposing statements about "${common
            .slice(0, 3)
            .join(", ")}" — ${c1.trust > c2.trust ? c1.source : c2.source
            } is more trustworthy (trust: ${Math.max(c1.trust, c2.trust)})`,
        });
    }
  }
  return {
    topic,
    sourcesAnalyzed: sourceData.length,
    conflicts: potentialConflicts.slice(0, 10),
    sources: sourceData.map((s) => ({
      url: s.url,
      domain: s.domain,
      trust: s.trust,
      keyPointCount: s.keyPoints.length,
    })),
  };
}

// #35: Truth Maintenance — re-check cached facts, expire stale
async function truthMaintenance() {
  const stale: {
    key: string;
    url: string;
    ageMinutes: number;
    status: string;
  }[] = [];
  const valid: string[] = [];
  for (const [key, entry] of cache.entries()) {
    if (!key.startsWith("read:")) continue;
    const ageMs = Date.now() - entry.cachedAt;
    const ageMinutes = Math.round(ageMs / 60000);
    const url = key.replace("read:", "");
    if (ageMs > entry.ttlMs) {
      cache.delete(key);
      stale.push({ key, url, ageMinutes, status: "expired_and_removed" });
    } else if (ageMs > entry.ttlMs * 0.8) {
      stale.push({ key, url, ageMinutes, status: "near_expiry" });
    } else {
      valid.push(url);
    }
  }
  return {
    totalCached: cache.size,
    staleEntries: stale,
    validEntries: valid.length,
    checkedAt: new Date().toISOString(),
  };
}

// #36: Upgrade Impact Analyzer
async function upgradeImpactAnalyzer(
  framework: string,
  fromVersion: string,
  toVersion: string
) {
  const query = `${framework} ${fromVersion} to ${toVersion} migration breaking changes`;
  const searchResult = await federatedSearch(query, {
    limit: 5,
    priorityDomains: [
      `${framework.toLowerCase()}.org`,
      `${framework.toLowerCase()}.dev`,
      "github.com",
    ],
  });
  let changelogContent: Record<string, unknown> | undefined;
  if (searchResult.results.length > 0) {
    try {
      changelogContent = await readUrl(searchResult.results[0]!.url, {
        timeoutMs: 20000,
        sections: true,
      });
    } catch {
      /* */
    }
  }
  const breakingIndicators = [
    "breaking",
    "removed",
    "deprecated",
    "replaced",
    "renamed",
    "migration",
    "upgrade",
  ];
  const md = (changelogContent?.markdown as string) ?? "";
  const breakingLines = md
    .split("\n")
    .filter((l) => {
      const lower = l.toLowerCase();
      return breakingIndicators.some((bi) => lower.includes(bi));
    })
    .slice(0, 20);
  return {
    framework,
    from: fromVersion,
    to: toVersion,
    riskLevel:
      breakingLines.length > 10
        ? "high"
        : breakingLines.length > 3
          ? "medium"
          : "low",
    breakingChanges: breakingLines.map((l) => l.trim().substring(0, 300)),
    sources: searchResult.results.map((r) => ({ url: r.url, title: r.title })),
    recommendation:
      breakingLines.length > 10
        ? "Major migration effort required. Read the full migration guide."
        : breakingLines.length > 3
          ? "Some breaking changes detected. Test thoroughly."
          : "Low risk upgrade. Standard testing should suffice.",
  };
}

// #37: Query Planner — expose plan before execution
function buildQueryPlan(
  query: string,
  opts: { read?: boolean; extract?: boolean; cite?: boolean } = {}
) {
  const planId = randomUUID().substring(0, 8);
  const steps: {
    step: number;
    tool: string;
    input: Record<string, unknown>;
    estimatedCostMs: number;
  }[] = [];
  steps.push({
    step: 1,
    tool: "search",
    input: { query, limit: 5 },
    estimatedCostMs: 2000,
  });
  if (opts.read !== false) {
    steps.push({
      step: 2,
      tool: "read_url",
      input: { url: "<top_result_url>" },
      estimatedCostMs: 10000,
    });
    if (opts.extract)
      steps.push({
        step: 3,
        tool: "extract",
        input: { mode: "schema", schema: { type: "object" } },
        estimatedCostMs: 500,
      });
  }
  if (opts.cite)
    steps.push({
      step: steps.length + 1,
      tool: "cite",
      input: { claims: ["<extracted_claims>"] },
      estimatedCostMs: 5000,
    });
  return {
    planId,
    query,
    steps,
    totalEstimatedMs: steps.reduce((s, st) => s + st.estimatedCostMs, 0),
    replayable: true,
  };
}

// #38: Confidence Calibration — per-claim scoring
function calibrateConfidence(
  claims: {
    text: string;
    sourceCount: number;
    officialSources: number;
    recency: string | undefined;
    sourceTrust: number;
  }[]
): { calibrated: { text: string; confidence: number; reasoning: string }[] } {
  return {
    calibrated: claims.map((c) => {
      let score = 0.3;
      if (c.sourceCount >= 3) score += 0.2;
      else if (c.sourceCount >= 2) score += 0.1;
      if (c.officialSources >= 1) score += 0.2;
      if (c.recency) {
        const age = Date.now() - new Date(c.recency).getTime();
        if (age < 30 * 86400000) score += 0.15;
        else if (age < 365 * 86400000) score += 0.05;
      }
      score = Math.min(score + c.sourceTrust * 0.15, 0.99);
      const reasoning = `${c.sourceCount} sources, ${c.officialSources
        } official, trust=${c.sourceTrust.toFixed(2)}${c.recency ? `, date=${c.recency}` : ""
        }`;
      return {
        text: c.text,
        confidence: Math.round(score * 100) / 100,
        reasoning,
      };
    }),
  };
}

// #39: Watch and Act — enhanced monitor with webhook
const watchActions = new Map<
  string,
  {
    url: string;
    webhookUrl: string | undefined;
    label: string;
    context: string | undefined;
    lastCheck: string | undefined;
  }
>();
function addWatch(url: string, label?: string, webhookUrl?: string, context?: string) {
  const id = randomUUID().substring(0, 8);
  watchActions.set(id, {
    url,
    webhookUrl,
    label: label ?? extractDomain(url),
    context,
    lastCheck: undefined,
  });
  return {
    id,
    url,
    label: label ?? extractDomain(url),
    context: context ?? "none",
    webhookUrl: webhookUrl ?? "none",
    status: "watching",
  };
}
async function checkWatch(id: string) {
  const watch = watchActions.get(id);
  if (!watch) throw new Error(`Watch ${id} not found`);

  // Hardened pipeline using semanticDiff if context exists
  const changes = watch.context
    ? await semanticDiff(watch.url, watch.context)
    : await detectChanges(watch.url, 20000);

  watch.lastCheck = new Date().toISOString();

  let webhookStatus = "not_configured";
  let webhookError: string | undefined;

  if ((changes as any).status === "changed" && watch.webhookUrl) {
    try {
      const res = await fetch(watch.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ watchId: id, label: watch.label, timestamp: watch.lastCheck, ...changes }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      webhookStatus = "delivered";
    } catch (e: any) {
      webhookStatus = "failed";
      webhookError = e.message;
    }
  }

  return {
    watchId: id,
    ...changes,
    webhookStatus,
    webhookError,
    webhookFired: webhookStatus === "delivered" || webhookStatus === "failed",
  };
}

// #40: Semantic Diff — what changed that matters
async function semanticDiff(url: string, context?: string) {
  const changes = (await detectChanges(url, 20000)) as any;
  if (changes.status !== "changed") return changes;
  const added = (changes.diff?.addedContent ?? []) as string[];
  const removed = (changes.diff?.removedContent ?? []) as string[];
  const contextKeywords = context
    ? context
      .toLowerCase()
      .split(/\s+/)
      .filter((w: string) => w.length > 3)
    : [];
  const meaningful = {
    relevantAdditions:
      contextKeywords.length > 0
        ? added.filter((l: string) =>
          contextKeywords.some((k: string) => l.toLowerCase().includes(k))
        )
        : added.filter((l: string) => l.length > 30),
    relevantRemovals:
      contextKeywords.length > 0
        ? removed.filter((l: string) =>
          contextKeywords.some((k: string) => l.toLowerCase().includes(k))
        )
        : removed.filter((l: string) => l.length > 30),
    impactLevel: "low" as string,
  };
  meaningful.impactLevel =
    meaningful.relevantAdditions.length > 5 ||
      meaningful.relevantRemovals.length > 5
      ? "high"
      : meaningful.relevantAdditions.length > 0 ||
        meaningful.relevantRemovals.length > 0
        ? "medium"
        : "low";
  return {
    url,
    status: "analyzed",
    context: context ?? "general",
    ...meaningful,
    rawDiff: changes.diff,
  };
}

// #41: Evaluation Harness — benchmark suite
async function evaluationHarness() {
  const start = Date.now();
  const benchmarks: {
    name: string;
    passed: boolean;
    latencyMs: number;
    details: string;
  }[] = [];
  // Test 1: Search latency
  const s1 = Date.now();
  try {
    const r = await federatedSearch("test query benchmark", { limit: 3 });
    benchmarks.push({
      name: "search_latency",
      passed: true,
      latencyMs: Date.now() - s1,
      details: `${r.results.length} results from ${r.engines_succeeded.join(
        ","
      )}`,
    });
  } catch (e) {
    benchmarks.push({
      name: "search_latency",
      passed: false,
      latencyMs: Date.now() - s1,
      details: String(e),
    });
  }
  // Test 2: Cache performance
  const s2 = Date.now();
  setCache("_bench_test", { test: true }, 60000);
  const cached = getCached("_bench_test");
  cache.delete("_bench_test");
  benchmarks.push({
    name: "cache_hit",
    passed: cached.hit,
    latencyMs: Date.now() - s2,
    details: cached.hit ? "Cache working" : "Cache miss",
  });
  // Test 3: URL normalization
  const s3 = Date.now();
  const norm = normalizeUrl(
    "https://www.example.com/page?utm_source=test&fbclid=123"
  );
  benchmarks.push({
    name: "url_normalization",
    passed: norm === "https://example.com/page",
    latencyMs: Date.now() - s3,
    details: norm,
  });
  // Test 4: Error classification
  const s4 = Date.now();
  const err = classifyError(new Error("429 rate limit exceeded"));
  benchmarks.push({
    name: "error_classification",
    passed: err.error === "rate_limited",
    latencyMs: Date.now() - s4,
    details: `Classified as: ${err.error}`,
  });
  // Test 5: Trust scoring
  const s5 = Date.now();
  const trust = getDomainTrust("github.com");
  benchmarks.push({
    name: "trust_scoring",
    passed: trust.trust > 0.8,
    latencyMs: Date.now() - s5,
    details: `github.com trust: ${trust.trust}`,
  });
  const passed = benchmarks.filter((b) => b.passed).length;
  return {
    totalTests: benchmarks.length,
    passed,
    failed: benchmarks.length - passed,
    totalLatencyMs: Date.now() - start,
    benchmarks,
  };
}

// ── Zod for new tools ───────────────────────────────────────────────
const answerArgs = z.object({
  question: z.string().min(1),
  limit: z.number().int().min(1).max(10).optional(),
});
const conflictArgs = z.object({
  topic: z.string().min(1),
  limit: z.number().int().min(2).max(10).optional(),
});
const upgradeArgs = z.object({
  framework: z.string().min(1),
  fromVersion: z.string(),
  toVersion: z.string(),
});
const planArgs = z.object({
  query: z.string().min(1),
  read: z.boolean().optional(),
  extract: z.boolean().optional(),
  cite: z.boolean().optional(),
});
const calibrateArgs = z.object({
  claims: z.array(
    z.object({
      text: z.string(),
      sourceCount: z.number(),
      officialSources: z.number(),
      recency: z.string().optional(),
      sourceTrust: z.number(),
    })
  ),
});
const trustArgs = z.object({ domains: z.array(z.string().min(1)) });
const setTrustArgs = z.object({
  domain: z.string().min(1),
  trust: z.number().min(0).max(1),
});
const watchArgs = z.object({
  url: z.string().url(),
  label: z.string().optional(),
  webhookUrl: z.string().optional(),
  context: z.string().optional(),
});
const checkWatchArgs = z.object({ id: z.string() });
const semanticDiffArgs = z.object({
  url: z.string().url(),
  context: z.string().optional(),
});
const profileArgs = z.object({
  projectId: z.string(),
  preferredSources: z.array(z.string()).optional(),
  stack: z.array(z.string()).optional(),
  outputFormat: z.string().optional(),
  notes: z.array(z.string()).optional(),
});
const getProfileArgs = z.object({ projectId: z.string() });
const sloDashboardArgs = z.object({
  tool: z.string().optional(),
  windowMinutes: z.number().int().min(1).optional(),
});
const replayArgs = z.object({ requestId: z.string() });
const listReplaysArgs = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});
const evalSuiteArgs = z.object({ subset: z.array(z.string()).optional() });
const researchArgs = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10).optional(),
  readTop: z.number().int().min(1).max(5).optional(),
  sections: z.boolean().optional(),
  topic: z.enum(["general", "news", "finance"]).optional(),
  include_images: z.boolean().optional(),
  include_image_descriptions: z.boolean().optional(),
  privacy_mode: z.enum(["normal", "zero_trace"]).optional(),
  freshness_mode: z
    .enum(["always", "preferred", "fallback", "never"])
    .optional(),
  location: z.string().optional(),
  proxy_profile: z.string().optional(),
  country: z.string().optional(),
  session_affinity: z.boolean().optional(),
  rotation_strategy: z.enum(["per_request", "sticky", "random"]).optional(),
});
const researchJobGetArgs = z.object({ jobId: z.string() });
const researchJobCancelArgs = z.object({ jobId: z.string() });
const continuousResearchStartArgs = z.object({
  query: z.string().min(1),
  intervalMinutes: z.number().int().min(1).optional(),
  webhookUrl: z.string().url().optional(),
});
const continuousResearchJobGetArgs = z.object({ jobId: z.string() });
const continuousResearchJobCancelArgs = z.object({ jobId: z.string() });

// ── TOOL DEFINITIONS ────────────────────────────────────────────────
const TOOLS: any[] = [
  {
    name: "search",
    description:
      "Federated search with auto-fallback, domain boosting, operator support (site:, inurl:, exclude), recency sort, rich schema, dedup, official-only filter, locale-aware, domain blocklist. Multimodal (news, images, finance).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
        engine: {
          type: "string",
          enum: ["duckduckgo", "bing", "yahoo", "google", "brave"],
        },
        engines: { type: "array", items: { type: "string" } },
        safeSearch: { type: "string", enum: ["strict", "moderate", "off"] },
        locale: { type: "string" },
        priorityDomains: { type: "array", items: { type: "string" } },
        officialOnly: { type: "boolean" },
        site: { type: "string" },
        exclude: { type: "array", items: { type: "string" } },
        inurl: { type: "string" },
        sortByDate: { type: "boolean" },
        debug: { type: "boolean" },
        topic: { type: "string", enum: ["general", "news", "finance"] },
        include_images: { type: "boolean" },
        include_image_descriptions: { type: "boolean" },
        privacy_mode: { type: "string", enum: ["normal", "zero_trace"] },
        freshness_mode: {
          type: "string",
          enum: ["always", "preferred", "fallback", "never"],
        },
        location: { type: "string" },
        proxy_profile: { type: "string" },
        country: { type: "string" },
        session_affinity: { type: "boolean" },
        rotation_strategy: {
          type: "string",
          enum: ["per_request", "sticky", "random"],
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_url",
    description:
      "Browse URL → clean Markdown. Publish-date with confidence. Section extraction. Cached 1hr. PDF auto-detect. JS-rendered.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        timeoutMs: { type: "number" },
        sections: { type: "boolean" },
        debug: { type: "boolean" },
        privacy_mode: { type: "string", enum: ["normal", "zero_trace"] },
        freshness_mode: {
          type: "string",
          enum: ["always", "preferred", "fallback", "never"],
        },
        proxy_profile: { type: "string" },
        country: { type: "string" },
        session_affinity: { type: "boolean" },
        rotation_strategy: {
          type: "string",
          enum: ["per_request", "sticky", "random"],
        },
      },
      required: ["url"],
    },
  },
  {
    name: "read_urls",
    description:
      "Batch read up to 10 URLs concurrently with partial-result recovery.",
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" } },
        timeoutMs: { type: "number" },
      },
      required: ["urls"],
    },
  },
  {
    name: "detect_changes",
    description:
      "Compare current page against cached snapshot. Returns diff of added/removed content.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" }, timeoutMs: { type: "number" } },
      required: ["url"],
    },
  },
  {
    name: "cite",
    description:
      "Citation mode. Takes claims and finds official sources for each.",
    inputSchema: {
      type: "object",
      properties: {
        claims: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
      },
      required: ["claims"],
    },
  },
  {
    name: "answer_with_evidence",
    description:
      "Search, read top results, and return answer with exact evidence spans per claim. Includes trust scores and line-level traceability.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to answer with evidence",
        },
        limit: {
          type: "number",
          description: "Number of sources to read (default 3)",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "conflict_detector",
    description:
      "Detect contradictory claims across multiple sources about a topic. Explains which source is more trustworthy.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string" },
        limit: {
          type: "number",
          description: "Sources to compare (default 5)",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "truth_maintenance",
    description:
      "Re-check all cached facts, expire stale claims, report near-expiry entries.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "upgrade_impact",
    description:
      "Analyze breaking risk of upgrading a framework between versions. Maps changes to risk level.",
    inputSchema: {
      type: "object",
      properties: {
        framework: { type: "string" },
        fromVersion: { type: "string" },
        toVersion: { type: "string" },
      },
      required: ["framework", "fromVersion", "toVersion"],
    },
  },
  {
    name: "query_planner",
    description:
      "Expose the search/read/extract plan before execution. Returns deterministic replay-able plan with cost estimates.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        read: { type: "boolean" },
        extract: { type: "boolean" },
        cite: { type: "boolean" },
      },
      required: ["query"],
    },
  },
  {
    name: "confidence_calibration",
    description:
      "Calculate calibrated confidence scores for claims based on source count, official sources, recency, and trust.",
    inputSchema: {
      type: "object",
      properties: {
        claims: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              sourceCount: { type: "number" },
              officialSources: { type: "number" },
              recency: { type: "string" },
              sourceTrust: { type: "number" },
            },
            required: ["text", "sourceCount", "officialSources", "sourceTrust"],
          },
        },
      },
      required: ["claims"],
    },
  },
  {
    name: "source_trust",
    description:
      "Get trust scores for domains. Transparent weighting from builtin knowledge, .gov/.edu boost, docs.* boost.",
    inputSchema: {
      type: "object",
      properties: { domains: { type: "array", items: { type: "string" } } },
      required: ["domains"],
    },
  },
  {
    name: "set_source_trust",
    description:
      "Override trust score for a domain (0-1). Persists for session.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        trust: { type: "number", description: "0-1 score" },
      },
      required: ["domain", "trust"],
    },
  },
  {
    name: "watch_and_act",
    description:
      "Monitor a URL and optionally fire a webhook on changes. Returns watch ID for later checks.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        label: { type: "string" },
        webhookUrl: {
          type: "string",
          description: "Webhook to POST on changes",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "check_watch",
    description:
      "Check a watched URL for changes. Fires webhook if configured.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Watch ID from watch_and_act" },
      },
      required: ["id"],
    },
  },
  {
    name: "semantic_diff",
    description:
      "What changed that matters? Filters diff by context keywords. Returns impact level.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        context: {
          type: "string",
          description:
            'Filter changes relevant to this context (e.g. "React hooks")',
        },
      },
      required: ["url"],
    },
  },
  {
    name: "evaluation_harness",
    description:
      "Built-in benchmark suite. Tests search latency, cache, normalization, error classification, trust scoring.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_memory_profile",
    description: "Set per-project memory.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        preferredSources: { type: "array", items: { type: "string" } },
        stack: { type: "array", items: { type: "string" } },
        outputFormat: { type: "string" },
        notes: { type: "array", items: { type: "string" } },
      },
      required: ["projectId"],
    },
  },
  {
    name: "get_memory_profile",
    description: "Get per-project memory profile.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "slo_dashboard",
    description:
      "Real-time SLO dashboard. Shows per-tool success rate, latency percentiles (p50/p95/p99), cache hit rate, freshness.",
    inputSchema: {
      type: "object",
      properties: {
        tool: { type: "string", description: "Filter to specific tool" },
        windowMinutes: {
          type: "number",
          description: "Lookback window (default 60min)",
        },
      },
    },
  },
  {
    name: "replay_request",
    description:
      "Deterministic replay: retrieve the exact input/output of a previous request by its requestId.",
    inputSchema: {
      type: "object",
      properties: { requestId: { type: "string" } },
      required: ["requestId"],
    },
  },
  {
    name: "list_replays",
    description: "List recent replayable requests with their requestIds.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "How many to list (default 20)" },
      },
    },
  },
  {
    name: "run_eval_suite",
    description:
      "Built-in eval suite. Runs 10 real-world queries, checks for official source hits, measures precision and latency.",
    inputSchema: {
      type: "object",
      properties: {
        subset: {
          type: "array",
          items: { type: "string" },
          description: "Optional: run only specific eval IDs (e1-e10)",
        },
      },
    },
  },
  {
    name: "research",
    description:
      'Unified pipeline: search→read→extract in one call. Searches, reads top N pages, returns clean markdown + metadata. The stable "do it all" tool.',
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", description: "Search results (default 5)" },
        readTop: { type: "number", description: "Pages to read (default 1)" },
        sections: { type: "boolean" },
        topic: { type: "string", enum: ["general", "news", "finance"] },
        include_images: { type: "boolean" },
        include_image_descriptions: { type: "boolean" },
        privacy_mode: { type: "string", enum: ["normal", "zero_trace"] },
        freshness_mode: {
          type: "string",
          enum: ["always", "preferred", "fallback", "never"],
        },
        location: { type: "string" },
        proxy_profile: { type: "string" },
        country: { type: "string" },
        session_affinity: { type: "boolean" },
        rotation_strategy: {
          type: "string",
          enum: ["per_request", "sticky", "random"],
        },
      },
      required: ["query"],
    },
  },
  {
    name: "research_job_start",
    description:
      "Start an asynchronous research job. Returns a jobId to poll for status and results. Used for long-running deep research.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
        readTop: { type: "number" },
        sections: { type: "boolean" },
        topic: { type: "string", enum: ["general", "news", "finance"] },
        privacy_mode: { type: "string", enum: ["normal", "zero_trace"] },
        freshness_mode: {
          type: "string",
          enum: ["always", "preferred", "fallback", "never"],
        },
        location: { type: "string" },
        proxy_profile: { type: "string" },
        country: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "research_job_status",
    description:
      "Check the status, stream progress logs, and retrieve final results of an async research job.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "research_job_cancel",
    description: "Cancel a running async research job.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "continuous_research_start",
    description:
      "Start a continuous research agent. It will repeatedly search context, diff pages, and optionally fire webhooks with findings.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        intervalMinutes: { type: "number", description: "Default 60" },
        webhookUrl: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "continuous_research_status",
    description: "Check the status and logs of a continuous research agent.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "continuous_research_cancel",
    description: "Cancel a continuous research agent.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "github_releases",
    description: "Fetch GitHub releases. Cached 30min.",
    inputSchema: {
      type: "object",
      properties: { repo: { type: "string" }, limit: { type: "number" } },
      required: ["repo"],
    },
  },
  {
    name: "github_diff",
    description: "Compare two Git tags.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        fromTag: { type: "string" },
        toTag: { type: "string" },
      },
      required: ["repo", "fromTag", "toTag"],
    },
  },
  {
    name: "github_issues",
    description: "Fetch issues and PRs.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        state: { type: "string", enum: ["open", "closed", "all"] },
        limit: { type: "number" },
        labels: { type: "string" },
      },
      required: ["repo"],
    },
  },
  {
    name: "dev_intel",
    description:
      "Developer intelligence. Auto-searches + auto-reads for framework updates.",
    inputSchema: {
      type: "object",
      properties: {
        framework: { type: "string" },
        type: {
          type: "string",
          enum: ["latest_changes", "breaking_changes", "upgrade_guide"],
        },
      },
      required: ["framework"],
    },
  },
  {
    name: "add_monitor",
    description: "Register URL to watch.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" }, label: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "list_monitors",
    description: "List all monitors.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browse",
    description: "Raw headless browser job.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        recipeId: { type: "string" },
        steps: { type: "array" },
        options: { type: "object" },
      },
      required: ["url"],
    },
  },
  {
    name: "crawl",
    description: "Spider from seed URL.",
    inputSchema: {
      type: "object",
      properties: {
        seed: { type: "string" },
        rules: { type: "object" },
        recipeId: { type: "string" },
        followNav: { type: "boolean" },
        skipPatterns: { type: "array", items: { type: "string" } },
        maxPages: { type: "number" },
      },
      required: ["seed"],
    },
  },
  {
    name: "extract",
    description: "CSS/schema/plugin extraction.",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string" },
        artifactId: { type: "string" },
        selectors: { type: "object" },
        schema: { type: "object" },
        plugin: { type: "string" },
        mode: { type: "string", enum: ["selectors", "schema", "plugin"] },
      },
      required: ["mode"],
    },
  },
  {
    name: "get_job",
    description: "Job status.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "list_artifacts",
    description: "List artifacts.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "fetch_artifact",
    description: "Raw artifact bytes.",
    inputSchema: {
      type: "object",
      properties: {
        artifactId: { type: "string" },
        downloadToken: { type: "string" },
      },
      required: ["artifactId"],
    },
  },
];

// ── Dynamic Recipe Plugin Discovery ─────────────────────────────────
let lastRecipesFetch = 0;
let dynamicRecipeTools: any[] = [];
const dynamicRecipeMap = new Map<string, string>(); // toolName -> recipeId

async function getDynamicRecipeTools() {
  if (Date.now() - lastRecipesFetch < 60000) return dynamicRecipeTools;
  try {
    const res = await client.listRecipes();
    dynamicRecipeTools = res.items.map((r: any) => {
      const toolName = `recipe_${r.id
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .substring(0, 50)}`;
      dynamicRecipeMap.set(toolName, r.id);
      return {
        name: toolName,
        description: `Run Kryfto Plugin/Recipe: ${r.name}. ${r.description ?? ""
          }`,
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL to run this plugin against",
            },
          },
          required: ["url"],
        },
      };
    });
    lastRecipesFetch = Date.now();
  } catch (err) {
    /* ignore fallback to cached */
  }
  return dynamicRecipeTools;
}

// ── Main Server ─────────────────────────────────────────────────────
async function main(): Promise<void> {
  const server = new Server(
    { name: "kryfto-mcp-server", version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const dynamic = await getDynamicRecipeTools();
    return { tools: [...TOOLS, ...dynamic] };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    const requestId = randomUUID().substring(0, 8);
    const start = Date.now();
    try {
      if (name === "search") {
        const p = searchArgs.parse(args);
        const engines: SearchEngine[] | undefined =
          p.engines ??
          (p.engine
            ? [p.engine, ...FALLBACK_ENGINES.filter((e) => e !== p.engine)]
            : undefined);
        const r = await federatedSearch(p.query, {
          limit: p.limit ?? 10,
          engines,
          safeSearch: p.safeSearch,
          locale: p.locale,
          priorityDomains: p.priorityDomains,
          officialOnly: p.officialOnly,
          sortByDate: p.sortByDate,
          debug: p.debug,
          site: p.site,
          exclude: p.exclude,
          inurl: p.inurl,
          topic: p.topic,
          include_images: p.include_images,
          include_image_descriptions: p.include_image_descriptions,
          privacy_mode: p.privacy_mode,
          freshness_mode: p.freshness_mode,
          location: p.location,
          proxy_profile: p.proxy_profile,
          country: p.country,
          session_affinity: p.session_affinity,
          rotation_strategy: p.rotation_strategy,
        } as any);
        return asText(
          { query: p.query, ...r },
          { requestId, latencyMs: Date.now() - start, tool: "search" }
        );
      }
      if (name === "read_url") {
        const p = readUrlArgs.parse(args);
        const r = await readUrl(p.url, {
          timeoutMs: p.timeoutMs ?? 30000,
          sections: p.sections ?? false,
          debug: p.debug ?? false,
          ...(p.privacy_mode ? { privacy_mode: p.privacy_mode } : {}),
          ...(p.freshness_mode ? { freshness_mode: p.freshness_mode } : {}),
          ...(p.proxy_profile ? { proxy_profile: p.proxy_profile } : {}),
          ...(p.country ? { country: p.country } : {}),
          ...(p.session_affinity
            ? { session_affinity: p.session_affinity }
            : {}),
          ...(p.rotation_strategy
            ? { rotation_strategy: p.rotation_strategy }
            : {}),
        });
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          cached: !!(r as any)._cached,
          tool: "read_url",
        });
      }
      if (name === "read_urls") {
        const p = batchReadUrlsArgs.parse(args);
        const results = await Promise.allSettled(
          p.urls.map((u) => readUrl(u, { timeoutMs: p.timeoutMs ?? 30000 }))
        );
        return asText(
          results.map((r, i) =>
            r.status === "fulfilled"
              ? r.value
              : { url: p.urls[i], ...classifyError(r.reason) }
          ),
          { requestId, latencyMs: Date.now() - start, tool: "read_urls" }
        );
      }
      if (name === "detect_changes") {
        const p = changeDetectArgs.parse(args);
        const r = await detectChanges(p.url, p.timeoutMs);
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "detect_changes",
        });
      }
      if (name === "cite") {
        const p = citationArgs.parse(args);
        const r = await citationSearch(p.claims, p.limit);
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "cite",
        });
      }
      // Phase 5 tools
      if (name === "answer_with_evidence") {
        const p = answerArgs.parse(args);
        const r = await answerWithEvidence(p.question, p.limit ?? 3);
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "answer_with_evidence",
        });
      }
      if (name === "conflict_detector") {
        const p = conflictArgs.parse(args);
        const r = await detectConflicts(p.topic, p.limit ?? 5);
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "conflict_detector",
        });
      }
      if (name === "truth_maintenance") {
        const r = await truthMaintenance();
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "truth_maintenance",
        });
      }
      if (name === "upgrade_impact") {
        const p = upgradeArgs.parse(args);
        const r = await upgradeImpactAnalyzer(
          p.framework,
          p.fromVersion,
          p.toVersion
        );
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "upgrade_impact",
        });
      }
      if (name === "query_planner") {
        const p = planArgs.parse(args);
        const r = buildQueryPlan(p.query, {
          read: p.read,
          extract: p.extract,
          cite: p.cite,
        } as any);
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "query_planner",
        });
      }
      if (name === "confidence_calibration") {
        const p = calibrateArgs.parse(args);
        const r = calibrateConfidence(p.claims as any);
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "confidence_calibration",
        });
      }
      if (name === "source_trust") {
        const p = trustArgs.parse(args);
        return asText(
          { domains: p.domains.map((d) => getDomainTrust(d)) },
          { requestId, latencyMs: Date.now() - start, tool: "source_trust" }
        );
      }
      if (name === "set_source_trust") {
        const p = setTrustArgs.parse(args);
        customTrust.set(p.domain.replace(/^www\./u, "").toLowerCase(), p.trust);
        return asText(
          { domain: p.domain, trust: p.trust, status: "set" },
          { requestId, latencyMs: Date.now() - start, tool: "set_source_trust" }
        );
      }
      if (name === "watch_and_act") {
        const p = watchArgs.parse(args);
        const r = addWatch(p.url, p.label, p.webhookUrl, p.context);
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "watch_and_act",
        });
      }
      if (name === "check_watch") {
        const p = checkWatchArgs.parse(args);
        const r = await checkWatch(p.id);
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "check_watch",
        });
      }
      if (name === "semantic_diff") {
        const p = semanticDiffArgs.parse(args);
        const r = await semanticDiff(p.url, p.context);
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "semantic_diff",
        });
      }
      if (name === "evaluation_harness") {
        const r = await evaluationHarness();
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "evaluation_harness",
        });
      }
      if (name === "set_memory_profile") {
        const p = profileArgs.parse(args);
        const r = setProfile(p.projectId, {
          preferredSources: p.preferredSources,
          stack: p.stack,
          outputFormat: p.outputFormat,
          notes: p.notes,
        } as any);
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "set_memory_profile",
        });
      }
      if (name === "get_memory_profile") {
        const p = getProfileArgs.parse(args);
        const r = getProfile(p.projectId);
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "get_memory_profile",
        });
      }
      if (name === "slo_dashboard") {
        const p = sloDashboardArgs.parse(args);
        const r = getSLODashboard(p.tool, p.windowMinutes ?? 60);
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "slo_dashboard",
        });
      }
      if (name === "replay_request") {
        const p = replayArgs.parse(args);
        const r = replayRequest(p.requestId);
        if (!r)
          return asError(
            "not_found",
            `No replay found for requestId: ${p.requestId}`,
            { requestId }
          );
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "replay_request",
        });
      }
      if (name === "list_replays") {
        const p = listReplaysArgs.parse(args);
        const r = listReplays(p.limit ?? 20);
        return asText(
          {
            replays: r.map((e) => ({
              requestId: e.requestId,
              tool: e.tool,
              timestamp: new Date(e.timestamp).toISOString(),
              latencyMs: e.latencyMs,
            })),
          },
          { requestId, latencyMs: Date.now() - start, tool: "list_replays" }
        );
      }
      if (name === "run_eval_suite") {
        const p = evalSuiteArgs.parse(args);
        const r = await runEvalSuite(p.subset);
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "run_eval_suite",
        });
      }
      if (name === "research") {
        const p = researchArgs.parse(args);
        const r = await research(p.query, {
          limit: p.limit,
          readTop: p.readTop,
          sections: p.sections,
          ...(p.topic ? { topic: p.topic } : {}),
          ...(p.include_images ? { include_images: p.include_images } : {}),
          ...(p.include_image_descriptions
            ? { include_image_descriptions: p.include_image_descriptions }
            : {}),
          ...(p.privacy_mode ? { privacy_mode: p.privacy_mode } : {}),
          ...(p.freshness_mode ? { freshness_mode: p.freshness_mode } : {}),
          ...(p.location ? { location: p.location } : {}),
          ...(p.proxy_profile ? { proxy_profile: p.proxy_profile } : {}),
          ...(p.country ? { country: p.country } : {}),
          ...(p.session_affinity
            ? { session_affinity: p.session_affinity }
            : {}),
          ...(p.rotation_strategy
            ? { rotation_strategy: p.rotation_strategy }
            : {}),
        });
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "research",
        });
      }
      if (name === "research_job_start") {
        const p = researchArgs.parse(args);
        const r = startAsyncResearch(p.query, {
          limit: p.limit,
          readTop: p.readTop,
          sections: p.sections,
          topic: p.topic,
          privacy_mode: p.privacy_mode,
          freshness_mode: p.freshness_mode,
          location: p.location,
          proxy_profile: p.proxy_profile,
          country: p.country,
          session_affinity: p.session_affinity,
          rotation_strategy: p.rotation_strategy,
        });
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "research_job_start",
        });
      }
      if (name === "research_job_status") {
        const p = researchJobGetArgs.parse(args);
        const job = researchJobs.get(p.jobId);
        if (!job)
          return asError("not_found", `Job not found: ${p.jobId}`, {
            requestId,
          });
        // Strip out the internal abort controller so it can serialize
        const { abort, ...safeJob } = job;
        return asText(safeJob, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "research_job_status",
        });
      }
      if (name === "research_job_cancel") {
        const p = researchJobCancelArgs.parse(args);
        const job = researchJobs.get(p.jobId);
        if (!job)
          return asError("not_found", `Job not found: ${p.jobId}`, {
            requestId,
          });
        if (job.state === "running") {
          job.abort.abort();
          job.state = "cancelled";
        }
        return asText(
          { jobId: p.jobId, state: job.state },
          {
            requestId,
            latencyMs: Date.now() - start,
            tool: "research_job_cancel",
          }
        );
      }
      if (name === "continuous_research_start") {
        const p = continuousResearchStartArgs.parse(args);
        const r = startContinuousResearch(p.query, {
          intervalMinutes: p.intervalMinutes,
          webhookUrl: p.webhookUrl,
        });
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "continuous_research_start",
        });
      }
      if (name === "continuous_research_status") {
        const p = continuousResearchJobGetArgs.parse(args);
        const job = continuousResearchJobs.get(p.jobId);
        if (!job)
          return asError("not_found", `Job not found: ${p.jobId}`, {
            requestId,
          });
        const { abort, ...safeJob } = job;
        return asText(safeJob, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "continuous_research_status",
        });
      }
      if (name === "continuous_research_cancel") {
        const p = continuousResearchJobCancelArgs.parse(args);
        const job = continuousResearchJobs.get(p.jobId);
        if (!job)
          return asError("not_found", `Job not found: ${p.jobId}`, {
            requestId,
          });
        if (job.state === "running") {
          job.abort.abort();
          job.state = "cancelled";
        }
        return asText(
          { jobId: p.jobId, state: job.state },
          {
            requestId,
            latencyMs: Date.now() - start,
            tool: "continuous_research_cancel",
          }
        );
      }
      if (name === "github_releases") {
        const p = githubReleasesArgs.parse(args);
        const r = await withRetry(() => githubReleases(p.repo, p.limit));
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "github_releases",
        });
      }
      if (name === "github_diff") {
        const p = githubDiffArgs.parse(args);
        const r = await withRetry(() => githubDiff(p.repo, p.fromTag, p.toTag));
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "github_diff",
        });
      }
      if (name === "github_issues") {
        const p = githubIssuesArgs.parse(args);
        const r = await withRetry(() =>
          githubIssues(p.repo, p.state, p.limit, p.labels)
        );
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "github_issues",
        });
      }
      if (name === "dev_intel") {
        const p = devIntelArgs.parse(args);
        const r = await devIntel(p.framework, p.type);
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "dev_intel",
        });
      }
      if (name === "add_monitor") {
        const p = monitorArgs.parse(args);
        return asText(addMonitor(p.url, p.label), {
          requestId,
          latencyMs: Date.now() - start,
          tool: "add_monitor",
        });
      }
      if (name === "list_monitors") {
        return asText(
          { monitors: listMonitors() },
          { requestId, latencyMs: Date.now() - start, tool: "list_monitors" }
        );
      }
      if (name === "browse") {
        const p = browseArgs.parse(args);
        const r = await withRetry(() =>
          scopedClient("browse").createJob(
            {
              url: p.url,
              ...(p.recipeId ? { recipeId: p.recipeId } : {}),
              ...(p.steps ? { steps: p.steps as any } : {}),
            } as any,
            {
              wait: p.options?.wait ?? false,
              timeoutMs: p.options?.timeoutMs ?? 30000,
              pollMs: p.options?.pollMs ?? 1000,
            }
          )
        );
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "browse",
        });
      }
      if (name === "crawl") {
        const p = crawlArgs.parse(args);
        const r = await withRetry(() =>
          scopedClient("crawl").crawl({
            seed: p.seed,
            ...(p.rules ? { rules: p.rules as any } : {}),
            ...(p.recipeId ? { recipeId: p.recipeId } : {}),
          } as any)
        );
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "crawl",
        });
      }
      if (name === "extract") {
        const p = extractArgs.parse(args);
        const r = await withRetry(() =>
          scopedClient("extract").extract({
            mode: p.mode,
            ...(p.input ? { html: p.input } : {}),
            ...(p.artifactId ? { artifactId: p.artifactId } : {}),
            ...(p.selectors ? { selectors: p.selectors } : {}),
            ...(p.schema ? { jsonSchema: p.schema } : {}),
            ...(p.plugin ? { plugin: p.plugin } : {}),
          } as any)
        );
        return asText(r, {
          requestId,
          latencyMs: Date.now() - start,
          tool: "extract",
        });
      }

      // Dynamic Plugin Handlers
      if (name.startsWith("recipe_")) {
        const recipeId = dynamicRecipeMap.get(name);
        if (!recipeId)
          throw new Error(`Unknown dynamic recipe plugin: ${name}`);
        const p = z.object({ url: z.string().url() }).parse(args);

        const r = await withRetry(() =>
          scopedClient("browse").createJob({ url: p.url, recipeId } as any, {
            wait: true,
            timeoutMs: 60000,
            pollMs: 1000,
          })
        );

        if (r.state !== "succeeded") {
          return asError(
            "unknown",
            `Plugin execution failed. State: ${r.state}`,
            { requestId, latencyMs: Date.now() - start, details: r }
          );
        }

        const actualJobId = r.id ?? r.jobId;
        const artifacts = await client.listArtifacts(actualJobId);

        // Prioritize returning extracted JSON
        const jsonArt = artifacts.items?.find(
          (a: any) =>
            a.contentType?.includes("application/json") ||
            a.label?.includes("extract")
        );
        let extractedData = null;
        if (jsonArt) {
          try {
            const buf = await client.getArtifact(
              jsonArt.id ?? jsonArt.artifactId
            );
            extractedData = JSON.parse(buf.toString("utf-8"));
          } catch {
            /* ignore parsing errors and fallback */
          }
        }

        if (extractedData) {
          return asText(
            {
              url: p.url,
              plugin: recipeId,
              data: extractedData,
              artifacts: artifacts.items?.length,
            },
            { requestId, latencyMs: Date.now() - start, tool: name }
          );
        }

        return asText(
          { url: p.url, plugin: recipeId, job: r, artifacts: artifacts.items },
          { requestId, latencyMs: Date.now() - start, tool: name }
        );
      }

      if (name === "get_job") {
        const p = getJobArgs.parse(args);
        return asText(await client.getJob(p.jobId), {
          requestId,
          latencyMs: Date.now() - start,
          tool: "get_job",
        });
      }
      if (name === "list_artifacts") {
        const p = listArtifactsArgs.parse(args);
        return asText(await client.listArtifacts(p.jobId), {
          requestId,
          latencyMs: Date.now() - start,
          tool: "list_artifacts",
        });
      }
      if (name === "fetch_artifact") {
        const p = fetchArtifactArgs.parse(args);
        const bytes = await client.getArtifact(
          p.artifactId,
          p.downloadToken
            ? ({ downloadToken: p.downloadToken } as any)
            : undefined
        );
        return asText(
          { artifactId: p.artifactId, base64: bytes.toString("base64") },
          { requestId, latencyMs: Date.now() - start, tool: "fetch_artifact" }
        );
      }
      throw new Error(`Unknown tool: ${name}`);
    } catch (err) {
      const c = classifyError(err);
      return asError(c.error, c.message, { tool: name, requestId });
    }
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  process.stderr.write(`${String(e)}\n`);
  process.exit(1);
});
