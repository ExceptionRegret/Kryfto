<div align="center">
  
  <img src="assets/logo.png" alt="Kryfto Logo" width="280" />

  <h1>Kryfto</h1>
  <p><strong>The Production-Grade Browser Data Collection Runtime</strong></p>
  
  [![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)
  [![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new)
  
  <p>Self-host your own headless browser fleet. Connect it instantly to AI agents, IDEs, and workflow engines via OpenAPI and MCP.</p>
</div>

<hr/>

## ✨ Core Features

Kryfto is a comprehensive framework for automated data extraction, web crawling, and browser session execution.

- **🤖 AI Agent Ready**: Ships with a built-in [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server exposing **42+ tools**. Instantly give Claude, Cursor, or Codex the ability to search, browse, extract, fact-check, run continuous research agents, and benchmark search quality on the live web.
- **🕵️‍♂️ Advanced Stealth Engine**: Unified anti-bot layer (`stealth.ts`) with **16 rotated modern User-Agents** (Chrome 130–133, Firefox 133–134, Safari 18.3, Edge 131–133), per-browser `Sec-Ch-Ua` client hints, `Sec-Fetch-*` headers, browser-family-specific `Accept` strings, engine-appropriate `Referer` headers, per-engine request spacing delays, and an in-memory cookie jar with 30min TTL. Search engines cannot distinguish these requests from organic browser traffic.
- **🛡️ Zero Trace Privacy**: Execute purely in-memory HTTP extractions wrapping our bot-evasion without persisting any telemetry or artifacts to the Postgres database.
- **⚙️ Workflow Engine Native**: Fully documented OpenAPI spec makes it trivial to drop into `n8n`, Zapier, Make, or custom Python/TypeScript pipelines.
- **☁️ Enterprise Infrastructure**: Backed by **Postgres** for persistence, **Redis + BullMQ** for reliable concurrent job queuing, and **MinIO/S3** for long-term artifact storage.
- **📊 SLO Dashboard & Eval Suite**: Built-in reliability monitoring with per-tool success rates, latency percentiles (p50/p95/p99), deterministic request replay, and a 10-query benchmark suite for nightly regression testing.
- **🔄 Continuous Research Agent**: Deploy autonomous background research loops that search, monitor, diff pages, and fire webhook alerts — all from a single MCP tool call.

---

## 🚀 Quickstart (Self-Hosted)

Get Kryfto running locally in seconds using Docker Compose.

```bash
# Option 1: Auto-generate a secure .env with random tokens & passwords
node scripts/generate-env.mjs -o .env

# Option 2: Or copy the example and fill in values manually
cp .env.example .env

# Spin up the entire infrastructure (API, Worker, Postgres, Redis, Minio S3)
docker compose up -d --build

# Verify health
curl -H "Authorization: Bearer $KRYFTO_API_TOKEN" http://localhost:8080/v1/healthz
```

Once running, you can immediately dispatch extraction jobs to the headless worker fleet:

```bash
curl -X POST http://localhost:8080/v1/jobs \
  -H "Authorization: Bearer $KRYFTO_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-example-1" \
  -d '{"url":"https://example.com"}'
```

### Reading Extracted Data

After the job succeeds, retrieve the extracted Markdown or HTML artifact:

```bash
curl -H "Authorization: Bearer $KRYFTO_API_TOKEN" \
  http://localhost:8080/v1/jobs/<jobId>/artifacts
```

### Running a Federated Search

Find up-to-date information across DuckDuckGo, Brave, and Google natively:

```bash
curl -X POST http://localhost:8080/v1/search \
  -H "Authorization: Bearer $KRYFTO_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"playwright testing", "limit":5, "officialOnly":true}'
```

> **Note:** For a full breakdown of the REST API, parameter schemas, and advanced options, please refer to the [**API Reference Guide**](docs/api-reference.md).

---

## 📚 Documentation Index

We maintain exhaustive documentation for every component of the Kryfto stack.

| Guide                                         | Description                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 📖 [**Usage Examples**](docs/usage.md)        | Exhaustive API, CLI, and cURL examples for scraping, crawling, and scheduling retries.                     |
| 🚀 [**Deployment Guides**](docs/deploy.md)    | How to deploy to Railway, DigitalOcean, and naked Linux VPS instances securely.                            |
| 🤖 [**MCP Integration**](docs/mcp.md)         | How to connect Cursor, Claude Code, and Codex to your Kryfto server via HTTPS or SSH tunneling.            |
| ⚡ [**n8n Workflow Guide**](docs/n8n.md)      | How to automate advanced, stealthy web extractions straight into Google Sheets using n8n.                  |
| 🔒 [**Security & Roles**](docs/security.md)   | Setting up RBAC, admin tokens, and preventing Server-Side Request Forgery (`SSRF`).                        |
| 🏗️ [**Architecture**](docs/architecture.md)   | A deep-dive into the BullMQ, Redis, Node, and MinIO scaling infrastructure map.                            |
| 🥘 [**Extraction Recipes**](docs/recipes.md)  | Pre-written JSON extraction selectors for popular websites. Auto-imported as dynamic `recipe_*` MCP tools. |
| 🔌 [**OpenAPI Spec**](docs/openapi.yaml)      | The raw `yaml` schema defining the fully-typed REST API.                                                   |
| ⚙️ [**API Reference**](docs/api-reference.md) | Structured usage guide for Jobs, Artifacts, and Search endpoints.                                          |

---

## 🧩 Ecosystem Integrations

Kryfto isn't just an API—it's designed to act as the web-browsing "motor cortex" for your existing tools.

### 1. 🤖 Claude Code, Cursor, & Codex (MCP)

You can directly attach Kryfto to your AI assistant using the bundled **Model Context Protocol (MCP)** server.

#### 🪄 Auto-Generate Configuration

The easiest way to get your IDE connected is to run the interactive setup wizard. It will auto-detect your API token and absolute path:

```bash
node scripts/setup-mcp.mjs
```

_Select your client (Claude, Cursor, Codex, RooCode) and copy the generated JSON/TOML into your config file._

---

#### Manual Configuration

**Claude Code / Cursor** — Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kryfto": {
      "command": "node",
      "args": ["/absolute/path/to/kryfto/packages/mcp-server/dist/index.js"],
      "env": {
        "API_BASE_URL": "http://localhost:8080",
        "API_TOKEN": "<your-token>"
      }
    }
  }
}
```

**OpenAI Codex** — Add to `.codex/config.toml` (per-project) or `~/.codex/config.toml` (global):

```toml
[mcp_servers.kryfto]
command = "node"
args = ["/absolute/path/to/kryfto/packages/mcp-server/dist/index.js"]

[mcp_servers.kryfto.env]
API_BASE_URL = "http://localhost:8080"
API_TOKEN = "<your-token>"
```

**Remote VPS configuration (`claude_desktop_config.json` / Cursor MCP Menu):**

**⚠️ SSH Keys Required:** The MCP tunnel relies on `stdio` and cannot accept manual passwords. You must set up SSH Key authentication from your local machine to your VPS.

**macOS/Linux:**

```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
ssh-copy-id user@your-vps-ip
```

**Windows (PowerShell):**

```powershell
ssh-keygen -t ed25519 -C "your_email@example.com"
$Key = Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub"
ssh user@your-vps-ip "mkdir -p ~/.ssh && echo '$Key' >> ~/.ssh/authorized_keys"
```

Once `ssh user@your-vps-ip` logs you in instantly without a password, paste this config:

```json
{
  "mcpServers": {
    "kryfto-remote": {
      "command": "ssh",
      "args": [
        "user@your-vps-ip",
        "API_BASE_URL=http://localhost:8080",
        "API_TOKEN=<your-token>",
        "node",
        "/absolute/path/on/vps/to/kryfto/packages/mcp-server/dist/index.js"
      ]
    }
  }
}
```

#### 🏆 Kryfto vs. Built-in Agent Browsers

Why install Kryfto when Claude and Cursor have built-in web search? Because Kryfto is engineered specifically for **evidence-based deterministic scraping** rather than noisy LLM-summarized search.

<div align="center">
  <img src="assets/benchmark-proof.png" alt="Kryfto MCP vs Built-in Browser Benchmark" width="800" />
</div>

**Real-world benchmark (Query: `latest Next.js 15 features`):**

- **Built-in Browser:** Returns a mix of non-official blogs (e.g., `nextjs15.com`), video results, and unstructured snippets. Fails to consistently identify the newest minor release.
- **Kryfto MCP:** Extracts the semantic release version (`15.5`) from the URL, automatically ranks the official `nextjs.org` blog at **Rank #1**, and extracts the raw Markdown documentation structure (headings, code blocks, publish date) in a single deterministic pass.

> _"For this specific task and latest run, **I prefer MCP.** Reason: it returned the official `nextjs.org` 15.5 page first and gave structured output (`published_at`, sections, extracted markdown) in one step. - AI Assistant Verdict"_

_Read the complete [MCP Documentation](docs/mcp.md) for full tool breakdowns._

### 2. ⚡ n8n & Workflow Automation (Deep Dive)

Kryfto exposes a fully typed `/v1` REST API complete with an OpenAPI specification, making it the perfect engine for visual automation tools like **n8n**, **Make**, or **Zapier**.

Instead of paying for expensive API credits on premium scraping platforms, you can use n8n's native **HTTP Request** node to trigger Kryfto's headless browsers.

**How to build an n8n Web Scraping Pipeline:**

1. **Trigger:** Set up a Schedule Trigger (e.g., run every morning at 8 AM).
2. **Action (Kryfto):** Add an HTTP Request node pointing to your Kryfto instance:
   - **Method:** `POST`
   - **URL:** `http://your-vps-ip:8080/v1/jobs`
   - **Headers:** `Authorization: Bearer <your-token>`
   - **Body (Extraction Job):**
     ```json
     {
       "url": "https://news.ycombinator.com",
       "options": {
         "browserEngine": "chromium"
       },
       "extract": {
         "mode": "selectors",
         "selectors": {
           "topStories": ".titleline > a"
         }
       }
     }
     ```
   - **Alternative Body (Deep Search Pipeline):**
     Use Kryfto's `/v1/search` endpoint instead to find links on DuckDuckGo, then route the JSON results array into an n8n _Split In Batches_ Node to crawl them automatically!
     ```json
     {
       "query": "best enterprise headless CMS tools 2025",
       "limit": 5,
       "engine": "duckduckgo",
       "safeSearch": "moderate",
       "locale": "us-en"
     }
     ```
3. **Processing:** Add a subsequent node to parse the returned JSON.
4. **Destination:** Send the formatted data to Google Sheets, Notion, or Slack!

### 3. 🔍 Native Fallback Search Engine (Cutting API Costs)

Need to execute multi-engine searches without paying outrageous API limits?

Traditional platforms force you to buy expensive **Google Custom Search** or **Bing Search APIs** for basic discovery. Kryfto's SDK routes headless scraping traffic directly through the native HTML search interfaces of search providers, specifically designed for resilience against bots.

You can instantly find leads or domains _without paying a cent in API credits_:

- **Engines**: `duckduckgo`, `bing`, `yahoo`, `brave`, `google` _(Google requires API keys to bypass captchas rapidly, others do not)_.

---

## 💡 Why Kryfto? (Cost Savings & Benefits)

Most modern AI and web-scraping architectures rely on expensive third-party APIs (like Firecrawl, Apify, or Browserless). Kryfto replaces these dependencies by giving you **complete ownership of your scraping infrastructure**.

### 💸 The Scraping Cost Comparison (100k Requests)

| Platform                     | Cost per 100,000 Pages | Concurrency Limits            | Wait-for-Selectors |
| ---------------------------- | ---------------------- | ----------------------------- | ------------------ |
| **Firecrawl.dev**            | ~$100.00 / mo          | 50-100 Concurrent             | Paid Extra         |
| **Browserless.io**           | ~$200.00 / mo          | Route-dependent               | Paid Extra         |
| **Apify (Web Scraper)**      | ~$50.00+ / mo          | Memory restricted             | Standard           |
| **Kryfto (Self-Hosted VPS)** | **$5.00 / mo Flat**    | **Infinite (Hardware Bound)** | **Included Free**  |

- 💰 **Zero Per-Request Costs:** As the table shows, stop paying per-API-call limits. By self-hosting Kryfto on a $5/month DigitalOcean droplet or Railway instance, you can run millions of concurrent browser extractions for a flat infrastructure fee.
- 🛡️ **Total Data Privacy:** When you connect local IDEs (Cursor/Claude) or internal databases to Kryfto, your sensitive queries and raw scraped HTML never leave your VPC or touch a third-party analytics server.
- 🚦 **Unmetered Concurrency:** You dictate your rate limits. If you need to spin up 50 headless Chromium instances simultaneously, simply scale your worker droplet without hitting external API throttles.
- 🤖 **AI-Context Optimization:** Kryfto automatically cleans, minifies, and converts bloated web HTML into dense Markdown. This drastically reduces LLM token consumption and improves context window limits when passing context to Claude or OpenAI.

---

## 🎯 Primary Use Cases & Solutions

### Use Case 1: Automated Market Research & Price Monitoring

**The Problem:** You need to track competitor product pricing across 10 different e-commerce sites daily, but they aggressively block basic python `requests` scripts.
**The Kryfto Solution:**

- Enable `KRYFTO_STEALTH_MODE=true` and feed residential proxies into `KRYFTO_PROXY_URLS`.
- Use the REST API to schedule daily `crawl` jobs pointing to competitor catalogs.
- Kryfto bypasses their bot protection, extracts the prices using CSS selectors (`"price": ".amount"`), and drops the raw JSON directly into your MinIO storage bucket for your analytics dashboard to query.

### Use Case 2: Unblocking AI Coding Assistants

**The Problem:** Your AI assistant (Cursor, Claude Code) is writing code using outdated documentation because the framework released a new version yesterday that isn't in its training data.
**The Kryfto Solution:**

- Install the Kryfto MCP Server into your IDE configuration.
- Ask your agent: _"Search for the newest Next.js App Router caching docs and update my code."_
- Kryfto executes the search, extracts the live, up-to-date documentation, and pipes it straight into the AI's context window—allowing it to write perfect, modern code.

### Use Case 3: Proprietary Lead Generation Pipelines

**The Problem:** You want to build a pipeline that finds local businesses on directory sites and extracts their contact emails to automatically pipe into your CRM.
**The Kryfto Solution:**

- Connect Kryfto to an n8n workflow.
- Step 1: Trigger Kryfto to execute a `search` for "plumbers in Chicago".
- Step 2: Loop through the search results and trigger Kryfto `browse` extraction jobs on each result's URL, targeting `mailto:` hrefs or contact page DOM nodes.
- Step 3: Automatically POST the collected emails directly into HubSpot or Salesforce.

### Use Case 4: Evidence-Based Technical Research

**The Problem:** Your team makes decisions based on blog posts and Stack Overflow answers with no source verification. You need traceable, trustworthy evidence.
**The Kryfto Solution:**

- Use `answer_with_evidence` to ask a question like "Does React 19 support server components?" — it searches, reads official pages, extracts paragraph-level evidence spans, and ranks them by domain trust score.
- Use `conflict_detector` to check if multiple sources contradict each other on a topic.
- Use `confidence_calibration` to score each claim based on source count, official source presence, recency, and domain trust.

### Use Case 5: Framework Upgrade Risk Assessment

**The Problem:** You need to upgrade Next.js from v13 to v14 but don't know what will break.
**The Kryfto Solution:**

- Call `upgrade_impact` with `framework: "nextjs", fromVersion: "13", toVersion: "14"` — it fetches migration guides, scans for breaking/deprecated/removed keywords, and rates the risk as low/medium/high.
- Combine with `github_releases` and `github_diff` to see every commit between tags.
- Use `query_planner` to preview the entire search→read→extract chain before executing.

### Use Case 6: Continuous Documentation Monitoring

**The Problem:** A critical API's docs change without notice, breaking your integration.
**The Kryfto Solution:**

- `watch_and_act` registers the URL with an optional Slack/Discord webhook and a semantic `context` filter.
- Periodically call `check_watch` — if the page changed, it auto-fires a POST to your webhook with the diff and reports delivery status.
- Use `semantic_diff` with context like "authentication" to filter only changes relevant to you.
- For fully autonomous monitoring, use `continuous_research_start` — it runs search→watch→diff→alert loops on a configurable interval, notifying your webhook of every new finding.

### Use Case 7: SLO Monitoring & Production Reliability

**The Problem:** You need to know if your AI agent's browsing tool is degrading before users notice.
**The Kryfto Solution:**

- `slo_dashboard` shows real-time per-tool success rate, p50/p95/p99 latency, cache hit rate, and freshness.
- `run_eval_suite` runs 10 real-world queries nightly, checking that official sources appear in results — measures precision% and average latency.
- `replay_request` retrieves the exact input/output of any previous call by `requestId` for debugging.

---

## 🥷 Anti-Bot & Stealth Configuration

Kryfto ships with a unified stealth layer (`packages/shared/src/stealth.ts`) designed to make every HTTP request indistinguishable from organic browser traffic.

### What’s Included (Zero Config Required)

| Feature | Description |
|---|---|
| **User-Agent Rotation** | 16 modern UAs covering Chrome 130–133, Firefox 133–134, Safari 18.3, Edge 131–133 |
| **Client Hints (`Sec-Ch-Ua`)** | Correct per-browser hints for Chrome/Edge (omitted for Firefox/Safari, matching real behavior) |
| **Sec-Fetch Headers** | Full `Sec-Fetch-Dest/Mode/Site/User` set for Chromium/Firefox; minimal for Safari |
| **Accept Headers** | Browser-family-specific (Chrome, Firefox, and Safari each send different Accept strings) |
| **Referer** | Engine homepage injected automatically (e.g., `https://www.google.com/` for Google queries) |
| **Request Spacing** | Per-engine delays: Google 800–1500ms, Bing/Yahoo 400–800ms, DDG 200–500ms, Brave 300–600ms |
| **Cookie Jar** | In-memory `Set-Cookie` persistence per domain with 30min TTL |
| **Platform Hints** | Derived from UA: Windows/macOS/Linux |

### Optional Proxy Configuration

For crawling highly-protected sites (Cloudflare, Datadome, etc.), add proxies in your `.env`:

```env
KRYFTO_STEALTH_MODE=true
KRYFTO_ROTATE_USER_AGENT=true
# Feed it a comma-separated list of premium residential proxies
KRYFTO_PROXY_URLS=socks5://proxy1:1080,http://user:pass@proxy2:8080
```

---

## 🏗️ Architecture

Kryfto is structured as an NPM monorepo using `pnpm` workspaces.

- `apps/api` - Fastify control plane (handles your REST requests)
- `apps/worker` - BullMQ workers (manages Playwright instances and executes steps)
- `packages/sdk-ts` - TypeScript core SDK
- `packages/mcp-server` - Anthropic Model Context Protocol Bridge
- `packages/cli` - Terminal management interface

### Development Commands

```bash
pnpm install
pnpm build
pnpm typecheck
KRYFTO_BASE_URL=http://localhost:8080 KRYFTO_API_TOKEN=$KRYFTO_API_TOKEN pnpm test:integration
```

---

## ❤️ Support the Project

Kryfto is free and open-source. If it saves you money on scraping APIs or helps power your AI workflows, consider supporting continued development with a small donation!

| Network            | Address                                        |
| ------------------ | ---------------------------------------------- |
| **Bitcoin (BTC)**  | `bc1qd8ztrxucrhz27fgmu754ayq59lvjprclxdury5`   |
| **Ethereum (ETH)** | `0x0a01779792a17fc57473a6368f3970fa1d8830ba`   |
| **Solana (SOL)**   | `FNKjiS2zhCq3rv8bboA83pzvKwDov3wyFxQn4sy75bPr` |
| **BNB (BSC)**      | `0x0a01779792a17fc57473a6368f3970fa1d8830ba`   |
| **Tron (TRX)**     | `TF7YwGwP6cDCTGxLAjRKxqPss18pMp762G`           |

Every contribution helps keep the lights on and the browsers headless. 🙏

---

### License

Apache-2.0 (`LICENSE`)

---

## 📋 Changelog

### v3.2.0 — The Moat: Competitive Intelligence Engine (Latest)

_Continuous Research Agent · Intent Reranking · PDF Extraction · Strict Evidence · Hardened Webhooks_

- **Continuous Research Agent:** New `continuous_research_start`, `continuous_research_status`, and `continuous_research_cancel` tools for autonomous background research loops that repeatedly search, monitor, semantic-diff pages, and fire webhook alerts on findings.
- **Intent-Based Reranking:** `federatedSearch` now detects query intent (`troubleshooting`, `documentation`, `news`) and dynamically adjusts domain scores — official docs dominate doc queries, Stack Overflow dominates troubleshooting.
- **Redirect Canonicalization:** `unwrapTrackingUrls` strips `utm_*`, `gclid`, `fbclid`, `msclkid`, and resolves Bing/Yahoo wrapper URLs before trust scoring.
- **Strict Evidence Gates:** `answer_with_evidence` and `citationSearch` return structured `insufficient_evidence` objects instead of throwing, enabling intelligent AI retry logic.
- **PDF Extraction:** Native `pdf-parse` integration in the worker — PDF URLs are automatically extracted to text and processed as Markdown.
- **Markdown Table Extraction:** Integrated `turndown-plugin-gfm` for high-fidelity table preservation in `read_url` output.
- **Extreme Reliability:** Search Success ≥ 99%, Read Success ≥ 97% with aggressive HTTP 429 exponential jitter backoff.
- **Unified Stealth Layer:** New `stealth.ts` module with 16 rotated UAs, per-browser `Sec-Ch-Ua`/`Sec-Fetch-*` headers, engine-specific `Referer`, request spacing delays, and in-memory cookie jar. Replaces all hardcoded User-Agent strings.
- **Hardened Webhooks:** `watch_and_act` now accepts semantic `context` filters and reports webhook delivery status (`delivered`/`failed`) with HTTP error details.
- **Research Traces:** `research` tool output now includes per-step `timings` (search latency, read phase) and per-page `latencyMs` for debugging.
- **Eval Thresholds:** `precision@5 ≥ 75%`, `officialHitRate ≥ 80%`, `searchSuccessRate ≥ 99%` enforced in CI.

### v3.1.0 — Deep Research & Stealth Proxies

_Async Research · Zero-Trace Mode · Geolocation · Dynamic Plugins_

- **Async Deep Research API:** Non-blocking tools (`research_job_start`, `research_job_status`, `research_job_cancel`) for massive iterative research pipelines.
- **Zero-Trace Preflighting:** `privacy_mode: "zero_trace"` bypasses BullMQ and Postgres for artifact-free in-memory extraction.
- **Granular Controls:** `freshness_mode` cache evictions + `proxy_profile`/`location`/`country`/`rotation_strategy` parameters.
- **Dynamic Plugin Tooling:** Auto-mounts saved extraction templates from `/v1/recipes` as native LLM tools.

### v3.0.1 — Search & Reliability Hardening

_Google anti-bot bypass · Semantic version sorting · Bugfixes_

- **Google Crawler Bypass:** `gbv=1` and Chrome User-Agent spoofing to evade Google's JS challenge.
- **Semantic Recency Ranking:** Robust `-X-Y-Z` version parsing — minor version docs (e.g. `15.5`) outrank major releases.
- **Internal Error Fix:** Resolved 500 `INTERNAL_ERROR` Postgres crash in `read_url`.

### v3.0.0 — Advanced Intelligence Engine

_36 MCP tools · SLO dashboard · Deterministic replay · Eval suite_

**New Tools:**
| Tool | Category | Description |
|---|---|---|
| `research` | Pipeline | Unified search→read→extract pipeline in one call |
| `answer_with_evidence` | Research | Search + read + extract evidence spans with trust scores |
| `conflict_detector` | Research | Detect contradictions across sources |
| `truth_maintenance` | Reliability | Auto-expire stale cached facts |
| `upgrade_impact` | Developer Intel | Framework migration risk analysis |
| `query_planner` | Workflow | Preview search/read/extract plan with cost estimates |
| `confidence_calibration` | Research | Per-claim calibrated confidence scoring |
| `source_trust` | Trust | Domain trust scoring (github=0.9, arxiv=0.95, .gov=0.9) |
| `set_source_trust` | Trust | Override domain trust for session |
| `watch_and_act` | Monitoring | Register URL + webhook for change alerts |
| `check_watch` | Monitoring | Check watched URL, fires webhook if changed |
| `semantic_diff` | Monitoring | Context-filtered meaningful diffs |
| `evaluation_harness` | Testing | Internal benchmark (5 tests) |
| `set_memory_profile` | Preferences | Per-project source/stack/format memory |
| `get_memory_profile` | Preferences | Read project preferences |
| `slo_dashboard` | Observability | Per-tool success rate, p50/p95/p99 latency |
| `replay_request` | Debugging | Retrieve exact previous request by ID |
| `list_replays` | Debugging | Browse replayable request history |
| `run_eval_suite` | Testing | 10 real-world query benchmark suite |
| `research_job_*` | Pipeline | Start, Status, and Cancel deep async research |
| `continuous_research_*` | Agent Loop | Start, Status, and Cancel autonomous research agents |
| `recipe_*` | Extraction | Dynamic mounting of user-defined JSON recipes |

**Infrastructure:**

- Every tool call auto-records SLO metrics (success, latency, cache)
- Every response stored for deterministic replay (last 1,000)
- Server version bumped to 3.0.0

### v2.0.0 — MCP Server V2 Rewrite

_17 MCP tools · 30 features · Federated search · GitHub tools_

- Federated multi-engine search with auto-fallback (DuckDuckGo, Brave, Bing, Yahoo, Google)
- `read_url` with HTML→Markdown, publish-date extraction, section detection
- `read_urls` batch processing (up to 10 concurrent)
- Citation mode (`cite`), change detection (`detect_changes`)
- GitHub tools: `github_releases`, `github_diff`, `github_issues`
- Developer intelligence (`dev_intel`)
- URL monitors (`add_monitor`, `list_monitors`)
- In-memory cache with TTL, retry with exponential backoff
- Domain priority boosting, official-only filtering
- Scoped API tokens, domain blocklist/allowlist
- Rich `_meta` in every response (requestId, latencyMs, cached, tool)

### v1.0.0 — Initial Release

_7 MCP tools · Core infrastructure_

- `browse`, `crawl`, `extract`, `search` tools
- `get_job`, `list_artifacts`, `fetch_artifact`
- Stealth mode with User-Agent rotation
- Docker Compose infrastructure (API, Worker, Postgres, Redis, MinIO)
