import { useEffect, useState } from "react";
import { api, type Project } from "../api";
import { Plus, FolderKanban } from "lucide-react";

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const load = () => {
    api.listProjects().then((r) => setProjects(r.items)).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Projects</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          <Plus size={16} /> New Project
        </button>
      </div>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {showCreate && (
        <CreateProjectForm
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => (
          <div
            key={p.id}
            className="rounded-xl border border-gray-800 bg-gray-900 p-5"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <FolderKanban size={18} className="text-purple-400" />
              </div>
              <div>
                <p className="text-white font-medium">{p.name}</p>
                <p className="text-xs text-gray-500 font-mono">{p.id}</p>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Created {new Date(p.createdAt).toLocaleDateString()}
            </p>
          </div>
        ))}
        {projects.length === 0 && (
          <p className="text-gray-500 col-span-full text-center py-12">
            No projects yet
          </p>
        )}
      </div>
    </div>
  );
}

function CreateProjectForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    try {
      await api.createProject({ id: id.trim(), name: name.trim() });
      onCreated();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-6 p-5 rounded-xl border border-gray-700 bg-gray-900">
      <h3 className="text-sm font-medium text-white mb-4">New Project</h3>
      <form onSubmit={handleSubmit} className="flex items-end gap-4">
        <div className="flex-1">
          <label className="block text-xs text-gray-400 mb-1">Project ID</label>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="e.g. marketing-team"
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            autoFocus
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-400 mb-1">Display Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Marketing Team"
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <button
          type="submit"
          disabled={!id.trim() || !name.trim() || loading}
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
