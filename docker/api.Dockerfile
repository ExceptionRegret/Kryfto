# Stage 1: Build
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Download pnpm standalone binary directly from GitHub releases (bypasses npm 403)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v9.12.0/pnpm-linux-x64" -o /usr/local/bin/pnpm && \
    chmod +x /usr/local/bin/pnpm && \
    rm -rf /var/lib/apt/lists/*

# Copy the entire working directory to ensure all configs and the lockfile are present
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @kryfto/shared build && pnpm --filter @kryfto/api build

# Stage 2: Runtime
FROM node:20-bookworm-slim

WORKDIR /app

# Download pnpm standalone binary directly from GitHub releases
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v9.12.0/pnpm-linux-x64" -o /usr/local/bin/pnpm && \
    chmod +x /usr/local/bin/pnpm && \
    rm -rf /var/lib/apt/lists/*

COPY .npmrc package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --filter @kryfto/api... --filter @kryfto/shared... --prod --frozen-lockfile

# Install Playwright Chromium and its OS dependencies (needed for Google search)
RUN npx playwright install --with-deps chromium

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/migrations ./apps/api/migrations
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/recipes ./recipes

EXPOSE 8080

CMD ["node", "apps/api/dist/index.js"]