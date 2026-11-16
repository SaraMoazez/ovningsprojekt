# ADR 0001: SQL migrations with an in-house runner

Date: 2026-11-16
Status: Proposed (pending user review)

Related: `docs/plans/idempotent-order-retry.md` (step 0), `docs/research/idempotent-order-retry.md`.

## Context

- The project has no migration tooling. `db/` contains only `schema.sql`, which drops and
  recreates the four known tables, and `seed.sql`.
- The closing note in `docs/user-stories.md` requires database changes to be made as migrations
  in steps that can be reverted ("Gör dem som migreringar i steg som går att backa").
- User story 1 (idempotent order retry) is the first feature that needs a schema change: new
  columns and a unique constraint on `orders`.
- The database is rebuilt in two places with duplicated logic: `resetDb` in
  `tests/helpers/db.ts` (before every test) and the `main` function in `scripts/db-reset.ts` (dev
  and test DBs). Both run `schema.sql` and then `seed.sql`. Any migration approach must fit into
  this flow, or the test DB will not have the new schema.
- `npm run lint` and `npm run format:check` cover only `src` and `tests`, not `scripts`
  (`package.json`).
- The user decided (2026-11-15, research) on plain numbered SQL files with separate `up` and
  `down` scripts, run by a small runner, with no external dependency.

## Decision

1. **Migration files.** Migrations live in `db/migrations/` as pairs of plain SQL files:
   `NNNN_name.up.sql` and `NNNN_name.down.sql`, where `NNNN` is a zero-padded number that gives
   the order. Every `up` file must have a matching `down` file that restores the **schema** to its
   state before the `up` migration: running `up` and then `down` leaves the same tables, columns,
   types and constraints as before. Reversibility covers schema, not data: data stored in
   structures that `up` created, or data that `up` removed or transformed, may not be
   recoverable. Each `up` and `down` file in `db/migrations/` must start with a header comment
   `-- Data loss: …` stating whether it can cause data loss and, if so, what data may be affected
   (`none` if it cannot). A migration whose `up` would destroy existing data needs explicit user
   approval before it is written, and should preserve the data if practical (for example, add a
   new column before removing the old one, or keep a copy).
2. **Runner library** in `src/migrate.ts`, using the existing `pg` dependency:
   - `migrateUp(client, dir)` creates the tracking table if missing and applies every pending
     migration in numeric order.
   - `migrateDown(client, dir)` reverts only the most recently applied migration.
   - Each migration and its tracking-table change run in one transaction. On error the
     transaction is rolled back and the error is rethrown.
   - The runner refuses to run if an `up` file has no matching `down` file.
   - Values (the version) are written with parameterised queries (`docs/standard.md`, §Databas).
3. **Tracking table** `schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL
   DEFAULT now())`.
4. **Thin CLI** in `scripts/migrate.ts` (`up` / `down`), exposed as `npm run db:migrate` and
   `npm run db:migrate:down`. It reads the connection string from `DATABASE_URL`, like
   `scripts/db-reset.ts`.
5. **Shared reset.** `resetDatabase(client)` in `src/migrate.ts` runs `schema.sql`, drops
   `schema_migrations`, applies all migrations, and then runs `seed.sql`. Both
   `tests/helpers/db.ts` and `scripts/db-reset.ts` call it, which removes the duplicated logic.
   Migrations run before the seed so that seed data is inserted into the final schema.
6. **`schema.sql` stays the baseline** and is not edited. All new schema changes go through
   migrations.

The logic is placed in `src/` rather than `scripts/` so that it is linted, formatted, type-checked
and testable with Jest.

## Alternatives considered

### A. `node-pg-migrate` (external library)

- Pros: mature, well-known, supports up/down migrations and locking, less code to maintain.
- Cons: a new dependency; migrations are usually written in JavaScript/TypeScript rather than
  plain SQL; its own conventions and config to learn and fit into the existing reset flow.
- Rejected: the user chose no external dependency. The project needs only a handful of simple,
  sequential migrations, which a small runner covers.

### B. Only edit `schema.sql`

- Pros: no new code at all; the reset flow already rebuilds the DB from it.
- Cons: not a migration. It cannot be applied to an existing database without dropping all data,
  and it cannot be reverted step by step. This does not meet the reversible-migration
  requirement in `docs/user-stories.md`.
- Rejected.

## Consequences

**Positive**
- Schema changes are explicit, ordered, reviewable SQL files, each with a revert script.
- Dev and test DBs are rebuilt by the same code, so a reset gives both the same schema.
- No new runtime or dev dependency.

**Negative / risks**
- The project owns the runner code and its tests (`tests/migrations.test.ts`).
- The runner does not prevent two runs against the same database at the same time; both could
  try to apply the same pending migration. This is acceptable because migrations are run manually
  and Jest runs tests serially (`--runInBand`). If migrations are ever run automatically by
  several processes, add a lock (e.g. a PostgreSQL advisory lock) around `migrateUp` and
  `migrateDown`.
- Reversibility is schema-level only. Reverting migration 0001 restores the original `orders`
  schema, but permanently deletes all stored idempotency keys and fingerprints. Re-applying it
  afterwards does not bring them back.
- `down` scripts can destroy data. Running `db:migrate:down` or `db:reset` against the dev DB
  requires the user's approval first (CLAUDE.md, *Security*: ask for approval before destructive
  operations, database resets or potentially irreversible changes).
- `resetDb` now also runs migrations before every test, which makes the suite slightly slower.
- `schema.sql` does not drop `schema_migrations` or tables created by test fixture migrations;
  `resetDatabase` drops `schema_migrations` explicitly, and runner tests must clean up their own
  fixture tables.
- Over time, the real schema is `schema.sql` plus all migrations. Reading `schema.sql` alone no
  longer shows the full schema.
