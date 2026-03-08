# Deploy And Use (Docker)

This runbook is for local or server deployment with Docker Compose.

## 1) Configure

```bash
cp .env.example .env
```

Set at least:

- `KRYFTO_API_TOKEN` (strong token)
- `KRYFTO_BOOTSTRAP_ADMIN_TOKEN` (usually same initial value as above)
- `POSTGRES_PASSWORD`

## 2) Start Runtime

```bash
docker compose up -d --build
```

Check:

```bash
curl http://localhost:8080/v1/healthz
curl http://localhost:8080/v1/readyz
```

The **Admin Dashboard** is available at `http://localhost:3001/dashboard/`. Log in with your admin API token to manage tokens, projects, jobs, crawls, audit logs, and per-role rate limits. The dashboard port is configurable via `KRYFTO_DASHBOARD_PORT` (default: 3001).

## 3) Auth Header

```bash
export KRYFTO_API_TOKEN=dev_admin_token_change_me
export AUTH_HEADER="Authorization: Bearer $KRYFTO_API_TOKEN"
```

## 4) Run Search (No External API Keys Required)

All supported engines work without external API keys:

- `duckduckgo`
- `bing`
- `yahoo`
- `google`
- `brave`

Example:

```bash
curl -X POST http://localhost:8080/v1/search \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{
    "query":"playwright tutorial",
    "engine":"google",
    "limit":5,
    "safeSearch":"moderate",
    "locale":"us-en"
  }'
```

You can switch `engine` to `duckduckgo`, `bing`, `yahoo`, `google`, or `brave`.

Quick smoke test for each engine:

```bash
curl -X POST http://localhost:8080/v1/search -H "$AUTH_HEADER" -H "Content-Type: application/json" -d '{"query":"example domain","engine":"duckduckgo","limit":3}'
curl -X POST http://localhost:8080/v1/search -H "$AUTH_HEADER" -H "Content-Type: application/json" -d '{"query":"example domain","engine":"bing","limit":3}'
curl -X POST http://localhost:8080/v1/search -H "$AUTH_HEADER" -H "Content-Type: application/json" -d '{"query":"example domain","engine":"yahoo","limit":3}'
curl -X POST http://localhost:8080/v1/search -H "$AUTH_HEADER" -H "Content-Type: application/json" -d '{"query":"example domain","engine":"google","limit":3}'
curl -X POST http://localhost:8080/v1/search -H "$AUTH_HEADER" -H "Content-Type: application/json" -d '{"query":"example domain","engine":"brave","limit":3}'
```

Optional API acceleration (not required):

- `BING_SEARCH_API_KEY`
- `GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_CX`
- `BRAVE_SEARCH_API_KEY`

If set, the runtime uses provider APIs first and automatically falls back to HTML mode on failure.

## 5) Create A Browser Job

```bash
curl -X POST http://localhost:8080/v1/jobs \
  -H "$AUTH_HEADER" \
  -H "Idempotency-Key: demo-job-1" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

Then:

```bash
curl -H "$AUTH_HEADER" http://localhost:8080/v1/jobs/<jobId>
curl -N -H "$AUTH_HEADER" http://localhost:8080/v1/jobs/<jobId>/logs
curl -H "$AUTH_HEADER" http://localhost:8080/v1/jobs/<jobId>/artifacts
```

## 6) CLI Use

```bash
pnpm --filter @kryfto/cli build
API_BASE_URL=http://localhost:8080 API_TOKEN=$KRYFTO_API_TOKEN collector search --query "playwright docs" --engine brave --limit 5
```

## 7) MCP Use

```bash
pnpm --filter @kryfto/mcp-server build
API_BASE_URL=http://localhost:8080 API_TOKEN=$KRYFTO_API_TOKEN node packages/mcp-server/dist/index.js
```

MCP tool: `search(query, limit?, engine?, safeSearch?, locale?)`

---

## 8) VPS Deployment Guide (Ubuntu/Debian)

If you are deploying Kryfto to a fresh naked Linux VPS (e.g., DigitalOcean Droplet, AWS EC2, Hetzner, Vultr), follow these steps to get your runtime online securely.

### Step 1: Install Docker & Docker Compose

Connect to your VPS via SSH and run the official Docker installation script:

```bash
# Update packages
sudo apt-get update && sudo apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose plugin
sudo apt-get install docker-compose-plugin -y
```

### Step 2: Clone the Kryfto Repository

```bash
# Install git if necessary
sudo apt install git -y

# Clone your project (replace with your actual repo URL if private)
git clone https://github.com/your-org/kryfto.git
cd kryfto
```

### Step 3: Configure Environment Variables

You must generate a secure `.env` file containing your cryptographic secrets and tokens before starting the stack.

```bash
# We provide a script to securely generate all required tokens
npm run setup:env

# OR manually copy and edit:
# cp .env.example .env
# nano .env
```

_Note: Make sure to copy the `KRYFTO_API_TOKEN` that was generated in the `.env` file somewhere safe! You will need it to authenticate requests to your VPS._

### Step 4: Boot the Infrastructure

Kryfto uses Docker Compose to orchestrate the Node.js API, the background Headless Workers, Postgres, Redis, and MinIO storage.

```bash
# Build and start all containers in detached mode
sudo docker compose up -d --build
```

### Step 5: Verify Deployment

Check that the containers are healthy:

```bash
sudo docker compose ps
```

You should see all containers (API, dashboard, worker, postgres, redis, minio) with a status of `Up (healthy)`. The admin dashboard will be accessible at `http://your-vps-ip:3001/dashboard/`.

### Step 6: Security Recommendations

By default, the Kryfto API exposes port `8080` and the dashboard exposes port `3001` to the internet.

**For Production Use:**

1. **Firewall:** Restrict access to ports `8080` (API) and `3001` (dashboard) so that only trusted IP addresses can reach them.
   ```bash
   sudo ufw allow ssh
   sudo ufw allow from YOUR.IP.ADDRESS.HERE to any port 8080
   sudo ufw allow from YOUR.IP.ADDRESS.HERE to any port 3001
   sudo ufw enable
   ```
2. **Reverse Proxy (SSL):** If you intend to hit the API over the public web, it is highly recommended to install [Caddy](https://caddyserver.com/docs/install#debian-ubuntu-raspbian) or NGINX on your VPS to automatically provision a Let's Encrypt HTTPS certificate for your domain.
3. **MCP Access:** If you are using Kryfto strictly as an MCP server for your local AI, **do not expose port 8080** to the public. Keep the firewall closed and use the **SSH Tunneling** method described in `docs/mcp.md` to connect natively!
