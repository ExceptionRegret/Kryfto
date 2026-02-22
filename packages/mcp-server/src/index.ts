import { CollectorClient } from '@kryfto/sdk-ts';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:8080';
const API_TOKEN = process.env.API_TOKEN ?? process.env.KRYFTO_API_TOKEN;
const client = new CollectorClient({ baseUrl: API_BASE_URL, token: API_TOKEN });

const browseArgs = z.object({
  url: z.string().url(),
  steps: z.array(z.any()).optional(),
  options: z
    .object({
      wait: z.boolean().optional(),
      timeoutMs: z.number().int().positive().optional(),
      pollMs: z.number().int().positive().optional(),
    })
    .optional(),
  recipeId: z.string().optional(),
});

const crawlArgs = z.object({
  seed: z.string().url(),
  rules: z.record(z.any()).optional(),
  recipeId: z.string().optional(),
});

const extractArgs = z.object({
  input: z.string().optional(),
  artifactId: z.string().optional(),
  selectors: z.record(z.string()).optional(),
  schema: z.record(z.any()).optional(),
  plugin: z.string().optional(),
  mode: z.enum(['selectors', 'schema', 'plugin']),
});

const searchArgs = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional(),
  engine: z.enum(['duckduckgo', 'bing', 'yahoo', 'google', 'brave']).optional(),
  safeSearch: z.enum(['strict', 'moderate', 'off']).optional(),
  locale: z.string().optional(),
});

const getJobArgs = z.object({ jobId: z.string() });
const listArtifactsArgs = z.object({ jobId: z.string() });
const fetchArtifactArgs = z.object({ artifactId: z.string(), downloadToken: z.string().optional() });

function asText(data: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

async function main(): Promise<void> {
  const server = new Server(
    {
      name: 'collector-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'browse',
        description: 'Create a browser collection job and optionally wait for completion.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            recipeId: { type: 'string' },
            steps: { type: 'array' },
            options: { type: 'object' },
          },
          required: ['url'],
        },
      },
      {
        name: 'crawl',
        description: 'Start crawl orchestration from a seed URL.',
        inputSchema: {
          type: 'object',
          properties: {
            seed: { type: 'string' },
            rules: { type: 'object' },
            recipeId: { type: 'string' },
          },
          required: ['seed'],
        },
      },
      {
        name: 'extract',
        description: 'Run extract against input text/html or artifact id.',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string' },
            artifactId: { type: 'string' },
            selectors: { type: 'object' },
            schema: { type: 'object' },
            plugin: { type: 'string' },
            mode: { type: 'string', enum: ['selectors', 'schema', 'plugin'] },
          },
          required: ['mode'],
        },
      },
      {
        name: 'search',
        description: 'Run a web search and return normalized results.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' },
            engine: { type: 'string', enum: ['duckduckgo', 'bing', 'yahoo', 'google', 'brave'] },
            safeSearch: { type: 'string', enum: ['strict', 'moderate', 'off'] },
            locale: { type: 'string' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_job',
        description: 'Get job status and summary.',
        inputSchema: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
          },
          required: ['jobId'],
        },
      },
      {
        name: 'list_artifacts',
        description: 'List artifacts for a job.',
        inputSchema: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
          },
          required: ['jobId'],
        },
      },
      {
        name: 'fetch_artifact',
        description: 'Fetch artifact bytes (base64 encoded).',
        inputSchema: {
          type: 'object',
          properties: {
            artifactId: { type: 'string' },
            downloadToken: { type: 'string' },
          },
          required: ['artifactId'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};

    if (name === 'browse') {
      const parsed = browseArgs.parse(args);
      const job = await client.createJob(
        {
          url: parsed.url,
          ...(parsed.recipeId ? { recipeId: parsed.recipeId } : {}),
          ...(parsed.steps ? { steps: parsed.steps as any } : {}),
        },
        {
          wait: parsed.options?.wait,
          timeoutMs: parsed.options?.timeoutMs,
          pollMs: parsed.options?.pollMs,
        }
      );
      return asText(job);
    }

    if (name === 'crawl') {
      const parsed = crawlArgs.parse(args);
      const crawl = await client.crawl({
        seed: parsed.seed,
        ...(parsed.rules ? { rules: parsed.rules as any } : {}),
        ...(parsed.recipeId ? { recipeId: parsed.recipeId } : {}),
      } as any);
      return asText(crawl);
    }

    if (name === 'extract') {
      const parsed = extractArgs.parse(args);
      const extraction = await client.extract({
        mode: parsed.mode,
        ...(parsed.input ? { html: parsed.input } : {}),
        ...(parsed.artifactId ? { artifactId: parsed.artifactId } : {}),
        ...(parsed.selectors ? { selectors: parsed.selectors } : {}),
        ...(parsed.schema ? { jsonSchema: parsed.schema } : {}),
        ...(parsed.plugin ? { plugin: parsed.plugin } : {}),
      } as any);
      return asText(extraction);
    }

    if (name === 'search') {
      const parsed = searchArgs.parse(args);
      const result = await client.search({
        query: parsed.query,
        ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
        ...(parsed.engine ? { engine: parsed.engine } : {}),
        ...(parsed.safeSearch ? { safeSearch: parsed.safeSearch } : {}),
        ...(parsed.locale ? { locale: parsed.locale } : {}),
      });
      return asText(result);
    }

    if (name === 'get_job') {
      const parsed = getJobArgs.parse(args);
      const result = await client.getJob(parsed.jobId);
      return asText(result);
    }

    if (name === 'list_artifacts') {
      const parsed = listArtifactsArgs.parse(args);
      const result = await client.listArtifacts(parsed.jobId);
      return asText(result);
    }

    if (name === 'fetch_artifact') {
      const parsed = fetchArtifactArgs.parse(args);
      const bytes = await client.getArtifact(parsed.artifactId, parsed.downloadToken ? { downloadToken: parsed.downloadToken } : undefined);
      return asText({ artifactId: parsed.artifactId, base64: bytes.toString('base64') });
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
