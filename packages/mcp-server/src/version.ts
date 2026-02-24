// ── Centralized Version Constants ──────────────────────────────────
// Single source of truth for all version stamps in responses.
// Update these when releasing a new version.

/** Semantic version of the MCP server package (matches package.json) */
export const SERVER_VERSION = "3.2.0";

/** Schema version for eval suite output format */
export const EVAL_SCHEMA_VERSION = "v4";

/** Version of the scoring/reranker model */
export const RERANKER_VERSION = "v2";

/** Version of the trust rules configuration */
export const TRUST_RULES_VERSION = "v2";

/** Combined version stamp included in every response `_meta` block */
export function versionStamp(): {
  serverVersion: string;
  evalSchema: string;
  rerankerVersion: string;
  trustRulesVersion: string;
} {
  return {
    serverVersion: SERVER_VERSION,
    evalSchema: EVAL_SCHEMA_VERSION,
    rerankerVersion: RERANKER_VERSION,
    trustRulesVersion: TRUST_RULES_VERSION,
  };
}
