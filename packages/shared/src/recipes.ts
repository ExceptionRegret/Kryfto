import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { load as parseYaml } from "js-yaml";
import { minimatch } from "minimatch";
import { RecipeSchema, type Recipe } from "./index.js";

async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full)));
      continue;
    }
    if (!entry.isFile()) continue;
    out.push(full);
  }
  return out;
}

export async function loadRecipesFromDirectory(dir: string): Promise<Recipe[]> {
  let files: string[] = [];
  try {
    files = await walkFiles(dir);
  } catch {
    return [];
  }

  const recipes: Recipe[] = [];
  for (const file of files) {
    if (!/\.(ya?ml|json)$/iu.test(file)) continue;
    const raw = await readFile(file, "utf8");
    const parsed = file.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw);
    const result = RecipeSchema.safeParse(parsed);
    if (result.success) {
      recipes.push(result.data);
    }
  }

  return recipes;
}

export function recipeMatchesUrl(recipe: Recipe, inputUrl: string): boolean {
  const url = new URL(inputUrl);
  const hostPath = `${url.hostname}${url.pathname}`;

  return recipe.match.patterns.some((pattern) => {
    if (pattern.startsWith("http://") || pattern.startsWith("https://")) {
      return minimatch(inputUrl, pattern);
    }

    return minimatch(hostPath, pattern);
  });
}
