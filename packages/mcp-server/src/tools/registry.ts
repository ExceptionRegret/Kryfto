import { z } from "zod";

export const TOOLS = [
    {
        name: "search",
        description:
            "Search the web using DuckDuckGo, Bing, Yahoo, Google, or Brave. Returns snippets and URLs. Use this for general queries.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string" },
                limit: { type: "number", description: "Max results (default 10)" },
                engine: {
                    type: "string",
                    description: "duckduckgo, bing, yahoo, google, or brave",
                },
                engines: {
                    type: "array",
                    items: { type: "string" },
                    description: "Run multiple engines in parallel (federated)",
                },
                safeSearch: {
                    type: "string",
                    description: "strict, moderate, or off",
                },
                locale: { type: "string", description: "e.g. us-en, uk-en" },
                priorityDomains: {
                    type: "array",
                    items: { type: "string" },
                    description: "Boost these domains in ranking",
                },
                officialOnly: {
                    type: "boolean",
                    description: "Only return official domains (docs, github, org page)",
                },
                site: { type: "string", description: "site: filter" },
                exclude: {
                    type: "array",
                    items: { type: "string" },
                    description: "-domain.com exclusions",
                },
                inurl: { type: "string", description: "inurl: filter" },
                sortByDate: { type: "boolean" },
                debug: {
                    type: "boolean",
                    description: "Include scoring metrics in output",
                },
                topic: {
                    type: "string",
                    enum: ["general", "news", "finance"],
                    description: "Domain-specific vertical routing",
                },
                include_images: { type: "boolean", description: "Fetch image results" },
                include_image_descriptions: {
                    type: "boolean",
                    description: "Synthesize image captions",
                },
                privacy_mode: {
                    type: "string",
                    enum: ["normal", "zero_trace"],
                },
                freshness_mode: {
                    type: "string",
                    enum: ["always", "preferred", "fallback", "never"],
                },
                location: { type: "string", description: "Target geography" },
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
            "Fetch and read the content of a specific URL. Returns markdown, title, and metadata.",
        inputSchema: {
            type: "object",
            properties: {
                url: { type: "string" },
                timeoutMs: { type: "number" },
                sections: {
                    type: "boolean",
                    description: "Extract logical sections/headings",
                },
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
        description: "Batch fetch multiple URLs in parallel.",
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
    {
        name: "kryfto_status",
        description:
            "Diagnostic health check. Reports API connectivity, circuit breaker states, cache size, engine error metrics, and SLO summary.",
        inputSchema: { type: "object", properties: {} },
    },
];

// ── Zod Schemas ─────────────────────────────────────────────────────
const engineEnum = z.enum(["duckduckgo", "bing", "yahoo", "google", "brave"]);

export const browseArgs = z.object({
    url: z.string().url(),
    steps: z.array(z.record(z.unknown())).optional(),
    options: z
        .object({
            wait: z.boolean().optional(),
            timeoutMs: z.number().int().positive().optional(),
            pollMs: z.number().int().positive().optional(),
        })
        .optional(),
    recipeId: z.string().optional(),
});

export const crawlArgs = z.object({
    seed: z.string().url(),
    rules: z.record(z.unknown()).optional(),
    recipeId: z.string().optional(),
    followNav: z.boolean().optional(),
    skipPatterns: z.array(z.string()).optional(),
    maxPages: z.number().int().positive().optional(),
});

export const extractArgs = z.object({
    input: z.string().optional(),
    artifactId: z.string().optional(),
    selectors: z.record(z.string()).optional(),
    schema: z.record(z.unknown()).optional(),
    plugin: z.string().optional(),
    mode: z.enum(["selectors", "schema", "plugin"]),
});

export const searchArgs = z.object({
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

export const readUrlArgs = z.object({
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

export const batchReadUrlsArgs = z.object({
    urls: z.array(z.string().url()).min(1).max(10),
    timeoutMs: z.number().int().positive().optional(),
});

export const getJobArgs = z.object({ jobId: z.string() });
export const listArtifactsArgs = z.object({ jobId: z.string() });
export const fetchArtifactArgs = z.object({
    artifactId: z.string(),
    downloadToken: z.string().optional(),
});

export const githubReleasesArgs = z.object({
    repo: z.string().min(1),
    limit: z.number().int().min(1).max(20).optional(),
});

export const githubDiffArgs = z.object({
    repo: z.string().min(1),
    fromTag: z.string(),
    toTag: z.string(),
});

export const githubIssuesArgs = z.object({
    repo: z.string().min(1),
    state: z.string().optional(), // Removed strict enum ["open", "closed", "all"] to avoid zod breaking changes
    limit: z.number().int().min(1).max(100).optional(),
    labels: z.string().optional(),
});

export const answerArgs = z.object({
    question: z.string().min(1),
    limit: z.number().int().min(1).max(10).optional(),
});

export const conflictArgs = z.object({
    topic: z.string().min(1),
    limit: z.number().int().min(2).max(10).optional(),
});

export const upgradeArgs = z.object({
    framework: z.string().min(1),
    fromVersion: z.string(),
    toVersion: z.string(),
});

export const planArgs = z.object({
    query: z.string().min(1),
    read: z.boolean().optional(),
    extract: z.boolean().optional(),
    cite: z.boolean().optional(),
});

export const calibrateArgs = z.object({
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

export const trustArgs = z.object({ domains: z.array(z.string().min(1)) });

export const setTrustArgs = z.object({
    domain: z.string().min(1),
    trust: z.number().min(0).max(1),
});

export const watchArgs = z.object({
    url: z.string().url(),
    label: z.string().optional(),
    webhookUrl: z.string().optional(),
    context: z.string().optional(),
});

export const checkWatchArgs = z.object({ id: z.string() });

export const semanticDiffArgs = z.object({
    url: z.string().url(),
    context: z.string().optional(),
});

export const profileArgs = z.object({
    projectId: z.string(),
    preferredSources: z.array(z.string()).optional(),
    stack: z.array(z.string()).optional(),
    outputFormat: z.string().optional(),
    notes: z.array(z.string()).optional(),
});

export const getProfileArgs = z.object({ projectId: z.string() });

export const sloDashboardArgs = z.object({
    tool: z.string().optional(),
    windowMinutes: z.number().int().min(1).optional(),
});

export const replayArgs = z.object({ requestId: z.string() });

export const listReplaysArgs = z.object({
    limit: z.number().int().min(1).max(100).optional(),
});

export const evalSuiteArgs = z.object({ subset: z.array(z.string()).optional() });

export const researchArgs = z.object({
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

export const researchJobGetArgs = z.object({ jobId: z.string() });
export const researchJobCancelArgs = z.object({ jobId: z.string() });

export const continuousResearchStartArgs = z.object({
    query: z.string().min(1),
    intervalMinutes: z.number().optional(),
    webhookUrl: z.string().optional(),
});

export const continuousResearchJobGetArgs = z.object({ jobId: z.string() });
export const continuousResearchJobCancelArgs = z.object({ jobId: z.string() });

export const citationArgs = z.object({
    claims: z.array(z.string()),
    limit: z.number().optional(),
});

export const changeDetectArgs = z.object({
    url: z.string().url(),
    timeoutMs: z.number().optional(),
});

export const monitorArgs = z.object({
    url: z.string().url(),
    label: z.string().optional(),
});

export const devIntelArgs = z.object({
    framework: z.string().min(1),
    type: z.string().optional(),
});
