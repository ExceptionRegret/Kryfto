// ── Trust Model ────────────────────────────────────────────────────

export const DEFAULT_TRUST: Record<string, number> = {
  // Developer documentation and official sources
  "developer.apple.com": 0.95,
  "developer.mozilla.org": 0.95,
  "docs.microsoft.com": 0.95,
  "learn.microsoft.com": 0.95,
  "react.dev": 0.95,
  "nextjs.org": 0.95,
  "vuejs.org": 0.95,
  "nodejs.org": 0.95,
  "python.org": 0.95,
  "docs.python.org": 0.95,
  "github.com": 0.9,
  "docs.docker.com": 0.95,
  "kubernetes.io": 0.95,
  "tailwindcss.com": 0.9,
  "go.dev": 0.95,
  "angular.dev": 0.95,
  "svelte.dev": 0.95,
  "doc.rust-lang.org": 0.95,
  "typescriptlang.org": 0.95,
  "developer.android.com": 0.95,
  "developer.chrome.com": 0.9,
  "firebase.google.com": 0.9,
  "cloud.google.com": 0.9,
  "docs.aws.amazon.com": 0.9,
  "deno.land": 0.9,
  "bun.sh": 0.9,
  "postgresql.org": 0.95,
  "sqlite.org": 0.95,
  "redis.io": 0.9,
  "prisma.io": 0.85,
  // Educational & organizational
  "arxiv.org": 0.95,
  "wikipedia.org": 0.8,
  // Aggregators & Forums
  "stackoverflow.com": 0.7,
  "dev.to": 0.5,
  "medium.com": 0.4,
  "reddit.com": 0.35,
  // Low quality
  "w3schools.com": 0.2,
  "tutorialspoint.com": 0.25,
};

export const customTrust = new Map<string, number>();

// ── Trust Decay ────────────────────────────────────────────────────

interface TrustDecayRecord {
  failures: number;
  successes: number;
  decayFactor: number;
}

const trustDecay = new Map<string, TrustDecayRecord>();

export function recordTrustOutcome(
  domain: string,
  success: boolean
): void {
  const d = domain.replace(/^www\./u, "").toLowerCase();
  const existing = trustDecay.get(d) ?? {
    failures: 0,
    successes: 0,
    decayFactor: 1.0,
  };

  if (success) {
    existing.successes++;
    // Reset decay after successes > 2x failures
    if (existing.successes > existing.failures * 2) {
      existing.decayFactor = 1.0;
    }
  } else {
    existing.failures++;
    // After 5 failures: decay trust by 30% (min factor 0.1)
    if (existing.failures >= 5) {
      existing.decayFactor = Math.max(0.7, existing.decayFactor * 0.7);
      // Floor at 0.1 effective
      if (existing.decayFactor < 0.1) existing.decayFactor = 0.1;
    }
  }

  trustDecay.set(d, existing);
}

export function getTrustDecayFactor(domain: string): number {
  const d = domain.replace(/^www\./u, "").toLowerCase();
  return trustDecay.get(d)?.decayFactor ?? 1.0;
}

export function getDomainTrust(domain: string): {
  domain: string;
  trust: number;
  source: "custom" | "builtin" | "ecosystem" | "default";
} {
  const d = domain.replace(/^www\./u, "").toLowerCase();
  const decayFactor = getTrustDecayFactor(d);

  if (customTrust.has(d))
    return {
      domain: d,
      trust: Math.max(0.1, customTrust.get(d)! * decayFactor),
      source: "custom",
    };

  for (const [pattern, score] of Object.entries(DEFAULT_TRUST)) {
    if (d.includes(pattern))
      return {
        domain: d,
        trust: Math.max(0.1, score * decayFactor),
        source: "builtin",
      };
  }

  if (d.endsWith(".gov") || d.endsWith(".edu"))
    return {
      domain: d,
      trust: Math.max(0.1, 0.9 * decayFactor),
      source: "builtin",
    };

  if (d.startsWith("docs.") || d.startsWith("developer."))
    return {
      domain: d,
      trust: Math.max(0.1, 0.85 * decayFactor),
      source: "builtin",
    };

  // Ecosystem patterns: .io domains with docs. or api. prefix
  if (d.endsWith(".io") && (d.startsWith("docs.") || d.startsWith("api.")))
    return {
      domain: d,
      trust: Math.max(0.1, 0.8 * decayFactor),
      source: "ecosystem",
    };

  return {
    domain: d,
    trust: Math.max(0.1, 0.5 * decayFactor),
    source: "default",
  };
}

/** Reset all decay records (for testing) */
export function resetTrustDecay(): void {
  trustDecay.clear();
}
