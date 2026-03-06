#!/usr/bin/env tsx
// ── E2E CAPTCHA Solver Test ──────────────────────────────────────
// Run: pnpm --filter @kryfto/worker exec tsx src/test-captcha.ts
//
// Tests the solver against real CAPTCHA demo pages to verify it
// actually works in a live browser.

import { chromium, type Page, type Browser } from "playwright";
import {
  applyStealthScripts,
  getStealthContextOptions,
  launchStealthBrowser,
  type StealthOptions,
} from "./stealth.js";
import { detectChallenge, handleChallenge } from "./captcha-solver.js";

const stealthOpts: StealthOptions = {
  stealthEnabled: true,
  rotateUserAgent: true,
  proxyUrls: (process.env.KRYFTO_PROXY_URLS ?? "").split(",").map(u => u.trim()).filter(Boolean),
  headless: true, // headless for CI testing
};

interface TestResult {
  name: string;
  url: string;
  detected: string;
  solved: boolean;
  method: string;
  durationMs: number;
  error: string | null;
}

const results: TestResult[] = [];

async function setupPage(browser: Browser): Promise<Page> {
  const ctxOpts = getStealthContextOptions(stealthOpts);
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  await applyStealthScripts(page);
  return page;
}

// ── Test 1: Cloudflare Turnstile Demo ────────────────────────────
async function testTurnstile(browser: Browser): Promise<void> {
  const name = "Cloudflare Turnstile";
  const url = "https://demo.turnstile.workers.dev/";
  console.log(`\n[TEST] ${name}`);
  console.log(`  URL: ${url}`);

  const page = await setupPage(browser);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);

    const detection = await detectChallenge(page);
    console.log(`  Detected: ${detection.type} (${detection.details})`);

    const result = await handleChallenge(page);
    console.log(`  Solved: ${result.solved}, Method: ${result.method}, Duration: ${result.durationMs}ms`);

    // Check if we can see success indicators on the demo page
    const pageContent = await page.content();
    const hasSuccessIndicator = pageContent.includes("success") || pageContent.includes("passed");

    results.push({
      name, url,
      detected: detection.type,
      solved: result.solved || hasSuccessIndicator,
      method: result.method,
      durationMs: result.durationMs,
      error: null,
    });
  } catch (err) {
    console.log(`  ERROR: ${err}`);
    results.push({ name, url, detected: "error", solved: false, method: "none", durationMs: 0, error: String(err) });
  } finally {
    await page.context().close();
  }
}

// ── Test 2: reCAPTCHA v2 Demo ────────────────────────────────────
async function testRecaptchaV2(browser: Browser): Promise<void> {
  const name = "reCAPTCHA v2";
  const url = "https://www.google.com/recaptcha/api2/demo";
  console.log(`\n[TEST] ${name}`);
  console.log(`  URL: ${url}`);

  const page = await setupPage(browser);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);

    const detection = await detectChallenge(page);
    console.log(`  Detected: ${detection.type} (${detection.details})`);

    const result = await handleChallenge(page);
    console.log(`  Solved: ${result.solved}, Method: ${result.method}, Duration: ${result.durationMs}ms`);

    results.push({
      name, url,
      detected: detection.type,
      solved: result.solved,
      method: result.method,
      durationMs: result.durationMs,
      error: null,
    });
  } catch (err) {
    console.log(`  ERROR: ${err}`);
    results.push({ name, url, detected: "error", solved: false, method: "none", durationMs: 0, error: String(err) });
  } finally {
    await page.context().close();
  }
}

// ── Test 3: hCaptcha Demo ────────────────────────────────────────
async function testHcaptcha(browser: Browser): Promise<void> {
  const name = "hCaptcha";
  const url = "https://accounts.hcaptcha.com/demo";
  console.log(`\n[TEST] ${name}`);
  console.log(`  URL: ${url}`);

  const page = await setupPage(browser);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);

    const detection = await detectChallenge(page);
    console.log(`  Detected: ${detection.type} (${detection.details})`);

    const result = await handleChallenge(page);
    console.log(`  Solved: ${result.solved}, Method: ${result.method}, Duration: ${result.durationMs}ms`);

    results.push({
      name, url,
      detected: detection.type,
      solved: result.solved,
      method: result.method,
      durationMs: result.durationMs,
      error: null,
    });
  } catch (err) {
    console.log(`  ERROR: ${err}`);
    results.push({ name, url, detected: "error", solved: false, method: "none", durationMs: 0, error: String(err) });
  } finally {
    await page.context().close();
  }
}

// ── Test 4: Cloudflare-protected page (real world) ───────────────
async function testCloudflareReal(browser: Browser): Promise<void> {
  const name = "Cloudflare Protected (nowsecure.nl)";
  const url = "https://nowsecure.nl/";
  console.log(`\n[TEST] ${name}`);
  console.log(`  URL: ${url}`);

  const page = await setupPage(browser);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);

    const detection = await detectChallenge(page);
    console.log(`  Detected: ${detection.type} (${detection.details})`);

    if (detection.type !== "none") {
      const result = await handleChallenge(page);
      console.log(`  Solved: ${result.solved}, Method: ${result.method}, Duration: ${result.durationMs}ms`);

      // After solving, check if we see the actual page content
      const finalHtml = await page.content();
      const passed = finalHtml.includes("passed") || finalHtml.includes("YES");

      results.push({
        name, url,
        detected: detection.type,
        solved: result.solved || passed,
        method: result.method,
        durationMs: result.durationMs,
        error: null,
      });
    } else {
      console.log(`  No challenge detected — stealth fingerprint passed`);
      results.push({
        name, url,
        detected: "none",
        solved: true,
        method: "stealth_bypass",
        durationMs: 0,
        error: null,
      });
    }
  } catch (err) {
    console.log(`  ERROR: ${err}`);
    results.push({ name, url, detected: "error", solved: false, method: "none", durationMs: 0, error: String(err) });
  } finally {
    await page.context().close();
  }
}

// ── Test 5: Bot detection test ───────────────────────────────────
async function testBotDetection(browser: Browser): Promise<void> {
  const name = "Bot Detection (bot.sannysoft.com)";
  const url = "https://bot.sannysoft.com/";
  console.log(`\n[TEST] ${name}`);
  console.log(`  URL: ${url}`);

  const page = await setupPage(browser);
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(3000);

    // Count red ("failed") cells on the page
    const failCount = await page.evaluate('document.querySelectorAll("td.failed, td[style*=red], .result-fail").length');

    // Get all table text for diagnostics
    const pageText = await page.evaluate('document.body.innerText');
    console.log(`  Failed checks on page: ${failCount}`);
    const lines = String(pageText).split('\n').filter((l: string) => l.trim()).slice(0, 20);
    for (const line of lines) console.log(`    ${line}`);

    const passed = failCount === 0;
    results.push({
      name, url,
      detected: "none",
      solved: passed,
      method: "stealth_fingerprint",
      durationMs: 0,
      error: passed ? null : `${failCount} checks failed`,
    });
  } catch (err) {
    console.log(`  ERROR: ${err}`);
    results.push({ name, url, detected: "error", solved: false, method: "none", durationMs: 0, error: String(err) });
  } finally {
    await page.context().close();
  }
}

// ── Test 6: Stealth fingerprint test ─────────────────────────────
async function testFingerprint(browser: Browser): Promise<void> {
  const name = "Fingerprint (intoli.com headless test)";
  const url = "https://intoli.com/blog/not-possible-to-block-chrome-headless/chrome-headless-test.html";
  console.log(`\n[TEST] ${name}`);
  console.log(`  URL: ${url}`);

  const page = await setupPage(browser);
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(2000);

    const testResults = await page.evaluate(() => {
      const rows = document.querySelectorAll("table tbody tr");
      const out: Record<string, string> = {};
      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) {
          const key = cells[0]?.textContent?.trim() ?? "";
          const val = cells[1]?.className ?? "";
          if (key) out[key] = val.includes("passed") ? "PASS" : "FAIL";
        }
      });
      return out;
    });

    const failCount = Object.values(testResults).filter((v) => v === "FAIL").length;
    const passCount = Object.values(testResults).filter((v) => v === "PASS").length;
    console.log(`  Results: ${passCount} passed, ${failCount} failed`);
    for (const [k, v] of Object.entries(testResults)) {
      if (v === "FAIL") console.log(`    FAIL: ${k}`);
    }

    results.push({
      name, url,
      detected: "none",
      solved: failCount === 0,
      method: "stealth_fingerprint",
      durationMs: 0,
      error: failCount > 0 ? `${failCount} checks failed` : null,
    });
  } catch (err) {
    console.log(`  ERROR: ${err}`);
    results.push({ name, url, detected: "error", solved: false, method: "none", durationMs: 0, error: String(err) });
  } finally {
    await page.context().close();
  }
}

// ── Run All Tests ────────────────────────────────────────────────

async function main() {
  console.log("=== Kryfto CAPTCHA Solver E2E Test ===");
  console.log("Launching stealth browser...\n");

  const browser = await launchStealthBrowser(chromium, stealthOpts);

  try {
    // Fingerprint & stealth tests first
    await testBotDetection(browser);
    await testFingerprint(browser);

    // Real challenge tests
    await testCloudflareReal(browser);
    await testTurnstile(browser);
    await testRecaptchaV2(browser);
    await testHcaptcha(browser);
  } finally {
    await browser.close();
  }

  // Summary
  console.log("\n\n=== RESULTS ===\n");
  console.log("| Test | Detected | Solved | Method | Duration |");
  console.log("|------|----------|--------|--------|----------|");
  for (const r of results) {
    const status = r.solved ? "YES" : "NO";
    const dur = r.durationMs > 0 ? `${r.durationMs}ms` : "-";
    console.log(`| ${r.name} | ${r.detected} | ${status} | ${r.method} | ${dur} |`);
    if (r.error) console.log(`|   Error: ${r.error} |`);
  }

  const passed = results.filter((r) => r.solved).length;
  const total = results.length;
  console.log(`\n${passed}/${total} tests passed`);

  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
