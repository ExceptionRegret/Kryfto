import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "cheerio";

export type ExtractorContext = {
  html?: string;
  text?: string;
  url?: string;
  metadata?: Record<string, unknown>;
};

export type ExtractorPlugin = {
  extract: (ctx: ExtractorContext) => Promise<unknown> | unknown;
};

function valueFromSelector(html: string, selector: string): unknown {
  const $ = load(html);
  let working = selector;
  let all = false;

  if (working.startsWith("all:")) {
    all = true;
    working = working.slice(4);
  }

  const attrMatch = /(.*)::attr\(([^)]+)\)$/u.exec(working);
  if (attrMatch) {
    const css = attrMatch[1]?.trim() ?? "";
    const attr = attrMatch[2]?.trim() ?? "";
    if (!css || !attr) return null;
    if (all) {
      return $(css)
        .toArray()
        .map((el) => $(el).attr(attr))
        .filter((item): item is string => Boolean(item));
    }
    return $(css).first().attr(attr) ?? null;
  }

  if (working.endsWith("::html")) {
    const css = working.slice(0, -6);
    if (all) {
      return $(css)
        .toArray()
        .map((el) => $(el).html())
        .filter((item): item is string => Boolean(item));
    }
    return $(css).first().html() ?? null;
  }

  if (all) {
    return $(working)
      .toArray()
      .map((el) => $(el).text().trim())
      .filter(Boolean);
  }

  return $(working).first().text().trim() || null;
}

export function extractBySelectors(
  html: string,
  selectors: Record<string, string>
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, selector] of Object.entries(selectors)) {
    output[key] = valueFromSelector(html, selector);
  }
  return output;
}

function inferBySchemaText(text: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const regex = new RegExp(`${escaped}\\s*[:|-]\\s*([^\\n\\r]+)`, "iu");
  const match = regex.exec(text);
  return match?.[1]?.trim() ?? null;
}

export function extractByJsonSchema(
  html: string,
  schema: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const $ = load(html);
  const text = $("body").text().replace(/\s+/gu, " ").trim();
  const properties =
    (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {};

  for (const [key, property] of Object.entries(properties)) {
    const selector = property?.["x-selector"];
    if (typeof selector === "string") {
      result[key] = valueFromSelector(html, selector);
      continue;
    }

    const inferred = inferBySchemaText(text, key);
    result[key] = inferred;
  }

  if (!("title" in result)) {
    result.title = $("title").text().trim() || null;
  }

  return result;
}

export async function extractByPlugin(
  pluginPath: string,
  ctx: ExtractorContext
): Promise<unknown> {
  const abs = path.isAbsolute(pluginPath)
    ? pluginPath
    : path.join(process.cwd(), pluginPath);
  const mod = (await import(
    pathToFileURL(abs).toString()
  )) as Partial<ExtractorPlugin> & {
    default?:
      | ExtractorPlugin
      | ((context: ExtractorContext) => Promise<unknown> | unknown);
  };

  if (mod.extract && typeof mod.extract === "function") {
    return mod.extract(ctx);
  }

  if (
    mod.default &&
    typeof mod.default === "object" &&
    typeof mod.default.extract === "function"
  ) {
    return mod.default.extract(ctx);
  }

  if (typeof mod.default === "function") {
    return mod.default(ctx);
  }

  throw new Error(`Plugin ${pluginPath} does not export an extract function`);
}
