#!/usr/bin/env node
/**
 * Unified Version Bump Script for Kryfto Monorepo
 *
 * Updates all package.json files AND packages/mcp-server/src/version.ts
 * in a single atomic operation, keeping versions in sync.
 *
 * Usage:
 *   node scripts/bump-version.mjs <new-version>
 *   node scripts/bump-version.mjs patch    # 3.2.0 -> 3.2.1
 *   node scripts/bump-version.mjs minor    # 3.2.0 -> 3.3.0
 *   node scripts/bump-version.mjs major    # 3.2.0 -> 4.0.0
 *   node scripts/bump-version.mjs 3.5.0    # explicit version
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// All packages that should be version-synced
const PACKAGES = [
    "apps/api",
    "apps/worker",
    "packages/cli",
    "packages/mcp-server",
    "packages/sdk-ts",
    "packages/shared",
];

const VERSION_TS_PATH = path.join(ROOT, "packages/mcp-server/src/version.ts");

function readCurrentVersion() {
    const pkgPath = path.join(ROOT, "packages/mcp-server/package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version;
}

function bumpVersion(current, type) {
    const [major, minor, patch] = current.split(".").map(Number);
    switch (type) {
        case "major":
            return `${major + 1}.0.0`;
        case "minor":
            return `${major}.${minor + 1}.0`;
        case "patch":
            return `${major}.${minor}.${patch + 1}`;
        default:
            // Treat as explicit version string
            if (/^\d+\.\d+\.\d+/.test(type)) return type;
            console.error(`❌ Invalid version or bump type: "${type}"`);
            console.error("Usage: node scripts/bump-version.mjs <patch|minor|major|X.Y.Z>");
            process.exit(1);
    }
}

function updatePackageJson(pkgDir, newVersion) {
    const pkgPath = path.join(ROOT, pkgDir, "package.json");
    if (!fs.existsSync(pkgPath)) {
        console.warn(`  ⚠️  Skipping ${pkgDir} (no package.json)`);
        return false;
    }
    const raw = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw);
    const oldVersion = pkg.version;
    pkg.version = newVersion;
    // Preserve original formatting (2-space indent with trailing newline)
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`  ✅ ${pkgDir}/package.json: ${oldVersion} → ${newVersion}`);
    return true;
}

function updateVersionTs(newVersion) {
    if (!fs.existsSync(VERSION_TS_PATH)) {
        console.warn("  ⚠️  version.ts not found, skipping");
        return false;
    }
    let content = fs.readFileSync(VERSION_TS_PATH, "utf-8");
    const oldMatch = content.match(/SERVER_VERSION\s*=\s*"([^"]+)"/);
    const old = oldMatch ? oldMatch[1] : "unknown";
    content = content.replace(
        /export const SERVER_VERSION\s*=\s*"[^"]+"/,
        `export const SERVER_VERSION = "${newVersion}"`
    );
    fs.writeFileSync(VERSION_TS_PATH, content);
    console.log(`  ✅ version.ts SERVER_VERSION: ${old} → ${newVersion}`);
    return true;
}

// ── Main ────────────────────────────────────────────────────────────
const arg = process.argv[2];
if (!arg) {
    console.error("Usage: node scripts/bump-version.mjs <patch|minor|major|X.Y.Z>");
    process.exit(1);
}

const current = readCurrentVersion();
const newVersion = bumpVersion(current, arg);

console.log(`\n🔄 Kryfto Version Bump: ${current} → ${newVersion}\n`);

let updated = 0;
for (const pkg of PACKAGES) {
    if (updatePackageJson(pkg, newVersion)) updated++;
}
if (updateVersionTs(newVersion)) updated++;

console.log(`\n✨ Done! Updated ${updated} files to v${newVersion}`);
console.log("   Next steps:");
console.log("     1. pnpm install   (update lockfile)");
console.log("     2. pnpm build     (rebuild with new version)");
console.log("     3. git add -A && git commit -m \"chore: bump to v" + newVersion + "\"");
console.log("");
