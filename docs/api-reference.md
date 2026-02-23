# Kryfto API Reference

The Kryfto REST API provides programmable access to the headless browser fleet, extraction engine, and federated search tools.

## Base URL

\`\`\`text
http://localhost:8080/v1
\`\`\`

## Authentication

All requests must include an active API token in the \`Authorization\` header.
\`\`\`http
Authorization: Bearer <your_api_token>
\`\`\`

---

## 1. Jobs API (Headless Browsing & Extraction)

### Create a Job

**Endpoint:** \`POST /jobs\`

Creates a new background task to navigate to a URL, optionally execute custom browser steps, and extract data.

**Request Body:**
\`\`\`json
{
"url": "https://example.com",
"options": {
"browserEngine": "chromium", // or "firefox", "webkit"
"requiresBrowser": true, // false = fallback to simple HTTP parser
"respectRobotsTxt": true,
"proxy_profile": "premium_res", // optional: proxy rotation profile
"country": "US" // optional: specific geolocation
},
"privacy_mode": "normal", // or "zero_trace" (bypasses database)
"freshness_mode": "preferred", // "always", "preferred", "fallback", "never"
"steps": [
{ "type": "goto", "args": { "url": "https://example.com" } },
{ "type": "waitForNetworkIdle", "args": { "timeoutMs": 15000 } }
],
"extract": {
"mode": "selectors", // or "schema", "plugin"
"selectors": {
"title": "title",
"main_heading": "h1"
}
}
}
\`\`\`

**Response:**
\`\`\`json
{
"jobId": "e10c6c92-d85a-40fa-be36-ee240f687927",
"state": "queued",
"requestId": "6301784a-5e1b-42f4-bb2c-62a707da8c7d"
}
\`\`\`

### Get Job Status

**Endpoint:** \`GET /jobs/:jobId\`

Retrieves the current execution state of a job.

**Response:**
\`\`\`json
{
"id": "e10c6c92-d85a-40fa-be36-ee240f687927",
"state": "succeeded",
"url": "https://example.com",
"attempts": 1,
"resultSummary": {
"title": "Example Domain",
"main_heading": "Example Domain"
}
}
\`\`\`

---

## 2. Artifacts API

When jobs extract large objects (like full-page Markdown, PDF buffers, or screenshots), they are saved as Artifacts.

### List Artifacts for a Job

**Endpoint:** \`GET /jobs/:jobId/artifacts\`

**Response:**
\`\`\`json
{
"items": [
{
"id": "a92b3c4d-...",
"jobId": "e10c6c92-...",
"type": "screenshot",
"contentType": "image/png",
"signedUrl": "https://minio... (expires in 5m)",
"downloadToken": "temp-uuid-token"
}
]
}
\`\`\`

### Download Artifact

**Endpoint:** \`GET /artifacts/:artifactId\`

If authenticating via API Token is not possible (e.g. within an `<img>` tag), you can pass the \`downloadToken\` securely:
\`\`\`http
GET /artifacts/a92b3c4d-...?downloadToken=temp-uuid-token
\`\`\`

---

## 3. Search API

### Federated Search

**Endpoint:** \`POST /search\`

Executes a live search query across native engines with domain-authority boosting and bot-evasion via \`gbv=1\`.

**Request Body:**
\`\`\`json
**Endpoint:** `POST /search`

Executes a live search query across native engines with domain-authority boosting and bot-evasion via `gbv=1`.

**Request Body:**

```json
{
  "query": "playwright browser automation",
  "limit": 10,
  "safeSearch": "moderate",
  "engines": ["google", "duckduckgo", "brave"],
  "officialOnly": true,
  "sortByDate": true,
  "topic": "general", // Multimodal: "news", "finance", "general"
  "location": "us-ny", // Granular geolocation targeting
  "privacy_mode": "zero_trace" // Bypasses Postgres artifact saving entirely
}
```

**Response:**

```json
{
  "query": "playwright browser automation",
  "results": [
    {
      "title": "Fast and reliable end-to-end testing for modern web apps",
      "url": "https://playwright.dev/",
      "snippet": "Playwright enables reliable end-to-end testing for modern web apps.",
      "source_domain": "playwright.dev",
      "rank": 1,
      "engine_used": "duckduckgo",
      "is_official": true
    }
  ]
}
\`\`\`

---

## 4. Crawl API

### Start a Domain Crawl
**Endpoint:** \`POST /crawl\`

Instructs the worker fleet to aggressively map a domain, adhering to cross-origin rules and depth constraints.

**Request Body:**
\`\`\`json
{
  "seed": "https://docs.example.com",
  "rules": {
    "maxDepth": 2,
    "maxPages": 50,
    "sameDomainOnly": true,
    "politenessDelayMs": 1000
  }
}
\`\`\`

**Response:**
\`\`\`json
{
  "crawlId": "c8f2b...",
  "state": "queued"
}
\`\`\`
```
