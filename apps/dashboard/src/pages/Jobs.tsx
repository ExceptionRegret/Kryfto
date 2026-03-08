import { useEffect, useState } from "react";
import { api, type Job } from "../api";
import { ChevronLeft, ChevronRight, XCircle } from "lucide-react";

const PAGE_SIZE = 25;
const STATES = ["", "queued", "running", "succeeded", "failed", "cancelled"];

export function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function load(off: number, state?: string) {
    setLoading(true);
    api
      .listJobs({ limit: PAGE_SIZE, offset: off, state: state || undefined })
      .then((r) => { setJobs(r.items); setOffset(off); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(0, filter); }, [filter]);

  async function handleCancel(id: string) {
    if (!confirm("Cancel this job?")) return;
    try { await api.cancelJob(id); load(offset, filter); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Jobs</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
          <option value="">All states</option>
          {STATES.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-3 text-gray-400 font-medium">URL</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">State</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Attempts</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Created</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-2.5 text-gray-300 max-w-xs truncate font-mono text-xs">{j.url}</td>
                  <td className="px-4 py-2.5"><StateBadge state={j.state} /></td>
                  <td className="px-4 py-2.5 text-gray-400">{j.attempts}/{j.maxAttempts}</td>
                  <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{fmtTime(j.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {(j.state === "queued" || j.state === "running") && (
                      <button onClick={() => handleCancel(j.id)} title="Cancel"
                        className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-red-400 transition-colors">
                        <XCircle size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && !loading && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-500">No jobs found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex items-center justify-between mt-4">
        <p className="text-sm text-gray-500">Showing {offset + 1}–{offset + jobs.length}</p>
        <div className="flex items-center gap-2">
          <button onClick={() => load(Math.max(0, offset - PAGE_SIZE), filter)} disabled={offset === 0}
            className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
            <ChevronLeft size={16} /></button>
          <button onClick={() => load(offset + PAGE_SIZE, filter)} disabled={jobs.length < PAGE_SIZE}
            className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
            <ChevronRight size={16} /></button>
        </div>
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const c: Record<string, string> = {
    queued: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    running: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    succeeded: "bg-green-500/10 text-green-400 border-green-500/20",
    failed: "bg-red-500/10 text-red-400 border-red-500/20",
    cancelled: "bg-gray-500/10 text-gray-400 border-gray-500/20",
    expired: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  };
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${c[state] ?? c.cancelled}`}>{state}</span>;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
