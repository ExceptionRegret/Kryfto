// ── CLIP Vision-Based reCAPTCHA Solver ────────────────────────────
// Solves reCAPTCHA v2 image grid challenges locally using CLIP
// zero-shot image classification via @xenova/transformers.
// Also handles audio challenges via Whisper as primary strategy.
// No external APIs required.

import type { Page, Frame, ElementHandle } from "playwright";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ── Lazy Model Singletons ────────────────────────────────────────

let _clipPipeline: ((img: string, labels: string[]) => Promise<Array<{ label: string; score: number }>>) | null | "unavailable" = null;
let _whisperPipeline: ((audio: string) => Promise<string>) | null | "unavailable" = null;

async function getClipPipeline() {
    if (_clipPipeline === "unavailable") return null;
    if (_clipPipeline) return _clipPipeline;
    try {
        const { pipeline } = await import("@xenova/transformers");
        console.error("[vision] Loading CLIP-large model (first run downloads ~900MB, cached after)...");
        const pipe = await pipeline("zero-shot-image-classification", "Xenova/clip-vit-large-patch14");
        _clipPipeline = async (imgPath: string, labels: string[]) => {
            const result = await (pipe as Function)(imgPath, labels);
            return result as Array<{ label: string; score: number }>;
        };
        console.error("[vision] CLIP model loaded successfully");
        return _clipPipeline;
    } catch (err) {
        console.error("[vision] CLIP model failed to load:", err);
        _clipPipeline = "unavailable";
        return null;
    }
}

async function getWhisperPipeline() {
    if (_whisperPipeline === "unavailable") return null;
    if (_whisperPipeline) return _whisperPipeline;
    try {
        const { pipeline } = await import("@xenova/transformers");
        console.error("[vision] Loading Whisper model...");
        const pipe = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en");
        _whisperPipeline = async (audioPath: string) => {
            const result = await (pipe as (input: string) => Promise<{ text: string }>)(audioPath);
            return result.text.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "");
        };
        console.error("[vision] Whisper model loaded");
        return _whisperPipeline;
    } catch {
        _whisperPipeline = "unavailable";
        return null;
    }
}

// ── Label Mapping for Common reCAPTCHA Categories ────────────────

const LABEL_SYNONYMS: Record<string, string[]> = {
    "crosswalk": ["crosswalk", "pedestrian crossing", "zebra crossing"],
    "traffic light": ["traffic light", "traffic signal", "stoplight"],
    "bus": ["bus", "city bus", "public transit bus"],
    "bicycle": ["bicycle", "bike", "cycling"],
    "motorcycle": ["motorcycle", "motorbike"],
    "fire hydrant": ["fire hydrant", "hydrant"],
    "parking meter": ["parking meter"],
    "bridge": ["bridge", "overpass"],
    "car": ["car", "automobile"],
    "taxi": ["taxi", "yellow cab", "taxi cab"],
    "boat": ["boat", "ship", "vessel"],
    "tractor": ["tractor", "farm vehicle"],
    "chimney": ["chimney", "smokestack"],
    "palm tree": ["palm tree"],
    "stair": ["stairs", "staircase", "steps"],
    "mountain": ["mountain", "hill"],
};

const NEGATIVE_LABELS = [
    "building", "road", "sky", "tree", "sidewalk", "wall", "ground",
    "street", "pavement", "fence", "pole", "sign", "window", "roof",
    "grass", "cloud", "shadow", "empty road", "concrete",
];

// ── Multi-language label translation ──────────────────────────────

const LABEL_TRANSLATIONS: Record<string, string> = {
    // German
    fahrrad: "bicycle", fahrräder: "bicycle", fahrrädern: "bicycle",
    motorrad: "motorcycle", motorräder: "motorcycle",
    ampel: "traffic light", ampeln: "traffic light",
    zebrastreifen: "crosswalk", fußgängerüberweg: "crosswalk",
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
    "feu de signalisation": "traffic light",
    "passage piéton": "crosswalk",
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

function translateLabel(raw: string): string {
    const lower = raw.toLowerCase().trim();
    if (LABEL_TRANSLATIONS[lower]) return LABEL_TRANSLATIONS[lower];
    const stripped = lower.replace(/[ns]$/, "");
    if (LABEL_TRANSLATIONS[stripped]) return LABEL_TRANSLATIONS[stripped];
    for (const [key, val] of Object.entries(LABEL_TRANSLATIONS)) {
        if (lower.includes(key)) return val;
    }
    return raw;
}

function expandTarget(raw: string): string[] {
    const translated = translateLabel(raw);
    const lower = translated.toLowerCase().replace(/s$/, ""); // depluralize
    for (const [key, synonyms] of Object.entries(LABEL_SYNONYMS)) {
        if (lower.includes(key) || key.includes(lower)) return synonyms;
    }
    return [translated.toLowerCase()];
}

// ── Adaptive Threshold ────────────────────────────────────────────

function selectByAdaptiveThreshold(
    scored: Array<{ index: number; score: number }>,
    is4x4: boolean,
): Array<{ index: number; score: number }> {
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    const minScore = 0.20;
    const maxSelect = is4x4 ? 6 : 5;

    const candidates = sorted.filter((t) => t.score >= minScore);
    if (candidates.length === 0) {
        console.error(`[vision] Adaptive: best score ${sorted[0]?.score.toFixed(3) ?? "0"} < ${minScore}, skipping`);
        return [];
    }

    const selected = candidates.slice(0, maxSelect);
    console.error(`[vision] Adaptive: ${candidates.length} above ${minScore}, selecting ${selected.length}/${sorted.length}`);
    return selected;
}

// ── Core Visual Solver ───────────────────────────────────────────

async function classifyTile(
    clip: NonNullable<Awaited<ReturnType<typeof getClipPipeline>>>,
    imagePath: string,
    targetLabels: string[],
): Promise<number> {
    const allLabels = [...targetLabels, ...NEGATIVE_LABELS];
    const scores = await clip(imagePath, allLabels);
    // Use MAX score across synonyms (not sum) — synonyms split softmax mass
    let best = 0;
    for (const s of scores) {
        if (targetLabels.includes(s.label) && s.score > best) best = s.score;
    }
    return best;
}

export async function solveImageGrid(
    page: Page,
    bframe: Frame,
    maxRounds: number = 8,
): Promise<boolean> {
    const clip = await getClipPipeline();
    if (!clip) {
        console.error("[vision] CLIP not available, cannot solve image grid");
        return false;
    }

    for (let round = 0; round < maxRounds; round++) {
        console.error(`[vision] Solving image grid round ${round + 1}/${maxRounds}`);

        // Extract challenge target text
        const challengeText = await bframe.evaluate(() => {
            const desc = document.querySelector(".rc-imageselect-desc-wrapper, .rc-imageselect-desc");
            return desc?.textContent?.trim() ?? "";
        }).catch(() => "");

        if (!challengeText) {
            console.error("[vision] No challenge text found");
            return false;
        }

        // Parse target from strong tag or full text
        const strongMatch = await bframe.evaluate(() => {
            const strong = document.querySelector(".rc-imageselect-desc strong, .rc-imageselect-desc-wrapper strong");
            return strong?.textContent?.trim() ?? "";
        }).catch(() => "");

        const target = strongMatch || challengeText.replace(/select all (images|squares) with /i, "").replace(/click verify.*/i, "").trim();
        console.error(`[vision] Target: "${target}" (from: "${challengeText.substring(0, 60)}")`);
        const targetLabels = expandTarget(target);

        // Detect grid type (3x3 static or 4x4 dynamic)
        const is4x4 = await bframe.evaluate(() => !!document.querySelector(".rc-imageselect-table-44")).catch(() => false);
        const gridSize = is4x4 ? 4 : 3;
        const totalTiles = gridSize * gridSize;

        // Get all tile elements
        const tiles = await bframe.$$("td.rc-imageselect-tile");
        if (tiles.length === 0) {
            console.error("[vision] No tiles found");
            return false;
        }

        // Screenshot and classify each tile, then use adaptive threshold
        const tmpDir = tmpdir();
        const scored: Array<{ index: number; score: number }> = [];

        for (let i = 0; i < Math.min(tiles.length, totalTiles); i++) {
            const tile = tiles[i]!;
            const tilePath = join(tmpDir, `captcha-tile-${randomUUID()}.png`);
            try {
                const buf = await tile.screenshot();
                await writeFile(tilePath, buf);
                const score = await classifyTile(clip, tilePath, targetLabels);
                scored.push({ index: i, score });
            } finally {
                await rm(tilePath, { force: true }).catch(() => {});
            }
        }

        // Adaptive threshold: find natural gap in scores
        const matches = selectByAdaptiveThreshold(scored, is4x4);

        if (matches.length === 0) {
            console.error("[vision] No matching tiles found, clicking Verify anyway");
        } else {
            console.error(`[vision] Clicking ${matches.length} matching tiles`);
        }

        // Click matching tiles with small delays
        for (const m of matches) {
            const tile = tiles[m.index]!;
            console.error(`  Tile ${m.index + 1}: score=${m.score.toFixed(3)} MATCH`);
            const box = await tile.boundingBox();
            if (box) {
                await page.mouse.click(
                    box.x + box.width * (0.3 + Math.random() * 0.4),
                    box.y + box.height * (0.3 + Math.random() * 0.4),
                    { delay: 30 + Math.random() * 60 },
                );
                if (is4x4) await page.waitForTimeout(1500 + Math.random() * 1000);
                else await page.waitForTimeout(200 + Math.random() * 300);
            }
        }

        // For 4x4 dynamic grids, re-check for new matching tiles after clicks
        if (is4x4 && matches.length > 0) {
            await page.waitForTimeout(2000);
            const newTiles = await bframe.$$("td.rc-imageselect-tile");
            const newScored: Array<{ index: number; score: number }> = [];
            for (let i = 0; i < Math.min(newTiles.length, totalTiles); i++) {
                const tile = newTiles[i]!;
                const tilePath = join(tmpDir, `captcha-tile-${randomUUID()}.png`);
                try {
                    const buf = await tile.screenshot();
                    await writeFile(tilePath, buf);
                    const score = await classifyTile(clip, tilePath, targetLabels);
                    newScored.push({ index: i, score });
                } finally {
                    await rm(tilePath, { force: true }).catch(() => {});
                }
            }
            const newMatches = selectByAdaptiveThreshold(newScored, true);
            for (const m of newMatches) {
                const tile = newTiles[m.index]!;
                const box = await tile.boundingBox();
                if (box) {
                    await page.mouse.click(
                        box.x + box.width * (0.3 + Math.random() * 0.4),
                        box.y + box.height * (0.3 + Math.random() * 0.4),
                        { delay: 30 + Math.random() * 60 },
                    );
                    await page.waitForTimeout(1500 + Math.random() * 1000);
                }
            }
        }

        await page.waitForTimeout(500);

        // Click Verify button
        const verifyBtn = await bframe.$("#recaptcha-verify-button, button.rc-button-default");
        if (verifyBtn) {
            const box = await verifyBtn.boundingBox();
            if (box) {
                await page.mouse.click(
                    box.x + box.width * (0.3 + Math.random() * 0.4),
                    box.y + box.height * (0.3 + Math.random() * 0.4),
                    { delay: 40 + Math.random() * 60 },
                );
            }
        }

        await page.waitForTimeout(3000);

        // Check if solved (redirected away from /sorry or challenge disappeared)
        if (!page.url().includes("/sorry")) {
            console.error("[vision] CAPTCHA solved — redirected to search results");
            return true;
        }

        // Check for error messages
        const hasError = await bframe.evaluate(() => {
            const err = document.querySelector(".rc-imageselect-incorrect-response, .rc-imageselect-error-select-more, .rc-imageselect-error-dynamic-more");
            return err ? (err as HTMLElement).style.display !== "none" : false;
        }).catch(() => false);

        if (!hasError) {
            // Might have solved - check if checkbox is checked
            const anchorFrame = page.frames().find(f => f.url().includes("anchor"));
            if (anchorFrame) {
                const checked = await anchorFrame.evaluate(() => {
                    const a = document.querySelector("#recaptcha-anchor");
                    return a?.getAttribute("aria-checked") === "true";
                }).catch(() => false);
                if (checked) {
                    console.error("[vision] reCAPTCHA checkbox is checked — solved!");
                    // Submit the form
                    await page.evaluate(() => {
                        const form = document.querySelector("form");
                        if (form) form.submit();
                    });
                    await page.waitForTimeout(3000);
                    return !page.url().includes("/sorry");
                }
            }
        }

        console.error(`[vision] Round ${round + 1} not solved, retrying...`);
    }

    return false;
}

// ── Audio Challenge Solver ───────────────────────────────────────

async function solveAudioChallenge(page: Page, bframe: Frame): Promise<boolean> {
    // Click audio button
    const audioBtn = await bframe.$("#recaptcha-audio-button, button.rc-button-audio").catch(() => null);
    if (!audioBtn) {
        // Try headphones icon
        const btns = await bframe.$$("button");
        let found = false;
        for (const btn of btns) {
            const text = await btn.textContent().catch(() => "");
            if (text && text.toLowerCase().includes("audio")) {
                const box = await btn.boundingBox();
                if (box) {
                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 60 });
                    found = true;
                    break;
                }
            }
        }
        if (!found) return false;
    } else {
        const box = await audioBtn.boundingBox();
        if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 60 });
    }

    await page.waitForTimeout(3000);

    // Check if audio was blocked
    const blocked = await bframe.evaluate(() => {
        const err = document.querySelector(".rc-audiochallenge-error-message, .display-error");
        return err?.textContent?.includes("Try again later") || err?.textContent?.includes("automated") || false;
    }).catch(() => false);
    if (blocked) {
        console.error("[vision] Audio challenge blocked by Google");
        return false;
    }

    // Get audio URL
    const audioUrl = await bframe.evaluate(() => {
        const link = document.querySelector(".rc-audiochallenge-tdownload-link a") as HTMLAnchorElement | null;
        if (link?.href) return link.href;
        const source = document.querySelector("#audio-source") as HTMLSourceElement | null;
        if (source?.src) return source.src;
        const audio = document.querySelector("audio") as HTMLAudioElement | null;
        return audio?.src ?? null;
    }).catch(() => null);

    if (!audioUrl || !audioUrl.startsWith("http")) {
        console.error("[vision] No audio URL found");
        return false;
    }

    const whisper = await getWhisperPipeline();
    if (!whisper) {
        console.error("[vision] Whisper not available");
        return false;
    }

    // Download and transcribe
    const audioPath = join(tmpdir(), `captcha-audio-${randomUUID()}.mp3`);
    try {
        const resp = await fetch(audioUrl, { signal: AbortSignal.timeout(15000) });
        if (!resp.ok) return false;
        await writeFile(audioPath, Buffer.from(await resp.arrayBuffer()));

        const transcript = await whisper(audioPath);
        if (!transcript) return false;
        console.error(`[vision] Audio transcript: "${transcript}"`);

        // Type answer
        const input = await bframe.waitForSelector("#audio-response", { timeout: 5000 }).catch(() => null);
        if (!input) return false;
        await input.click();
        await page.waitForTimeout(300);
        for (const char of transcript) {
            await page.keyboard.type(char, { delay: 50 + Math.random() * 80 });
        }
        await page.waitForTimeout(500);

        // Click verify
        const verifyBtn = await bframe.$("#recaptcha-verify-button");
        if (verifyBtn) {
            const box = await verifyBtn.boundingBox();
            if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 60 });
        } else {
            await page.keyboard.press("Enter");
        }

        await page.waitForTimeout(4000);
        return !page.url().includes("/sorry");
    } finally {
        await rm(audioPath, { force: true }).catch(() => {});
    }
}

// ── Main Google /sorry Solver ────────────────────────────────────

export async function solveGoogleSorryPage(page: Page): Promise<boolean> {
    console.error("[vision] Solving Google /sorry CAPTCHA page...");

    // Step 1: Click reCAPTCHA checkbox
    const recaptchaIframe = await page.waitForSelector(
        "iframe[src*='recaptcha'], iframe[src*='anchor']",
        { timeout: 5000 },
    ).catch(() => null);

    if (!recaptchaIframe) {
        console.error("[vision] No reCAPTCHA iframe found");
        return false;
    }

    const anchorFrame = await recaptchaIframe.contentFrame();
    if (!anchorFrame) return false;

    const checkbox = await anchorFrame.waitForSelector(
        "#recaptcha-anchor, .recaptcha-checkbox-border",
        { timeout: 5000 },
    ).catch(() => null);

    if (checkbox) {
        const box = await checkbox.boundingBox();
        if (box) {
            await page.mouse.click(
                box.x + box.width * (0.3 + Math.random() * 0.4),
                box.y + box.height * (0.3 + Math.random() * 0.4),
                { delay: 40 + Math.random() * 80 },
            );
        }
    }

    await page.waitForTimeout(3000);

    // Check if checkbox alone solved it
    if (!page.url().includes("/sorry")) return true;
    const checked = await anchorFrame.evaluate(() => {
        const a = document.querySelector("#recaptcha-anchor");
        return a?.getAttribute("aria-checked") === "true";
    }).catch(() => false);
    if (checked) {
        await page.evaluate(() => { document.querySelector("form")?.submit(); });
        await page.waitForTimeout(3000);
        return !page.url().includes("/sorry");
    }

    // Step 2: Image challenge appeared — find bframe
    const bframe = page.frames().find(f =>
        f.url().includes("api2/bframe") || f.url().includes("enterprise/bframe"),
    );
    if (!bframe) {
        console.error("[vision] No bframe challenge frame found");
        return false;
    }

    // Step 3: Try audio first (faster, simpler)
    console.error("[vision] Trying audio challenge first...");
    const audioSolved = await solveAudioChallenge(page, bframe);
    if (audioSolved) return true;

    // Step 4: Audio blocked/failed — use CLIP vision solver
    console.error("[vision] Audio failed, switching to CLIP vision solver...");

    // Need to go back to image challenge if we switched to audio
    const imageBtn = await bframe.$(".rc-button-image, #recaptcha-image-button").catch(() => null);
    if (imageBtn) {
        const box = await imageBtn.boundingBox();
        if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 60 });
        await page.waitForTimeout(2000);
    }

    return solveImageGrid(page, bframe, 8);
}
