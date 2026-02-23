const baseUrl = (process.env.COLLECTOR_BASE_URL ?? 'http://localhost:8080').replace(/\/$/u, '');
const token = process.env.COLLECTOR_API_TOKEN ?? process.env.API_TOKEN;

if (!token) {
  console.error('COLLECTOR_API_TOKEN or API_TOKEN is required');
  process.exit(1);
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response.json();
}

const created = await request('/v1/jobs', {
  method: 'POST',
  body: JSON.stringify({
    url: 'https://example.com',
    options: { requiresBrowser: false },
  }),
});

const jobId = created.jobId;
if (!jobId) {
  throw new Error('API did not return jobId');
}

const started = Date.now();
let finalJob = null;
while (Date.now() - started < 180000) {
  const status = await request(`/v1/jobs/${jobId}`);
  if (['succeeded', 'failed', 'cancelled', 'expired'].includes(status.state)) {
    finalJob = status;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

if (!finalJob) {
  throw new Error('Timed out waiting for job completion');
}

if (finalJob.state !== 'succeeded') {
  console.error("Job failed!", JSON.stringify(finalJob, null, 2));

  try {
    const logs = await request(`/v1/jobs/${jobId}/logs`);
    console.error("Logs:", logs);
  } catch (e) { }

  throw new Error(`Job failed with state=${finalJob.state}`);
}

const artifacts = await request(`/v1/jobs/${jobId}/artifacts`);
if (!Array.isArray(artifacts.items) || artifacts.items.length === 0) {
  throw new Error('Expected at least one artifact');
}

console.log(JSON.stringify({ ok: true, jobId, artifactCount: artifacts.items.length }, null, 2));