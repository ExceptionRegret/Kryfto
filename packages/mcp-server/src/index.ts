import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { SERVER_VERSION } from "./version.js";
import { asText, asError, classifyError, withRetry } from "./helpers.js";
import { getDomainTrust, customTrust } from "./trust.js";

// Tool Registers & Schemas
import { TOOLS } from "./tools/registry.js";
import * as schemas from "./tools/registry.js";

// Tool implementations
import { federatedSearch } from "./tools/search.js";
import { readUrl } from "./tools/read.js";
import { research, startAsyncResearch, researchJobs } from "./tools/research.js";
import { startContinuousResearch, continuousResearchJobs, addMonitor, listMonitors, detectChanges, semanticDiff, checkWatch, addWatch } from "./tools/monitoring.js";
import { answerWithEvidence, detectConflicts, citationSearch, calibrateConfidence } from "./tools/evidence.js";
import { githubReleases, githubDiff, githubIssues } from "./tools/github.js";
import { devIntel, upgradeImpactAnalyzer } from "./tools/intelligence.js";
import { client, scopedClient } from "./tools/jobs.js";
import { dynamicRecipeMap, getDynamicRecipeTools } from "./tools/jobs.js";
import { setProfile, getProfile } from "./tools/memory.js";
import { getSLODashboard, listReplays, replayRequest } from "./slo.js";
import { runEvalSuite } from "./tools/observability.js";
import { getRawCache } from "./cache.js";
import { getEngineHealth } from "./circuit-breaker.js";
import { getEngineErrorMetrics } from "./helpers.js";
import { FALLBACK_ENGINES } from "./types.js";

type ToolHandler = (args: Record<string, unknown>, meta: { requestId: string; start: number; tool: string }) => Promise<unknown>;

// ── Inline helpers for tools that don't need their own module ─────────

function truthMaintenance() {
    const cache = getRawCache();
    const now = Date.now();
    const expired: string[] = [];
    const nearExpiry: { key: string; expiresIn: string }[] = [];
    const valid: string[] = [];

    for (const [key, entry] of cache) {
        const ageMs = now - entry.cachedAt;
        const remainingMs = entry.ttlMs - ageMs;
        if (remainingMs <= 0) {
            expired.push(key);
            cache.delete(key);
        } else if (remainingMs < 10 * 60 * 1000) {
            nearExpiry.push({
                key,
                expiresIn: `${Math.round(remainingMs / 1000)}s`,
            });
        } else {
            valid.push(key);
        }
    }

    return {
        expired: expired.length,
        expiredKeys: expired.slice(0, 20),
        nearExpiry: nearExpiry.slice(0, 20),
        validEntries: valid.length,
        totalCacheSize: cache.size,
        timestamp: new Date().toISOString(),
    };
}

function buildQueryPlan(
    query: string,
    opts: { read?: boolean | undefined; extract?: boolean | undefined; cite?: boolean | undefined }
) {
    const steps: { step: string; tool: string; estimated_ms: number }[] = [];
    steps.push({
        step: "Search across federated engines",
        tool: "search",
        estimated_ms: 2000,
    });
    if (opts.read !== false) {
        steps.push({
            step: "Read top result pages",
            tool: "read_url",
            estimated_ms: 5000,
        });
    }
    if (opts.extract) {
        steps.push({
            step: "Extract structured data",
            tool: "extract",
            estimated_ms: 3000,
        });
    }
    if (opts.cite) {
        steps.push({
            step: "Find citations for claims",
            tool: "cite",
            estimated_ms: 4000,
        });
    }
    const totalEstimatedMs = steps.reduce((sum, s) => sum + s.estimated_ms, 0);
    return {
        query,
        steps,
        totalSteps: steps.length,
        estimatedTotalMs: totalEstimatedMs,
        replayable: true,
    };
}

// ── Map-Based Router ────────────────────────────────────────────────────────
const handlers = new Map<string, ToolHandler>();

handlers.set("search", async (args) => {
  const p = schemas.searchArgs.parse(args);
  return await federatedSearch(p.query, {
    limit: p.limit ?? 10,
    engines: p.engines ?? (p.engine ? [p.engine] : undefined), // Fallbacks handled inside federatedSearch
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
  });
});

handlers.set("read_url", async (args) => {
  const p = schemas.readUrlArgs.parse(args);
  const opts: Parameters<typeof readUrl>[1] = {
    timeoutMs: p.timeoutMs ?? 30000,
    sections: p.sections ?? false,
    debug: p.debug ?? false,
  };
  if (p.privacy_mode) opts.privacy_mode = p.privacy_mode;
  if (p.freshness_mode) opts.freshness_mode = p.freshness_mode;
  if (p.proxy_profile) opts.proxy_profile = p.proxy_profile;
  if (p.country) opts.country = p.country;
  if (p.session_affinity !== undefined) opts.session_affinity = p.session_affinity;
  if (p.rotation_strategy) opts.rotation_strategy = p.rotation_strategy;
  return await readUrl(p.url, opts);
});

handlers.set("read_urls", async (args) => {
  const p = schemas.batchReadUrlsArgs.parse(args);
  const results = await Promise.allSettled(
    p.urls.map((u) => readUrl(u, { timeoutMs: p.timeoutMs ?? 30000 }))
  );
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { url: p.urls[i], ...classifyError(r.reason) }
  );
});

handlers.set("detect_changes", async (args) => {
  const p = schemas.changeDetectArgs.parse(args);
  return await detectChanges(p.url, p.timeoutMs);
});

handlers.set("cite", async (args) => {
  const p = schemas.citationArgs.parse(args);
  return await citationSearch(p.claims, p.limit);
});

handlers.set("answer_with_evidence", async (args) => {
  const p = schemas.answerArgs.parse(args);
  return await answerWithEvidence(p.question, p.limit ?? 3);
});

handlers.set("conflict_detector", async (args) => {
  const p = schemas.conflictArgs.parse(args);
  return await detectConflicts(p.topic, p.limit ?? 5);
});

handlers.set("truth_maintenance", async () => {
  return await truthMaintenance();
});

handlers.set("upgrade_impact", async (args) => {
  const p = schemas.upgradeArgs.parse(args);
  return await upgradeImpactAnalyzer(p.framework, p.fromVersion, p.toVersion);
});

handlers.set("query_planner", async (args) => {
  const p = schemas.planArgs.parse(args);
  return buildQueryPlan(p.query, { read: p.read, extract: p.extract, cite: p.cite });
});

handlers.set("confidence_calibration", async (args) => {
  const p = schemas.calibrateArgs.parse(args);
  return calibrateConfidence(p.claims);
});

handlers.set("source_trust", async (args) => {
  const p = schemas.trustArgs.parse(args);
  return { domains: p.domains.map((d) => getDomainTrust(d)) };
});

handlers.set("set_source_trust", async (args) => {
  const p = schemas.setTrustArgs.parse(args);
  customTrust.set(p.domain.replace(/^www\./u, "").toLowerCase(), p.trust);
  return { domain: p.domain, trust: p.trust, status: "set" };
});

handlers.set("watch_and_act", async (args) => {
  const p = schemas.watchArgs.parse(args);
  return addWatch(p.url, p.label, p.webhookUrl, p.context);
});

handlers.set("check_watch", async (args) => {
  const p = schemas.checkWatchArgs.parse(args);
  return await checkWatch(p.id);
});

handlers.set("semantic_diff", async (args) => {
  const p = schemas.semanticDiffArgs.parse(args);
  return await semanticDiff(p.url, p.context);
});

handlers.set("evaluation_harness", async () => {
  return await runEvalSuite(); // This now calls our full suite internally
});

handlers.set("set_memory_profile", async (args) => {
  const p = schemas.profileArgs.parse(args);
  return setProfile(p.projectId, {
    preferredSources: p.preferredSources,
    stack: p.stack,
    outputFormat: p.outputFormat,
    notes: p.notes,
  });
});

handlers.set("get_memory_profile", async (args) => {
  const p = schemas.getProfileArgs.parse(args);
  return getProfile(p.projectId);
});

handlers.set("slo_dashboard", async (args) => {
  const p = schemas.sloDashboardArgs.parse(args);
  return getSLODashboard(p.tool, p.windowMinutes ?? 60);
});

handlers.set("replay_request", async (args, meta) => {
  const p = schemas.replayArgs.parse(args);
  const r = replayRequest(p.requestId);
  if (!r) throw new Error(`not_found: No replay found for requestId ${p.requestId}`);
  return r;
});

handlers.set("list_replays", async (args) => {
  const p = schemas.listReplaysArgs.parse(args);
  const r = listReplays(p.limit ?? 20);
  return {
    replays: r.map((e) => ({
      requestId: e.requestId,
      tool: e.tool,
      timestamp: new Date(e.timestamp).toISOString(),
      latencyMs: e.latencyMs,
    })),
  };
});

handlers.set("run_eval_suite", async (args) => {
  const p = schemas.evalSuiteArgs.parse(args);
  return await runEvalSuite(p.subset);
});

handlers.set("research", async (args) => {
  const p = schemas.researchArgs.parse(args);
  return await research(p.query, {
    limit: p.limit,
    readTop: p.readTop,
    sections: p.sections,
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
  });
});

handlers.set("research_job_start", async (args) => {
  const p = schemas.researchArgs.parse(args);
  return startAsyncResearch(p.query, {
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
});

handlers.set("research_job_status", async (args) => {
  const p = schemas.researchJobGetArgs.parse(args);
  const job = researchJobs.get(p.jobId);
  if (!job) throw new Error(`not_found: Job not found ${p.jobId}`);
  const { abort, ...safeJob } = job;
  return safeJob;
});

handlers.set("research_job_cancel", async (args) => {
  const p = schemas.researchJobCancelArgs.parse(args);
  const job = researchJobs.get(p.jobId);
  if (!job) throw new Error(`not_found: Job not found ${p.jobId}`);
  if (job.state === "running") {
    job.abort.abort();
    job.state = "cancelled";
  }
  return { jobId: p.jobId, state: job.state };
});

handlers.set("continuous_research_start", async (args) => {
  const p = schemas.continuousResearchStartArgs.parse(args);
  const opts: { intervalMinutes?: number; webhookUrl?: string } = {};
  if (p.intervalMinutes !== undefined) opts.intervalMinutes = p.intervalMinutes;
  if (p.webhookUrl !== undefined) opts.webhookUrl = p.webhookUrl;
  return startContinuousResearch(p.query, opts);
});

handlers.set("continuous_research_status", async (args) => {
  const p = schemas.continuousResearchJobGetArgs.parse(args);
  const job = continuousResearchJobs.get(p.jobId);
  if (!job) throw new Error(`not_found: Job not found ${p.jobId}`);
  const { abort, ...safeJob } = job;
  return safeJob;
});

handlers.set("continuous_research_cancel", async (args) => {
  const p = schemas.continuousResearchJobCancelArgs.parse(args);
  const job = continuousResearchJobs.get(p.jobId);
  if (!job) throw new Error(`not_found: Job not found ${p.jobId}`);
  if (job.state === "running") {
    job.abort.abort();
    job.state = "cancelled";
  }
  return { jobId: p.jobId, state: job.state };
});

handlers.set("github_releases", async (args) => {
  const p = schemas.githubReleasesArgs.parse(args);
  return await withRetry(() => githubReleases(p.repo, p.limit));
});

handlers.set("github_diff", async (args) => {
  const p = schemas.githubDiffArgs.parse(args);
  return await withRetry(() => githubDiff(p.repo, p.fromTag, p.toTag));
});

handlers.set("github_issues", async (args) => {
  const p = schemas.githubIssuesArgs.parse(args);
  return await withRetry(() => githubIssues(p.repo, p.state, p.limit, p.labels));
});

handlers.set("dev_intel", async (args) => {
  const p = schemas.devIntelArgs.parse(args);
  return await devIntel(p.framework, p.type);
});

handlers.set("add_monitor", async (args) => {
  const p = schemas.monitorArgs.parse(args);
  return addMonitor(p.url, p.label);
});

handlers.set("list_monitors", async () => {
  return { monitors: listMonitors() };
});

handlers.set("browse", async (args, meta) => {
  const p = schemas.browseArgs.parse(args);
  return await withRetry(() =>
    scopedClient("browse").createJob({
      url: p.url,
      ...(p.recipeId ? { recipeId: p.recipeId } : {}),
      ...(p.steps ? { steps: p.steps } : {}),
    }, {
      wait: p.options?.wait ?? false,
      timeoutMs: p.options?.timeoutMs ?? 30000,
      pollMs: p.options?.pollMs ?? 1000,
    })
  );
});

handlers.set("crawl", async (args) => {
  const p = schemas.crawlArgs.parse(args);
  return await withRetry(() =>
    scopedClient("crawl").crawl({
      seed: p.seed,
      ...(p.rules ? { rules: p.rules } : {}),
      ...(p.recipeId ? { recipeId: p.recipeId } : {}),
    })
  );
});

handlers.set("extract", async (args) => {
  const p = schemas.extractArgs.parse(args);
  return await withRetry(() =>
    scopedClient("extract").extract({
      mode: p.mode,
      ...(p.input ? { html: p.input } : {}),
      ...(p.artifactId ? { artifactId: p.artifactId } : {}),
      ...(p.selectors ? { selectors: p.selectors } : {}),
      ...(p.schema ? { jsonSchema: p.schema } : {}),
      ...(p.plugin ? { plugin: p.plugin } : {}),
    })
  );
});

handlers.set("get_job", async (args) => {
  const p = schemas.getJobArgs.parse(args);
  return await client.getJob(p.jobId);
});

handlers.set("list_artifacts", async (args) => {
  const p = schemas.listArtifactsArgs.parse(args);
  return await client.listArtifacts(p.jobId);
});

handlers.set("fetch_artifact", async (args) => {
  const p = schemas.fetchArtifactArgs.parse(args);
  const bytes = await client.getArtifact(
    p.artifactId,
    p.downloadToken ? { downloadToken: p.downloadToken } : undefined
  );
  return { artifactId: p.artifactId, base64: bytes.toString("base64") };
});

handlers.set("kryfto_status", async () => {
  const apiBase = process.env.API_BASE_URL ?? "http://localhost:8080";
  let apiStatus = "unknown";
  let apiLatencyMs = 0;
  try {
    const start = Date.now();
    const res = await fetch(`${apiBase}/v1/healthz`, {
      signal: AbortSignal.timeout(5000),
    });
    apiLatencyMs = Date.now() - start;
    apiStatus = res.ok ? "healthy" : `unhealthy (HTTP ${res.status})`;
  } catch (err: unknown) {
    apiStatus = `unreachable — Cannot connect to Kryfto API at ${apiBase}. Is the server running? (${err instanceof Error ? err.message : String(err)})`;
  }

  const circuitBreakers = Object.fromEntries(
    FALLBACK_ENGINES.map((e) => [e, getEngineHealth(e)])
  );
  const cache = getRawCache();
  const sloSummary = getSLODashboard(undefined, 60);

  return {
    status: apiStatus === "healthy" ? "ok" : "degraded",
    api: { url: apiBase, status: apiStatus, latencyMs: apiLatencyMs },
    circuitBreakers,
    cache: { entries: cache.size },
    engineErrors: getEngineErrorMetrics(60),
    slo: {
      totalRequests: sloSummary.totalRequests,
      overallSuccessRate: sloSummary.overallSuccessRate,
      latency: sloSummary.latencySummary,
    },
    serverVersion: SERVER_VERSION,
    timestamp: new Date().toISOString(),
  };
});


// ── Main Server ─────────────────────────────────────────────────────────────
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
    const meta = { requestId, start, tool: name };

    try {
      // Check dynamic recipes first
      if (name.startsWith("recipe_")) {
        const recipeId = dynamicRecipeMap.get(name);
        if (!recipeId) throw new Error(`Unknown dynamic recipe plugin: ${name}`);
        const { z } = await import("zod");
        const pParsed = z.object({ url: z.string().url() }).parse(args);

        const r = await withRetry(() =>
          scopedClient("browse").createJob({ url: pParsed.url, recipeId }, {
            wait: true,
            timeoutMs: 60000,
            pollMs: 1000,
          })
        );

        if (r.state !== "succeeded") {
          return asError("unknown", `Plugin execution failed. State: ${r.state}`, { requestId, latencyMs: Date.now() - start, details: r });
        }

        const actualJobId = r.id ?? r.jobId;
        const artifacts = await client.listArtifacts(actualJobId);

        const jsonArt = artifacts.items?.find((a) => a.contentType?.includes("application/json") || a.label?.includes("extract"));
        let extractedData = null;
        if (jsonArt) {
          try {
            const artId = jsonArt.id ?? jsonArt.artifactId;
            if (!artId) throw new Error("Artifact missing id");
            const buf = await client.getArtifact(artId);
            extractedData = JSON.parse(buf.toString("utf-8"));
          } catch { /* ignore */ }
        }

        if (extractedData) {
          return asText({ url: pParsed.url, plugin: recipeId, data: extractedData, artifacts: artifacts.items?.length }, { requestId, latencyMs: Date.now() - start, tool: name });
        }

        return asText({ url: pParsed.url, plugin: recipeId, job: r, artifacts: artifacts.items }, { requestId, latencyMs: Date.now() - start, tool: name });
      }

      // Normal Tools
      const handler = handlers.get(name);
      if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
      }

      const r = await handler(args, meta);
      const cached = typeof r === "object" && r !== null && "_cached" in r ? !!(r as Record<string, unknown>)._cached : false;
      return asText(r, { requestId, latencyMs: Date.now() - start, tool: name, cached });

    } catch (err: unknown) {
      const eMsg = err instanceof Error ? err.message : String(err);
      if (eMsg.startsWith("not_found:")) {
        return asError("not_found", eMsg.substring(10).trim(), { tool: name, requestId });
      }
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
