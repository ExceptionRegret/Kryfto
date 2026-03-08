import { useEffect, useState } from "react";
import { api } from "../api";
import { Briefcase, Bug, KeyRound, HardDrive } from "lucide-react";

type Stats = Awaited<ReturnType<typeof api.stats>>;

export function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<{ ok: boolean } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.stats().then(setStats).catch((e) => setError(e.message));
    api.health().then(setHealth).catch(() => setHealth({ ok: false }));
  }, []);

  if (error) {
    return <p className="text-red-400">{error}</p>;
  }
  if (!stats) {
    return <p className="text-gray-500">Loading...</p>;
  }

  const cards = [
    {
      label: "Total Jobs",
      value: stats.jobs.total,
      sub: `${stats.jobs.running} running, ${stats.jobs.queued} queued`,
      icon: Briefcase,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      label: "Success / Failed",
      value: `${stats.jobs.succeeded} / ${stats.jobs.failed}`,
      sub: stats.jobs.total
        ? `${((stats.jobs.succeeded / stats.jobs.total) * 100).toFixed(1)}% success rate`
        : "No jobs yet",
      icon: Bug,
      color: stats.jobs.failed > 0 ? "text-amber-400" : "text-green-400",
      bg: stats.jobs.failed > 0 ? "bg-amber-500/10" : "bg-green-500/10",
    },
    {
      label: "API Tokens",
      value: `${stats.tokens.active} active`,
      sub: `${stats.tokens.total} total`,
      icon: KeyRound,
      color: "text-purple-400",
      bg: "bg-purple-500/10",
    },
    {
      label: "Artifacts",
      value: stats.artifacts.total,
      sub: formatBytes(Number(stats.artifacts.totalBytes)),
      icon: HardDrive,
      color: "text-cyan-400",
      bg: "bg-cyan-500/10",
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-white">Overview</h2>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${
              health?.ok ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span className="text-sm text-gray-400">
            {health?.ok ? "Healthy" : "Unhealthy"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-gray-800 bg-gray-900 p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-400">{c.label}</span>
              <div className={`p-2 rounded-lg ${c.bg}`}>
                <c.icon size={18} className={c.color} />
              </div>
            </div>
            <p className="text-2xl font-bold text-white">{c.value}</p>
            <p className="text-xs text-gray-500 mt-1">{c.sub}</p>
          </div>
        ))}
      </div>

      {stats.crawls.total > 0 && (
        <div className="mt-6 rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h3 className="text-sm font-medium text-gray-400 mb-2">Crawls</h3>
          <p className="text-lg text-white">
            {stats.crawls.total} total &middot; {stats.crawls.running} running
          </p>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}
