const BASE = "/v1";

let token = localStorage.getItem("kryfto_token") ?? "";

export function setToken(t: string) {
  token = t;
  localStorage.setItem("kryfto_token", t);
}

export function getToken() {
  return token;
}

export function clearToken() {
  token = "";
  localStorage.removeItem("kryfto_token");
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  const init: RequestInit = { method, headers };
  if (body) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, init);
  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Health
  health: () => fetch(`${BASE}/healthz`).then((r) => r.json()),
  ready: () => fetch(`${BASE}/readyz`).then((r) => r.json()),

  // Stats
  stats: () =>
    req<{
      jobs: {
        total: number;
        queued: number;
        running: number;
        succeeded: number;
        failed: number;
      };
      crawls: { total: number; running: number };
      tokens: { total: number; active: number };
      artifacts: { total: number; totalBytes: number };
    }>("GET", "/admin/stats"),

  // Tokens
  listTokens: () => req<{ items: Token[] }>("GET", "/admin/tokens"),
  getToken: (id: string) => req<Token>("GET", `/admin/tokens/${id}`),
  createToken: (data: { name: string; role: string; projectId: string }) =>
    req<{ token: string; tokenId: string }>("POST", "/admin/tokens", data),
  revokeToken: (id: string) =>
    req<{ id: string; revoked: boolean }>("DELETE", `/admin/tokens/${id}`),
  updateToken: (
    id: string,
    data: { name?: string; role?: string; expiresAt?: string }
  ) => req<Token>("PATCH", `/admin/tokens/${id}`, data),
  rotateToken: (id: string) =>
    req<{ token: string; tokenId: string; previousTokenId: string }>(
      "POST",
      `/admin/tokens/${id}/rotate`
    ),

  // Projects
  listProjects: () => req<{ items: Project[] }>("GET", "/admin/projects"),
  createProject: (data: { id: string; name: string }) =>
    req<{ id: string; name: string }>("POST", "/admin/projects", data),

  // Audit Logs
  auditLogs: (params?: {
    limit?: number;
    offset?: number;
    action?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    if (params?.action) qs.set("action", params.action);
    return req<{ items: AuditLog[]; limit: number; offset: number }>(
      "GET",
      `/admin/audit-logs?${qs.toString()}`
    );
  },

  // Rate Limits
  getRateLimits: () =>
    req<{ limits: Record<string, number> }>("GET", "/admin/rate-limits"),
  updateRateLimits: (limits: Record<string, number>) =>
    req<{ limits: Record<string, number> }>("PUT", "/admin/rate-limits", {
      limits,
    }),

  // Jobs
  listJobs: (params?: { limit?: number; offset?: number; state?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    if (params?.state) qs.set("state", params.state);
    return req<{ items: Job[]; limit: number; offset: number }>(
      "GET",
      `/admin/jobs?${qs.toString()}`
    );
  },

  // Job actions (existing endpoints)
  cancelJob: (jobId: string) =>
    req<{ jobId: string; state: string }>("POST", `/jobs/${jobId}/cancel`),

  // Crawls
  listCrawls: (params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    return req<{ items: Crawl[]; limit: number; offset: number }>(
      "GET",
      `/admin/crawls?${qs.toString()}`
    );
  },
};

export interface Token {
  id: string;
  name: string;
  role: string;
  projectId: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface AuditLog {
  id: number;
  projectId: string;
  tokenId: string | null;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string;
  ipAddress: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface Job {
  id: string;
  state: string;
  url: string;
  attempts: number;
  maxAttempts: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Crawl {
  id: string;
  seed: string;
  state: string;
  stats: { queued: number; running: number; succeeded: number; failed: number };
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
