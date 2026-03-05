import { randomUUID } from "node:crypto";
import { classifyError } from "../helpers.js";
import { federatedSearch } from "./search.js";
import { readUrl } from "./read.js";

const RESEARCH_TIMEOUT_MS = 45_000;

export async function research(
    query: string,
    opts?: {
        limit?: number | undefined;
        readTop?: number | undefined;
        sections?: boolean | undefined;
        topic?: "general" | "news" | "finance" | undefined;
        include_images?: boolean | undefined;
        include_image_descriptions?: boolean | undefined;
        privacy_mode?: "normal" | "zero_trace" | undefined;
        freshness_mode?: "always" | "preferred" | "fallback" | "never" | undefined;
        location?: string | undefined;
        proxy_profile?: string | undefined;
        country?: string | undefined;
        session_affinity?: boolean | undefined;
        rotation_strategy?: "per_request" | "sticky" | "random" | undefined;
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
    });
    const searchLatency = Date.now() - startSearch;
    const readTop = opts?.readTop ?? 1;
    const startReadLoop = Date.now();
    const pages: Record<string, unknown>[] = [];
    const failures: { url: string; error: string; reason: string }[] = [];
    let timedOut = false;

    for (let i = 0; i < Math.min(readTop, searchResult.results.length); i++) {
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
            const pageRecord = page as Record<string, unknown>;
            if (pageRecord._failed || pageRecord.error) {
                const c = classifyError(new Error(String(pageRecord.message ?? "read_failed")));
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

export const researchJobs = new Map<
    string,
    {
        id: string;
        state: "running" | "completed" | "failed" | "cancelled";
        query: string;
        progress: { timestamp: string; message: string }[];
        results: Record<string, unknown> | null;
        error?: string;
        abort: AbortController;
    }
>();

export function startAsyncResearch(query: string, opts: NonNullable<Parameters<typeof research>[1]>) {
    const id = randomUUID().substring(0, 8);
    const ac = new AbortController();
    const job: {
        id: string;
        state: "running" | "completed" | "failed" | "cancelled";
        query: string;
        progress: { timestamp: string; message: string }[];
        results: Record<string, unknown> | null;
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
            const searchResult = await federatedSearch(query, { ...opts });
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
        } catch (e: unknown) {
            if (e instanceof Error && e.message === "Cancelled") {
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

    return { jobId: id };
}
