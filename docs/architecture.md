# Architecture

## Overview

The runtime is a Dockerized control-plane + worker system for deterministic data collection and extraction.

## System Architecture Diagram

```
                              ┌──────────────────────────────────────┐
                              │            CLIENTS                    │
                              │                                      │
                              │  SDK-TS  SDK-PY  cURL  n8n  Zapier  │
                              │  Claude  Cursor  Codex  CLI          │
                              └──────────┬───────┬───────────────────┘
                                         │       │
                              REST (/v1) │       │ MCP (stdio)
                                         │       │
                    ┌────────────────────┐│       │┌────────────────────┐
                    │                    ││       ││                    │
                    ▼                    ▼│       │▼                    │
┌─────────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐
│   nginx (Dashboard)     │  │   Fastify API         │  │   MCP Server     │
│   :3001                 │  │   :8080                │  │   (42+ tools)    │
│                         │  │                        │  │                  │
│  /dashboard/* → SPA     │  │  Auth & RBAC           │  │  search          │
│  /v1/* → proxy to API───┼─▶│  • SHA-256 tokens      │◀─│  browse          │
│                         │  │  • 3 roles (admin,     │  │  research         │
│  React + Vite +         │  │    developer, readonly)│  │  extract          │
│  Tailwind               │  │  • Token expiration    │  │  watch            │
│                         │  │  • Per-role rate limits │  │  eval suite       │
│  Pages:                 │  │                        │  │  CAPTCHA solve    │
│  • Overview (stats)     │  │  Routes                │  │  trust scoring    │
│  • Token management     │  │  • Jobs CRUD           │  │  SLO dashboard    │
│  • Projects             │  │  • Search (5 engines)  │  │  replay           │
│  • Jobs browser         │  │  • Crawl               │  │                  │
│  • Crawls browser       │  │  • Extract             │  └──────────────────┘
│  • Audit logs           │  │  • Recipes             │
│  • Rate limit config    │  │  • Admin (14 endpoints)│
│  • API Playground       │  │                        │
│  • API Examples         │  │                        │
└─────────────────────────┘  │                        │
                              │  Middleware            │
                              │  • Audit logging       │
                              │  • SSRF protection     │
                              │  • Idempotency keys    │
                              │  • OpenTelemetry       │
                              │  • Prometheus metrics  │
                              └───────────┬────────────┘
                                          │
                                          │ Enqueue (BullMQ)
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Redis :6379                                     │
│                                                                              │
│   ┌─────────────────┐   ┌─────────────────┐   ┌──────────────────────────┐  │
│   │  Job Queues     │   │  Concurrency    │   │  Pub/Sub                 │  │
│   │  (BullMQ)       │   │  Semaphores     │   │  (SSE log streaming)     │  │
│   └─────────────────┘   └─────────────────┘   └──────────────────────────┘  │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │
                                   │ Consume
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Worker (apps/worker)                               │
│                                                                              │
│  ┌───────────────────────┐       ┌────────────────────────────────────────┐  │
│  │  Fetch Path           │       │  Browser Path (Playwright)            │  │
│  │                       │       │                                        │  │
│  │  • HTTP GET/POST      │       │  ┌─────────────────────────────────┐  │  │
│  │  • Stealth headers    │       │  │  Anti-Bot Engine                │  │  │
│  │  • 12 Chromium UAs    │       │  │  • 20-point stealth evasion     │  │  │
│  │  • Sec-Ch-Ua hints    │       │  │  • Consistent fingerprints     │  │  │
│  │  • Cookie jar (6265)  │       │  │  • Canvas/WebGL/Audio noise    │  │  │
│  │  • Engine spacing     │       │  │  • navigator.webdriver=false   │  │  │
│  └───────────────────────┘       │  └─────────────────────────────────┘  │  │
│                                  │  ┌─────────────────────────────────┐  │  │
│  ┌───────────────────────┐       │  │  Humanize Layer                │  │  │
│  │  Extraction Engine    │       │  │  • Bezier curve mouse moves    │  │  │
│  │                       │       │  │  • Realistic typing + typos    │  │  │
│  │  • CSS selectors      │       │  │  • Smooth chunked scrolling    │  │  │
│  │  • JSON Schema        │       │  │  • Micro-overshoots (35%)      │  │  │
│  │  • Plugin modules     │       │  └─────────────────────────────────┘  │  │
│  │  • HTML → Markdown    │       │  ┌─────────────────────────────────┐  │  │
│  │  • PDF → text         │       │  │  CAPTCHA Solver                │  │  │
│  └───────────────────────┘       │  │  • Cloudflare Turnstile       │  │  │
│                                  │  │  • reCAPTCHA v2 (CLIP vision) │  │  │
│  ┌───────────────────────┐       │  │  • hCaptcha (CLIP + audio)    │  │  │
│  │  Crawl Orchestrator   │       │  │  • Datadome press & slider    │  │  │
│  │                       │       │  │  • Audio → Whisper (local)    │  │  │
│  │  • BFS link-follow    │       │  │  • No external APIs           │  │  │
│  │  • Depth/page caps    │       │  └─────────────────────────────────┘  │  │
│  │  • robots.txt respect │       │  ┌─────────────────────────────────┐  │  │
│  │  • Politeness delays  │       │  │  Browser Session Pool          │  │  │
│  │  • Same-domain filter │       │  │  • Per-domain reuse (30m TTL)  │  │  │
│  └───────────────────────┘       │  │  • Sticky proxy per domain    │  │  │
│                                  │  │  • Fingerprint persistence    │  │  │
│                                  │  └─────────────────────────────────┘  │  │
│                                  └────────────────────────────────────────┘  │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │
                                   │ Persist
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Persistence Layer                                   │
│                                                                              │
│  ┌──────────────────────────────┐    ┌───────────────────────────────────┐  │
│  │  PostgreSQL :5432            │    │  MinIO / S3 :9000                 │  │
│  │                              │    │                                   │  │
│  │  Tables:                     │    │  Artifacts:                       │  │
│  │  ├── projects                │    │  ├── Screenshots (PNG)            │  │
│  │  ├── api_tokens (+ expiry)   │    │  ├── HTML snapshots              │  │
│  │  ├── rate_limit_config       │    │  ├── HAR archives                │  │
│  │  ├── jobs                    │    │  ├── Extracted data (JSON)        │  │
│  │  ├── job_logs                │    │  ├── Cookie exports              │  │
│  │  ├── idempotency_keys        │    │  └── Timing profiles             │  │
│  │  ├── artifact_blobs          │    │                                   │  │
│  │  ├── artifacts               │    │  Deduplicated by SHA-256         │  │
│  │  ├── artifact_download_tokens│    │  Presigned URL support           │  │
│  │  ├── crawl_runs              │    │                                   │  │
│  │  ├── crawl_nodes             │    └───────────────────────────────────┘  │
│  │  ├── recipes                 │                                          │
│  │  ├── browser_profiles        │                                          │
│  │  └── audit_logs              │                                          │
│  └──────────────────────────────┘                                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Request Lifecycle

```
Client Request
     │
     ▼
┌─────────────┐   Public?   ┌────────────┐
│  API :8080  │────(yes)───▶│  healthz   │──▶ 200 OK
│             │             │  readyz    │
│             │             │  metrics   │
│             │             │  docs/*    │
│             │             └────────────┘
│             │
│  Auth Hook  │   No token?  ──▶ 401 AUTH_UNAUTHORIZED
│             │   Revoked?   ──▶ 401 AUTH_UNAUTHORIZED
│             │   Expired?   ──▶ 401 AUTH_UNAUTHORIZED
│             │
│  Rate Limit │   Over RPM?  ──▶ 429 TOO_MANY_REQUESTS
│  (per-role) │   admin: 500 RPM
│             │   developer: 120 RPM
│             │   readonly: 60 RPM
│             │
│  RBAC Check │   Wrong role? ──▶ 403 AUTH_FORBIDDEN
│             │
│  SSRF Check │   Private IP? ──▶ 403 SSRF_BLOCKED
│             │
│  Handler    │───▶ Process request
│             │       │
│  Audit Log  │◀──────┘  Write audit record
│             │
└─────────────┘
     │
     │ (for job/crawl requests)
     ▼
┌─────────────┐         ┌───────────┐         ┌────────────┐
│   BullMQ    │────────▶│  Worker   │────────▶│  Postgres  │
│   (Redis)   │ consume │  Execute  │ persist │  + MinIO   │
└─────────────┘         └───────────┘         └────────────┘
```

## Search Data Flow

```
Search Query
     │
     ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Federated Search Engine                        │
│                                                                  │
│  Tier 1: API-Based Search                                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐│
│  │ DuckDuck │ │  Brave   │ │  Bing    │ │  Yahoo   │ │ Google ││
│  │ Go (HTTP)│ │  (HTTP)  │ │  (HTTP)  │ │  (HTTP)  │ │(Browser││
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ │+Stealth││
│       │            │            │            │        │+CAPTCHA││
│       ▼            ▼            ▼            ▼        └────────┘│
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Scoring Pipeline                                        │   │
│  │  domainQueryRelevance() → urlOfficialScore()             │   │
│  │  → noisePenalty() → diversityPenalty() → sort by score   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          │                                      │
│  Tier 2: Direct HTTP     │  (if API fails)                      │
│  Tier 3: Curated Links   │  (if all engines fail)               │
│                          │  8 universal search URLs              │
│                          │                                      │
│  Circuit Breaker: 15s recovery, single-success close            │
└──────────────────────────┼──────────────────────────────────────┘
                           │
                           ▼
                    Scored Results []
```

## Services

- `apps/api`: Fastify API with OpenAPI, auth/RBAC, idempotency, per-role rate limiting, token expiration, SSRF checks, audit logging, metrics, and tracing hooks.
- `apps/dashboard`: React + Vite + Tailwind admin dashboard SPA. Served via separate nginx container on port 3001. 9 pages: Overview, Tokens, Projects, Jobs, Crawls, Audit Logs, Rate Limits, API Playground (interactive endpoint tester with 18 presets), and API Examples (6 detailed samples with cURL commands).
- `apps/worker`: BullMQ processors for browser/fetch collection and crawl orchestration.
- `redis`: queue transport and worker concurrency semaphores.
- `postgres`: runtime state, artifacts metadata, idempotency keys, crawl graph, recipes, audit logs.
- `minio` (default): S3-compatible artifact blob store.
- `packages/mcp-server`: MCP tool adapter (42+ tools) over the REST API, including federated search, evidence-based research, continuous research agents, trust scoring, SLO monitoring, and deterministic replay.
- `packages/shared`: Shared search parsers, URL utilities, stealth anti-bot layer (`stealth.ts` — 16 rotated UAs, `Sec-Ch-Ua` hints, engine-specific request spacing, cookie jar).
- `packages/cli`, `packages/sdk-ts`, `packages/sdk-py`: client interfaces.

## Data Flow

1. Client calls `POST /v1/jobs` (or MCP `browse`) with optional idempotency key.
2. API validates with zod, applies recipe defaults, enqueues BullMQ job, and writes audit + job records.
3. Worker executes fetch path or Playwright browser path, captures artifacts (HTML/screenshot/HAR/logs/timings), performs extraction, and updates job state.
4. Artifacts are deduplicated by sha256 in Postgres metadata and stored in MinIO/local FS.
5. API serves status, logs (SSE), artifact listing/download, extraction-on-demand, and crawl orchestration.
6. MCP search queries all 5 engines (DDG, Brave, Bing, Yahoo, Google) for maximum coverage, with domain-agnostic scoring via `domainQueryRelevance()` + `urlOfficialScore()` + `diversityPenalty()`. Three-tier fallback: API-based search → Direct HTTP search → Unconditional curated fallback (8 universal search URLs). Circuit breaker with 15s recovery ensures fast failover.

## Persistence Model

- `projects`, `api_tokens` (with `expires_at` support)
- `rate_limit_config` (per-role RPM settings)
- `jobs`, `idempotency_keys`, `job_logs`
- `artifact_blobs`, `artifacts`, `artifact_download_tokens`
- `crawl_runs`, `crawl_nodes`
- `recipes`, `browser_profiles`
- `audit_logs`

## Observability

- `GET /v1/metrics` Prometheus metrics
- `GET /v1/healthz` liveness
- `GET /v1/readyz` readiness (db + redis)
- Correlation IDs via `X-Request-Id`
- OpenTelemetry spans scaffolded in API and worker execution paths

## Docker Compose Profiles

| Profile | Services | Use Case |
|---|---|---|
| default | api + dashboard + worker + redis + postgres + minio | Full production stack |
| `lite` | api-lite + worker-lite + redis + postgres-lite | Local dev, small VPS (local artifact backend) |
| `observability` | + prometheus + grafana | Monitoring & alerting |
| `ui` | + worker-ui + browser-ui (VNC) | Debug headed browser sessions |
| `py-extractor` | + python extractor service | Custom Python extraction plugins |
