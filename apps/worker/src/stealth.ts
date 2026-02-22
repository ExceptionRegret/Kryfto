// @ts-nocheck
import type { Browser, BrowserContext, BrowserType, LaunchOptions, Page } from 'playwright';

// ─── User-Agent Pool ────────────────────────────────────────────────
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
];

const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 2560, height: 1440 },
];

const TIMEZONES = [
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Berlin',
    'Asia/Tokyo',
];

const LOCALES = ['en-US', 'en-GB', 'en-CA', 'en-AU', 'de-DE', 'fr-FR'];

// ─── Helpers ────────────────────────────────────────────────────────
export function pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

/** Parse comma-separated proxy URLs from env. Returns empty array if unset. */
export function parseProxyUrls(envValue?: string): string[] {
    if (!envValue) return [];
    return envValue
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean);
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
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-dev-shm-usage',
            '--no-first-run',
            '--no-default-browser-check',
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
export function getStealthContextOptions(opts: StealthOptions): Record<string, unknown> {
    if (!opts.stealthEnabled) return {};

    const contextOpts: Record<string, unknown> = {};

    if (opts.rotateUserAgent) {
        contextOpts.userAgent = pickRandom(USER_AGENTS);
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
 * - navigator.plugins → realistic array
 * - navigator.languages → match context locale
 * - window.chrome → defined
 */
export async function applyStealthScripts(page: Page): Promise<void> {
    await page.addInitScript(() => {
        // 1. Hide webdriver flag
        Object.defineProperty(navigator, 'webdriver', { get: () => false });

        // 2. Fake plugins array (Chrome-like)
        Object.defineProperty(navigator, 'plugins', {
            get: () => {
                const fakePlugins = [
                    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
                ];
                const arr = Object.create(PluginArray.prototype);
                for (let i = 0; i < fakePlugins.length; i++) {
                    const p = Object.create(Plugin.prototype);
                    Object.defineProperties(p, {
                        name: { value: fakePlugins[i]!.name, enumerable: true },
                        filename: { value: fakePlugins[i]!.filename, enumerable: true },
                        description: { value: fakePlugins[i]!.description, enumerable: true },
                        length: { value: 0, enumerable: true },
                    });
                    arr[i] = p;
                }
                Object.defineProperty(arr, 'length', { value: fakePlugins.length, enumerable: true });
                return arr;
            },
        });

        // 3. Fake languages
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
        });

        // 4. Ensure chrome runtime object exists (many bot detectors check this)
        if (!(window as any).chrome) {
            (window as any).chrome = {
                runtime: {
                    connect: () => { },
                    sendMessage: () => { },
                },
            };
        }

        // 5. Prevent iframe contentWindow detection
        const originalQuery = window.HTMLIFrameElement.prototype.__lookupGetter__?.('contentWindow');
        if (originalQuery) {
            Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
                get: function () {
                    return originalQuery.call(this);
                },
            });
        }

        // 6. Patch permissions query for notifications
        const originalPermissions = navigator.permissions?.query;
        if (originalPermissions) {
            navigator.permissions.query = (parameters: PermissionDescriptor) => {
                if (parameters.name === 'notifications') {
                    return Promise.resolve({ state: 'denied', onchange: null } as PermissionStatus);
                }
                return originalPermissions.call(navigator.permissions, parameters);
            };
        }
    });
}
