// Applies (`up`) or reverts the latest (`down`) migration in db/migrations on DATABASE_URL.
import { Client } from "pg";
import { migrateDown, migrateUp, migrationsDir } from "../src/migrate";

const url = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/butik";
const command = process.argv[2];

async function main(): Promise<void> {
  if (command !== "up" && command !== "down") {
    throw new Error("Usage: migrate.ts up|down");
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    if (command === "up") {
      await migrateUp(client, migrationsDir);
    } else {
      await migrateDown(client, migrationsDir);
    }
  } finally {
    await client.end();
  }
  console.log(`Migrated ${command}: ${url.split("/").pop()}`);
}

main().catch((e) => {
  console.error(`Migration failed: ${(e as Error).message}`);
  process.exit(1);
});
