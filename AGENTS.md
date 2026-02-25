# Agent Instructions (Codex / Claude Code / etc.)

This repository is **NOT an MVP**. Any automated changes must preserve **production-grade** standards:

## Core Requirements
- Must run end-to-end via **Docker Compose**.
- Must keep **OpenAPI + MCP** interfaces in sync.
- Must include **auth + RBAC**, **rate limiting**, **SSRF protections**, **audit logs**, **observability**.
- Must include **tests** (unit + integration/e2e) and keep CI green.
- Must never log secrets; mask sensitive fields.
- If you add dependencies, record the rationale in `ADRs/`.

## Search Quality & Reliability (v3.2.0+)
- All search results must be redirect-canonicalized before ranking or trust scoring.
- `officialOnly` mode must **never** return wrapper/redirect domains.
- `answer_with_evidence` and `cite` must return `insufficient_evidence` (not throw) when evidence is weak.
- Eval suite thresholds must pass: `precision@5 ≥ 75%`, `officialHitRate ≥ 80%`, `searchSuccessRate ≥ 99%`.
- Run `pnpm test:eval` locally before opening PRs that modify search/ranking logic.
- Retry logic must use exponential jitter backoff for HTTP 429 and timeout errors.

## MCP Tool Standards
- Every tool response must include `_meta` with `requestId`, `latencyMs`, `cached`, `tool`, and `serverVersion`.
- Every tool call is auto-recorded for SLO metrics and deterministic replay.
- New tools must include a Zod schema, a TOOL definition entry, and a dispatch block in the CallTool handler.
- The `research` pipeline must include `timings` in its output for debuggability.

## Stealth & Anti-Bot
- All HTTP requests to search engines must use `getStealthHeaders()` from `@kryfto/shared`.
- Never hardcode User-Agent strings — use `getRandomUA()` for rotation.
- The stealth layer handles `Sec-Ch-Ua`, `Sec-Fetch-*`, `Accept`, `Referer`, request spacing, and cookies automatically.

## Engine Reliability (v3.4.0+)
- `federatedSearch` queries ALL 5 engines (DDG, Brave, Bing, Yahoo, Google) in sequence — no early exit after first success.
- Three-tier fallback chain: API search → Direct HTTP search → Unconditional curated fallback (8 universal search URLs).
- Search must **never** return empty results — use `getCuratedFallback()` as the last resort.
- Circuit breaker recovery must be ≤ 15s. All-engines-down must trigger `forceCircuitRecoveryIfAllDown()`.
- Scoring is domain-agnostic: no hardcoded technology lists. Use `domainQueryRelevance()` for dynamic matching.
- Result diversity enforced via `diversityPenalty()` — max 2 results from same domain before penalties kick in.
- Every engine failure must be classified via `logEngineError()` for per-engine observability.
