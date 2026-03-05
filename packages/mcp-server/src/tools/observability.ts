// ── Observability: Eval Suite ────────────────────────────────────────
import { federatedSearch } from "./search.js";
import { EVAL_SCHEMA_VERSION, SERVER_VERSION, RERANKER_VERSION, TRUST_RULES_VERSION } from "../version.js";
import { getDomainTrust } from "../trust.js";
import { extractDomain } from "../url-utils.js";
import { getEngineErrorMetrics } from "../helpers.js";
import { getSLODashboard } from "../slo.js";

interface EvalCase {
    id: string;
    query: string;
    expectedOfficialDomains: string[];
    description: string;
}

const EVAL_CASES: EvalCase[] = [
    {
        id: "e1",
        query: "React hooks documentation",
        expectedOfficialDomains: ["react.dev", "reactjs.org"],
        description: "Should find official React docs",
    },
    {
        id: "e2",
        query: "Node.js fs module API",
        expectedOfficialDomains: ["nodejs.org"],
        description: "Should find official Node.js API docs",
    },
    {
        id: "e3",
        query: "TypeScript generics guide",
        expectedOfficialDomains: ["typescriptlang.org"],
        description: "Should find official TypeScript docs",
    },
    {
        id: "e4",
        query: "Python asyncio tutorial",
        expectedOfficialDomains: ["docs.python.org", "python.org"],
        description: "Should find official Python docs",
    },
    {
        id: "e5",
        query: "Rust ownership and borrowing",
        expectedOfficialDomains: ["doc.rust-lang.org", "rust-lang.org"],
        description: "Should find official Rust docs",
    },
    {
        id: "e6",
        query: "PostgreSQL CREATE TABLE syntax",
        expectedOfficialDomains: ["postgresql.org"],
        description: "Should find official PostgreSQL docs",
    },
    {
        id: "e7",
        query: "Docker Compose networking",
        expectedOfficialDomains: ["docs.docker.com", "docker.com"],
        description: "Should find official Docker docs",
    },
    {
        id: "e8",
        query: "Kubernetes pod lifecycle",
        expectedOfficialDomains: ["kubernetes.io"],
        description: "Should find official Kubernetes docs",
    },
    {
        id: "e9",
        query: "Next.js app router migration",
        expectedOfficialDomains: ["nextjs.org"],
        description: "Should find official Next.js docs",
    },
    {
        id: "e10",
        query: "GitHub Actions workflow syntax",
        expectedOfficialDomains: ["docs.github.com", "github.com"],
        description: "Should find official GitHub docs",
    },
];

export async function runEvalSuite(subset?: string[]) {
    const cases = subset
        ? EVAL_CASES.filter((c) => subset.includes(c.id))
        : EVAL_CASES;

    const results: {
        id: string;
        query: string;
        description: string;
        passed: boolean;
        latencyMs: number;
        resultCount: number;
        officialHit: boolean;
        topDomains: string[];
        topTrust: number[];
        error?: string;
    }[] = [];

    for (const evalCase of cases) {
        const start = Date.now();
        try {
            const searchResult = await federatedSearch(evalCase.query, {
                limit: 5,
                officialOnly: false,
            });
            const latencyMs = Date.now() - start;
            const topDomains = searchResult.results.map((r) => r.source_domain);
            const topTrust = searchResult.results.map(
                (r) => getDomainTrust(extractDomain(r.url)).trust
            );
            const officialHit = searchResult.results.some((r) =>
                evalCase.expectedOfficialDomains.some(
                    (d) => r.source_domain.includes(d) || r.url.includes(d)
                )
            );

            results.push({
                id: evalCase.id,
                query: evalCase.query,
                description: evalCase.description,
                passed: officialHit,
                latencyMs,
                resultCount: searchResult.results.length,
                officialHit,
                topDomains: topDomains.slice(0, 5),
                topTrust: topTrust.slice(0, 5),
            });
        } catch (err: unknown) {
            results.push({
                id: evalCase.id,
                query: evalCase.query,
                description: evalCase.description,
                passed: false,
                latencyMs: Date.now() - start,
                resultCount: 0,
                officialHit: false,
                topDomains: [],
                topTrust: [],
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    const passed = results.filter((r) => r.passed).length;
    const total = results.length;
    const avgLatency =
        results.length > 0
            ? Math.round(
                  results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length
              )
            : 0;
    const precision =
        total > 0 ? Math.round((passed / total) * 10000) / 100 : 0;

    return {
        evalSchemaVersion: EVAL_SCHEMA_VERSION,
        serverVersion: SERVER_VERSION,
        rerankerVersion: RERANKER_VERSION,
        trustRulesVersion: TRUST_RULES_VERSION,
        timestamp: new Date().toISOString(),
        summary: {
            total,
            passed,
            failed: total - passed,
            precision,
            avgLatencyMs: avgLatency,
        },
        results,
        engineErrors: getEngineErrorMetrics(60),
        sloSnapshot: getSLODashboard(undefined, 60),
    };
}
