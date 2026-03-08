import { useEffect, useState } from "react";
import { api } from "../api";
import { Save, Gauge } from "lucide-react";

export function RateLimitsPage() {
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .getRateLimits()
      .then((r) => {
        setLimits(r.limits);
        setDraft(r.limits);
      })
      .catch((e) => setError(e.message));
  }, []);

  const dirty = JSON.stringify(limits) !== JSON.stringify(draft);

  async function handleSave() {
    setLoading(true);
    setError("");
    setSaved(false);
    try {
      const res = await api.updateRateLimits(draft);
      setLimits(res.limits);
      setDraft(res.limits);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  const roles = [
    {
      key: "admin",
      label: "Admin",
      desc: "Full access. Token/project management, all operations.",
      color: "border-red-500/30 bg-red-500/5",
    },
    {
      key: "developer",
      label: "Developer",
      desc: "Create jobs, search, crawl, extract. No token management.",
      color: "border-blue-500/30 bg-blue-500/5",
    },
    {
      key: "readonly",
      label: "Readonly",
      desc: "Read job status, list artifacts, run searches.",
      color: "border-gray-500/30 bg-gray-500/5",
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Rate Limits</h2>
          <p className="text-sm text-gray-500 mt-1">
            Configure requests per minute (RPM) for each role
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={!dirty || loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          <Save size={16} /> {loading ? "Saving..." : "Save Changes"}
        </button>
      </div>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      {saved && (
        <p className="text-green-400 text-sm mb-4 bg-green-900/20 px-3 py-2 rounded-lg">
          Rate limits updated successfully. Changes take effect on next request.
        </p>
      )}

      <div className="space-y-4">
        {roles.map(({ key, label, desc, color }) => (
          <div
            key={key}
            className={`rounded-xl border ${color} p-5 flex items-center justify-between`}
          >
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-gray-900/50">
                <Gauge size={20} className="text-gray-400" />
              </div>
              <div>
                <p className="text-white font-medium">{label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={10000}
                value={draft[key] ?? 120}
                onChange={(e) =>
                  setDraft({ ...draft, [key]: Math.max(1, Number(e.target.value)) })
                }
                className="w-24 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm text-right font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <span className="text-sm text-gray-500 w-12">RPM</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="text-sm font-medium text-gray-400 mb-3">How it works</h3>
        <ul className="space-y-2 text-sm text-gray-500">
          <li>Rate limits are enforced per <code className="text-gray-400">token_hash:ip</code> pair.</li>
          <li>Each role has its own RPM ceiling. When a token exceeds its limit, the API returns <code className="text-gray-400">429 Too Many Requests</code>.</li>
          <li>Changes are persisted to the database and update the in-memory cache immediately.</li>
          <li>The environment variable <code className="text-gray-400">KRYFTO_RATE_LIMIT_RPM</code> serves as the fallback for unrecognized roles.</li>
        </ul>
      </div>
    </div>
  );
}
