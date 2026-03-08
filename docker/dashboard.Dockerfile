# Stage 1: Build
FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v9.12.0/pnpm-linux-x64" -o /usr/local/bin/pnpm && \
    chmod +x /usr/local/bin/pnpm && \
    rm -rf /var/lib/apt/lists/*

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @kryfto/dashboard build

# Stage 2: Serve with nginx
FROM nginx:alpine

COPY docker/dashboard-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/dashboard/dist /usr/share/nginx/html

EXPOSE 3001
