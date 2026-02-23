import { describe, expect, it } from "vitest";

const baseUrl = (
  process.env.KRYFTO_BASE_URL ?? "http://localhost:8080"
).replace(/\/$/u, "");
const token = process.env.KRYFTO_API_TOKEN ?? process.env.API_TOKEN;

const maybeDescribe = token ? describe : describe.skip;

async function request(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

maybeDescribe("integration: collector runtime", () => {
  it("runs a collection job and verifies artifacts", async () => {
    const created = await request("/v1/jobs", {
      method: "POST",
      body: JSON.stringify({
        url: "https://example.com",
        options: {
          requiresBrowser: false,
        },
      }),
    });

    const jobId = created.jobId as string;
    expect(jobId).toBeTruthy();

    const started = Date.now();
    let state = "queued";
    while (Date.now() - started < 180000) {
      const status = await request(`/v1/jobs/${jobId}`);
      state = status.state;
      if (["succeeded", "failed", "cancelled", "expired"].includes(state)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    expect(state).toBe("succeeded");

    const artifacts = await request(`/v1/jobs/${jobId}/artifacts`);
    expect(Array.isArray(artifacts.items)).toBe(true);
    expect(artifacts.items.length).toBeGreaterThan(0);
  });
});
