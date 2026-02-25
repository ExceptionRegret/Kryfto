# Stage 1: Build with Node 20 (stable for pnpm/tsup)
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install pnpm from GitHub releases (npm registry blocks pnpm with 403)
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    curl -fsSL https://get.pnpm.io/install.sh | ENV="$HOME/.bashrc" PNPM_VERSION=9.12.0 sh - && \
    ln -sf /root/.local/share/pnpm/pnpm /usr/local/bin/pnpm && \
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

# Install pnpm from GitHub releases (npm registry blocks pnpm with 403)
RUN curl -fsSL https://get.pnpm.io/install.sh | ENV="$HOME/.bashrc" PNPM_VERSION=9.12.0 sh - && \
    ln -sf /root/.local/share/pnpm/pnpm /usr/local/bin/pnpm

# Copy package files + lockfile and install production deps only
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --filter @kryfto/worker... --filter @kryfto/shared... --prod --frozen-lockfile

# Copy built dist from builder stage
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/recipes ./recipes

ENV NODE_OPTIONS="--use-openssl-ca"

CMD ["node", "apps/worker/dist/index.js"]