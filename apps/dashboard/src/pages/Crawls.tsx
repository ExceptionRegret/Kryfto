import { useEffect, useState } from "react";
import { api, type Crawl } from "../api";
import { ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 25;

export function CrawlsPage() {
  const [crawls, setCrawls] = useState<Crawl[]>([]);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function load(off: number) {
    setLoading(true);
    api.listCrawls({ limit: PAGE_SIZE, offset: off })
      .then((r) => { setCrawls(r.items); setOffset(off); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(0); }, []);

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Crawls</h2>
      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Seed URL</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">State</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Progress</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {crawls.map((c) => (
                <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-2.5 text-gray-300 max-w-xs truncate font-mono text-xs">{c.seed}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${stateColor(c.state)}`}>{c.state}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">
                    {c.stats.succeeded} done, {c.stats.running} running, {c.stats.queued} queued, {c.stats.failed} failed
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">
                    {new Date(c.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                </tr>
              ))}
              {crawls.length === 0 && !loading && (
                <tr><td colSpan={4} className="px-4 py-12 text-center text-gray-500">No crawls found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex items-center justify-between mt-4">
        <p className="text-sm text-gray-500">Showing {offset + 1}–{offset + crawls.length}</p>
        <div className="flex items-center gap-2">
          <button onClick={() => load(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}
            className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
            <ChevronLeft size={16} /></button>
          <button onClick={() => load(offset + PAGE_SIZE)} disabled={crawls.length < PAGE_SIZE}
            className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
            <ChevronRight size={16} /></button>
        </div>
      </div>
    </div>
  );
}

function stateColor(s: string): string {
  const m: Record<string, string> = {
    queued: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    running: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    succeeded: "bg-green-500/10 text-green-400 border-green-500/20",
    failed: "bg-red-500/10 text-red-400 border-red-500/20",
    cancelled: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  };
  return m[s] ?? m.cancelled!;
}
