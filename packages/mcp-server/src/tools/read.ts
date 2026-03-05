import { CollectorClient } from "@kryfto/sdk-ts";
import TurndownService from "turndown";
// @ts-ignore
import { gfm } from "turndown-plugin-gfm";
import { getRandomUA, getStealthHeaders } from "@kryfto/shared";
import { getCached, setCache, CACHE_DEFAULT_TTL_MS } from "../cache.js";
import {
    extractDateFromHtml,
    extractSections,
    withRetry,
    classifyError,
} from "../helpers.js";
import { recordTrustOutcome } from "../trust.js";
import { extractDomain } from "../url-utils.js";
import type { FreshnessMode } from "../types.js";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:8080";
const API_TOKEN = process.env.API_TOKEN ?? process.env.KRYFTO_API_TOKEN;

function getClient(tool: string): CollectorClient {
    const token = process.env[`KRYFTO_${tool.toUpperCase()}_TOKEN`] || API_TOKEN;
    return new CollectorClient({
        baseUrl: API_BASE_URL,
        token,
    });
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

export async function readUrl(
    url: string,
    opts?: {
        timeoutMs?: number;
        sections?: boolean;
        debug?: boolean;
        privacy_mode?: "normal" | "zero_trace";
        freshness_mode?: FreshnessMode;
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
    const client = getClient("browse");

    try {
        let html = "";

        if (opts?.privacy_mode === "zero_trace") {
            const t = Date.now();
            const res = await fetch(url, {
                headers: getStealthHeaders("unknown", getRandomUA()),
            });
            if (!res.ok) throw new Error(`HTTP_ERROR ${res.status} ${res.statusText}`);
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
                    ...(opts?.session_affinity ? { session_affinity: opts.session_affinity } : {}),
                    ...(opts?.rotation_strategy ? { rotation_strategy: opts.rotation_strategy } : {}),
                },
            };
            const job = await withRetry(() =>
                client.createJob(jobPayload, {
                    wait: true,
                    timeoutMs: opts?.timeoutMs ?? 30000,
                    pollMs: 1000,
                })
            );
            if (opts?.debug) debugSteps.push({ step: "browse", durationMs: Date.now() - t0 });
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
                (a) => a.contentType?.includes("text/html") || a.label?.includes("html")
            );
            const pdfArt = artifacts.items?.find(
                (a) => a.contentType?.includes("application/pdf") || a.label?.includes(".pdf")
            );

            if (pdfArt && !htmlArt) {
                const pdfArtId = pdfArt.id ?? pdfArt.artifactId;
                if (!pdfArtId) throw new Error("PDF artifact missing id");
                const buf = await client.getArtifact(pdfArtId);
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
                setCache(cacheKey, result, CACHE_DEFAULT_TTL_MS);
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
            const artRecord = htmlArt as Record<string, unknown>;
            const buffer = await client.getArtifact(String(artRecord.id ?? artRecord.artifactId));
            html = buffer.toString("utf-8");
            if (opts?.debug) debugSteps.push({ step: "fetch_artifact", durationMs: Date.now() - s2 });
        }

        const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
        const title = titleMatch ? titleMatch[1]!.replace(/\s+/g, " ").trim() : "";
        const dateInfo = extractDateFromHtml(html);
        const s3 = Date.now();
        const markdown = turndown.turndown(html);
        if (opts?.debug) debugSteps.push({ step: "convert_markdown", durationMs: Date.now() - s3 });

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
        if (opts?.privacy_mode !== "zero_trace") setCache(cacheKey, result, CACHE_DEFAULT_TTL_MS, html);
        recordTrustOutcome(extractDomain(url), true);
        return result;
    } catch (err: unknown) {
        if (opts?.freshness_mode === "fallback" && cached.data && opts?.privacy_mode !== "zero_trace") {
            return {
                ...(cached.data as Record<string, unknown>),
                _cached: true,
                _stale_fallback: true,
                _cachedAt: new Date(cached.cachedAt!).toISOString(),
            };
        }
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
