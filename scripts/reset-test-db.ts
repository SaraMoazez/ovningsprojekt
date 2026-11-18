// Resets ONLY the test database (TEST_DATABASE_URL) to schema + migrations + seed data.
// Used by the Python tests. Never reads DATABASE_URL, and refuses to connect unless the
// database that pg would actually use has a name ending in "_test".
import { Client } from "pg";
import { resetDatabase } from "../src/migrate";

const TEST_SUFFIX = "_test";

async function main(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("TEST_DATABASE_URL is not set. Refusing to guess which database to reset.");
  }
  const client = new Client({ connectionString: url });
  // client.database is the name pg will use, resolved from the URL (or its defaults when the URL
  // has no name) without connecting. pg ignores a ?database= query parameter.
  const name = client.database ?? "";
  if (name.length <= TEST_SUFFIX.length || !name.endsWith(TEST_SUFFIX)) {
    throw new Error(`Refusing to reset database "${name}": its name must end in ${TEST_SUFFIX}.`);
  }
  await client.connect();
  try {
    await resetDatabase(client);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
