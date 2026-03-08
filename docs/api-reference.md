# Kryfto API Reference

The Kryfto REST API (v3.8.0) provides programmable access to the headless browser fleet, extraction engine, federated search, domain crawling, recipe management, and admin dashboard.

## Base URL

```text
http://localhost:8080/v1
```

## Authentication & RBAC

All endpoints (except health checks, metrics, and `/docs`) require a Bearer token in the `Authorization` header:

```http
Authorization: Bearer <your_api_token>
```

### How It Works

Authentication is enforced via a Fastify `preHandler` hook that runs before every request:

1. **Public bypass** — Requests to `/v1/healthz`, `/v1/readyz`, `/v1/metrics`, `/docs`, and `/docs/openapi.yaml` skip auth entirely.
2. **Token resolution** — The `Authorization: Bearer <token>` header is parsed. The raw token is SHA-256 hashed and looked up in the `api_tokens` Postgres table. Only non-revoked tokens (`revoked_at IS NULL`) are accepted.
3. **Auth context** — A matched token yields an `AuthContext` containing `tokenId`, `projectId`, `role`, and `tokenHash`. This is attached to `request.auth` for downstream route handlers.
4. **Artifact download fallback** — Requests to `/v1/artifacts/:id` with a valid `downloadToken` query param are allowed through without a Bearer token (for embedding in `<img>` tags, etc.).
5. **Unauthorized** — If none of the above match, the request gets a `401 AUTH_UNAUTHORIZED` response.

### Roles

Tokens are scoped to one of three roles. Each route calls `requireRole(req.auth, [...allowedRoles])` which returns the auth context or throws `AUTH_FORBIDDEN`:

| Role         | Description |
| ------------ | ----------- |
| `admin`      | Full access. Can create tokens, manage recipes, and perform all operations. |
| `developer`  | Can create/cancel jobs, run searches, start crawls, extract data, and validate recipes. Cannot create tokens or upload recipes. |
| `readonly`   | Can read job status, stream logs, list artifacts, download artifacts, run searches, list recipes, and view crawl status. Cannot create or mutate resources. |

### Role Permissions Matrix

| Endpoint                              | admin | developer | readonly |
| ------------------------------------- | :---: | :-------: | :------: |
| `POST /v1/admin/tokens`               |   x   |           |          |
| `GET /v1/admin/tokens`                |   x   |           |          |
| `GET /v1/admin/tokens/:tokenId`       |   x   |           |          |
| `DELETE /v1/admin/tokens/:tokenId`    |   x   |           |          |
| `PATCH /v1/admin/tokens/:tokenId`     |   x   |           |          |
| `POST /v1/admin/tokens/:tokenId/rotate` |   x   |         |          |
| `GET /v1/admin/projects`              |   x   |           |          |
| `POST /v1/admin/projects`             |   x   |           |          |
| `GET /v1/admin/stats`                 |   x   |           |          |
| `GET /v1/admin/jobs`                  |   x   |           |          |
| `GET /v1/admin/crawls`               |   x   |           |          |
| `GET /v1/admin/audit-logs`           |   x   |           |          |
| `GET /v1/admin/rate-limits`          |   x   |           |          |
| `PUT /v1/admin/rate-limits`          |   x   |           |          |
| `POST /v1/jobs`                |   x   |     x     |          |
| `GET /v1/jobs/:id`             |   x   |     x     |    x     |
| `POST /v1/jobs/:id/cancel`     |   x   |     x     |          |
| `GET /v1/jobs/:id/logs`        |   x   |     x     |    x     |
| `GET /v1/jobs/:id/artifacts`   |   x   |     x     |    x     |
| `GET /v1/artifacts/:id`        |   x   |     x     |    x     |
| `POST /v1/extract`             |   x   |     x     |          |
| `POST /v1/search`              |   x   |     x     |    x     |
| `POST /v1/crawl`               |   x   |     x     |          |
| `GET /v1/crawl/:id`            |   x   |     x     |    x     |
| `GET /v1/recipes`              |   x   |     x     |    x     |
| `POST /v1/recipes`             |   x   |           |          |
| `POST /v1/recipes/validate`    |   x   |     x     |          |

### Project Scoping

Every token belongs to a **project** (via `projectId`). Jobs, crawls, artifacts, and recipes are project-scoped — a token can only access resources within its own project. Cross-project access is rejected with `403 AUTH_FORBIDDEN`.

### Token Storage

- Tokens are generated as 24 random bytes encoded as hex (48 chars).
- Only the **SHA-256 hash** is stored in the database — the raw token is returned once at creation and never stored or logged.
- Log output redacts `req.headers.authorization`, `*.token`, `*.secret`, `*.password`, and `*.apiKey` fields.
- Revoked tokens (`revoked_at IS NOT NULL`) are excluded from lookups.

### Bootstrap Token

On startup, the API inserts a bootstrap admin token for the default project if one doesn't already exist. Set via:

```env
KRYFTO_BOOTSTRAP_ADMIN_TOKEN=<your-initial-token>
# or
KRYFTO_API_TOKEN=<your-initial-token>
```

This bootstrap token gets `admin` role on the `default` project and is idempotent — re-running the API won't duplicate it.

### Token Expiration

Tokens can have an optional `expiresAt` timestamp. Expired tokens are rejected during authentication — the `resolveAuth()` function checks `expiresAt` against the current time before granting access.

### Rate Limiting

Requests are rate-limited per `token_hash:ip` pair with **per-role defaults**:

| Role        | Default RPM |
| ----------- | ----------- |
| `admin`     | 500         |
| `developer` | 120         |
| `readonly`  | 60          |

Per-role limits are stored in the `rate_limit_config` database table and can be updated via the Admin Rate Limits API. The global fallback is also configurable via:

```env
KRYFTO_RATE_LIMIT_RPM=120   # fallback requests per minute (default: 120)
```

### Audit Logging

All mutating operations are recorded in the `audit_logs` table with:

| Field          | Description |
| -------------- | ----------- |
| `project_id`   | Scoped project |
| `token_id`     | Token that performed the action |
| `actor_role`   | Role at time of action |
| `action`       | e.g., `job.create`, `admin.token.create`, `artifact.download` |
| `resource_type`| e.g., `job`, `token`, `artifact`, `recipe`, `crawl` |
| `resource_id`  | UUID of affected resource |
| `request_id`   | Correlation ID from `x-request-id` header |
| `ip_address`   | Client IP |
| `details`      | JSON object with action-specific metadata |

## Error Responses

All errors follow a consistent shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Job not found",
    "requestId": "6301784a-5e1b-42f4-bb2c-62a707da8c7d"
  }
}
```

Every response includes an `x-request-id` header for tracing.

---

## 1. Health & Monitoring (Public)

### Health Check

```
GET /v1/healthz
```

Returns `200` if the API process is alive.

```json
{ "ok": true, "service": "collector-api" }
```

### Readiness Probe

```
GET /v1/readyz
```

Checks database and Redis connectivity. Returns `200` when ready, `503` otherwise.

```json
{ "ok": true }
```

### Prometheus Metrics

```
GET /v1/metrics
```

Returns metrics in OpenMetrics format (`application/openmetrics-text`).

### OpenAPI Spec

```
GET /docs/openapi.yaml
```

Returns the raw OpenAPI 3.1 YAML specification.

---

## 2. Admin — Token Management

> **Required role:** `admin`

### Create API Token

```
POST /v1/admin/tokens
```

**Request Body:**

| Field       | Type   | Required | Description                      |
| ----------- | ------ | -------- | -------------------------------- |
| `name`      | string | Yes      | Token display name (1–255 chars) |
| `role`      | string | Yes      | `admin`, `developer`, or `readonly` |
| `projectId` | string | Yes      | Project to scope the token to (1–255 chars) |

```json
{
  "name": "ci-pipeline",
  "role": "developer",
  "projectId": "default"
}
```

**Response (201):**

```json
{
  "token": "kryfto_abc123...",
  "tokenId": "550e8400-e29b-41d4-a716-446655440000"
}
```

> Store the `token` value immediately — it is not retrievable after creation.

### List Tokens

```
GET /v1/admin/tokens
```

Returns all tokens (without raw values) for the authenticated project.

### Get Token

```
GET /v1/admin/tokens/:tokenId
```

Returns token metadata (name, role, project, creation date, expiration, revocation status).

### Revoke Token

```
DELETE /v1/admin/tokens/:tokenId
```

Sets `revoked_at` on the token, immediately invalidating it.

### Update Token

```
PATCH /v1/admin/tokens/:tokenId
```

**Request Body:**

| Field       | Type   | Required | Description |
| ----------- | ------ | -------- | ----------- |
| `name`      | string | No       | New display name |
| `role`      | string | No       | New role (`admin`, `developer`, `readonly`) |
| `expiresAt` | string (ISO 8601) | No | Token expiration timestamp |

### Rotate Token

```
POST /v1/admin/tokens/:tokenId/rotate
```

Revokes the existing token and generates a new one with the same name, role, and project.

**Response (200):**

```json
{
  "token": "kryfto_new_token...",
  "tokenId": "new-uuid"
}
```

---

## 2b. Admin — Projects

> **Required role:** `admin`

### List Projects

```
GET /v1/admin/projects
```

### Create Project

```
POST /v1/admin/projects
```

**Request Body:**

| Field  | Type   | Required | Description |
| ------ | ------ | -------- | ----------- |
| `name` | string | Yes      | Project name |

---

## 2c. Admin — Monitoring & Configuration

> **Required role:** `admin`

### Dashboard Stats

```
GET /v1/admin/stats
```

Returns aggregate counts for jobs, tokens, artifacts, and crawls.

### List All Jobs (Admin)

```
GET /v1/admin/jobs
```

**Query Parameters:**

| Param    | Type    | Default | Description |
| -------- | ------- | ------- | ----------- |
| `page`   | integer | `1`     | Page number |
| `limit`  | integer | `20`    | Results per page |
| `state`  | string  | —       | Filter by job state |

### List All Crawls (Admin)

```
GET /v1/admin/crawls
```

**Query Parameters:**

| Param    | Type    | Default | Description |
| -------- | ------- | ------- | ----------- |
| `page`   | integer | `1`     | Page number |
| `limit`  | integer | `20`    | Results per page |

### Audit Logs

```
GET /v1/admin/audit-logs
```

**Query Parameters:**

| Param    | Type    | Default | Description |
| -------- | ------- | ------- | ----------- |
| `page`   | integer | `1`     | Page number |
| `limit`  | integer | `50`    | Results per page |
| `action` | string  | —       | Filter by action type |

### Get Rate Limits

```
GET /v1/admin/rate-limits
```

Returns the per-role RPM configuration.

### Update Rate Limits

```
PUT /v1/admin/rate-limits
```

**Request Body:**

```json
{
  "limits": [
    { "role": "admin", "rpm": 500 },
    { "role": "developer", "rpm": 120 },
    { "role": "readonly", "rpm": 60 }
  ]
}
```

---

## 3. Jobs API

### Create a Job

> **Required role:** `admin` or `developer`

```
POST /v1/jobs
```

Creates a background task to navigate to a URL, execute browser steps, and extract data.

**Headers:**

| Header            | Required | Description                                        |
| ----------------- | -------- | -------------------------------------------------- |
| `Idempotency-Key` | No       | UUID to prevent duplicate job creation. Returns `409` if the same key is reused with a different payload. |

**Request Body:**

| Field            | Type   | Required | Default       | Description |
| ---------------- | ------ | -------- | ------------- | ----------- |
| `url`            | string (URL) | Yes | —            | Target URL to collect |
| `recipeId`       | string | No       | —             | Apply a pre-defined recipe |
| `options`        | object | No       | `{}`          | See [Job Options](#job-options) |
| `steps`          | array  | No       | —             | Browser automation steps (max 500). See [Step Types](#step-types) |
| `extract`        | object | No       | —             | Extraction config. See [Extraction Config](#extraction-config) |
| `privacy_mode`   | string | No       | `"normal"`    | `"normal"` or `"zero_trace"` (bypasses database persistence) |
| `freshness_mode` | string | No       | `"preferred"` | `"always"`, `"preferred"`, `"fallback"`, or `"never"` |

**Example:**

```json
{
  "url": "https://example.com",
  "options": {
    "browserEngine": "chromium",
    "requiresBrowser": true,
    "timeoutMs": 30000
  },
  "steps": [
    { "type": "waitForNetworkIdle", "args": { "timeoutMs": 15000 } }
  ],
  "extract": {
    "mode": "selectors",
    "selectors": {
      "title": "title",
      "main_heading": "h1"
    }
  }
}
```

**Response (202):**

```json
{
  "jobId": "e10c6c92-d85a-40fa-be36-ee240f687927",
  "state": "queued",
  "requestId": "6301784a-5e1b-42f4-bb2c-62a707da8c7d",
  "idempotencyKey": "demo-example-1"
}
```

---

### Get Job Status

> **Required role:** `admin`, `developer`, or `readonly`

```
GET /v1/jobs/:jobId
```

**Response:**

```json
{
  "id": "e10c6c92-d85a-40fa-be36-ee240f687927",
  "projectId": "default",
  "state": "succeeded",
  "url": "https://example.com",
  "requestId": "6301784a-...",
  "attempts": 1,
  "maxAttempts": 3,
  "createdAt": "2026-03-08T10:00:00.000Z",
  "updatedAt": "2026-03-08T10:00:05.000Z",
  "resultSummary": {
    "title": "Example Domain",
    "main_heading": "Example Domain"
  }
}
```

Job states: `queued`, `running`, `succeeded`, `failed`, `cancelled`, `expired`.

---

### Cancel a Job

> **Required role:** `admin` or `developer`

```
POST /v1/jobs/:jobId/cancel
```

Cancels a queued or running job.

**Response (202):**

```json
{
  "jobId": "e10c6c92-...",
  "state": "cancelled"
}
```

---

### Stream Job Logs (SSE)

> **Required role:** `admin`, `developer`, or `readonly`

```
GET /v1/jobs/:jobId/logs
```

Returns a real-time Server-Sent Events stream of log entries. The connection polls every 1 second for new log lines.

**Event data shape:**

```json
{
  "id": 42,
  "level": "info",
  "message": "Navigating to https://example.com",
  "meta": {},
  "createdAt": "2026-03-08T10:00:01.000Z"
}
```

---

### List Artifacts for a Job

> **Required role:** `admin`, `developer`, or `readonly`

```
GET /v1/jobs/:jobId/artifacts
```

**Response:**

```json
{
  "items": [
    {
      "id": "a92b3c4d-...",
      "jobId": "e10c6c92-...",
      "projectId": "default",
      "type": "screenshot",
      "fileName": "page.png",
      "byteSize": 245760,
      "sha256": "abc123...",
      "contentType": "image/png",
      "createdAt": "2026-03-08T10:00:05.000Z",
      "downloadToken": "temp-uuid-token",
      "downloadTokenExpiresAt": "2026-03-08T10:05:05.000Z",
      "signedUrl": "https://minio.example.com/..."
    }
  ]
}
```

---

## 4. Artifacts API

### Download Artifact

> **Required role:** `admin`, `developer`, `readonly` — OR use a `downloadToken`

```
GET /v1/artifacts/:artifactId
```

**Query Parameters:**

| Param           | Required | Description |
| --------------- | -------- | ----------- |
| `downloadToken` | No       | Time-limited token (useful for `<img>` tags or unauthenticated contexts) |

Returns the binary file with appropriate `Content-Type` and `Content-Disposition` headers.

```http
GET /v1/artifacts/a92b3c4d-...?downloadToken=temp-uuid-token
```

---

## 5. Extraction API

> **Required role:** `admin` or `developer`

### Extract Data from Content

```
POST /v1/extract
```

Extracts structured data from HTML, text, or a previously-stored artifact using CSS selectors, JSON schemas, or custom plugins.

**Request Body:**

| Field        | Type   | Required | Description |
| ------------ | ------ | -------- | ----------- |
| `mode`       | string | Yes      | `"selectors"`, `"schema"`, or `"plugin"` |
| `html`       | string | One of   | Raw HTML content |
| `text`       | string | One of   | Plain text content |
| `artifactId` | string | One of   | ID of a stored artifact |
| `selectors`  | object | If mode=selectors | Map of name → CSS selector |
| `jsonSchema` | object | If mode=schema    | JSON Schema to extract against |
| `plugin`     | string | If mode=plugin    | Plugin path or name |

> Exactly one of `html`, `text`, or `artifactId` must be provided.

**Example (selectors):**

```json
{
  "mode": "selectors",
  "html": "<html><head><title>Test</title></head><body><h1>Hello</h1></body></html>",
  "selectors": {
    "title": "title",
    "heading": "h1"
  }
}
```

**Response:**

```json
{
  "data": {
    "title": "Test",
    "heading": "Hello"
  },
  "mode": "selectors"
}
```

---

## 6. Search API

> **Required role:** `admin`, `developer`, or `readonly`

### Federated Search

```
POST /v1/search
```

Executes a live search query across native search engine HTML interfaces with stealth headers and domain-authority boosting. Google searches use a Playwright browser with full anti-bot evasion; other engines use optimized HTTP scraping.

**Request Body:**

| Field                       | Type    | Required | Default        | Description |
| --------------------------- | ------- | -------- | -------------- | ----------- |
| `query`                     | string  | Yes      | —              | Search query (1–512 chars) |
| `limit`                     | integer | No       | `10`           | Results to return (1–20) |
| `engine`                    | string  | No       | `"duckduckgo"` | `"duckduckgo"`, `"bing"`, `"yahoo"`, `"google"`, or `"brave"` |
| `safeSearch`                | string  | No       | `"moderate"`   | `"strict"`, `"moderate"`, or `"off"` |
| `locale`                    | string  | No       | `"us-en"`      | Locale code (2–16 chars) |
| `topic`                     | string  | No       | `"general"`    | `"general"`, `"news"`, or `"finance"` |
| `include_images`            | boolean | No       | `false`        | Include image results |
| `include_image_descriptions`| boolean | No       | `false`        | Include image alt text |
| `privacy_mode`              | string  | No       | `"normal"`     | `"normal"` or `"zero_trace"` |
| `freshness_mode`            | string  | No       | `"preferred"`  | `"always"`, `"preferred"`, `"fallback"`, `"never"` |
| `location`                  | string  | No       | —              | Granular geolocation (e.g., `"us-ny"`) |
| `proxy_profile`             | string  | No       | —              | Proxy rotation profile |
| `country`                   | string  | No       | —              | Country code |
| `session_affinity`          | boolean | No       | —              | Reuse browser session |
| `rotation_strategy`         | string  | No       | —              | `"per_request"`, `"sticky"`, or `"random"` |

**Example:**

```json
{
  "query": "playwright browser automation",
  "limit": 5,
  "engine": "duckduckgo",
  "safeSearch": "moderate",
  "topic": "general"
}
```

**Response:**

```json
{
  "query": "playwright browser automation",
  "limit": 5,
  "engine": "duckduckgo",
  "safeSearch": "moderate",
  "locale": "us-en",
  "results": [
    {
      "title": "Fast and reliable end-to-end testing for modern web apps",
      "url": "https://playwright.dev/",
      "snippet": "Playwright enables reliable end-to-end testing for modern web apps.",
      "rank": 1
    }
  ],
  "requestId": "6301784a-..."
}
```

---

## 7. Crawl API

### Start a Domain Crawl

> **Required role:** `admin` or `developer`

```
POST /v1/crawl
```

Initiates a site-wide crawl starting from a seed URL.

**Request Body:**

| Field      | Type   | Required | Description |
| ---------- | ------ | -------- | ----------- |
| `seed`     | string (URL) | Yes | Starting URL |
| `rules`    | object | No       | See [Crawl Rules](#crawl-rules) |
| `recipeId` | string | No       | Recipe to apply to each crawled page |
| `extract`  | object | No       | Extraction config. See [Extraction Config](#extraction-config) |

**Crawl Rules:**

| Field               | Type    | Default | Description |
| ------------------- | ------- | ------- | ----------- |
| `allowPatterns`     | string[] | `[]`   | URL patterns to include |
| `denyPatterns`      | string[] | `[]`   | URL patterns to exclude |
| `maxDepth`          | integer | `1`     | Maximum link-follow depth (0–5) |
| `maxPages`          | integer | `20`    | Maximum pages to crawl (1–500) |
| `sameDomainOnly`    | boolean | `true`  | Restrict to same domain |
| `politenessDelayMs` | integer | `500`   | Delay between requests in ms (0–30000) |

**Example:**

```json
{
  "seed": "https://docs.example.com",
  "rules": {
    "maxDepth": 2,
    "maxPages": 50,
    "sameDomainOnly": true,
    "politenessDelayMs": 1000
  }
}
```

**Response (202):**

```json
{
  "crawlId": "c8f2b...",
  "state": "queued",
  "requestId": "6301784a-..."
}
```

---

### Get Crawl Status

> **Required role:** `admin`, `developer`, or `readonly`

```
GET /v1/crawl/:crawlId
```

**Response:**

```json
{
  "id": "c8f2b...",
  "projectId": "default",
  "state": "running",
  "seed": "https://docs.example.com",
  "stats": {
    "queued": 12,
    "running": 3,
    "succeeded": 35,
    "failed": 0
  },
  "createdAt": "2026-03-08T10:00:00.000Z",
  "updatedAt": "2026-03-08T10:02:15.000Z"
}
```

Crawl states: `queued`, `running`, `succeeded`, `failed`, `cancelled`.

---

## 8. Recipes API

Recipes are reusable extraction templates that auto-match URLs by pattern.

### List Recipes

> **Required role:** `admin`, `developer`, or `readonly`

```
GET /v1/recipes
```

Returns both built-in and custom recipes.

**Response:**

```json
{
  "items": [
    {
      "id": "hackernews",
      "name": "Hacker News Front Page",
      "version": "1.0.0",
      "description": "Extracts top stories from HN",
      "match": { "patterns": ["*://news.ycombinator.com/*"] },
      "requiresBrowser": false,
      "extraction": {
        "mode": "selectors",
        "selectors": { "stories": ".titleline > a" }
      }
    }
  ]
}
```

---

### Create / Update Recipe

> **Required role:** `admin`

```
POST /v1/recipes
```

**Request Body:**

| Field            | Type    | Required | Default | Description |
| ---------------- | ------- | -------- | ------- | ----------- |
| `id`             | string  | Yes      | —       | Unique recipe ID (1–128 chars) |
| `name`           | string  | Yes      | —       | Display name (1–255 chars) |
| `version`        | string  | Yes      | —       | Version string (1–64 chars) |
| `description`    | string  | No       | —       | Human-readable description |
| `match`          | object  | Yes      | —       | `{ "patterns": ["glob1", "glob2"] }` (min 1 pattern) |
| `requiresBrowser`| boolean | No       | `false` | Whether extraction needs Playwright |
| `steps`          | array   | No       | —       | Browser steps (max 500) |
| `extraction`     | object  | No       | —       | Extraction config |
| `throttling`     | object  | No       | —       | `{ "minDelayMs": number, "concurrencyHint": number }` |
| `pluginPath`     | string  | No       | —       | Custom plugin module path |

**Response (201):**

```json
{ "id": "hackernews" }
```

---

### Validate Recipe

> **Required role:** `admin` or `developer`

```
POST /v1/recipes/validate
```

Validates a recipe schema without persisting it.

**Request Body:** Same as Create Recipe (can optionally be wrapped in `{ "recipe": { ... } }`).

**Response:**

```json
{
  "valid": true,
  "recipe": { ... }
}
```

If invalid:

```json
{
  "valid": false,
  "issues": [
    {
      "code": "invalid_type",
      "path": ["match", "patterns"],
      "message": "Expected array, received undefined"
    }
  ]
}
```

---

## Appendix A: Job Options

| Field               | Type    | Default      | Description |
| ------------------- | ------- | ------------ | ----------- |
| `requiresBrowser`   | boolean | —            | Force browser-based extraction |
| `browserEngine`     | string  | `"chromium"` | `"chromium"`, `"firefox"`, or `"webkit"` |
| `respectRobotsTxt`  | boolean | `true`       | Honor robots.txt directives |
| `timeoutMs`         | integer | `60000`      | Job timeout in ms (1000–300000) |
| `interactiveLogin`  | boolean | `false`      | Enable interactive login flow |
| `proxy_profile`     | string  | —            | Proxy rotation profile name |
| `country`           | string  | —            | Geolocation country code |
| `session_affinity`  | boolean | —            | Reuse browser session for domain |
| `rotation_strategy` | string  | —            | `"per_request"`, `"sticky"`, or `"random"` |

## Appendix B: Step Types

Browser automation steps are defined as `{ "type": "<name>", "args": { ... } }`.

| Step Type            | Args                                              | Description |
| -------------------- | ------------------------------------------------- | ----------- |
| `goto`               | `{ url: string }`                                 | Navigate to URL |
| `setHeaders`         | `{ headers: { [key]: string } }`                  | Set custom request headers |
| `setCookies`         | `{ cookies: CookieInput[] }`                      | Inject cookies into browser context |
| `exportCookies`      | `{}`                                              | Export current cookies as artifact |
| `waitForSelector`    | `{ selector: string, timeoutMs?: number }`        | Wait for CSS selector to appear |
| `click`              | `{ selector: string }`                            | Click an element |
| `type`               | `{ selector: string, text: string, secret?: bool }` | Type text into an input |
| `scroll`             | `{ direction: "up"\|"down", amount: number }`     | Scroll the page |
| `wait`               | `{ ms: number }`                                  | Wait a fixed duration |
| `waitForNetworkIdle` | `{ timeoutMs?: number }`                          | Wait for network activity to settle |
| `paginate`           | `{ nextSelector: string, maxPages?: number (1–100, default 10), stopCondition?: string }` | Auto-paginate through pages |
| `screenshot`         | `{ name: string }`                                | Capture a screenshot artifact |
| `extract`            | ExtractionConfig                                  | Run extraction mid-flow |

### Cookie Input Shape

```json
{
  "name": "session_id",
  "value": "abc123",
  "domain": ".example.com",
  "path": "/",
  "expires": 1735689600,
  "httpOnly": true,
  "secure": true,
  "sameSite": "Lax"
}
```

Only `name` and `value` are required; all other fields are optional.

## Appendix C: Extraction Config

| Field        | Type   | Required           | Description |
| ------------ | ------ | ------------------ | ----------- |
| `mode`       | string | Yes                | `"selectors"`, `"schema"`, or `"plugin"` |
| `selectors`  | object | If mode=selectors  | Map of `{ name: "css-selector" }` |
| `jsonSchema` | object | If mode=schema     | JSON Schema to extract structured data |
| `plugin`     | string | If mode=plugin     | Plugin module path |

## Appendix D: Environment Variables

| Variable                        | Default       | Description |
| ------------------------------- | ------------- | ----------- |
| `KRYFTO_PORT`                   | `8080`        | API server port |
| `KRYFTO_LOG_LEVEL`              | `"info"`      | Log verbosity |
| `KRYFTO_API_TOKEN`              | —             | Bootstrap API token |
| `KRYFTO_PROJECT_ID`             | `"default"`   | Default project ID |
| `KRYFTO_JOB_MAX_ATTEMPTS`       | `3`           | Max job retry attempts |
| `KRYFTO_SSRF_BLOCK_PRIVATE_RANGES` | `"true"`   | Block SSRF to private IPs |
| `KRYFTO_ALLOWED_HOSTS`          | —             | Comma-separated allowlist |
| `KRYFTO_STEALTH_MODE`           | —             | Enable stealth headers |
| `KRYFTO_ROTATE_USER_AGENT`      | —             | Rotate UA per request |
| `KRYFTO_PROXY_URLS`             | —             | Comma-separated proxy list |
| `KRYFTO_HUMANIZE`               | `"true"`      | Humanized mouse/keyboard |
| `KRYFTO_BROWSER_POOL`           | `"true"`      | Per-domain session reuse |
| `REDIS_HOST`                    | `"redis"`     | Redis hostname |
| `REDIS_PORT`                    | `6379`        | Redis port |

---

## Route Summary

| Method | Path                        | Auth Role              | Description |
| ------ | --------------------------- | ---------------------- | ----------- |
| GET    | `/v1/healthz`               | Public                 | Health check |
| GET    | `/v1/readyz`                | Public                 | Readiness probe |
| GET    | `/v1/metrics`               | Public                 | Prometheus metrics |
| GET    | `/docs/openapi.yaml`        | Public                 | OpenAPI spec |
| POST   | `/v1/admin/tokens`          | admin                  | Create API token |
| GET    | `/v1/admin/tokens`          | admin                  | List all tokens |
| GET    | `/v1/admin/tokens/:tokenId` | admin                  | Get token details |
| DELETE | `/v1/admin/tokens/:tokenId` | admin                  | Revoke token |
| PATCH  | `/v1/admin/tokens/:tokenId` | admin                  | Update token |
| POST   | `/v1/admin/tokens/:tokenId/rotate` | admin            | Rotate token |
| GET    | `/v1/admin/projects`        | admin                  | List projects |
| POST   | `/v1/admin/projects`        | admin                  | Create project |
| GET    | `/v1/admin/stats`           | admin                  | Dashboard stats |
| GET    | `/v1/admin/jobs`            | admin                  | List all jobs (paginated) |
| GET    | `/v1/admin/crawls`          | admin                  | List all crawls (paginated) |
| GET    | `/v1/admin/audit-logs`      | admin                  | Query audit logs |
| GET    | `/v1/admin/rate-limits`     | admin                  | Get rate limit config |
| PUT    | `/v1/admin/rate-limits`     | admin                  | Update rate limits |
| POST   | `/v1/jobs`                  | admin, developer       | Create job |
| GET    | `/v1/jobs/:jobId`           | admin, developer, readonly | Get job status |
| POST   | `/v1/jobs/:jobId/cancel`    | admin, developer       | Cancel job |
| GET    | `/v1/jobs/:jobId/logs`      | admin, developer, readonly | Stream logs (SSE) |
| GET    | `/v1/jobs/:jobId/artifacts` | admin, developer, readonly | List job artifacts |
| GET    | `/v1/artifacts/:artifactId` | admin, developer, readonly (or downloadToken) | Download artifact |
| POST   | `/v1/extract`               | admin, developer       | Extract from content |
| POST   | `/v1/search`                | admin, developer, readonly | Federated search |
| POST   | `/v1/crawl`                 | admin, developer       | Start crawl |
| GET    | `/v1/crawl/:crawlId`        | admin, developer, readonly | Get crawl status |
| GET    | `/v1/recipes`               | admin, developer, readonly | List recipes |
| POST   | `/v1/recipes`               | admin                  | Create/update recipe |
| POST   | `/v1/recipes/validate`      | admin, developer       | Validate recipe |
