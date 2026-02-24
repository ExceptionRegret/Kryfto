#!/usr/bin/env node
/**
 * Version Consistency Checker for Kryfto Monorepo
 *
 * Verifies that all package.json files and version.ts are in sync.
 * Exits with code 1 if any mismatch is found. Use in CI.
 *
 * Usage:
 *   node scripts/check-version.mjs
 *   pnpm version:check
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PACKAGES = [
    "apps/api",
    "apps/worker",
    "packages/cli",
    "packages/mcp-server",
    "packages/sdk-ts",
    "packages/shared",
];

const VERSION_TS_PATH = path.join(ROOT, "packages/mcp-server/src/version.ts");

let referenceVersion = null;
let referencePkg = null;
let errors = 0;

// Check all package.json files
for (const pkg of PACKAGES) {
    const pkgPath = path.join(ROOT, pkg, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    const data = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    if (!referenceVersion) {
        referenceVersion = data.version;
        referencePkg = pkg;
        console.log(`📌 Reference version: ${referenceVersion} (from ${pkg})`);
    } else if (data.version !== referenceVersion) {
        console.error(`❌ ${pkg}/package.json: ${data.version} (expected ${referenceVersion})`);
        errors++;
    } else {
        console.log(`✅ ${pkg}/package.json: ${data.version}`);
    }
}

// Check version.ts
if (fs.existsSync(VERSION_TS_PATH)) {
    const content = fs.readFileSync(VERSION_TS_PATH, "utf-8");
    const match = content.match(/SERVER_VERSION\s*=\s*"([^"]+)"/);
    if (match) {
        const tsVersion = match[1];
        if (tsVersion !== referenceVersion) {
            console.error(`❌ version.ts SERVER_VERSION: ${tsVersion} (expected ${referenceVersion})`);
            errors++;
        } else {
            console.log(`✅ version.ts SERVER_VERSION: ${tsVersion}`);
        }
    } else {
        console.error("❌ version.ts: could not parse SERVER_VERSION");
        errors++;
    }
}

console.log("");
if (errors > 0) {
    console.error(`💥 ${errors} version mismatch(es) found!`);
    console.error("   Run: pnpm version:bump <patch|minor|major|X.Y.Z>");
    process.exit(1);
} else {
    console.log("✨ All versions in sync!");
}
