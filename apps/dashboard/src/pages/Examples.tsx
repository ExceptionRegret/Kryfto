import { useState } from "react";
import {
  Copy,
  Check,
  Search,
  Globe,
  Briefcase,
  FileText,
  KeyRound,
  Gauge,
  ChevronRight,
  Terminal,
} from "lucide-react";

interface Example {
  title: string;
  description: string;
  icon: typeof Search;
  color: string;
  bg: string;
  method: string;
  path: string;
  body?: string;
  curl: string;
  response: string;
  notes?: string;
}

const EXAMPLES: Example[] = [
  {
    title: "Federated Search",
    description:
      "Search across DuckDuckGo, Google, Bing, Yahoo, and Brave with a single API call. Results are scored and ranked by domain authority.",
    icon: Search,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    method: "POST",
    path: "/v1/search",
    body: JSON.stringify(
      {
        query: "playwright browser automation",
        engine: "duckduckgo",
        limit: 5,
        safeSearch: "moderate",
        locale: "us-en",
      },
      null,
      2
    ),
    curl: `curl -X POST http://localhost:8080/v1/search \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"playwright browser automation","engine":"duckduckgo","limit":5}'`,
    response: JSON.stringify(
      {
        query: "playwright browser automation",
        engine: "duckduckgo",
        results: [
          {
            title: "Fast and reliable end-to-end testing for modern web apps",
            url: "https://playwright.dev/",
            snippet:
              "Playwright enables reliable end-to-end testing for modern web apps.",
            rank: 1,
          },
          {
            title: "Playwright Documentation - Getting Started",
            url: "https://playwright.dev/docs/intro",
            snippet:
              "Install Playwright and start writing tests in minutes.",
            rank: 2,
          },
        ],
        requestId: "6301784a-5e1b-42f4-bb2c-62a707da8c7d",
      },
      null,
      2
    ),
    notes:
      "Supported engines: duckduckgo, google, bing, yahoo, brave. Google uses a full Playwright browser with stealth + CAPTCHA solving. All engines work without external API keys.",
  },
  {
    title: "Create a Browser Job",
    description:
      "Navigate to a URL with a headless browser, execute steps, and extract structured data. The job runs asynchronously in the worker fleet.",
    icon: Briefcase,
    color: "text-green-400",
    bg: "bg-green-500/10",
    method: "POST",
    path: "/v1/jobs",
    body: JSON.stringify(
      {
        url: "https://news.ycombinator.com",
        options: { browserEngine: "chromium", timeoutMs: 30000 },
        steps: [{ type: "waitForNetworkIdle", args: { timeoutMs: 10000 } }],
        extract: {
          mode: "selectors",
          selectors: { stories: ".titleline > a", score: ".score" },
        },
      },
      null,
      2
    ),
    curl: `curl -X POST http://localhost:8080/v1/jobs \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: hn-scrape-001" \\
  -d '{"url":"https://news.ycombinator.com","extract":{"mode":"selectors","selectors":{"stories":".titleline > a"}}}'`,
    response: JSON.stringify(
      {
        jobId: "e10c6c92-d85a-40fa-be36-ee240f687927",
        state: "queued",
        requestId: "6301784a-5e1b-42f4-bb2c-62a707da8c7d",
      },
      null,
      2
    ),
    notes:
      "Use the Idempotency-Key header to prevent duplicate jobs. Poll GET /v1/jobs/:jobId for status. States: queued → running → succeeded/failed.",
  },
  {
    title: "Domain Crawl",
    description:
      "Crawl an entire site starting from a seed URL. Control depth, page limits, domain restrictions, and politeness delays.",
    icon: Globe,
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    method: "POST",
    path: "/v1/crawl",
    body: JSON.stringify(
      {
        seed: "https://docs.example.com",
        rules: {
          maxDepth: 2,
          maxPages: 50,
          sameDomainOnly: true,
          politenessDelayMs: 1000,
          allowPatterns: ["*/docs/*"],
        },
        extract: {
          mode: "selectors",
          selectors: { title: "title", content: "main" },
        },
      },
      null,
      2
    ),
    curl: `curl -X POST http://localhost:8080/v1/crawl \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"seed":"https://docs.example.com","rules":{"maxDepth":2,"maxPages":50,"sameDomainOnly":true}}'`,
    response: JSON.stringify(
      {
        crawlId: "c8f2b4a1-9e3d-4f6a-b7c8-2d1e0f3a4b5c",
        state: "queued",
        requestId: "7412895b-6f2c-53e5-cc3d-73b818eb9d8e",
      },
      null,
      2
    ),
    notes:
      "Monitor progress with GET /v1/crawl/:crawlId. The stats object shows queued/running/succeeded/failed counts. Respects robots.txt by default.",
  },
  {
    title: "Extract Data",
    description:
      "Extract structured data from raw HTML using CSS selectors, JSON Schema, or plugins — without creating a job.",
    icon: FileText,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    method: "POST",
    path: "/v1/extract",
    body: JSON.stringify(
      {
        mode: "selectors",
        html: '<html><head><title>Product</title></head><body><h1>Widget Pro</h1><span class="price">$29.99</span><p class="desc">The best widget ever made.</p></body></html>',
        selectors: {
          title: "title",
          name: "h1",
          price: ".price",
          description: ".desc",
        },
      },
      null,
      2
    ),
    curl: `curl -X POST http://localhost:8080/v1/extract \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"mode":"selectors","html":"<h1>Widget</h1><span class=\\"price\\">$29.99</span>","selectors":{"name":"h1","price":".price"}}'`,
    response: JSON.stringify(
      {
        data: {
          title: "Product",
          name: "Widget Pro",
          price: "$29.99",
          description: "The best widget ever made.",
        },
        mode: "selectors",
      },
      null,
      2
    ),
    notes:
      'Three extraction modes: "selectors" (CSS), "schema" (JSON Schema), and "plugin" (custom module). Provide html, text, or artifactId as input.',
  },
  {
    title: "Create API Token",
    description:
      "Generate a scoped API token with a specific role and project. The raw token is returned once — store it securely.",
    icon: KeyRound,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    method: "POST",
    path: "/v1/admin/tokens",
    body: JSON.stringify(
      {
        name: "ci-pipeline",
        role: "developer",
        projectId: "default",
      },
      null,
      2
    ),
    curl: `curl -X POST http://localhost:8080/v1/admin/tokens \\
  -H "Authorization: Bearer $ADMIN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"ci-pipeline","role":"developer","projectId":"default"}'`,
    response: JSON.stringify(
      {
        token: "kryfto_a1b2c3d4e5f6...",
        tokenId: "550e8400-e29b-41d4-a716-446655440000",
      },
      null,
      2
    ),
    notes:
      "Requires admin role. Roles: admin (full access), developer (can create jobs/searches), readonly (read-only access). Token is SHA-256 hashed at rest.",
  },
  {
    title: "Configure Rate Limits",
    description:
      "View and update per-role rate limits. Each role has an independent requests-per-minute (RPM) cap.",
    icon: Gauge,
    color: "text-rose-400",
    bg: "bg-rose-500/10",
    method: "PUT",
    path: "/v1/admin/rate-limits",
    body: JSON.stringify(
      {
        limits: { admin: 500, developer: 200, readonly: 60 },
      },
      null,
      2
    ),
    curl: `curl -X PUT http://localhost:8080/v1/admin/rate-limits \\
  -H "Authorization: Bearer $ADMIN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"limits":{"admin":500,"developer":200,"readonly":60}}'`,
    response: JSON.stringify(
      {
        limits: { admin: 500, developer: 200, readonly: 60 },
      },
      null,
      2
    ),
    notes:
      "Defaults: admin=500, developer=120, readonly=60 RPM. Changes take effect on the next request cycle. Stored in the rate_limit_config database table.",
  },
];

export function ExamplesPage() {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  function copyCurl(idx: number) {
    navigator.clipboard.writeText(EXAMPLES[idx].curl);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">API Examples</h2>
        <p className="text-gray-400 text-sm">
          Ready-to-use examples for every major API endpoint. Click to expand, copy the cURL command, or try it in the{" "}
          <a
            href="/dashboard/playground"
            className="text-brand-400 hover:text-brand-300 underline"
          >
            Playground
          </a>
          .
        </p>
      </div>

      <div className="space-y-3">
        {EXAMPLES.map((ex, i) => {
          const isOpen = expanded === i;
          const Icon = ex.icon;
          return (
            <div
              key={i}
              className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden"
            >
              {/* Header */}
              <button
                onClick={() => setExpanded(isOpen ? null : i)}
                className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-800/30 transition-colors"
              >
                <div className={`p-2.5 rounded-lg ${ex.bg}`}>
                  <Icon size={20} className={ex.color} />
                </div>
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded border ${
                        ex.method === "GET"
                          ? "bg-green-500/10 border-green-500/20 text-green-400"
                          : ex.method === "POST"
                            ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
                            : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                      }`}
                    >
                      {ex.method}
                    </span>
                    <span className="text-white font-medium">{ex.title}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-1">
                    {ex.description}
                  </p>
                </div>
                <ChevronRight
                  size={16}
                  className={`text-gray-500 transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
              </button>

              {/* Expanded content */}
              {isOpen && (
                <div className="border-t border-gray-800 px-5 py-4 space-y-4">
                  <p className="text-sm text-gray-400">{ex.description}</p>

                  {/* Endpoint */}
                  <div>
                    <div className="text-xs text-gray-500 font-medium mb-1">
                      Endpoint
                    </div>
                    <code className="text-sm font-mono text-gray-300">
                      <span
                        className={
                          ex.method === "GET"
                            ? "text-green-400"
                            : ex.method === "POST"
                              ? "text-blue-400"
                              : "text-amber-400"
                        }
                      >
                        {ex.method}
                      </span>{" "}
                      {ex.path}
                    </code>
                  </div>

                  {/* Request body */}
                  {ex.body && (
                    <div>
                      <div className="text-xs text-gray-500 font-medium mb-1">
                        Request Body
                      </div>
                      <pre className="p-3 rounded-lg bg-gray-950 border border-gray-800 text-sm font-mono text-gray-300 overflow-x-auto">
                        {ex.body}
                      </pre>
                    </div>
                  )}

                  {/* Response */}
                  <div>
                    <div className="text-xs text-gray-500 font-medium mb-1">
                      Example Response
                    </div>
                    <pre className="p-3 rounded-lg bg-gray-950 border border-gray-800 text-sm font-mono text-green-300/80 overflow-x-auto">
                      {ex.response}
                    </pre>
                  </div>

                  {/* cURL */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs text-gray-500 font-medium flex items-center gap-1">
                        <Terminal size={12} />
                        cURL
                      </div>
                      <button
                        onClick={() => copyCurl(i)}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        {copiedIdx === i ? (
                          <Check size={12} />
                        ) : (
                          <Copy size={12} />
                        )}
                        {copiedIdx === i ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <pre className="p-3 rounded-lg bg-gray-950 border border-gray-800 text-sm font-mono text-amber-300/80 overflow-x-auto whitespace-pre-wrap">
                      {ex.curl}
                    </pre>
                  </div>

                  {/* Notes */}
                  {ex.notes && (
                    <div className="px-3 py-2.5 rounded-lg bg-brand-600/5 border border-brand-500/10">
                      <p className="text-xs text-gray-400">
                        <span className="font-medium text-brand-400">
                          Note:{" "}
                        </span>
                        {ex.notes}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
