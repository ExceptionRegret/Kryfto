import { useEffect, useState } from "react";
import { api, type AuditLog } from "../api";
import { ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 25;

export function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function load(off: number, action?: string) {
    setLoading(true);
    api
      .auditLogs({ limit: PAGE_SIZE, offset: off, action: action || undefined })
      .then((r) => {
        setLogs(r.items);
        setOffset(off);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(0, filter);
  }, [filter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Audit Logs</h2>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by action (e.g. job.create)"
          className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm w-72 focus:outline-none focus:ring-2 focus:ring-brand-500 placeholder-gray-600"
        />
      </div>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Time</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Action</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Role</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Resource</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">IP</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">
                    {fmtTime(log.createdAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    <ActionBadge action={log.action} />
                  </td>
                  <td className="px-4 py-2.5 text-gray-400">{log.actorRole}</td>
                  <td className="px-4 py-2.5 text-gray-300 font-mono text-xs">
                    {log.resourceType}/{truncate(log.resourceId, 12)}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">
                    {log.ipAddress ?? "-"}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs max-w-48 truncate">
                    {Object.keys(log.details).length > 0
                      ? JSON.stringify(log.details)
                      : "-"}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                    No audit logs found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4">
        <p className="text-sm text-gray-500">
          Showing {offset + 1}–{offset + logs.length}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(Math.max(0, offset - PAGE_SIZE), filter)}
            disabled={offset === 0}
            className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => load(offset + PAGE_SIZE, filter)}
            disabled={logs.length < PAGE_SIZE}
            className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  const color = action.includes("create")
    ? "text-green-400"
    : action.includes("revoke") || action.includes("cancel")
      ? "text-red-400"
      : action.includes("update") || action.includes("rotate")
        ? "text-amber-400"
        : "text-gray-300";
  return <span className={`font-mono text-xs ${color}`}>{action}</span>;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}
