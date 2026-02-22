# ADR 0002: Drizzle ORM + SQL Migrations

## Status
Accepted

## Context
The system needs production-grade Postgres persistence, strongly-typed access from TypeScript, and deterministic migration workflows for Docker and CI.

## Decision
- Use **Drizzle ORM** for schema-driven typed queries in the API.
- Use SQL migration files under `apps/api/migrations` executed by a startup migration runner.
- Keep worker read/write paths lightweight using parameterized SQL through `pg` while sharing schema conventions.

## Added Dependency Rationale
- `drizzle-orm`: typed Postgres schema/query support.
- `pg`: Postgres pooling and runtime SQL execution.
- `ioredis`: explicit Redis client for worker concurrency semaphores.
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`: S3/MinIO artifact reads and presigned URLs.
- `ipaddr.js`: SSRF private-range validation.
- `cheerio`: selector/schema extraction from HTML.
- `js-yaml`: recipe loading and CLI rule parsing.
- `minimatch`: crawl allow/deny matching.
- `@opentelemetry/api`: tracing span scaffolding.

## Consequences
- Migration state is explicit and reproducible.
- Typed API persistence reduces runtime contract drift.
- Worker remains resilient by using direct SQL with strict request validation.