import { db } from "../../src/db";
import { resetDatabase } from "../../src/migrate";

// Återställer testdatabasen till schema + migreringar + testdata före varje test.
export async function resetDb(): Promise<void> {
  const client = await db.connect();
  try {
    await resetDatabase(client);
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  await db.end();
}
