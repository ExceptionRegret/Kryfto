import { federatedSearch } from "./search.js";
import { readUrl } from "./read.js";

// ── #30: Dev Intel ──────────────────────────────────────────────────
export async function devIntel(framework: string, type = "latest_changes") {
    const queries: Record<string, string> = {
        latest_changes: `${framework} latest release changelog ${new Date().getFullYear()}`,
        breaking_changes: `${framework} breaking changes migration guide`,
        upgrade_guide: `${framework} upgrade guide migration steps`,
    };
    const searchResult = await federatedSearch(
        queries[type] ?? queries["latest_changes"]!,
        {
            limit: 5,
            priorityDomains: [
                `${framework.toLowerCase()}.org`,
                `${framework.toLowerCase()}.dev`,
                "github.com",
            ],
        }
    );
    let topPage: Record<string, unknown> | undefined;
    if (searchResult.results.length > 0) {
        try {
            topPage = await readUrl(searchResult.results[0]!.url, {
                timeoutMs: 20000,
            });
        } catch {
            /* best effort */
        }
    }
    return {
        framework,
        type,
        search: searchResult,
        topPage: topPage
            ? {
                title: topPage.title,
                url: topPage.url,
                published_at: topPage.published_at,
                markdown: (topPage.markdown as string)?.substring(0, 15000),
            }
            : undefined,
    };
}

// #36: Upgrade Impact Analyzer
export async function upgradeImpactAnalyzer(
    framework: string,
    fromVersion: string,
    toVersion: string
) {
    const query = `${framework} ${fromVersion} to ${toVersion} migration breaking changes`;
    const searchResult = await federatedSearch(query, {
        limit: 5,
        priorityDomains: [
            `${framework.toLowerCase()}.org`,
            `${framework.toLowerCase()}.dev`,
            "github.com",
        ],
    });
    let changelogContent: Record<string, unknown> | undefined;
    if (searchResult.results.length > 0) {
        try {
            changelogContent = await readUrl(searchResult.results[0]!.url, {
                timeoutMs: 20000,
                sections: true,
            });
        } catch {
            /* */
        }
    }
    const breakingIndicators = [
        "breaking",
        "removed",
        "deprecated",
        "replaced",
        "renamed",
        "migration",
        "upgrade",
    ];
    const md = (changelogContent?.markdown as string) ?? "";
    const breakingLines = md
        .split("\n")
        .filter((l) => {
            const lower = l.toLowerCase();
            return breakingIndicators.some((bi) => lower.includes(bi));
        })
        .slice(0, 20);
    return {
        framework,
        from: fromVersion,
        to: toVersion,
        riskLevel:
            breakingLines.length > 10
                ? "high"
                : breakingLines.length > 3
                    ? "medium"
                    : "low",
        breakingChanges: breakingLines.map((l) => l.trim().substring(0, 300)),
        sources: searchResult.results.map((r) => ({ url: r.url, title: r.title })),
        recommendation:
            breakingLines.length > 10
                ? "Major migration effort required. Read the full migration guide."
                : breakingLines.length > 3
                    ? "Some breaking changes detected. Test thoroughly."
                    : "Low risk upgrade. Standard testing should suffice.",
    };
}
