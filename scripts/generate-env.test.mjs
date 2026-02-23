import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ENV_ORDER, generateEnvFile } from "./generate-env.mjs";

async function testGenerateWritesAllExpectedKeys() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "collector-env-"));
  const outputPath = path.join(tempDir, ".env");

  const { values } = await generateEnvFile({ outputPath });
  const content = await readFile(outputPath, "utf8");

  for (const key of ENV_ORDER) {
    assert.match(content, new RegExp(`^${key}=`, "m"));
  }

  assert.ok(values.COLLECTOR_API_TOKEN.startsWith("collector_"));
  assert.equal(
    values.COLLECTOR_BOOTSTRAP_ADMIN_TOKEN,
    values.COLLECTOR_API_TOKEN
  );
  assert.equal(values.API_TOKEN, values.COLLECTOR_API_TOKEN);
  assert.notEqual(values.POSTGRES_PASSWORD, "collector_password_change_me");
  assert.notEqual(values.S3_ACCESS_KEY, "minioadmin");
  assert.notEqual(values.S3_SECRET_KEY, "minioadmin");
  assert.equal(values.COLLECTOR_ARTIFACT_BACKEND, "local");
}

async function testFailsIfOutputExists() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "collector-env-"));
  const outputPath = path.join(tempDir, ".env");
  await writeFile(outputPath, "EXISTING=1\n", "utf8");

  await assert.rejects(
    () => generateEnvFile({ outputPath }),
    (error) =>
      Boolean(
        error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "EEXIST"
      )
  );
}

async function testForceOverwrite() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "collector-env-"));
  const outputPath = path.join(tempDir, ".env");
  await writeFile(outputPath, "EXISTING=1\n", "utf8");

  await generateEnvFile({ outputPath, force: true });
  const content = await readFile(outputPath, "utf8");

  assert.doesNotMatch(content, /^EXISTING=1$/m);
  assert.match(content, /^COLLECTOR_API_TOKEN=/m);
}

await testGenerateWritesAllExpectedKeys();
await testFailsIfOutputExists();
await testForceOverwrite();

async function testSupportsS3BackendOverride() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "collector-env-"));
  const outputPath = path.join(tempDir, ".env");

  const { values } = await generateEnvFile({ outputPath, backend: "s3" });
  const content = await readFile(outputPath, "utf8");

  assert.equal(values.COLLECTOR_ARTIFACT_BACKEND, "s3");
  assert.match(content, /^COLLECTOR_ARTIFACT_BACKEND=s3$/m);
}

await testSupportsS3BackendOverride();

process.stdout.write("generate-env tests passed\n");
