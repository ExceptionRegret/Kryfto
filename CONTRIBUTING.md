# Contributing to Kryfto

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker + Docker Compose (for integration/E2E tests)

## Setup

```bash
cp .env.example .env
pnpm install
pnpm build
pnpm test
```

## Project Structure

```
apps/api/          — Fastify REST API control plane
apps/worker/       — BullMQ workers with Playwright browser fleet
packages/cli/      — Terminal management interface
packages/mcp-server/ — MCP server (42+ tools for AI agents)
packages/sdk-ts/   — TypeScript SDK client
packages/shared/   — Shared schemas, stealth utilities, search parsers
```

## Development Workflow

1. Fork and clone the repo.
2. Create a feature branch from `main`.
3. Make your changes — add/adjust tests alongside code changes.
4. Run the quality checks:

```bash
pnpm typecheck       # Strict mode, zero any
pnpm test:unit       # 268+ unit tests (vitest)
pnpm test:e2e        # End-to-end with Docker Compose
```

5. Add a changeset for user-visible changes:

```bash
pnpm changeset
```

6. Open a PR against `main`.

## Code Standards

- **TypeScript strict mode** with `exactOptionalPropertyTypes: true` — no `any` types allowed
- **Zod schemas** for all input validation (shared package)
- **Tests required** for new features — vitest for unit, Playwright for E2E
- Keep functions focused and files under ~500 lines when practical

## Security / Data Safety

- Do not log secrets, credentials, tokens, or session content.
- Keep SSRF protections and RBAC checks intact.
- Do not disable audit logs for mutating operations.
- All user-facing input must be validated via Zod schemas.

## Pull Request Checklist

- [ ] Tests added/updated
- [ ] `pnpm typecheck` passes clean
- [ ] `pnpm test:unit` passes (268+ tests)
- [ ] OpenAPI updated (`docs/openapi.yaml`) if API changed
- [ ] MCP mappings updated if REST behavior changed
- [ ] Changeset added for user-visible changes
- [ ] Compose stack still works end-to-end

## Reporting Issues

Please include:
- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS
- Relevant logs (redact any tokens/secrets)

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.
