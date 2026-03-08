import { type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { clearToken } from "../api";
import {
  LayoutDashboard,
  KeyRound,
  FolderKanban,
  Briefcase,
  Globe,
  ScrollText,
  Gauge,
  Terminal,
  BookOpen,
  LogOut,
} from "lucide-react";

const links = [
  { to: "/", icon: LayoutDashboard, label: "Overview" },
  { to: "/tokens", icon: KeyRound, label: "Tokens" },
  { to: "/projects", icon: FolderKanban, label: "Projects" },
  { to: "/jobs", icon: Briefcase, label: "Jobs" },
  { to: "/crawls", icon: Globe, label: "Crawls" },
  { to: "/audit-logs", icon: ScrollText, label: "Audit Logs" },
  { to: "/rate-limits", icon: Gauge, label: "Rate Limits" },
  { to: "/playground", icon: Terminal, label: "Playground" },
  { to: "/examples", icon: BookOpen, label: "Examples" },
];

export function Layout({
  children,
  onLogout,
}: {
  children: ReactNode;
  onLogout: () => void;
}) {
  return (
    <div className="flex h-screen">
      <aside className="w-56 shrink-0 border-r border-gray-800 bg-gray-900 flex flex-col">
        <div className="px-5 py-5 border-b border-gray-800">
          <h1 className="text-lg font-bold tracking-tight text-white">
            Kryfto Admin
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">v3.8.0</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {links.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-brand-600/20 text-brand-400"
                    : "text-gray-400 hover:text-white hover:bg-gray-800"
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-gray-800">
          <button
            onClick={() => {
              clearToken();
              onLogout();
            }}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-gray-800 w-full transition-colors"
          >
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
