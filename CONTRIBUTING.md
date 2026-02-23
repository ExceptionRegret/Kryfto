# Contributing

Thanks for contributing.

## Prerequisites

- Node 20+
- pnpm 9+
- Docker + Docker Compose

## Setup

```bash
cp .env.example .env
pnpm install
pnpm build
pnpm test
```

## Development Workflow

1. Create a branch.
2. Add/adjust tests with code changes.
3. Keep OpenAPI and MCP behavior aligned.
4. Run:

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

5. Add a changeset for user-visible changes:

```bash
pnpm changeset
```

## Security / Data Safety

- Do not log secrets, credentials, tokens, or session content.
- Keep SSRF protections and RBAC checks intact.
- Do not disable audit logs for mutating operations.

## Pull Request Checklist

- [ ] Tests added/updated
- [ ] OpenAPI updated (`docs/openapi.yaml`) if API changed
- [ ] MCP mappings updated if REST behavior changed
- [ ] ADR added if major dependencies/architecture changed
- [ ] Compose stack still works end-to-end
