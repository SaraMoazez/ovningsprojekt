# Session 05 – Migration Runner (Step 1)

**Date:** 2026-11-16
**Phase:** Implementation of Step 1 of `docs/plans/idempotent-order-retry.md` using the `/tdd` skill

## 1. Current state

Step 1 of the approved implementation plan (migration runner library) has been implemented
with the `/tdd` skill (`/tdd docs/plans/idempotent-order-retry.md 1`). The plan's status field
was verified as `Status: **Approved.**` before work started.

`src/migrate.ts` now exports two functions that take a `pg` `ClientBase` (so both pooled
clients and plain `Client` instances work) and a migrations directory:

- `migrateUp(client, dir)` – creates `schema_migrations (version TEXT PRIMARY KEY, applied_at
  TIMESTAMPTZ NOT NULL DEFAULT now())` if it is missing, and applies every pending
  `NNNN_name.up.sql` file in numeric order. Each migration and its record insert run in one
  transaction, which is rolled back and the error rethrown on failure.
- `migrateDown(client, dir)` – reverts the most recently applied migration (the applied one with
  the highest version) with its `.down.sql` file and deletes its record, in one transaction.
- Both refuse to run if any `up` file has no matching `down` file. The check happens before the
  database is touched.
- The version is written and deleted with parameterised queries.

A private `withTransaction` helper holds the `BEGIN` / `COMMIT` / `ROLLBACK` logic shared by both
functions.

The changes have been presented to the user for review and are **not committed**. Step 2 has
not started. No existing source files or tests were modified.

**Files created (13 files, 211 insertions, from `git diff --stat` with intent-to-add):**

- `src/migrate.ts` (74 lines)
- `tests/migrations.test.ts` (106 lines, 7 tests)
- `tests/fixtures/migrations/valid/9001_create_fixture_a.up.sql` / `.down.sql`
- `tests/fixtures/migrations/valid/9002_create_fixture_b.up.sql` / `.down.sql`
- `tests/fixtures/migrations/missing-down/9001_create_fixture_a.up.sql` (intentionally no `down`)
- `tests/fixtures/migrations/failing/9001_broken.up.sql` / `.down.sql`
- `tests/fixtures/migrations/failing-record/9001_record_conflict.up.sql` / `.down.sql`
- `tests/fixtures/migrations/failing-record-down/9001_down_record_conflict.up.sql` / `.down.sql`

**Session resource usage:** not recorded for this session.

## 2. What worked

- The `/tdd` skill read `CLAUDE.md`, `docs/standard.md`, the plan and ADR 0001, verified the
  plan's approval status, and limited the work to Step 1.
- Each behaviour was developed using the RED-GREEN-REFACTOR process where applicable. The exception was test 5, which passed before explicit transaction handling was implemented (see section 3). The test file was run
  with `npx jest --runInBand tests/migrations.test.ts` after every change.

**RED-GREEN-REFACTOR evidence:**

| # | Test | RED (observed first failure) | GREEN change | REFACTOR |
|---|---|---|---|---|
| 1 | `migrateUp applies all pending migrations in numeric order` | `TS2307: Cannot find module '../src/migrate'` | Created `src/migrate.ts` with `findMigrations` and `migrateUp` | None needed |
| 2 | `migrateUp twice is a no-op` | `error: relation "migration_fixture_a" already exists` | Skip versions already in `schema_migrations` | None needed |
| 3 | `migrateDown reverts only the latest migration` | `TS2305: Module '"../src/migrate"' has no exported member 'migrateDown'` | Added `migrateDown` | Extracted the duplicated "read applied versions" query into `appliedVersions` |
| 4 | `migrateUp rejects an up migration without a down migration` | `Received promise resolved instead of rejected` | `findMigrations` resolves the `down` path and throws if missing; `migrateUp` calls it before any query | `migrateDown` uses the stored `downFile` instead of deriving it |
| 5 | `a failing migration is rolled back and not recorded` | **Passed before any transaction code existed** (see section 3) | – | – |
| 5b | `a migration is rolled back if recording it fails` | `Expected: false, Received: true` (fixture table remained) | Wrapped each migration and its record insert in `BEGIN`/`COMMIT`/`ROLLBACK` | – |
| 6 | `migrateDown is rolled back if removing the record fails` | `Expected: true, Received: false` (fixture table was dropped) | Added `withTransaction` and used it in `migrateDown` | `migrateUp` reuses `withTransaction` |

All 7 tests in `tests/migrations.test.ts` passed after each GREEN and REFACTOR step that
followed.

**Final verification (run one at a time):**

- `npm run lint` – passed, no output.
- `npm run typecheck` – passed, no output.
- `npm run format:check` – passed: "All matched files use Prettier code style!"
- `npm test` without `.venv` activated – failed: 22 of 23 passed (see section 3).
- `npm test` with `.venv` activated (`source .venv/bin/activate`, `python3` resolved to
  `.venv/bin/python3`) – passed: 3 test suites, 23 of 23 tests (16 existing + 7 new).
- No warnings were reported by any check.
- `npm run test:legacy` was **not run**. The plan schedules it for Step 8.

## 3. What failed

**RED phase could not be demonstrated for the planned rollback test (test 5).**

The planned test used a fixture with a valid `CREATE TABLE` followed by invalid SQL. It passed
before any transaction code was written. Cause: `pg` sends a migration file's SQL as one
simple-protocol query, and PostgreSQL runs all statements in such a query as one implicit
transaction. The `CREATE TABLE` was therefore rolled back by PostgreSQL itself, and the record
insert never ran because the error was thrown first. The fixture could not distinguish a runner
with an explicit transaction from one without.

Following the skill's rule, work stopped before changing production code and the user was
asked how to proceed (see section 5).

**`npm test` failed on the first full run.**

- 1 test failed, 22 passed: `GET /orders/:id/price › räknar pris med moms via den äldre modulen`
  returned 404 instead of 200.
- The failure is pre-existing: the same test also failed on clean `main` with the new files
  stashed (`git stash -u`, then restored with `git stash pop`).
- Cause (same as Session 04): `src/pricing/legacyPrice.ts` runs `python3` from `PATH`. Without
  `.venv` activated this was Homebrew Python 3.15, where `import psycopg` raises
  `ModuleNotFoundError`. The bridge maps any error to `not_found` (404), which hides the real
  cause. `.venv` has `psycopg` 3.2.3.
- With `.venv` activated the full suite passed. No code or configuration was changed.

**Process slips by the agent:**

- During the REFACTOR of cycle 3, the agent used the system `python3` as a text-editing script.
  It was not a project command, but it went against the intent of the `.venv` rule in
  `CLAUDE.md`. Later edits used the Edit tool.
- The agent sent one pointless empty Bash command (create and delete an empty file). The user
  denied it. It had no effect.

## 4. What remains

- User review and commit of Step 1 (not committed or pushed by the agent).
- Step 2: shared `resetDatabase`, `scripts/migrate.ts` CLI and `db:migrate` / `db:migrate:down`
  npm scripts. Note for Step 2: the runner tests currently drop `schema_migrations` in their
  `beforeEach` / `afterEach` cleanup, because nothing else manages it yet. Once `resetDb` creates
  `schema_migrations` via `resetDatabase`, this cleanup needs to be reconsidered.
- Steps 3–8 of the plan.
- `CLAUDE.md` required `.venv` for Python-related commands but did not say that `npm test` counts
  as one, which led to the first `npm test` run without `.venv`. After this session, the
  `npm test` entry in `CLAUDE.md` was clarified at the user's request.
- Optionally, make the legacy bridge independent of `PATH` (code change, not made in this
  session).
- Consider making `legacyPrice.ts` report Python errors distinctly instead of as 404. Out of
  scope for this plan.

## 5. Decisions made

- **Fixture layout:** fixtures live in one subdirectory per scenario (`valid/`, `missing-down/`,
  `failing/`, `failing-record/`, `failing-record-down/`) instead of the plan's flat
  `tests/fixtures/migrations/9001_*` layout. A flat directory would make every `migrateUp` call
  hit the broken fixtures. This is a deviation from the plan.
- **Rollback RED (user decision):** keep test 5 as a regression guard, and add test 5b with a
  `failing-record` fixture whose SQL succeeds but inserts its own version into
  `schema_migrations`. The runner's record insert then fails with a duplicate key, which only an
  explicit transaction can roll back.
- **Extra test 6:** the plan requires `migrateDown` to run in one transaction but listed no test
  for it. A mirrored test was added, using a `failing-record-down` fixture whose `down` SQL drops
  `schema_migrations`, so the runner's record delete fails. This is a deviation from the plan's
  test table.
- **"Most recently applied"** is defined as the applied migration with the highest version, not
  the latest `applied_at`, because `migrateUp` applies in numeric order and timestamps can tie.
- **Client type:** functions accept `pg`'s `ClientBase` so Step 2 can reuse them with a pooled
  client (tests) and a plain `Client` (scripts).
- **Data-loss headers:** all fixture files start with a `-- Data loss: …` comment, as ADR 0001
  requires for `db/migrations/`, although the rule does not formally cover test fixtures.
- **Verification with `.venv`:** the full test suite is run with `.venv` activated, as required by
  `CLAUDE.md`, rather than changing code or configuration to work around the system Python.

## 6. Resource Usage

**Claude Code session statistics:**

- Total cost: $1.98
- API duration: 5m 51s
- Wall-clock duration: 29m 44s
- Code changes: 352 lines added, 24 removed
- Main model: claude-opus-5-5
- Haiku usage: 1.2k input tokens, 22 output tokens

**Usage observations:**

- `/tdd` accounted for approximately 20% of usage on this machine during the last 24 hours.
- 97% of input tokens came from the prompt cache.
- Usage statistics are approximate and cover sessions on this machine only.