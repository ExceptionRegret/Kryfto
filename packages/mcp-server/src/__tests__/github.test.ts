import { describe, expect, it, vi, beforeEach } from "vitest";
import { githubReleases, githubDiff, githubIssues } from "../tools/github.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("github tools", () => {
  describe("githubReleases", () => {
    it("parses release data correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            tag_name: "v1.0.0",
            name: "Release 1.0",
            published_at: "2026-01-15T00:00:00Z",
            prerelease: false,
            body: "Initial release",
            html_url: "https://github.com/test/repo/releases/v1.0.0",
          },
        ],
      });

      const result = await githubReleases("test/repo", 5) as Record<string, unknown>;
      expect(result.repo).toBe("test/repo");
      expect(result.releases).toHaveLength(1);
      const releases = result.releases as Record<string, unknown>[];
      expect(releases[0]!.tag).toBe("v1.0.0");
      expect(releases[0]!.prerelease).toBe(false);
    });

    it("throws on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      await expect(githubReleases("nonexistent/repo")).rejects.toThrow("GitHub API: 404");
    });
  });

  describe("githubDiff", () => {
    it("parses comparison data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "ahead",
          ahead_by: 5,
          behind_by: 0,
          total_commits: 5,
          commits: [
            {
              sha: "abc1234567",
              commit: { message: "feat: add feature\ndetails", author: { name: "dev", date: "2026-01-15" } },
            },
          ],
          files: [
            { filename: "src/index.ts", status: "modified", additions: 10, deletions: 2 },
          ],
        }),
      });

      const result = await githubDiff("test/repo", "v1.0", "v2.0") as Record<string, unknown>;
      expect(result.aheadBy).toBe(5);
      expect(result.totalCommits).toBe(5);
      const commits = result.commits as Record<string, unknown>[];
      expect(commits).toHaveLength(1);
      expect(commits[0]!.sha).toBe("abc1234");
      expect(commits[0]!.message).toBe("feat: add feature");
      expect(result.files).toHaveLength(1);
    });
  });

  describe("githubIssues", () => {
    it("parses issue data and detects PRs", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            number: 42,
            title: "Bug report",
            state: "open",
            labels: [{ name: "bug" }],
            created_at: "2026-01-15T00:00:00Z",
            html_url: "https://github.com/test/repo/issues/42",
            pull_request: undefined,
          },
          {
            number: 43,
            title: "Feature PR",
            state: "open",
            labels: [],
            created_at: "2026-01-16T00:00:00Z",
            html_url: "https://github.com/test/repo/pull/43",
            pull_request: { url: "https://api.github.com/repos/test/repo/pulls/43" },
          },
        ],
      });

      const result = await githubIssues("test/repo", "open", 10);
      expect(result.issues).toHaveLength(2);
      expect(result.issues[0]!.isPR).toBe(false);
      expect(result.issues[0]!.labels).toEqual(["bug"]);
      expect(result.issues[1]!.isPR).toBe(true);
    });
  });
});
