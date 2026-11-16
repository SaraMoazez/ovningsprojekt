# Session 06 – Shared Reset with Migrations (Step 2)

**Date:** 2026-11-16
**Phase:** Implementation of Step 2 of `docs/plans/idempotent-order-retry.md` using the `/tdd` skill

## 1. Current state

Step 2 of the approved implementation plan (shared reset with migrations, CLI and npm scripts)
has been implemented with the `/tdd` skill (`/tdd docs/plans/idempotent-order-retry.md 2`).
`CLAUDE.md`, `docs/standard.md`, the plan (status `Approved.`) and ADR 0001 had already been read
earlier in the same conversation. Step 1 was committed (`7a00ca5`) and the working tree was clean
when the step started.

The test database and the development database are now reset by the same function,
`resetDatabase`, in the order `schema.sql` → all migrations → `seed.sql`. The test database is
reset this way before every test. The development database is only reset this way when
`npm run db:reset` is run, which has not been done in this session:

- `resetDatabase(client)` in `src/migrate.ts` runs `schema.sql`, drops `schema_migrations`,
  applies all migrations in `db/migrations/` with `migrateUp`, and then runs `seed.sql`.
  Migrations run before the seed so that seed data is inserted into the final schema.
- `migrationsDir` is exported from `src/migrate.ts` so the CLI does not duplicate the path.
- `resetDb` in `tests/helpers/db.ts` takes a pooled client, calls `resetDatabase`, and releases
  the client in `finally`.
- `scripts/db-reset.ts` calls `resetDatabase` for each URL, with its existing environment-variable
  handling and output unchanged. The client is now closed in `finally`.
- `scripts/migrate.ts` is a thin CLI: `up` runs `migrateUp`, `down` runs `migrateDown`, against
  `DATABASE_URL` (default as in `scripts/db-reset.ts`). Any other argument prints
  `Migration failed: Usage: migrate.ts up|down` and exits with code 1.
- `package.json` has two new scripts, `db:migrate` and `db:migrate:down`, both via
  `tsx --env-file-if-exists=.env`.
- `db/migrations/` exists but contains only `.gitkeep`. Migration 0001 is Step 3.

The changes have been presented to the user for review and are **not committed**. Step 3 has
not started.

**Files changed (7 files, 68 insertions, 24 deletions, from `git diff --stat` with
intent-to-add):**

- Modified: `package.json`, `scripts/db-reset.ts`, `src/migrate.ts`, `tests/helpers/db.ts`,
  `tests/migrations.test.ts` (one import and one new test; no existing test changed)
- New: `scripts/migrate.ts` (29 lines), `db/migrations/.gitkeep` (empty)

## 2. What worked

- The `/tdd` skill limited the work to Step 2 and followed the plan's testing strategy for the
  step: one new test for the reset, and the full existing suite as a regression check.
- The reset behaviour was developed with one RED-GREEN cycle. The scripts and npm scripts were
  written without tests, by user decision (see section 5).

**RED-GREEN-REFACTOR evidence:**

| # | Test | RED (observed first failure) | GREEN change | REFACTOR |
|---|---|---|---|---|
| 1 | `resetDb › applies migrations, so schema_migrations exists afterwards` | `Expected: true, Received: false` | Added `resetDatabase` and `migrationsDir` to `src/migrate.ts`, `resetDb` calls `resetDatabase`, created `db/migrations/.gitkeep` | None (see section 5) |

After GREEN, `tests/migrations.test.ts` passed with 8 of 8 tests, and the regression run of
`npm test` with `.venv` activated passed with 3 test suites, 24 of 24 tests.

**Smoke runs of the scripts (test database only):**

Each script was run once with `npx tsx` directly, without `--env-file`, so `.env` was not loaded.
`DATABASE_URL` (and for `db-reset.ts` also `TEST_DATABASE_URL`) pointed to `butik_test`. The
development database was not touched.

- `scripts/db-reset.ts` – printed `Återställd: butik_test` twice, exit code 0.
- `scripts/migrate.ts up` – printed `Migrated up: butik_test`, exit code 0.
- `scripts/migrate.ts down` – printed `Migrated down: butik_test`, exit code 0 (nothing to revert).
- `scripts/migrate.ts sideways` – printed `Migration failed: Usage: migrate.ts up|down`, exit
  code 1.
- Afterwards, `psql` on `butik_test` showed `schema_migrations` with 0 rows and `orders` with 8
  rows (seed data).

These smoke runs were made **before** the `SET client_min_messages` line was removed from
`resetDatabase` (see section 5). After the removal, the user re-ran `scripts/db-reset.ts`
against the test database and reported the same output (`Återställd: butik_test` twice). This
re-run was done by the user, not by the agent. The `scripts/migrate.ts` runs were not repeated;
that script does not call `resetDatabase`, so the removal does not affect it.

**Final verification (run one at a time, with `.venv` activated for `npm test`):**

- `npm run lint` – passed, no output.
- `npm run typecheck` – passed, no output. Also covers `scripts/`.
- `npm run format:check` – passed: "All matched files use Prettier code style!"
- `npm test` – passed: 3 test suites, 24 of 24 tests (23 from before + 1 new).
- `npx prettier --check scripts/*.ts` – passed. Extra check, because `format:check` does not
  cover `scripts/`.
- No warnings were reported by any check.
- `npm run test:legacy` was **not run**. The plan schedules it for Step 8.

After each of the two follow-up removals in section 5, `npm run lint`, `npm run typecheck`,
`npm run format:check` and `npm test` (with `.venv`) were run again one at a time. All passed
each time, with 24 of 24 tests.

## 3. What failed

**No RED phase for the scripts.**

The plan lists no tests for `scripts/db-reset.ts`, `scripts/migrate.ts` or the npm scripts, and
Jest only runs `tests/**/*.test.ts`. Following the skill's rule, work stopped before writing them
and the user was asked how to proceed. They were verified by type checking and smoke runs instead
(see sections 2 and 5).

**`db/migrations/` did not exist.**

The plan assumes the directory exists but is empty. Without it, `migrateUp` would fail with
`ENOENT` when it reads the directory. Git does not track empty directories, so
`db/migrations/.gitkeep` was added. This is a deviation from the plan's file list.

**No test failures.** Because `.venv` was activated for every `npm test` run, the
`GET /orders/:id/price` failure from Session 05 did not recur.

**Process slip by the agent:**

- `SET client_min_messages TO warning` was copied into `resetDatabase` from the two old reset
  paths without checking whether it had any effect. The user asked why it was needed, which led
  to its removal (see section 5).

## 4. What remains

- User review and commit of Step 2 (not committed or pushed by the agent).
- Step 3: migration 0001 (`db/migrations/0001_add_order_idempotency.up.sql` / `.down.sql`).
  Note for Step 3: the runner tests still drop `schema_migrations` in their `beforeEach` /
  `afterEach` cleanup. This is harmless now, because every other test's `resetDb` recreates it,
  but it should be reviewed once migration 0001 exists.
- Steps 4–8 of the plan.
- Running `npm run db:reset`, `db:migrate` or `db:migrate:down` against the development database
  requires the user's approval. None was run in this session.
- `scripts/migrate.ts down` prints `Migrated down` even when nothing was applied and nothing was
  reverted. Left unchanged; could be made clearer later.

## 5. Decisions made

- **Script verification (user decision):** write the scripts without Jest tests, as the plan
  intends (the logic lives in `src/migrate.ts`, which is tested), and verify them with type
  checking and one smoke run each against the test database only. The alternatives offered were
  CLI tests that spawn the scripts as child processes, or stopping after `resetDb`.
- **`db/migrations/.gitkeep`** keeps the empty migrations directory in git. The runner ignores it
  because it does not match `NNNN_name.up.sql`.
- **No refactor of the scripts:** both scripts share a small connect / `try` / `end` pattern
  (about six lines). It was left in place rather than adding a shared helper, following
  `CLAUDE.md`'s preference for simple solutions.
- **Removed `SET client_min_messages TO warning` (user decision):**
  - The line was in both old reset paths and was first kept in `resetDatabase`.
  - A check script against `butik_test` (in the session scratchpad, outside the project) showed
    that node-postgres does not print PostgreSQL notices. They are only emitted as `notice`
    events, and nothing in the project listens for them. The line therefore had no visible
    effect.
  - It was removed from `resetDatabase` in `src/migrate.ts`, and then, at the user's request, also
    from `cleanupSql` in `tests/migrations.test.ts` (Step 1 code, no test or assertion changed).
- **Existing Swedish comments:** the header comments in `scripts/db-reset.ts` and
  `tests/helpers/db.ts` were updated to mention migrations ("migreringar") and kept in Swedish,
  as the plan says existing Swedish text is not translated. New code and comments are in English.
- **Verification with `.venv`:** every `npm test` run was made with `.venv` activated, following
  the clarified `npm test` entry in `CLAUDE.md`.

## 6. Resource Usage

Not recorded by the agent. Session statistics can be added from Claude Code `/usage`.
