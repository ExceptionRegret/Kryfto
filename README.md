<div align="center">
  
  <img src="assets/logo.png" alt="Kryfto Logo" width="280" />

  <h1>Kryfto</h1>
  <p><strong>The Production-Grade Browser Data Collection Runtime</strong></p>

  [![CI](https://github.com/kryfto/kryfto/actions/workflows/ci.yml/badge.svg)](https://github.com/kryfto/kryfto/actions/workflows/ci.yml)
  [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
  [![Node.js 20+](https://img.shields.io/badge/node-20%2B-brightgreen.svg)]()
  [![MCP Tools: 42+](https://img.shields.io/badge/MCP_Tools-42%2B-purple.svg)]()

  [![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)
  [![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new)
  
  <p>Self-host your own headless browser fleet. Connect it instantly to AI agents, IDEs, and workflow engines via OpenAPI and MCP.</p>
</div>

<hr/>

## ✨ Core Features

Kryfto is a comprehensive framework for automated data extraction, web crawling, and browser session execution.

- **🤖 AI Agent Ready**: Ships with a built-in [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server exposing **42+ tools**. Instantly give Claude, Cursor, or Codex the ability to search, browse, extract, fact-check, run continuous research agents, and benchmark search quality on the live web.
- **🕵️‍♂️ Advanced Stealth & Anti-Bot Engine**: Unified anti-bot layer with **12 rotated modern User-Agents** (Chrome 130–133, Edge 131/133), per-browser `Sec-Ch-Ua` client hints, `Sec-Fetch-*` headers, Chromium-only `Accept` strings, engine-appropriate `Referer` headers, per-engine request spacing delays, canvas fingerprint randomization, WebGL vendor/renderer spoofing, `navigator.platform` matching, `hardwareConcurrency` randomization, WebRTC IP leak prevention, and an RFC 6265-compliant in-memory cookie jar with 30min TTL. **New in v3.5.1:** Consistent cross-signal fingerprints (UA matched to platform, screen, WebGL, fonts, and audio), 20-point browser evasion suite, humanized browser interactions (Bezier curve mouse movements with micro-overshoots, realistic typing with typos, smooth scrolling), per-domain browser session pool with 30min TTL, and browser-based CAPTCHA solving for Cloudflare Turnstile, reCAPTCHA v2, hCaptcha, and Datadome — all without external paid APIs. reCAPTCHA image grids are classified locally via CLIP vision (`clip-vit-large-patch14`), and audio challenges are transcribed locally via Whisper, both using `@xenova/transformers`.
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

- **Engines**: `duckduckgo`, `bing`, `yahoo`, `brave`, `google` _(all engines work without external API keys — Google CAPTCHAs are solved locally via CLIP vision and Whisper audio)_.

---

## 💡 Why Kryfto? (Cost Savings & Benefits)

Most modern AI and web-scraping architectures rely on expensive third-party APIs (like Firecrawl, Apify, or Browserless). Kryfto replaces these dependencies by giving you **complete ownership of your scraping infrastructure**.

### 💸 The Scraping Cost Comparison (100k Requests)

| Platform                     | Cost per 100,000 Pages | Concurrency Limits            | Wait-for-Selectors |
| ---------------------------- | ---------------------- | ----------------------------- | ------------------ |
| **Firecrawl.dev**            | ~$100.00 / mo          | 50-100 Concurrent             | Paid Extra         |
| **Browserless.io**           | ~$200.00 / mo          | Route-dependent               | Paid Extra         |
| **Apify (Web Scraper)**      | ~$50.00+ / mo          | Memory restricted             | Standard           |
| **Kryfto (Self-Hosted VPS)** | **$5.00 / mo Flat**    | **Scales With Hardware** | **Included Free**  |

- 💰 **Zero Per-Request Costs:** As the table shows, stop paying per-API-call limits. By self-hosting Kryfto on a $5/month DigitalOcean droplet or Railway instance, you can run browser extractions at scale for a flat infrastructure fee. Concurrency is bounded by your hardware and `WORKER_GLOBAL_CONCURRENCY` setting (default: 2, increase based on available RAM).
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
| **User-Agent Rotation** | 12 Chromium-only UAs covering Chrome 130–133 and Edge 131/133 (Firefox/Safari UAs removed to avoid fingerprint mismatches) |
| **Client Hints (`Sec-Ch-Ua`)** | Correct per-browser hints for Chrome/Edge |
| **Sec-Fetch Headers** | Full `Sec-Fetch-Dest/Mode/Site/User` set for all Chromium-based UAs |
| **Accept Headers** | Chromium-standard Accept strings for all UAs |
| **Referer** | Engine homepage injected automatically (e.g., `https://www.google.com/` for Google queries) |
| **Request Spacing** | Per-engine delays: Google 1500–3000ms, Bing/Yahoo 400–800ms, DDG 200–500ms, Brave 300–600ms |
| **Cookie Jar** | RFC 6265-compliant in-memory `Set-Cookie` persistence with Domain/Path/Secure/HttpOnly matching and 30min TTL |
| **Platform Hints** | Derived from UA: Windows/macOS/Linux |
| **Canvas Fingerprint** | Subtle pixel noise injected into `toDataURL`/`toBlob` to defeat canvas fingerprinting |
| **Fingerprint Consistency** | UA, platform, screen resolution, WebGL vendor/renderer, fonts, and audio are cross-matched per profile |
| **20-Point Browser Evasion** | webdriver, plugins, mimeTypes, platform, languages, deviceMemory, connection/Battery APIs, screen props, chrome runtime, permissions, canvas noise, WebGL, AudioContext, WebRTC leak prevention, iframe patches, CDP filtering, headless patches, timing noise, hasFocus, font defense |
| **WebGL Spoofing** | Reports "Intel Inc." / "Intel Iris OpenGL Engine" instead of headless renderer |
| **Hardware Concurrency** | Randomized from realistic values (4, 6, 8, 10, 12, 16) |
| **navigator.webdriver** | Patched to `false` in Playwright browser contexts |
| **Humanized Interactions** | Bezier curve mouse movements, realistic typing with typos + backspace, smooth chunked scrolling |
| **Browser Session Pool** | Per-domain context reuse with 30min TTL — avoids repeated challenges on subsequent requests |
| **CAPTCHA Solver** | Browser-based solving for Turnstile, reCAPTCHA v2, hCaptcha, Datadome (no external API keys) |
| **CLIP Vision Classifier** | Local CLIP (`clip-vit-large-patch14`) via `@xenova/transformers` for reCAPTCHA/hCaptcha image grid challenges |
| **Audio Transcription** | Local Whisper via `@xenova/transformers` for reCAPTCHA/hCaptcha audio challenges (fallback) |
| **Google Consent Cookie** | SOCS cookie injection to bypass EU consent interstitials |

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

See [CHANGELOG.md](CHANGELOG.md) for the full version history.
