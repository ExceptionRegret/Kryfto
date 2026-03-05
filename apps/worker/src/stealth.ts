import type {
  Browser,
  BrowserContext,
  BrowserType,
  LaunchOptions,
  Page,
} from "playwright";
import { getRandomUA } from "@kryfto/shared";

// ─── User-Agent Pool ────────────────────────────────────────────────
// Uses the unified UA pool from @kryfto/shared (single source of truth).

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 2560, height: 1440 },
];

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
];

const LOCALES = ["en-US", "en-GB", "en-CA", "en-AU", "de-DE", "fr-FR"];

// Hardware concurrency values seen on real machines
const HARDWARE_CONCURRENCY_VALUES = [4, 6, 8, 10, 12, 16];

// ─── Helpers ────────────────────────────────────────────────────────
export function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Parse comma-separated proxy URLs from env. Returns empty array if unset. */
export function parseProxyUrls(envValue?: string): string[] {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
}

/**
 * Derive the correct navigator.platform value from a User-Agent string.
 * Prevents mismatches like Windows UA + macOS platform which is an instant detection signal.
 */
function platformFromUA(ua: string): string {
  if (ua.includes("Macintosh") || ua.includes("Mac OS X")) return "MacIntel";
  if (ua.includes("Linux") || ua.includes("X11")) return "Linux x86_64";
  return "Win32"; // Default to Windows
}

/**
 * Derive the correct navigator.languages from a locale string.
 * E.g., "en-GB" → ["en-GB", "en"], "de-DE" → ["de-DE", "de"]
 */
function languagesFromLocale(locale: string): string[] {
  const base = locale.split("-")[0] ?? "en";
  if (locale === base) return [locale];
  return [locale, base];
}

// ─── Stealth Browser Launch ─────────────────────────────────────────
export interface StealthOptions {
  stealthEnabled: boolean;
  rotateUserAgent: boolean;
  proxyUrls: string[];
  headless: boolean;
}

/**
 * Launch a browser with anti-detection measures.
 * When stealth is disabled, this behaves identically to a normal launch.
 */
export async function launchStealthBrowser(
  browserType: BrowserType,
  opts: StealthOptions
): Promise<Browser> {
  const launchOptions: LaunchOptions = {
    headless: opts.headless,
  };

  if (opts.stealthEnabled) {
    launchOptions.args = [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
    ];
  }

  if (opts.proxyUrls.length > 0) {
    const proxyUrl = pickRandom(opts.proxyUrls);
    launchOptions.proxy = { server: proxyUrl };
  }

  return browserType.launch(launchOptions);
}

/**
 * Create a browser context with randomized fingerprint when stealth is on.
 */
export function getStealthContextOptions(
  opts: StealthOptions
): Record<string, unknown> {
  if (!opts.stealthEnabled) return {};

  const contextOpts: Record<string, unknown> = {};

  if (opts.rotateUserAgent) {
    contextOpts.userAgent = getRandomUA();
  }

  contextOpts.viewport = pickRandom(VIEWPORTS);
  contextOpts.locale = pickRandom(LOCALES);
  contextOpts.timezoneId = pickRandom(TIMEZONES);

  // Prevent WebGL fingerprint leaking "Google SwiftShader"
  contextOpts.permissions = [] as string[];

  return contextOpts;
}

/**
 * Inject scripts that patch browser automation tells:
 * - navigator.webdriver → false
 * - navigator.plugins → realistic array (no deprecated Native Client)
 * - navigator.languages → match context locale (not hardcoded)
 * - navigator.hardwareConcurrency → realistic randomized value
 * - navigator.platform → matches the User-Agent string
 * - window.chrome → defined
 */
export async function applyStealthScripts(
  page: Page,
  contextOpts?: Record<string, unknown>
): Promise<void> {
  // Derive runtime values from context options
  const ua = (contextOpts?.userAgent as string) ?? "";
  const locale = (contextOpts?.locale as string) ?? "en-US";
  const platform = platformFromUA(ua);
  const languages = languagesFromLocale(locale);
  const hardwareConcurrency = pickRandom(HARDWARE_CONCURRENCY_VALUES);

  await page.addInitScript(
    (opts: {
      platform: string;
      languages: string[];
      hardwareConcurrency: number;
    }) => {
      // 1. Hide webdriver flag
      Object.defineProperty(navigator, "webdriver", { get: () => false });

      // 2. Fake plugins array (Chrome-like, no deprecated Native Client)
      Object.defineProperty(navigator, "plugins", {
        get: () => {
          const fakePlugins = [
            {
              name: "Chrome PDF Plugin",
              filename: "internal-pdf-viewer",
              description: "Portable Document Format",
            },
            {
              name: "Chrome PDF Viewer",
              filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
              description: "",
            },
          ];
          const arr = Object.create(PluginArray.prototype);
          for (let i = 0; i < fakePlugins.length; i++) {
            const p = Object.create(Plugin.prototype);
            Object.defineProperties(p, {
              name: { value: fakePlugins[i]!.name, enumerable: true },
              filename: { value: fakePlugins[i]!.filename, enumerable: true },
              description: {
                value: fakePlugins[i]!.description,
                enumerable: true,
              },
              length: { value: 0, enumerable: true },
            });
            arr[i] = p;
          }
          Object.defineProperty(arr, "length", {
            value: fakePlugins.length,
            enumerable: true,
          });
          return arr;
        },
      });

      // 3. Languages derived from context locale (not hardcoded)
      Object.defineProperty(navigator, "languages", {
        get: () => opts.languages,
      });

      // 4. Platform matching the UA string
      Object.defineProperty(navigator, "platform", {
        get: () => opts.platform,
      });

      // 5. Realistic hardware concurrency
      Object.defineProperty(navigator, "hardwareConcurrency", {
        get: () => opts.hardwareConcurrency,
      });

      // 6. Ensure chrome runtime object exists (many bot detectors check this)
      if (!(window as unknown as Record<string, unknown>).chrome) {
        (window as unknown as Record<string, unknown>).chrome = {
          runtime: {
            connect: () => { },
            sendMessage: () => { },
          },
        };
      }

      // 7. Prevent iframe contentWindow detection
      const originalQuery = (
        window.HTMLIFrameElement.prototype as unknown as { __lookupGetter__?: (prop: string) => (() => Window | null) | undefined }
      ).__lookupGetter__?.call(
        window.HTMLIFrameElement.prototype,
        "contentWindow"
      ) as (() => Window | null) | undefined;
      if (originalQuery) {
        Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
          get: function (this: HTMLIFrameElement) {
            return originalQuery.call(this);
          },
        });
      }

      // 8. Patch permissions query for notifications
      const originalPermissions = navigator.permissions?.query;
      if (originalPermissions) {
        navigator.permissions.query = (parameters: PermissionDescriptor) => {
          if (parameters.name === "notifications") {
            return Promise.resolve({
              state: "denied",
              onchange: null,
            } as PermissionStatus);
          }
          return originalPermissions.call(navigator.permissions, parameters);
        };
      }

      // 9. Canvas fingerprint randomization — inject subtle noise
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (
        this: HTMLCanvasElement,
        ...args: [string?, number?]
      ) {
        const ctx = this.getContext("2d");
        if (ctx && this.width > 0 && this.height > 0) {
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i]! += Math.floor(Math.random() * 3) - 1; // R ±1
          }
          ctx.putImageData(imageData, 0, 0);
        }
        return origToDataURL.apply(this, args);
      };

      const origToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (
        this: HTMLCanvasElement,
        callback: BlobCallback,
        ...args: [string?, number?]
      ) {
        const ctx = this.getContext("2d");
        if (ctx && this.width > 0 && this.height > 0) {
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i]! += Math.floor(Math.random() * 3) - 1;
          }
          ctx.putImageData(imageData, 0, 0);
        }
        return origToBlob.call(this, callback, ...args);
      };

      // 10. WebGL vendor/renderer spoofing
      const spoofWebGL = (proto: WebGLRenderingContext | null) => {
        if (!proto) return;
        const origGetParam = proto.getParameter;
        proto.getParameter = function (param: number) {
          if (param === 37445) return "Intel Inc.";
          if (param === 37446) return "Intel Iris OpenGL Engine";
          return origGetParam.call(this, param);
        };
      };
      try {
        spoofWebGL(WebGLRenderingContext.prototype);
      } catch { /* WebGL unavailable */ }
      try {
        if (typeof WebGL2RenderingContext !== "undefined") {
          spoofWebGL(WebGL2RenderingContext.prototype as unknown as WebGLRenderingContext);
        }
      } catch { /* WebGL2 unavailable */ }
    },
    { platform, languages, hardwareConcurrency }
  );
}
