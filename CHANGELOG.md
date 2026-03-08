# Changelog

All notable changes to Kryfto are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [3.8.0] — Admin Dashboard & Per-Role Rate Limits (Latest)

_Admin dashboard · Token management UI · Per-role rate limiting · Token expiration · Project management · Audit log viewer_

### Added
- **Admin Dashboard** (`apps/dashboard`): Full React + Vite + Tailwind SPA for managing the Kryfto runtime. Dark-themed UI with sidebar navigation served as a separate nginx container on port 3001.
  - **Overview** page with aggregate stats (jobs, tokens, artifacts, crawls)
  - **Token Management**: Create, revoke, rotate tokens with role assignment and expiration dates. Copy-to-clipboard for new tokens.
  - **Project Management**: List and create projects
  - **Jobs Browser**: Paginated job list with state filtering and cancel actions
  - **Crawls Browser**: Paginated crawl list with progress statistics
  - **Audit Logs**: Paginated, filterable audit log viewer
  - **Rate Limits**: Per-role RPM editor with save functionality
  - **API Playground**: Interactive API testing console with method selector, JSON body editor, 18 presets covering all endpoints, response viewer with status/timing, copy-as-cURL, and request history with replay
  - **API Examples**: 6 detailed expandable examples (Search, Jobs, Crawl, Extract, Tokens, Rate Limits) with request/response samples, cURL commands, and contextual notes
- **Per-Role Rate Limiting**: Rate limits are now differentiated by role — admin (500 RPM), developer (120 RPM), readonly (60 RPM). Stored in `rate_limit_config` database table, configurable via API.
- **Token Expiration**: Tokens can now have an `expiresAt` timestamp. Expired tokens are rejected at authentication time.
- **New Admin API Endpoints**: `GET/DELETE/PATCH /v1/admin/tokens/:tokenId`, `POST /v1/admin/tokens/:tokenId/rotate`, `GET/POST /v1/admin/projects`, `GET /v1/admin/audit-logs`, `GET/PUT /v1/admin/rate-limits`, `GET /v1/admin/stats`, `GET /v1/admin/jobs`, `GET /v1/admin/crawls`.
- **Database Migration** (`0002_token_expiry_and_rate_limits.sql`): Adds `expires_at` column to `api_tokens` and creates `rate_limit_config` table.
- **Dashboard Docker Container** (`docker/dashboard.Dockerfile`): Separate nginx container serving the dashboard SPA with API reverse proxy.

### Changed
- **Dashboard separated from API**: Dashboard runs as its own container (nginx on port 3001) instead of being embedded in the API server, avoiding route conflicts.
- **Docker Compose**: Added `dashboard` service on port 3001 (configurable via `KRYFTO_DASHBOARD_PORT`).

## [3.7.0] — Resilient Search & Shared Antibot

_Dotenv auto-loading · API availability fast-path · Google browser search in API · Antibot modules in shared · CAPTCHA solver for API · Docker Playwright support_

### Added
- **Dotenv Auto-Loading** (`mcp-server`): Automatically walks up directories from `import.meta.url` to find `.env` at repo root. No more empty tokens when running from package subdirectories.
- **API Availability Probing** (`mcp-server/search.ts`): Cached health check (60s TTL, 2s timeout) with `KRYFTO_SEARCH_MODE` env var (`auto`/`api`/`direct`). On ECONNREFUSED, immediately skips remaining engines and falls back to direct HTTP search.
- **Browser-Based Google Search in API** (`apps/api/src/google-browser.ts`): Full 20-point antibot system for Google search — stealth browser launch, fingerprint generation, humanized typing/clicking, consent cookie, and CAPTCHA solver. Used by n8n and other API consumers.
- **Google CAPTCHA Solver in API**: `solveGoogleSorryPage()` wired into API server's Google search route. 3-layer solver (checkbox → audio/Whisper → CLIP vision) handles Docker IP rate-limits.
- **Antibot Modules in Shared Package**: `browser-stealth.ts`, `fingerprint.ts`, `humanize.ts`, and `recaptcha-vision.ts` moved from worker/mcp-server to `@kryfto/shared` for reuse across all packages.
- **Docker Playwright Support**: `api.Dockerfile` now installs Playwright Chromium with `npx playwright install --with-deps chromium`.

### Changed
- **MCP Search Network Error Handling**: `helpers.ts` skips retries on `ECONNREFUSED`/`ECONNRESET`/`ENOTFOUND` — no point retrying when the API server is down.
- **API Google Search Fallback Chain**: Google CSE API → Playwright browser (full antibot + CAPTCHA) → plain HTML parser. Graceful shutdown closes browser on SIGINT/SIGTERM.
- **Shared Package**: Added `playwright` as optional peer dependency and `@xenova/transformers` as dependency for CAPTCHA solving modules.

### Fixed
- **MCP Server Auth Failure**: `.env` file at repo root was not being loaded when MCP server ran from `packages/mcp-server/` — all API-based engines returned 401 AUTH_UNAUTHORIZED.
- **`window` Reference in Shared**: `humanize.ts` `scrollSmoothly()` used `window.scrollBy` which doesn't exist in Node — replaced with `globalThis` cast for DOM compatibility inside `page.evaluate()`.

## [3.6.0] — CLIP Vision CAPTCHA Solving & Release Infrastructure

_CLIP-large image classification · hCaptcha game detection · Coverage reporting · GitHub releases · NPM publish pipeline · README audit_

### Added
- **CLIP Vision CAPTCHA Solver**: `clip-vit-large-patch14` (~900MB) for reCAPTCHA/hCaptcha image grid challenges. Zero-shot classification with label synonyms, multi-language translation (DE/FR), 19 negative labels, adaptive threshold (>0.20), up to 8 solving rounds.
- **hCaptcha Game Type Detection**: `detectHcaptchaGameType()` identifies unsolvable canvas games (penguin road, dice, jigsaw, etc.) and skips them, refreshing for solvable image grids instead.
- **Google /sorry Page Solver** (`recaptcha-vision.ts`): 3-layer solver for Google rate-limit pages — checkbox click, audio (Whisper), then CLIP vision. No external APIs.
- **Test Coverage Reporting**: `@vitest/coverage-v8` integrated; `pnpm test:coverage` reports per-file coverage for mcp-server and shared packages. CI now runs coverage by default.
- **GitHub Issue Templates**: Bug report and feature request templates in `.github/ISSUE_TEMPLATE/`.
- **CI Badges**: CI status, license, Node.js version, and MCP tool count badges in README.

### Changed
- **Changesets `access: public`**: NPM packages now publish as public scoped packages via `changesets/action`.
- **UA Pool**: Firefox/Safari UAs removed — 12 Chromium-only UAs (Chrome 130–133, Edge 131/133) to prevent fingerprint mismatches.
- **MCP Server tsconfig**: Added `"lib": ["DOM"]` for Playwright `page.evaluate()` DOM references in `recaptcha-vision.ts`.
- **README Audit**: Updated stealth descriptions, UA counts, Google CAPTCHA notes, added fingerprint consistency and 20-point evasion documentation.
- **CONTRIBUTING.md**: Enhanced with project structure, code standards, and detailed PR checklist.
- **4x4 Dynamic Grid Re-check**: reCAPTCHA solver re-classifies refreshed tiles after initial clicks on dynamic grids.
- **Audio Fallback**: Automatically switches to audio challenge after 2 blank CLIP classification rounds.

### Fixed
- **`turndown.remove()` SVG type**: FilterFunction cast for SVG tag removal when DOM lib is included.
- **hCaptcha auto-submit**: Checks solved state after drag before clicking submit button.

## [3.5.1] — Anti-Bot Engine & Browser-Based CAPTCHA Solving

_Humanized interactions · Browser session pool · Local CAPTCHA solving · Cloudflare/Datadome bypass · Google search hardening_

### Added
- **Humanized Browser Interactions** (`apps/worker/src/humanize.ts`): Bezier curve mouse movements with random jitter, realistic typing with per-character delays and occasional typos + backspace, smooth chunked scrolling with reading pauses. Replaces robotic `page.click()`/`page.fill()`/`scrollBy` calls.
- **Browser Session Pool** (`apps/worker/src/browser-pool.ts`): Per-domain persistent browser context reuse to avoid repeated Cloudflare challenges on subsequent requests. 30-minute idle TTL, max 10 entries, automatic eviction.
- **Browser-Based CAPTCHA Solver** (`apps/worker/src/captcha-solver.ts`): Detects and solves Cloudflare Turnstile, reCAPTCHA v2, hCaptcha, Cloudflare JS/managed challenges, and Datadome press-and-hold + slider — all without external paid APIs.
- **Local Whisper Transcription**: reCAPTCHA/hCaptcha audio challenge pipeline downloads MP3, transcribes locally via `@xenova/transformers` (ONNX Whisper model), and types the answer. No 2Captcha/CapSolver API keys required.
- **Datadome Solver**: Press-and-hold with eased deceleration + slider drag solving for Datadome-protected pages.
- **Challenge Detection in HTTP Search**: `isChallengePage()` detects Cloudflare/Datadome/reCAPTCHA/hCaptcha markers in small response pages and triggers engine fallback.
- **Google Consent Cookie**: `getGoogleConsentCookieHeader()` injects SOCS consent cookie to bypass EU interstitial pages.
- **E2E CAPTCHA Test Suite** (`apps/worker/src/test-captcha.ts`): Tests against real CAPTCHA demo pages (Turnstile, reCAPTCHA v2, hCaptcha, nowsecure.nl, intoli fingerprint).
- **`@xenova/transformers` dependency**: Added to worker for local speech-to-text transcription.

### Changed
- **Google request delays increased**: 800–1500ms → 1500–3000ms to reduce blocking.
- **Worker `runBrowserStep()`**: Click, type, scroll, and paginate now use humanized versions when `KRYFTO_HUMANIZE=true` (default).
- **Worker `runBrowser()`**: Uses browser pool for session reuse when `KRYFTO_BROWSER_POOL=true` (default). Adds automatic challenge detection after navigation steps.
- **MCP search `directSearchEngine()`**: Now calls `engineDelay()` before requests and adds Cookie header for Google.

### Fixed
- **hCaptcha misdetection**: Detection now checks iframe URLs (not just page HTML) and prioritizes hCaptcha before reCAPTCHA to prevent misidentification on hCaptcha pages that include Google scripts.

## [3.5.0] — Zero Any, Full Type Safety

_Complete type safety · Input sanitization · Expanded test coverage · Stealth hardening · Health check tool_

### Changed
- **Zero `any` across entire codebase:** Eliminated every `as any` cast, `: any` annotation, and `z.any()` schema across all 6 packages (mcp-server, sdk-ts, cli, shared, worker, api). Replaced with proper typed interfaces (`JobResponse`, `ArtifactItem`, `CookieInput`), `z.record(z.unknown())`, and `Record<string, unknown>`.
- **SDK typed return values:** `getJob`, `waitForJob`, `cancelJob` now return `Promise<JobResponse>`; `listArtifacts` returns `Promise<{ items: ArtifactItem[] }>`; `getCrawl` returns `Promise<Record<string, unknown>>`.
- **Worker cookie type safety:** New `toPlaywrightCookies()` helper bridges Zod `CookieInput` → Playwright cookie types under `exactOptionalPropertyTypes`.
- **`z.any()` → `z.record(z.unknown())`:** Browse steps, crawl rules, and extract schema Zod validators no longer use `any`.

### Added
- **Search query input sanitization:** `buildSearchQuery` now strips injected search operators (`site:`, `filetype:`, `intitle:`, `intext:`, `cache:`, `related:`), double quotes, and newlines from `site`, `inurl`, and `exclude` parameters.
- **`kryfto_status` health check tool:** Reports API connectivity with descriptive error messages, circuit breaker states, cache size, engine error metrics, and SLO summary.
- **Canvas fingerprint randomization:** `toDataURL` and `toBlob` inject subtle pixel noise to defeat canvas fingerprinting.
- **WebGL vendor/renderer spoofing:** Reports "Intel Inc." / "Intel Iris OpenGL Engine" instead of revealing headless Chrome.
- **`navigator.hardwareConcurrency` randomization:** Picks from realistic values (4, 6, 8, 10, 12, 16).
- **`navigator.platform` matching:** Derived from User-Agent string to prevent Windows UA + macOS platform detection.
- **New tests:** `sanitization.test.ts` (10 tests), `github.test.ts` (4 tests), `router.test.ts` (5 tests), plus 5 additional `buildSearchQuery` tests. Total: 212 tests (up from 188).
- **Graceful shutdown:** Worker drains in-flight jobs, closes browser instances, BullMQ workers, Redis, and Postgres connections with a 30-second timeout.

### Fixed
- **Stealth `Sec-Fetch-Site` header:** Changed from `"same-origin"` to `"none"` for initial navigation requests (matching real browser behavior).
- **Stealth `navigator.plugins`:** Removed deprecated Native Client plugin; now only includes Chrome PDF Plugin and Chrome PDF Viewer.
- **Stealth `navigator.languages`:** Derived from context locale instead of hardcoded `["en-US", "en"]`.
- **Cookie jar RFC 6265 compliance:** Respects `Domain`, `Path`, `Secure`, `HttpOnly`, `Max-Age`, and `Expires` attributes with proper domain/path matching.

## [3.4.0] — Universal Search Engine

_Multi-Engine Parallel Search · Dynamic Scoring · Domain-Agnostic Ranking · Result Diversity · Unconditional Fallback_

- **All 5 Engines Queried Simultaneously:** Removed early-exit that stopped after the first successful engine — DuckDuckGo, Brave, Bing, Yahoo, and Google are now ALL queried for every search, producing broader and more diverse results.
- **Domain-Agnostic Scoring Engine:** Eliminated all hardcoded technology-to-domain maps. Scoring is now purely algorithmic — `domainQueryRelevance()` extracts query terms and dynamically matches them against any domain name. Works for tech, medical, legal, academic, news, cooking, finance, or any other topic.
- **Short Tech Name Support:** Go, R, C, C++, PHP, Lua, Zig, Nim, D, V matched via word-boundary regex against known domain maps.
- **URL Structure Analysis:** `urlOfficialScore()` analyzes URL patterns (subdomains like `docs.*`/`developer.*`, doc paths, .gov TLDs, ReadTheDocs/GitBook, login/pricing page penalties) for universal quality scoring.
- **Result Diversity:** `diversityPenalty()` prevents any single domain from dominating — 3rd result from the same domain gets -20, 4th -40, 5th+ -60.
- **8 Intent Types:** Expanded intent detection from 4 to 8: `api_docs`, `legal`, `release_notes`, `faq`, `troubleshooting`, `documentation`, `news`, `general`.
- **Noise Penalty System:** YouTube, Reddit, Stack Overflow, Medium, W3Schools, etc. penalized -60 to -100 for documentation/legal/API queries; no penalty for troubleshooting where they're actually useful.
- **Strict Mode Auto-Detection:** Compliance, medical, finance, and legal queries auto-enable `officialOnly=true` with 2x noise penalty multiplier.
- **Unconditional Curated Fallback:** When all engines + direct HTTP fail, returns 8 universal search-page links (DuckDuckGo, Wikipedia, GitHub, Google Scholar, Stack Overflow, Reddit, MDN, Archive.org) for EVERY query. Zero keyword gating.
- **46 Scoring Tests:** Comprehensive test coverage for `domainQueryRelevance`, `urlOfficialScore`, `noisePenalty`, `diversityPenalty`, and all 8 intent types.

## [3.3.0] — Engine Connectivity & Reliability

_Direct HTTP Search · Fast Circuit Breaker · Degraded-Mode Fallback · Per-Engine Observability_

- **Direct HTTP Search Fallback:** When the REST API backend is unreachable, `federatedSearch` now bypasses the API and directly fetches+parses search results from DuckDuckGo, Brave, Bing, and Google using the shared search parsers and stealth headers.
- **Fast Circuit Breaker Recovery:** Reset timeout reduced from 60s to 15s. Single success closes the circuit. `forceCircuitRecoveryIfAllDown()` resets all circuits when every engine is locked out.
- **Provider Redundancy:** Three-tier fallback chain: API-based search → Direct HTTP search → Curated official-domain results. Search never returns empty.
- **Degraded-Mode Curated Fallback:** When all live search is unavailable, returns curated canonical docs for 15 major frameworks (React, Next.js, TypeScript, Node.js, Python, Rust, OpenAI, GitHub, Docker, Kubernetes, PostgreSQL, Redis, Vue, Angular, Svelte).
- **officialOnly Hardening:** `isStrictOfficialSource()` enforced across all three fallback tiers, not just the API path.
- **Per-Engine Error Classification:** Every engine failure is classified as `dns`, `tls`, `timeout`, `http_4xx`, `http_5xx`, `network`, `parse`, `empty`, or `unknown` via `classifyEngineError()`. Accessible via `getEngineErrorMetrics()`.
- **SLO Guards:** `search_success_rate < 99%` tracked in eval thresholds; CI blocks deploys on regression.

## [3.2.0] — The Moat: Competitive Intelligence Engine

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

## [3.1.0] — Deep Research & Stealth Proxies

_Async Research · Zero-Trace Mode · Geolocation · Dynamic Plugins_

- **Async Deep Research API:** Non-blocking tools (`research_job_start`, `research_job_status`, `research_job_cancel`) for massive iterative research pipelines.
- **Zero-Trace Preflighting:** `privacy_mode: "zero_trace"` bypasses BullMQ and Postgres for artifact-free in-memory extraction.
- **Granular Controls:** `freshness_mode` cache evictions + `proxy_profile`/`location`/`country`/`rotation_strategy` parameters.
- **Dynamic Plugin Tooling:** Auto-mounts saved extraction templates from `/v1/recipes` as native LLM tools.

## [3.0.1] — Search & Reliability Hardening

_Google anti-bot bypass · Semantic version sorting · Bugfixes_

- **Google Crawler Bypass:** `gbv=1` and Chrome User-Agent spoofing to evade Google's JS challenge.
- **Semantic Recency Ranking:** Robust `-X-Y-Z` version parsing — minor version docs (e.g. `15.5`) outrank major releases.
- **Internal Error Fix:** Resolved 500 `INTERNAL_ERROR` Postgres crash in `read_url`.

## [3.0.0] — Advanced Intelligence Engine

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

## [2.0.0] — MCP Server V2 Rewrite

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

## [1.0.0] — Initial Release

_7 MCP tools · Core infrastructure_

- `browse`, `crawl`, `extract`, `search` tools
- `get_job`, `list_artifacts`, `fetch_artifact`
- Stealth mode with User-Agent rotation
- Docker Compose infrastructure (API, Worker, Postgres, Redis, MinIO)
