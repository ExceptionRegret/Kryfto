# MCP Integration

The MCP server lives at `packages/mcp-server` and bridges MCP tool calls to Kryfto's REST API and built-in intelligence engine. **39+ tools** are available across 8 categories, including dynamic recipe plugins.

## Environment Variables

| Variable                         | Description                                 | Default                   |
| -------------------------------- | ------------------------------------------- | ------------------------- |
| `API_BASE_URL`                   | Kryfto API endpoint                         | `http://localhost:8080`   |
| `API_TOKEN` / `KRYFTO_API_TOKEN` | Authentication token                        | —                         |
| `KRYFTO_SEARCH_TOKEN`            | Scoped token for search tool                | Falls back to `API_TOKEN` |
| `KRYFTO_BROWSE_TOKEN`            | Scoped token for browse tool                | Falls back to `API_TOKEN` |
| `KRYFTO_CRAWL_TOKEN`             | Scoped token for crawl tool                 | Falls back to `API_TOKEN` |
| `KRYFTO_EXTRACT_TOKEN`           | Scoped token for extract tool               | Falls back to `API_TOKEN` |
| `GITHUB_TOKEN`                   | GitHub API token (for releases/diff/issues) | Optional                  |
| `KRYFTO_DOMAIN_BLOCKLIST`        | Comma-separated blocked domains             | —                         |
| `KRYFTO_DOMAIN_ALLOWLIST`        | Comma-separated allowed domains             | —                         |

## Tools (39+ total)

### 🔍 Search & Read (5 tools)

| Tool             | Description                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `search`         | Multi-engine search with auto-fallback, domain boosting, recency sort. Supports multimodal (news, images, finance), geolocation, proxy rotation, and privacy modes |
| `read_url`       | URL → clean Markdown with publish-date extraction, section detection. Configurable caching (`freshness_mode`) and zero-trace privacy modes                         |
| `read_urls`      | Batch read up to 10 URLs concurrently with partial-result recovery                                                                                                 |
| `detect_changes` | Compare current page against cached snapshot, returns added/removed content                                                                                        |
| `cite`           | Citation mode — find official sources for claims with confidence scores                                                                                            |

### 🧠 Intelligence (7 tools)

| Tool                     | Description                                                                 |
| ------------------------ | --------------------------------------------------------------------------- |
| `answer_with_evidence`   | Search + read + extract evidence spans per claim with trust scores          |
| `conflict_detector`      | Detect contradictions across multiple sources, rank by trustworthiness      |
| `confidence_calibration` | Calibrated per-claim confidence based on source count, recency, trust       |
| `upgrade_impact`         | Framework migration risk analysis (low/medium/high)                         |
| `dev_intel`              | Developer intelligence — auto-search + read for framework updates           |
| `query_planner`          | Preview search/read/extract plan with deterministic cost estimates          |
| `research`               | Unified search→read→extract pipeline in one call with clean markdown output |
| `research_job_start`     | Start an asynchronous research job for deep, multi-stage data gathering     |
| `research_job_status`    | Check status, stream logs, and retrieve results of an async research job    |
| `research_job_cancel`    | Cancel a running async research job                                         |

### 🔒 Trust & Memory (4 tools)

| Tool                 | Description                                                     |
| -------------------- | --------------------------------------------------------------- |
| `source_trust`       | Get trust scores for domains (github=0.9, arxiv=0.95, .gov=0.9) |
| `set_source_trust`   | Override trust score for a domain (persists for session)        |
| `set_memory_profile` | Per-project preferences: sources, stack, output format          |
| `get_memory_profile` | Read back project preferences                                   |

### 📡 Monitoring (5 tools)

| Tool            | Description                                                            |
| --------------- | ---------------------------------------------------------------------- |
| `add_monitor`   | Register URL to watch for changes                                      |
| `list_monitors` | List all registered monitors                                           |
| `watch_and_act` | Monitor URL + optional webhook (auto-fires POST on changes)            |
| `check_watch`   | Check a watched URL now, fires webhook if changed                      |
| `semantic_diff` | Context-filtered meaningful diff ("what changed that matters for me?") |

### 📊 Observability (5 tools)

| Tool                 | Description                                                                     |
| -------------------- | ------------------------------------------------------------------------------- |
| `slo_dashboard`      | Per-tool success rate, p50/p95/p99 latency, cache hit rate, freshness           |
| `replay_request`     | Retrieve exact input/output of previous request by requestId                    |
| `list_replays`       | Browse recent replayable request history                                        |
| `evaluation_harness` | Internal benchmark suite (5 tests: search, cache, normalization, errors, trust) |
| `run_eval_suite`     | 10 real-world query benchmark (precision%, latency, official source hits)       |
| `truth_maintenance`  | Re-check cached facts, expire stale entries, report near-expiry                 |

### 🐙 GitHub (3 tools)

| Tool              | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `github_releases` | Fetch releases with tags, dates, and changelogs. Cached 30min |
| `github_diff`     | Compare two Git tags — commits, files, additions/deletions    |
| `github_issues`   | Fetch issues and PRs with label filtering                     |

### 🌐 Browser & Crawl (3 tools)

| Tool       | Description                                                                         |
| ---------- | ----------------------------------------------------------------------------------- |
| `browse`   | Raw headless browser job (for clean text use `read_url`)                            |
| `crawl`    | Spider from seed URL with followNav, skipPatterns, maxPages                         |
| `extract`  | CSS selectors, JSON schema, or plugin extraction                                    |
| `recipe_*` | **Dynamic:** Automatically loaded from your Kryfto Recipes registry (`/v1/recipes`) |

### 📦 Job Management (3 tools)

| Tool             | Description                          |
| ---------------- | ------------------------------------ |
| `get_job`        | Get job status                       |
| `list_artifacts` | List artifacts for a job             |
| `fetch_artifact` | Download raw artifact bytes (base64) |

Search engines supported: `duckduckgo`, `bing`, `yahoo`, `google`, `brave`

## Build and Run

```bash
pnpm --filter @kryfto/mcp-server build
API_BASE_URL=http://localhost:8080 API_TOKEN=<token> node packages/mcp-server/dist/index.js
```

## Local IDE Configuration

If you are using Kryfto as a headless browser engine for your own projects, you **must use the absolute path** to your Kryfto installation so your IDE can find the server regardless of which project directory you're currently in.

### Claude Code / Cursor (JSON)

Place this in your `claude_desktop_config.json` or Cursor MCP settings:

```json
{
  "mcpServers": {
    "kryfto": {
      "command": "node",
      "args": ["/absolute/path/to/kryfto/packages/mcp-server/dist/index.js"],
      "env": {
        "API_BASE_URL": "http://localhost:8080",
        "API_TOKEN": "<your-token-here>"
      }
    }
  }
}
```

### OpenAI Codex (TOML)

Codex uses **TOML**, not JSON. Place this in `.codex/config.toml` inside your project folder, or in `~/.codex/config.toml` for global access:

```toml
[mcp_servers.kryfto]
command = "node"
args = ["/absolute/path/to/kryfto/packages/mcp-server/dist/index.js"]

[mcp_servers.kryfto.env]
API_BASE_URL = "http://localhost:8080"
API_TOKEN = "<your-token-here>"
```

## Remote VPS Config (SSH Tunneling)

If your Kryfto instance is hosted remotely on a VPS, your local AI IDE (Cursor, Claude Code) cannot use a physical file path. Because the MCP server uses `stdio` (standard input/output) for communication, the most secure way to connect is by tunneling the node command through SSH.

This securely pipes the remote `index.js` outputs directly into your local AI assistant's brain without exposing the MCP server to the public internet!

**⚠️ Critical Requirement (SSH Keys):** Since MCP servers run silently in the background of your IDE, they **cannot** accept password prompts. You _must_ configure passwordless SSH Key authentication between your local machine and your VPS just once. It will then work automatically for every project on your computer!

### macOS / Linux User Guide

Open your Terminal and run the following commands:

```bash
# 1. Generate the key (press Enter to accept default location)
ssh-keygen -t ed25519 -C "your_email@example.com"

# 2. Automatically copy it to your VPS securely
ssh-copy-id user@your-vps-ip

# 3. Test that it logs you in without asking for a password!
ssh user@your-vps-ip "echo 'Success'"
```

### Windows User Guide

Open **PowerShell** as Administrator and run the following commands:

```powershell
# 1. Generate the key (press Enter to accept default location)
ssh-keygen -t ed25519 -C "your_email@example.com"

# 2. Windows doesn't have ssh-copy-id, so run this simple PowerShell script to push the key:
$RemoteUser = "user@your-vps-ip"
$Key = Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub"
ssh $RemoteUser "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '$Key' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

# 3. Test that it logs you in without asking for a password!
ssh user@your-vps-ip "echo 'Success'"
```

---

Once `ssh user@your-vps-ip` allows you to instantly connect without a password prompt, add this to your AI's MCP config:

```json
{
  "mcpServers": {
    "kryfto-remote": {
      "command": "ssh",
      "args": [
        "user@your-vps-ip",
        "API_BASE_URL=http://localhost:8080",
        "API_TOKEN=<token>",
        "node",
        "/absolute/path/on/vps/to/kryfto/packages/mcp-server/dist/index.js"
      ]
    }
  }
}
```
