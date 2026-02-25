# Stage 1: Build with Node 20 (stable for pnpm/tsup)
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Download pnpm standalone binary directly from GitHub releases (bypasses npm 403)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v9.12.0/pnpm-linux-x64" -o /usr/local/bin/pnpm && \
    chmod +x /usr/local/bin/pnpm && \
    rm -rf /var/lib/apt/lists/*

# Copy the entire working directory to ensure all configs and the lockfile are present
COPY . .

# Use frozen-lockfile to prevent picking up newly published broken versions of devDeps (e.g. tsup)
RUN pnpm install --frozen-lockfile

RUN pnpm --filter @kryfto/shared build && pnpm --filter @kryfto/worker build

# Stage 2: Runtime with Playwright browsers pre-installed
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

# Ensure latest CA certificates are installed for Node native fetch
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

# Download pnpm standalone binary directly from GitHub releases
RUN curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v9.12.0/pnpm-linux-x64" -o /usr/local/bin/pnpm && \
    chmod +x /usr/local/bin/pnpm

# Copy package files + lockfile and install production deps only
COPY .npmrc package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --filter @kryfto/worker... --filter @kryfto/shared... --prod --frozen-lockfile

# Copy built dist from builder stage
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/recipes ./recipes

ENV NODE_OPTIONS="--use-openssl-ca"

CMD ["node", "apps/worker/dist/index.js"]