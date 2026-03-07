// ── Consistent Browser Fingerprint Profiles ──────────────────────
// Generates internally-consistent fingerprint sets where all browser
// properties match (UA ↔ platform ↔ screen ↔ WebGL ↔ fonts ↔ audio).
// This prevents cross-signal detection where e.g. a Windows UA has
// a macOS screen resolution or Intel GPU on a Mac with Apple Silicon.

import { getRandomUA, type BrowserFamily, detectBrowserFamily } from "./stealth.js";

// ── Screen Profiles ──────────────────────────────────────────────
// Real device screen configurations, grouped by platform.

interface ScreenProfile {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  colorDepth: number;
  pixelDepth: number;
  devicePixelRatio: number;
  outerWidth: number;
  outerHeight: number;
}

const WINDOWS_SCREENS: ScreenProfile[] = [
  { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24, devicePixelRatio: 1, outerWidth: 1920, outerHeight: 1040 },
  { width: 1536, height: 864, availWidth: 1536, availHeight: 824, colorDepth: 24, pixelDepth: 24, devicePixelRatio: 1.25, outerWidth: 1536, outerHeight: 824 },
  { width: 1366, height: 768, availWidth: 1366, availHeight: 728, colorDepth: 24, pixelDepth: 24, devicePixelRatio: 1, outerWidth: 1366, outerHeight: 728 },
  { width: 2560, height: 1440, availWidth: 2560, availHeight: 1400, colorDepth: 24, pixelDepth: 24, devicePixelRatio: 1, outerWidth: 2560, outerHeight: 1400 },
  { width: 1440, height: 900, availWidth: 1440, availHeight: 860, colorDepth: 24, pixelDepth: 24, devicePixelRatio: 1, outerWidth: 1440, outerHeight: 860 },
  { width: 1280, height: 720, availWidth: 1280, availHeight: 680, colorDepth: 24, pixelDepth: 24, devicePixelRatio: 1, outerWidth: 1280, outerHeight: 680 },
  { width: 3840, height: 2160, availWidth: 3840, availHeight: 2120, colorDepth: 24, pixelDepth: 24, devicePixelRatio: 1.5, outerWidth: 2560, outerHeight: 1413 },
];

const MAC_SCREENS: ScreenProfile[] = [
  { width: 1440, height: 900, availWidth: 1440, availHeight: 875, colorDepth: 30, pixelDepth: 30, devicePixelRatio: 2, outerWidth: 1440, outerHeight: 875 },
  { width: 1680, height: 1050, availWidth: 1680, availHeight: 1025, colorDepth: 30, pixelDepth: 30, devicePixelRatio: 2, outerWidth: 1680, outerHeight: 1025 },
  { width: 2560, height: 1600, availWidth: 2560, availHeight: 1575, colorDepth: 30, pixelDepth: 30, devicePixelRatio: 2, outerWidth: 1440, outerHeight: 900 },
  { width: 1920, height: 1080, availWidth: 1920, availHeight: 1055, colorDepth: 24, pixelDepth: 24, devicePixelRatio: 2, outerWidth: 1920, outerHeight: 1055 },
  { width: 2880, height: 1800, availWidth: 2880, availHeight: 1775, colorDepth: 30, pixelDepth: 30, devicePixelRatio: 2, outerWidth: 1440, outerHeight: 900 },
];

const LINUX_SCREENS: ScreenProfile[] = [
  { width: 1920, height: 1080, availWidth: 1920, availHeight: 1053, colorDepth: 24, pixelDepth: 24, devicePixelRatio: 1, outerWidth: 1920, outerHeight: 1053 },
  { width: 2560, height: 1440, availWidth: 2560, availHeight: 1413, colorDepth: 24, pixelDepth: 24, devicePixelRatio: 1, outerWidth: 2560, outerHeight: 1413 },
  { width: 1366, height: 768, availWidth: 1366, availHeight: 741, colorDepth: 24, pixelDepth: 24, devicePixelRatio: 1, outerWidth: 1366, outerHeight: 741 },
  { width: 3840, height: 2160, availWidth: 3840, availHeight: 2133, colorDepth: 24, pixelDepth: 24, devicePixelRatio: 1, outerWidth: 3840, outerHeight: 2133 },
];

// ── WebGL Profiles ───────────────────────────────────────────────

interface WebGLProfile {
  vendor: string;
  renderer: string;
  unmaskedVendor: string;
  unmaskedRenderer: string;
}

const WINDOWS_GPUS: WebGLProfile[] = [
  { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)", unmaskedVendor: "Google Inc. (NVIDIA)", unmaskedRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)", unmaskedVendor: "Google Inc. (NVIDIA)", unmaskedRenderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)", unmaskedVendor: "Google Inc. (AMD)", unmaskedRenderer: "ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)", unmaskedVendor: "Google Inc. (Intel)", unmaskedRenderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)", unmaskedVendor: "Google Inc. (NVIDIA)", unmaskedRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
];

const MAC_GPUS: WebGLProfile[] = [
  { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)", unmaskedVendor: "Google Inc. (Apple)", unmaskedRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)" },
  { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)", unmaskedVendor: "Google Inc. (Apple)", unmaskedRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)" },
  { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)", unmaskedVendor: "Google Inc. (Apple)", unmaskedRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)" },
  { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics, OpenGL 4.1)", unmaskedVendor: "Google Inc. (Intel)", unmaskedRenderer: "ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics, OpenGL 4.1)" },
];

const LINUX_GPUS: WebGLProfile[] = [
  { vendor: "Google Inc. (NVIDIA Corporation)", renderer: "ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1080/PCIe/SSE2, OpenGL 4.6.0)", unmaskedVendor: "Google Inc. (NVIDIA Corporation)", unmaskedRenderer: "ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1080/PCIe/SSE2, OpenGL 4.6.0)" },
  { vendor: "Google Inc. (X.Org)", renderer: "ANGLE (X.Org, AMD Radeon RX 580 (polaris10, LLVM 15.0.7, DRM 3.49, 6.1.0-18-amd64), OpenGL 4.6)", unmaskedVendor: "Google Inc. (X.Org)", unmaskedRenderer: "ANGLE (X.Org, AMD Radeon RX 580 (polaris10, LLVM 15.0.7, DRM 3.49, 6.1.0-18-amd64), OpenGL 4.6)" },
  { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)", unmaskedVendor: "Google Inc. (Intel)", unmaskedRenderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)" },
];

// ── Font Profiles ────────────────────────────────────────────────

const WINDOWS_FONTS = [
  "Arial", "Arial Black", "Calibri", "Cambria", "Consolas", "Courier New",
  "Georgia", "Impact", "Lucida Console", "Microsoft Sans Serif", "Palatino Linotype",
  "Segoe UI", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana",
];

const MAC_FONTS = [
  "Arial", "Arial Black", "Courier New", "Georgia", "Helvetica", "Helvetica Neue",
  "Impact", "Lucida Grande", "Menlo", "Monaco", "Palatino", "SF Pro Display",
  "SF Pro Text", "Times", "Times New Roman", "Trebuchet MS", "Verdana",
];

const LINUX_FONTS = [
  "Arial", "Courier New", "DejaVu Sans", "DejaVu Sans Mono", "DejaVu Serif",
  "FreeMono", "FreeSans", "FreeSerif", "Georgia", "Liberation Mono",
  "Liberation Sans", "Liberation Serif", "Noto Sans", "Times New Roman", "Verdana",
];

// ── Timezone ↔ Locale Coherence ──────────────────────────────────

interface LocaleProfile {
  locale: string;
  languages: string[];
  timezoneId: string;
}

const LOCALE_PROFILES: LocaleProfile[] = [
  { locale: "en-US", languages: ["en-US", "en"], timezoneId: "America/New_York" },
  { locale: "en-US", languages: ["en-US", "en"], timezoneId: "America/Chicago" },
  { locale: "en-US", languages: ["en-US", "en"], timezoneId: "America/Denver" },
  { locale: "en-US", languages: ["en-US", "en"], timezoneId: "America/Los_Angeles" },
  { locale: "en-GB", languages: ["en-GB", "en"], timezoneId: "Europe/London" },
  { locale: "en-CA", languages: ["en-CA", "en"], timezoneId: "America/Toronto" },
  { locale: "en-AU", languages: ["en-AU", "en"], timezoneId: "Australia/Sydney" },
  { locale: "de-DE", languages: ["de-DE", "de", "en"], timezoneId: "Europe/Berlin" },
  { locale: "fr-FR", languages: ["fr-FR", "fr", "en"], timezoneId: "Europe/Paris" },
];

// ── Hardware Concurrency ↔ Device Memory Coherence ──────────────

interface HardwareProfile {
  hardwareConcurrency: number;
  deviceMemory: number; // GB
}

const HARDWARE_PROFILES: HardwareProfile[] = [
  { hardwareConcurrency: 4, deviceMemory: 4 },
  { hardwareConcurrency: 4, deviceMemory: 8 },
  { hardwareConcurrency: 6, deviceMemory: 8 },
  { hardwareConcurrency: 8, deviceMemory: 8 },
  { hardwareConcurrency: 8, deviceMemory: 16 },
  { hardwareConcurrency: 10, deviceMemory: 16 },
  { hardwareConcurrency: 12, deviceMemory: 16 },
  { hardwareConcurrency: 12, deviceMemory: 32 },
  { hardwareConcurrency: 16, deviceMemory: 32 },
  { hardwareConcurrency: 16, deviceMemory: 64 },
];

// ── AudioContext Fingerprint Noise Seed ──────────────────────────
// We generate a deterministic-looking but unique noise offset per profile.

function generateAudioNoise(): number {
  // Tiny float offset that makes AudioContext fingerprint unique
  return (Math.random() * 0.00001) - 0.000005;
}

// ── Consistent Fingerprint Profile ──────────────────────────────

export type Platform = "windows" | "mac" | "linux";

export interface FingerprintProfile {
  userAgent: string;
  browserFamily: BrowserFamily;
  platform: Platform;
  navigatorPlatform: string;
  screen: ScreenProfile;
  webgl: WebGLProfile;
  fonts: string[];
  locale: LocaleProfile;
  hardware: HardwareProfile;
  audioNoise: number;
  // Derived context options for Playwright
  contextOptions: {
    userAgent: string;
    viewport: { width: number; height: number };
    locale: string;
    timezoneId: string;
    deviceScaleFactor: number;
    colorScheme: "light" | "dark";
  };
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function detectPlatformFromUA(ua: string): Platform {
  if (ua.includes("Macintosh") || ua.includes("Mac OS X")) return "mac";
  if (ua.includes("Linux") || ua.includes("X11")) return "linux";
  return "windows";
}

function navigatorPlatformFromPlatform(p: Platform): string {
  switch (p) {
    case "mac": return "MacIntel";
    case "linux": return "Linux x86_64";
    case "windows": return "Win32";
  }
}

/**
 * Generate a fully consistent fingerprint profile.
 * All properties are internally coherent — a Windows UA gets Windows
 * GPUs, Windows fonts, Windows screen resolutions, etc.
 */
export function generateFingerprint(ua?: string): FingerprintProfile {
  const userAgent = ua ?? getRandomUA();
  const browserFamily = detectBrowserFamily(userAgent);
  const platform = detectPlatformFromUA(userAgent);
  const navigatorPlatform = navigatorPlatformFromPlatform(platform);

  const screen = pick(
    platform === "mac" ? MAC_SCREENS :
    platform === "linux" ? LINUX_SCREENS :
    WINDOWS_SCREENS
  );

  const webgl = pick(
    platform === "mac" ? MAC_GPUS :
    platform === "linux" ? LINUX_GPUS :
    WINDOWS_GPUS
  );

  const fonts = platform === "mac" ? MAC_FONTS :
    platform === "linux" ? LINUX_FONTS :
    WINDOWS_FONTS;

  const locale = pick(LOCALE_PROFILES);
  const hardware = pick(HARDWARE_PROFILES);
  const audioNoise = generateAudioNoise();

  // Viewport is the browser inner window — slightly smaller than screen
  const viewportWidth = screen.outerWidth;
  const viewportHeight = screen.outerHeight - Math.floor(Math.random() * 30 + 70);

  return {
    userAgent,
    browserFamily,
    platform,
    navigatorPlatform,
    screen,
    webgl,
    fonts,
    locale,
    hardware,
    audioNoise,
    contextOptions: {
      userAgent,
      viewport: { width: viewportWidth, height: viewportHeight },
      locale: locale.locale,
      timezoneId: locale.timezoneId,
      deviceScaleFactor: screen.devicePixelRatio,
      colorScheme: Math.random() > 0.2 ? "light" : "dark",
    },
  };
}
