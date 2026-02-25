/**
 * E2E Runner — creates a real job and waits for completion.
 * Requires: running API + Worker + Postgres + Redis.
 *
 * Env: COLLECTOR_BASE_URL, COLLECTOR_API_TOKEN / API_TOKEN
 */

const baseUrl = (
  process.env.COLLECTOR_BASE_URL ?? "http://localhost:8080"
).replace(/\/$/u, "");
const token = process.env.COLLECTOR_API_TOKEN ?? process.env.API_TOKEN;

if (!token) {
  console.error("COLLECTOR_API_TOKEN or API_TOKEN is required");
  process.exit(1);
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response.json();
}

// ── Wait for worker readiness ───────────────────────────────────────
// The API might be healthy but the worker might not be connected to
// BullMQ yet. We poll health until the worker is processing.
console.log("⏳ Checking API health...");
const healthStart = Date.now();
let apiReady = false;
for (let i = 0; i < 30; i++) {
  try {
    await request("/v1/healthz");
    apiReady = true;
    break;
  } catch {
    console.log(`  Waiting for API... (${i + 1}/30)`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
if (!apiReady) {
  console.error("❌ API never became healthy");
  process.exit(1);
}
console.log(`✅ API healthy in ${Date.now() - healthStart}ms`);

// Give worker a few seconds to connect to Redis/BullMQ after API health
console.log("⏳ Waiting 5s for worker queue connection...");
await new Promise((r) => setTimeout(r, 5000));

// ── Create job ──────────────────────────────────────────────────────
console.log("📝 Creating extraction job for https://example.com ...");
const created = await request("/v1/jobs", {
  method: "POST",
  body: JSON.stringify({
    url: "https://example.com",
    options: { requiresBrowser: false },
  }),
});

const jobId = created.jobId;
if (!jobId) {
  throw new Error("API did not return jobId");
}
console.log(`✅ Job created: ${jobId}`);

// ── Poll for completion ─────────────────────────────────────────────
// Timeout: 5 minutes (300s) — generous for CI cold starts
const TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 2000;
const started = Date.now();
let finalJob = null;
let lastState = "";

while (Date.now() - started < TIMEOUT_MS) {
  const status = await request(`/v1/jobs/${jobId}`);
  if (status.state !== lastState) {
    console.log(`  Job state: ${status.state} (${Math.round((Date.now() - started) / 1000)}s)`);
    lastState = status.state;
  }
  if (["succeeded", "failed", "cancelled", "expired"].includes(status.state)) {
    finalJob = status;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}

if (!finalJob) {
  console.error(`❌ Timed out after ${TIMEOUT_MS / 1000}s waiting for job completion`);
  console.error(`   Last known state: ${lastState}`);
  // Fetch logs for debugging
  try {
    const logs = await request(`/v1/jobs/${jobId}/logs`);
    console.error("   Job logs:", JSON.stringify(logs, null, 2));
  } catch { }
  throw new Error("Timed out waiting for job completion");
}

if (finalJob.state !== "succeeded") {
  console.error("❌ Job failed!", JSON.stringify(finalJob, null, 2));
  try {
    const logs = await request(`/v1/jobs/${jobId}/logs`);
    console.error("Logs:", JSON.stringify(logs, null, 2));
  } catch { }
  throw new Error(`Job failed with state=${finalJob.state}`);
}

// ── Verify artifacts ────────────────────────────────────────────────
const artifacts = await request(`/v1/jobs/${jobId}/artifacts`);
if (!Array.isArray(artifacts.items) || artifacts.items.length === 0) {
  throw new Error("Expected at least one artifact");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      jobId,
      state: finalJob.state,
      artifactCount: artifacts.items.length,
      durationMs: Date.now() - started,
    },
    null,
    2
  )
);
