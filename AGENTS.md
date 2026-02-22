# Agent Instructions (Codex / Claude Code / etc.)

This repository is **NOT an MVP**. Any automated changes must preserve **production-grade** standards:

- Must run end-to-end via **Docker Compose**.
- Must keep **OpenAPI + MCP** interfaces in sync.
- Must include **auth + RBAC**, **rate limiting**, **SSRF protections**, **audit logs**, **observability**.
- Must include **tests** (unit + integration/e2e) and keep CI green.
- Must never log secrets; mask sensitive fields.

If you add dependencies, record the rationale in `ADRs/`.
