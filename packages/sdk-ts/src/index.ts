import {
  CrawlRequestSchema,
  ExtractRequestSchema,
  JobCreateRequestSchema,
  RecipeSchema,
  SearchRequestSchema,
  createErrorResponse,
  type CrawlRequest,
  type ExtractRequest,
  type JobCreateRequest,
  type Recipe,
  type SearchRequest,
  type SearchResult,
} from "@kryfto/shared";

/** Input type for search — accepts optional fields that have Zod defaults */
type SearchInput = {
  query: string;
  limit?: number | undefined;
  engine?: "duckduckgo" | "bing" | "yahoo" | "google" | "brave" | undefined;
  safeSearch?: "strict" | "moderate" | "off" | undefined;
  locale?: string | undefined;
  topic?: "general" | "news" | "finance" | undefined;
  include_images?: boolean | undefined;
  include_image_descriptions?: boolean | undefined;
  privacy_mode?: "normal" | "zero_trace" | undefined;
  freshness_mode?: "always" | "preferred" | "fallback" | "never" | undefined;
  location?: string | undefined;
  proxy_profile?: string | undefined;
  country?: string | undefined;
  session_affinity?: boolean | undefined;
  rotation_strategy?: "per_request" | "sticky" | "random" | undefined;
};

/** Common shape returned by job-related endpoints */
export interface JobResponse {
  jobId: string;
  id?: string | undefined;
  state: string;
  requestId?: string | undefined;
  idempotencyKey?: string | undefined;
  [key: string]: unknown;
}

/** Shape returned by artifact listing */
export interface ArtifactItem {
  id?: string | undefined;
  artifactId?: string | undefined;
  contentType?: string | undefined;
  label?: string | undefined;
  [key: string]: unknown;
}

export type CollectorClientOptions = {
  baseUrl: string;
  token?: string | undefined;
  requestId?: string | undefined;
};

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  responseType?: "json" | "buffer" | "text";
};

export class CollectorClient {
  private readonly baseUrl: string;
  private readonly token?: string | undefined;
  private readonly requestId?: string | undefined;

  constructor(options: CollectorClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/u, "");
    this.token = options.token;
    this.requestId = options.requestId;
  }

  private baseHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(this.requestId ? { "X-Request-Id": this.requestId } : {}),
      ...(extra ?? {}),
    };
  }

  private async request<T>(
    pathname: string,
    options?: RequestOptions
  ): Promise<T> {
    const method = options?.method ?? "GET";
    const headers = this.baseHeaders({
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...(options?.headers ?? {}),
    });

    const init: RequestInit = { method, headers };
    if (options?.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(`${this.baseUrl}${pathname}`, init);

    if (!response.ok) {
      let payload: unknown = undefined;
      try {
        payload = await response.json();
      } catch {
        payload = await response.text().catch(() => "");
      }

      const fallback = createErrorResponse(
        "HTTP_ERROR",
        `Request failed with ${response.status}`,
        this.requestId ?? "unknown",
        payload
      );
      const parsed =
        payload &&
        typeof payload === "object" &&
        "error" in (payload as Record<string, unknown>)
          ? (payload as { error: unknown })
          : fallback;
      throw new Error(JSON.stringify(parsed));
    }

    if (options?.responseType === "buffer") {
      return Buffer.from(await response.arrayBuffer()) as unknown as T;
    }

    if (options?.responseType === "text") {
      return (await response.text()) as T;
    }

    return (await response.json()) as T;
  }

  async health(): Promise<{ ok: boolean }> {
    return this.request("/v1/healthz");
  }

  async ready(): Promise<{ ok: boolean }> {
    return this.request("/v1/readyz");
  }

  async createJob(
    input: JobCreateRequest | Record<string, unknown>,
    opts?: {
      idempotencyKey?: string | undefined;
      wait?: boolean | undefined;
      pollMs?: number | undefined;
      timeoutMs?: number | undefined;
    }
  ): Promise<JobResponse> {
    const parsed = JobCreateRequestSchema.parse(input);
    const bodyArgs: Record<string, unknown> = {
      method: "POST",
      body: parsed,
    };
    if (opts?.idempotencyKey) {
      bodyArgs.headers = { "Idempotency-Key": opts.idempotencyKey };
    }

    const response = await this.request<{
      jobId: string;
      state: string;
      requestId: string;
      idempotencyKey?: string;
    }>("/v1/jobs", bodyArgs);

    if (!opts?.wait) {
      return response;
    }

    return this.waitForJob(response.jobId, {
      pollMs: opts?.pollMs,
      timeoutMs: opts?.timeoutMs,
    });
  }

  async getJob(jobId: string): Promise<JobResponse> {
    return this.request(`/v1/jobs/${jobId}`);
  }

  async waitForJob(
    jobId: string,
    opts?: { pollMs?: number | undefined; timeoutMs?: number | undefined }
  ): Promise<JobResponse> {
    const pollMs = opts?.pollMs ?? 1000;
    const timeoutMs = opts?.timeoutMs ?? 300_000;
    const started = Date.now();

    while (true) {
      const current = await this.getJob(jobId);
      if (
        ["succeeded", "failed", "cancelled", "expired"].includes(current.state)
      ) {
        return current;
      }

      if (Date.now() - started > timeoutMs) {
        throw new Error(`Timed out waiting for job ${jobId}`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  async cancelJob(jobId: string): Promise<JobResponse> {
    return this.request(`/v1/jobs/${jobId}/cancel`, { method: "POST" });
  }

  async getJobLogs(jobId: string): Promise<string> {
    return this.request(`/v1/jobs/${jobId}/logs`, { responseType: "text" });
  }

  async listArtifacts(jobId: string): Promise<{ items: ArtifactItem[] }> {
    return this.request(`/v1/jobs/${jobId}/artifacts`);
  }

  async getArtifact(
    artifactId: string,
    opts?: { downloadToken?: string | undefined }
  ): Promise<Buffer> {
    const query = opts?.downloadToken
      ? `?downloadToken=${encodeURIComponent(opts.downloadToken)}`
      : "";
    return this.request(`/v1/artifacts/${artifactId}${query}`, {
      responseType: "buffer",
    });
  }

  async extract(
    input: ExtractRequest | Record<string, unknown>
  ): Promise<{ data: unknown; mode: string }> {
    const parsed = ExtractRequestSchema.parse(input);
    return this.request("/v1/extract", { method: "POST", body: parsed });
  }

  async crawl(
    input: CrawlRequest | Record<string, unknown>
  ): Promise<{ crawlId: string; state: string; requestId: string }> {
    const parsed = CrawlRequestSchema.parse(input);
    return this.request("/v1/crawl", { method: "POST", body: parsed });
  }

  async search(input: SearchInput): Promise<{
    query: string;
    limit: number;
    engine: string;
    safeSearch?: string;
    locale?: string;
    results: SearchResult[];
    requestId: string;
  }> {
    const parsed = SearchRequestSchema.parse(input);
    return this.request("/v1/search", { method: "POST", body: parsed });
  }

  async getCrawl(crawlId: string): Promise<Record<string, unknown>> {
    return this.request(`/v1/crawl/${crawlId}`);
  }

  async validateRecipe(
    input: Recipe
  ): Promise<{ valid: boolean; recipe?: Recipe; issues?: unknown[] }> {
    const parsed = RecipeSchema.parse(input);
    return this.request("/v1/recipes/validate", {
      method: "POST",
      body: { recipe: parsed },
    });
  }

  async listRecipes(): Promise<{ items: Recipe[] }> {
    return this.request("/v1/recipes");
  }

  async uploadRecipe(input: Recipe): Promise<{ id: string }> {
    const parsed = RecipeSchema.parse(input);
    return this.request("/v1/recipes", { method: "POST", body: parsed });
  }
}

export type {
  CrawlRequest,
  ExtractRequest,
  JobCreateRequest,
  Recipe,
  SearchRequest,
  SearchResult,
};
