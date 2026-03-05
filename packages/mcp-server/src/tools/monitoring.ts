import { randomUUID } from "node:crypto";
import { getCached } from "../cache.js";
import { readUrl } from "./read.js";
import { federatedSearch } from "./search.js";
import { extractDomain } from "../url-utils.js";
import { classifyError } from "../helpers.js";

// ── #17: Monitors (In-Memory) ───────────────────────────────────────
export const monitors = new Map<
    string,
    {
        url: string;
        label: string;
        lastChecked: string | undefined;
        lastHash: string | undefined;
    }
>();

export function addMonitor(
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

export function listMonitors() {
    return Array.from(monitors.entries()).map(([id, m]) => ({ id, ...m }));
}

// ── #15: Change Detection ───────────────────────────────────────────
export async function detectChanges(
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
    const oldMd = String((cached.data as Record<string, unknown>)?.markdown ?? "");
    const newMd = String(fresh.markdown ?? "");
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

// #40: Semantic Diff — what changed that matters
export async function semanticDiff(url: string, context?: string) {
    const changes = await detectChanges(url, 20000);
    if (changes.status !== "changed") return changes;
    const diff = changes.diff as { addedContent?: string[]; removedContent?: string[] } | undefined;
    const added = diff?.addedContent ?? [];
    const removed = diff?.removedContent ?? [];
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

// #39: Watch and Act — enhanced monitor with webhook
export const watchActions = new Map<
    string,
    {
        url: string;
        webhookUrl: string | undefined;
        label: string;
        context: string | undefined;
        lastCheck: string | undefined;
    }
>();

export function addWatch(url: string, label?: string, webhookUrl?: string, context?: string) {
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

export async function checkWatch(id: string) {
    const watch = watchActions.get(id);
    if (!watch) throw new Error(`Watch ${id} not found`);

    // Hardened pipeline using semanticDiff if context exists
    const changes = watch.context
        ? await semanticDiff(watch.url, watch.context)
        : await detectChanges(watch.url, 20000);

    watch.lastCheck = new Date().toISOString();

    let webhookStatus = "not_configured";
    let webhookError: string | undefined;

    if (changes.status === "changed" && watch.webhookUrl) {
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
        } catch (e: unknown) {
            webhookStatus = "failed";
            webhookError = e instanceof Error ? e.message : String(e);
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

// ── Continuous Research Agent ────────────────────────────────────────
export const continuousResearchJobs = new Map<
    string,
    {
        id: string;
        state: "running" | "completed" | "cancelled";
        query: string;
        intervalMinutes: number;
        webhookUrl: string | undefined;
        iterations: number;
        logs: { timestamp: string; message: string }[];
        abort: AbortController;
    }
>();

export function startContinuousResearch(
    query: string,
    opts?: { intervalMinutes?: number; webhookUrl?: string }
) {
    const id = randomUUID().substring(0, 8);
    const ac = new AbortController();
    const intervalMinutes = opts?.intervalMinutes ?? 60;

    const job = {
        id,
        state: "running" as const,
        query,
        intervalMinutes,
        webhookUrl: opts?.webhookUrl,
        iterations: 0,
        logs: [
            {
                timestamp: new Date().toISOString(),
                message: `Started continuous research for "${query}" every ${intervalMinutes}min`,
            },
        ],
        abort: ac,
    };
    continuousResearchJobs.set(id, job);

    const runIteration = async () => {
        if (ac.signal.aborted) return;
        job.iterations++;
        job.logs.push({
            timestamp: new Date().toISOString(),
            message: `Iteration #${job.iterations}: searching...`,
        });
        try {
            const searchResult = await federatedSearch(query, { limit: 5 });
            job.logs.push({
                timestamp: new Date().toISOString(),
                message: `Found ${searchResult.results.length} results`,
            });

            // Check for changes via semantic diff on top result
            if (searchResult.results.length > 0) {
                const topUrl = searchResult.results[0]!.url;
                const changes = await detectChanges(topUrl);
                if ((changes as Record<string, unknown>).status === "changed" && opts?.webhookUrl) {
                    try {
                        await fetch(opts.webhookUrl, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                jobId: id,
                                query,
                                iteration: job.iterations,
                                timestamp: new Date().toISOString(),
                                changes,
                            }),
                        });
                        job.logs.push({
                            timestamp: new Date().toISOString(),
                            message: "Webhook delivered",
                        });
                    } catch (webhookErr) {
                        job.logs.push({
                            timestamp: new Date().toISOString(),
                            message: `Webhook failed: ${webhookErr instanceof Error ? webhookErr.message : String(webhookErr)}`,
                        });
                    }
                }
            }
        } catch (err) {
            const c = classifyError(err);
            job.logs.push({
                timestamp: new Date().toISOString(),
                message: `Error: [${c.error}] ${c.message}`,
            });
        }
    };

    // Run first iteration immediately, then schedule
    runIteration().then(() => {
        if (ac.signal.aborted) return;
        const interval = setInterval(() => {
            if (ac.signal.aborted) {
                clearInterval(interval);
                return;
            }
            runIteration();
        }, intervalMinutes * 60 * 1000);

        ac.signal.addEventListener("abort", () => clearInterval(interval));
    });

    return { jobId: id, intervalMinutes, status: "running" };
}
