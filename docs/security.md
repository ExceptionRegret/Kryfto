# Security

## Auth and RBAC

- API key auth: `Authorization: Bearer <token>`
- Roles: `admin`, `developer`, `readonly`
- Tokens are hashed (`sha256`) at rest.
- Tokens are project-scoped; job/crawl/artifact access is project-scoped.

## Token Expiration

- Tokens can have an optional `expiresAt` timestamp.
- Expired tokens are rejected during `resolveAuth()` before any route handler executes.
- Token expiration can be set at creation or updated via `PATCH /v1/admin/tokens/:tokenId`.

## Rate Limiting

- Fastify rate limit per token+IP key.
- **Per-role defaults**: admin (500 RPM), developer (120 RPM), readonly (60 RPM).
- Per-role limits stored in `rate_limit_config` database table, manageable via `GET/PUT /v1/admin/rate-limits`.
- Global fallback configurable via `KRYFTO_RATE_LIMIT_RPM`.

## SSRF Protection

- HTTP/HTTPS only.
- Private/internal IP ranges blocked by default (`KRYFTO_SSRF_BLOCK_PRIVATE_RANGES=true`).
- Optional host allowlist via `KRYFTO_ALLOWED_HOSTS`.
- URL checks executed in both API validation and worker runtime.

## Robots and Crawl Politeness

- `respectRobotsTxt` defaults `true`.
- Crawl requests support allow/deny, depth/page caps, same-domain control, and politeness delay.

## Secret Handling

- Structured logs are redacted for auth and secret-like fields.
- Step input with `secret: true` is masked in persisted step logs.
- Browser profile cookies are encrypted at rest (`KRYFTO_PROFILE_ENCRYPTION_KEY`).

## Artifact Access Control

- Artifact downloads require auth or valid short-lived download token.
- Access is audit logged.
- S3 presigned URL support is available when using MinIO/S3 backend.

## Audit Log Events

Audit records are written for:

- job create/cancel/state transitions
- artifact download
- recipe upload/validation
- token administration actions
- crawl create/completion/failure

## Network/Egress Notes

- Restrict outbound egress at infrastructure level to approved targets.
- Keep MinIO/DB/Redis private to the Docker network in production.
- Rotate API tokens and encryption keys regularly.

## Docker Hardening Notes

- Run containers with read-only root filesystems where feasible and explicit writable mounts for `/tmp` and artifact paths.
- Apply CPU/memory limits per service in production orchestrators (Compose examples can be added under `deploy.resources`).
- Keep Compose `.env` values out of source control.
- Use non-default credentials for Postgres, MinIO, and API bootstrap token before first production start.
