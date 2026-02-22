# ADR 0001: Runtime Stack Selection

## Status
Accepted

## Context
The runtime must support deterministic browser collection, queue-based orchestration, strict validation, and interfaces for IDE agents through OpenAPI and MCP.

## Decision
Use:
- TypeScript + Node 20+ with strict tsconfig
- Fastify for the API control plane
- BullMQ + Redis for queueing and retries
- Playwright for browser automation
- Postgres for durable runtime state
- MinIO/S3-compatible artifact store with local filesystem fallback

## Consequences
- Shared TypeScript schemas provide API/MCP/CLI contract consistency.
- Queue/worker architecture can scale horizontally.
- Browser automation remains self-hostable without paid browsing APIs.