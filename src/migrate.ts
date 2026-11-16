import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ClientBase } from "pg";

interface Migration {
  version: string;
  upFile: string;
  downFile: string;
}

// Finds `NNNN_name.up.sql` files in `dir`, sorted by their numeric version.
// Throws if any up file lacks its matching `NNNN_name.down.sql` file.
function findMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .map((file) => /^((\d+)_.+)\.up\.sql$/.exec(file))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => {
      const downFile = path.join(dir, `${match[1]}.down.sql`);
      if (!existsSync(downFile)) {
        throw new Error(`Migration ${match[0]} has no matching down file: ${downFile}`);
      }
      return { version: match[2], upFile: path.join(dir, match[0]), downFile };
    })
    .sort((a, b) => Number(a.version) - Number(b.version));
}

async function appliedVersions(client: ClientBase): Promise<Set<string>> {
  const res = await client.query<{ version: string }>("SELECT version FROM schema_migrations");
  return new Set(res.rows.map((r) => r.version));
}

export async function migrateUp(client: ClientBase, dir: string): Promise<void> {
  const migrations = findMigrations(dir);
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
  const applied = await appliedVersions(client);
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    await withTransaction(client, async () => {
      await client.query(readFileSync(migration.upFile, "utf8"));
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [
        migration.version,
      ]);
    });
  }
}

// Reverts the most recently applied migration, i.e. the applied one with the highest version.
export async function migrateDown(client: ClientBase, dir: string): Promise<void> {
  const applied = await appliedVersions(client);
  const latest = findMigrations(dir)
    .filter((m) => applied.has(m.version))
    .pop();
  if (latest === undefined) return;
  await withTransaction(client, async () => {
    await client.query(readFileSync(latest.downFile, "utf8"));
    await client.query("DELETE FROM schema_migrations WHERE version = $1", [latest.version]);
  });
}

async function withTransaction(client: ClientBase, work: () => Promise<void>): Promise<void> {
  await client.query("BEGIN");
  try {
    await work();
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}
