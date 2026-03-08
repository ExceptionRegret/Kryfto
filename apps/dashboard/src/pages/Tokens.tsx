import { useEffect, useState } from "react";
import { api, type Token } from "../api";
import { Plus, RotateCw, Trash2, Copy, Check } from "lucide-react";

export function TokensPage() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () => {
    api.listTokens().then((r) => setTokens(r.items)).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this token? This cannot be undone.")) return;
    try {
      await api.revokeToken(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function handleRotate(id: string) {
    if (!confirm("Rotate this token? The old token will stop working immediately.")) return;
    try {
      const res = await api.rotateToken(id);
      setNewToken(res.token);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  function copyToken(t: string) {
    navigator.clipboard.writeText(t);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const active = tokens.filter((t) => !t.revokedAt);
  const revoked = tokens.filter((t) => t.revokedAt);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">API Tokens</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          <Plus size={16} /> Create Token
        </button>
      </div>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {newToken && (
        <div className="mb-6 p-4 rounded-xl border border-green-800 bg-green-900/20">
          <p className="text-sm text-green-400 font-medium mb-2">
            Token created! Copy it now — it won't be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm text-green-300 bg-gray-900 px-3 py-2 rounded font-mono break-all">
              {newToken}
            </code>
            <button
              onClick={() => copyToken(newToken)}
              className="p-2 rounded-lg hover:bg-gray-800 text-green-400"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <button
            onClick={() => setNewToken(null)}
            className="mt-2 text-xs text-gray-500 hover:text-gray-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {showCreate && (
        <CreateTokenForm
          onCreated={(token) => {
            setNewToken(token);
            setShowCreate(false);
            load();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Name</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Role</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Created</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Expires</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Status</th>
              <th className="text-right px-4 py-3 text-gray-400 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {active.map((t) => (
              <tr key={t.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="px-4 py-3 text-white font-medium">{t.name}</td>
                <td className="px-4 py-3">
                  <RoleBadge role={t.role} />
                </td>
                <td className="px-4 py-3 text-gray-400">{fmtDate(t.createdAt)}</td>
                <td className="px-4 py-3 text-gray-400">
                  {t.expiresAt ? fmtDate(t.expiresAt) : "Never"}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-green-400 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    Active
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => handleRotate(t.id)}
                      title="Rotate"
                      className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-blue-400 transition-colors"
                    >
                      <RotateCw size={14} />
                    </button>
                    <button
                      onClick={() => handleRevoke(t.id)}
                      title="Revoke"
                      className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {active.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No active tokens
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {revoked.length > 0 && (
        <details className="mt-6">
          <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-300">
            {revoked.length} revoked token{revoked.length > 1 ? "s" : ""}
          </summary>
          <div className="mt-2 rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {revoked.map((t) => (
                  <tr key={t.id} className="border-b border-gray-800/50 opacity-50">
                    <td className="px-4 py-2 text-gray-400">{t.name}</td>
                    <td className="px-4 py-2"><RoleBadge role={t.role} /></td>
                    <td className="px-4 py-2 text-gray-500">Revoked {fmtDate(t.revokedAt!)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function CreateTokenForm({
  onCreated,
  onCancel,
}: {
  onCreated: (token: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("developer");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    try {
      const res = await api.createToken({ name, role, projectId: "default" });
      onCreated(res.token);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-6 p-5 rounded-xl border border-gray-700 bg-gray-900">
      <h3 className="text-sm font-medium text-white mb-4">New API Token</h3>
      <form onSubmit={handleSubmit} className="flex items-end gap-4">
        <div className="flex-1">
          <label className="block text-xs text-gray-400 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. ci-pipeline"
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="admin">Admin</option>
            <option value="developer">Developer</option>
            <option value="readonly">Readonly</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={!name.trim() || loading}
          className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Creating..." : "Create"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-gray-800 text-gray-400 text-sm hover:text-white transition-colors"
        >
          Cancel
        </button>
      </form>
      {err && <p className="text-red-400 text-sm mt-2">{err}</p>}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    admin: "bg-red-500/10 text-red-400 border-red-500/20",
    developer: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    readonly: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${
        colors[role] ?? colors.readonly
      }`}
    >
      {role}
    </span>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
