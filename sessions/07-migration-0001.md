# Session 07 – Migration 0001 (Step 3)

**Date:** 2026-11-16
**Phase:** Implementation of Step 3 of `docs/plans/idempotent-order-retry.md` using the `/tdd` skill

## 1. Current state

Step 3 of the approved implementation plan (migration 0001, reversible) has been implemented with
the `/tdd` skill (`/tdd docs/plans/idempotent-order-retry.md 3`). Before work started, the agent
checked that Step 2 was committed (`d155a37`), that the working tree was clean, that the plan
status was still `Approved.`, and that the only change to `CLAUDE.md` or `docs/` since Step 1 was
the clarified `npm test` line. ADR 0002 was read for the column and constraint decisions.

Migration 0001 adds idempotency support to the `orders` table at the database level:

- `db/migrations/0001_add_order_idempotency.up.sql` adds two nullable columns,
  `idempotency_key VARCHAR(255)` and `request_hash TEXT`, and the named constraint
  `orders_customer_idempotency_key_unique` as `UNIQUE (customer_id, idempotency_key)`.
- `db/migrations/0001_add_order_idempotency.down.sql` drops the constraint and both columns by
  name.
- Both files start with the `-- Data loss:` header required by ADR 0001. `up`: none, existing
  rows get `NULL` keys. `down`: permanently deletes every stored `idempotency_key` and
  `request_hash`; the orders themselves are kept, and re-applying 0001 does not restore the
  deleted values.
- Because `resetDatabase` (Step 2) applies all migrations, the test database now gets the new
  columns before every test.

`db/schema.sql`, `db/seed.sql` and all application code are unchanged. The application does not
read or write the new columns yet; that starts in Step 4.

The changes have been presented to the user for review and are **not committed**. Step 4 has
not started.

**Files changed (3 files, 93 insertions, 1 deletion, from `git diff --stat` with
intent-to-add):**

- New: `db/migrations/0001_add_order_idempotency.up.sql` (6 lines),
  `db/migrations/0001_add_order_idempotency.down.sql` (6 lines)
- Modified: `tests/migrations.test.ts` (one import, `migrationsDir`, and a new
  `migration 0001: order idempotency` block with three tests; no existing test changed)

## 2. What worked

- The `/tdd` skill limited the work to Step 3 and followed the plan's testing strategy for the
  step: columns, per-customer uniqueness and reversibility.
- Each behaviour was developed with its own RED-GREEN-REFACTOR cycle. The test file was run with
  `npx jest --runInBand tests/migrations.test.ts` after every change. The new tests run `resetDb`
  in their own `beforeEach`.

**RED-GREEN-REFACTOR evidence:**

| # | Test | RED (observed first failure) | GREEN change | REFACTOR |
|---|---|---|---|---|
| 1 | `adds nullable idempotency_key and request_hash columns to orders` | `Received: Array []` (neither column existed) | `up` adds both columns; `down` is a placeholder with only its header (see section 5) | None needed |
| 2 | `makes idempotency_key unique per customer` | The three allowed inserts succeeded, then the duplicate also succeeded: `Received promise resolved instead of rejected` | `up` adds the named unique constraint | None needed |
| 3 | `is reversible: down removes the columns and constraint, up re-adds them` | After `migrateDown`, both columns were still present (placeholder `down`) | `down` drops the constraint and both columns | The constraint name, used twice in the tests, was moved into one constant |

After each GREEN step all tests in `tests/migrations.test.ts` passed (9, 10 and 11 tests). After
the refactor, `npx prettier --check tests/migrations.test.ts` passed and all 11 tests still
passed.

**Final verification (run one at a time, with `.venv` activated for `npm test`):**

- `npm run lint` – passed, no output.
- `npm run typecheck` – passed, no output.
- `npm run format:check` – passed: "All matched files use Prettier code style!"
- `npm test` – passed: 3 test suites, 27 of 27 tests (24 from before + 3 new). The existing
  order and customer tests passed against the new schema, because seeded orders get `NULL` keys.
- No warnings were reported by any check.
- `npm run test:legacy` was **not run**. The plan schedules it for Step 8.
- No command was run against the development database.

## 3. What failed

**No failures.** Every RED phase failed for the expected reason, and every GREEN and
verification run passed. Because `.venv` was activated for `npm test`, the
`GET /orders/:id/price` failure from Session 05 did not recur.

## 4. What remains

- User review and commit of Step 3 (not committed or pushed by the agent).
- Step 4: require and validate `Idempotency-Key` and store it (AC1, AC4, AC7, AC8).
- Steps 5–8 of the plan.
- Applying migration 0001 to the development database (`npm run db:migrate` or `npm run
  db:reset`) requires the user's approval. It has not been done.
- `db/migrations/.gitkeep` is now redundant, because the directory contains real migration
  files. It was left in place to keep the change focused; it can be removed later.
- `scripts/migrate.ts down` still prints `Migrated down` even when nothing was reverted (noted in
  Session 06, unchanged).

## 5. Decisions made

- **Placeholder `down` file until test 3:** the runner refuses an `up` file without a matching
  `down` file, so GREEN 1 had to create both. Writing the full `down` SQL at that point would have
  made the reversibility test pass with no RED phase. The placeholder contained only a
  `-- Data loss: none. Placeholder; …` header and was replaced in GREEN 3.
- **The three constraint cases are in one test:** the plan lists rejecting a duplicate key,
  allowing several `NULL` keys, and allowing the same key for two customers (AC5 at database
  level). The allowed cases are asserted first and the duplicate last. As separate tests, the
  allowed cases would have passed before the constraint existed and had no RED phase.
- **The duplicate check matches the constraint name** (`unique constraint
  "orders_customer_idempotency_key_unique"`), so the test also confirms the constraint is named,
  which `down` relies on.
- **Test 1 checks more than existence:** it also checks the column types (`character varying`
  with length 255, and `text`) and that both columns are nullable.
- **Cleanup note from Step 2 reviewed:** the runner tests still drop `schema_migrations` in their
  cleanup. Afterwards, `orders` still has the new columns but no record of 0001. This is harmless,
  because every other test runs `resetDb` first, which rebuilds the database from `schema.sql`.
  The full suite passing (27 of 27) is consistent with this. No change was made.
- **Verification with `.venv`:** every `npm test` run was made with `.venv` activated, following
  the `npm test` entry in `CLAUDE.md`.

## 6. Resource Usage

Claude Code session statistics:

- **Total cost:** $4.80
- **API duration:** 13m 8s
- **Wall-clock duration:** 1h 15m 55s
- **Code changes:** 803 lines added, 60 removed (session-wide statistics, not limited to Step 3).
- **Models used:**
  - Haiku 5.5: 1.2k input tokens, 22 output tokens, cost $0.0001.
  - Opus 5.5: 8.3k input tokens, 67.6k output tokens, cost $4.80.
- **Prompt cache:** 81 requests; 99% of input tokens served from cache, with no cache misses.

The `/usage` breakdown also showed that `/tdd` accounted for 30% of usage and `/plan` for 5%. These percentages cover sessions on this machine during the last 24 hours and are not specific to this session.
