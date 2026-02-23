import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

const POSTGRES_HOST = process.env.POSTGRES_HOST ?? "postgres";
const POSTGRES_PORT = Number(process.env.POSTGRES_PORT ?? 5432);
const POSTGRES_DB = process.env.POSTGRES_DB ?? "collector";
const POSTGRES_USER = process.env.POSTGRES_USER ?? "collector";
const POSTGRES_PASSWORD =
  process.env.POSTGRES_PASSWORD ?? "collector_password_change_me";

export const pool = new Pool({
  host: POSTGRES_HOST,
  port: POSTGRES_PORT,
  database: POSTGRES_DB,
  user: POSTGRES_USER,
  password: POSTGRES_PASSWORD,
  max: Number(process.env.PG_POOL_MAX ?? 20),
});

export const db = drizzle(pool, { schema });

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateApiToken(): string {
  return randomBytes(24).toString("hex");
}

function resolveMigrationsDir(): string {
  const explicit = process.env.KRYFTO_MIGRATIONS_DIR;
  if (explicit) {
    return explicit;
  }

  const cwdPath = path.join(process.cwd(), "apps", "api", "migrations");
  return cwdPath;
}

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationDir = resolveMigrationsDir();
    let files = await readdir(migrationDir);
    files = files.filter((file) => file.endsWith(".sql")).sort();

    for (const file of files) {
      const already = await client.query(
        "SELECT 1 FROM schema_migrations WHERE name = $1",
        [file]
      );
      if (already.rowCount && already.rowCount > 0) {
        continue;
      }

      const sql = await readFile(path.join(migrationDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
          file,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}
