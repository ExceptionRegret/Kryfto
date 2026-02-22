# Architecture

## Overview
The runtime is a Dockerized control-plane + worker system for deterministic data collection and extraction.

## Services
- `apps/api`: Fastify API with OpenAPI, auth/RBAC, idempotency, rate limiting, SSRF checks, audit logging, metrics, and tracing hooks.
- `apps/worker`: BullMQ processors for browser/fetch collection and crawl orchestration.
- `redis`: queue transport and worker concurrency semaphores.
- `postgres`: runtime state, artifacts metadata, idempotency keys, crawl graph, recipes, audit logs.
- `minio` (default): S3-compatible artifact blob store.
- `packages/mcp-server`: MCP tool adapter over the REST API.
- `packages/cli`, `packages/sdk-ts`, `packages/sdk-py`: client interfaces.

## Data Flow
1. Client calls `POST /v1/jobs` (or MCP `browse`) with optional idempotency key.
2. API validates with zod, applies recipe defaults, enqueues BullMQ job, and writes audit + job records.
3. Worker executes fetch path or Playwright browser path, captures artifacts (HTML/screenshot/HAR/logs/timings), performs extraction, and updates job state.
4. Artifacts are deduplicated by sha256 in Postgres metadata and stored in MinIO/local FS.
5. API serves status, logs (SSE), artifact listing/download, extraction-on-demand, and crawl orchestration.

## Persistence Model
- `projects`, `api_tokens`
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

## Profiles
- default: api + worker + redis + postgres + minio
- `lite`: local artifact backend + reduced stack (small deployment profile)
- `observability`: prometheus + grafana
- `ui`: headed worker + browser UI container
- `py-extractor`: optional Python extractor scaffold