import type {
  Browser,
  BrowserType,
  LaunchOptions,
  Page,
} from "playwright";
import { getRandomUA } from "./stealth.js";
import { generateFingerprint, type FingerprintProfile } from "./fingerprint.js";

// ─── Re-export fingerprint for external use ────────────────────────
export { generateFingerprint, type FingerprintProfile } from "./fingerprint.js";

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

// ─── Stealth Browser Launch ─────────────────────────────────────────
export interface StealthOptions {
  stealthEnabled: boolean;
  rotateUserAgent: boolean;
  proxyUrls: string[];
  headless: boolean;
}

/**
 * Launch a browser with anti-detection measures.
 * Includes TLS fingerprint randomization via Chrome flags.
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
      // Core anti-automation
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      // Prevent info bars
      "--disable-infobars",
      "--disable-component-update",
      // TLS/JA3 fingerprint variation
      "--enable-features=NetworkService,NetworkServiceInProcess",
      "--disable-features=CalculateNativeWinOcclusion",
      // WebRTC IP leak prevention
      "--enforce-webrtc-ip-permission-check",
      "--webrtc-ip-handling-policy=disable_non_proxied_udp",
      // GPU and rendering
      "--disable-gpu-sandbox",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      // Window size randomization (prevents default 800x600 headless tell)
      `--window-size=${1200 + Math.floor(Math.random() * 720)},${700 + Math.floor(Math.random() * 400)}`,
      // Disable automation extensions
      "--disable-extensions",
      "--disable-default-apps",
      "--disable-popup-blocking",
      // Headless-specific hardening
      ...(opts.headless ? [
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ] : []),
    ];
  }

  if (opts.proxyUrls.length > 0) {
    const proxyUrl = pickRandom(opts.proxyUrls);
    launchOptions.proxy = { server: proxyUrl };
  }

  return browserType.launch(launchOptions);
}

/**
 * Create browser context options from a fingerprint profile.
 * All properties are internally consistent.
 */
export function getStealthContextOptions(
  opts: StealthOptions,
  fingerprint?: FingerprintProfile,
): Record<string, unknown> {
  if (!opts.stealthEnabled) return {};

  const fp = fingerprint ?? generateFingerprint(
    opts.rotateUserAgent ? undefined : getRandomUA()
  );

  return {
    ...fp.contextOptions,
    permissions: [] as string[],
    bypassCSP: true,
  };
}

/**
 * Generate a fingerprint-aware context options set.
 * Returns both the context options and the fingerprint for use in stealth scripts.
 */
export function getStealthContextWithFingerprint(
  opts: StealthOptions,
): { contextOpts: Record<string, unknown>; fingerprint: FingerprintProfile } {
  const fingerprint = generateFingerprint(
    opts.rotateUserAgent ? undefined : getRandomUA()
  );
  const contextOpts = getStealthContextOptions(opts, fingerprint);
  return { contextOpts, fingerprint };
}

// ─── Comprehensive Stealth Init Scripts ─────────────────────────────

/**
 * Inject scripts that patch ALL known browser automation tells.
 * Uses a consistent fingerprint profile to ensure cross-signal coherence.
 *
 * IMPORTANT: Uses string-based addInitScript to avoid tsx/esbuild injecting
 * __name helpers that don't exist in the browser context.
 */
export async function applyStealthScripts(
  page: Page,
  fingerprint?: FingerprintProfile,
): Promise<void> {
  const fp = fingerprint ?? generateFingerprint();

  // Serialize fingerprint values into the script string
  const opts = {
    platform: fp.navigatorPlatform,
    languages: fp.locale.languages,
    hardwareConcurrency: fp.hardware.hardwareConcurrency,
    deviceMemory: fp.hardware.deviceMemory,
    screen: fp.screen,
    webgl: fp.webgl,
    fonts: fp.fonts,
    audioNoise: fp.audioNoise,
    browserFamily: fp.browserFamily,
  };

  const script = `(function() {
  var opts = ${JSON.stringify(opts)};

  // 1. navigator.webdriver — must not exist at all ("webdriver" in navigator === false)
  try { delete Navigator.prototype.webdriver; } catch(e) {}
  try { delete navigator.webdriver; } catch(e) {}
  // If delete didn't work (Chrome prevents it), redefine as non-enumerable getter returning undefined
  if ("webdriver" in navigator) {
    Object.defineProperty(Navigator.prototype, "webdriver", { get: function() { return undefined; }, configurable: true });
  }

  // 2. navigator.plugins (realistic Chrome plugins)
  try {
    var fakePluginData = [
      { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format", length: 1 },
      { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "", length: 0 },
      { name: "Native Client", filename: "internal-nacl-plugin", description: "", length: 0 },
    ];
    var pluginsProto = typeof PluginArray !== "undefined" ? PluginArray.prototype : Object.prototype;
    var pluginProto = typeof Plugin !== "undefined" ? Plugin.prototype : Object.prototype;
    var pluginsObj = Object.create(pluginsProto);
    for (var i = 0; i < fakePluginData.length; i++) {
      var pd = fakePluginData[i];
      var p = Object.create(pluginProto);
      Object.defineProperties(p, {
        name: { value: pd.name, enumerable: true, configurable: true },
        filename: { value: pd.filename, enumerable: true, configurable: true },
        description: { value: pd.description, enumerable: true, configurable: true },
        length: { value: pd.length, enumerable: true, configurable: true },
      });
      pluginsObj[i] = p;
      pluginsObj[pd.name] = p;
    }
    Object.defineProperties(pluginsObj, {
      length: { value: fakePluginData.length, enumerable: true, configurable: true },
      item: { value: function(idx) { return pluginsObj[idx] || null; }, enumerable: false },
      namedItem: { value: function(n) { return pluginsObj[n] || null; }, enumerable: false },
      refresh: { value: function() {}, enumerable: false },
    });
    Object.defineProperty(Navigator.prototype, "plugins", { get: function() { return pluginsObj; }, configurable: true });
  } catch(e) {}

  // 3. navigator.mimeTypes
  try {
    var fakeMimeData = [
      { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" },
      { type: "application/x-google-chrome-pdf", suffixes: "pdf", description: "Portable Document Format" },
    ];
    var mimeProto = typeof MimeTypeArray !== "undefined" ? MimeTypeArray.prototype : Object.prototype;
    var mimeItemProto = typeof MimeType !== "undefined" ? MimeType.prototype : Object.prototype;
    var mimeObj = Object.create(mimeProto);
    for (var j = 0; j < fakeMimeData.length; j++) {
      var md = fakeMimeData[j];
      var m = Object.create(mimeItemProto);
      Object.defineProperties(m, {
        type: { value: md.type, enumerable: true, configurable: true },
        suffixes: { value: md.suffixes, enumerable: true, configurable: true },
        description: { value: md.description, enumerable: true, configurable: true },
        enabledPlugin: { value: null, enumerable: true, configurable: true },
      });
      mimeObj[j] = m;
      mimeObj[md.type] = m;
    }
    Object.defineProperties(mimeObj, {
      length: { value: fakeMimeData.length, enumerable: true, configurable: true },
      item: { value: function(idx) { return mimeObj[idx] || null; }, enumerable: false },
      namedItem: { value: function(n) { return mimeObj[n] || null; }, enumerable: false },
    });
    Object.defineProperty(Navigator.prototype, "mimeTypes", { get: function() { return mimeObj; }, configurable: true });
  } catch(e) {}

  // 4. navigator properties
  Object.defineProperty(navigator, "languages", { get: function() { return Object.freeze(opts.languages.slice()); } });
  Object.defineProperty(navigator, "platform", { get: function() { return opts.platform; } });
  Object.defineProperty(navigator, "hardwareConcurrency", { get: function() { return opts.hardwareConcurrency; } });
  Object.defineProperty(navigator, "deviceMemory", { get: function() { return opts.deviceMemory; } });
  Object.defineProperty(navigator, "maxTouchPoints", { get: function() { return 0; } });

  // 5. navigator.connection
  if ("connection" in navigator) {
    var conn = {
      effectiveType: "4g",
      rtt: 50 + Math.floor(Math.random() * 50),
      downlink: 5 + Math.random() * 15,
      saveData: false, type: "wifi", onchange: null,
      addEventListener: function(){}, removeEventListener: function(){}, dispatchEvent: function(){ return true; },
    };
    Object.defineProperty(navigator, "connection", { get: function() { return conn; } });
  }

  // 6. navigator.getBattery
  if ("getBattery" in navigator) {
    navigator.getBattery = function() {
      return Promise.resolve({
        charging: Math.random() > 0.3,
        chargingTime: Math.random() > 0.5 ? Infinity : Math.floor(Math.random() * 7200),
        dischargingTime: Infinity, level: 0.5 + Math.random() * 0.5,
        onchargingchange: null, onchargingtimechange: null, ondischargingtimechange: null, onlevelchange: null,
        addEventListener: function(){}, removeEventListener: function(){}, dispatchEvent: function(){ return true; },
      });
    };
  }

  // 7. Screen properties
  var screenProps = { width: opts.screen.width, height: opts.screen.height, availWidth: opts.screen.availWidth, availHeight: opts.screen.availHeight, colorDepth: opts.screen.colorDepth, pixelDepth: opts.screen.pixelDepth };
  for (var sk in screenProps) {
    (function(key, val) {
      Object.defineProperty(screen, key, { get: function() { return val; } });
    })(sk, screenProps[sk]);
  }
  Object.defineProperty(window, "devicePixelRatio", { get: function() { return opts.screen.devicePixelRatio; } });
  Object.defineProperty(window, "outerWidth", { get: function() { return opts.screen.outerWidth; } });
  Object.defineProperty(window, "outerHeight", { get: function() { return opts.screen.outerHeight; } });

  // 8. window.chrome (only for Chrome/Edge UAs — Safari/Firefox don't have it)
  if (opts.browserFamily !== "safari" && opts.browserFamily !== "firefox") {
  var chromeObj = {
    app: {
      isInstalled: false,
      InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" },
      RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" },
      getDetails: function() { return null; },
      getIsInstalled: function() { return false; },
    },
    csi: function() { return {}; },
    loadTimes: function() {
      return {
        commitLoadTime: performance.now() / 1000, connectionInfo: "h2",
        finishDocumentLoadTime: performance.now() / 1000, finishLoadTime: performance.now() / 1000,
        firstPaintAfterLoadTime: 0, firstPaintTime: performance.now() / 1000,
        navigationType: "Other", npnNegotiatedProtocol: "h2",
        requestTime: performance.now() / 1000 - 0.5, startLoadTime: performance.now() / 1000 - 0.3,
        wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true, wasNpnNegotiated: true,
      };
    },
    runtime: {
      OnInstalledReason: { CHROME_UPDATE: "chrome_update", INSTALL: "install", SHARED_MODULE_UPDATE: "shared_module_update", UPDATE: "update" },
      OnRestartRequiredReason: { APP_UPDATE: "app_update", OS_UPDATE: "os_update", PERIODIC: "periodic" },
      PlatformArch: { ARM: "arm", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" },
      PlatformNaclArch: { ARM: "arm", MIPS: "mips", MIPS64: "mips64", X86_32: "x86-32", X86_64: "x86-64" },
      PlatformOs: { ANDROID: "android", CROS: "cros", LINUX: "linux", MAC: "mac", OPENBSD: "openbsd", WIN: "win" },
      RequestUpdateCheckStatus: { NO_UPDATE: "no_update", THROTTLED: "throttled", UPDATE_AVAILABLE: "update_available" },
      connect: function() {}, sendMessage: function() {}, id: undefined,
    },
  };
  if (window.chrome && typeof window.chrome === "object") {
    for (var ck in window.chrome) { if (!(ck in chromeObj)) chromeObj[ck] = window.chrome[ck]; }
  }
  window.chrome = chromeObj;
  }

  // 9. Permissions API
  var origPermQuery = navigator.permissions && navigator.permissions.query;
  if (origPermQuery) {
    navigator.permissions.query = function(parameters) {
      if (parameters.name === "notifications") {
        return Promise.resolve({ state: "prompt", onchange: null });
      }
      return origPermQuery.call(navigator.permissions, parameters);
    };
  }

  // 10. Canvas fingerprint noise
  var canvasNoiseSeed = opts.audioNoise * 100000;
  var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function() {
    var ctx = this.getContext("2d");
    if (ctx && this.width > 0 && this.height > 0 && this.width < 500 && this.height < 500) {
      try {
        var imageData = ctx.getImageData(0, 0, this.width, this.height);
        for (var ci = 0; ci < Math.min(imageData.data.length, 4000); ci += 4) {
          var noise = ((canvasNoiseSeed * (ci + 1) * 9301 + 49297) % 233280) / 233280;
          imageData.data[ci] += (noise > 0.5 ? 1 : -1);
        }
        ctx.putImageData(imageData, 0, 0);
      } catch(e) {}
    }
    return origToDataURL.apply(this, arguments);
  };

  var origToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function(callback) {
    var ctx = this.getContext("2d");
    if (ctx && this.width > 0 && this.height > 0 && this.width < 500 && this.height < 500) {
      try {
        var imageData = ctx.getImageData(0, 0, this.width, this.height);
        for (var ci = 0; ci < Math.min(imageData.data.length, 4000); ci += 4) {
          var noise = ((canvasNoiseSeed * (ci + 1) * 9301 + 49297) % 233280) / 233280;
          imageData.data[ci] += (noise > 0.5 ? 1 : -1);
        }
        ctx.putImageData(imageData, 0, 0);
      } catch(e) {}
    }
    return origToBlob.apply(this, arguments);
  };

  // 11. WebGL vendor/renderer spoofing
  function spoofWebGL(proto) {
    if (!proto) return;
    var origGetParam = proto.getParameter;
    var origGetExt = proto.getExtension;
    proto.getParameter = function(param) {
      if (param === 37445) return opts.webgl.vendor;
      if (param === 37446) return opts.webgl.renderer;
      if (param === 7936) return opts.webgl.vendor;
      if (param === 7937) return opts.webgl.renderer;
      return origGetParam.call(this, param);
    };
    proto.getExtension = function(name) {
      if (name === "WEBGL_debug_renderer_info") return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
      return origGetExt.call(this, name);
    };
  }
  try { spoofWebGL(WebGLRenderingContext.prototype); } catch(e) {}
  try { if (typeof WebGL2RenderingContext !== "undefined") spoofWebGL(WebGL2RenderingContext.prototype); } catch(e) {}

  // 12. AudioContext fingerprint noise
  try {
    var origGetChannelData = AnalyserNode.prototype.getFloatFrequencyData;
    AnalyserNode.prototype.getFloatFrequencyData = function(array) {
      origGetChannelData.call(this, array);
      for (var ai = 0; ai < array.length; ai++) array[ai] += opts.audioNoise;
    };
  } catch(e) {}

  // 13. WebRTC IP leak prevention
  var origRTC = window.RTCPeerConnection;
  if (origRTC) {
    window.RTCPeerConnection = function(config) {
      return new origRTC(Object.assign({}, config, { iceServers: [], iceCandidatePoolSize: 0 }));
    };
    window.RTCPeerConnection.prototype = origRTC.prototype;
  }

  // 14. iframe contentWindow bypass
  try {
    var origContentWindow = HTMLIFrameElement.prototype.__lookupGetter__("contentWindow");
    if (origContentWindow) {
      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
        get: function() { return origContentWindow.call(this); },
      });
    }
  } catch(e) {}

  // 15. CDP stack trace filter
  if (typeof Error.prepareStackTrace === "undefined") {
    Error.prepareStackTrace = function(err, stack) {
      var filtered = stack.filter(function(frame) {
        var fn = frame.getFunctionName() || "";
        var file = frame.getFileName() || "";
        return fn.indexOf("__cdp") === -1 && file.indexOf("__playwright") === -1;
      });
      return err.name + ": " + err.message + "\\n" + filtered.map(function(f) { return "    at " + f; }).join("\\n");
    };
  }

  // 16. Headless detection patches
  if (typeof Notification !== "undefined") {
    Object.defineProperty(Notification, "permission", { get: function() { return "default"; } });
  }
  if ("speechSynthesis" in window) {
    var origGetVoices = speechSynthesis.getVoices;
    speechSynthesis.getVoices = function() {
      var voices = origGetVoices.call(this);
      if (voices.length === 0) {
        return [
          { default: true, lang: "en-US", localService: true, name: "Microsoft David - English (United States)", voiceURI: "Microsoft David - English (United States)" },
          { default: false, lang: "en-US", localService: true, name: "Microsoft Zira - English (United States)", voiceURI: "Microsoft Zira - English (United States)" },
          { default: false, lang: "en-GB", localService: true, name: "Microsoft Hazel - English (Great Britain)", voiceURI: "Microsoft Hazel - English (Great Britain)" },
        ];
      }
      return voices;
    };
  }

  // 17. Performance timing noise
  var origNow = performance.now;
  performance.now = function() { return origNow.call(this) + (Math.random() * 0.1); };

  // 18. document.hasFocus
  document.hasFocus = function() { return true; };

  // 19. Font enumeration defense
  if (document.fonts && typeof document.fonts.check === "function") {
    var origFontCheck = document.fonts.check.bind(document.fonts);
    var allowedFonts = {};
    for (var fi = 0; fi < opts.fonts.length; fi++) allowedFonts[opts.fonts[fi].toLowerCase()] = true;
    document.fonts.check = function(font, text) {
      var familyMatch = font.match(/(?:\\d+(?:px|pt|em|rem)\\s+)?["']?([^"',]+)/);
      var family = familyMatch && familyMatch[1] ? familyMatch[1].trim().toLowerCase() : "";
      if (family && !allowedFonts[family]) return false;
      return origFontCheck(font, text);
    };
  }

  // 20. Object.getOwnPropertyDescriptor protection
  var origGOPD = Object.getOwnPropertyDescriptor;
  var patchedNavProps = { webdriver:1, hardwareConcurrency:1, platform:1, languages:1, plugins:1, mimeTypes:1, deviceMemory:1, maxTouchPoints:1, connection:1 };
  Object.getOwnPropertyDescriptor = function(obj, prop) {
    if (obj === navigator && typeof prop === "string" && patchedNavProps[prop]) {
      return { get: function() { return navigator[prop]; }, set: undefined, enumerable: true, configurable: true };
    }
    if (obj === window && prop === "chrome") {
      return { value: window.chrome, writable: true, enumerable: true, configurable: true };
    }
    return origGOPD(obj, prop);
  };

})();`;

  await page.addInitScript({ content: script });
}
