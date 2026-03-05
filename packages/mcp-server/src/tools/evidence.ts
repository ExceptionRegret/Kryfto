import { federatedSearch } from "./search.js";
import { readUrl } from "./read.js";
import { getDomainTrust } from "../trust.js";
import { extractDomain } from "../url-utils.js";

// #33: Answer with Evidence — search + read + extract evidence spans
export async function answerWithEvidence(question: string, limit = 3) {
    const searchResult = await federatedSearch(question, {
        limit,
        officialOnly: false,
    });
    const evidence: {
        claim: string;
        source: string;
        sourceUrl: string;
        trust: number;
        published_at: string | undefined;
        evidenceSpan: string;
    }[] = [];
    const pages = await Promise.allSettled(
        searchResult.results
            .slice(0, limit)
            .map((r) => readUrl(r.url, { timeoutMs: 20000 }))
    );
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (page!.status !== "fulfilled") continue;
        const data = (page as PromiseFulfilledResult<Record<string, unknown>>)
            .value;
        const md = (data.markdown as string) ?? "";
        const keywords = question
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 3);
        const paragraphs = md.split(/\n\n+/).filter((p) => p.length > 50);
        const relevant = paragraphs
            .filter((p) => {
                const lower = p.toLowerCase();
                return keywords.some((k) => lower.includes(k));
            })
            .slice(0, 3);
        const sr = searchResult.results[i]!;
        const trust = getDomainTrust(sr.source_domain);
        for (const span of relevant) {
            evidence.push({
                claim: span.substring(0, 300),
                source: sr.source_domain,
                sourceUrl: sr.url,
                trust: trust.trust,
                published_at: sr.published_at,
                evidenceSpan: span.substring(0, 500),
            });
        }
    }
    evidence.sort((a, b) => b.trust - a.trust);

    // #5 Evidence Quality Gates: filter to trusted evidence only
    const trustedEvidence = evidence.filter((e) => e.trust >= 0.7);
    if (trustedEvidence.length === 0) {
        return {
            question,
            error: "insufficient_evidence",
            message: "No evidence met the trust threshold (>= 0.7). Please try a more specific query or different sources.",
            _rejected_count: evidence.length,
            evidence: [],
            sources: [],
        };
    }

    return {
        question,
        evidenceCount: trustedEvidence.length,
        evidence: trustedEvidence.slice(0, 10),
        sources: searchResult.results.map((r) => ({
            url: r.url,
            domain: r.source_domain,
            trust: getDomainTrust(r.source_domain).trust,
        })),
    };
}

// #34: Conflict Detector — find contradictions across sources
export async function detectConflicts(topic: string, limit = 5) {
    const searchResult = await federatedSearch(topic, { limit });
    const sourceData: {
        url: string;
        domain: string;
        trust: number;
        keyPoints: string[];
    }[] = [];
    const pages = await Promise.allSettled(
        searchResult.results
            .slice(0, limit)
            .map((r) => readUrl(r.url, { timeoutMs: 15000, sections: true }))
    );
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (page!.status !== "fulfilled") continue;
        const data = (page as PromiseFulfilledResult<Record<string, unknown>>)
            .value;
        const md = (data.markdown as string) ?? "";
        const keyPoints = md
            .split(/\n/)
            .filter((l) => l.trim().length > 20)
            .slice(0, 10)
            .map((l) => l.trim().substring(0, 200));
        const sr = searchResult.results[i]!;
        sourceData.push({
            url: sr.url,
            domain: sr.source_domain,
            trust: getDomainTrust(sr.source_domain).trust,
            keyPoints,
        });
    }
    // Find potential conflicts: claims that appear in one source but contradict implicit meaning in another
    const allClaims = sourceData.flatMap((s) =>
        s.keyPoints.map((kp) => ({
            point: kp,
            source: s.domain,
            url: s.url,
            trust: s.trust,
        }))
    );
    const potentialConflicts: {
        claim1: { point: string; source: string; trust: number };
        claim2: { point: string; source: string; trust: number };
        reason: string;
    }[] = [];
    // Detect negation conflicts (simple heuristic: same keywords but one has "not"/"no"/"don't")
    const negationWords = [
        "not",
        "no",
        "don't",
        "doesn't",
        "isn't",
        "wasn't",
        "never",
        "without",
        "deprecated",
        "removed",
    ];
    for (let i = 0; i < allClaims.length; i++) {
        for (let j = i + 1; j < allClaims.length; j++) {
            const c1 = allClaims[i]!;
            const c2 = allClaims[j]!;
            if (c1.source === c2.source) continue;
            const w1 = c1.point.toLowerCase().split(/\s+/);
            const w2 = c2.point.toLowerCase().split(/\s+/);
            const common = w1.filter((w) => w.length > 4 && w2.includes(w));
            if (common.length < 2) continue;
            const has1Neg = w1.some((w) => negationWords.includes(w));
            const has2Neg = w2.some((w) => negationWords.includes(w));
            if (has1Neg !== has2Neg)
                potentialConflicts.push({
                    claim1: c1,
                    claim2: c2,
                    reason: `Opposing statements about "${common
                        .slice(0, 3)
                        .join(", ")}" — ${c1.trust > c2.trust ? c1.source : c2.source
                        } is more trustworthy (trust: ${Math.max(c1.trust, c2.trust)})`,
                });
        }
    }
    return {
        topic,
        sourcesAnalyzed: sourceData.length,
        conflicts: potentialConflicts.slice(0, 10),
        sources: sourceData.map((s) => ({
            url: s.url,
            domain: s.domain,
            trust: s.trust,
            keyPointCount: s.keyPoints.length,
        })),
    };
}

// #12: Citation Mode
export async function citationSearch(claims: string[], limit = 3) {
    const citations = await Promise.all(
        claims.map(async (claim) => {
            try {
                const result = await federatedSearch(claim, {
                    limit,
                    officialOnly: true,
                });

                const sources = result.results.map((r) => {
                    const isHigh = r.is_official;
                    const hasSnippet = r.snippet?.toLowerCase().includes(claim.toLowerCase().split(" ").slice(0, 3).join(" "));
                    return {
                        url: r.url,
                        title: r.title,
                        snippet: r.snippet ?? "",
                        confidence: (isHigh ? "high" : hasSnippet ? "medium" : "low") as "high" | "medium" | "low",
                    };
                });

                const hasStrongEvidence = sources.some(s =>
                    (s.confidence === "high" || s.confidence === "medium") &&
                    getDomainTrust(extractDomain(s.url)).trust >= 0.7
                );
                if (!hasStrongEvidence && sources.length > 0) {
                    return {
                        claim,
                        error: "insufficient_evidence",
                        message: "Search yielded results, but none met the necessary confidence threshold. Please broaden the query.",
                        sources: [] as { url: string; title: string; trust: number; snippet: string | undefined }[],
                    };
                }

                return {
                    claim,
                    sources,
                };
            } catch {
                return {
                    claim,
                    sources: [] as {
                        url: string;
                        title: string;
                        snippet: string;
                        confidence: "high" | "medium" | "low";
                    }[],
                };
            }
        })
    );
    return { citations };
}

// #38: Confidence Calibration — per-claim scoring
export function calibrateConfidence(
    claims: {
        text: string;
        sourceCount: number;
        officialSources: number;
        recency?: string | undefined;
        sourceTrust: number;
    }[]
): { calibrated: { text: string; confidence: number; reasoning: string }[] } {
    return {
        calibrated: claims.map((c) => {
            let score = 0.3;
            if (c.sourceCount >= 3) score += 0.2;
            else if (c.sourceCount >= 2) score += 0.1;
            if (c.officialSources >= 1) score += 0.2;
            if (c.recency) {
                const age = Date.now() - new Date(c.recency).getTime();
                if (age < 30 * 86400000) score += 0.15;
                else if (age < 365 * 86400000) score += 0.05;
            }
            score = Math.min(score + c.sourceTrust * 0.15, 0.99);
            const reasoning = `${c.sourceCount} sources, ${c.officialSources
                } official, trust=${c.sourceTrust.toFixed(2)}${c.recency ? `, date=${c.recency}` : ""
                }`;
            return {
                text: c.text,
                confidence: Math.round(score * 100) / 100,
                reasoning,
            };
        }),
    };
}
