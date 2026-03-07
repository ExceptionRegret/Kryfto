/**
 * Browser-based Google Search for the API server.
 * Uses the full 20-point antibot system (stealth, fingerprint, humanize).
 */
import type { Browser } from "playwright";
import {
  buildGoogleHtmlSearchUrl,
  parseGoogleHtmlSearchResults,
  launchStealthBrowser,
  getStealthContextWithFingerprint,
  applyStealthScripts,
  humanType,
  humanClick,
  idleFidget,
  solveGoogleSorryPage,
  type StealthOptions,
} from "@kryfto/shared";

let _browser: Browser | null = null;
let _browserPromise: Promise<Browser> | null = null;

const stealthOpts: StealthOptions = {
  stealthEnabled: true,
  rotateUserAgent: true,
  proxyUrls: [],
  headless: true,
};

async function getBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;
  if (_browserPromise) return _browserPromise;
  _browserPromise = (async () => {
    try {
      const pw = await import("playwright");
      const browser = await launchStealthBrowser(pw.chromium, stealthOpts);
      _browser = browser;
      return browser;
    } finally {
      _browserPromise = null;
    }
  })();
  return _browserPromise;
}

export async function browserSearchGoogle(
  query: string,
  limit: number,
  safeSearch: "strict" | "moderate" | "off",
  locale: string,
): Promise<{ title: string; url: string; snippet?: string; rank: number }[]> {
  const searchUrl = buildGoogleHtmlSearchUrl({ query, safeSearch, locale });
  const { contextOpts, fingerprint } = getStealthContextWithFingerprint(stealthOpts);

  const browser = await getBrowser();
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  await applyStealthScripts(page, fingerprint);

  await context.addCookies([{
    name: "SOCS",
    value: "CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjUwMzA0LjA3X3AxGgJlbiACGgYIgJCptgY",
    domain: ".google.com",
    path: "/",
  }]);

  try {
    await page.goto("https://www.google.com", { waitUntil: "domcontentloaded", timeout: 10_000 });
    await idleFidget(page, 300 + Math.random() * 500);

    const consentBtn = await page.$('button[id="L2AGLb"], button:has-text("Accept all")');
    if (consentBtn) {
      await humanClick(page, 'button[id="L2AGLb"], button:has-text("Accept all")').catch(() => {});
      await page.waitForTimeout(500);
    }

    const searchBox = await page.$('textarea[name="q"], input[name="q"]');
    if (searchBox) {
      await humanType(page, 'textarea[name="q"], input[name="q"]', query);
      await idleFidget(page, 200 + Math.random() * 300);
      await page.keyboard.press("Enter");
    } else {
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    }

    await page.waitForTimeout(1500);

    if (page.url().includes("/sorry")) {
      console.error("[google-browser] Hit /sorry CAPTCHA, attempting to solve...");
      const solved = await solveGoogleSorryPage(page);
      if (!solved) {
        throw new Error("GOOGLE_CAPTCHA: /sorry page could not be solved");
      }
      // After solving, wait for results to load
      await page.waitForSelector("h3", { timeout: 10_000 }).catch(() => {});
    }

    await page.waitForSelector("h3", { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);

    const html = await page.content();
    const parsed = parseGoogleHtmlSearchResults(html, limit);
    if (parsed.length === 0 && !html.includes("<h3")) {
      // No results AND no h3 tags means Google didn't render real results
      throw new Error("GOOGLE_BLOCKED: Google did not return search results (possible IP rate-limit)");
    }
    return parsed;
  } finally {
    await context.close();
  }
}

export async function closeGoogleBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}
