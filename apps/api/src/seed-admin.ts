import { db, generateApiToken, hashToken, runMigrations } from "./db/client.js";
import { apiTokens, projects } from "./db/schema.js";

function argValue(flag: string, fallback?: string): string {
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1] as string;
  }
  if (fallback) return fallback;
  throw new Error(`Missing ${flag}`);
}

async function main(): Promise<void> {
  const projectId = argValue(
    "--project",
    process.env.KRYFTO_PROJECT_ID ?? "default"
  );
  const name = argValue("--name", "seed-admin");
  const role = argValue("--role", "admin");

  if (!["admin", "developer", "readonly"].includes(role)) {
    throw new Error("Role must be one of admin|developer|readonly");
  }

  await runMigrations();

  await db
    .insert(projects)
    .values({ id: projectId, name: projectId })
    .onConflictDoNothing({ target: projects.id });

  const token = generateApiToken();

  const inserted = await db
    .insert(apiTokens)
    .values({
      projectId,
      name,
      role: role as "admin" | "developer" | "readonly",
      tokenHash: hashToken(token),
    })
    .returning({
      id: apiTokens.id,
      role: apiTokens.role,
      projectId: apiTokens.projectId,
      name: apiTokens.name,
    });

  process.stdout.write(
    JSON.stringify(
      {
        token,
        tokenId: inserted[0]?.id,
        role: inserted[0]?.role,
        projectId: inserted[0]?.projectId,
        name: inserted[0]?.name,
      },
      null,
      2
    )
  );
  process.stdout.write("\n");
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
