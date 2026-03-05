#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { load as parseYaml } from "js-yaml";
import { CollectorClient } from "@kryfto/sdk-ts";
import { RecipeSchema } from "@kryfto/shared";

function parseFile<T>(filePath: string): T {
  const absolute = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
  const raw = readFileSync(absolute, "utf8");
  if (filePath.endsWith(".json")) {
    return JSON.parse(raw) as T;
  }
  return parseYaml(raw) as T;
}

function baseClient(): CollectorClient {
  const token = process.env.API_TOKEN ?? process.env.KRYFTO_API_TOKEN;
  return new CollectorClient({
    baseUrl: process.env.API_BASE_URL ?? "http://localhost:8080",
    ...(token ? { token } : {}),
  });
}

async function streamLogs(
  baseUrl: string,
  token: string | undefined,
  jobId: string
): Promise<void> {
  const response = await fetch(
    `${baseUrl.replace(/\/$/u, "")}/v1/jobs/${jobId}/logs`,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: "text/event-stream",
      },
    }
  );

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`log stream failed: ${response.status} ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    process.stdout.write(decoder.decode(value));
  }
}

const program = new Command();
program
  .name("collector")
  .description("Self-hosted Browser Data Collection Runtime CLI")
  .version("1.0.0");

program
  .command("health")
  .description("Check API health")
  .action(async () => {
    const result = await baseClient().health();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

const jobs = program.command("jobs").description("Job operations");

jobs
  .command("create")
  .requiredOption("--url <url>", "Target URL")
  .option("--recipe <recipeId>", "Recipe id")
  .option("--wait", "Wait until completion", false)
  .option("--idempotency-key <key>", "Idempotency key")
  .action(async (options) => {
    const client = baseClient();
    const result = await client.createJob(
      {
        url: options.url,
        ...(options.recipe ? { recipeId: options.recipe } : {}),
      },
      {
        idempotencyKey: options.idempotencyKey,
        wait: Boolean(options.wait),
      }
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

jobs
  .command("status")
  .argument("<id>", "Job ID")
  .action(async (id: string) => {
    const result = await baseClient().getJob(id);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

jobs
  .command("logs")
  .argument("<id>", "Job ID")
  .option("--follow", "Follow streaming logs", false)
  .action(async (id: string, options) => {
    const client = baseClient();
    if (options.follow) {
      await streamLogs(
        process.env.API_BASE_URL ?? "http://localhost:8080",
        process.env.API_TOKEN ?? process.env.KRYFTO_API_TOKEN,
        id
      );
      return;
    }

    const result = await client.getJobLogs(id);
    process.stdout.write(`${result}\n`);
  });

const artifacts = program
  .command("artifacts")
  .description("Artifact operations");

artifacts
  .command("list")
  .argument("<jobId>", "Job ID")
  .action(async (jobId: string) => {
    const result = await baseClient().listArtifacts(jobId);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

artifacts
  .command("get")
  .argument("<artifactId>", "Artifact ID")
  .requiredOption("-o, --output <file>", "Output file path")
  .option("--token <downloadToken>", "Short-lived download token")
  .action(async (artifactId: string, options) => {
    const bytes = await baseClient().getArtifact(
      artifactId,
      options.token ? { downloadToken: options.token } : undefined
    );
    const output = path.isAbsolute(options.output)
      ? options.output
      : path.join(process.cwd(), options.output);
    await writeFile(output, bytes);
    process.stdout.write(
      `${JSON.stringify({ artifactId, output }, null, 2)}\n`
    );
  });

program
  .command("crawl")
  .requiredOption("--seed <url>", "Seed URL")
  .option("--rules <path>", "Rules file (yaml/json)")
  .option("--recipe <recipeId>", "Recipe id")
  .action(async (options) => {
    const rules = options.rules
      ? parseFile<Record<string, unknown>>(options.rules)
      : undefined;
    const result = await baseClient().crawl({
      seed: options.seed,
      ...(rules ? { rules } : {}),
      ...(options.recipe ? { recipeId: options.recipe } : {}),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

program
  .command("search")
  .requiredOption("-q, --query <query>", "Search query")
  .option("-l, --limit <limit>", "Max results (1-20)", (value) => Number(value))
  .option(
    "-e, --engine <engine>",
    "duckduckgo|bing|yahoo|google|brave",
    "duckduckgo"
  )
  .option("--safe-search <mode>", "strict|moderate|off", "moderate")
  .option("--locale <locale>", "Search locale, e.g. us-en", "us-en")
  .action(async (options) => {
    const result = await baseClient().search({
      query: options.query,
      limit: options.limit ?? 10,
      safeSearch: options.safeSearch ?? "moderate",
      locale: options.locale ?? "us-en",
      engine: options.engine,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

const recipes = program.command("recipes").description("Recipe operations");

recipes
  .command("validate")
  .argument("<path>", "Recipe file path (.yaml/.json)")
  .action(async (filePath: string) => {
    const payload = parseFile<unknown>(filePath);
    const recipe = RecipeSchema.parse(payload);
    const result = await baseClient().validateRecipe(recipe);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

recipes.command("list").action(async () => {
  const result = await baseClient().listRecipes();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
});

recipes
  .command("upload")
  .argument("<path>", "Recipe file path")
  .action(async (filePath: string) => {
    const recipe = RecipeSchema.parse(parseFile<unknown>(filePath));
    const result = await baseClient().uploadRecipe(recipe);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

program.parseAsync(process.argv).catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
