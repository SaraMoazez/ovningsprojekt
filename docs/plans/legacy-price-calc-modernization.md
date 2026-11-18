# Plan: Modernize the Legacy Python Price Calculation Module

Date: 2026-11-18
Status: **Approved.**

## Task Overview

This plan modernizes `src/legacy/price_calc.py` as decided in ADR 0003. The module stays in Python
and is refactored in place, in small steps that are each verified before the next one starts. The
work is grouped into seven kinds of step:

| Kind | Steps | What it does |
|---|---|---|
| A. Test infrastructure | 1 | An isolated test-database setup for Python (ADR 0003 decision 9). |
| B. Characterization | 2–5 | Pin current behavior at the CLI, the nightly report and the HTTP endpoint (decision 2). |
| C. Security fix | 6 | Parameterized SQL (decision 3). Kept separate from refactoring. |
| D. Behavior-preserving refactoring | 7, 8, 11, 12 | Pure function, lazy connection, English names, fewer queries (decision 4). |
| E. Small hardening | 9, 10 | Remove the credential fallback, narrow the exception handling (decision 4). These change behavior only in failure cases. |
| F. Schema | 13 | Reversible migration 0002: an index on `order_lines(order_id)` (ADR 0001 process). |
| G. Deliberate behavior changes | 14, 15 | Two-decimal output (decision 6), bridge error handling (decision 8). |
| — | 16 | Documentation, full verification, session log. |

Unchanged throughout:

- truncation and calculation order (decision 5);
- discount semantics (decision 7): expired codes apply, unknown codes are ignored, status is
  ignored, and percentages outside 0–100 are allowed;
- the CLI and nightly output, except where a step in kinds E and G says otherwise.

Out of scope:

- a TypeScript port;
- changes to the discount rules;
- a `CHECK` constraint on `discounts.percent`;
- foreign keys (planned only as a prerequisite analysis, see Database Migration Plan);
- the credential fallback in `src/db.ts:5`;
- the general async error handling in tech-debt 0001.

## Research References

- `docs/research/legacy-price-calc-modernization.md`: the basis for this plan. It covers the same
  module and the same date. ADR 0003 answers most of its Open Questions. The rest are listed
  under Open Questions and Assumptions below.
- `docs/adr/0003-legacy-price-calc-modernization.md`: the modernization decisions this plan
  implements. "Decision N" below refers to this ADR.
- `docs/adr/0001-sql-migrations-with-in-house-runner.md`: the migration process that step 13
  follows. It requires:
  - numbered `up`/`down` SQL files;
  - a `-- Data loss: …` header in every file;
  - each migration running in its own transaction;
  - `migrateDown` reverting only the most recent migration;
  - user approval before `db:migrate:down` or `db:reset` is run against the dev database.
- Inspected while planning (verified, code):
  - `src/routes/orders.ts:35-47`, `src/pricing/legacyPrice.ts`, `jobs/nightly_report.py`;
  - `src/services/orderService.ts:65, 94`: `order_lines` is written and read by `order_id`;
  - `db/schema.sql`: no indexes except primary keys, and no foreign keys;
  - `src/migrate.ts`: `migrateUp`, `migrateDown` (which reverts only the latest migration) and
    `resetDatabase`;
  - `scripts/migrate.ts:5` and `scripts/db-reset.ts:5-8`: both default to the **dev** database,
    and `db-reset.ts` resets dev **and** test;
  - `tests/migrations.test.ts:171-189`: the 0001 reversibility test calls `migrateDown` once,
    assuming 0001 is the latest migration;
  - `src/db.ts:5`, `src/result.ts:2`, `src/http.ts:4-9`;
  - `.claude/hooks/protect-tests.mjs`;
  - `.claude/skills/tdd/SKILL.md`;
  - `pytest.ini`, `package.json`.

## Codemap

### Current state (verified, code)

```
            HTTP client (X-Customer-Id header)
                         │  GET /orders/:id/price
                         ▼
 ┌──────────────────────────────────────────────┐
 │ src/routes/orders.ts:35-47                   │
 │  requireCustomer (src/auth.ts) → parseId     │
 │  1) getOrder(id, customerId) ────────────────┼──► src/services/orderService.ts
 │     (404 / 403 decided here)                 │       │ pg Pool (src/db.ts, DATABASE_URL
 │  2) calcPrice(id) → sendResult (src/http.ts) │       │  or hard-coded dev fallback)
 └───────────────────┬──────────────────────────┘       ▼
                     │                          ┌─────────────────────────────┐
                     ▼                          │ PostgreSQL                  │
 ┌──────────────────────────────────────────┐   │  orders                     │
 │ src/pricing/legacyPrice.ts               │   │   id, customer_id, status,  │
 │  execFile("python3" from PATH,           │   │   discount_code, created_at │
 │    [price_calc.py, id], env=process.env) │   │  order_lines                │
 │  exit≠0 → err("not_found")  (all errors) │   │   order_id (no index, no FK)│
 │  stdout → JSON.parse (unguarded)         │   │   quantity, unit_price      │
 └───────────────────┬──────────────────────┘   │  discounts                  │
                     │ subprocess, argv = id    │   code (PK), percent,       │
                     ▼                          │   valid_from/to (unused)    │
 ┌──────────────────────────────────────────┐   └──────────────▲──────────────┘
 │ src/legacy/price_calc.py                 │                  │
 │  import time: psycopg.connect(           │  3 SELECTs built │
 │    DATABASE_URL or dev fallback)  = conn ├──────────────────┘
 │  calc_price(id) → Pris(net, vat, total)  │  with % formatting
 │  _kapa = truncate to 2 decimals          │  (line 42: injectable)
 │  CLI: prints {"net","vat","total"} JSON  │
 │  appends line → src/legacy/price_calc.log│
 └───────────────────▲──────────────────────┘
                     │ sys.path import: calc_price, conn
 ┌───────────────────┴──────────────────────┐
 │ jobs/nightly_report.py (cron, prod)      │  own SELECT via conn (line 8, % formatted):
 │  for each paid order of <date>:          ├──► orders WHERE status='paid'
 │    calc_price(oid) → sum totals          │       AND created_at::date = <date>
 │  prints "<date>: N betalda ordrar, …"    │
 └──────────────────────────────────────────┘
```

### Dependencies

| From | Depends on | How |
|---|---|---|
| `orders.ts` route | `orderService.getOrder`, `calcPrice` | Function calls. Ownership is checked **before** pricing. |
| `legacyPrice.ts` | `python3` on `PATH`, `price_calc.py`, `process.env` | A subprocess per request. The contract is the exit code plus stdout JSON. |
| `price_calc.py` | `psycopg` 3.2.3 (`requirements.txt`), `DATABASE_URL` | A connection at import time, with autocommit. |
| `nightly_report.py` | `price_calc.calc_price`, `price_calc.conn`, `Pris.total` | Python import through `sys.path`. |
| All of the above | Tables `orders`, `order_lines`, `discounts` | Read only. Only `orderService` writes. |
| Jest tests | `tests/helpers/db.ts` → `resetDatabase` | `schema.sql`, then migrations, then `seed.sql`, on `butik_test`. |

### Data flow for one price request

1. The route authenticates the customer, parses the id, and calls `getOrder`. That call reads
   `orders` and `order_lines` through `pg`, with parameters, and returns 404/403 when it should.
2. The bridge starts `python3 price_calc.py <id>`.
3. The module reads `orders.discount_code`, then all `order_lines(quantity, unit_price)` for the
   order, then `discounts.percent` for the code.
4. It sums `quantity × unit_price` as `Decimal`, applies the discount to the raw sum, truncates
   the net, calculates VAT (25 %) on the truncated net, truncates the VAT, and adds them to get
   the total.
5. It appends a log line and prints JSON. The bridge parses it and the route returns 200.

The nightly flow is the same as steps 3–4, run once per paid order, and the totals are summed.

### Target state after this plan

- **Bridge:** gets a timeout and safe parsing (`parsePriceOutput`), and tells `not_found` apart
  from an internal error.
- **`price_calc.py`:**
  - `compute_price` is a pure function;
  - `get_connection()` connects lazily and has no fallback;
  - all SQL is parameterized;
  - two queries per order, plus `calc_prices(ids)` for batches;
  - English names;
  - two-decimal CLI output.
- **Nightly job:** uses `get_connection()` and `calc_prices`.
- **Database:** an index on `order_lines(order_id)`.

## Files to Change

| File | New / changed | Step | Why |
|---|---|---|---|
| `scripts/reset-test-db.ts` | New | 1 | Resets **only** the test database through `resetDatabase`, with a `_test` guard. |
| `tests/legacy_db.py` | New | 1 | Python helpers for the test-database URL, the guard, the reset, fixture inserts and running the CLI. |
| `tests/conftest.py` | New | 1 | An autouse fixture: guard, then reset, before each test. |
| `tests/test_legacy_db.py` | New | 1 | Tests for the guard and the reset. |
| `tests/test_price_calc.py` | New | 2, 3, 6, 9, 12, 14 | CLI characterization, the injection test, the fallback test, the batch test, and the output format. |
| `tests/test_price_calc_unit.py` | New | 7, 8, 10, 11 | Database-free tests of the pure function, the import, and the logging. |
| `tests/test_nightly_report.py` | New | 4, 6 | Nightly characterization and the injection test. |
| `tests/orders.test.ts` | Changed (new tests, the existing test stays unchanged) | 5, 14 | Endpoint characterization. In step 14, the new tests' expected strings are updated. |
| `tests/migrations.test.ts` | Changed | 13 | New tests for 0002. The existing 0001 reversibility test gets a justified change (see step 13). |
| `tests/legacyPrice.test.ts` | New | 15 | Bridge tests. |
| `db/migrations/0002_add_order_lines_order_id_index.up.sql` / `.down.sql` | New | 13 | A reversible index migration. |
| `src/legacy/price_calc.py` | Changed | 6–12, 14 | The module itself. |
| `jobs/nightly_report.py` | Changed | 6, 8, 11, 12 | Parameterized SQL, the connection, English names, and the batch call. |
| `src/pricing/legacyPrice.ts` | Changed | 15 | Error handling. |
| `src/result.ts`, `src/http.ts` | Changed (only if confirmed) | 15 | Adds `internal_error` → 500. |
| `README.md`, `docs/api.md` | Changed | 9, 14, 15, 16 | `DATABASE_URL` requirement, output format, error responses. |
| `sessions/NN-…md` | New | 16 | Session log. |

## Test Database Safety

Two local databases exist: `butik` (dev) and `butik_test` (test). Several tools default to the dev
database (verified, code):

- `scripts/db-reset.ts:5-8` resets **both** `butik` and `butik_test`;
- `scripts/migrate.ts:5` and `src/db.ts:5` default to `butik`;
- `price_calc.py:9` defaults to `butik` today.

`resetDatabase` runs `schema.sql`, which starts with `DROP TABLE`. A reset against the wrong
database therefore destroys data.

Rules for this plan:

1. **`scripts/db-reset.ts` is never used.** Not by tests, and not during implementation.
2. **There is one reset path for Python tests.** It is `scripts/reset-test-db.ts`, which:
   - reads `TEST_DATABASE_URL`, defaulting to the same URL as `tests/helpers/env.ts`;
   - parses the database name, and exits non-zero **before connecting** unless the name ends in
     `_test`;
   - calls `resetDatabase`.

   It never reads `DATABASE_URL`, so a dev value in the environment cannot redirect it.
3. **Python checks the database twice.** `tests/conftest.py` calls `require_test_database(url)`
   before the reset and before any fixture insert. Every subprocess (`price_calc.py`,
   `nightly_report.py`) gets an explicit `env` where `DATABASE_URL` is the test URL. Tests never
   inherit `DATABASE_URL` from the parent environment.
4. **Jest keeps its existing isolation.** `tests/helpers/env.ts` sets `DATABASE_URL` to the test
   database before any import. Migration tests call `migrateUp`/`migrateDown` through the test
   client, and never through the `db:migrate` CLI.
5. **pytest and Jest never run at the same time**, because both reset `butik_test`. CLAUDE.md
   already requires running commands one at a time.
6. **The dev database is touched only with explicit approval.** This applies to applying
   migration 0002 to `butik` (`npm run db:migrate`) and to any `db:migrate:down`. Ask first,
   following ADR 0001 and CLAUDE.md (Security).
7. **Known limitation:** the guard checks the database name, not the host. A database named
   `*_test` on another host would pass. This is acceptable because only local Docker databases
   are used (Assumption A6).

## Characterization Tests versus TDD Tests

The plan uses two different kinds of test, and they are written differently.

### Characterization tests (steps 2–5)

- **Purpose:** record what the code does today, including behavior that looks wrong, so that later
  steps cannot change it by accident.
- **Procedure:**
  1. Reset the test database.
  2. Run the real command and capture its output.
  3. Write the test with that output as the expected value.
  4. Cross-check the values against the research behavior table. If they differ, stop and report.
  5. Run the test and confirm that it **passes** against the unchanged code.
  6. Record the raw captured output in the session log.
- **There is no RED phase.** No failing test is invented, for example a placeholder value. A
  characterization test that fails against the current code is a wrong test, not a bug, and must
  be corrected against the captured output.
- **No production code changes** in these steps. They are run with `/tdd` as test-only steps. The
  `/tdd` rule "stop if the test passes already" does not apply to them, because this plan
  defines passing as the expected outcome (user decision, 2026-11-18).

### TDD tests (steps 1, 6, 9, 10, 14, 15 and the new interfaces in 7, 8, 12, 13)

RED → GREEN → REFACTOR, as in CLAUDE.md (Testing Requirements):

- **RED:** write one test for a behavior or interface that does not exist yet. Run it, and
  confirm that it fails for the expected reason (assertion failure, missing function, missing
  index). It must not fail for an unrelated reason.
- **GREEN:** make the smallest production change that makes it pass.
- **REFACTOR:** clean up within the step. Then all tests must be green.

### How RED-GREEN-REFACTOR applies to the refactoring steps (7, 8, 11, 12)

1. **Green baseline.** Before the step, the full pytest and Jest suites, including every
   characterization test, must be green. If not, stop.
2. **Seam test (RED).** If the step adds a new interface (`compute_price`, `get_connection`,
   `calc_prices`), first write a test for that interface. It fails because the interface does
   not exist yet. The test is about the new structure. It must not expect different output.
3. **GREEN.** Make the minimal change so the seam test passes.
4. **REFACTOR.** Move the existing code onto the new seam.
5. **Characterization gate.** All characterization tests pass **unchanged**. This proves the
   behavior is preserved. A refactoring step never edits a characterization test.

Step 11 (English names) adds no interface, so it has no RED. Its evidence is a green baseline
before and an unchanged green suite after.

The next step starts only when all checks of the current step are green and the user has
reviewed it.

## Implementation Steps

Each step is one `/tdd` run.

### Step 1: Isolated Python test-database setup (A, TDD)

- **Objective:** pytest can reset and use `butik_test`, and cannot reach any other database (see
  Test Database Safety).
- **Changes:**
  - `scripts/reset-test-db.ts`;
  - `tests/legacy_db.py`, with these helpers:
    - `test_database_url()`;
    - `require_test_database(url)`;
    - `reset_test_database()`, which runs `npx tsx scripts/reset-test-db.ts`;
    - `insert_fixture(sql, params)`, which uses parameterized psycopg after the guard;
    - `run_script(path, *args)`, which runs `sys.executable <path> args` with an explicit test
      `env` and returns stdout, stderr and the exit code;
  - `tests/conftest.py`, with an autouse fixture.
- **Tests (RED first):** in `tests/test_legacy_db.py`:
  - the guard rejects `…/butik` and accepts `…/butik_test`;
  - `reset-test-db.ts` exits non-zero for a non-`_test` URL;
  - a deleted seed row is back after a reset.

### Step 2: Characterize the CLI for seed orders (B)

- **Tests:** in `tests/test_price_calc.py`:
  - the exact stdout JSON and exit code 0 for orders 1040–1047;
  - `999999` → exactly `{"error": "finns inte"}` and exit code 1;
  - `abc` → a non-zero exit code. Only the exit code is pinned, not the traceback text.

### Step 3: Characterize the CLI edge cases (B)

- **Tests:** these insert their own fixtures, always the order row before its lines:
  - an unknown code;
  - `percent` 0, 100 and 150;
  - an extra expired code;
  - a case where truncation and rounding give different results;
  - large amounts close to `NUMERIC(10,2)` over several lines;
  - a zero quantity;
  - a cancelled order;
  - one new log line `<ISO timestamp> <id> <total>` in `src/legacy/price_calc.log`. The test
    asserts on the id and the total.

  Questionable cases get the comment "pins current behavior, see ADR 0003 decision 7".

  A code containing a quote is **not** characterized here, because that input belongs to step 6.

### Step 4: Characterize the nightly report (B)

- **Tests:** in `tests/test_nightly_report.py`, the exact stdout for:
  - `2026-10-01` (order 1042);
  - `2026-10-05` (order 1044, with a discount);
  - a date with several paid orders (fixtures);
  - a date with no paid orders.

### Step 5: Characterize the price endpoint (B)

- **Tests:** new `it` blocks in `tests/orders.test.ts`:
  - exact `toEqual` bodies for 1042 (customer 1), 1041 (customer 2) and 1044 (customer 4);
  - 401 without a header;
  - 403 for another customer's order;
  - 404 for a missing order;
  - 400 for `abc`.

  The existing test stays unchanged.

### Step 6: Parameterize all SQL: the security fix (C, TDD)

Kept separate from refactoring: this is the only change in this step.

- **Changes:** `price_calc.py:30, 36, 42` and `nightly_report.py:8` use
  `cur.execute(sql, (value,))`.
- **RED 1:** an order with `discount_code = "VAR10' OR '1'='1"` gets **no** discount. Today the
  condition matches every discount row, so a discount is applied.
- **RED 2:** `nightly_report.py "2026-10-01' OR '1'='1"` must not count orders from other dates.
  The expected result is a non-zero exit code and no summary line (Assumption A3).
- **Gate:** the step 2–5 tests pass unchanged.

### Step 7: Refactoring R1: extract a pure calculation function (D)

- **Seam test (RED):** `compute_price(lines, discount_percent)` in `tests/test_price_calc_unit.py`
  covers:
  - the research table values;
  - truncation versus rounding;
  - an empty list;
  - a percent of `None`, 0, 100 and 150.

  Until step 8, the test file sets `DATABASE_URL` to the test URL before it imports the module.
- **GREEN/REFACTOR:** `calc_price` fetches the data and delegates to `compute_price`.
- **Gate:** the characterization tests pass unchanged.

### Step 8: Refactoring R2: lazy connection (D)

- **Seam test (RED):** the module imports successfully with `DATABASE_URL` pointing at an
  unreachable port. Today the import raises. `get_connection()` returns a reused connection.
- **GREEN/REFACTOR:**
  - Connect on first use through `get_connection()`. The fallback URL stays for now (it is
    removed in step 9).
  - In the same step, update `nightly_report.py` to use `get_connection()` instead of `conn`.
  - Remove the step 7 workaround.
- **Gate:** the characterization tests pass unchanged, including the nightly tests, which cover
  the job's interface change.

### Step 9: Hardening H1: remove the credential fallback (E, TDD)

- **RED:** running the CLI without `DATABASE_URL` exits non-zero, with a stderr message that names
  the variable. Today it connects to `butik` without saying so.
- **GREEN:** `get_connection()` raises a clear error when the variable is missing. Add the
  requirement to the README.
- **Gate:** the characterization tests pass unchanged, because they always set `DATABASE_URL`.

### Step 10: Hardening H2: narrow the logging exception (E, TDD)

- **RED:** an error that is not an `OSError` while writing the log (monkeypatched `open` raising
  `ValueError`) must propagate. Today it is swallowed. Also test that an `OSError` (the log path
  is a directory) still returns a price. That case already passes, so it is a regression test,
  not RED.
- **GREEN:** `with open(...)` and `except OSError:`.
- **Gate:** the step 3 log test and all characterization tests pass unchanged.

### Step 11: Refactoring R3: English names and comments (D, no RED)

- **Changes:**
  - `Pris`→`Price`, `_kapa`→`_truncate_to_cents`, `MOMS`→`VAT_PERCENT`, `LOGG`→`LOG_PATH`;
  - English local variables and comments in both files. The meaning of the warning on line 3
    (do not touch the rounding) is kept.
  - **Kept as they are**, because they are characterized output or interface: the
    `{"error": "finns inte"}` text, the nightly summary text, `calc_price`, and `.net`/`.vat`/
    `.total`.
- **Evidence:** a green baseline before the step, and the unchanged full suites green after it.
  The only test change is the renamed import in `test_price_calc_unit.py`, if it imports a
  renamed symbol.

### Step 12: Refactoring R4: fewer queries (D)

- **Seam test (RED):** `calc_prices([1042, 1044, 1045])` returns the same values as calling
  `calc_price` for each order. A missing id keeps today's behavior.
- **GREEN/REFACTOR:**
  - `calc_price` uses one `orders LEFT JOIN discounts` query plus one `order_lines` query. That
    is two queries instead of three.
  - `calc_prices` uses `= ANY(%s)`.
  - The nightly job uses `calc_prices`.
- **Gate:** the characterization tests pass unchanged, including the nightly output.

### Step 13: Migration 0002: index on `order_lines(order_id)` (F, TDD)

See the Database Migration Plan for the reason, rollback and prerequisites.

- **RED:** new tests in `tests/migrations.test.ts`, under `describe("migration 0002 …")`:
  - after `resetDb`, `pg_indexes` contains `order_lines_order_id_idx` on `(order_id)`;
  - reversibility: `migrateDown` removes the index and the `0002` record, the 0001 columns stay,
    and `migrateUp` adds the index again.
- **GREEN:** add the `up`/`down` files.
- **Required change to an existing test (needs approval, Open Questions item 3):** the 0001
  reversibility test (`tests/migrations.test.ts:171-189`) calls `migrateDown` once and expects
  0001 to be reverted. With 0002 applied, that call reverts 0002 instead, so the test would fail.
  This is not because 0001 broke, but because `migrateDown` reverts only the latest migration
  (ADR 0001, decision 2).
  - **Proposed change:** revert until version `0001` is no longer in `schema_migrations`, then
    run `migrateUp`.
  - The assertions about 0001 stay exactly the same, so the test is not weakened and the number
    of test cases does not change.
  - The reason is recorded in the step results and in the session log.
- **Gate:** all Jest, pytest and characterization tests pass unchanged.

### Step 14: Behavior change B1: two-decimal output (G, TDD)

- **RED:** update the expected strings in the characterization tests from steps 2, 3 and 5, for
  example `"950"` → `"950.00"` and `"588.8"` → `"588.80"`. They fail against the current code.
  This is an intended, justified behavior change (decision 6). The reason is recorded in the step
  results and in the session log.
- **GREEN:** the CLI JSON formats `net`, `vat` and `total` with
  `quantize(Decimal("0.01"))`, with no floats, and only at the CLI output. The nightly text is
  unchanged (Open Questions, item 2). Update `docs/api.md`.
- The original Jest test (`Number(total) === 1187.5`) passes unchanged.

### Step 15: Behavior change B2: bridge error handling (G, TDD, blocked until Open Questions item 1)

- **RED 1:** `parsePriceOutput(stdout)` returns:
  - `not_found` for `{"error": …}`;
  - an internal error for invalid JSON or missing fields;
  - `ok` for valid output.
- **RED 2:** with `DATABASE_URL` temporarily pointing at an unreachable database, `calcPrice`
  returns the internal error, not `not_found`.
- **RED 3:** `calcPrice(1042, { timeoutMs: 1 })` returns the internal error.
- **GREEN:**
  - add a timeout to `execFile`;
  - parse stdout regardless of the exit code;
  - add `internal_error` → 500 in `src/result.ts` and `src/http.ts`, if confirmed;
  - update `docs/api.md`.
- **Gate:** the step 5 tests pass unchanged.

### Step 16: Documentation, full verification and session log

- Update `docs/api.md`.
- Add short notes, after asking the user first, that the injection is fixed where the research
  and tech-debt 0001 mention it.
- Write a session log in `sessions/`, with the captured characterization output, every changed
  existing test and its reason, and the real check results.

## Database Migration Plan

This follows ADR 0001: numbered `up`/`down` SQL files in `db/migrations/`, each starting with
`-- Data loss: …`, applied by `migrateUp` in one transaction per migration.

ADR 0003 does not cover schema changes. An index is not an architectural decision, so no new ADR
is proposed for it (Open Questions, item 4). A foreign key would need one (see 3 below).

### 1. Migration 0002: index on `order_lines(order_id)` (step 13)

**Why it is needed** (verified, code, unless stated otherwise):

- Every price calculation filters `order_lines` by `order_id` (`price_calc.py:36`, and in step 12
  the `= ANY` batch query). So does every `GET /orders/:id` and every price request through
  `getOrder` (`orderService.ts:94`).
- `db/schema.sql` creates no index on `order_lines.order_id`, and there is no foreign key either.
  PostgreSQL never creates indexes on referencing columns by itself. Without an index, each of
  these queries reads the whole `order_lines` table.
- The nightly job reads lines for every paid order of a day, so its cost grows with the total
  table size.
- It is also a prerequisite for a possible future foreign key. Deletes and updates on `orders`
  would otherwise need to scan all of `order_lines`.
- **Honest limitation:** with the 10 seed rows there is no measurable gain, and the planner may
  still choose a sequential scan. No performance improvement has been measured, and none is
  claimed. The step's tests check that the index exists and that the migration can be reverted.
  They do not check query plans.

**Files:**

```sql
-- 0002_add_order_lines_order_id_index.up.sql
-- Data loss: none. Adds a non-unique index; no rows are changed.
CREATE INDEX order_lines_order_id_idx ON order_lines (order_id);

-- 0002_add_order_lines_order_id_index.down.sql
-- Data loss: none. Drops the index only; no rows are changed.
DROP INDEX order_lines_order_id_idx;
```

**Effect on behavior:** none. Query results and `ORDER BY id` are unchanged. `Decimal` sums
don't depend on row order. The characterization tests are the evidence.

**Locking:** the runner wraps each migration in a transaction (`src/migrate.ts`,
`withTransaction`). `CREATE INDEX CONCURRENTLY` cannot run inside a transaction, so a plain
`CREATE INDEX` is used. It blocks writes to `order_lines` while it builds. At the current size
that takes moments. For a large production table, building the index concurrently outside the
runner would need its own decision.

**Prerequisites:**

1. Steps 1–12 are green.
2. Applying it to the test database happens automatically, because `resetDatabase` runs all
   migrations.
3. Applying it to the dev database (`npm run db:migrate`) needs the user's approval first.
4. Applying it to production is manual and outside this repository. The process is unknown (ADR
   0003 consequences).
5. Check that `schema_migrations` does not already contain `0002`.

**Rollback:**

1. Get approval (ADR 0001, CLAUDE.md Security).
2. Confirm the target database explicitly. `scripts/migrate.ts` defaults to the dev `butik`, so
   set `DATABASE_URL` deliberately.
3. Confirm that `0002` is the most recently applied migration (`SELECT version FROM
   schema_migrations ORDER BY version`). `migrateDown` reverts only the latest one.
4. Run `npm run db:migrate:down`.
5. Verify that the index is gone (`pg_indexes`) and that `0002` is removed from
   `schema_migrations`.

The rollback loses no data. The application code does not depend on the index, so code and
migration can be rolled back independently, in either order.

### 2. Not introduced: `CHECK (percent BETWEEN 0 AND 100)` on `discounts`

ADR 0003 decision 7 keeps today's discount behavior, including percentages outside 0–100. Step 3
pins a discount with `percent` 150 as current behavior. A `CHECK` constraint would:

- contradict that decision;
- make that characterization fixture impossible to insert;
- fail on any existing row outside the range.

It is excluded from this plan. It can be reconsidered only together with a decision to change
the discount semantics.

### 3. Not introduced: foreign key `order_lines.order_id → orders.id`

It is not added in this plan. Before it can be proposed, the following must be done and
documented in its own research, ADR and plan:

1. **Check the existing data.** Run a read-only check in every environment for lines whose order
   does not exist:

   ```sql
   SELECT ol.order_id, COUNT(*) FROM order_lines ol
     LEFT JOIN orders o ON o.id = ol.order_id
    WHERE o.id IS NULL GROUP BY ol.order_id;
   ```

   - In the seed data, every line belongs to an existing order (verified, `db/seed.sql:31-41`
     against `20-28`).
   - Running the check against production needs approval, and its result must not be copied
     into the repository if it contains real data.
   - Orphaned rows need a decision: delete them, archive them, or create the constraint with
     `NOT VALID` first.
2. **Document the behavior change:**
   - Inserting a line for a nonexistent order fails with error `23503`. `createOrder` already
     inserts the order first, in one transaction (`orderService.ts:59-65`). Test fixtures must
     do the same, which step 3 already requires.
   - Deleting an order that has lines fails with `RESTRICT`/`NO ACTION`, or deletes the lines
     with `CASCADE`. That choice needs a decision.
   - `price_calc.py` behavior is unaffected. A missing order already returns `None` / "finns
     inte".
3. **Rollback consideration:** the `down` migration drops the constraint and loses no data. Rows
   deleted or archived as part of cleaning up orphans cannot be restored by `down`.

## Testing Strategy

### Existing tests (regression tests in every step)

- `tests/orders.test.ts`, including the price test at lines 193–199;
- `tests/migrations.test.ts`;
- `tests/customers.test.ts`;
- the hook tests.

There are no existing Python tests.

### New and changed tests per step

| Step | Kind | Test file | Verifies |
|---|---|---|---|
| 1 | TDD | `test_legacy_db.py` | The guard, that the reset script refuses non-test databases, and that the reset restores seed data. |
| 2 | Characterization | `test_price_calc.py` | Exact JSON and exit codes for 1040–1047, a missing id and a non-integer argument. |
| 3 | Characterization | `test_price_calc.py` | The edge cases and the log line. |
| 4 | Characterization | `test_nightly_report.py` | Exact summary lines. |
| 5 | Characterization | `orders.test.ts` | Exact bodies, 400, 401, 403 and 404. |
| 6 | TDD | `test_price_calc.py`, `test_nightly_report.py` | Injected input is a literal value or is rejected. |
| 7 | Seam + gate | `test_price_calc_unit.py` | The pure calculation without a database. |
| 8 | Seam + gate | `test_price_calc_unit.py` | Import has no side effects, and the connection is reused. |
| 9 | TDD | `test_price_calc.py` | A missing `DATABASE_URL` gives a clear failure. |
| 10 | TDD | `test_price_calc_unit.py` | Non-`OSError` errors propagate, and `OSError` is swallowed. |
| 11 | Gate only | (all) | The suites pass unchanged. |
| 12 | Seam + gate | `test_price_calc.py` | `calc_prices` equals `calc_price`. |
| 13 | TDD + justified change | `migrations.test.ts` | The index exists, 0002 is reversible, and the 0001 test still proves that 0001 is reversible. |
| 14 | TDD (justified change) | the tests from steps 2, 3 and 5 | Two-decimal strings, with the same values. |
| 15 | TDD | `legacyPrice.test.ts` | Parsing, the internal error and the timeout. |

### Principles

- Characterization values come from running the current code, cross-checked against the
  research table.
- Python runs with `.venv` activated. Subprocesses use `sys.executable`.
- No test is deleted, skipped or weakened. Existing tests are changed in exactly two places, each
  with a stated reason:
  - step 13 (the 0001 reversibility test, because of `migrateDown` semantics);
  - step 14 (the expected strings in tests this plan creates).

  `protect-tests.mjs` watches `tests/*.test.ts`. Neither change reduces the number of test cases.

### Every step

Run these one at a time with `.venv` active and the database up, and review each output before
the next: `npm run lint`, then `npm run typecheck`, then `npm run format:check`, then `npm test`,
then `npm run test:legacy`.

## Risks and Considerations

- **Destroying the dev database.** This is prevented by the rules in Test Database Safety: a
  separate reset script, a guard in two places, an explicit subprocess `env`, and never
  `db-reset.ts`.
- **The nightly job's interface** changes in steps 8 and 12. The job is updated in the same
  steps and pinned by the step 4 tests. Rolling it out to production is manual and unknown.
- **The log file** grows with each test run (`src/legacy/price_calc.log`, gitignored). This is
  accepted as existing behavior.
- **The credential fallback stays in `src/db.ts:5`.** After step 9, an API started without
  `DATABASE_URL` works except for the price endpoint. That is 404 until step 15 and 500 after it.
  `.env.example` sets the variable, and the README note covers it.
- **The API change in step 14:** `"950"` becomes `"950.00"`, with the same values. It is
  documented.
- **Step 15 changes the shared error types.** The change is additive, and the step is blocked
  until it is decided.
- **Decimal correctness:** `Decimal` is used everywhere. The `quantize` in step 14 only formats
  values that are already truncated, so it never rounds them.
- **Migration 0002 locking:** writes to `order_lines` are blocked briefly while the index builds.
- **The change to the existing 0001 test** in step 13 needs approval. Without it, step 13 cannot
  be completed.
- **The nightly timezone:** `created_at::date` uses the session's timezone. Test dates are chosen
  so that UTC and +02 give the same date.
- **The injection tests** use harmless literal payloads, and only on `butik_test`. No stacked
  statements are run.

## Open Questions and Assumptions

### Decided (2026-11-18, user)

- Characterization tests capture current behavior and pass on their first run. No RED phase is
  introduced for them.
- The SQL injection fix is a separate step from the refactoring.
- No `CHECK` constraint on `discounts.percent`, and no foreign key in this plan.
- `scripts/db-reset.ts` is never used, because it affects the dev database.
- **Step 15:** add `internal_error` → 500 with a generic message (as in tech-debt 0001 AC1), and
  a 10-second timeout.
- **Step 14:** only the CLI/API output changes to two decimals. The nightly text stays as it is.
- **Step 13:** the existing 0001 reversibility test is changed to revert until 0001 is gone,
  instead of calling `migrateDown` once. Its assertions stay the same.
- **Step 13:** the index migration is part of this plan, with no separate ADR.
- **The `src/db.ts:5` credential fallback is out of scope** and is recorded as tech debt.

### Open questions

None remaining.

### Assumptions (unverified, checked in the step that relies on them)

- **A1.** psycopg 3 returns `NUMERIC(10,2)` as `Decimal` with the scale kept, and `INTEGER` as
  `int` (step 2).
- **A2.** `.venv` has the packages from `requirements.txt`, and `npx tsx` works from pytest
  (step 1).
- **A3.** With parameters, a valid date string still matches in the nightly query, and an
  invalid one raises an error (step 6).
- **A4.** The Docker PostgreSQL session timezone is UTC (step 4).
- **A5.** pytest's default `prepend` import mode lets tests import `tests/legacy_db.py` without an
  `__init__.py` (step 1).
- **A6.** All test databases are local. The `_test` name guard is enough protection (step 1).
