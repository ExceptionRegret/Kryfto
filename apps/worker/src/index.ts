import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { access, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { minimatch } from "minimatch";
import { trace } from "@opentelemetry/api";
import pino from "pino";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { Pool } from "pg";
import {
  ArtifactStorage,
  CrawlRequestSchema,
  JobCreateRequestSchema,
  assertSafeUrl,
  defaultArtifactConfigFromEnv,
  extractByJsonSchema,
  extractByPlugin,
  extractBySelectors,
  makeArtifactStorageKey,
  parseAllowHosts,
  sanitizeStepForLogs,
  sha256Hex,
  type CookieInput,
  type CrawlRequest,
  type JobCreateRequest,
  type Step,
} from "@kryfto/shared";
import { buildStepPlan } from "./step-runner.js";
import {
  applyStealthScripts,
  getStealthContextOptions,
  getStealthContextWithFingerprint,
  launchStealthBrowser,
  parseProxyUrls,
  pickRandom,
  type StealthOptions,
  type FingerprintProfile,
} from "./stealth.js";
import { humanClick, humanType, humanScroll, humanPaginateClick, idleFidget } from "./humanize.js";
import { BrowserPool } from "./browser-pool.js";
import { detectChallenge, handleChallenge, type ChallengeResult } from "./captcha-solver.js";

type JobState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

type JobRow = {
  id: string;
  project_id: string;
  state: JobState;
  request_json: JobCreateRequest;
  request_id: string;
};

const logger = pino({
  level: process.env.KRYFTO_LOG_LEVEL ?? "info",
  redact: ["*.token", "*.secret", "*.password", "*.apiKey"],
});
const tracer = trace.getTracer("collector-worker");

const REDIS_HOST = process.env.REDIS_HOST ?? "redis";
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);
const POSTGRES_HOST = process.env.POSTGRES_HOST ?? "postgres";
const POSTGRES_PORT = Number(process.env.POSTGRES_PORT ?? 5432);
const POSTGRES_DB = process.env.POSTGRES_DB ?? "collector";
const POSTGRES_USER = process.env.POSTGRES_USER ?? "collector";
const POSTGRES_PASSWORD =
  process.env.POSTGRES_PASSWORD ?? "collector_password_change_me";
const GLOBAL_CONCURRENCY = Number(process.env.WORKER_GLOBAL_CONCURRENCY ?? 2);
const PER_PROJECT_CONCURRENCY = Number(
  process.env.WORKER_PER_PROJECT_CONCURRENCY ?? 2
);
const PER_DOMAIN_CONCURRENCY = Number(
  process.env.WORKER_PER_DOMAIN_CONCURRENCY ?? 1
);
const blockPrivateRanges =
  String(process.env.KRYFTO_SSRF_BLOCK_PRIVATE_RANGES ?? "true") === "true";
const allowHosts = parseAllowHosts(process.env.KRYFTO_ALLOWED_HOSTS);
const STEALTH_ENABLED =
  String(process.env.KRYFTO_STEALTH_MODE ?? "true") === "true";
const ROTATE_UA =
  String(process.env.KRYFTO_ROTATE_USER_AGENT ?? "true") === "true";
const PROXY_URLS = parseProxyUrls(process.env.KRYFTO_PROXY_URLS);
const HUMANIZE_ENABLED =
  String(process.env.KRYFTO_HUMANIZE ?? "true") === "true";
const BROWSER_POOL_ENABLED =
  String(process.env.KRYFTO_BROWSER_POOL ?? "true") === "true";
const stealthOpts: StealthOptions = {
  stealthEnabled: STEALTH_ENABLED,
  rotateUserAgent: ROTATE_UA,
  proxyUrls: PROXY_URLS,
  headless: true,
};
const browserPool = BROWSER_POOL_ENABLED ? new BrowserPool() : null;

const storage = new ArtifactStorage(defaultArtifactConfigFromEnv());
const redis = new Redis(REDIS_PORT, REDIS_HOST, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
const pgPool = new Pool({
  host: POSTGRES_HOST,
  port: POSTGRES_PORT,
  database: POSTGRES_DB,
  user: POSTGRES_USER,
  password: POSTGRES_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  allowExitOnIdle: true,
});

const jobsQueue = new Queue("collector-jobs", {
  connection: { host: REDIS_HOST, port: REDIS_PORT },
});
const deadLetterQueue = new Queue("collector-dlq", {
  connection: { host: REDIS_HOST, port: REDIS_PORT },
});

class CancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CancelledError";
  }
}

function profileKey(): Buffer {
  return createHash("sha256")
    .update(
      process.env.KRYFTO_PROFILE_ENCRYPTION_KEY ??
      "collector-profile-key-change-me"
    )
    .digest();
}

function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const key = profileKey();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString(
    "base64"
  )}.${encrypted.toString("base64")} `;
}

function decryptJson<T>(encoded: string): T {
  const [ivB64, tagB64, dataB64] = encoded.split(".");
  if (!ivB64 || !tagB64 || !dataB64)
    throw new Error("Invalid encrypted payload");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    profileKey(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

async function logJob(
  jobId: string,
  projectId: string,
  level: string,
  message: string,
  meta?: Record<string, unknown>
): Promise<void> {
  await pgPool.query(
    `INSERT INTO job_logs(job_id, project_id, level, message, meta) VALUES($1, $2, $3, $4, $5:: jsonb)`,
    [jobId, projectId, level, message, JSON.stringify(meta ?? {})]
  );
}

async function writeAudit(
  projectId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  requestId: string,
  details?: Record<string, unknown>
): Promise<void> {
  await pgPool.query(
    `INSERT INTO audit_logs(project_id, actor_role, action, resource_type, resource_id, request_id, ip_address, details)
VALUES($1, 'admin', $2, $3, $4, $5, 'worker', $6:: jsonb)`,
    [
      projectId,
      action,
      resourceType,
      resourceId,
      requestId,
      JSON.stringify(details ?? {}),
    ]
  );
}

async function getJob(jobId: string): Promise<JobRow | null> {
  const result = await pgPool.query<JobRow>(
    `SELECT id, project_id, state, request_json, request_id FROM jobs WHERE id = $1`,
    [jobId]
  );
  return result.rows[0] ?? null;
}

async function jobCancelled(jobId: string): Promise<boolean> {
  const result = await pgPool.query<{
    cancel_requested: boolean;
    state: JobState;
  }>(`SELECT cancel_requested, state FROM jobs WHERE id = $1`, [jobId]);
  const row = result.rows[0];
  if (!row) return true;
  return row.cancel_requested || row.state === "cancelled";
}

async function setJobState(
  jobId: string,
  state: JobState,
  resultSummary?: unknown,
  errorMessage?: string
): Promise<void> {
  await pgPool.query(
    `UPDATE jobs SET state = $2, result_summary = COALESCE($3:: jsonb, result_summary), error_message = COALESCE($4, error_message), updated_at = NOW() WHERE id = $1`,
    [
      jobId,
      state,
      resultSummary ? JSON.stringify(resultSummary) : null,
      errorMessage ?? null,
    ]
  );
  await pgPool.query(`UPDATE crawl_nodes SET status = $2 WHERE job_id = $1`, [
    jobId,
    state,
  ]);
}

async function incrementAttempts(jobId: string): Promise<void> {
  await pgPool.query(
    `UPDATE jobs SET attempts = attempts + 1, updated_at = NOW() WHERE id = $1`,
    [jobId]
  );
}

async function acquireSlot(
  key: string,
  max: number
): Promise<() => Promise<void>> {
  const redisKey = `collector: slot:${key} `;
  while (true) {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, 120);
    }
    if (count <= max) {
      return async () => {
        await redis.decr(redisKey);
      };
    }
    await redis.decr(redisKey);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function persistArtifact(
  jobId: string,
  projectId: string,
  type: string,
  fileName: string,
  bytes: Buffer,
  contentType: string
): Promise<string> {
  const sha = sha256Hex(bytes);
  const existing = await pgPool.query<{ sha256: string; storage_key: string }>(
    `SELECT sha256, storage_key FROM artifact_blobs WHERE sha256 = $1`,
    [sha]
  );

  let storageKey = existing.rows[0]?.storage_key;
  if (!storageKey) {
    storageKey = makeArtifactStorageKey(projectId, sha, contentType);
    await storage.putBuffer(storageKey, bytes, contentType);
    await pgPool.query(
      `INSERT INTO artifact_blobs(sha256, storage_key, content_type, byte_size)
VALUES($1, $2, $3, $4) ON CONFLICT(sha256) DO NOTHING`,
      [sha, storageKey, contentType, bytes.byteLength]
    );
  }

  const inserted = await pgPool.query<{ id: string }>(
    `INSERT INTO artifacts(job_id, project_id, type, file_name, blob_sha256, byte_size)
VALUES($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [jobId, projectId, type, fileName, sha, bytes.byteLength]
  );
  return inserted.rows[0]?.id ?? "";
}

async function loadProfileCookies(
  projectId: string,
  name: string
): Promise<CookieInput[] | null> {
  const result = await pgPool.query<{ encrypted_cookies: string }>(
    `SELECT encrypted_cookies FROM browser_profiles WHERE project_id = $1 AND name = $2 ORDER BY updated_at DESC LIMIT 1`,
    [projectId, name]
  );
  const record = result.rows[0];
  if (!record) return null;
  try {
    return decryptJson<CookieInput[]>(record.encrypted_cookies);
  } catch {
    return null;
  }
}

async function saveProfileCookies(
  projectId: string,
  name: string,
  cookies: unknown
): Promise<void> {
  await pgPool.query(
    `INSERT INTO browser_profiles(project_id, name, encrypted_cookies) VALUES($1, $2, $3)`,
    [projectId, name, encryptJson(cookies)]
  );
}

async function robotsAllowed(url: URL): Promise<boolean> {
  try {
    const robotsUrl = new URL("/robots.txt", url.origin);
    const response = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return true;
    const text = await response.text();
    const lines = text.split(/\r?\n/u);
    let inWildcard = false;
    const disallow: string[] = [];
    for (const lineRaw of lines) {
      const line = lineRaw.trim();
      if (!line || line.startsWith("#")) continue;
      const [rawKey, ...rest] = line.split(":");
      if (!rawKey) continue;
      const key = rawKey.toLowerCase().trim();
      const value = rest.join(":").trim();
      if (key === "user-agent") {
        inWildcard = value === "*";
      } else if (inWildcard && key === "disallow" && value) {
        disallow.push(value);
      }
    }
    return !disallow.some((rule) => url.pathname.startsWith(rule));
  } catch {
    return true;
  }
}

function isHeavyJs(html: string): boolean {
  const scripts = (html.match(/<script/giu) ?? []).length;
  return (
    scripts > 20 ||
    html.includes("__NEXT_DATA__") ||
    html.includes("window.__NUXT__")
  );
}

/** Strip `undefined` values so Playwright's exactOptionalPropertyTypes are satisfied */
function toPlaywrightCookies(cookies: CookieInput[]): Array<{ name: string; value: string; domain?: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: "Strict" | "Lax" | "None" }> {
  return cookies.map((c) => {
    const out: { name: string; value: string; domain?: string; path?: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: "Strict" | "Lax" | "None" } = { name: c.name, value: c.value };
    if (c.domain !== undefined) out.domain = c.domain;
    if (c.path !== undefined) out.path = c.path;
    if (c.expires !== undefined) out.expires = c.expires;
    if (c.httpOnly !== undefined) out.httpOnly = c.httpOnly;
    if (c.secure !== undefined) out.secure = c.secure;
    if (c.sameSite !== undefined) out.sameSite = c.sameSite;
    return out;
  });
}

function engineToBrowser(engine: JobCreateRequest["options"]["browserEngine"]) {
  if (engine === "firefox") return firefox;
  if (engine === "webkit") return webkit;
  return chromium;
}

async function runBrowserStep(
  step: Step,
  page: Page,
  context: BrowserContext,
  defaultUrl: string,
  screenshots: Array<{ name: string; bytes: Buffer }>,
  extracted: { value: unknown },
  cookies: { value: unknown }
): Promise<void> {
  switch (step.type) {
    case "goto":
      await page.goto(step.args.url ?? defaultUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      return;
    case "setHeaders":
      await page.setExtraHTTPHeaders(step.args.headers);
      return;
    case "setCookies":
      await context.addCookies(toPlaywrightCookies(step.args.cookies));
      return;
    case "exportCookies":
      cookies.value = await context.cookies();
      return;
    case "waitForSelector":
      await page.waitForSelector(step.args.selector, {
        timeout: step.args.timeoutMs ?? 30_000,
      });
      return;
    case "click":
      if (HUMANIZE_ENABLED) {
        await humanClick(page, step.args.selector);
      } else {
        await page.click(step.args.selector);
      }
      return;
    case "type":
      if (HUMANIZE_ENABLED) {
        await humanType(page, step.args.selector, step.args.text);
      } else {
        await page.fill(step.args.selector, step.args.text);
      }
      return;
    case "scroll": {
      if (HUMANIZE_ENABLED) {
        await humanScroll(page, step.args.direction, step.args.amount);
      } else {
        const delta =
          step.args.direction === "down" ? step.args.amount : -step.args.amount;
        await page.evaluate(
          (value) => window.scrollBy(0, value),
          delta
        );
      }
      return;
    }
    case "wait":
      await page.waitForTimeout(step.args.ms);
      return;
    case "waitForNetworkIdle":
      await page.waitForLoadState("networkidle", {
        timeout: step.args.timeoutMs ?? 30_000,
      });
      return;
    case "paginate": {
      const maxPages = step.args.maxPages ?? 10;
      for (let i = 0; i < maxPages; i += 1) {
        if (!(await page.isVisible(step.args.nextSelector))) break;
        if (HUMANIZE_ENABLED) {
          await humanPaginateClick(page, step.args.nextSelector);
        } else {
          await page.click(step.args.nextSelector);
        }
        await page.waitForLoadState("networkidle", { timeout: 30_000 });
        if (step.args.stopCondition) {
          const html = await page.content();
          if (html.includes(step.args.stopCondition)) break;
        }
      }
      return;
    }
    case "screenshot":
      screenshots.push({
        name: step.args.name,
        bytes: await page.screenshot({ fullPage: true, type: "png" }),
      });
      return;
    case "extract": {
      const html = await page.content();
      if (step.args.mode === "selectors")
        extracted.value = extractBySelectors(html, step.args.selectors ?? {});
      if (step.args.mode === "schema")
        extracted.value = extractByJsonSchema(html, step.args.jsonSchema ?? {});
      if (step.args.mode === "plugin")
        extracted.value = await extractByPlugin(step.args.plugin ?? "", {
          html,
          url: defaultUrl,
        });
      return;
    }
    default:
      return;
  }
}

async function runBrowser(
  jobId: string,
  projectId: string,
  request: JobCreateRequest
): Promise<{
  html: string;
  extracted: unknown;
  cookies: unknown;
  screenshots: Array<{ name: string; bytes: Buffer }>;
  consoleLogs: Array<{ type: string; text: string }>;
  networkErrors: Array<{ url: string; errorText: string }>;
  timings: Array<{ step: string; durationMs: number }>;
  harBytes: Buffer | null;
  challengeResult: ChallengeResult | undefined;
}> {
  const profileName = new URL(request.url).hostname;
  const harPath = path.join(os.tmpdir(), `${jobId}.har`);
  const browserType = engineToBrowser(request.options.browserEngine);
  const isHeadless =
    !request.options.interactiveLogin ||
    String(process.env.KRYFTO_UI_MODE ?? "false") !== "true";
  const currentStealthOpts: StealthOptions = {
    ...stealthOpts,
    headless: isHeadless,
  };

  let browser: Browser;
  let context: BrowserContext;
  let poolManaged = false;
  let fingerprint: FingerprintProfile | undefined;

  // Try browser pool first for session reuse
  if (browserPool && !request.options.interactiveLogin) {
    const poolResult = await browserPool.acquire(profileName, browserType, currentStealthOpts);
    browser = poolResult.browser;
    fingerprint = poolResult.fingerprint;
    if (poolResult.reused) {
      context = poolResult.context;
      poolManaged = true;
      logger.debug({ domain: profileName }, "Reusing pooled browser session");
    } else {
      context = await browser.newContext({
        recordHar: { path: harPath },
        ...poolResult.stealthCtxOpts,
      });
      poolManaged = true;
    }
  } else {
    browser = await launchStealthBrowser(browserType, currentStealthOpts);
    const { contextOpts, fingerprint: fp } = getStealthContextWithFingerprint(currentStealthOpts);
    fingerprint = fp;
    context = await browser.newContext({
      recordHar: { path: harPath },
      ...contextOpts,
    });
  }

  const previousCookies = await loadProfileCookies(projectId, profileName);
  if (previousCookies?.length) {
    await context.addCookies(toPlaywrightCookies(previousCookies));
  }

  const page = await context.newPage();
  if (currentStealthOpts.stealthEnabled) {
    await applyStealthScripts(page, fingerprint);
  }
  const consoleLogs: Array<{ type: string; text: string }> = [];
  const networkErrors: Array<{ url: string; errorText: string }> = [];
  const screenshots: Array<{ name: string; bytes: Buffer }> = [];
  const extracted = { value: null as unknown };
  const cookies = { value: null as unknown };
  const timings: Array<{ step: string; durationMs: number }> = [];
  let challengeResult: ChallengeResult | undefined;

  page.on("console", (msg) => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });
  page.on("requestfailed", (req) => {
    networkErrors.push({
      url: req.url(),
      errorText: req.failure()?.errorText ?? "request failed",
    });
  });

  const plan: Step[] = buildStepPlan(request.url, request.steps);

  for (const step of plan) {
    if (await jobCancelled(jobId)) throw new CancelledError("Job cancelled");
    await tracer.startActiveSpan(`worker.step.${step.type} `, async (span) => {
      try {
        await logJob(jobId, projectId, "info", `Running step: ${step.type} `, {
          step: sanitizeStepForLogs(step) as unknown as Record<string, unknown>,
        });
        const start = Date.now();
        await runBrowserStep(
          step,
          page,
          context,
          request.url,
          screenshots,
          extracted,
          cookies
        );
        timings.push({ step: step.type, durationMs: Date.now() - start });

        // After navigation steps, check for challenges
        if (step.type === "goto" || step.type === "waitForNetworkIdle") {
          // Small idle fidget while page loads (looks natural)
          if (HUMANIZE_ENABLED) {
            await idleFidget(page, Math.floor(300 + Math.random() * 500));
          }
          const challengeStart = Date.now();
          challengeResult = await handleChallenge(page);
          if (challengeResult.challenged) {
            timings.push({ step: "challenge_handling", durationMs: Date.now() - challengeStart });
            await logJob(jobId, projectId, challengeResult.solved ? "info" : "warn",
              `Challenge detected: ${challengeResult.challengeType}, solved: ${challengeResult.solved}, method: ${challengeResult.method}`,
              { challengeResult: challengeResult as unknown as Record<string, unknown> }
            );
            // Report challenge to pool for identity rotation tracking
            if (browserPool && poolManaged && !challengeResult.solved) {
              const rotated = await browserPool.reportChallenge(profileName);
              if (rotated) {
                logger.info({ domain: profileName }, "Identity rotated after repeated challenges");
              }
            }
          }
        }
      } finally {
        span.end();
      }
    });
  }

  const html = await page.content();

  // Save cookies for session reuse
  const contextCookies = await context.cookies();
  if (request.options.interactiveLogin) {
    await saveProfileCookies(projectId, profileName, contextCookies);
  }
  // Always save cookies when challenge was solved (for future session reuse)
  if (challengeResult?.solved && challengeResult.challenged) {
    await saveProfileCookies(projectId, profileName, contextCookies);
  }

  // Close page but keep context alive in pool
  await page.close();
  if (poolManaged && browserPool) {
    browserPool.release(profileName);
  } else {
    await context.close();
    await browser.close();
  }

  let harBytes: Buffer | null = null;
  try {
    await access(harPath);
    harBytes = await readFile(harPath);
    await rm(harPath, { force: true });
  } catch {
    harBytes = null;
  }

  return {
    html,
    extracted: extracted.value,
    cookies: cookies.value,
    screenshots,
    consoleLogs,
    networkErrors,
    timings,
    harBytes,
    challengeResult,
  };
}

async function runFetch(
  jobId: string,
  projectId: string,
  request: JobCreateRequest
): Promise<{ html: string; upgrade: boolean }> {
  const target = await assertSafeUrl(request.url, {
    blockPrivateRanges,
    allowHosts,
  });
  if (request.options.respectRobotsTxt) {
    const allowed = await robotsAllowed(target);
    if (!allowed) throw new Error("ROBOTS_TXT_DENIED");
  }

  const dispatcher = stealthOpts.proxyUrls.length > 0
    ? new ProxyAgent(pickRandom(stealthOpts.proxyUrls))
    : undefined;

  const response = await undiciFetch(target, {
    signal: AbortSignal.timeout(request.options.timeoutMs),
    redirect: "follow",
    ...(dispatcher ? { dispatcher } : {}),
  });
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  const isPdf = contentType.includes("application/pdf") || target.pathname.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    const buffer = Buffer.from(await response.arrayBuffer());
    try {
      // @ts-ignore
      const parsed = await pdfParse(buffer);
      const html = `<html><body><pre>${parsed.text}</pre></body></html>`;
      await logJob(jobId, projectId, "info", "PDF extraction completed", { status: response.status, pages: parsed.numpages });
      return { html, upgrade: false };
    } catch (err) {
      throw new Error(`PDF_PARSE_FAILED: ${err}`);
    }
  }

  const html = await response.text();
  const upgrade = isHeavyJs(html);
  await logJob(jobId, projectId, "info", "Fetch stage completed", {
    status: response.status,
    upgrade,
  });
  return { html, upgrade };
}

async function executeCollection(
  jobId: string,
  projectId: string
): Promise<void> {
  const row = await getJob(jobId);
  if (!row) throw new Error("JOB_NOT_FOUND");
  const request = JobCreateRequestSchema.parse(row.request_json);
  const target = await assertSafeUrl(request.url, {
    blockPrivateRanges,
    allowHosts,
  });
  const releaseProject = await acquireSlot(
    `project:${projectId} `,
    PER_PROJECT_CONCURRENCY
  );
  const releaseDomain = await acquireSlot(
    `domain:${target.hostname} `,
    PER_DOMAIN_CONCURRENCY
  );

  try {
    await incrementAttempts(jobId);
    await setJobState(jobId, "running");
    await logJob(jobId, projectId, "info", "Job started", { url: request.url });
    await writeAudit(
      projectId,
      "job.update.running",
      "job",
      jobId,
      row.request_id
    );

    if (await jobCancelled(jobId))
      throw new CancelledError("Job cancelled before processing");

    let html = "";
    let usedBrowser = false;
    let extracted: unknown = null;
    let exportedCookies: unknown = null;
    let screenshots: Array<{ name: string; bytes: Buffer }> = [];
    let consoleLogs: Array<{ type: string; text: string }> = [];
    let networkErrors: Array<{ url: string; errorText: string }> = [];
    let timings: Array<{ step: string; durationMs: number }> = [];
    let harBytes: Buffer | null = null;

    if (!request.options.requiresBrowser) {
      const fetched = await runFetch(jobId, projectId, request);
      html = fetched.html;
      usedBrowser =
        fetched.upgrade || Boolean(request.steps) || Boolean(request.extract);
    }

    if (request.options.requiresBrowser || usedBrowser || !html) {
      const browser = await runBrowser(jobId, projectId, request);
      html = browser.html;
      extracted = browser.extracted;
      exportedCookies = browser.cookies;
      screenshots = browser.screenshots;
      consoleLogs = browser.consoleLogs;
      networkErrors = browser.networkErrors;
      timings = browser.timings;
      harBytes = browser.harBytes;
      usedBrowser = true;
    }

    if (!extracted && request.extract) {
      if (request.extract.mode === "selectors")
        extracted = extractBySelectors(html, request.extract.selectors ?? {});
      if (request.extract.mode === "schema")
        extracted = extractByJsonSchema(html, request.extract.jsonSchema ?? {});
      if (request.extract.mode === "plugin")
        extracted = await extractByPlugin(request.extract.plugin ?? "", {
          html,
          url: request.url,
        });
    }

    const artifactIds: string[] = [];
    artifactIds.push(
      await persistArtifact(
        jobId,
        projectId,
        "final_html",
        "final.html",
        Buffer.from(html, "utf8"),
        "text/html"
      )
    );
    artifactIds.push(
      await persistArtifact(
        jobId,
        projectId,
        "console_logs",
        "console-logs.json",
        Buffer.from(JSON.stringify(consoleLogs, null, 2), "utf8"),
        "application/json"
      )
    );
    artifactIds.push(
      await persistArtifact(
        jobId,
        projectId,
        "network_errors",
        "network-errors.json",
        Buffer.from(JSON.stringify(networkErrors, null, 2), "utf8"),
        "application/json"
      )
    );
    artifactIds.push(
      await persistArtifact(
        jobId,
        projectId,
        "timings",
        "timings.json",
        Buffer.from(JSON.stringify(timings, null, 2), "utf8"),
        "application/json"
      )
    );

    if (harBytes)
      artifactIds.push(
        await persistArtifact(
          jobId,
          projectId,
          "har",
          "trace.har",
          harBytes,
          "application/json"
        )
      );
    if (extracted)
      artifactIds.push(
        await persistArtifact(
          jobId,
          projectId,
          "extracted_json",
          "extracted.json",
          Buffer.from(JSON.stringify(extracted, null, 2), "utf8"),
          "application/json"
        )
      );
    if (exportedCookies)
      artifactIds.push(
        await persistArtifact(
          jobId,
          projectId,
          "cookies",
          "cookies.json",
          Buffer.from(JSON.stringify(exportedCookies, null, 2), "utf8"),
          "application/json"
        )
      );
    for (const screenshot of screenshots) {
      artifactIds.push(
        await persistArtifact(
          jobId,
          projectId,
          "screenshot",
          `${screenshot.name}.png`,
          screenshot.bytes,
          "image/png"
        )
      );
    }

    await setJobState(jobId, "succeeded", {
      usedBrowser,
      artifactCount: artifactIds.length,
      artifacts: artifactIds,
      extracted,
    });
    await logJob(jobId, projectId, "info", "Job completed", {
      artifactCount: artifactIds.length,
    });
    await writeAudit(
      projectId,
      "job.update.succeeded",
      "job",
      jobId,
      row.request_id,
      { artifactCount: artifactIds.length }
    );
  } finally {
    await releaseDomain();
    await releaseProject();
  }
}

function linkAllowed(url: string, rules: CrawlRequest["rules"]): boolean {
  if (
    rules.allowPatterns.length &&
    !rules.allowPatterns.some((pattern) => minimatch(url, pattern))
  )
    return false;
  if (rules.denyPatterns.some((pattern) => minimatch(url, pattern)))
    return false;
  return true;
}

function extractLinks(baseUrl: string, html: string): string[] {
  const regex = /href\s*=\s*["']([^"']+)["']/giu;
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    if (!href) continue;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:")
        links.push(resolved.toString());
    } catch {
      continue;
    }
  }
  return links;
}

async function runCrawl(
  crawlId: string,
  projectId: string,
  requestId: string,
  rawRequest: unknown
): Promise<void> {
  const request = CrawlRequestSchema.parse(rawRequest);
  const seed = await assertSafeUrl(request.seed, {
    blockPrivateRanges,
    allowHosts,
  });
  const seedHost = seed.hostname;
  await pgPool.query(
    `UPDATE crawl_runs SET state = 'running', updated_at = NOW() WHERE id = $1`,
    [crawlId]
  );

  const queue: Array<{ url: string; depth: number; parent: string | null }> = [
    { url: seed.toString(), depth: 0, parent: null },
  ];
  const seen = new Set<string>();
  let queuedJobs = 0;

  while (queue.length > 0 && queuedJobs < request.rules.maxPages) {
    const current = queue.shift();
    if (!current) break;
    if (seen.has(current.url)) continue;
    seen.add(current.url);
    if (current.depth > request.rules.maxDepth) continue;
    if (!linkAllowed(current.url, request.rules)) continue;

    const currentUrl = new URL(current.url);
    if (request.rules.sameDomainOnly && currentUrl.hostname !== seedHost)
      continue;

    const jobId = randomUUID();
    const payload: JobCreateRequest = JobCreateRequestSchema.parse({
      url: current.url,
      recipeId: request.recipeId,
      extract: request.extract,
      options: {
        requiresBrowser: false,
        browserEngine: "chromium",
        respectRobotsTxt: true,
        timeoutMs: 60_000,
        interactiveLogin: false,
      },
    });

    await pgPool.query(
      `INSERT INTO jobs(id, project_id, state, url, request_json, request_id, max_attempts) VALUES($1, $2, 'queued', $3, $4:: jsonb, $5, 3)`,
      [jobId, projectId, current.url, JSON.stringify(payload), requestId]
    );
    await pgPool.query(
      `INSERT INTO crawl_nodes(crawl_id, url, parent_url, depth, job_id, status) VALUES($1, $2, $3, $4, $5, 'queued')`,
      [crawlId, current.url, current.parent, current.depth, jobId]
    );
    await jobsQueue.add(
      "collect",
      { jobId, projectId, requestId },
      {
        jobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 2000 },
      }
    );
    queuedJobs += 1;

    if (current.depth < request.rules.maxDepth) {
      try {
        const response = await fetch(current.url, {
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) {
          const html = await response.text();
          for (const link of extractLinks(current.url, html)) {
            if (!seen.has(link))
              queue.push({
                url: link,
                depth: current.depth + 1,
                parent: current.url,
              });
          }
        }
      } catch {
        // best-effort crawl expansion
      }
    }

    if (request.rules.politenessDelayMs > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, request.rules.politenessDelayMs)
      );
    }
  }

  await pgPool.query(
    `UPDATE crawl_runs SET state = 'succeeded', stats = jsonb_build_object('queued', $2, 'running', 0, 'succeeded', 0, 'failed', 0), updated_at = NOW() WHERE id = $1`,
    [crawlId, queuedJobs]
  );
  await writeAudit(
    projectId,
    "crawl.update.succeeded",
    "crawl",
    crawlId,
    requestId,
    { queuedJobs }
  );
}

const collectionWorker = new Worker(
  "collector-jobs",
  async (job) => {
    const payload = job.data as { jobId: string; projectId: string };
    return tracer.startActiveSpan("worker.collection", async (span) => {
      try {
        await executeCollection(payload.jobId, payload.projectId);
        return { ok: true };
      } catch (error) {
        const row = await getJob(payload.jobId);
        if (row) {
          const cancelled = error instanceof CancelledError;
          await setJobState(
            payload.jobId,
            cancelled ? "cancelled" : "failed",
            undefined,
            (error as Error).message
          );
          await logJob(
            payload.jobId,
            payload.projectId,
            cancelled ? "info" : "error",
            (error as Error).message,
            { error: String(error) }
          );
          await writeAudit(
            payload.projectId,
            `job.update.${cancelled ? "cancelled" : "failed"} `,
            "job",
            payload.jobId,
            row.request_id,
            {
              error: (error as Error).message,
            }
          );
        }
        throw error;
      } finally {
        span.end();
      }
    });
  },
  {
    connection: { host: REDIS_HOST, port: REDIS_PORT },
    concurrency: GLOBAL_CONCURRENCY,
  }
);

collectionWorker.on("failed", async (job, error) => {
  if (!job) return;
  const attempts =
    typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
  if (job.attemptsMade < attempts) return;
  await deadLetterQueue.add(
    "dead-letter",
    {
      queue: "collector-jobs",
      jobId: job.id,
      payload: job.data,
      error: String(error),
      failedAt: new Date().toISOString(),
    },
    { removeOnComplete: { count: 500 }, removeOnFail: { count: 500 } }
  );
});

const crawlWorker = new Worker(
  "collector-crawls",
  async (job) => {
    const payload = job.data as {
      crawlId: string;
      projectId: string;
      requestId: string;
      request: unknown;
    };
    return tracer.startActiveSpan("worker.crawl", async (span) => {
      try {
        await runCrawl(
          payload.crawlId,
          payload.projectId,
          payload.requestId,
          payload.request
        );
        return { ok: true };
      } catch (error) {
        await pgPool.query(
          `UPDATE crawl_runs SET state = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
          [payload.crawlId, (error as Error).message]
        );
        await writeAudit(
          payload.projectId,
          "crawl.update.failed",
          "crawl",
          payload.crawlId,
          payload.requestId,
          { error: String(error) }
        );
        throw error;
      } finally {
        span.end();
      }
    });
  },
  {
    connection: { host: REDIS_HOST, port: REDIS_PORT },
    concurrency: Number(process.env.WORKER_CRAWL_CONCURRENCY ?? 1),
  }
);

crawlWorker.on("failed", async (job, error) => {
  if (!job) return;
  await deadLetterQueue.add(
    "dead-letter",
    {
      queue: "collector-crawls",
      jobId: job.id,
      payload: job.data,
      error: String(error),
      failedAt: new Date().toISOString(),
    },
    { removeOnComplete: { count: 500 }, removeOnFail: { count: 500 } }
  );
});

async function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  const SHUTDOWN_TIMEOUT_MS = 30_000;

  const cleanup = Promise.allSettled([
    collectionWorker.close(),
    crawlWorker.close(),
    deadLetterQueue.close(),
    jobsQueue.close(),
    browserPool?.closeAll(),
    redis.quit(),
    pgPool.end(),
  ]);

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Shutdown timed out")), SHUTDOWN_TIMEOUT_MS)
  );

  try {
    await Promise.race([cleanup, timeout]);
    logger.info("Graceful shutdown complete");
    process.exit(0);
  } catch (err) {
    logger.error(`Forced shutdown: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
  shutdown("unhandledRejection");
});

logger.info("Worker online");
