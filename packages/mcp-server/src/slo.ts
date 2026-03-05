// ── SLO Metrics & Replay Store ──────────────────────────────────────
import type { SLORecord, ReplayEntry } from "./types.js";

const sloHistory: SLORecord[] = [];
const MAX_SLO_HISTORY = 10000;

export function recordSLO(
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

export function percentile(arr: number[], p: number): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((sorted.length * p) / 100) - 1;
    return sorted[Math.max(0, idx)] ?? 0;
}

export function getSLODashboard(toolFilter?: string, windowMinutes = 60) {
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
const replayStore = new Map<string, ReplayEntry>();
const MAX_REPLAY_STORE = 1000;

export function storeReplay(
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

export function replayRequest(requestId: string): ReplayEntry | undefined {
    return replayStore.get(requestId);
}

export function listReplays(limit = 20) {
    return Array.from(replayStore.values()).slice(-limit).reverse();
}
