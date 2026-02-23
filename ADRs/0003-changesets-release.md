# ADR 0003: Changesets for OSS Releases

## Status

Accepted

## Context

The repository is an OSS multi-package workspace and requires repeatable release metadata.

## Decision

Use **Changesets** for versioning and release note generation.

## Consequences

- Contributors can add changesets per PR.
- Version bumps remain package-aware in the pnpm workspace.
