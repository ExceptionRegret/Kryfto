import { useState, useRef } from "react";
import { getToken } from "../api";
import {
  Play,
  Copy,
  Check,
  ChevronDown,
  Loader2,
  Clock,
  AlertCircle,
} from "lucide-react";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof METHODS)[number];

interface HistoryEntry {
  method: Method;
  path: string;
  status: number;
  time: number;
  ts: string;
}

const PRESETS: { label: string; method: Method; path: string; body: string }[] =
  [
    { label: "Health Check", method: "GET", path: "/v1/healthz", body: "" },
    { label: "Readiness", method: "GET", path: "/v1/readyz", body: "" },
    { label: "Dashboard Stats", method: "GET", path: "/v1/admin/stats", body: "" },
    { label: "List Tokens", method: "GET", path: "/v1/admin/tokens", body: "" },
    {
      label: "Create Token",
      method: "POST",
      path: "/v1/admin/tokens",
      body: JSON.stringify(
        { name: "my-token", role: "developer", projectId: "default" },
        null,
        2
      ),
    },
    { label: "List Projects", method: "GET", path: "/v1/admin/projects", body: "" },
    {
      label: "Create Project",
      method: "POST",
      path: "/v1/admin/projects",
      body: JSON.stringify({ id: "my-project", name: "My Project" }, null, 2),
    },
    { label: "List Jobs", method: "GET", path: "/v1/admin/jobs?limit=10", body: "" },
    { label: "List Crawls", method: "GET", path: "/v1/admin/crawls?limit=10", body: "" },
    { label: "Audit Logs", method: "GET", path: "/v1/admin/audit-logs?limit=10", body: "" },
    { label: "Rate Limits", method: "GET", path: "/v1/admin/rate-limits", body: "" },
    {
      label: "Create Job",
      method: "POST",
      path: "/v1/jobs",
      body: JSON.stringify(
        { url: "https://example.com", options: { timeoutMs: 30000 } },
        null,
        2
      ),
    },
    {
      label: "Search (DuckDuckGo)",
      method: "POST",
      path: "/v1/search",
      body: JSON.stringify(
        {
          query: "playwright testing",
          engine: "duckduckgo",
          limit: 5,
          safeSearch: "moderate",
        },
        null,
        2
      ),
    },
    {
      label: "Search (Google)",
      method: "POST",
      path: "/v1/search",
      body: JSON.stringify(
        {
          query: "web scraping best practices",
          engine: "google",
          limit: 5,
        },
        null,
        2
      ),
    },
    {
      label: "Start Crawl",
      method: "POST",
      path: "/v1/crawl",
      body: JSON.stringify(
        {
          seed: "https://example.com",
          rules: { maxDepth: 1, maxPages: 5, sameDomainOnly: true },
        },
        null,
        2
      ),
    },
    {
      label: "Extract (Selectors)",
      method: "POST",
      path: "/v1/extract",
      body: JSON.stringify(
        {
          mode: "selectors",
          html: "<html><head><title>Test</title></head><body><h1>Hello World</h1></body></html>",
          selectors: { title: "title", heading: "h1" },
        },
        null,
        2
      ),
    },
    { label: "List Recipes", method: "GET", path: "/v1/recipes", body: "" },
    {
      label: "Validate Recipe",
      method: "POST",
      path: "/v1/recipes/validate",
      body: JSON.stringify(
        {
          id: "test-recipe",
          name: "Test Recipe",
          version: "1.0.0",
          match: { patterns: ["*://example.com/*"] },
          extraction: {
            mode: "selectors",
            selectors: { title: "title" },
          },
        },
        null,
        2
      ),
    },
  ];

const METHOD_COLORS: Record<Method, string> = {
  GET: "text-green-400",
  POST: "text-blue-400",
  PUT: "text-amber-400",
  PATCH: "text-purple-400",
  DELETE: "text-red-400",
};


export function PlaygroundPage() {
  const [method, setMethod] = useState<Method>("GET");
  const [path, setPath] = useState("/v1/healthz");
  const [body, setBody] = useState("");
  const [response, setResponse] = useState("");
  const [status, setStatus] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  async function send() {
    setLoading(true);
    setError("");
    setResponse("");
    setStatus(null);
    setElapsed(null);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${getToken()}`,
    };
    const init: RequestInit = { method, headers };

    if (body.trim() && method !== "GET") {
      headers["Content-Type"] = "application/json";
      try {
        JSON.parse(body);
        init.body = body;
      } catch {
        setError("Invalid JSON body");
        setLoading(false);
        return;
      }
    }

    const start = performance.now();
    try {
      const res = await fetch(path, init);
      const ms = Math.round(performance.now() - start);
      setElapsed(ms);
      setStatus(res.status);

      const text = await res.text();
      try {
        const json = JSON.parse(text);
        setResponse(JSON.stringify(json, null, 2));
      } catch {
        setResponse(text);
      }

      setHistory((prev) => [
        {
          method,
          path,
          status: res.status,
          time: ms,
          ts: new Date().toLocaleTimeString(),
        },
        ...prev.slice(0, 19),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  function loadPreset(p: (typeof PRESETS)[number]) {
    setMethod(p.method);
    setPath(p.path);
    setBody(p.body);
    setShowPresets(false);
    setResponse("");
    setStatus(null);
    setElapsed(null);
    setError("");
  }

  function copyResponse() {
    navigator.clipboard.writeText(response);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function copyCurl() {
    let cmd = `curl -X ${method} "${window.location.origin}${path}"`;
    cmd += ` \\\n  -H "Authorization: Bearer ${getToken()}"`;
    if (body.trim() && method !== "GET") {
      cmd += ` \\\n  -H "Content-Type: application/json"`;
      cmd += ` \\\n  -d '${body.replace(/\n/g, "").replace(/\s+/g, " ")}'`;
    }
    navigator.clipboard.writeText(cmd);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  }

  function replayHistory(entry: HistoryEntry) {
    setMethod(entry.method);
    setPath(entry.path);
    setBody("");
    setShowPresets(false);
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">API Playground</h2>
        <div className="relative">
          <button
            onClick={() => setShowPresets(!showPresets)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 text-sm text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
          >
            Load Preset
            <ChevronDown size={14} />
          </button>
          {showPresets && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowPresets(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-20 w-64 max-h-80 overflow-y-auto rounded-lg bg-gray-800 border border-gray-700 shadow-xl">
                {PRESETS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => loadPreset(p)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-700 transition-colors flex items-center gap-2"
                  >
                    <span
                      className={`font-mono text-xs ${METHOD_COLORS[p.method]}`}
                    >
                      {p.method}
                    </span>
                    <span className="text-gray-300 truncate">{p.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Request builder */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as Method)}
            className={`px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm font-mono font-bold focus:outline-none focus:ring-2 focus:ring-brand-500 ${METHOD_COLORS[method]}`}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/v1/..."
            className="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            onClick={send}
            disabled={loading || !path.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
            Send
          </button>
        </div>

        {/* Request body */}
        {method !== "GET" && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-500 font-medium">
                Request Body (JSON)
              </label>
              <button
                onClick={copyCurl}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                {copiedCurl ? <Check size={12} /> : <Copy size={12} />}
                {copiedCurl ? "Copied!" : "Copy as cURL"}
              </button>
            </div>
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder='{ "key": "value" }'
              rows={8}
              spellCheck={false}
              className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-gray-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
            />
          </div>
        )}
        {method === "GET" && (
          <div className="flex justify-end">
            <button
              onClick={copyCurl}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {copiedCurl ? <Check size={12} /> : <Copy size={12} />}
              {copiedCurl ? "Copied!" : "Copy as cURL"}
            </button>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertCircle size={16} className="text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Response */}
      {(response || status !== null) && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden mb-4">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-400">Response</span>
              {status !== null && (
                <span
                  className={`inline-block px-2 py-0.5 rounded text-xs font-mono font-bold border ${
                    status < 300
                      ? "bg-green-500/10 border-green-500/20 text-green-400"
                      : status < 400
                        ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-400"
                        : "bg-red-500/10 border-red-500/20 text-red-400"
                  }`}
                >
                  {status}
                </span>
              )}
              {elapsed !== null && (
                <span className="flex items-center gap-1 text-xs text-gray-500">
                  <Clock size={12} />
                  {elapsed}ms
                </span>
              )}
            </div>
            {response && (
              <button
                onClick={copyResponse}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? "Copied!" : "Copy"}
              </button>
            )}
          </div>
          <pre className="p-4 text-sm font-mono text-gray-300 overflow-x-auto max-h-[500px] overflow-y-auto whitespace-pre-wrap break-words">
            {response || "No response body"}
          </pre>
        </div>
      )}

      {/* Request history */}
      {history.length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <span className="text-sm text-gray-400">Recent Requests</span>
          </div>
          <div className="divide-y divide-gray-800/50">
            {history.map((h, i) => (
              <button
                key={i}
                onClick={() => replayHistory(h)}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-800/30 transition-colors"
              >
                <span
                  className={`font-mono text-xs font-bold w-12 text-left ${METHOD_COLORS[h.method]}`}
                >
                  {h.method}
                </span>
                <span className="flex-1 text-left text-gray-300 font-mono text-xs truncate">
                  {h.path}
                </span>
                <span
                  className={`text-xs font-mono ${h.status < 300 ? "text-green-400" : h.status < 400 ? "text-yellow-400" : "text-red-400"}`}
                >
                  {h.status}
                </span>
                <span className="text-xs text-gray-500">{h.time}ms</span>
                <span className="text-xs text-gray-600">{h.ts}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
