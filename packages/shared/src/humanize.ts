// ── Humanized Interaction Layer ────────────────────────────────────
// Replaces robotic page.click(), page.fill(), page.evaluate(scrollBy)
// with natural-looking mouse movements, typing, and scrolling.
// Uses tracked cursor position, variable velocity curves, micro-overshoots,
// and idle fidgets to resist behavioral analysis.

import type { Page } from "playwright";

// ── Mouse Position Tracker ───────────────────────────────────────
// Track cursor position per page to avoid teleporting from random positions.

const cursorPositions = new WeakMap<Page, Point>();

function getCursorPos(page: Page): Point {
  return cursorPositions.get(page) ?? {
    x: 400 + Math.floor(Math.random() * 400),
    y: 300 + Math.floor(Math.random() * 200),
  };
}

function setCursorPos(page: Page, pos: Point): void {
  cursorPositions.set(page, pos);
}

// ── Bezier Curve Mouse Movement ──────────────────────────────────

interface Point {
  x: number;
  y: number;
}

function cubicBezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Gaussian-distributed random (Box-Muller) — more realistic than uniform */
function gaussianRandom(mean: number, stddev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stddev;
}

function generateBezierPath(from: Point, to: Point, steps: number): Point[] {
  // Two random control points with Gaussian offset for more natural curves
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const spread = Math.min(distance * 0.4, 80); // proportional to distance

  const cp1: Point = {
    x: from.x + dx * randomBetween(0.15, 0.45) + gaussianRandom(0, spread * 0.3),
    y: from.y + dy * randomBetween(0.1, 0.4) + gaussianRandom(0, spread * 0.25),
  };
  const cp2: Point = {
    x: from.x + dx * randomBetween(0.55, 0.85) + gaussianRandom(0, spread * 0.3),
    y: from.y + dy * randomBetween(0.6, 0.9) + gaussianRandom(0, spread * 0.25),
  };

  const path: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    // Non-linear parameterization — accelerate then decelerate (ease-in-out)
    const rawT = i / steps;
    const t = rawT < 0.5
      ? 2 * rawT * rawT
      : 1 - Math.pow(-2 * rawT + 2, 2) / 2;

    path.push({
      x: cubicBezier(t, from.x, cp1.x, cp2.x, to.x),
      y: cubicBezier(t, from.y, cp1.y, cp2.y, to.y),
    });
  }

  // Add micro-overshoot (humans slightly overshoot the target then correct)
  if (distance > 80 && Math.random() < 0.35) {
    const overshoot: Point = {
      x: to.x + gaussianRandom(0, 4),
      y: to.y + gaussianRandom(0, 3),
    };
    path.push(overshoot);
    // Correction back
    path.push({
      x: to.x + gaussianRandom(0, 0.5),
      y: to.y + gaussianRandom(0, 0.5),
    });
  }

  return path;
}

export async function moveMouseNaturally(page: Page, to: Point): Promise<void> {
  const from = getCursorPos(page);
  const distance = Math.hypot(to.x - from.x, to.y - from.y);

  // Scale steps with distance, with some randomness
  const baseSteps = Math.floor(distance / 12);
  const steps = Math.max(8, Math.min(55, baseSteps + Math.floor(gaussianRandom(0, 3))));
  const path = generateBezierPath(from, to, steps);

  // Variable speed profile — faster in middle, slower at endpoints
  for (let i = 0; i < path.length; i++) {
    const point = path[i]!;
    await page.mouse.move(point.x, point.y);

    // Speed varies: slower at start/end, faster in middle
    const progress = i / path.length;
    let delay: number;
    if (progress < 0.15 || progress > 0.85) {
      delay = randomBetween(4, 12); // slow at edges
    } else {
      delay = randomBetween(1, 5); // fast in middle
    }

    // Occasional micro-pause (hesitation, ~3% chance)
    if (Math.random() < 0.03) {
      delay += randomBetween(15, 60);
    }

    await page.waitForTimeout(Math.floor(delay));
  }

  setCursorPos(page, to);
}

/** Simulate idle mouse fidget (small random movements while "thinking") */
export async function idleFidget(page: Page, durationMs: number = 500): Promise<void> {
  const pos = getCursorPos(page);
  const endTime = Date.now() + durationMs;

  while (Date.now() < endTime) {
    const jitter: Point = {
      x: pos.x + gaussianRandom(0, 3),
      y: pos.y + gaussianRandom(0, 2),
    };
    await page.mouse.move(jitter.x, jitter.y);
    await page.waitForTimeout(Math.floor(randomBetween(50, 200)));
  }

  setCursorPos(page, pos);
}

// ── Humanized Click ──────────────────────────────────────────────

export async function humanClick(page: Page, selector: string): Promise<void> {
  const element = await page.waitForSelector(selector, { timeout: 10_000 });
  if (!element) throw new Error(`Element not found: ${selector}`);

  const box = await element.boundingBox();
  if (!box) throw new Error(`Element not visible: ${selector}`);

  // Click slightly off-center (humans don't click dead center)
  const target: Point = {
    x: box.x + box.width * randomBetween(0.3, 0.7),
    y: box.y + box.height * randomBetween(0.3, 0.7),
  };

  await moveMouseNaturally(page, target);

  // Small pause before click (reaction time)
  await page.waitForTimeout(Math.floor(randomBetween(30, 120)));

  // Separate mousedown and mouseup with realistic gap
  await page.mouse.down();
  await page.waitForTimeout(Math.floor(randomBetween(40, 100)));
  await page.mouse.up();
}

// ── Humanized Typing ─────────────────────────────────────────────

export async function humanType(page: Page, selector: string, text: string): Promise<void> {
  const element = await page.waitForSelector(selector, { timeout: 10_000 });
  if (!element) throw new Error(`Element not found: ${selector}`);

  // Click the field first
  await humanClick(page, selector);
  await page.waitForTimeout(Math.floor(randomBetween(100, 300)));

  // Clear existing text
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.waitForTimeout(Math.floor(randomBetween(30, 80)));

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    // Occasional typo (2% chance, only on letters)
    if (Math.random() < 0.02 && /[a-zA-Z]/.test(char) && i < text.length - 1) {
      // Type wrong key (adjacent on QWERTY)
      const typoChar = getAdjacentKey(char);
      await page.keyboard.type(typoChar);
      await page.waitForTimeout(Math.floor(randomBetween(100, 250)));
      // Backspace to correct
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(Math.floor(randomBetween(50, 150)));
    }

    await page.keyboard.type(char);

    // Variable delay per character (50-150ms base, occasional longer pause)
    let delay = randomBetween(50, 150);
    if (char === " " || char === "." || char === ",") {
      delay = randomBetween(80, 250); // Longer pause at word/sentence boundaries
    }
    if (Math.random() < 0.05) {
      delay = randomBetween(200, 500); // Occasional thinking pause
    }
    await page.waitForTimeout(Math.floor(delay));
  }
}

const QWERTY_ADJACENCY: Record<string, string> = {
  q: "w", w: "e", e: "r", r: "t", t: "y", y: "u", u: "i", i: "o", o: "p",
  a: "s", s: "d", d: "f", f: "g", g: "h", h: "j", j: "k", k: "l",
  z: "x", x: "c", c: "v", v: "b", b: "n", n: "m",
};

function getAdjacentKey(char: string): string {
  const lower = char.toLowerCase();
  const adjacent = QWERTY_ADJACENCY[lower];
  if (!adjacent) return char;
  return char === lower ? adjacent : adjacent.toUpperCase();
}

// ── Humanized Scrolling ──────────────────────────────────────────

export async function humanScroll(page: Page, direction: "up" | "down", totalAmount: number): Promise<void> {
  const sign = direction === "down" ? 1 : -1;
  let remaining = totalAmount;

  while (remaining > 0) {
    // Each scroll chunk: 50-200 pixels
    const chunk = Math.min(remaining, Math.floor(randomBetween(50, 200)));
    remaining -= chunk;

    await page.evaluate(
      (delta) => (globalThis as unknown as { scrollBy(opts: unknown): void }).scrollBy({ top: delta, behavior: "smooth" }),
      sign * chunk
    );

    // Variable delay between scroll events (30-150ms)
    await page.waitForTimeout(Math.floor(randomBetween(30, 150)));

    // Occasional pause while "reading" (10% chance)
    if (Math.random() < 0.1 && remaining > 0) {
      await page.waitForTimeout(Math.floor(randomBetween(500, 1500)));
    }
  }
}

// ── Humanized Pagination Click ───────────────────────────────────

export async function humanPaginateClick(page: Page, selector: string): Promise<void> {
  // Small delay before paginating (as if deciding to click next)
  await page.waitForTimeout(Math.floor(randomBetween(300, 800)));
  await humanClick(page, selector);
}
