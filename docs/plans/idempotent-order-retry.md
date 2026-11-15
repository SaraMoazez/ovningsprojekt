# Plan: Idempotent Order Retry (No Duplicate Orders)

Date: 2026-11-15
Status: **Draft – awaiting approval.** Nothing in this plan has been implemented.

## Task Overview

User story 1 (`docs/user-stories.md:5`): *Customers can retry an order when the network fails
without creating duplicate orders.*

`POST /orders` will require an `Idempotency-Key` header. The first request with a given key
creates the order. A retry from the same customer with the same key and the same body returns
`201` with the same order (its current state via `getOrder`) and creates nothing new. The same key
with a different body returns `409 conflict`. A missing or invalid key returns `400 invalid_input`.
Keys are scoped per customer and stored indefinitely on the order.

The database change is done as a reversible migration (`docs/user-stories.md:14`), using a small
in-house migration runner with numbered `up`/`down` SQL files (user decision, see research).

Acceptance criteria: AC1–AC8 in `docs/research/idempotent-order-retry.md`, *Expected behaviour*.
All eight are confirmed by the user. This plan refers to them by number.

Out of scope: the SQL string formatting in `src/legacy/price_calc.py` and
`jobs/nightly_report.py` (noted in research as a separate security issue), key expiry, response
snapshots, CORS.

## Research References

- `docs/research/idempotent-order-retry.md` – the basis for this plan. It matches the task
  (same user story, same date). All four user decisions and the follow-up decisions in that
  document are treated as fixed requirements.
- Verified again during planning by reading the code:
  - `src/services/orderService.ts:32-62` – `createOrder` (transaction, `validateLines`, `getOrder`
    after commit). `createOrder` has exactly one caller: `src/routes/orders.ts:16`.
  - `src/routes/orders.ts:15-18` – `POST /orders`.
  - `src/result.ts:2` and `src/http.ts:4-9` – `conflict` → 409 and `invalid_input` → 400 already
    exist. No change needed.
  - `tests/helpers/db.ts:10-14` and `scripts/db-reset.ts:7-24` – both rebuild the DB from
    `schema.sql` + `seed.sql`, with duplicated logic.
  - `db/seed.sql:20-29` – inserts orders with an explicit column list, so new nullable columns do
    not break it.
  - `package.json:12-15` – `lint` and `format:check` cover only `src` and `tests`, not `scripts`.
    `typecheck` (`tsconfig.json:12`) covers `scripts` too.
  - `jest.config.js:5` – tests are `tests/**/*.test.ts`, run with `--runInBand`.
  - `docs/standard.md` – parameterised SQL (§Databas), transactions for related writes, `Result`
    from services, `req.customerId` only (§Behörighet), tests for 400/401/403/404 (§Tester).

## Files to Change

| File | New / changed | Why |
|---|---|---|
| `docs/adr/0001-sql-migrations-with-in-house-runner.md` | New | Records the migration approach (architectural decision, CLAUDE.md §8). |
| `docs/adr/0002-idempotency-key-on-orders.md` | New | Records storing key + request fingerprint on `orders`, scoping per customer, and the `ON CONFLICT` approach. |
| `src/migrate.ts` | New | Migration runner library: discover, apply and revert numbered migrations, track them in `schema_migrations`, and a shared `resetDatabase` used by tests and the reset script. Placed in `src/` so it is linted, formatted and testable. |
| `scripts/migrate.ts` | New | Thin CLI around `src/migrate.ts` (`up` / `down`). |
| `db/migrations/0001_add_order_idempotency.up.sql` | New | Adds `idempotency_key VARCHAR(255) NULL`, `request_hash TEXT NULL` and `UNIQUE (customer_id, idempotency_key)` to `orders`. |
| `db/migrations/0001_add_order_idempotency.down.sql` | New | Drops the constraint and both columns. |
| `tests/fixtures/migrations/9001_*.up.sql` / `.down.sql` (and `9002_*`) | New | Throw-away migrations so the runner can be tested independently of migration 0001. |
| `tests/migrations.test.ts` | New | Tests for the runner and for migration 0001. |
| `tests/helpers/locks.ts` | New | Test-only helper that waits until given PostgreSQL backends are blocked on a lock (via `pg_stat_activity` / `pg_blocking_pids`). Used by the deterministic concurrency tests. |
| `tests/helpers/db.ts` | Changed | `resetDb` must also apply migrations, otherwise the test DB lacks the new columns. Reuses `resetDatabase`. |
| `scripts/db-reset.ts` | Changed | Same reset flow for dev and test DBs. Reuses `resetDatabase` instead of duplicating it. |
| `package.json` | Changed | Add `db:migrate` and `db:migrate:down` scripts. |
| `src/routes/orders.ts` | Changed | Read the `Idempotency-Key` header and pass it to `createOrder`. |
| `src/services/orderService.ts` | Changed | Validate the key, compute a fingerprint, insert with `ON CONFLICT DO NOTHING`, replay or return `conflict`. |
| `tests/orders.test.ts` | Changed | New tests for AC2–AC7; add a valid key to the three existing `POST /orders` tests that send a body (justification below). |
| `docs/api.md` | Changed | Document the header, key rules, 409 and replay semantics; it is a breaking API change. |
| `README.md` | Changed | Migration commands, new reset flow, updated test count (`README.md` says "16 gröna tester"). |
| `sessions/03-idempotent-order-retry.md` | New | Session log (CLAUDE.md §8). |

`db/schema.sql` and `db/seed.sql` are **not** changed. `schema.sql` stays the baseline; all new
schema goes through migrations.

## Implementation Steps

Each step is sized for one `/tdd` run. Steps 1–3 build the migration foundation; steps 4–7 build
the feature on top of it.

### Step 0 – ADRs (documentation only, no TDD)

- **Objective:** Record the two architectural decisions before code is written.
- **Changes:** ADR 0001 (plain numbered `up`/`down` SQL files + in-house runner; alternatives:
  `node-pg-migrate`, editing `schema.sql` only). ADR 0002 (columns on `orders` vs. a separate
  `idempotency_keys` table; fingerprint vs. comparing `order_lines`; DB unique constraint +
  `ON CONFLICT` vs. SELECT-then-INSERT). Each ADR: context, decision, alternatives, consequences.
- **Verify:** Review by the user.

### Step 1 – Migration runner library

- **Objective:** Apply and revert numbered migrations and record which are applied.
- **Changes:** `src/migrate.ts` exporting, for a given `pg` client and directory:
  - `migrateUp(client, dir)` – creates `schema_migrations (version TEXT PRIMARY KEY, applied_at
    TIMESTAMPTZ NOT NULL DEFAULT now())` if missing, reads `NNNN_name.up.sql` files in numeric
    order, and applies each one that is not recorded. Each migration and its record insert run in
    one transaction; on error it rolls back and rethrows.
  - `migrateDown(client, dir)` – reverts the most recently applied migration with its `.down.sql`
    and deletes its record, in one transaction.
  - Fails clearly if an `up` file has no matching `down` file.
  - The version value is inserted with a parameterised query.
  - Fixture migrations `tests/fixtures/migrations/9001_…`, `9002_…` creating/dropping tiny test
    tables.
- **Verify:** `tests/migrations.test.ts` (runner section) passes; lint/typecheck/format pass.

### Step 2 – Shared reset with migrations, CLI and npm scripts

- **Objective:** Both the test DB and the dev DB get `schema.sql` → all migrations → `seed.sql`.
- **Changes:**
  - `resetDatabase(client)` in `src/migrate.ts`: run `schema.sql`, `DROP TABLE IF EXISTS
    schema_migrations`, `migrateUp(client, db/migrations)`, then `seed.sql`. Migrations run before
    the seed so that seed data is inserted into the final schema.
  - `tests/helpers/db.ts`: `resetDb` calls `resetDatabase` (on a pooled client, released after).
  - `scripts/db-reset.ts`: calls `resetDatabase` for each URL, keeping its current env-variable
    handling and output.
  - `scripts/migrate.ts`: `up` / `down` CLI, connection string from `DATABASE_URL` like
    `scripts/db-reset.ts:11-14`.
  - `package.json`: `"db:migrate"` and `"db:migrate:down"` via `tsx --env-file-if-exists=.env`.
- **Verify:** With `db/migrations/` still empty, the full existing suite (`npm test`) is still
  green, and a new test confirms that after `resetDb` the `schema_migrations` table exists.

### Step 3 – Migration 0001 (reversible)

- **Objective:** Add the idempotency columns and per-customer unique constraint, and prove the
  migration can be reverted.
- **Changes:** `db/migrations/0001_add_order_idempotency.up.sql` and `.down.sql` as listed above.
  Named constraint (e.g. `orders_customer_idempotency_key_unique`) so `down` can drop it by name.
- **Verify:** `tests/migrations.test.ts` (migration 0001 section) passes; full suite still green
  (the columns are nullable, so existing code and seed data are unaffected).

### Step 4 – Require and validate `Idempotency-Key`; store it

- **Objective:** AC1, AC4, AC7, AC8.
- **Changes:**
  - Route: `createOrder(customerId, req.header("Idempotency-Key"), req.body ?? {})`. The key is
    never read from the body.
  - Service: new parameter `idempotencyKey: string | undefined`. A small `validateIdempotencyKey`
    returns `err("invalid_input", …)` if it is missing, `trim() === ""`, or `length > 255`.
    Order of checks: key → lines (auth already ran in `requireCustomer`). The raw key (not trimmed)
    is stored in the existing `INSERT INTO orders`.
- **Verify:** New and updated tests in `tests/orders.test.ts` pass; full suite green.

### Step 5 – Replay: same key returns the existing order

- **Objective:** AC2, AC5, AC6 (main concurrent case).
- **Changes:** In `createOrder`:
  - Build normalised input from the validated values only: `{ lines: [{ product, quantity,
    unitPrice }] (in request order), discountCode }`, and compute
    `sha256(JSON.stringify(normalised))` with `node:crypto`. Store it in `request_hash`.
  - Change the insert to `INSERT … ON CONFLICT (customer_id, idempotency_key) DO NOTHING
    RETURNING id`.
  - If a row is returned: insert lines and commit as today.
  - If no row is returned: `SELECT id, request_hash FROM orders WHERE customer_id = $1 AND
    idempotency_key = $2`, commit (nothing was written), and return `getOrder(existingId,
    customerId)`.
  - The existing `ROLLBACK`/rethrow path stays for unexpected errors.
- **Verify:** Replay, per-customer and deterministic concurrency tests pass; full suite green.
  The concurrency test is written in this step (not later) because the step 4 code
  (plain `INSERT` + unique constraint) makes it fail with a 500, which gives it a real red phase.

### Step 6 – Conflict: same key, different body

- **Objective:** AC3.
- **Changes:** In the no-row branch from step 5, if the stored `request_hash` differs from the
  computed one, return `err("conflict", …)`.
- **Verify:** Conflict tests pass; full suite green.

### Step 7 – Concurrency edge case: in-flight attempt is aborted

- **Objective:** AC6 edge case: if the first attempt's transaction rolls back while a retry is
  waiting, the retry must create the order (not fail with 404/500).
- **Changes:** Expected to need no production code: after the rollback, the waiting
  `INSERT … ON CONFLICT` proceeds as a normal insert. If the test shows otherwise, fix it here.
- **Verify:** The test passes; all concurrency tests are run several times
  (e.g. `npx jest tests/orders.test.ts -t concurrent` repeated) to confirm they are stable.

### Step 8 – Documentation, full verification, session log

- **Objective:** Make the change traceable and the breaking API change visible.
- **Changes:** `docs/api.md` (header, rules, 409, replay returns current state, 400 when the header
  is missing; new text in English, per user decision), `README.md` (migration commands, reset flow, test count), session log in
  `sessions/03-idempotent-order-retry.md` with status, changes, evidence, failures, decisions and
  remaining work.
- **Verify:** `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`,
  `npm run test:legacy` (or `.venv/bin/pytest`) all run and their real output is recorded.

## Testing Strategy

General: tests are written first in each step, run, and must fail **for the stated reason**
before implementation. All tests run against the test DB, reset before each test
(`tests/helpers/db.ts`). New test names follow the existing style in `tests/orders.test.ts`.

**Relevant existing tests:** `tests/orders.test.ts` (9 tests), `tests/customers.test.ts`
(regression only). No Python tests exist yet (`README.md`, "finns inga än"); `test:legacy` is
still run as a regression check.

### Step 1 – runner (`tests/migrations.test.ts`, using `tests/fixtures/migrations`)

| Test | Expected behaviour | Expected first failure |
|---|---|---|
| `migrateUp` applies all pending migrations in numeric order | fixture tables exist; `schema_migrations` lists `9001`, `9002` | module `src/migrate.ts` does not exist |
| `migrateUp` twice is a no-op | second run applies nothing, no error | same |
| `migrateDown` reverts only the latest migration | `9002` table gone and unrecorded; `9001` still applied | same |
| failing migration rolls back | a fixture with invalid SQL leaves no table and no record | same |
| `up` without `down` is rejected | clear error, nothing applied | same |

Cleanup: each test reverts its fixture migrations (`afterEach` + `DROP TABLE IF EXISTS` guards),
because `schema.sql` does not drop the fixture tables.

### Step 2 – reset

- After `resetDb`, `schema_migrations` exists (fails first: table does not exist).
- Regression: the full existing suite stays green.

### Step 3 – migration 0001 (`tests/migrations.test.ts`)

- After reset, `orders` has `idempotency_key` and `request_hash` (via `information_schema`).
- Two rows with the same `(customer_id, idempotency_key)` are rejected; multiple rows with `NULL`
  keys are allowed; the same key for two customers is allowed (AC5, database level).
- `migrateDown` removes the columns and the constraint; `migrateUp` again re-adds them
  (reversibility).
- Expected first failure: columns do not exist.

### Step 4 – key validation (`tests/orders.test.ts`)

| Test | Expected | Expected first failure |
|---|---|---|
| no header → 400 `invalid_input`, no new order row | AC4 | gets 201 today |
| empty `""` key → 400 | AC4 | 201 (see risk below about empty header values) |
| whitespace-only key → 400 | AC4 | 201 |
| 256-character key → 400 | AC4 | 201 |
| 255-character key → 201 | AC4 boundary | passes already (regression guard) |
| no `X-Customer-Id` and no key → 401 | AC8 | existing test, passes |
| 400 for empty lines with key K, then valid body with K → 201 | AC7 | may pass already; regression guard |

**Changes to existing tests (justified, CLAUDE.md §6):**
- "lägger en beställning med rader" – add an `Idempotency-Key`. Required because the header
  becomes mandatory, an intentional and user-approved behaviour change. Assertions unchanged.
- "returnerar 400 utan rader" and "returnerar 400 när antalet inte är positivt" – add a valid key
  so that they keep testing line validation rather than passing because the key is missing.
  Assertions unchanged.
- "returnerar 401 utan inloggning" – unchanged.

### Step 5 – replay

- Same customer, key and body twice → both 201, same `id`, and `orders` / `order_lines` row counts
  only grew once (AC2). Expected first failure: second request gets 500 from the unique
  constraint violation added in step 3/4.
- Same body including the same `discountCode` → replay (201, same `id`).
- Customer A and customer B use the same key → two different order ids, each with its own
  `customerId`; B never receives A's order (AC5).
- **Deterministic concurrent retry (AC6)**, test A in *Concurrency testing approach* below.
  Expected first failure: the second request gets 500 (unique violation), because step 4 uses a
  plain `INSERT`.

### Step 6 – conflict

- Same key, different lines → 409, `error.code === "conflict"`, no new rows (AC3). Expected first
  failure: 201 replay of the original order.
- Same key, only `discountCode` differs → 409.
- Same key, lines in a different order → 409 (per the assumption below).

### Step 7 – aborted in-flight attempt

- Test B in *Concurrency testing approach* below. Expected to pass without new code; it is a
  regression guard for the rollback path.

### Concurrency testing approach (steps 5 and 7)

A plain `Promise.all` with two requests cannot prove that the requests overlapped: the first may
commit before the second starts, and the test would then only repeat the sequential replay test.
Instead, the tests **force** the overlap with PostgreSQL locks held by the test itself, and
**observe** that the backends are actually blocked before releasing them. No test hooks, delays or
`sleep` are added to production code.

The approach relies on one verified fact about the current code: `createOrder` inserts into
`orders` and then into `order_lines` in the same transaction (`orderService.ts:42-54`).

**Test A – two real requests overlap (step 5, AC6)**

1. The test takes its own connection (`db.connect()`), runs `BEGIN` and
   `LOCK TABLE order_lines IN SHARE MODE`. This blocks inserts into `order_lines` but not into
   `orders`.
2. Start request 1 (`POST /orders`, customer 3, key K, body X) without awaiting it. It inserts its
   uncommitted `orders` row (holding key K) and then blocks on the `order_lines` insert.
3. Wait until request 1's backend is blocked: `pg_blocking_pids(pid)` for a backend in the test
   database contains the test's own pid (`pg_backend_pid()`).
4. Start request 2 (same customer, key and body) without awaiting it. Its
   `INSERT … ON CONFLICT` hits request 1's uncommitted row with the same key and waits for request
   1's transaction.
5. Wait until a backend is blocked by request 1's pid. At this point the overlap is **observed**,
   not assumed: request 2 is waiting on request 1's open transaction.
6. `ROLLBACK` the test transaction (releases the table lock) and release the connection.
7. Await both responses: both `201`, same `id`; exactly one new `orders` row and one set of
   `order_lines` rows.

**Test B – in-flight attempt aborted (step 7, AC6 edge case)**

1. The test's own transaction inserts an `orders` row for customer 3 with key K (parameterised
   SQL, dummy `request_hash`) and does not commit. This stands in for an in-flight first attempt.
2. Start a request with key K; wait until it is blocked by the test's pid.
3. `ROLLBACK` the test transaction.
4. The request returns `201` with a newly created order; exactly one new order row exists, and it
   is the request's own.

**Helper** `tests/helpers/locks.ts`: `waitForBlockedBy(client, blockerPid, timeoutMs)` polls
`pg_stat_activity` / `pg_blocking_pids` (parameterised queries) until a backend in the current
database is blocked by `blockerPid`, and returns its pid; it throws with a clear message on
timeout. Polling only waits for a condition to become true; the outcome does not depend on timing.

**What makes test A fail for wrong implementations**

| Wrong implementation | Result |
|---|---|
| No `ON CONFLICT` (step 4 state) | Request 2 waits, then gets a unique violation → 500. |
| SELECT-then-INSERT | SELECT sees nothing (row uncommitted), the INSERT waits, then a unique violation → 500. |
| No unique constraint | Request 2 never blocks → step 5 times out with a clear message. |

**Limitations**

- **Coupled to the current write order.** Test A depends on `createOrder` writing `orders` before
  `order_lines` in one transaction. If that changes, the test times out with a clear message
  rather than passing silently, and must be adjusted.
- **Relies on PostgreSQL monitoring functions.** `pg_stat_activity` and `pg_blocking_pids` are
  standard (PostgreSQL 16 in `docker-compose.yml`) but have not been used in this project yet. The
  test user must be able to see other sessions; the local `postgres` superuser can.
- **Covers one interleaving.** It proves "retry arrives while the first attempt is uncommitted".
  "Retry arrives after commit" is covered by the sequential replay test. Multiple API instances
  are not tested, but the guarantee lives in the database, so it applies to them too.
- **Hangs on failure.** A broken implementation can make a request wait until the helper's
  timeout (e.g. 5 s). The tests set an explicit Jest timeout (e.g. 15 s), and the test connection
  is always rolled back and released in `finally`, so the next test's `resetDb` is not blocked.
- **Supertest is lazy.** A request starts only when `.then()` is called, so each request is started
  explicitly (e.g. `const p1 = request(app).post(...).then((r) => r)`) before waiting for it to
  block.

### Every step

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`. In step 8 also
`npm run test:legacy`.

## Risks and Considerations

**Correctness**
- **Race condition** – handled by the DB unique constraint + `ON CONFLICT DO NOTHING` inside the
  transaction, not SELECT-then-INSERT. Based on general PostgreSQL behaviour (research marks it as
  not yet tested in this project); the deterministic lock-based tests A and B (steps 5 and 7)
  check it.
- **Fingerprint stability** – the hash is built from validated, normalised fields only, so extra
  body fields, key order and whitespace do not matter. `unitPrice` is hashed as the JS number
  (`200` and `200.0` are equal; `200.001` and `200.00` are not, even though both are stored as
  `200.00`). Changing the hash format later would make old keys conflict; documented in ADR 0002.
- **`validateLines` returns the original objects** (`orderService.ts:29`), including any extra
  properties. The fingerprint must map to `{ product, quantity, unitPrice }` explicitly.
- **Replay after conflict path** must not leave an open transaction; the no-row branch commits
  before returning, and the client is always released in `finally`.
- **Replay shows current state** (user decision), e.g. a later status change is visible.

**Security**
- **AC5:** keys scoped by `req.customerId` only, both in the constraint and in the lookup –
  prevents one customer from reading another's order via a guessed key.
- Key length capped at 255 in the service and by `VARCHAR(255)`; all SQL parameterised.
- Do not log keys together with customer details.

**Database / migrations**
- Running `npm run db:reset`, `db:migrate` or `db:migrate:down` against the **dev** DB changes
  state and needs the user's approval first (CLAUDE.md §7). `down` for 0001 permanently deletes
  stored keys. Tests only touch the test DB.
- `resetDb` now also runs migrations before every test, which makes the suite slightly slower.
- `schema_migrations` is not dropped by `schema.sql`; `resetDatabase` drops it explicitly.
  Fixture tables from runner tests must be cleaned up by the tests themselves.
- `scripts/` is not covered by `npm run lint` / `format:check` (`package.json:12-15`). That is why
  the logic lives in `src/migrate.ts` and `scripts/migrate.ts` stays thin.

**Regressions / compatibility**
- **Breaking API change:** clients without the header get 400. Documented in `docs/api.md`.
- Seeded orders keep `NULL` keys; legacy Python reads explicit columns
  (`price_calc.py:30`, `nightly_report.py:8`), so new columns do not affect it.
- `README.md`'s "16 gröna tester" will become outdated; updated in step 8.

## Open Questions and Assumptions

**Requirements confirmed by the user** (from research)
- AC1–AC8, including per-customer key scoping (AC5).

**Implementation decisions confirmed by the user (2026-11-15, planning)**
1. **Language:** all new code, error messages, tests and documentation are in English, including
   the additions to `docs/api.md` (CLAUDE.md §4). Existing Swedish text is not translated as part
   of this task.
2. **Migration design:** runner in `src/migrate.ts` with a CLI in `scripts/migrate.ts`; files
   `db/migrations/NNNN_name.up.sql` / `.down.sql`; one migration reverted at a time;
   `schema.sql` unchanged.

**Proposed in this plan, not yet confirmed** (covered by plan approval)
- Tracking table `schema_migrations`; reset order `schema.sql` → migrations → `seed.sql`.

**Assumptions (from research, not confirmed by the user)**
- The fingerprint covers `lines` (in order) and `discountCode`; reordering lines is a different
  body (409).
- Failed validations (400) store nothing, so the same key can be retried after a fix.
- Keys are compared exactly as sent (no trimming); trimming is used only to detect
  whitespace-only keys. Length is JS `string.length`.

**Assumptions made in this plan**
- An empty header value (`Idempotency-Key:` with nothing after it) reaches Express as `""` and is
  rejected. If Supertest/Node drops empty headers, the test will show it and the case is still
  covered by the "missing" rule – to be checked when writing the step 4 test.
- The concurrency tests use three DB connections at once (test connection + two requests) from
  the `db` pool (default max 10), which is enough.
- `LOCK TABLE order_lines IN SHARE MODE` blocks `INSERT INTO order_lines` but not
  `INSERT INTO orders`, and a waiting `INSERT … ON CONFLICT` on an uncommitted duplicate key is
  reported by `pg_blocking_pids`. This is documented PostgreSQL behaviour but has not been run in
  this project; step 5's red phase will confirm it.

**Verified vs. not verified**
- Everything under *Research References* and the file paths/line numbers in this plan were
  verified by reading the files on 2026-11-15.
- No tests or state-changing commands were run while writing this plan.
