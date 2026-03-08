import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Queue } from "bullmq";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { trace, type Span } from "@opentelemetry/api";
import client from "prom-client";
import {
  ArtifactStorage,
  CrawlRequestSchema,
  CreateApiTokenRequestSchema,
  ExtractRequestSchema,
  JobCreateRequestSchema,
  RecipeSchema,
  SearchRequestSchema,
  assertSafeUrl,
  buildBingHtmlSearchUrl,
  buildBraveHtmlSearchUrl,
  buildDuckDuckGoSearchUrl,
  buildGoogleHtmlSearchUrl,
  buildYahooSearchUrl,
  createErrorResponse,
  defaultArtifactConfigFromEnv,
  extractByJsonSchema,
  extractByPlugin,
  extractBySelectors,
  localeParts,
  loadRecipesFromDirectory,
  parseAllowHosts,
  parseBingApiSearchResults,
  parseBingHtmlSearchResults,
  parseBraveApiSearchResults,
  parseBraveHtmlSearchResults,
  parseGoogleCustomSearchResults,
  parseGoogleHtmlSearchResults,
  parseDuckDuckGoSearchResults,
  parseYahooSearchResults,
  safeSearchToBing,
  safeSearchToBrave,
  safeSearchToGoogle,
  recipeMatchesUrl,
  resolveRepoPath,
  type AuthContext,
  type Recipe,
  getStealthHeaders,
  getStealthJsonHeaders,
  getRandomUA,
  engineDelay,
  SimpleCookieJar,
} from "@kryfto/shared";
import { browserSearchGoogle, closeGoogleBrowser } from "./google-browser.js";
import { parseBearerToken, requireRole } from "./auth-rbac.js";
import {
  db,
  generateApiToken,
  hashToken,
  pool,
  runMigrations,
} from "./db/client.js";
import {
  apiTokens,
  artifactBlobs,
  artifactDownloadTokens,
  artifacts,
  auditLogs,
  crawlNodes,
  crawlRuns,
  idempotencyKeys,
  jobLogs,
  jobs,
  projects,
  rateLimitConfig,
  recipes,
} from "./db/schema.js";

const PORT = Number(process.env.KRYFTO_PORT ?? 8080);
const LOG_LEVEL = process.env.KRYFTO_LOG_LEVEL ?? "info";
const REDIS_HOST = process.env.REDIS_HOST ?? "redis";
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);
const DEFAULT_PROJECT_ID = process.env.KRYFTO_PROJECT_ID ?? "default";
const MAX_ATTEMPTS = Number(process.env.KRYFTO_JOB_MAX_ATTEMPTS ?? 3);
const blockPrivateRanges =
  String(process.env.KRYFTO_SSRF_BLOCK_PRIVATE_RANGES ?? "true") === "true";
const allowHosts = parseAllowHosts(process.env.KRYFTO_ALLOWED_HOSTS);

const tracer = trace.getTracer("collector-api");
const storage = new ArtifactStorage(defaultArtifactConfigFromEnv());

const app = Fastify({
  logger: {
    level: LOG_LEVEL,
    redact: [
      "req.headers.authorization",
      "*.token",
      "*.secret",
      "*.password",
      "*.apiKey",
    ],
  },
  genReqId: (req) => {
    const fromHeader = req.headers["x-request-id"];
    return typeof fromHeader === "string" && fromHeader.trim()
      ? fromHeader
      : randomUUID();
  },
});

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
    requestStartNs?: bigint;
    apiSpan?: Span;
  }
}

function stableStringify(input: unknown): string {
  if (Array.isArray(input)) {
    return `[${input.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (input && typeof input === "object") {
    const entries = Object.entries(input as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b)
    );
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(",")}}`;
  }
  const primitive = JSON.stringify(input);
  return primitive === undefined ? "null" : primitive;
}

function hashRequestPayload(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function makeOpenApiPath(): string {
  return path.join(process.cwd(), "docs", "openapi.yaml");
}

async function loadRecipeRegistry(projectId: string): Promise<Recipe[]> {
  const builtIn = await loadRecipesFromDirectory(resolveRepoPath("recipes"));
  const mountedDir = process.env.KRYFTO_RECIPES_DIR;
  const mounted = mountedDir ? await loadRecipesFromDirectory(mountedDir) : [];

  const dbRecipesRows = await db
    .select()
    .from(recipes)
    .where(or(eq(recipes.projectId, projectId), isNull(recipes.projectId)))
    .orderBy(desc(recipes.createdAt));

  const dbRecipesParsed: Recipe[] = [];
  for (const row of dbRecipesRows) {
    const parsed = RecipeSchema.safeParse({
      id: row.id,
      name: row.name,
      version: row.version,
      description: row.description ?? undefined,
      match: row.match,
      requiresBrowser: row.requiresBrowser,
      steps: row.steps ?? undefined,
      extraction: row.extraction ?? undefined,
      throttling: row.throttling ?? undefined,
      pluginPath: row.pluginPath ?? undefined,
    });
    if (parsed.success) {
      dbRecipesParsed.push(parsed.data);
    }
  }

  const byId = new Map<string, Recipe>();
  for (const recipe of [...builtIn, ...mounted, ...dbRecipesParsed]) {
    byId.set(recipe.id, recipe);
  }

  return [...byId.values()];
}

async function writeAuditLog(params: {
  auth: AuthContext;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string;
  ip: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLogs).values({
    projectId: params.auth.projectId,
    tokenId: params.auth.tokenId,
    actorRole: params.auth.role,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    requestId: params.requestId,
    ipAddress: params.ip,
    details: params.details ?? {},
  });
}

async function ensureBootstrapData(): Promise<void> {
  await db
    .insert(projects)
    .values({ id: DEFAULT_PROJECT_ID, name: "Default Project" })
    .onConflictDoNothing({ target: projects.id });

  const bootstrapToken =
    process.env.KRYFTO_BOOTSTRAP_ADMIN_TOKEN ?? process.env.KRYFTO_API_TOKEN;
  if (!bootstrapToken) {
    return;
  }

  const existing = await db
    .select({ id: apiTokens.id })
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.tokenHash, hashToken(bootstrapToken)),
        isNull(apiTokens.revokedAt)
      )
    )
    .limit(1);

  if (existing.length === 0) {
    await db.insert(apiTokens).values({
      projectId: DEFAULT_PROJECT_ID,
      name: "bootstrap",
      role: "admin",
      tokenHash: hashToken(bootstrapToken),
    });
    app.log.info("Bootstrap admin API token inserted for default project");
  }
}

async function resolveAuth(request: {
  headers: Record<string, unknown>;
}): Promise<AuthContext | null> {
  const header = request.headers.authorization;
  const token = parseBearerToken(
    typeof header === "string" ? header : undefined
  );
  if (!token) return null;

  const hashed = hashToken(token);
  const tokenRows = await db
    .select({
      id: apiTokens.id,
      projectId: apiTokens.projectId,
      role: apiTokens.role,
      tokenHash: apiTokens.tokenHash,
      expiresAt: apiTokens.expiresAt,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hashed), isNull(apiTokens.revokedAt)))
    .limit(1);

  const row = tokenRows[0];
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  return {
    tokenId: row.id,
    projectId: row.projectId,
    role: row.role,
    tokenHash: row.tokenHash,
  };
}

const register = new client.Registry();
client.collectDefaultMetrics({ register });
const requestCounter = new client.Counter({
  name: "collector_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status"] as const,
  registers: [register],
});
const latencyHistogram = new client.Histogram({
  name: "collector_http_request_duration_seconds",
  help: "API request duration",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register],
});

await runMigrations();
await ensureBootstrapData();

const redisConnection = { host: REDIS_HOST, port: REDIS_PORT };
const jobsQueue = new Queue("collector-jobs", { connection: redisConnection });
const crawlQueue = new Queue("collector-crawls", {
  connection: redisConnection,
});

// Load per-role rate limits from DB (falls back to env/defaults)
const roleLimitsRows = await db.select().from(rateLimitConfig);
const roleLimits: Record<string, number> = {
  admin: 500,
  developer: 120,
  readonly: 60,
};
for (const row of roleLimitsRows) {
  roleLimits[row.role] = row.rpm;
}
const defaultRpm = Number(process.env.KRYFTO_RATE_LIMIT_RPM ?? 120);

await app.register(rateLimit, {
  max: (req) => {
    const role = req.auth?.role;
    if (role && roleLimits[role] !== undefined) return roleLimits[role]!;
    return defaultRpm;
  },
  timeWindow: "1 minute",
  keyGenerator: (req) => {
    const auth = req.headers.authorization ?? "";
    const token = typeof auth === "string" ? auth : "";
    const tokenHash = token
      ? createHash("sha1").update(token).digest("hex")
      : "anonymous";
    return `${tokenHash}:${req.ip}`;
  },
});

await app.register(swagger, {
  openapi: {
    info: {
      title: "Self-hosted Browser Data Collection Runtime API",
      version: "1.0.0",
    },
  },
});
await app.register(swaggerUi, { routePrefix: "/docs" });

app.addHook("onRequest", async (req) => {
  req.requestStartNs = process.hrtime.bigint();
  req.apiSpan = tracer.startSpan(`api.${req.method.toLowerCase()} ${req.url}`);
});

app.addHook("onSend", async (req, reply, payload) => {
  reply.header("x-request-id", req.id);
  return payload;
});

app.addHook("onResponse", async (req, reply) => {
  const route = req.routeOptions.url ?? "unknown";
  const status = String(reply.statusCode);
  requestCounter.inc({ method: req.method, route, status });
  if (req.requestStartNs) {
    const durationSec =
      Number(process.hrtime.bigint() - req.requestStartNs) / 1_000_000_000;
    latencyHistogram.observe(
      { method: req.method, route, status },
      durationSec
    );
  }
  req.apiSpan?.end();
});

app.addHook("preHandler", async (req, reply) => {
  const publicPrefixes = [
    "/v1/healthz",
    "/v1/readyz",
    "/v1/metrics",
    "/docs",
    "/documentation",
    "/docs/openapi.yaml",
  ];
  if (publicPrefixes.some((prefix) => req.url.startsWith(prefix))) {
    return;
  }

  const resolvedAuth = await resolveAuth(
    req as { headers: Record<string, unknown> }
  );
  if (resolvedAuth) {
    req.auth = resolvedAuth;
    return;
  }

  const isArtifactDownload = req.url.startsWith("/v1/artifacts/");
  const query = req.query as Record<string, unknown>;
  const hasDownloadToken =
    typeof query.downloadToken === "string" && query.downloadToken.length > 0;

  if (isArtifactDownload && hasDownloadToken) {
    return;
  }

  reply
    .status(401)
    .send(createErrorResponse("AUTH_UNAUTHORIZED", "Unauthorized", req.id));
});

app.setErrorHandler((error, req, reply) => {
  if (error instanceof Error && error.message === "AUTH_UNAUTHORIZED") {
    reply
      .status(401)
      .send(createErrorResponse("AUTH_UNAUTHORIZED", "Unauthorized", req.id));
    return;
  }

  if (error instanceof Error && error.message === "AUTH_FORBIDDEN") {
    reply
      .status(403)
      .send(createErrorResponse("AUTH_FORBIDDEN", "Forbidden", req.id));
    return;
  }

  req.log.error({ err: error }, "Unhandled error");
  reply
    .status(500)
    .send(
      createErrorResponse("INTERNAL_ERROR", "Internal server error", req.id)
    );
});

app.get("/docs/openapi.yaml", async (_req, reply) => {
  const yaml = await readFile(makeOpenApiPath(), "utf8");
  reply.type("application/yaml").send(yaml);
});

app.get("/v1/healthz", async () => ({ ok: true, service: "collector-api" }));

app.get("/v1/readyz", async (_req, reply) => {
  try {
    await pool.query("SELECT 1");
    const redisClient = await jobsQueue.client;
    await redisClient.ping();
    return { ok: true };
  } catch (error) {
    reply.status(503);
    return { ok: false, reason: String(error) };
  }
});

app.get("/v1/metrics", async (_req, reply) => {
  reply.header("Content-Type", register.contentType);
  return register.metrics();
});

app.post("/v1/admin/tokens", async (req, reply) => {
  const auth = requireRole(req.auth, ["admin"]);

  const parsed = CreateApiTokenRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply
      .status(400)
      .send(
        createErrorResponse(
          "VALIDATION_ERROR",
          "Invalid token request",
          req.id,
          parsed.error.flatten()
        )
      );
  }

  const tokenPlain = generateApiToken();
  const tokenHashValue = hashToken(tokenPlain);

  await db
    .insert(projects)
    .values({ id: parsed.data.projectId, name: parsed.data.projectId })
    .onConflictDoNothing({ target: projects.id });

  const inserted = await db
    .insert(apiTokens)
    .values({
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      role: parsed.data.role,
      tokenHash: tokenHashValue,
    })
    .returning({
      id: apiTokens.id,
      role: apiTokens.role,
      projectId: apiTokens.projectId,
      name: apiTokens.name,
    });

  await writeAuditLog({
    auth,
    action: "admin.token.create",
    resourceType: "api_token",
    resourceId: inserted[0]?.id ?? "unknown",
    requestId: req.id,
    ip: req.ip,
    details: { projectId: parsed.data.projectId, role: parsed.data.role },
  });

  return reply
    .status(201)
    .send({ token: tokenPlain, tokenId: inserted[0]?.id });
});

app.post("/v1/jobs", async (req, reply) => {
  const auth = requireRole(req.auth, ["admin", "developer"]);
  const idemKeyRaw = req.headers["idempotency-key"];
  const idempotencyKey =
    typeof idemKeyRaw === "string" ? idemKeyRaw.trim() : undefined;

  const parsed = JobCreateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply
      .status(400)
      .send(
        createErrorResponse(
          "VALIDATION_ERROR",
          "Invalid job request",
          req.id,
          parsed.error.flatten()
        )
      );
  }

  return tracer.startActiveSpan("api.create_job", async (span) => {
    try {
      await assertSafeUrl(parsed.data.url, { blockPrivateRanges, allowHosts });

      const registry = await loadRecipeRegistry(auth.projectId);
      let recipe: Recipe | undefined;
      if (parsed.data.recipeId) {
        recipe = registry.find((item) => item.id === parsed.data.recipeId);
        if (!recipe) {
          return reply
            .status(404)
            .send(
              createErrorResponse(
                "RECIPE_NOT_FOUND",
                "Recipe not found",
                req.id
              )
            );
        }
      } else {
        recipe = registry.find((item) =>
          recipeMatchesUrl(item, parsed.data.url)
        );
      }

      const mergedRequest = JobCreateRequestSchema.parse({
        ...parsed.data,
        options: {
          ...parsed.data.options,
          ...(parsed.data.options?.requiresBrowser === undefined && recipe
            ? { requiresBrowser: recipe.requiresBrowser }
            : {}),
        },
        steps: parsed.data.steps ?? recipe?.steps,
        extract: parsed.data.extract ?? recipe?.extraction,
      });

      const requestHash = hashRequestPayload(mergedRequest);

      if (idempotencyKey) {
        const idemRows = await db
          .select()
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.projectId, auth.projectId),
              eq(idempotencyKeys.key, idempotencyKey)
            )
          )
          .limit(1);

        const idem = idemRows[0];
        if (idem) {
          if (idem.requestHash !== requestHash) {
            return reply
              .status(409)
              .send(
                createErrorResponse(
                  "IDEMPOTENCY_CONFLICT",
                  "Idempotency key reused with different payload",
                  req.id
                )
              );
          }

          const existingJob = await db
            .select()
            .from(jobs)
            .where(
              and(eq(jobs.id, idem.jobId), eq(jobs.projectId, auth.projectId))
            )
            .limit(1);

          if (existingJob[0]) {
            return reply.status(202).send({
              jobId: existingJob[0].id,
              state: existingJob[0].state,
              requestId: req.id,
              idempotencyKey,
            });
          }
        }
      }

      const jobId = randomUUID();

      await db.insert(jobs).values({
        id: jobId,
        projectId: auth.projectId,
        state: "queued",
        url: mergedRequest.url,
        requestJson: mergedRequest,
        requestId: req.id,
        maxAttempts: MAX_ATTEMPTS,
      });

      if (idempotencyKey) {
        await db.insert(idempotencyKeys).values({
          projectId: auth.projectId,
          key: idempotencyKey,
          requestHash,
          jobId,
        });
      }

      await jobsQueue.add(
        "collect",
        { jobId, projectId: auth.projectId, requestId: req.id },
        {
          jobId,
          attempts: MAX_ATTEMPTS,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 2000 },
        }
      );

      await writeAuditLog({
        auth,
        action: "job.create",
        resourceType: "job",
        resourceId: jobId,
        requestId: req.id,
        ip: req.ip,
        details: {
          url: mergedRequest.url,
          recipeId: mergedRequest.recipeId ?? null,
        },
      });

      return reply.status(202).send({
        jobId,
        state: "queued",
        requestId: req.id,
        idempotencyKey,
      });
    } finally {
      span.end();
    }
  });
});

app.get("/v1/jobs/:jobId", async (req, reply) => {
  const auth = requireRole(req.auth, ["admin", "developer", "readonly"]);
  const { jobId } = req.params as { jobId: string };

  const rows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.projectId, auth.projectId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return reply
      .status(404)
      .send(createErrorResponse("NOT_FOUND", "Job not found", req.id));
  }

  return {
    id: row.id,
    projectId: row.projectId,
    state: row.state,
    url: row.url,
    requestId: row.requestId,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resultSummary: row.resultSummary,
    errorMessage: row.errorMessage,
  };
});

app.get("/v1/jobs/:jobId/logs", async (req, reply) => {
  const auth = requireRole(req.auth, ["admin", "developer", "readonly"]);
  const { jobId } = req.params as { jobId: string };

  const owned = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.projectId, auth.projectId)))
    .limit(1);

  if (!owned[0]) {
    return reply
      .status(404)
      .send(createErrorResponse("NOT_FOUND", "Job not found", req.id));
  }

  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");

  let closed = false;
  let lastLogId = 0;

  const emitLogs = async () => {
    const rows = await db
      .select({
        id: jobLogs.id,
        level: jobLogs.level,
        message: jobLogs.message,
        meta: jobLogs.meta,
        createdAt: jobLogs.createdAt,
      })
      .from(jobLogs)
      .where(and(eq(jobLogs.jobId, jobId), gt(jobLogs.id, lastLogId)))
      .orderBy(jobLogs.id)
      .limit(100);

    for (const row of rows) {
      lastLogId = row.id;
      reply.raw.write(`event: log\n`);
      reply.raw.write(`data: ${JSON.stringify(row)}\n\n`);
    }
  };

  await emitLogs();

  const timer = setInterval(async () => {
    if (closed) return;
    try {
      await emitLogs();
    } catch (error) {
      reply.raw.write(`event: error\n`);
      reply.raw.write(
        `data: ${JSON.stringify({ message: String(error) })}\n\n`
      );
    }
  }, 1000);

  req.raw.on("close", () => {
    closed = true;
    clearInterval(timer);
  });

  return reply;
});

app.post("/v1/jobs/:jobId/cancel", async (req, reply) => {
  const auth = requireRole(req.auth, ["admin", "developer"]);
  const { jobId } = req.params as { jobId: string };

  const updated = await db
    .update(jobs)
    .set({ cancelRequested: true, updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), eq(jobs.projectId, auth.projectId)))
    .returning({ id: jobs.id, state: jobs.state });

  if (!updated[0]) {
    return reply
      .status(404)
      .send(createErrorResponse("NOT_FOUND", "Job not found", req.id));
  }

  const queued = await jobsQueue.getJob(jobId);
  if (queued) {
    await queued.remove();
    await db
      .update(jobs)
      .set({ state: "cancelled", updatedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.projectId, auth.projectId)));
  }

  await writeAuditLog({
    auth,
    action: "job.cancel",
    resourceType: "job",
    resourceId: jobId,
    requestId: req.id,
    ip: req.ip,
  });

  return reply.status(202).send({ jobId, state: "cancelled" });
});

app.get("/v1/jobs/:jobId/artifacts", async (req, reply) => {
  const auth = requireRole(req.auth, ["admin", "developer", "readonly"]);
  const { jobId } = req.params as { jobId: string };

  const owned = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.projectId, auth.projectId)))
    .limit(1);

  if (!owned[0]) {
    return reply
      .status(404)
      .send(createErrorResponse("NOT_FOUND", "Job not found", req.id));
  }

  const rows = await db
    .select({
      id: artifacts.id,
      type: artifacts.type,
      fileName: artifacts.fileName,
      byteSize: artifacts.byteSize,
      createdAt: artifacts.createdAt,
      sha256: artifactBlobs.sha256,
      contentType: artifactBlobs.contentType,
      storageKey: artifactBlobs.storageKey,
      projectId: artifacts.projectId,
    })
    .from(artifacts)
    .innerJoin(artifactBlobs, eq(artifacts.blobSha256, artifactBlobs.sha256))
    .where(
      and(eq(artifacts.jobId, jobId), eq(artifacts.projectId, auth.projectId))
    )
    .orderBy(desc(artifacts.createdAt));

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const items = [] as Array<Record<string, unknown>>;
  for (const row of rows) {
    const insertedToken = await db
      .insert(artifactDownloadTokens)
      .values({ artifactId: row.id, projectId: row.projectId, expiresAt })
      .returning({ token: artifactDownloadTokens.token });

    const signedUrl = await storage.createSignedReadUrl(row.storageKey, 300);

    items.push({
      id: row.id,
      jobId,
      projectId: row.projectId,
      type: row.type,
      fileName: row.fileName,
      byteSize: row.byteSize,
      sha256: row.sha256,
      contentType: row.contentType,
      createdAt: row.createdAt,
      downloadToken: insertedToken[0]?.token,
      downloadTokenExpiresAt: expiresAt.toISOString(),
      signedUrl,
    });
  }

  return { items };
});

app.get("/v1/artifacts/:artifactId", async (req, reply) => {
  const artifactId = (req.params as { artifactId: string }).artifactId;
  const query = req.query as { downloadToken?: string };

  const artifactRows = await db
    .select({
      id: artifacts.id,
      projectId: artifacts.projectId,
      fileName: artifacts.fileName,
      type: artifacts.type,
      contentType: artifactBlobs.contentType,
      storageKey: artifactBlobs.storageKey,
    })
    .from(artifacts)
    .innerJoin(artifactBlobs, eq(artifacts.blobSha256, artifactBlobs.sha256))
    .where(eq(artifacts.id, artifactId))
    .limit(1);

  const artifact = artifactRows[0];
  if (!artifact) {
    return reply
      .status(404)
      .send(createErrorResponse("NOT_FOUND", "Artifact not found", req.id));
  }

  let auth = req.auth;
  if (auth) {
    if (auth.projectId !== artifact.projectId) {
      return reply
        .status(403)
        .send(createErrorResponse("AUTH_FORBIDDEN", "Forbidden", req.id));
    }
  } else {
    if (!query.downloadToken) {
      return reply
        .status(401)
        .send(createErrorResponse("AUTH_UNAUTHORIZED", "Unauthorized", req.id));
    }

    const tokenRows = await db
      .select()
      .from(artifactDownloadTokens)
      .where(
        and(
          eq(artifactDownloadTokens.token, query.downloadToken),
          eq(artifactDownloadTokens.artifactId, artifactId)
        )
      )
      .limit(1);

    const token = tokenRows[0];
    if (!token || token.expiresAt.getTime() < Date.now()) {
      return reply
        .status(401)
        .send(
          createErrorResponse(
            "AUTH_UNAUTHORIZED",
            "Download token expired or invalid",
            req.id
          )
        );
    }

    auth = {
      tokenId: "download-token",
      projectId: token.projectId,
      role: "readonly",
      tokenHash: "download-token",
    };
  }

  const bytes = await storage.getBuffer(artifact.storageKey);

  await writeAuditLog({
    auth,
    action: "artifact.download",
    resourceType: "artifact",
    resourceId: artifactId,
    requestId: req.id,
    ip: req.ip,
    details: { type: artifact.type },
  });

  reply.header("Content-Type", artifact.contentType);
  reply.header(
    "Content-Disposition",
    `attachment; filename="${artifact.fileName}"`
  );
  return reply.send(bytes);
});

app.post("/v1/extract", async (req, reply) => {
  const auth = requireRole(req.auth, ["admin", "developer"]);
  const parsed = ExtractRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply
      .status(400)
      .send(
        createErrorResponse(
          "VALIDATION_ERROR",
          "Invalid extract request",
          req.id,
          parsed.error.flatten()
        )
      );
  }

  let html = parsed.data.html;
  const text = parsed.data.text;

  if (parsed.data.artifactId) {
    const rows = await db
      .select({
        projectId: artifacts.projectId,
        storageKey: artifactBlobs.storageKey,
      })
      .from(artifacts)
      .innerJoin(artifactBlobs, eq(artifacts.blobSha256, artifactBlobs.sha256))
      .where(eq(artifacts.id, parsed.data.artifactId))
      .limit(1);

    const row = rows[0];
    if (!row || row.projectId !== auth.projectId) {
      return reply
        .status(404)
        .send(createErrorResponse("NOT_FOUND", "Artifact not found", req.id));
    }

    html = (await storage.getBuffer(row.storageKey)).toString("utf8");
  }

  const effectiveHtml = html ?? `<html><body>${text ?? ""}</body></html>`;
  let data: unknown;

  if (parsed.data.mode === "selectors") {
    data = extractBySelectors(effectiveHtml, parsed.data.selectors ?? {});
  } else if (parsed.data.mode === "schema") {
    data = extractByJsonSchema(effectiveHtml, parsed.data.jsonSchema ?? {});
  } else {
    const plugin = parsed.data.plugin ?? "";
    const pluginPath = path.isAbsolute(plugin)
      ? plugin
      : resolveRepoPath("recipes", "plugins", plugin);
    data = await extractByPlugin(pluginPath, {
      html: effectiveHtml,
      ...(text === undefined ? {} : { text }),
    });
  }

  await writeAuditLog({
    auth,
    action: "extract.run",
    resourceType: "extract",
    resourceId: parsed.data.artifactId ?? "inline",
    requestId: req.id,
    ip: req.ip,
    details: { mode: parsed.data.mode },
  });

  return { data, mode: parsed.data.mode };
});

app.post("/v1/search", async (req, reply) => {
  const auth = requireRole(req.auth, ["admin", "developer", "readonly"]);
  const parsed = SearchRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply
      .status(400)
      .send(
        createErrorResponse(
          "VALIDATION_ERROR",
          "Invalid search request",
          req.id,
          parsed.error.flatten()
        )
      );
  }
  const querySha = createHash("sha256").update(parsed.data.query).digest("hex");
  const locale = localeParts(parsed.data.locale);
  const searchTimeoutMs = Number(
    process.env.KRYFTO_SEARCH_TIMEOUT_MS ?? 20_000
  );

  const cookieJar = new SimpleCookieJar();

  const fetchHtml = async (url: string, engine?: string): Promise<string> => {
    await assertSafeUrl(url, { blockPrivateRanges, allowHosts });
    if (engine) await engineDelay(engine);
    const ua = getRandomUA();
    const stealthHeaders = getStealthHeaders(engine ?? "unknown", ua);
    // Merge cookies from jar
    const hostname = new URL(url).hostname;
    const cookie = cookieJar.get(hostname);
    if (cookie) stealthHeaders["Cookie"] = cookie;

    const response = await fetch(url, {
      method: "GET",
      headers: stealthHeaders,
      signal: AbortSignal.timeout(searchTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`upstream status=${response.status}`);
    }
    // Persist cookies from response
    cookieJar.extractFromResponse(hostname, response);
    return response.text();
  };

  const fetchJson = async (
    url: string,
    headers?: Record<string, string>
  ): Promise<unknown> => {
    await assertSafeUrl(url, { blockPrivateRanges, allowHosts });
    const ua = getRandomUA();
    const response = await fetch(url, {
      method: "GET",
      headers: getStealthJsonHeaders(ua, headers),
      signal: AbortSignal.timeout(searchTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`upstream status=${response.status}`);
    }

    return response.json();
  };

  let results: Array<{
    title: string;
    url: string;
    snippet?: string;
    rank: number;
  }> = [];
  try {
    switch (parsed.data.engine) {
      case "duckduckgo": {
        const searchUrl = buildDuckDuckGoSearchUrl({
          query: parsed.data.query,
          safeSearch: parsed.data.safeSearch,
          locale: parsed.data.locale,
        });
        results = parseDuckDuckGoSearchResults(
          await fetchHtml(searchUrl, "duckduckgo"),
          parsed.data.limit
        );
        break;
      }
      case "yahoo": {
        const searchUrl = buildYahooSearchUrl({
          query: parsed.data.query,
          safeSearch: parsed.data.safeSearch,
          locale: parsed.data.locale,
        });
        results = parseYahooSearchResults(
          await fetchHtml(searchUrl, "yahoo"),
          parsed.data.limit
        );
        break;
      }
      case "bing": {
        const bingKey = process.env.BING_SEARCH_API_KEY;
        if (bingKey) {
          try {
            const endpoint =
              process.env.BING_SEARCH_ENDPOINT ??
              "https://api.bing.microsoft.com/v7.0/search";
            const url = new URL(endpoint);
            url.searchParams.set("q", parsed.data.query);
            url.searchParams.set("count", String(parsed.data.limit));
            url.searchParams.set(
              "safeSearch",
              safeSearchToBing(parsed.data.safeSearch)
            );
            url.searchParams.set("mkt", locale.mkt);
            const payload = await fetchJson(url.toString(), {
              "Ocp-Apim-Subscription-Key": bingKey,
            });
            results = parseBingApiSearchResults(payload, parsed.data.limit);
          } catch {
            const searchUrl = buildBingHtmlSearchUrl({
              query: parsed.data.query,
              safeSearch: parsed.data.safeSearch,
              locale: parsed.data.locale,
            });
            results = parseBingHtmlSearchResults(
              await fetchHtml(searchUrl, "bing"),
              parsed.data.limit
            );
          }
        } else {
          const searchUrl = buildBingHtmlSearchUrl({
            query: parsed.data.query,
            safeSearch: parsed.data.safeSearch,
            locale: parsed.data.locale,
          });
          results = parseBingHtmlSearchResults(
            await fetchHtml(searchUrl, "bing"),
            parsed.data.limit
          );
        }
        break;
      }
      case "google": {
        const googleKey = process.env.GOOGLE_CSE_API_KEY;
        const googleCx = process.env.GOOGLE_CSE_CX;
        if (googleKey && googleCx) {
          try {
            const url = new URL("https://www.googleapis.com/customsearch/v1");
            const googleLimit = Math.min(parsed.data.limit, 10);
            url.searchParams.set("key", googleKey);
            url.searchParams.set("cx", googleCx);
            url.searchParams.set("q", parsed.data.query);
            url.searchParams.set("num", String(googleLimit));
            url.searchParams.set(
              "safe",
              safeSearchToGoogle(parsed.data.safeSearch)
            );
            url.searchParams.set("hl", locale.language);
            url.searchParams.set("gl", locale.region);
            const payload = await fetchJson(url.toString());
            results = parseGoogleCustomSearchResults(payload, googleLimit);
            break;
          } catch (error) {
            req.log.warn(
              { err: String(error), engine: "google", requestId: req.id },
              "google api failed; using browser fallback"
            );
          }
        }

        // Google requires JS rendering — use Playwright browser
        try {
          results = await browserSearchGoogle(
            parsed.data.query,
            parsed.data.limit,
            parsed.data.safeSearch,
            parsed.data.locale,
          );
        } catch (browserErr) {
          req.log.warn(
            { err: String(browserErr), engine: "google", requestId: req.id },
            "google browser search failed"
          );
          // Try plain HTML as last resort (may return 0 results but won't throw)
          try {
            const searchUrl = buildGoogleHtmlSearchUrl({
              query: parsed.data.query,
              safeSearch: parsed.data.safeSearch,
              locale: parsed.data.locale,
            });
            results = parseGoogleHtmlSearchResults(
              await fetchHtml(searchUrl, "google"),
              parsed.data.limit
            );
          } catch (htmlErr) {
            throw new Error(
              `Google search unavailable: browser=${String(browserErr)}, html=${String(htmlErr)}`
            );
          }
        }
        break;
      }
      case "brave": {
        const braveKey = process.env.BRAVE_SEARCH_API_KEY;
        if (braveKey) {
          try {
            const url = new URL(
              "https://api.search.brave.com/res/v1/web/search"
            );
            url.searchParams.set("q", parsed.data.query);
            url.searchParams.set("count", String(parsed.data.limit));
            url.searchParams.set(
              "safesearch",
              safeSearchToBrave(parsed.data.safeSearch)
            );
            url.searchParams.set("country", locale.region.toUpperCase());
            url.searchParams.set("search_lang", locale.language);
            const payload = await fetchJson(url.toString(), {
              "X-Subscription-Token": braveKey,
            });
            results = parseBraveApiSearchResults(payload, parsed.data.limit);
            break;
          } catch (error) {
            req.log.warn(
              { err: String(error), engine: "brave", requestId: req.id },
              "brave api failed; using html fallback"
            );
          }
        }

        const searchUrl = buildBraveHtmlSearchUrl({
          query: parsed.data.query,
          safeSearch: parsed.data.safeSearch,
          locale: parsed.data.locale,
        });
        results = parseBraveHtmlSearchResults(
          await fetchHtml(searchUrl, "brave"),
          parsed.data.limit
        );
        break;
      }
      default: {
        return reply
          .status(400)
          .send(
            createErrorResponse(
              "SEARCH_ENGINE_UNSUPPORTED",
              "Unsupported search engine",
              req.id
            )
          );
      }
    }
  } catch (error) {
    return reply
      .status(502)
      .send(
        createErrorResponse(
          "SEARCH_UPSTREAM_ERROR",
          `Search provider request failed: ${String(error)}`,
          req.id
        )
      );
  }

  await writeAuditLog({
    auth,
    action: "search.run",
    resourceType: "search",
    resourceId: querySha.slice(0, 16),
    requestId: req.id,
    ip: req.ip,
    details: {
      queryHash: querySha,
      queryLength: parsed.data.query.length,
      limit: parsed.data.limit,
      engine: parsed.data.engine,
      resultCount: results.length,
    },
  });

  return {
    query: parsed.data.query,
    limit: parsed.data.limit,
    engine: parsed.data.engine,
    safeSearch: parsed.data.safeSearch,
    locale: parsed.data.locale,
    results,
    requestId: req.id,
  };
});

app.post("/v1/crawl", async (req, reply) => {
  const auth = requireRole(req.auth, ["admin", "developer"]);
  const parsed = CrawlRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply
      .status(400)
      .send(
        createErrorResponse(
          "VALIDATION_ERROR",
          "Invalid crawl request",
          req.id,
          parsed.error.flatten()
        )
      );
  }

  await assertSafeUrl(parsed.data.seed, { blockPrivateRanges, allowHosts });

  const crawlId = randomUUID();

  await db.insert(crawlRuns).values({
    id: crawlId,
    projectId: auth.projectId,
    seed: parsed.data.seed,
    state: "queued",
    rules: parsed.data.rules,
    requestId: req.id,
  });

  await db.insert(crawlNodes).values({
    crawlId,
    url: parsed.data.seed,
    depth: 0,
    status: "queued",
  });

  await crawlQueue.add(
    "crawl",
    {
      crawlId,
      projectId: auth.projectId,
      requestId: req.id,
      request: parsed.data,
    },
    {
      jobId: crawlId,
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1000 },
    }
  );

  await writeAuditLog({
    auth,
    action: "crawl.create",
    resourceType: "crawl",
    resourceId: crawlId,
    requestId: req.id,
    ip: req.ip,
    details: { seed: parsed.data.seed },
  });

  return reply
    .status(202)
    .send({ crawlId, state: "queued", requestId: req.id });
});

app.get("/v1/crawl/:crawlId", async (req, reply) => {
  const auth = requireRole(req.auth, ["admin", "developer", "readonly"]);
  const { crawlId } = req.params as { crawlId: string };

  const rows = await db
    .select()
    .from(crawlRuns)
    .where(
      and(eq(crawlRuns.id, crawlId), eq(crawlRuns.projectId, auth.projectId))
    )
    .limit(1);

  const crawl = rows[0];
  if (!crawl) {
    return reply
      .status(404)
      .send(createErrorResponse("NOT_FOUND", "Crawl not found", req.id));
  }

  const statsRows = await db
    .select({
      queued: sql<number>`count(*) filter (where ${crawlNodes.status} = 'queued')`,
      running: sql<number>`count(*) filter (where ${crawlNodes.status} = 'running')`,
      succeeded: sql<number>`count(*) filter (where ${crawlNodes.status} = 'succeeded')`,
      failed: sql<number>`count(*) filter (where ${crawlNodes.status} = 'failed')`,
    })
    .from(crawlNodes)
    .where(eq(crawlNodes.crawlId, crawlId));

  return {
    id: crawl.id,
    projectId: crawl.projectId,
    state: crawl.state,
    seed: crawl.seed,
    stats: statsRows[0] ?? crawl.stats,
    createdAt: crawl.createdAt,
    updatedAt: crawl.updatedAt,
  };
});

app.post("/v1/recipes/validate", async (req) => {
  requireRole(req.auth, ["admin", "developer"]);
  const body = req.body as Record<string, unknown> | undefined;
  const payload =
    body && typeof body === "object" && "recipe" in body
      ? body.recipe
      : req.body;
  const parsed = RecipeSchema.safeParse(payload);
  if (parsed.success) {
    return { valid: true, recipe: parsed.data };
  }
  return { valid: false, issues: parsed.error.issues };
});

app.get("/v1/recipes", async (req) => {
  const auth = requireRole(req.auth, ["admin", "developer", "readonly"]);
  const registry = await loadRecipeRegistry(auth.projectId);
  return { items: registry };
});

app.post("/v1/recipes", async (req, reply) => {
  const auth = requireRole(req.auth, ["admin"]);
  const parsed = RecipeSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply
      .status(400)
      .send(
        createErrorResponse(
          "VALIDATION_ERROR",
          "Invalid recipe payload",
          req.id,
          parsed.error.flatten()
        )
      );
  }

  await db
    .insert(recipes)
    .values({
      id: parsed.data.id,
      projectId: auth.projectId,
      name: parsed.data.name,
      version: parsed.data.version,
      description: parsed.data.description ?? null,
      match: parsed.data.match,
      requiresBrowser: parsed.data.requiresBrowser,
      steps: parsed.data.steps ?? null,
      extraction: parsed.data.extraction ?? null,
      throttling: parsed.data.throttling ?? null,
      pluginPath: parsed.data.pluginPath ?? null,
      source: "user",
    })
    .onConflictDoUpdate({
      target: recipes.id,
      set: {
        name: parsed.data.name,
        version: parsed.data.version,
        description: parsed.data.description ?? null,
        match: parsed.data.match,
        requiresBrowser: parsed.data.requiresBrowser,
        steps: parsed.data.steps ?? null,
        extraction: parsed.data.extraction ?? null,
        throttling: parsed.data.throttling ?? null,
        pluginPath: parsed.data.pluginPath ?? null,
        source: "user",
      },
    });

  await writeAuditLog({
    auth,
    action: "recipe.upsert",
    resourceType: "recipe",
    resourceId: parsed.data.id,
    requestId: req.id,
    ip: req.ip,
    details: { version: parsed.data.version },
  });

  return reply.status(201).send({ id: parsed.data.id });
});

// ── Admin: List tokens ──────────────────────────────────────────────
app.get("/v1/admin/tokens", async (req) => {
  const auth = requireRole(req.auth, ["admin"]);
  const rows = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      role: apiTokens.role,
      projectId: apiTokens.projectId,
      createdAt: apiTokens.createdAt,
      expiresAt: apiTokens.expiresAt,
      revokedAt: apiTokens.revokedAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.projectId, auth.projectId))
    .orderBy(desc(apiTokens.createdAt));
  return { items: rows };
});

// ── Admin: Get token details ────────────────────────────────────────
app.get("/v1/admin/tokens/:tokenId", async (req, reply) => {
  const auth = requireRole(req.auth, ["admin"]);
  const { tokenId } = req.params as { tokenId: string };
  const rows = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      role: apiTokens.role,
      projectId: apiTokens.projectId,
      createdAt: apiTokens.createdAt,
      expiresAt: apiTokens.expiresAt,
      revokedAt: apiTokens.revokedAt,
    })
    .from(apiTokens)
    .where(
      and(eq(apiTokens.id, tokenId), eq(apiTokens.projectId, auth.projectId))
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return reply
      .status(404)
      .send(createErrorResponse("NOT_FOUND", "Token not found", req.id));
  }
  return row;
});

// ── Admin: Revoke token ─────────────────────────────────────────────
app.delete("/v1/admin/tokens/:tokenId", async (req, reply) => {
  const auth = requireRole(req.auth, ["admin"]);
  const { tokenId } = req.params as { tokenId: string };
  const updated = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiTokens.id, tokenId),
        eq(apiTokens.projectId, auth.projectId),
        isNull(apiTokens.revokedAt)
      )
    )
    .returning({ id: apiTokens.id });
  if (updated.length === 0) {
    return reply
      .status(404)
      .send(
        createErrorResponse(
          "NOT_FOUND",
          "Token not found or already revoked",
          req.id
        )
      );
  }
  await writeAuditLog({
    auth,
    action: "admin.token.revoke",
    resourceType: "token",
    resourceId: tokenId,
    requestId: req.id,
    ip: req.ip,
  });
  return { id: tokenId, revoked: true };
});

// ── Admin: Update token (name/role) ─────────────────────────────────
app.patch("/v1/admin/tokens/:tokenId", async (req, reply) => {
  const auth = requireRole(req.auth, ["admin"]);
  const { tokenId } = req.params as { tokenId: string };
  const body = req.body as Record<string, unknown> | undefined;
  const name = body && typeof body.name === "string" ? body.name : undefined;
  const role =
    body && typeof body.role === "string" && ["admin", "developer", "readonly"].includes(body.role)
      ? (body.role as "admin" | "developer" | "readonly")
      : undefined;
  const expiresAtRaw = body && typeof body.expiresAt === "string" ? body.expiresAt : undefined;
  if (!name && !role && !expiresAtRaw) {
    return reply
      .status(400)
      .send(
        createErrorResponse(
          "VALIDATION_ERROR",
          "Provide at least one of: name, role, expiresAt",
          req.id
        )
      );
  }
  const setFields: Record<string, unknown> = {};
  if (name) setFields.name = name;
  if (role) setFields.role = role;
  if (expiresAtRaw) setFields.expiresAt = new Date(expiresAtRaw);
  const updated = await db
    .update(apiTokens)
    .set(setFields)
    .where(
      and(
        eq(apiTokens.id, tokenId),
        eq(apiTokens.projectId, auth.projectId),
        isNull(apiTokens.revokedAt)
      )
    )
    .returning({
      id: apiTokens.id,
      name: apiTokens.name,
      role: apiTokens.role,
      expiresAt: apiTokens.expiresAt,
    });
  if (updated.length === 0) {
    return reply
      .status(404)
      .send(createErrorResponse("NOT_FOUND", "Token not found", req.id));
  }
  await writeAuditLog({
    auth,
    action: "admin.token.update",
    resourceType: "token",
    resourceId: tokenId,
    requestId: req.id,
    ip: req.ip,
    details: { name, role, expiresAt: expiresAtRaw },
  });
  return updated[0];
});

// ── Admin: Rotate token ─────────────────────────────────────────────
app.post("/v1/admin/tokens/:tokenId/rotate", async (req, reply) => {
  const auth = requireRole(req.auth, ["admin"]);
  const { tokenId } = req.params as { tokenId: string };

  // Verify the token belongs to this project and is active
  const existing = await db
    .select({ id: apiTokens.id, name: apiTokens.name, role: apiTokens.role })
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.id, tokenId),
        eq(apiTokens.projectId, auth.projectId),
        isNull(apiTokens.revokedAt)
      )
    )
    .limit(1);
  if (existing.length === 0) {
    return reply
      .status(404)
      .send(createErrorResponse("NOT_FOUND", "Token not found", req.id));
  }

  // Revoke old token
  await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(eq(apiTokens.id, tokenId));

  // Create new token with same name/role
  const newTokenPlain = generateApiToken();
  const newHash = hashToken(newTokenPlain);
  const inserted = await db
    .insert(apiTokens)
    .values({
      projectId: auth.projectId,
      name: existing[0]!.name,
      role: existing[0]!.role,
      tokenHash: newHash,
    })
    .returning({ id: apiTokens.id });

  await writeAuditLog({
    auth,
    action: "admin.token.rotate",
    resourceType: "token",
    resourceId: tokenId,
    requestId: req.id,
    ip: req.ip,
    details: { newTokenId: inserted[0]?.id },
  });

  return reply.status(201).send({
    token: newTokenPlain,
    tokenId: inserted[0]?.id,
    previousTokenId: tokenId,
  });
});

// ── Admin: List projects ────────────────────────────────────────────
app.get("/v1/admin/projects", async (req) => {
  requireRole(req.auth, ["admin"]);
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .orderBy(desc(projects.createdAt));
  return { items: rows };
});

// ── Admin: Create project ───────────────────────────────────────────
app.post("/v1/admin/projects", async (req, reply) => {
  const auth = requireRole(req.auth, ["admin"]);
  const body = req.body as Record<string, unknown> | undefined;
  const id =
    body && typeof body.id === "string" && body.id.length > 0
      ? body.id
      : undefined;
  const name =
    body && typeof body.name === "string" && body.name.length > 0
      ? body.name
      : undefined;
  if (!id || !name) {
    return reply
      .status(400)
      .send(
        createErrorResponse(
          "VALIDATION_ERROR",
          "id and name are required",
          req.id
        )
      );
  }
  await db
    .insert(projects)
    .values({ id, name })
    .onConflictDoNothing({ target: projects.id });
  await writeAuditLog({
    auth,
    action: "admin.project.create",
    resourceType: "project",
    resourceId: id,
    requestId: req.id,
    ip: req.ip,
  });
  return reply.status(201).send({ id, name });
});

// ── Admin: Audit logs ───────────────────────────────────────────────
app.get("/v1/admin/audit-logs", async (req) => {
  const auth = requireRole(req.auth, ["admin"]);
  const query = req.query as Record<string, unknown>;
  const limit = Math.min(
    Number(query.limit ?? 50),
    200
  );
  const offset = Number(query.offset ?? 0);
  const action =
    typeof query.action === "string" ? query.action : undefined;

  const conditions = [eq(auditLogs.projectId, auth.projectId)];
  if (action) conditions.push(eq(auditLogs.action, action));

  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  return { items: rows, limit, offset };
});

// ── Admin: Get rate limits ──────────────────────────────────────────
app.get("/v1/admin/rate-limits", async (req) => {
  requireRole(req.auth, ["admin"]);
  const rows = await db.select().from(rateLimitConfig);
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.role] = row.rpm;
  }
  return { limits: result };
});

// ── Admin: Update rate limits ───────────────────────────────────────
app.put("/v1/admin/rate-limits", async (req, reply) => {
  const auth = requireRole(req.auth, ["admin"]);
  const body = req.body as Record<string, unknown> | undefined;
  const limits = body && typeof body.limits === "object" ? body.limits as Record<string, unknown> : undefined;
  if (!limits) {
    return reply
      .status(400)
      .send(
        createErrorResponse(
          "VALIDATION_ERROR",
          'Provide { "limits": { "admin": 500, "developer": 120, "readonly": 60 } }',
          req.id
        )
      );
  }
  const validRoles = ["admin", "developer", "readonly"];
  for (const [role, rpm] of Object.entries(limits)) {
    if (!validRoles.includes(role) || typeof rpm !== "number" || rpm < 1 || rpm > 10000) {
      continue;
    }
    await db
      .insert(rateLimitConfig)
      .values({ role: role as "admin" | "developer" | "readonly", rpm, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: rateLimitConfig.role,
        set: { rpm, updatedAt: new Date() },
      });
    // Update in-memory cache
    roleLimits[role] = rpm;
  }
  await writeAuditLog({
    auth,
    action: "admin.rate-limits.update",
    resourceType: "rate-limits",
    resourceId: "global",
    requestId: req.id,
    ip: req.ip,
    details: { limits },
  });
  return { limits: roleLimits };
});

// ── Admin: Dashboard stats ──────────────────────────────────────────
app.get("/v1/admin/stats", async (req) => {
  const auth = requireRole(req.auth, ["admin"]);
  const pid = auth.projectId;

  const [jobStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      queued: sql<number>`count(*) filter (where ${jobs.state} = 'queued')::int`,
      running: sql<number>`count(*) filter (where ${jobs.state} = 'running')::int`,
      succeeded: sql<number>`count(*) filter (where ${jobs.state} = 'succeeded')::int`,
      failed: sql<number>`count(*) filter (where ${jobs.state} = 'failed')::int`,
    })
    .from(jobs)
    .where(eq(jobs.projectId, pid));

  const [crawlStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      running: sql<number>`count(*) filter (where ${crawlRuns.state} = 'running')::int`,
    })
    .from(crawlRuns)
    .where(eq(crawlRuns.projectId, pid));

  const [tokenStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${apiTokens.revokedAt} is null)::int`,
    })
    .from(apiTokens)
    .where(eq(apiTokens.projectId, pid));

  const [artifactStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      totalBytes: sql<number>`coalesce(sum(${artifacts.byteSize}), 0)::bigint`,
    })
    .from(artifacts)
    .where(eq(artifacts.projectId, pid));

  return {
    jobs: jobStats,
    crawls: crawlStats,
    tokens: tokenStats,
    artifacts: artifactStats,
  };
});

// ── Admin: List jobs ────────────────────────────────────────────────
app.get("/v1/admin/jobs", async (req) => {
  const auth = requireRole(req.auth, ["admin"]);
  const query = req.query as Record<string, unknown>;
  const limit = Math.min(Number(query.limit ?? 50), 200);
  const offset = Number(query.offset ?? 0);
  const state = typeof query.state === "string" ? query.state : undefined;

  const conditions = [eq(jobs.projectId, auth.projectId)];
  if (state) conditions.push(eq(jobs.state, state as typeof jobs.state.enumValues[number]));

  const rows = await db
    .select({
      id: jobs.id,
      state: jobs.state,
      url: jobs.url,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
      errorMessage: jobs.errorMessage,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
    })
    .from(jobs)
    .where(and(...conditions))
    .orderBy(desc(jobs.createdAt))
    .limit(limit)
    .offset(offset);

  return { items: rows, limit, offset };
});

// ── Admin: List crawls ──────────────────────────────────────────────
app.get("/v1/admin/crawls", async (req) => {
  const auth = requireRole(req.auth, ["admin"]);
  const query = req.query as Record<string, unknown>;
  const limit = Math.min(Number(query.limit ?? 50), 200);
  const offset = Number(query.offset ?? 0);

  const rows = await db
    .select({
      id: crawlRuns.id,
      seed: crawlRuns.seed,
      state: crawlRuns.state,
      stats: crawlRuns.stats,
      errorMessage: crawlRuns.errorMessage,
      createdAt: crawlRuns.createdAt,
      updatedAt: crawlRuns.updatedAt,
    })
    .from(crawlRuns)
    .where(eq(crawlRuns.projectId, auth.projectId))
    .orderBy(desc(crawlRuns.createdAt))
    .limit(limit)
    .offset(offset);

  return { items: rows, limit, offset };
});

// Dashboard is served as a separate container — see docker/dashboard.Dockerfile

app.listen({ port: PORT, host: "0.0.0.0" });

// Graceful shutdown: close the shared Google Playwright browser
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await closeGoogleBrowser();
    await app.close();
    process.exit(0);
  });
}
