import { z } from "zod";

export const RoleSchema = z.enum(["admin", "developer", "readonly"]);
export type Role = z.infer<typeof RoleSchema>;

export const JobStateSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
]);
export type JobState = z.infer<typeof JobStateSchema>;

export const BrowserEngineSchema = z.enum(["chromium", "firefox", "webkit"]);
export type BrowserEngine = z.infer<typeof BrowserEngineSchema>;

export const CookieSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  domain: z.string().optional(),
  path: z.string().optional(),
  expires: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
});
export type CookieInput = z.infer<typeof CookieSchema>;

const GotoStepSchema = z.object({
  type: z.literal("goto"),
  args: z.object({
    url: z.string().url(),
  }),
});

const SetHeadersStepSchema = z.object({
  type: z.literal("setHeaders"),
  args: z.object({
    headers: z.record(z.string()),
  }),
});

const SetCookiesStepSchema = z.object({
  type: z.literal("setCookies"),
  args: z.object({
    cookies: z.array(CookieSchema).min(1),
  }),
});

const ExportCookiesStepSchema = z.object({
  type: z.literal("exportCookies"),
  args: z.record(z.unknown()).optional().default({}),
});

const WaitForSelectorStepSchema = z.object({
  type: z.literal("waitForSelector"),
  args: z.object({
    selector: z.string().min(1),
    timeoutMs: z.number().int().positive().optional(),
  }),
});

const ClickStepSchema = z.object({
  type: z.literal("click"),
  args: z.object({
    selector: z.string().min(1),
  }),
});

const TypeStepSchema = z.object({
  type: z.literal("type"),
  args: z.object({
    selector: z.string().min(1),
    text: z.string(),
    secret: z.boolean().optional(),
  }),
});

const ScrollStepSchema = z.object({
  type: z.literal("scroll"),
  args: z.object({
    direction: z.enum(["up", "down"]),
    amount: z.number().int().positive(),
  }),
});

const WaitStepSchema = z.object({
  type: z.literal("wait"),
  args: z.object({
    ms: z.number().int().positive(),
  }),
});

const WaitForNetworkIdleStepSchema = z.object({
  type: z.literal("waitForNetworkIdle"),
  args: z.object({
    timeoutMs: z.number().int().positive().optional(),
  }),
});

const PaginateStepSchema = z.object({
  type: z.literal("paginate"),
  args: z.object({
    nextSelector: z.string().min(1),
    maxPages: z.number().int().positive().max(100).default(10),
    stopCondition: z.string().optional(),
  }),
});

const ScreenshotStepSchema = z.object({
  type: z.literal("screenshot"),
  args: z.object({
    name: z.string().min(1),
  }),
});

export const ExtractionModeSchema = z.enum(["selectors", "schema", "plugin"]);
export type ExtractionMode = z.infer<typeof ExtractionModeSchema>;

export const ExtractionConfigSchema = z
  .object({
    mode: ExtractionModeSchema.default("selectors"),
    selectors: z.record(z.string()).optional(),
    jsonSchema: z.record(z.unknown()).optional(),
    plugin: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "selectors" && !value.selectors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "selectors required when mode=selectors",
      });
    }
    if (value.mode === "schema" && !value.jsonSchema) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "jsonSchema required when mode=schema",
      });
    }
    if (value.mode === "plugin" && !value.plugin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "plugin required when mode=plugin",
      });
    }
  });
export type ExtractionConfig = z.infer<typeof ExtractionConfigSchema>;

const ExtractStepSchema = z.object({
  type: z.literal("extract"),
  args: ExtractionConfigSchema,
});

export const StepSchema = z.discriminatedUnion("type", [
  GotoStepSchema,
  SetHeadersStepSchema,
  SetCookiesStepSchema,
  ExportCookiesStepSchema,
  WaitForSelectorStepSchema,
  ClickStepSchema,
  TypeStepSchema,
  ScrollStepSchema,
  WaitStepSchema,
  WaitForNetworkIdleStepSchema,
  PaginateStepSchema,
  ScreenshotStepSchema,
  ExtractStepSchema,
]);
export type Step = z.infer<typeof StepSchema>;

export const StepPlanSchema = z.array(StepSchema).max(500);
export type StepPlan = z.infer<typeof StepPlanSchema>;

export const JobOptionsSchema = z.object({
  requiresBrowser: z.boolean().optional(),
  browserEngine: BrowserEngineSchema.default("chromium"),
  respectRobotsTxt: z.boolean().default(true),
  timeoutMs: z.number().int().min(1000).max(300000).default(60000),
  interactiveLogin: z.boolean().default(false),
  proxy_profile: z.string().optional(),
  country: z.string().optional(),
  session_affinity: z.boolean().optional(),
  rotation_strategy: z.enum(["per_request", "sticky", "random"]).optional(),
});
export type JobOptions = z.infer<typeof JobOptionsSchema>;

export const PrivacyModeSchema = z.enum(["normal", "zero_trace"]);
export type PrivacyMode = z.infer<typeof PrivacyModeSchema>;

export const FreshnessModeSchema = z.enum([
  "always",
  "preferred",
  "fallback",
  "never",
]);
export type FreshnessMode = z.infer<typeof FreshnessModeSchema>;

export const JobCreateRequestSchema = z.object({
  url: z.string().url(),
  recipeId: z.string().min(1).max(255).optional(),
  options: JobOptionsSchema.default({}),
  steps: StepPlanSchema.optional(),
  extract: ExtractionConfigSchema.optional(),
  privacy_mode: PrivacyModeSchema.default("normal"),
  freshness_mode: FreshnessModeSchema.default("preferred"),
});
export type JobCreateRequest = z.infer<typeof JobCreateRequestSchema>;

export const ExtractRequestSchema = z
  .object({
    mode: ExtractionModeSchema,
    html: z.string().optional(),
    text: z.string().optional(),
    artifactId: z.string().optional(),
    selectors: z.record(z.string()).optional(),
    jsonSchema: z.record(z.unknown()).optional(),
    plugin: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.html && !value.text && !value.artifactId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "one of html, text, artifactId is required",
      });
    }
    if (value.mode === "selectors" && !value.selectors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "selectors required when mode=selectors",
      });
    }
    if (value.mode === "schema" && !value.jsonSchema) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "jsonSchema required when mode=schema",
      });
    }
    if (value.mode === "plugin" && !value.plugin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "plugin required when mode=plugin",
      });
    }
  });
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;

export const CrawlRulesSchema = z.object({
  allowPatterns: z.array(z.string()).default([]),
  denyPatterns: z.array(z.string()).default([]),
  maxDepth: z.number().int().min(0).max(5).default(1),
  maxPages: z.number().int().min(1).max(500).default(20),
  sameDomainOnly: z.boolean().default(true),
  politenessDelayMs: z.number().int().min(0).max(30000).default(500),
});
export type CrawlRules = z.infer<typeof CrawlRulesSchema>;

export const CrawlRequestSchema = z.object({
  seed: z.string().url(),
  rules: CrawlRulesSchema.default({}),
  recipeId: z.string().optional(),
  extract: ExtractionConfigSchema.optional(),
});
export type CrawlRequest = z.infer<typeof CrawlRequestSchema>;

export const SearchEngineSchema = z.enum([
  "duckduckgo",
  "bing",
  "yahoo",
  "google",
  "brave",
]);
export type SearchEngine = z.infer<typeof SearchEngineSchema>;

export const SafeSearchSchema = z.enum(["strict", "moderate", "off"]);
export type SafeSearch = z.infer<typeof SafeSearchSchema>;

export const SearchTopicSchema = z.enum(["general", "news", "finance"]);
export type SearchTopic = z.infer<typeof SearchTopicSchema>;

export const SearchRequestSchema = z.object({
  query: z.string().min(1).max(512),
  limit: z.number().int().min(1).max(20).default(10),
  engine: SearchEngineSchema.default("duckduckgo"),
  safeSearch: SafeSearchSchema.default("moderate"),
  locale: z.string().min(2).max(16).default("us-en"),
  topic: SearchTopicSchema.default("general"),
  include_images: z.boolean().default(false),
  include_image_descriptions: z.boolean().default(false),
  privacy_mode: PrivacyModeSchema.default("normal"),
  freshness_mode: FreshnessModeSchema.default("preferred"),
  location: z.string().optional(),
  proxy_profile: z.string().optional(),
  country: z.string().optional(),
  session_affinity: z.boolean().optional(),
  rotation_strategy: z.enum(["per_request", "sticky", "random"]).optional(),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export type SearchResult = {
  title: string;
  url: string;
  snippet?: string;
  rank: number;
};

export const RecipeSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(255),
  version: z.string().min(1).max(64),
  description: z.string().optional(),
  match: z.object({
    patterns: z.array(z.string().min(1)).min(1),
  }),
  requiresBrowser: z.boolean().default(false),
  steps: StepPlanSchema.optional(),
  extraction: ExtractionConfigSchema.optional(),
  throttling: z
    .object({
      minDelayMs: z.number().int().min(0).optional(),
      concurrencyHint: z.number().int().min(1).optional(),
    })
    .optional(),
  pluginPath: z.string().optional(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const RecipeValidateRequestSchema = z.object({ recipe: RecipeSchema });
export type RecipeValidateRequest = z.infer<typeof RecipeValidateRequestSchema>;

export const CreateApiTokenRequestSchema = z.object({
  name: z.string().min(1).max(255),
  role: RoleSchema,
  projectId: z.string().min(1).max(255),
});
export type CreateApiTokenRequest = z.infer<typeof CreateApiTokenRequestSchema>;

export type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
};

export type AuthContext = {
  tokenId: string;
  projectId: string;
  role: Role;
  tokenHash: string;
};

export type JobQueuePayload = {
  jobId: string;
  projectId: string;
  requestId: string;
};

export type CrawlQueuePayload = {
  crawlId: string;
  projectId: string;
  requestId: string;
};

export function createErrorResponse(
  code: string,
  message: string,
  requestId: string,
  details?: unknown
): ErrorResponse {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details === undefined ? {} : { details }),
    },
  };
}

export function maskSecret(value: string): string {
  if (!value) return value;
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

export function sanitizeStepForLogs(step: Step): Step {
  if (step.type !== "type") {
    return step;
  }

  if (!step.args.secret) {
    return step;
  }

  return {
    ...step,
    args: {
      ...step.args,
      text: maskSecret(step.args.text),
    },
  };
}

export function ensureHttpUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }
  return url;
}

export const Role = RoleSchema;
export const JobState = JobStateSchema;
export const BrowserEngine = BrowserEngineSchema;
export const Step = StepSchema;
export const StepPlan = StepPlanSchema;
export const ExtractionConfig = ExtractionConfigSchema;
export const JobCreateRequest = JobCreateRequestSchema;
export const ExtractRequest = ExtractRequestSchema;
export const CrawlRules = CrawlRulesSchema;
export const CrawlRequest = CrawlRequestSchema;
export const SearchRequest = SearchRequestSchema;
export const Recipe = RecipeSchema;

export * from "./artifacts.js";
export * from "./extraction.js";
export * from "./recipes.js";
export * from "./search.js";
export * from "./ssrf.js";
export * from "./stealth.js";
export * from "./fingerprint.js";
export * from "./browser-stealth.js";
export * from "./humanize.js";
export * from "./recaptcha-vision.js";
