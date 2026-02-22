import { bigint, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['admin', 'developer', 'readonly']);
export const jobStateEnum = pgEnum('job_state', ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired']);
export const crawlStateEnum = pgEnum('crawl_state', ['queued', 'running', 'succeeded', 'failed', 'cancelled']);

export const projects = pgTable('projects', {
  id: varchar('id', { length: 255 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: varchar('project_id', { length: 255 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    role: roleEnum('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex('api_tokens_token_hash_unique').on(table.tokenHash),
    projectIdx: index('api_tokens_project_idx').on(table.projectId),
  })
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    projectId: varchar('project_id', { length: 255 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 128 }).notNull(),
    requestHash: text('request_hash').notNull(),
    jobId: uuid('job_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.key], name: 'idempotency_keys_pk' }),
  })
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey(),
    projectId: varchar('project_id', { length: 255 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    state: jobStateEnum('state').notNull().default('queued'),
    url: text('url').notNull(),
    requestJson: jsonb('request_json').notNull(),
    resultSummary: jsonb('result_summary'),
    errorMessage: text('error_message'),
    requestId: varchar('request_id', { length: 128 }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectStateIdx: index('jobs_project_state_idx').on(table.projectId, table.state),
    requestIdx: index('jobs_request_id_idx').on(table.requestId),
  })
);

export const jobLogs = pgTable(
  'job_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    projectId: varchar('project_id', { length: 255 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    level: varchar('level', { length: 16 }).notNull(),
    message: text('message').notNull(),
    meta: jsonb('meta').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    jobIdx: index('job_logs_job_idx').on(table.jobId),
  })
);

export const artifactBlobs = pgTable('artifact_blobs', {
  sha256: varchar('sha256', { length: 64 }).primaryKey(),
  storageKey: text('storage_key').notNull().unique(),
  contentType: varchar('content_type', { length: 128 }).notNull(),
  byteSize: integer('byte_size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    projectId: varchar('project_id', { length: 255 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 64 }).notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    blobSha256: varchar('blob_sha256', { length: 64 })
      .notNull()
      .references(() => artifactBlobs.sha256, { onDelete: 'restrict' }),
    byteSize: integer('byte_size').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectIdx: index('artifacts_project_idx').on(table.projectId),
    jobIdx: index('artifacts_job_idx').on(table.jobId),
  })
);

export const artifactDownloadTokens = pgTable(
  'artifact_download_tokens',
  {
    token: uuid('token').defaultRandom().primaryKey(),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    projectId: varchar('project_id', { length: 255 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    artifactIdx: index('artifact_download_tokens_artifact_idx').on(table.artifactId),
    projectIdx: index('artifact_download_tokens_project_idx').on(table.projectId),
  })
);

export const recipes = pgTable('recipes', {
  id: varchar('id', { length: 128 }).primaryKey(),
  projectId: varchar('project_id', { length: 255 }).references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  version: varchar('version', { length: 64 }).notNull(),
  description: text('description'),
  match: jsonb('match').notNull(),
  requiresBrowser: boolean('requires_browser').notNull().default(false),
  steps: jsonb('steps'),
  extraction: jsonb('extraction'),
  throttling: jsonb('throttling'),
  pluginPath: text('plugin_path'),
  source: varchar('source', { length: 32 }).notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const crawlRuns = pgTable(
  'crawl_runs',
  {
    id: uuid('id').primaryKey(),
    projectId: varchar('project_id', { length: 255 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    seed: text('seed').notNull(),
    state: crawlStateEnum('state').notNull().default('queued'),
    rules: jsonb('rules').notNull(),
    stats: jsonb('stats').notNull().default({ queued: 0, running: 0, succeeded: 0, failed: 0 }),
    requestId: varchar('request_id', { length: 128 }).notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectIdx: index('crawl_runs_project_idx').on(table.projectId),
  })
);

export const crawlNodes = pgTable(
  'crawl_nodes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    crawlId: uuid('crawl_id')
      .notNull()
      .references(() => crawlRuns.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    parentUrl: text('parent_url'),
    depth: integer('depth').notNull(),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 32 }).notNull().default('queued'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    crawlDepthIdx: index('crawl_nodes_crawl_depth_idx').on(table.crawlId, table.depth),
  })
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
    projectId: varchar('project_id', { length: 255 }).notNull(),
    tokenId: uuid('token_id'),
    actorRole: roleEnum('actor_role').notNull(),
    action: varchar('action', { length: 128 }).notNull(),
    resourceType: varchar('resource_type', { length: 64 }).notNull(),
    resourceId: text('resource_id').notNull(),
    requestId: varchar('request_id', { length: 128 }).notNull(),
    ipAddress: varchar('ip_address', { length: 64 }),
    details: jsonb('details').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    projectIdx: index('audit_logs_project_idx').on(table.projectId),
    actionIdx: index('audit_logs_action_idx').on(table.action),
  })
);

export const browserProfiles = pgTable('browser_profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: varchar('project_id', { length: 255 })
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  encryptedCookies: text('encrypted_cookies').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});