import path from "node:path";
import { PoolClient } from "pg";
import { db } from "../src/db";
import { migrateDown, migrateUp, migrationsDir } from "../src/migrate";
import { closeDb, resetDb } from "./helpers/db";

const fixtures = path.join(__dirname, "fixtures", "migrations");
const validDir = path.join(fixtures, "valid");

// schema.sql does not drop these tables, so the runner tests clean up after themselves.
const cleanupSql = `
  DROP TABLE IF EXISTS migration_fixture_b, migration_fixture_a, migration_fixture_broken,
    migration_fixture_record_conflict, migration_fixture_down_conflict, schema_migrations;
`;

let client: PoolClient;

async function tableExists(name: string): Promise<boolean> {
  const res = await client.query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [name],
  );
  return res.rows[0].exists;
}

// Returns [] if the tracking table has not been created.
async function appliedVersions(): Promise<string[]> {
  if (!(await tableExists("schema_migrations"))) return [];
  const res = await client.query<{ version: string }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  return res.rows.map((r) => r.version);
}

beforeEach(async () => {
  client = await db.connect();
  await client.query(cleanupSql);
});

afterEach(async () => {
  await client.query(cleanupSql);
  client.release();
});

afterAll(closeDb);

describe("migration runner", () => {
  it("migrateUp applies all pending migrations in numeric order", async () => {
    await migrateUp(client, validDir);

    expect(await tableExists("migration_fixture_a")).toBe(true);
    expect(await tableExists("migration_fixture_b")).toBe(true);
    expect(await appliedVersions()).toEqual(["9001", "9002"]);
  });

  it("migrateUp twice is a no-op", async () => {
    await migrateUp(client, validDir);
    await migrateUp(client, validDir);

    expect(await appliedVersions()).toEqual(["9001", "9002"]);
  });

  it("migrateDown reverts only the latest migration", async () => {
    await migrateUp(client, validDir);

    await migrateDown(client, validDir);

    expect(await tableExists("migration_fixture_b")).toBe(false);
    expect(await tableExists("migration_fixture_a")).toBe(true);
    expect(await appliedVersions()).toEqual(["9001"]);
  });

  it("migrateUp rejects an up migration without a down migration", async () => {
    await expect(migrateUp(client, path.join(fixtures, "missing-down"))).rejects.toThrow(
      "9001_create_fixture_a.down.sql",
    );

    expect(await tableExists("migration_fixture_a")).toBe(false);
    expect(await appliedVersions()).toEqual([]);
  });

  it("a failing migration is rolled back and not recorded", async () => {
    await expect(migrateUp(client, path.join(fixtures, "failing"))).rejects.toThrow();

    expect(await tableExists("migration_fixture_broken")).toBe(false);
    expect(await appliedVersions()).toEqual([]);
  });

  it("a migration is rolled back if recording it fails", async () => {
    await expect(migrateUp(client, path.join(fixtures, "failing-record"))).rejects.toThrow();

    expect(await tableExists("migration_fixture_record_conflict")).toBe(false);
    expect(await appliedVersions()).toEqual([]);
  });

  it("migrateDown is rolled back if removing the record fails", async () => {
    const dir = path.join(fixtures, "failing-record-down");
    await migrateUp(client, dir);

    await expect(migrateDown(client, dir)).rejects.toThrow();

    expect(await tableExists("migration_fixture_down_conflict")).toBe(true);
    expect(await appliedVersions()).toEqual(["9001"]);
  });
});

describe("resetDb", () => {
  it("applies migrations, so schema_migrations exists afterwards", async () => {
    await resetDb();

    expect(await tableExists("schema_migrations")).toBe(true);
  });
});

describe("migration 0001: order idempotency", () => {
  const constraintName = "orders_customer_idempotency_key_unique";

  interface OrderColumn {
    column_name: string;
    data_type: string;
    character_maximum_length: number | null;
    is_nullable: string;
  }

  async function idempotencyColumns(): Promise<OrderColumn[]> {
    const res = await client.query<OrderColumn>(
      `SELECT column_name, data_type, character_maximum_length, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = ANY($1)
        ORDER BY column_name`,
      [["idempotency_key", "request_hash"]],
    );
    return res.rows;
  }

  beforeEach(resetDb);

  it("adds nullable idempotency_key and request_hash columns to orders", async () => {
    expect(await idempotencyColumns()).toEqual([
      {
        column_name: "idempotency_key",
        data_type: "character varying",
        character_maximum_length: 255,
        is_nullable: "YES",
      },
      {
        column_name: "request_hash",
        data_type: "text",
        character_maximum_length: null,
        is_nullable: "YES",
      },
    ]);
  });

  it("makes idempotency_key unique per customer", async () => {
    const insertOrder = (customerId: number, key: string | null) =>
      client.query("INSERT INTO orders (customer_id, idempotency_key) VALUES ($1, $2)", [
        customerId,
        key,
      ]);

    // Allowed: several orders without a key, and the same key for different customers.
    await insertOrder(1, null);
    await insertOrder(1, null);
    await insertOrder(1, "key-1");
    await insertOrder(2, "key-1");

    await expect(insertOrder(1, "key-1")).rejects.toThrow(`unique constraint "${constraintName}"`);
  });

  it("is reversible: down removes the columns and constraint, up re-adds them", async () => {
    const constraintExists = async (): Promise<boolean> => {
      const res = await client.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = $1) AS exists",
        [constraintName],
      );
      return res.rows[0].exists;
    };

    await migrateDown(client, migrationsDir);

    expect(await idempotencyColumns()).toEqual([]);
    expect(await constraintExists()).toBe(false);

    await migrateUp(client, migrationsDir);

    expect((await idempotencyColumns()).map((c) => c.column_name)).toEqual([
      "idempotency_key",
      "request_hash",
    ]);
    expect(await constraintExists()).toBe(true);
  });
});
