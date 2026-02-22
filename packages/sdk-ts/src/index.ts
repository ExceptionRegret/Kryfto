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
} from '@kryfto/shared';

export type CollectorClientOptions = {
  baseUrl: string;
  token?: string;
  requestId?: string;
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  responseType?: 'json' | 'buffer' | 'text';
};

export class CollectorClient {
  private readonly baseUrl: string;
  private readonly token?: string | undefined;
  private readonly requestId?: string | undefined;

  constructor(options: CollectorClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/u, '');
    this.token = options.token;
    this.requestId = options.requestId;
  }

  private baseHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(this.requestId ? { 'X-Request-Id': this.requestId } : {}),
      ...(extra ?? {}),
    };
  }

  private async request<T>(pathname: string, options?: RequestOptions): Promise<T> {
    const method = options?.method ?? 'GET';
    const headers = this.baseHeaders({ ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...(options?.headers ?? {}) });

    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers,
      body: (options?.body !== undefined ? JSON.stringify(options.body) : undefined) as any,
    });

    if (!response.ok) {
      let payload: unknown = undefined;
      try {
        payload = await response.json();
      } catch {
        payload = await response.text().catch(() => '');
      }

      const fallback = createErrorResponse('HTTP_ERROR', `Request failed with ${response.status}`, this.requestId ?? 'unknown', payload);
      const parsed =
        payload && typeof payload === 'object' && 'error' in (payload as Record<string, unknown>) ? (payload as { error: unknown }) : fallback;
      throw new Error(JSON.stringify(parsed));
    }

    if (options?.responseType === 'buffer') {
      return (Buffer.from(await response.arrayBuffer()) as unknown) as T;
    }

    if (options?.responseType === 'text') {
      return (await response.text()) as T;
    }

    return (await response.json()) as T;
  }

  async health(): Promise<{ ok: boolean }> {
    return this.request('/v1/healthz');
  }

  async ready(): Promise<{ ok: boolean }> {
    return this.request('/v1/readyz');
  }

  async createJob(input: JobCreateRequest, opts?: { idempotencyKey?: string; wait?: boolean; pollMs?: number; timeoutMs?: number }): Promise<any> {
    const parsed = JobCreateRequestSchema.parse(input);
    const bodyArgs: Record<string, unknown> = {
      method: 'POST',
      body: parsed,
    };
    if (opts?.idempotencyKey) {
      bodyArgs.headers = { 'Idempotency-Key': opts.idempotencyKey };
    }

    const response = await this.request<{ jobId: string; state: string; requestId: string; idempotencyKey?: string }>('/v1/jobs', bodyArgs);

    if (!opts?.wait) {
      return response;
    }

    return this.waitForJob(response.jobId, { pollMs: opts.pollMs, timeoutMs: opts.timeoutMs } as any);
  }

  async getJob(jobId: string): Promise<any> {
    return this.request(`/v1/jobs/${jobId}`);
  }

  async waitForJob(jobId: string, opts?: { pollMs?: number; timeoutMs?: number }): Promise<any> {
    const pollMs = opts?.pollMs ?? 1000;
    const timeoutMs = opts?.timeoutMs ?? 300_000;
    const started = Date.now();

    while (true) {
      const current = await this.getJob(jobId);
      if (['succeeded', 'failed', 'cancelled', 'expired'].includes(current.state)) {
        return current;
      }

      if (Date.now() - started > timeoutMs) {
        throw new Error(`Timed out waiting for job ${jobId}`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  async cancelJob(jobId: string): Promise<any> {
    return this.request(`/v1/jobs/${jobId}/cancel`, { method: 'POST' });
  }

  async getJobLogs(jobId: string): Promise<string> {
    return this.request(`/v1/jobs/${jobId}/logs`, { responseType: 'text' });
  }

  async listArtifacts(jobId: string): Promise<{ items: any[] }> {
    return this.request(`/v1/jobs/${jobId}/artifacts`);
  }

  async getArtifact(artifactId: string, opts?: { downloadToken?: string }): Promise<Buffer> {
    const query = opts?.downloadToken ? `?downloadToken=${encodeURIComponent(opts.downloadToken)}` : '';
    return this.request(`/v1/artifacts/${artifactId}${query}`, { responseType: 'buffer' });
  }

  async extract(input: ExtractRequest): Promise<{ data: unknown; mode: string }> {
    const parsed = ExtractRequestSchema.parse(input);
    return this.request('/v1/extract', { method: 'POST', body: parsed });
  }

  async crawl(input: CrawlRequest): Promise<{ crawlId: string; state: string; requestId: string }> {
    const parsed = CrawlRequestSchema.parse(input);
    return this.request('/v1/crawl', { method: 'POST', body: parsed });
  }

  async search(input: SearchRequest): Promise<{
    query: string;
    limit: number;
    engine: string;
    safeSearch?: string;
    locale?: string;
    results: SearchResult[];
    requestId: string;
  }> {
    const parsed = SearchRequestSchema.parse(input);
    return this.request('/v1/search', { method: 'POST', body: parsed });
  }

  async getCrawl(crawlId: string): Promise<any> {
    return this.request(`/v1/crawl/${crawlId}`);
  }

  async validateRecipe(input: Recipe): Promise<{ valid: boolean; recipe?: Recipe; issues?: unknown[] }> {
    const parsed = RecipeSchema.parse(input);
    return this.request('/v1/recipes/validate', { method: 'POST', body: { recipe: parsed } });
  }

  async listRecipes(): Promise<{ items: Recipe[] }> {
    return this.request('/v1/recipes');
  }

  async uploadRecipe(input: Recipe): Promise<{ id: string }> {
    const parsed = RecipeSchema.parse(input);
    return this.request('/v1/recipes', { method: 'POST', body: parsed });
  }
}

export type { CrawlRequest, ExtractRequest, JobCreateRequest, Recipe, SearchRequest, SearchResult };
