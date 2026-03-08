import { useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { getToken } from "./api";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/Login";
import { OverviewPage } from "./pages/Overview";
import { TokensPage } from "./pages/Tokens";
import { ProjectsPage } from "./pages/Projects";
import { JobsPage } from "./pages/Jobs";
import { CrawlsPage } from "./pages/Crawls";
import { AuditLogsPage } from "./pages/AuditLogs";
import { RateLimitsPage } from "./pages/RateLimits";
import { PlaygroundPage } from "./pages/Playground";
import { ExamplesPage } from "./pages/Examples";

export function App() {
  const [authed, setAuthed] = useState(!!getToken());

  useEffect(() => {
    const check = () => setAuthed(!!getToken());
    window.addEventListener("storage", check);
    return () => window.removeEventListener("storage", check);
  }, []);

  if (!authed) {
    return <LoginPage onLogin={() => setAuthed(true)} />;
  }

  return (
    <Layout onLogout={() => setAuthed(false)}>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/tokens" element={<TokensPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/crawls" element={<CrawlsPage />} />
        <Route path="/audit-logs" element={<AuditLogsPage />} />
        <Route path="/rate-limits" element={<RateLimitsPage />} />
        <Route path="/playground" element={<PlaygroundPage />} />
        <Route path="/examples" element={<ExamplesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
