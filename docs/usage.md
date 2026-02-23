# Usage Guide

This guide covers practical day-to-day usage of the runtime as an operator or agent developer.

## 1) Start The Stack

Prerequisites:

- Docker + Docker Compose
- `curl`
- Optional: Node 20+ and pnpm (for CLI/MCP local builds)

Setup:

```bash
cp .env.example .env
docker compose up -d --build
```

Check service health:

```bash
curl http://localhost:8080/v1/healthz
curl http://localhost:8080/v1/readyz
```

If auth is enabled (default), include your token:

```bash
export KRYFTO_API_TOKEN=dev_admin_token_change_me
curl -H "Authorization: Bearer $KRYFTO_API_TOKEN" http://localhost:8080/v1/healthz
```

## 2) Authentication And Roles

Use:

- Header: `Authorization: Bearer <token>`
- Roles: `admin`, `developer`, `readonly`

Admin token creation (from source checkout):

```bash
pnpm --filter @kryfto/api build
pnpm --filter @kryfto/api seed:admin -- --project default --name local-admin --role admin
```

## 3) Create A Collection Job

Minimal job:

```bash
curl -X POST http://localhost:8080/v1/jobs \
  -H "Authorization: Bearer $KRYFTO_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: example-1" \
  -d '{"url":"https://example.com"}'
```

Response:

```json
{
  "jobId": "....",
  "state": "queued",
  "requestId": "...."
}
```

Check status:

```bash
curl -H "Authorization: Bearer $KRYFTO_API_TOKEN" \
  http://localhost:8080/v1/jobs/<jobId>
```

Stream logs (SSE):

```bash
curl -N -H "Authorization: Bearer $KRYFTO_API_TOKEN" \
  http://localhost:8080/v1/jobs/<jobId>/logs
```

Cancel:

```bash
curl -X POST -H "Authorization: Bearer $KRYFTO_API_TOKEN" \
  http://localhost:8080/v1/jobs/<jobId>/cancel
```

## 4) Web Search

Supported engines:

- `duckduckgo` (HTML search endpoint)
- `bing` (official API when `BING_SEARCH_API_KEY` is set, otherwise HTML fallback)
- `yahoo` (HTML search endpoint)
- `google` (Google Programmable Search API when configured, otherwise free HTML fallback)
- `brave` (Brave Search API when configured, otherwise free HTML fallback)

Note:

- Google Programmable Search returns up to 10 results per request; higher `limit` values are capped at 10 for `engine=google`.

Run a search query:

```bash
curl -X POST http://localhost:8080/v1/search \
  -H "Authorization: Bearer $KRYFTO_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query":"playwright browser automation",
    "limit":5,
    "safeSearch":"moderate",
    "locale":"us-en",
    "engine":"bing"
  }'
```

CLI equivalent:

```bash
collector search --query "playwright browser automation" --engine bing --limit 5
```

Environment for API-backed engines (optional):

```bash
# Bing API (optional; if unset, bing uses HTML fallback)
export BING_SEARCH_API_KEY=...
export BING_SEARCH_ENDPOINT=https://api.bing.microsoft.com/v7.0/search

# Google Programmable Search API (optional; if unset, google uses HTML fallback)
export GOOGLE_CSE_API_KEY=...
export GOOGLE_CSE_CX=...

# Brave Search API (optional; if unset, brave uses HTML fallback)
export BRAVE_SEARCH_API_KEY=...
```

## 5) Browser Steps DSL

Supported step types:

- `goto`
- `setHeaders`
- `setCookies`
- `exportCookies`
- `waitForSelector`
- `click`
- `type` (`secret: true` masks text in logs)
- `scroll`
- `wait`
- `waitForNetworkIdle`
- `paginate`
- `screenshot`
- `extract`

Example:

```json
{
  "url": "https://example.com",
  "options": {
    "requiresBrowser": true,
    "browserEngine": "chromium",
    "respectRobotsTxt": true
  },
  "steps": [
    { "type": "goto", "args": { "url": "https://example.com" } },
    { "type": "waitForNetworkIdle", "args": { "timeoutMs": 15000 } },
    { "type": "screenshot", "args": { "name": "homepage" } }
  ],
  "extract": {
    "mode": "selectors",
    "selectors": {
      "title": "title",
      "heading": "h1"
    }
  }
}
```

## 6) Artifacts

List job artifacts:

```bash
curl -H "Authorization: Bearer $KRYFTO_API_TOKEN" \
  http://localhost:8080/v1/jobs/<jobId>/artifacts
```

Download artifact with auth:

```bash
curl -L -H "Authorization: Bearer $KRYFTO_API_TOKEN" \
  http://localhost:8080/v1/artifacts/<artifactId> -o artifact.bin
```

Download artifact with short-lived token:

```bash
curl -L "http://localhost:8080/v1/artifacts/<artifactId>?downloadToken=<token>" -o artifact.bin
```

## 7) Extraction API

Run extraction on inline HTML:

```bash
curl -X POST http://localhost:8080/v1/extract \
  -H "Authorization: Bearer $KRYFTO_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mode":"selectors",
    "html":"<html><body><h1>Hello</h1></body></html>",
    "selectors":{"heading":"h1"}
  }'
```

Run extraction on existing artifact:

```bash
curl -X POST http://localhost:8080/v1/extract \
  -H "Authorization: Bearer $KRYFTO_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"schema","artifactId":"<artifactId>","jsonSchema":{"type":"object","properties":{"title":{"type":"string"}}}}'
```

## 8) Crawl

Create crawl:

```bash
curl -X POST http://localhost:8080/v1/crawl \
  -H "Authorization: Bearer $KRYFTO_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "seed":"https://example.com",
    "rules":{
      "maxDepth":1,
      "maxPages":10,
      "sameDomainOnly":true,
      "politenessDelayMs":500
    }
  }'
```

Check crawl:

```bash
curl -H "Authorization: Bearer $KRYFTO_API_TOKEN" \
  http://localhost:8080/v1/crawl/<crawlId>
```

## 9) Recipes

List recipes:

```bash
curl -H "Authorization: Bearer $KRYFTO_API_TOKEN" \
  http://localhost:8080/v1/recipes
```

Validate recipe payload:

```bash
collector recipes validate recipes/example-home.yaml
```

Upload recipe (admin only):

```bash
curl -X POST http://localhost:8080/v1/recipes \
  -H "Authorization: Bearer $KRYFTO_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"my-recipe","name":"My Recipe","version":"1.0.0","match":{"patterns":["example.com/**"]},"requiresBrowser":false}'
```

## 10) CLI Usage

Build CLI:

```bash
pnpm --filter @kryfto/cli build
```

Set env:

```bash
export API_BASE_URL=http://localhost:8080
export API_TOKEN=$KRYFTO_API_TOKEN
```

Examples:

```bash
collector jobs create --url https://example.com --wait
collector jobs status <jobId>
collector jobs logs <jobId> --follow
collector artifacts list <jobId>
collector artifacts get <artifactId> -o out.bin
collector crawl --seed https://example.com
collector recipes validate recipes/example-home.yaml
collector search --query "example domain" --engine duckduckgo --limit 3
collector search --query "example domain" --engine google --limit 3
```

## 11) MCP Usage

Build and run MCP server:

```bash
pnpm --filter @kryfto/mcp-server build
API_BASE_URL=http://localhost:8080 API_TOKEN=$KRYFTO_API_TOKEN node packages/mcp-server/dist/index.js
```

Tools exposed:

- `browse`
- `crawl`
- `extract`
- `search`
- `get_job`
- `list_artifacts`
- `fetch_artifact`

Claude Code / Codex config example is in `docs/mcp.md`.

## 12) Observability

Metrics:

```bash
curl http://localhost:8080/v1/metrics
```

Optional observability profile:

```bash
docker compose --profile observability up -d
```

## 13) Optional Profiles

Lite profile:

```bash
docker compose --profile lite up -d --build
```

Headed browser/UI profile:

```bash
docker compose --profile ui up -d worker-ui browser-ui
```

Python extractor scaffold:

```bash
docker compose --profile py-extractor up -d py-extractor
```

## 14) Common Troubleshooting

Fastify plugin mismatch:

- Ensure plugin major versions match Fastify major.
- Rebuild without cache:

```bash
docker compose build --no-cache api worker
```

Stale node modules in Docker layer:

```bash
docker compose down -v
docker compose build --no-cache
docker compose up -d
```

Auth 401:

- Confirm token is in `Authorization: Bearer <token>`.
- Confirm token belongs to the same project as the requested resource.

Job stuck queued:

- Check worker logs:

```bash
docker compose logs -f worker
```

- Check Redis/Postgres readiness:

```bash
docker compose ps
```

SSRF blocked URL:

- The runtime blocks private/internal ranges by default.
- Use public targets, or explicitly configure allowlist (`KRYFTO_ALLOWED_HOSTS`) only when justified.
