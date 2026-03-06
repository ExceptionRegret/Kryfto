// ── Browser-Based CAPTCHA & Challenge Solving ────────────────────
// Solves Cloudflare, Datadome, reCAPTCHA, hCaptcha, and Turnstile
// challenges entirely in-browser — no external paid APIs.
//
// Techniques:
//   1. Cloudflare JS challenges: wait with humanized mouse movement
//   2. Turnstile/hCaptcha/reCAPTCHA: click checkbox with humanized input
//   3. Audio CAPTCHA fallback: switch to audio challenge, download MP3,
//      transcribe locally with Whisper (optional dep), type answer back
//   4. Session persistence: solved sessions are reused via browser pool

import type { Page, Frame, ElementHandle } from "playwright";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { moveMouseNaturally, randomBetween } from "./humanize.js";

// ── Challenge Types ──────────────────────────────────────────────

export type ChallengeType =
  | "cloudflare_js"
  | "cloudflare_turnstile"
  | "cloudflare_managed"
  | "datadome"
  | "recaptcha_v2"
  | "recaptcha_v3"
  | "hcaptcha"
  | "generic_captcha"
  | "none";

export interface ChallengeDetectionResult {
  type: ChallengeType;
  confidence: number;
  details: string;
}

// ── Detection Markers ────────────────────────────────────────────

const CF_JS_MARKERS = [
  "cf-browser-verification",
  "cf_chl_opt",
  "__cf_chl_tk",
  "cf-challenge-running",
  "Checking if the site connection is secure",
  "Checking your browser",
  "cf_clearance",
];

const CF_TURNSTILE_MARKERS = [
  "challenges.cloudflare.com/turnstile",
  "cf-turnstile",
];

const DATADOME_MARKERS = [
  "geo.captcha-delivery.com",
  "datadome.co",
];

// ── Detection ────────────────────────────────────────────────────

export async function detectChallenge(page: Page): Promise<ChallengeDetectionResult> {
  const html = await page.content();
  const url = page.url();
  const title = await page.title();
  const htmlLower = html.toLowerCase();

  // Also collect all iframe src attributes for detection
  const frameSrcs = page.frames().map((f) => f.url()).join(" ");

  // Cloudflare JS challenge (auto-resolves with valid browser fingerprint)
  if (CF_JS_MARKERS.some((m) => html.includes(m)) || title.includes("Just a moment")) {
    if (CF_TURNSTILE_MARKERS.some((m) => html.includes(m)) || frameSrcs.includes("challenges.cloudflare.com")) {
      return { type: "cloudflare_turnstile", confidence: 0.95, details: "Cloudflare Turnstile detected" };
    }
    if (html.includes("cf-challenge-running") || html.includes("cf_chl_opt")) {
      return { type: "cloudflare_js", confidence: 0.9, details: "Cloudflare JS challenge (auto-solvable)" };
    }
    return { type: "cloudflare_managed", confidence: 0.85, details: "Cloudflare managed challenge" };
  }

  // Datadome
  if (DATADOME_MARKERS.some((m) => htmlLower.includes(m.toLowerCase())) || frameSrcs.includes("captcha-delivery.com")) {
    return { type: "datadome", confidence: 0.9, details: "Datadome bot protection detected" };
  }

  // hCaptcha — check BEFORE reCAPTCHA (hCaptcha pages may also have google scripts)
  if (
    htmlLower.includes("hcaptcha.com") ||
    htmlLower.includes("h-captcha") ||
    frameSrcs.includes("hcaptcha.com")
  ) {
    return { type: "hcaptcha", confidence: 0.9, details: "hCaptcha detected" };
  }

  // reCAPTCHA
  if (
    htmlLower.includes("g-recaptcha") ||
    htmlLower.includes("grecaptcha") ||
    frameSrcs.includes("google.com/recaptcha")
  ) {
    const isV3 = htmlLower.includes("recaptcha/api.js?render=") && !htmlLower.includes("g-recaptcha");
    return {
      type: isV3 ? "recaptcha_v3" : "recaptcha_v2",
      confidence: 0.9,
      details: isV3 ? "reCAPTCHA v3 (invisible)" : "reCAPTCHA v2 (interactive)",
    };
  }

  // Generic CAPTCHA detection
  if (
    htmlLower.includes("captcha") &&
    (htmlLower.includes("<iframe") || htmlLower.includes("challenge"))
  ) {
    return { type: "generic_captcha", confidence: 0.6, details: "Generic CAPTCHA detected" };
  }

  if (html.length < 5000 && (url.includes("challenge") || title.includes("Access Denied"))) {
    return { type: "generic_captcha", confidence: 0.5, details: "Possible challenge page" };
  }

  return { type: "none", confidence: 1.0, details: "No challenge detected" };
}

// ── Cloudflare JS Challenge (wait + mouse jiggle) ────────────────

async function solveCloudflareJs(page: Page): Promise<boolean> {
  const jiggle = async () => {
    for (let i = 0; i < 8; i++) {
      await moveMouseNaturally(page, {
        x: randomBetween(100, 800),
        y: randomBetween(100, 500),
      });
      await page.waitForTimeout(Math.floor(randomBetween(800, 2000)));
    }
  };

  try {
    await Promise.race([
      page.waitForNavigation({ timeout: 25_000, waitUntil: "domcontentloaded" }),
      jiggle(),
    ]);
    const detection = await detectChallenge(page);
    return detection.type === "none";
  } catch {
    const detection = await detectChallenge(page);
    return detection.type === "none";
  }
}

// ── Turnstile Checkbox Click ─────────────────────────────────────

async function solveTurnstile(page: Page): Promise<boolean> {
  await page.waitForTimeout(Math.floor(randomBetween(1500, 3000)));

  const turnstileFrame = findFrame(page, "challenges.cloudflare.com");
  if (!turnstileFrame) {
    return solveCloudflareJs(page);
  }

  try {
    // Turnstile checkbox is an input or a clickable div
    const checkbox = await turnstileFrame.waitForSelector(
      'input[type="checkbox"], .cb-i, #challenge-stage',
      { timeout: 8_000 }
    );
    if (checkbox) {
      await clickFrameElement(page, turnstileFrame, checkbox);
    }
  } catch {
    // Try clicking center of the iframe itself
    await clickIframeCenter(page, 'iframe[src*="challenges.cloudflare.com"]');
  }

  await page.waitForTimeout(3000);
  try {
    await page.waitForNavigation({ timeout: 15_000, waitUntil: "domcontentloaded" });
  } catch { /* may not navigate */ }

  const detection = await detectChallenge(page);
  return detection.type === "none";
}

// ── reCAPTCHA v2 Browser Solver ──────────────────────────────────

async function solveRecaptchaV2(page: Page): Promise<boolean> {
  // Step 1: Find the reCAPTCHA anchor iframe and click checkbox
  const anchorFrame = findFrame(page, "google.com/recaptcha/api2/anchor")
    ?? findFrame(page, "google.com/recaptcha/enterprise/anchor");
  if (!anchorFrame) {
    // Fallback: try to click the recaptcha div on the main page
    try {
      await clickIframeCenter(page, 'iframe[src*="recaptcha"]');
      await page.waitForTimeout(3000);
    } catch {
      return false;
    }
    const detection = await detectChallenge(page);
    return detection.type === "none";
  }

  // Click the checkbox
  try {
    await anchorFrame.waitForSelector("#recaptcha-anchor", { timeout: 5_000 });
    // We need to click inside the iframe — use the iframe element's position
    await clickIframeCenter(page, 'iframe[src*="recaptcha"][src*="anchor"]');
  } catch {
    await clickIframeCenter(page, 'iframe[src*="recaptcha"]');
  }

  // Step 2: Wait to see if checkbox alone passes (low risk score)
  // Poll for solved state — checkbox may resolve after a brief delay
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.waitForTimeout(Math.floor(randomBetween(600, 1200)));
    const solvedByClick = await anchorFrame.evaluate(() => {
      const anchor = document.querySelector("#recaptcha-anchor");
      return anchor?.getAttribute("aria-checked") === "true";
    }).catch(() => false);
    if (solvedByClick) {
      return await submitCaptchaForm(page);
    }
    // If a bframe (challenge) appeared, stop waiting
    const bframe = findFrame(page, "google.com/recaptcha/api2/bframe")
      ?? findFrame(page, "google.com/recaptcha/enterprise/bframe");
    if (bframe) break;
  }

  // Step 3: Image challenge appeared — solve with CLIP vision
  const bframeFrame = findFrame(page, "google.com/recaptcha/api2/bframe")
    ?? findFrame(page, "google.com/recaptcha/enterprise/bframe");
  if (!bframeFrame) {
    // No challenge frame appeared — might have auto-solved or timed out
    const detection = await detectChallenge(page);
    return detection.type === "none";
  }

  return solveImageChallenge(page, bframeFrame);
}

// ── hCaptcha Browser Solver ──────────────────────────────────────

async function solveHcaptcha(page: Page): Promise<boolean> {
  // Find hCaptcha checkbox iframe
  const checkboxFrame = findFrameByHash(page, "frame=checkbox")
    ?? findFrame(page, "hcaptcha.com/hs/frame/checkbox")
    ?? findFrame(page, "assets.hcaptcha.com");
  if (!checkboxFrame) {
    // Try clicking the hcaptcha container or iframe directly
    try {
      await clickIframeCenter(page, 'iframe[src*="hcaptcha"]');
      await page.waitForTimeout(3000);
      const detection = await detectChallenge(page);
      return detection.type === "none";
    } catch {
      return false;
    }
  }

  // Click checkbox
  try {
    const cb = await checkboxFrame.waitForSelector("#checkbox, .checkbox", { timeout: 5_000 });
    if (cb) {
      await clickFrameElement(page, checkboxFrame, cb);
    } else {
      await clickIframeCenter(page, 'iframe[src*="hcaptcha"]');
    }
  } catch {
    await clickIframeCenter(page, 'iframe[src*="hcaptcha"]');
  }

  // Poll for solved state
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.waitForTimeout(Math.floor(randomBetween(600, 1200)));
    const solved = await checkboxFrame.evaluate(() => {
      const el = document.querySelector("#checkbox");
      return el?.getAttribute("aria-checked") === "true";
    }).catch(() => false);
    if (solved) return await submitCaptchaForm(page);
    // If challenge frame appeared, stop waiting
    const cf = findFrameByHash(page, "frame=challenge")
      ?? findFrame(page, "hcaptcha.com/hs/frame/challenge")
      ?? findFrame(page, "hcaptcha.com/hs/frame/task");
    if (cf) break;
  }

  // Challenge appeared — solve with CLIP image classification
  // Find challenge frame (hCaptcha uses newassets.hcaptcha.com with #frame=challenge)

  const challengeFrame = findFrameByHash(page, "frame=challenge")
    ?? findFrame(page, "hcaptcha.com/hs/frame/challenge")
    ?? findFrame(page, "hcaptcha.com/hs/frame/task")
    ?? findFrame(page, "newassets.hcaptcha.com")
    ?? findFrame(page, "hcaptcha.com/captcha");
  if (!challengeFrame) {
    console.error("[captcha] hCaptcha: No challenge frame found");
    const detection = await detectChallenge(page);
    return detection.type === "none";
  }

  return solveHcaptchaImageChallenge(page, challengeFrame);
}

// ── hCaptcha Image Challenge Solver (CLIP vision) ────────────────

async function solveHcaptchaImageChallenge(page: Page, initialFrame: Frame): Promise<boolean> {
  const clip = await getClipPipeline();

  for (let round = 0; round < 8; round++) {
    const cf = findFrameByHash(page, "frame=challenge")
      ?? findFrame(page, "newassets.hcaptcha.com")
      ?? findFrame(page, "hcaptcha.com/hs/frame/challenge")
      ?? findFrame(page, "hcaptcha.com/hs/frame/task")
      ?? initialFrame;

    // Wait for challenge to render
    await page.waitForTimeout(Math.floor(randomBetween(1500, 2500)));

    // Extract target text and detect challenge type
    const challengeInfo = await cf.evaluate(() => {
      // Check for prompt text (image selection challenges)
      const prompt = document.querySelector(".prompt-text span, .prompt-text, .challenge-prompt .prompt-text");
      const promptText = prompt?.textContent?.trim() ?? "";

      // Detect drag/puzzle type challenges
      const hasDraggable = !!document.querySelector("[draggable], .draggable, .puzzle-piece, .drag-wrapper");
      const hasCanvas = !!document.querySelector("canvas.challenge-canvas, canvas");
      // Detect "drag" / "ziehen" / "glisser" in prompt
      const isDragPrompt = /drag|ziehen|glisser|déplacer|schieben/i.test(promptText);

      // Get all visible task images
      const taskImages = document.querySelectorAll(".task-image .image, .task-image, .challenge-answer .image, .task .image");

      return {
        promptText,
        taskImageCount: taskImages.length,
        isDragPuzzle: hasDraggable || hasCanvas || isDragPrompt,
      };
    }).catch(() => ({ promptText: "", taskImageCount: 0, isDragPuzzle: false }));

    console.error(`[captcha] hCaptcha round ${round + 1}: "${challengeInfo.promptText}" (tiles: ${challengeInfo.taskImageCount}, drag: ${challengeInfo.isDragPuzzle})`);

    // If solved already
    if (!challengeInfo.promptText) {
      if ((await detectChallenge(page)).type === "none") return true;
      // No prompt — try refreshing the challenge
      const refreshBtn = await cf.$(".refresh.button, button.refresh, [aria-label='Get a new challenge']");
      if (refreshBtn) {
        console.error("[captcha] hCaptcha: Refreshing challenge...");
        await clickFrameElement(page, cf, refreshBtn);
        await page.waitForTimeout(Math.floor(randomBetween(2000, 3000)));
        continue;
      }
      return false;
    }

    // Handle drag/puzzle challenges — try to solve by finding and dragging
    if (challengeInfo.isDragPuzzle) {
      // Detect specific game types that can't be solved with drag
      const gameType = await detectHcaptchaGameType(cf);
      console.error(`[captcha] hCaptcha: Drag puzzle detected (game: ${gameType}) — attempting drag solve`);

      if (gameType === "unsolvable") {
        // Skip unsolvable game types (penguin road, dice, etc.) — refresh for image grid
        console.error("[captcha] hCaptcha: Unsolvable game type — refreshing");
        const refreshBtn = await cf.$(".refresh.button, button.refresh, [aria-label='Get a new challenge']");
        if (refreshBtn) {
          await clickFrameElement(page, cf, refreshBtn);
          await page.waitForTimeout(Math.floor(randomBetween(2000, 3000)));
        }
        continue;
      }

      const dragSolved = await solveHcaptchaDragPuzzle(page, cf);
      if (dragSolved) return true;
      // If drag failed, try refreshing for image grid
      const refreshBtn = await cf.$(".refresh.button, button.refresh, [aria-label='Get a new challenge']");
      if (refreshBtn) {
        console.error("[captcha] hCaptcha: Refreshing for image challenge...");
        await clickFrameElement(page, cf, refreshBtn);
        await page.waitForTimeout(Math.floor(randomBetween(2000, 3000)));
        continue;
      }
      continue;
    }

    // Image grid challenge
    const tiles = await cf.$$(".task-image .image, .task-image, .challenge-answer .image, .task .image");
    if (tiles.length === 0) {
      console.error("[captcha] hCaptcha: No image tiles found");
      // Refresh
      const refreshBtn = await cf.$(".refresh.button, button.refresh, [aria-label='Get a new challenge']");
      if (refreshBtn) {
        await clickFrameElement(page, cf, refreshBtn);
        await page.waitForTimeout(Math.floor(randomBetween(2000, 3000)));
        continue;
      }
      return false;
    }

    // Clean up prompt to extract the visual target
    const target = extractHcaptchaTarget(challengeInfo.promptText);

    console.error(`[captcha] hCaptcha: ${tiles.length} tiles, target: "${target}"`);

    if (clip && target) {
      const targetLabels = expandTarget(target);
      const allLabels = [...targetLabels, ...NEGATIVE_LABELS];

      const scored = await classifyTiles(clip, tiles, targetLabels, allLabels);
      const matches = selectByAdaptiveThreshold(scored, tiles.length > 9);

      for (const m of matches) {
        const tile = tiles[m.index];
        if (tile) {
          console.error(`  Tile ${m.index + 1}: ${m.score.toFixed(3)} MATCH`);
          await clickFrameElement(page, cf, tile);
          await page.waitForTimeout(Math.floor(randomBetween(300, 600)));
        }
      }
    } else {
      // No CLIP — random selection
      const count = Math.floor(randomBetween(2, 4));
      const indices = new Set<number>();
      while (indices.size < Math.min(count, tiles.length)) indices.add(Math.floor(Math.random() * tiles.length));
      for (const idx of indices) {
        const tile = tiles[idx];
        if (tile) { await clickFrameElement(page, cf, tile); await page.waitForTimeout(Math.floor(randomBetween(300, 700))); }
      }
    }

    // Click verify/submit
    await page.waitForTimeout(Math.floor(randomBetween(500, 1000)));
    await clickHcaptchaSubmit(page, cf);

    await page.waitForTimeout(Math.floor(randomBetween(2000, 4000)));

    // Check if solved
    if (await isHcaptchaSolved(page)) return await submitCaptchaForm(page);
    if ((await detectChallenge(page)).type === "none") return true;
  }
  return false;
}

/**
 * Detect what type of hCaptcha game is being shown.
 * Returns "slider" for solvable drag puzzles, "unsolvable" for interactive games
 * (penguin road crossing, dice matching, etc.) that need game-specific strategies.
 */
async function detectHcaptchaGameType(frame: Frame): Promise<"slider" | "unsolvable"> {
  return frame.evaluate(() => {
    const prompt = (document.querySelector(".prompt-text span, .prompt-text")?.textContent ?? "").toLowerCase();
    // Known unsolvable game patterns (interactive canvas games, not drag-to-cutout)
    const unsolvablePatterns = [
      /penguin/i, /road/i, /cross/i, /dice/i, /roll/i, /rotate/i,
      /match.*piece/i, /jigsaw/i, /puzzle.*piece/i, /connect/i,
      /path/i, /navigate/i, /guide/i, /steer/i, /avoid/i,
      /catch/i, /collect/i, /pop/i, /count/i, /sequence/i,
    ];
    for (const pat of unsolvablePatterns) {
      if (pat.test(prompt)) return "unsolvable";
    }
    // Check for multi-canvas (game typically has overlapping canvases)
    const canvases = document.querySelectorAll("canvas");
    if (canvases.length > 2) return "unsolvable";
    return "slider";
  }).catch(() => "slider" as const);
}

async function solveHcaptchaDragPuzzle(page: Page, frame: Frame): Promise<boolean> {
  // hCaptcha drag/slider puzzle: drag piece horizontally to match cutout.
  // Strategy: try DOM piece first, then canvas with pixel analysis to find cutout.

  // Look for DOM-based puzzle piece
  const pieceSelectors = [
    ".challenge-answer .border-focus",
    ".challenge-answer .image",
    "[draggable='true']",
    ".draggable",
    ".puzzle-piece",
    ".drag-wrapper",
    ".challenge-answer > div",
  ];

  let piece: ElementHandle | null = null;
  for (const sel of pieceSelectors) {
    piece = await frame.$(sel);
    if (piece) {
      const box = await piece.boundingBox();
      if (box && box.width > 10 && box.height > 10) {
        console.error(`[captcha] hCaptcha: Found piece with selector "${sel}"`);
        break;
      }
      piece = null;
    }
  }

  // Try to find target cutout position via canvas pixel analysis
  const cutoutX = await findCutoutPosition(frame);

  if (piece) {
    const pieceBox = await piece.boundingBox();
    if (!pieceBox) return false;

    // Find target area for endX
    let targetEl: ElementHandle | null = null;
    for (const sel of [".challenge-container .image", ".challenge-container > div", ".challenge-image", "canvas"]) {
      targetEl = await frame.$(sel);
      if (targetEl) {
        const box = await targetEl.boundingBox();
        if (box && box.width > 50 && box.height > 50) break;
        targetEl = null;
      }
    }
    const targetBox = targetEl ? await targetEl.boundingBox() : null;

    const startX = pieceBox.x + pieceBox.width / 2;
    const startY = pieceBox.y + pieceBox.height / 2;
    let endX: number;
    let endY: number;

    if (cutoutX !== null && targetBox) {
      // Pixel analysis found the cutout — cutoutX is a fraction (0-1) of canvas width
      endX = targetBox.x + targetBox.width * cutoutX;
      endY = startY; // horizontal drag, keep Y same
      console.error(`[captcha] hCaptcha: Pixel analysis found cutout at ${(cutoutX * 100).toFixed(0)}%`);
    } else if (targetBox) {
      endX = targetBox.x + targetBox.width * randomBetween(0.35, 0.65);
      endY = targetBox.y + targetBox.height * randomBetween(0.35, 0.65);
    } else {
      endX = pieceBox.x - pieceBox.width * 1.5;
      endY = startY;
    }

    console.error(`[captcha] hCaptcha: Dragging piece (${Math.round(startX)},${Math.round(startY)}) → (${Math.round(endX)},${Math.round(endY)})`);
    await performDrag(page, startX, startY, endX, endY);
  } else {
    // No DOM piece — canvas-only puzzle
    const canvas = await frame.$("canvas");
    if (!canvas) {
      console.error("[captcha] hCaptcha: No puzzle elements or canvas found");
      return false;
    }
    const box = await canvas.boundingBox();
    if (!box) return false;

    // Canvas game area: header ~110px, game below
    const headerH = 110;
    const gameTop = box.y + headerH;
    const gameH = box.height - headerH;

    // Try systematic positions: if cutout pixel analysis worked, use it
    if (cutoutX !== null) {
      const startX = box.x + box.width * 0.80;
      const startY = gameTop + gameH * 0.5;
      const endX = box.x + box.width * cutoutX;
      const endY = startY;
      console.error(`[captcha] hCaptcha: Canvas drag to cutout at ${(cutoutX * 100).toFixed(0)}%`);
      await performDrag(page, startX, startY, endX, endY);
    } else {
      // Systematic scan: try multiple X positions across the image
      // The outer loop in solveHcaptchaImageChallenge gives us multiple rounds,
      // so we pick a different position each time based on timestamp
      const positions = [0.25, 0.35, 0.45, 0.55, 0.20, 0.60, 0.15, 0.40];
      const posIdx = Math.floor(Date.now() / 1000) % positions.length;
      const targetFrac = positions[posIdx]!;

      const startX = box.x + box.width * randomBetween(0.70, 0.85);
      const startY = gameTop + gameH * randomBetween(0.35, 0.65);
      const endX = box.x + box.width * targetFrac;
      const endY = startY;

      console.error(`[captcha] hCaptcha: Canvas systematic drag to ${(targetFrac * 100).toFixed(0)}%`);
      await performDrag(page, startX, startY, endX, endY);
    }
  }

  await page.waitForTimeout(Math.floor(randomBetween(1500, 2500)));

  // Some hCaptcha puzzles auto-submit on correct drag, check before clicking submit
  if (await isHcaptchaSolved(page)) return true;

  await clickHcaptchaSubmit(page, frame);
  await page.waitForTimeout(Math.floor(randomBetween(2000, 3000)));
  return await isHcaptchaSolved(page);
}

/**
 * Analyze canvas pixels to find the puzzle cutout position.
 * The cutout is typically a darker shadow area or a region with distinct
 * luminance difference from its surroundings.
 * Returns the X coordinate within the canvas, or null if detection fails.
 */
async function findCutoutPosition(frame: Frame): Promise<number | null> {
  try {
    return await frame.evaluate(() => {
      const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
      if (!canvas) return null;

      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      const w = canvas.width;
      const h = canvas.height;
      if (w < 100 || h < 100) return null;

      let data: ImageData;
      try {
        data = ctx.getImageData(0, 0, w, h);
      } catch {
        return null; // Canvas tainted by CORS
      }

      // Scan for the cutout: look for columns with high edge density.
      // The puzzle cutout has strong vertical edges (shadow border).
      // Skip header area (~25% of height from top)
      const startRow = Math.floor(h * 0.25);
      const endRow = Math.floor(h * 0.90);
      const scanH = endRow - startRow;

      // Calculate column-wise edge intensity (horizontal gradient)
      const colEdge = new Float64Array(w);
      for (let x = 1; x < w - 1; x++) {
        let edgeSum = 0;
        for (let y = startRow; y < endRow; y++) {
          const idx = (y * w + x) * 4;
          const idxL = (y * w + x - 1) * 4;
          const idxR = (y * w + x + 1) * 4;
          // Luminance difference between neighboring pixels
          const lumL = data.data[idxL]! * 0.299 + data.data[idxL + 1]! * 0.587 + data.data[idxL + 2]! * 0.114;
          const lumR = data.data[idxR]! * 0.299 + data.data[idxR + 1]! * 0.587 + data.data[idxR + 2]! * 0.114;
          const diff = Math.abs(lumR - lumL);
          if (diff > 20) edgeSum += diff; // Only count significant edges
        }
        colEdge[x] = edgeSum / scanH;
      }

      // Find pairs of high-edge columns ~40-80px apart (piece width)
      // The cutout has a left edge and right edge (shadow borders)
      const pieceMinW = Math.floor(w * 0.08);
      const pieceMaxW = Math.floor(w * 0.25);
      const edgeThreshold = 8; // Minimum average edge intensity

      let bestScore = 0;
      let bestX = -1;

      for (let x = Math.floor(w * 0.05); x < w * 0.70; x++) {
        if (colEdge[x]! < edgeThreshold) continue;
        // Look for matching right edge
        for (let dx = pieceMinW; dx <= pieceMaxW; dx++) {
          const rx = x + dx;
          if (rx >= w) break;
          if (colEdge[rx]! < edgeThreshold) continue;
          const score = colEdge[x]! + colEdge[rx]!;
          if (score > bestScore) {
            bestScore = score;
            bestX = x + dx / 2; // Center of the cutout
          }
        }
      }

      if (bestX > 0 && bestScore > edgeThreshold * 3) {
        return bestX / w; // Return as fraction (0-1) of canvas width
      }
      return null;
    });
  } catch {
    return null;
  }
}

async function performDrag(page: Page, startX: number, startY: number, endX: number, endY: number): Promise<void> {
  await moveMouseNaturally(page, { x: startX, y: startY });
  await page.waitForTimeout(Math.floor(randomBetween(200, 400)));
  await page.mouse.down();
  await page.waitForTimeout(Math.floor(randomBetween(100, 200)));

  const steps = Math.floor(randomBetween(18, 30));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = t * t * (3 - 2 * t); // smoothstep
    await page.mouse.move(
      startX + (endX - startX) * eased + randomBetween(-1, 1),
      startY + (endY - startY) * eased + randomBetween(-1, 1),
    );
    await page.waitForTimeout(Math.floor(randomBetween(15, 35)));
  }
  await page.mouse.up();
}

async function clickHcaptchaSubmit(page: Page, frame: Frame): Promise<void> {
  const submitBtn = await frame.$(".button-submit, .submit-button, button[type='submit']");
  if (submitBtn) {
    await clickFrameElement(page, frame, submitBtn);
    return;
  }
  const btns = await frame.$$("button, .button");
  for (const btn of btns) {
    const text = await btn.textContent().catch(() => "");
    if (text && /verify|submit|check|next|überprüfen|vérifier|prüfen|weiter/i.test(text)) {
      await clickFrameElement(page, frame, btn);
      return;
    }
  }
}

async function isHcaptchaSolved(page: Page): Promise<boolean> {
  const checkboxFrame = findFrame(page, "hcaptcha.com/hs/frame/checkbox")
    ?? findFrame(page, "newassets.hcaptcha.com");
  if (!checkboxFrame) return false;
  return checkboxFrame.evaluate(() => {
    const el = document.querySelector("#checkbox");
    return el?.getAttribute("aria-checked") === "true";
  }).catch(() => false);
}

// ── Audio Challenge Solver (shared for reCAPTCHA/hCaptcha) ───────

async function solveAudioChallenge(
  page: Page,
  challengeFrame: Frame,
  provider: "recaptcha" | "hcaptcha"
): Promise<boolean> {
  // Click audio challenge button
  const audioButtonSelector = provider === "recaptcha"
    ? "#recaptcha-audio-button, button.rc-button-audio"
    : ".button-default, [data-cy='audio-button'], a[title='Get an audio challenge']";

  try {
    const audioBtn = await challengeFrame.waitForSelector(audioButtonSelector, { timeout: 5_000 });
    if (audioBtn) {
      await clickFrameElement(page, challengeFrame, audioBtn);
    }
  } catch {
    // Try finding audio button by text
    try {
      const btns = await challengeFrame.$$("button");
      for (const btn of btns) {
        const text = await btn.textContent();
        if (text && (text.toLowerCase().includes("audio") || text.toLowerCase().includes("listen"))) {
          await clickFrameElement(page, challengeFrame, btn);
          break;
        }
      }
    } catch {
      return false;
    }
  }

  await page.waitForTimeout(Math.floor(randomBetween(2000, 4000)));

  // Check if Google blocked audio challenge (shows "Try again later" or error)
  const audioBlocked = await challengeFrame.evaluate(() => {
    const errorEl = document.querySelector(".rc-audiochallenge-error-message, .display-error");
    if (errorEl) {
      const text = errorEl.textContent ?? "";
      return text.includes("Try again later") || text.includes("automated");
    }
    return false;
  }).catch(() => false);
  if (audioBlocked) {
    console.error("[captcha] Audio challenge blocked by provider — automated queries detected");
    return false;
  }

  // Wait for audio element to load (may take a few seconds)
  try {
    await challengeFrame.waitForSelector(
      provider === "recaptcha" ? "#audio-source, .rc-audiochallenge-tdownload-link a" : "audio source, audio[src]",
      { timeout: 8_000 }
    );
  } catch {
    console.error("[captcha] Audio element did not appear within timeout — audio challenge unavailable");
    return false;
  }

  // Get audio URL
  const audioUrl = await getAudioUrl(challengeFrame, provider);
  if (!audioUrl || !audioUrl.startsWith("http")) {
    console.error(`[captcha] No valid audio URL found for ${provider} (got: ${audioUrl ?? "null"})`);
    return false;
  }

  // Download audio
  const audioPath = join(tmpdir(), `captcha-${randomUUID()}.mp3`);
  try {
    const response = await fetch(audioUrl, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      console.error(`[captcha] Audio download failed: HTTP ${response.status}`);
      return false;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(audioPath, buffer);

    // Transcribe
    const transcript = await transcribeAudio(audioPath);
    if (!transcript) {
      console.error("[captcha] Audio transcription failed (no Whisper available — install @xenova/transformers or whisper CLI)");
      return false;
    }

    console.error(`[captcha] Audio transcription: "${transcript}"`);

    // Type the answer
    const answerSelector = provider === "recaptcha"
      ? "#audio-response"
      : "input[data-cy='audio-answer'], input.challenge-input, input[type='text']";

    const answerInput = await challengeFrame.waitForSelector(answerSelector, { timeout: 5_000 });
    if (!answerInput) {
      console.error("[captcha] Answer input not found");
      return false;
    }

    // Focus and type with human-like delays
    await answerInput.click();
    await page.waitForTimeout(Math.floor(randomBetween(200, 500)));
    for (const char of transcript) {
      await page.keyboard.type(char);
      await page.waitForTimeout(Math.floor(randomBetween(60, 160)));
    }

    await page.waitForTimeout(Math.floor(randomBetween(300, 700)));

    // Click verify
    const verifySelector = provider === "recaptcha"
      ? "#recaptcha-verify-button, button.rc-button-default"
      : "button.button-submit, [data-cy='submit-answer']";

    try {
      const verifyBtn = await challengeFrame.waitForSelector(verifySelector, { timeout: 5_000 });
      if (verifyBtn) {
        await clickFrameElement(page, challengeFrame, verifyBtn);
      }
    } catch {
      // Try pressing Enter as fallback
      await page.keyboard.press("Enter");
    }

    await page.waitForTimeout(Math.floor(randomBetween(3000, 5000)));

    return await submitCaptchaForm(page);
  } finally {
    await rm(audioPath, { force: true }).catch(() => {});
  }
}

async function getAudioUrl(frame: Frame, provider: "recaptcha" | "hcaptcha"): Promise<string | null> {
  return frame.evaluate((p: string) => {
    if (p === "recaptcha") {
      // Try download link first
      const link = document.querySelector(".rc-audiochallenge-tdownload-link a") as HTMLAnchorElement | null;
      if (link?.href) return link.href;
      // Try audio source element
      const source = document.querySelector("#audio-source") as HTMLSourceElement | null;
      if (source?.src) return source.src;
      // Try audio element directly
      const audio = document.querySelector("audio") as HTMLAudioElement | null;
      return audio?.src ?? null;
    }
    // hCaptcha
    const source = document.querySelector("audio source") as HTMLSourceElement | null;
    if (source?.src) return source.src;
    const audio = document.querySelector("audio") as HTMLAudioElement | null;
    return audio?.src ?? null;
  }, provider);
}

// ── Image Challenge Solver (reCAPTCHA v2 — CLIP vision) ──────────

let _clipPipeline: ((img: string, labels: string[]) => Promise<Array<{ label: string; score: number }>>) | null | "unavailable" = null;

async function getClipPipeline() {
  if (_clipPipeline === "unavailable") return null;
  if (_clipPipeline) return _clipPipeline;
  try {
    const { pipeline } = await import("@xenova/transformers");
    console.error("[captcha] Loading CLIP-large model for image challenges (~900MB first run, cached after)...");
    const pipe = await pipeline("zero-shot-image-classification", "Xenova/clip-vit-large-patch14");
    _clipPipeline = async (imgPath: string, labels: string[]) => {
      return (await (pipe as Function)(imgPath, labels)) as Array<{ label: string; score: number }>;
    };
    console.error("[captcha] CLIP model loaded");
    return _clipPipeline;
  } catch (err) {
    console.error("[captcha] CLIP unavailable:", err);
    _clipPipeline = "unavailable";
    return null;
  }
}

const LABEL_SYNONYMS: Record<string, string[]> = {
  crosswalk: ["crosswalk", "pedestrian crossing", "zebra crossing"],
  "traffic light": ["traffic light", "traffic signal", "stoplight"],
  bus: ["bus", "city bus", "public transit bus"],
  bicycle: ["bicycle", "bike", "cycling"],
  motorcycle: ["motorcycle", "motorbike"],
  "fire hydrant": ["fire hydrant", "hydrant"],
  car: ["car", "automobile"],
  taxi: ["taxi", "yellow cab"],
  boat: ["boat", "ship"],
  tractor: ["tractor", "farm vehicle"],
  chimney: ["chimney", "smokestack"],
  stair: ["stairs", "staircase", "steps"],
  mountain: ["mountain", "hill"],
  "palm tree": ["palm tree"],
  bridge: ["bridge", "overpass"],
  "parking meter": ["parking meter"],
};
const NEGATIVE_LABELS = [
  "building", "road", "sky", "tree", "sidewalk", "wall", "ground",
  "street", "pavement", "fence", "pole", "sign", "window", "roof",
  "grass", "cloud", "shadow", "empty road", "concrete",
];

// ── Multi-language label translation (CAPTCHA labels depend on browser locale)
const LABEL_TRANSLATIONS: Record<string, string> = {
  // German
  fahrrad: "bicycle", fahrräder: "bicycle", fahrrädern: "bicycle",
  motorrad: "motorcycle", motorräder: "motorcycle", motorrädern: "motorcycle",
  ampel: "traffic light", ampeln: "traffic light",
  zebrastreifen: "crosswalk", fussgängerüberweg: "crosswalk", fußgängerüberweg: "crosswalk",
  pkw: "car", pkws: "car", auto: "car", autos: "car",
  hydrant: "fire hydrant", hydranten: "fire hydrant",
  treppe: "stairs", treppen: "stairs",
  brücke: "bridge", brücken: "bridge",
  schornstein: "chimney", schornsteine: "chimney",
  berg: "mountain", berge: "mountain",
  palme: "palm tree", palmen: "palm tree",
  taxi: "taxi", taxis: "taxi",
  parkuhr: "parking meter", parkuhren: "parking meter",
  traktor: "tractor", traktoren: "tractor",
  schiff: "boat", boot: "boat", boote: "boat",
  // French
  vélo: "bicycle", vélos: "bicycle",
  moto: "motorcycle", motos: "motorcycle",
  "feu de signalisation": "traffic light", "feux de signalisation": "traffic light",
  "passage piéton": "crosswalk", "passages piétons": "crosswalk",
  "bouche d'incendie": "fire hydrant",
  escalier: "stairs", escaliers: "stairs",
  pont: "bridge", ponts: "bridge",
  cheminée: "chimney", cheminées: "chimney",
  montagne: "mountain", montagnes: "mountain",
  palmier: "palm tree", palmiers: "palm tree",
  tracteur: "tractor", tracteurs: "tractor",
  bateau: "boat", bateaux: "boat",
  autobus: "bus",
  voiture: "car", voitures: "car",
};

/**
 * Extract the visual target from hCaptcha prompt text.
 * hCaptcha prompts are more complex than reCAPTCHA:
 *   "Please click each image containing a bus"
 *   "Please click on all animals too big to carry inside the reference"
 *   "Please click on the item that is not food"
 *   "Bitte klicken Sie auf jedes Bild mit einem Motorrad"
 */
function extractHcaptchaTarget(prompt: string): string {
  let text = prompt.trim();

  // English patterns
  text = text
    .replace(/^please /i, "")
    .replace(/^(click|select|choose|tap) (on )?(each|all|every) (image|photo|picture|square)s? (containing|of|with|that contain|showing|that show) (a |an |the )?/i, "")
    .replace(/^(click|select|choose|tap) (on )?(each|all|every) /i, "")
    .replace(/^(click|select|choose|tap) (on )?(the |a |an )?/i, "")
    .replace(/ (in|inside|within|from) the (reference|image|photo|picture)$/i, "")
    .replace(/[.!]$/i, "")
    .trim();

  // German patterns
  text = text
    .replace(/^bitte (klicken|wählen|tippen) sie (auf )?(jedes bild|alle bilder|jedes foto) (mit|von|das) (einem |einer |den |die |das )?/i, "")
    .replace(/^bitte (klicken|wählen|tippen) sie (auf )?(alle |jedes |jeden |jede )?/i, "")
    .trim();

  // French patterns
  text = text
    .replace(/^(veuillez )?cliquez sur (chaque|toutes les|tous les|les) (image|photo)s? (contenant|de|avec|montrant|qui contien(nen)?t) (un |une |le |la |les |des |l')?/i, "")
    .replace(/^(veuillez )?cliquez sur (chaque|toutes les|tous les|les) /i, "")
    .trim();

  // Translate if non-English
  return translateLabel(text);
}

/** Translate non-English CAPTCHA labels to English for CLIP */
function translateLabel(raw: string): string {
  const lower = raw.toLowerCase().trim();
  // Direct lookup
  if (LABEL_TRANSLATIONS[lower]) return LABEL_TRANSLATIONS[lower];
  // Try without trailing plural/case suffixes
  const stripped = lower.replace(/[ns]$/, "");
  if (LABEL_TRANSLATIONS[stripped]) return LABEL_TRANSLATIONS[stripped];
  // Check if any translation key is contained in the raw string
  for (const [key, val] of Object.entries(LABEL_TRANSLATIONS)) {
    if (lower.includes(key)) return val;
  }
  return raw; // Return as-is if no translation found
}

function expandTarget(raw: string): string[] {
  // Translate non-English labels first
  const translated = translateLabel(raw);
  const lower = translated.toLowerCase().replace(/s$/, "");
  for (const [key, synonyms] of Object.entries(LABEL_SYNONYMS)) {
    if (lower.includes(key) || key.includes(lower)) return synonyms;
  }
  // If translation produced a different result, use it; otherwise use raw
  return [translated.toLowerCase()];
}

async function classifyTiles(
  clip: NonNullable<Awaited<ReturnType<typeof getClipPipeline>>>,
  tiles: ElementHandle[],
  targetLabels: string[],
  allLabels: string[],
): Promise<Array<{ index: number; score: number }>> {
  const scored: Array<{ index: number; score: number }> = [];
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]!;
    const tilePath = join(tmpdir(), `tile-${randomUUID()}.png`);
    try {
      await writeFile(tilePath, await tile.screenshot());
      const scores = await clip(tilePath, allLabels);
      // Use MAX score across synonyms (not sum) — synonyms split softmax mass
      let best = 0;
      for (const sc of scores) {
        if (targetLabels.includes(sc.label) && sc.score > best) best = sc.score;
      }
      scored.push({ index: i, score: best });
    } finally {
      await rm(tilePath, { force: true }).catch(() => {});
    }
  }
  return scored;
}

/**
 * Select tiles that match the target based on CLIP scores.
 * CLIP-large produces well-separated scores: targets 0.25-0.87, background 0.01-0.19.
 * Uses a fixed threshold with a cap on max selections.
 */
function selectByAdaptiveThreshold(
  scored: Array<{ index: number; score: number }>,
  is4x4: boolean,
): Array<{ index: number; score: number }> {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const minScore = 0.20; // threshold between target and background
  const maxSelect = is4x4 ? 6 : 5;

  const candidates = sorted.filter((t) => t.score >= minScore);
  if (candidates.length === 0) {
    console.error(`[captcha] Adaptive: best score ${sorted[0]?.score.toFixed(3) ?? "0"} < ${minScore}, skipping`);
    return [];
  }

  const selected = candidates.slice(0, maxSelect);
  console.error(`[captcha] Adaptive: ${candidates.length} above ${minScore}, selecting ${selected.length}/${sorted.length}`);
  return selected;
}

async function solveImageChallenge(page: Page, _initialFrame: Frame): Promise<boolean> {
  const clip = await getClipPipeline();
  let blankRounds = 0;

  for (let round = 0; round < 8; round++) {
    const bframeFrame = findFrame(page, "google.com/recaptcha/api2/bframe")
      ?? findFrame(page, "google.com/recaptcha/enterprise/bframe")
      ?? _initialFrame;

    const target = await bframeFrame.evaluate(() => {
      const strong = document.querySelector(".rc-imageselect-desc strong, .rc-imageselect-desc-wrapper strong, .rc-imageselect-desc-no-canonical strong");
      if (strong?.textContent?.trim()) return strong.textContent.trim();
      const desc = document.querySelector(".rc-imageselect-desc-wrapper, .rc-imageselect-desc");
      return (desc?.textContent?.trim() ?? "").replace(/select all (images|squares) with /i, "").replace(/click verify.*/i, "").trim();
    }).catch(() => "");

    console.error(`[captcha] Image round ${round + 1}: "${target || "(none)"}"`);
    if (!target) {
      // No target text — challenge frame may have disappeared (solved)
      // Check if reCAPTCHA checkbox is now checked
      const af = findFrame(page, "google.com/recaptcha/api2/anchor")
        ?? findFrame(page, "google.com/recaptcha/enterprise/anchor");
      if (af) {
        const checked = await af.evaluate(() =>
          document.querySelector("#recaptcha-anchor")?.getAttribute("aria-checked") === "true"
        ).catch(() => false);
        if (checked) {
          console.error("[captcha] Challenge gone, checkbox checked — solved!");
          return await submitCaptchaForm(page);
        }
      }
      return false;
    }

    const tiles = await bframeFrame.$$("td.rc-imageselect-tile");
    if (tiles.length === 0) { console.error("[captcha] No tiles"); return false; }

    const is4x4 = await bframeFrame.evaluate(() => !!document.querySelector(".rc-imageselect-table-44")).catch(() => false);

    // Wait for tiles to fully load (images may still be rendering)
    await page.waitForTimeout(Math.floor(randomBetween(800, 1500)));

    if (clip) {
      const targetLabels = expandTarget(target);
      const allLabels = [...targetLabels, ...NEGATIVE_LABELS];

      const scored = await classifyTiles(clip, tiles, targetLabels, allLabels);

      // Log all scores for diagnostics
      const sortedScores = [...scored].sort((a, b) => b.score - a.score);
      console.error(`[captcha] Scores: ${sortedScores.slice(0, 5).map(s => `T${s.index + 1}=${s.score.toFixed(3)}`).join(" ")}`);

      const matches = selectByAdaptiveThreshold(scored, is4x4);

      if (matches.length === 0) {
        blankRounds++;
        if (blankRounds >= 2) {
          // Multiple blank rounds — tiles are broken, try audio fallback
          console.error("[captcha] Multiple blank rounds — switching to audio");
          const audioResult = await solveAudioChallenge(page, bframeFrame, "recaptcha");
          if (audioResult) return true;
          // Audio failed too — try new challenge
        }
        console.error("[captcha] No confident matches — requesting new challenge");
        const newChallengeBtn = await bframeFrame.$("#recaptcha-reload-button, button.rc-button-reload").catch(() => null);
        if (newChallengeBtn) {
          await clickFrameElement(page, bframeFrame, newChallengeBtn);
          await page.waitForTimeout(Math.floor(randomBetween(2000, 3000)));
        }
        continue;
      }
      blankRounds = 0; // Reset on successful classification

      for (const m of matches) {
        const tile = tiles[m.index];
        if (tile) {
          console.error(`  Tile ${m.index + 1}: ${m.score.toFixed(3)} MATCH`);
          await clickFrameElement(page, bframeFrame, tile);
          await page.waitForTimeout(is4x4 ? Math.floor(randomBetween(1500, 2500)) : Math.floor(randomBetween(200, 400)));
        }
      }
    } else {
      // Fallback: random tile selection
      const count = is4x4 ? Math.floor(randomBetween(2, 4)) : Math.floor(randomBetween(3, 5));
      const indices = new Set<number>();
      while (indices.size < Math.min(count, tiles.length)) indices.add(Math.floor(Math.random() * tiles.length));
      for (const idx of indices) {
        const tile = tiles[idx];
        if (tile) { await clickFrameElement(page, bframeFrame, tile); await page.waitForTimeout(Math.floor(randomBetween(300, 700))); }
      }
    }

    // For 4x4 dynamic grids, re-check for refreshed tiles before clicking Verify
    if (is4x4 && clip) {
      await page.waitForTimeout(Math.floor(randomBetween(2000, 3000)));
      const newTiles = await bframeFrame.$$("td.rc-imageselect-tile");
      if (newTiles.length > 0) {
        const targetLabels = expandTarget(target);
        const allLabels = [...targetLabels, ...NEGATIVE_LABELS];
        const newScored = await classifyTiles(clip, newTiles, targetLabels, allLabels);
        const newMatches = selectByAdaptiveThreshold(newScored, true);
        for (const m of newMatches) {
          const tile = newTiles[m.index];
          if (tile) {
            console.error(`  Re-check T${m.index + 1}: ${m.score.toFixed(3)} MATCH`);
            await clickFrameElement(page, bframeFrame, tile);
            await page.waitForTimeout(Math.floor(randomBetween(1500, 2500)));
          }
        }
      }
    }

    await page.waitForTimeout(Math.floor(randomBetween(500, 1000)));
    const verifyBtn = await bframeFrame.$("#recaptcha-verify-button, button.rc-button-default");
    if (verifyBtn) await clickFrameElement(page, bframeFrame, verifyBtn);
    else await page.keyboard.press("Enter");

    await page.waitForTimeout(Math.floor(randomBetween(2500, 4500)));

    const anchorFrame = findFrame(page, "google.com/recaptcha/api2/anchor") ?? findFrame(page, "google.com/recaptcha/enterprise/anchor");
    if (anchorFrame) {
      const solved = await anchorFrame.evaluate(() => document.querySelector("#recaptcha-anchor")?.getAttribute("aria-checked") === "true").catch(() => false);
      if (solved) return await submitCaptchaForm(page);
    }
    if ((await detectChallenge(page)).type === "none") return true;
  }

  // Final check — captcha may have been solved on the last verify
  const finalAnchor = findFrame(page, "google.com/recaptcha/api2/anchor")
    ?? findFrame(page, "google.com/recaptcha/enterprise/anchor");
  if (finalAnchor) {
    const checked = await finalAnchor.evaluate(() =>
      document.querySelector("#recaptcha-anchor")?.getAttribute("aria-checked") === "true"
    ).catch(() => false);
    if (checked) {
      console.error("[captcha] Checkbox checked after all rounds — submitting");
      return await submitCaptchaForm(page);
    }
  }
  return false;
}

// ── Local Audio Transcription ────────────────────────────────────

let whisperPipeline: ((audio: string) => Promise<string>) | null | "unavailable" = null;

async function loadWhisperPipeline(): Promise<((audio: string) => Promise<string>) | null> {
  if (whisperPipeline === "unavailable") return null;
  if (whisperPipeline) return whisperPipeline;

  // Try @xenova/transformers (pure JS Whisper, now a real dependency)
  try {
    const { pipeline } = await import("@xenova/transformers");
    const pipe = await pipeline(
      "automatic-speech-recognition",
      "Xenova/whisper-tiny.en"
    );
    whisperPipeline = async (audioPath: string) => {
      const result = await (pipe as (input: string) => Promise<{ text: string }>)(audioPath);
      return result.text.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "");
    };
    return whisperPipeline;
  } catch (err) {
    console.error("[captcha] @xenova/transformers failed to load:", err);
  }

  // Try whisper CLI (whisper.cpp or openai-whisper)
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);
    await exec("whisper", ["--help"]);
    whisperPipeline = async (audioPath: string) => {
      const { stdout } = await exec("whisper", [
        audioPath,
        "--model", "tiny.en",
        "--output_format", "txt",
        "--language", "en",
        "--fp16", "False",
      ], { timeout: 30_000 });
      return stdout.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "");
    };
    return whisperPipeline;
  } catch {
    // whisper CLI not available
  }

  whisperPipeline = "unavailable";
  return null;
}

async function transcribeAudio(audioPath: string): Promise<string | null> {
  const pipeline = await loadWhisperPipeline();
  if (!pipeline) return null;
  try {
    return await pipeline(audioPath);
  } catch {
    return null;
  }
}

export function isAudioSolverAvailable(): boolean {
  return whisperPipeline !== "unavailable";
}

// ── Datadome Solver ──────────────────────────────────────────────

async function solveDatdome(page: Page): Promise<boolean> {
  const ddFrame = findFrame(page, "captcha-delivery.com") ?? findFrame(page, "interstitial");
  if (!ddFrame) {
    await page.waitForTimeout(5000);
    return (await detectChallenge(page)).type === "none";
  }

  // Try press and hold
  try {
    const holdBtn = await ddFrame.waitForSelector(
      'button, [class*="hold"], [class*="press"]',
      { timeout: 5_000 }
    );
    if (holdBtn) {
      const box = await holdBtn.boundingBox();
      if (box) {
        await moveMouseNaturally(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
        await page.waitForTimeout(Math.floor(randomBetween(200, 500)));
        await page.mouse.down();
        await page.waitForTimeout(Math.floor(randomBetween(2000, 4000)));
        await page.mouse.up();
        await page.waitForTimeout(3000);
      }
    }
  } catch { /* button not found */ }

  // Try slider
  try {
    const slider = await ddFrame.$('[class*="slider"], [class*="captcha"]');
    if (slider) {
      const box = await slider.boundingBox();
      if (box) {
        const startX = box.x + 10;
        const endX = box.x + box.width - 10;
        const y = box.y + box.height / 2;
        await moveMouseNaturally(page, { x: startX, y });
        await page.mouse.down();
        const steps = Math.floor(randomBetween(15, 25));
        for (let i = 1; i <= steps; i++) {
          const eased = 1 - Math.pow(1 - i / steps, 2);
          await page.mouse.move(startX + (endX - startX) * eased, y + randomBetween(-2, 2));
          await page.waitForTimeout(Math.floor(randomBetween(15, 40)));
        }
        await page.mouse.up();
        await page.waitForTimeout(3000);
      }
    }
  } catch { /* slider not found */ }

  try {
    await page.waitForNavigation({ timeout: 10_000, waitUntil: "domcontentloaded" });
  } catch { /* may not navigate */ }

  return (await detectChallenge(page)).type === "none";
}

// ── Frame & Element Helpers ──────────────────────────────────────

function findFrame(page: Page, urlSubstring: string): Frame | null {
  for (const frame of page.frames()) {
    if (frame.url().includes(urlSubstring)) return frame;
  }
  return null;
}

/** Find frame by hash fragment (hCaptcha uses newassets.hcaptcha.com with #frame=challenge) */
function findFrameByHash(page: Page, hashSubstring: string): Frame | null {
  for (const frame of page.frames()) {
    const url = frame.url();
    const hashIdx = url.indexOf("#");
    if (hashIdx >= 0 && url.slice(hashIdx).includes(hashSubstring)) return frame;
  }
  return null;
}

async function clickIframeCenter(page: Page, iframeSelector: string): Promise<void> {
  // Find the first matching iframe
  const iframes = await page.$$(iframeSelector);
  for (const iframe of iframes) {
    const box = await iframe.boundingBox();
    if (box && box.width > 0 && box.height > 0) {
      await moveMouseNaturally(page, {
        x: box.x + box.width * randomBetween(0.35, 0.65),
        y: box.y + box.height * randomBetween(0.35, 0.65),
      });
      await page.waitForTimeout(Math.floor(randomBetween(80, 200)));
      await page.mouse.down();
      await page.waitForTimeout(Math.floor(randomBetween(50, 120)));
      await page.mouse.up();
      return;
    }
  }
  throw new Error(`No visible iframe matching: ${iframeSelector}`);
}

async function clickFrameElement(page: Page, _frame: Frame, element: ElementHandle): Promise<void> {
  const box = await element.boundingBox();
  if (!box) {
    await element.click();
    return;
  }

  await moveMouseNaturally(page, {
    x: box.x + box.width * randomBetween(0.3, 0.7),
    y: box.y + box.height * randomBetween(0.3, 0.7),
  });
  await page.waitForTimeout(Math.floor(randomBetween(80, 200)));
  await page.mouse.down();
  await page.waitForTimeout(Math.floor(randomBetween(50, 120)));
  await page.mouse.up();
}

async function submitCaptchaForm(page: Page): Promise<boolean> {
  await page.waitForTimeout(Math.floor(randomBetween(1000, 2000)));

  // Check if the challenge is already gone
  const detection = await detectChallenge(page);
  if (detection.type === "none") return true;

  // Check if reCAPTCHA checkbox is checked (more reliable than detectChallenge
  // on pages that keep the recaptcha widget in DOM after solving)
  const anchorFrame = findFrame(page, "google.com/recaptcha/api2/anchor")
    ?? findFrame(page, "google.com/recaptcha/enterprise/anchor");
  const isRecaptchaChecked = anchorFrame
    ? await anchorFrame.evaluate(() =>
        document.querySelector("#recaptcha-anchor")?.getAttribute("aria-checked") === "true"
      ).catch(() => false)
    : false;

  // Check if hCaptcha checkbox is checked
  const hcaptchaFrame = findFrame(page, "hcaptcha.com");
  const isHcaptchaChecked = hcaptchaFrame
    ? await hcaptchaFrame.evaluate(() =>
        document.querySelector("#checkbox")?.getAttribute("aria-checked") === "true"
      ).catch(() => false)
    : false;

  if (isRecaptchaChecked || isHcaptchaChecked) {
    console.error("[captcha] Checkbox confirmed checked — submitting form");
  }

  // Try submitting any visible form
  await page.evaluate(() => {
    const form = document.querySelector("form");
    if (form) form.submit();
  });

  try {
    await page.waitForNavigation({ timeout: 10_000, waitUntil: "domcontentloaded" });
  } catch { /* may not navigate */ }

  // On success, the page navigates away or challenge disappears
  if ((await detectChallenge(page)).type === "none") return true;

  // If checkbox was checked, consider it solved even if g-recaptcha is still in DOM
  return isRecaptchaChecked || isHcaptchaChecked;
}

// ── Main Challenge Handler ───────────────────────────────────────

export interface ChallengeResult {
  challenged: boolean;
  solved: boolean;
  challengeType: ChallengeType;
  method: "js_wait" | "checkbox_click" | "audio_solve" | "image_solve" | "slider" | "none";
  durationMs: number;
}

export async function handleChallenge(page: Page): Promise<ChallengeResult> {
  const start = Date.now();
  const detection = await detectChallenge(page);

  if (detection.type === "none") {
    return { challenged: false, solved: true, challengeType: "none", method: "none", durationMs: Date.now() - start };
  }

  let solved = false;
  let method: ChallengeResult["method"] = "none";

  switch (detection.type) {
    case "cloudflare_js":
    case "cloudflare_managed":
      solved = await solveCloudflareJs(page);
      method = "js_wait";
      break;

    case "cloudflare_turnstile":
      solved = await solveTurnstile(page);
      method = solved ? "checkbox_click" : "none";
      break;

    case "recaptcha_v2":
      solved = await solveRecaptchaV2(page);
      method = solved ? "image_solve" : "checkbox_click";
      break;

    case "recaptcha_v3":
      await page.waitForTimeout(3000);
      solved = (await detectChallenge(page)).type === "none";
      method = "js_wait";
      break;

    case "hcaptcha":
      solved = await solveHcaptcha(page);
      method = solved ? "image_solve" : "checkbox_click";
      break;

    case "datadome":
      solved = await solveDatdome(page);
      method = solved ? "slider" : "none";
      break;

    case "generic_captcha":
      await page.waitForTimeout(5000);
      solved = (await detectChallenge(page)).type === "none";
      method = "js_wait";
      break;
  }

  // If first attempt failed and challenge type changed, retry once
  if (!solved && detection.type !== "cloudflare_js" && detection.type !== "recaptcha_v3") {
    const retryDetection = await detectChallenge(page);
    if (retryDetection.type !== "none" && retryDetection.type !== detection.type) {
      const retryResult = await handleChallenge(page);
      return { ...retryResult, durationMs: Date.now() - start };
    }
  }

  return { challenged: true, solved, challengeType: detection.type, method, durationMs: Date.now() - start };
}
