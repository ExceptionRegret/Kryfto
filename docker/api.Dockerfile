# Stage 1: Build
FROM node:20-bookworm-slim AS builder

WORKDIR /app
RUN npm install -g pnpm@9 || curl -fsSL https://get.pnpm.io/install.sh | ENV="$HOME/.bashrc" PNPM_VERSION=9.12.0 sh - && ln -sf $HOME/.local/share/pnpm/pnpm /usr/local/bin/pnpm

# Copy the entire working directory to ensure all configs and the lockfile are present
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @kryfto/shared build && pnpm --filter @kryfto/api build

# Stage 2: Runtime
FROM node:20-bookworm-slim

WORKDIR /app
RUN npm install -g pnpm@9 || curl -fsSL https://get.pnpm.io/install.sh | ENV="$HOME/.bashrc" PNPM_VERSION=9.12.0 sh - && ln -sf $HOME/.local/share/pnpm/pnpm /usr/local/bin/pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --filter @kryfto/api... --filter @kryfto/shared... --prod --frozen-lockfile

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/migrations ./apps/api/migrations
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/recipes ./recipes

EXPOSE 8080

CMD ["node", "apps/api/dist/index.js"]