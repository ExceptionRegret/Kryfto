import { useState } from "react";
import { setToken } from "../api";
import { KeyRound } from "lucide-react";

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Validate token by calling stats endpoint
      const res = await fetch("/v1/admin/stats", {
        headers: { Authorization: `Bearer ${value.trim()}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Invalid or non-admin token");
      }
      setToken(value.trim());
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-600/20 mb-4">
            <KeyRound size={32} className="text-brand-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">Kryfto Admin</h1>
          <p className="text-sm text-gray-500 mt-1">
            Enter your admin API token to continue
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="token"
              className="block text-sm font-medium text-gray-400 mb-1.5"
            >
              API Token
            </label>
            <input
              id="token"
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Enter admin token..."
              className="w-full px-4 py-2.5 rounded-lg bg-gray-900 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!value.trim() || loading}
            className="w-full px-4 py-2.5 rounded-lg bg-brand-600 text-white font-medium text-sm hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Verifying..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
