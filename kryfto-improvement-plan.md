# Kryfto — Improvement Plan

Based on a full source code review of the codebase (~8,500 lines of TypeScript).

---

## PRIORITY 1 — Critical (Do These First)

### 1. Break Up the 4,381-Line Monster File

**File:** `packages/mcp-server/src/index.ts`

This single file contains everything — tool definitions, all implementations, caching, SLO tracking, replay storage, research pipeline, continuous research agent, search logic, URL reading, evidence detection, conflict analysis, webhook system. This is the #1 blocker for maintainability and contributions.

**Split into:**

```
packages/mcp-server/src/
├── index.ts              # Server setup, tool registration, router (~200 lines)
├── tools/
│   ├── search.ts         # search, federatedSearch, directSearchEngine
│   ├── read.ts           # readUrl, readUrls
│   ├── research.ts       # research, research_job_*, continuous_research_*
│   ├── evidence.ts       # answerWithEvidence, detectConflicts, citationSearch
│   ├── intelligence.ts   # upgradeImpact, devIntel, confidenceCalibration
│   ├── monitoring.ts     # watch_and_act, checkWatch, semanticDiff, detectChanges
│   ├── github.ts         # githubReleases, githubDiff, githubIssues
│   ├── jobs.ts           # browse, crawl, extract, get_job, list_artifacts
│   ├── observability.ts  # slo_dashboard, replay_request, list_replays, run_eval_suite
│   └── memory.ts         # set_memory_profile, get_memory_profile
├── cache.ts              # getCached, setCache, CACHE_DEFAULT_TTL_MS
├── slo.ts                # recordSLO, getSLODashboard, storeReplay, replayRequest
├── helpers.ts            # asText, asError, classifyError, withRetry
├── enrichment.ts         # URL enrichment, reranking, date extraction
├── scoring.ts            # (already separate — good)
├── circuit-breaker.ts    # (already separate — good)
├── trust.ts              # (already separate — good)
└── types.ts              # EnrichedResult, SLORecord, etc.
```

### 2. Fix Type Safety — Remove `@ts-nocheck` and `as any`

**Files affected:**
- `apps/worker/src/stealth.ts` — Line 1 has `// @ts-nocheck`, meaning zero type checking on the entire stealth module
- `packages/mcp-server/src/index.ts` — 30+ instances of `as any` scattered throughout

**Action items:**
- Remove `@ts-nocheck` from worker stealth.ts and fix the actual type errors
- Define proper interfaces for API responses (`scopedClient` return types)
- Replace `as any` casts with proper type narrowing or generics
- Add strict mode to all tsconfig files: `"strict": true`

### 3. Publish Tagged Releases on GitHub

Currently: 0 releases, 0 tags.

- Tag v3.4.0 immediately (matches your changelog)
- Set up GitHub Actions to auto-create releases from changesets (you already have `.changeset/` directory)
- Add release notes from your existing changelog
- This is critical for credibility and for the Claude OSS application

### 4. Publish to NPM

The MCP server and SDK should be installable via npm. Currently users must clone the entire repo.

- Publish `@kryfto/mcp-server` — this is what Claude Code/Cursor users actually need
- Publish `@kryfto/sdk-ts` — the TypeScript client
- Publish `@kryfto/shared` — shared utilities
- Add `"publishConfig": { "access": "public" }` to each package.json
- This will also give you NPM download metrics for the Claude OSS application

---

## PRIORITY 2 — High Impact (Strengthens the Project)

### 5. Add Real Test Coverage

**Current state:** ~774 lines of tests covering scoring, stealth headers, search parsing, and a few utilities. Zero tests for tool handlers, research pipeline, evidence system, or webhook logic.

**Add tests for:**
- `federatedSearch()` — mock the API client, verify engine fallback chain, circuit breaker behavior, result enrichment/reranking
- `readUrl()` — mock job creation, verify caching, zero-trace mode, PDF detection
- `research()` — verify search→read→extract pipeline, timeout handling
- `answerWithEvidence()` — verify evidence extraction, insufficient evidence handling
- `detectConflicts()` — verify contradiction detection logic
- `continuousResearch` start/status/cancel — verify the interval loop, webhook firing
- `checkWatch()` — verify diff detection, webhook delivery status reporting
- Tool handler router (the big `if (name === "...")` chain) — verify each tool routes correctly and returns proper MCP format

**Target:** At least 60-70% coverage on the MCP server package.

### 6. Add CI/CD Pipeline

**File:** `.github/workflows/` — you have the directory but check what's actually running.

**Must have:**
- `pnpm typecheck` on every PR
- `pnpm test` (vitest) on every PR
- Build verification (`pnpm build`)
- Lint check (add ESLint if not present)
- Auto-publish to NPM on tagged releases
- Run the eval suite (`run_eval_suite`) as a nightly cron job

### 7. Harden the Stealth Layer

**Worker stealth (`apps/worker/src/stealth.ts`):**
- The `navigator.plugins` fake uses Native Client which Google deprecated in 2020 — remove it
- `navigator.languages` is hardcoded to `["en-US", "en"]` regardless of the chosen locale — it should match `contextOpts.locale`
- Missing: Canvas fingerprint randomization (mentioned in README but not implemented)
- Missing: WebGL renderer spoofing (also mentioned in README)
- Missing: `navigator.hardwareConcurrency` randomization
- Add `navigator.platform` spoofing to match the UA string (Windows UA + macOS platform = instant detection)

**Shared stealth (`packages/shared/src/stealth.ts`):**
- The `Sec-Fetch-Site` header is set to `"same-origin"` for Firefox, but initial navigation should be `"none"` — only subsequent requests on the same domain should be `"same-origin"`
- The cookie jar doesn't respect `Domain`, `Path`, or `Secure` attributes — it stores everything per-hostname which could leak cookies cross-path
- Add `Accept-CH` response header handling for dynamic client hints

### 8. Replace the if/else Tool Router with a Map

**File:** `packages/mcp-server/src/index.ts` lines 3758-4300+

The tool call handler is a 500+ line chain of `if (name === "search") ... if (name === "read_url") ...`. Replace with:

```typescript
const toolHandlers = new Map<string, (args: unknown, requestId: string) => Promise<McpResponse>>();

toolHandlers.set("search", async (args, reqId) => {
  const p = searchArgs.parse(args);
  const r = await federatedSearch(p.query, { /* ... */ });
  return asText(r, { requestId: reqId, tool: "search" });
});

// In the handler:
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const handler = toolHandlers.get(request.params.name);
  if (!handler) return asError("unknown_tool", `Unknown tool: ${name}`);
  return handler(request.params.arguments ?? {}, randomUUID().substring(0, 8));
});
```

This makes adding/removing tools much cleaner and enables per-tool middleware.

---

## PRIORITY 3 — Important Polish

### 9. Fix README Overclaims

These claims in the README don't match the code:

| Claim | Reality | Fix |
|-------|---------|-----|
| "16 rotated modern User-Agents" | Shared stealth has 16, worker stealth has 12 different ones | Unify to a single shared UA pool |
| "clears canvas fingerprints" | Not implemented anywhere in the code | Remove claim or implement it |
| "patches navigator.webdriver" | Only in worker stealth, not in HTTP-only mode | Clarify this is Playwright-only |
| "millions of concurrent browser extractions" | Limited by `WORKER_GLOBAL_CONCURRENCY` default of 2 | Be honest about defaults, explain scaling |
| "Search engines cannot distinguish these requests" | Will fail against Cloudflare/DataDome without proxies | Add "for basic bot detection" qualifier |

### 10. Add OpenAPI Validation Middleware

**File:** `docs/openapi.yaml` exists but isn't enforced at runtime.

- Add `@fastify/swagger` to auto-validate request/response against the OpenAPI spec
- This catches schema drift between docs and implementation
- Currently the Zod schemas in the API and the OpenAPI yaml can diverge silently

### 11. Add Rate Limiting to the API

The API has authentication (RBAC tokens) but no rate limiting. A single authenticated client can overwhelm the worker fleet.

- Add `@fastify/rate-limit` with per-token limits
- Configure per-route limits (search endpoints need tighter limits than job status checks)
- Add `X-RateLimit-*` headers to responses

### 12. Improve Error Messages in the MCP Server

Many error paths return generic messages. When the API backend is unreachable, the MCP server should clearly say "Cannot connect to Kryfto API at {URL} — is the server running?" instead of a raw connection error.

### 13. Add a CHANGELOG.md File

The changelog lives only in the README, which is unusual. Extract it to a proper `CHANGELOG.md` following Keep a Changelog format. This is standard for open source projects and makes version tracking cleaner.

---

## PRIORITY 4 — Growth & Adoption

### 14. Add GitHub Topics and Description

The repo currently says "No description, website, or topics provided." Add:
- **Description:** "Self-hosted headless browser fleet with 42+ MCP tools for AI agents, web scraping, and automated research"
- **Topics:** `mcp`, `web-scraping`, `headless-browser`, `ai-agent`, `playwright`, `search-engine`, `typescript`, `self-hosted`, `claude-code`, `cursor`
- **Website:** Link to your docs or a landing page

### 15. Create a Demo Video / GIF

Show Kryfto in action with Claude Code or Cursor — the MCP integration is the killer feature but nobody can see it without spinning up the full stack. A 2-minute demo video on the README would massively increase conversions.

### 16. Add One-Click Deploy Templates

You have Railway and DO buttons in the README, but verify they actually work with the current docker-compose. Test the full flow from button click to first API call and document any manual steps needed.

### 17. Publish to MCP Registry

Register Kryfto on the official MCP server registry (GitHub MCP Registry). This puts it in front of every Claude Code and Cursor user browsing for MCP tools.

### 18. Write a Blog Post / HN Launch

Write a technical post explaining the scoring algorithm, the stealth approach, or the "why" behind building your own search infrastructure. Post to Hacker News, r/selfhosted, r/webdev. The scoring engine alone is interesting enough for a standalone post.

---

## PRIORITY 5 — Technical Debt Cleanup

### 19. Unify the Two Stealth Modules

`packages/shared/src/stealth.ts` and `apps/worker/src/stealth.ts` share the same purpose but have different UA lists, different approaches, and no shared code. Merge them into a single `@kryfto/shared` stealth module with two modes: `http` (headers-only for fetch) and `browser` (Playwright context + init scripts).

### 20. Add Graceful Shutdown

The worker imports Playwright browsers but the shutdown handling should ensure:
- In-flight jobs are completed or re-queued
- Browser instances are properly closed
- BullMQ worker is gracefully drained
- Database connections are released

### 21. Add Request Logging / Structured Tracing

The API has pino logger and OpenTelemetry tracer imported, but verify they're actually producing useful structured logs. Add correlation IDs that flow from API → BullMQ → Worker → Response so you can trace a request end-to-end.

### 22. Add Health Check for MCP Server

The API has `/v1/healthz` and `/v1/readyz` but the MCP server has no equivalent. Add a diagnostic tool (e.g., `kryfto_status`) that reports: API connectivity, Redis status, current circuit breaker states, cache size, SLO summary.

### 23. Database Connection Pooling Review

Both API and Worker create their own `Pool` instances. Verify:
- Pool size is appropriate for concurrency settings
- Connections are properly released (no leaks on error paths)
- Idle timeout is set to prevent stale connections

### 24. Add Input Sanitization for Search Queries

The `buildSearchQuery` function directly concatenates user input with `site:` and `-exclude` operators. Verify there's no injection vector where a crafted query could manipulate the search engine interaction.

---

## Quick Wins (Can Do Today)

- [ ] Add GitHub repo description and topics
- [ ] Tag v3.4.0 release on GitHub
- [x] Add `CHANGELOG.md` (extract from README) — DONE
- [x] Remove `@ts-nocheck` from worker stealth — DONE
- [x] Remove "clears canvas fingerprints" claim from README — DONE (implemented instead)
- [x] Fix `navigator.plugins` to remove deprecated Native Client — DONE
- [x] Add `"strict": true` to tsconfig files — DONE (was already in tsconfig.base.json)
- [x] Unify UA pools between the two stealth modules — DONE

## Completed Items Summary

The following items from Priority 1-5 have been fully completed:

- **#1** Break up monster file — `index.ts` reduced from 4,381 to 577 lines, 11 tool modules created
- **#2** Type safety — Zero `any` across entire codebase (all packages, all apps). `@ts-nocheck` removed. `strict: true` already in base tsconfig.
- **#6** CI/CD pipeline — `ci.yml`, `nightly-evals.yml`, `release.yml` in `.github/workflows/`
- **#7** Stealth hardening — All sub-items done: no deprecated Native Client, languages from locale, canvas fingerprint randomization, WebGL spoofing, hardwareConcurrency randomization, platform matches UA, Sec-Fetch-Site fixed, cookie jar respects Domain/Path/Secure/HttpOnly
- **#8** Map-based tool router — Replaced if/else chain
- **#10** OpenAPI validation — `@fastify/swagger` + Zod `.safeParse()` runtime validation
- **#11** Rate limiting — `@fastify/rate-limit` with Redis, configurable RPM
- **#12** Error messages — `kryfto_status` tool with descriptive connection errors
- **#13** CHANGELOG.md — Created
- **#19** Unified stealth — Worker uses shared UA pool via `getRandomUA()` from `@kryfto/shared`
- **#20** Graceful shutdown — Worker has full shutdown with timeout for workers, queues, Redis, Postgres
- **#22** MCP health check — `kryfto_status` tool reports API connectivity, circuit breakers, cache, SLO, engine errors
- **#23** DB connection pooling — Properly configured (max 20/10, idle timeout, connection timeout, allowExitOnIdle)
- **#24** Input sanitization — `buildSearchQuery` now sanitizes operator values to prevent search operator injection
