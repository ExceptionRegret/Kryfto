// ── Shared types for the MCP server ─────────────────────────────────

export interface EngineErrorMetric {
    engine: string;
    errorClass:
    | "dns"
    | "tls"
    | "timeout"
    | "http_4xx"
    | "http_5xx"
    | "parse"
    | "empty"
    | "network"
    | "unknown";
    message: string;
    timestamp: number;
}

export type DirectSearchResult = {
    title: string;
    url: string;
    snippet?: string;
    rank: number;
};

export interface EnrichedResult {
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

export type ErrorCategory =
    | "blocked"
    | "rate_limited"
    | "empty_engine"
    | "parse_failed"
    | "timeout"
    | "network_error"
    | "not_found"
    | "unknown";

export interface SLORecord {
    tool: string;
    success: boolean;
    latencyMs: number;
    timestamp: number;
    cached: boolean;
    requestId: string;
}

export interface ReplayEntry {
    requestId: string;
    tool: string;
    args: unknown;
    result: unknown;
    timestamp: number;
    latencyMs: number;
}

export interface CacheEntry {
    data: unknown;
    cachedAt: number;
    ttlMs: number;
    html: string | undefined;
}

export type SearchEngine =
    | "duckduckgo"
    | "brave"
    | "bing"
    | "yahoo"
    | "google";

export type FreshnessMode = "always" | "preferred" | "fallback" | "never";

export interface McpMeta {
    requestId?: string;
    latencyMs?: number;
    cached?: boolean;
    tool?: string;
}

export const FALLBACK_ENGINES = [
    "duckduckgo",
    "brave",
    "bing",
    "yahoo",
    "google",
] as const;

export const MAX_RETRIES = 3;
export const RETRY_BASE_MS = 500;
export const CACHE_DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
