// ── Browser Session Pool ──────────────────────────────────────────
// Reuses persistent browser contexts per domain to avoid repeated
// Cloudflare/bot challenges. Contexts preserve cookies, localStorage,
// and session state. TTL-based eviction after idle period.
//
// Upgrades:
// - Sticky proxy sessions — same domain always gets same proxy
// - Fingerprint persistence — same domain keeps same fingerprint
// - Automatic identity rotation on challenge detection

import type { Browser, BrowserContext, BrowserType } from "playwright";
import {
  launchStealthBrowser,
  getStealthContextOptions,
  applyStealthScripts,
  generateFingerprint,
  type StealthOptions,
  type FingerprintProfile,
} from "./stealth.js";

interface PoolEntry {
  browser: Browser;
  context: BrowserContext;
  stealthOpts: Record<string, unknown>;
  fingerprint: FingerprintProfile;
  lastUsed: number;
  domain: string;
  proxyUrl: string | null;
  challengeCount: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes idle
const MAX_POOL_SIZE = 10;
const EVICTION_INTERVAL_MS = 60 * 1000;
const MAX_CHALLENGES_BEFORE_ROTATE = 2;

export class BrowserPool {
  private pool = new Map<string, PoolEntry>();
  private evictionTimer: ReturnType<typeof setInterval> | null = null;
  private ttlMs: number;
  // Sticky proxy assignment — same domain always uses same proxy
  private domainProxyMap = new Map<string, string>();

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    this.evictionTimer = setInterval(() => this.evictStale(), EVICTION_INTERVAL_MS);
  }

  /** Pick a sticky proxy for a domain. Same domain always gets same proxy. */
  private getStickyProxy(domain: string, proxyUrls: string[]): string | null {
    if (proxyUrls.length === 0) return null;

    const existing = this.domainProxyMap.get(domain);
    if (existing && proxyUrls.includes(existing)) return existing;

    // Assign based on domain hash for consistency
    let hash = 0;
    for (let i = 0; i < domain.length; i++) {
      hash = ((hash << 5) - hash + domain.charCodeAt(i)) | 0;
    }
    const proxy = proxyUrls[Math.abs(hash) % proxyUrls.length]!;
    this.domainProxyMap.set(domain, proxy);
    return proxy;
  }

  async acquire(
    domain: string,
    browserType: BrowserType,
    stealthOpts: StealthOptions
  ): Promise<{
    context: BrowserContext;
    browser: Browser;
    stealthCtxOpts: Record<string, unknown>;
    fingerprint: FingerprintProfile;
    reused: boolean;
  }> {
    const existing = this.pool.get(domain);
    if (existing) {
      try {
        existing.context.pages();
        existing.lastUsed = Date.now();
        return {
          context: existing.context,
          browser: existing.browser,
          stealthCtxOpts: existing.stealthOpts,
          fingerprint: existing.fingerprint,
          reused: true,
        };
      } catch {
        this.pool.delete(domain);
        await this.safeClose(existing);
      }
    }

    if (this.pool.size >= MAX_POOL_SIZE) {
      await this.evictOldest();
    }

    // Use sticky proxy for this domain
    const stickyProxy = this.getStickyProxy(domain, stealthOpts.proxyUrls);
    const optsWithProxy: StealthOptions = {
      ...stealthOpts,
      proxyUrls: stickyProxy ? [stickyProxy] : [],
    };

    const browser = await launchStealthBrowser(browserType, optsWithProxy);
    const fingerprint = generateFingerprint();
    const stealthCtxOpts = getStealthContextOptions(optsWithProxy, fingerprint);
    const context = await browser.newContext(stealthCtxOpts);

    const entry: PoolEntry = {
      browser,
      context,
      stealthOpts: stealthCtxOpts,
      fingerprint,
      lastUsed: Date.now(),
      domain,
      proxyUrl: stickyProxy,
      challengeCount: 0,
    };
    this.pool.set(domain, entry);

    return {
      context,
      browser,
      stealthCtxOpts,
      fingerprint,
      reused: false,
    };
  }

  /** Release a domain back to the pool (keeps it alive for reuse). */
  release(domain: string): void {
    const entry = this.pool.get(domain);
    if (entry) {
      entry.lastUsed = Date.now();
    }
  }

  /**
   * Report that a challenge was encountered on this domain.
   * After MAX_CHALLENGES_BEFORE_ROTATE challenges, the session is
   * destroyed and a new identity will be created on next acquire().
   */
  async reportChallenge(domain: string): Promise<boolean> {
    const entry = this.pool.get(domain);
    if (!entry) return false;

    entry.challengeCount++;
    if (entry.challengeCount >= MAX_CHALLENGES_BEFORE_ROTATE) {
      // Rotate identity: destroy session, clear proxy assignment
      await this.remove(domain);
      this.domainProxyMap.delete(domain);
      return true; // Signal that identity was rotated
    }
    return false;
  }

  /** Remove a domain from the pool and close its browser. */
  async remove(domain: string): Promise<void> {
    const entry = this.pool.get(domain);
    if (entry) {
      this.pool.delete(domain);
      await this.safeClose(entry);
    }
  }

  private async evictStale(): Promise<void> {
    const now = Date.now();
    const stale: string[] = [];
    for (const [domain, entry] of this.pool) {
      if (now - entry.lastUsed > this.ttlMs) {
        stale.push(domain);
      }
    }
    for (const domain of stale) {
      const entry = this.pool.get(domain);
      if (entry) {
        this.pool.delete(domain);
        await this.safeClose(entry);
      }
    }
  }

  private async evictOldest(): Promise<void> {
    let oldestDomain: string | null = null;
    let oldestTime = Infinity;
    for (const [domain, entry] of this.pool) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestDomain = domain;
      }
    }
    if (oldestDomain) {
      await this.remove(oldestDomain);
    }
  }

  private async safeClose(entry: PoolEntry): Promise<void> {
    try { await entry.context.close(); } catch { /* already closed */ }
    try { await entry.browser.close(); } catch { /* already closed */ }
  }

  get size(): number {
    return this.pool.size;
  }

  /** Get the fingerprint for a domain (for stealth script injection). */
  getFingerprint(domain: string): FingerprintProfile | null {
    return this.pool.get(domain)?.fingerprint ?? null;
  }

  async closeAll(): Promise<void> {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
    const entries = Array.from(this.pool.values());
    this.pool.clear();
    this.domainProxyMap.clear();
    await Promise.allSettled(entries.map((e) => this.safeClose(e)));
  }
}
