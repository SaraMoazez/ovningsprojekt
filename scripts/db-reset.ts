// Återställer utvecklingsdatabasen och testdatabasen till schema, migreringar och testdata.
import { Client } from "pg";
import { resetDatabase } from "../src/migrate";

const urls = [
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/butik",
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/butik_test",
];

async function main(): Promise<void> {
  for (const url of urls) {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await resetDatabase(client);
    } finally {
      await client.end();
    }
    console.log(`Återställd: ${url.split("/").pop()}`);
  }
}

main().catch((e) => {
  console.error(`Kunde inte återställa databasen: ${(e as Error).message}`);
  process.exit(1);
});
