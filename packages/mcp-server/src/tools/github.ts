import { getCached, setCache } from "../cache.js";

interface GhRelease {
    tag_name: string; name: string; published_at?: string;
    prerelease: boolean; body?: string; html_url: string;
}
interface GhCommit {
    sha: string; commit: { message: string; author: { name: string; date: string } };
}
interface GhFile {
    filename: string; status: string; additions: number; deletions: number;
}
interface GhCompare {
    status: string; ahead_by: number; behind_by: number;
    total_commits: number; commits?: GhCommit[]; files?: GhFile[];
}
interface GhIssue {
    number: number; title: string; state: string;
    labels?: { name: string }[]; created_at: string;
    html_url: string; pull_request?: unknown;
}

// ── #18: GitHub Tools ───────────────────────────────────────────────
const SCOPED_TOKENS = {
    github_releases: process.env.KRYFTO_GITHUB_TOKEN,
};

const GH_HEADERS = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Kryfto-MCP/2.0",
    ...(SCOPED_TOKENS.github_releases
        ? { Authorization: `Bearer ${SCOPED_TOKENS.github_releases}` }
        : {}),
};

export async function githubReleases(repo: string, limit = 5) {
    const cacheKey = `gh:${repo}`;
    const cached = getCached(cacheKey);
    if (cached.hit) return { ...(cached.data as Record<string, unknown>), _cached: true };
    const res = await fetch(
        `https://api.github.com/repos/${repo}/releases?per_page=${limit}`,
        { headers: GH_HEADERS }
    );
    if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
    const releases = (await res.json()) as GhRelease[];
    const data = {
        repo,
        releases: releases.map((r) => ({
            tag: r.tag_name,
            name: r.name,
            published_at: r.published_at?.substring(0, 10),
            prerelease: r.prerelease,
            body: r.body?.substring(0, 2000),
            url: r.html_url,
        })),
    };
    setCache(cacheKey, data, 30 * 60 * 1000);
    return data;
}

export async function githubDiff(repo: string, fromTag: string, toTag: string) {
    const cacheKey = `ghdiff:${repo}:${fromTag}:${toTag}`;
    const cached = getCached(cacheKey);
    if (cached.hit) return { ...(cached.data as Record<string, unknown>), _cached: true };
    const res = await fetch(
        `https://api.github.com/repos/${repo}/compare/${fromTag}...${toTag}`,
        { headers: GH_HEADERS }
    );
    if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
    const diff = (await res.json()) as GhCompare;
    const data = {
        repo,
        from: fromTag,
        to: toTag,
        status: diff.status,
        aheadBy: diff.ahead_by,
        behindBy: diff.behind_by,
        totalCommits: diff.total_commits,
        commits: diff.commits?.slice(0, 20).map((c) => ({
            sha: c.sha?.substring(0, 7),
            message: c.commit?.message?.split("\n")[0],
            author: c.commit?.author?.name,
            date: c.commit?.author?.date?.substring(0, 10),
        })),
        files: diff.files?.slice(0, 30).map((f) => ({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
        })),
    };
    setCache(cacheKey, data, 30 * 60 * 1000);
    return data;
}

export async function githubIssues(
    repo: string,
    state = "open",
    limit = 10,
    labels?: string
) {
    const url = `https://api.github.com/repos/${repo}/issues?state=${state}&per_page=${limit}${labels ? `&labels=${labels}` : ""
        }`;
    const res = await fetch(url, { headers: GH_HEADERS });
    if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
    const issues = (await res.json()) as GhIssue[];
    return {
        repo,
        state,
        issues: issues.map((i) => ({
            number: i.number,
            title: i.title,
            state: i.state,
            labels: i.labels?.map((l) => l.name),
            created_at: i.created_at?.substring(0, 10),
            url: i.html_url,
            isPR: !!i.pull_request,
        })),
    };
}
