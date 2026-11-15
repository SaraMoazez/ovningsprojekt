# Research: Idempotent Order Retry (No Duplicate Orders)

Task: *Customers can retry an order when the network fails without creating duplicate orders.*
Source: user story 1 in `docs/user-stories.md:5`.

Date: 2026-11-15

## Task Understanding

A customer (client) sends `POST /orders`. If the network fails after the server has created the
order but before the client receives the response, the client cannot know whether the order was
created. It will retry, and today every retry creates a new order. The goal is to make retries
safe: a retry of the same order attempt must not create a second order.

### Decisions confirmed by the user (2026-11-15)

| Topic | Decision |
|---|---|
| Mechanism | The client sends an `Idempotency-Key` HTTP header with a unique value per order attempt (e.g. a UUID). |
| Required? | **Required.** `POST /orders` without the header is rejected with `400 invalid_input`. |
| Same key, different body | `409 conflict`, using the existing `conflict` error code. |
| Same key, same body (replay) | `201`, with the same order as the original response. No new order is created. |

### Follow-up decisions confirmed by the user (2026-11-15)

| Topic | Decision |
|---|---|
| Migration tooling | Plain numbered SQL migration files with separate `up` and `down` scripts, run by a small migration runner. No external dependency. |
| Key format | Any non-empty string of up to 255 characters. Empty and whitespace-only strings are rejected. UUIDs are not required. |
| Key retention | Keys are kept indefinitely, stored with their orders. No expiry. |
| Replay state | A replay returns the *current* state of the original order via the existing `getOrder`. No snapshot of the original response is stored. |

### Expected behaviour (draft acceptance criteria, Given/When/Then)

`docs/user-stories.md:3` asks for acceptance criteria in Given/When/Then form. Draft:

1. **Given** a logged-in customer, **when** they send `POST /orders` with a valid body and a new
   `Idempotency-Key`, **then** an order is created and `201` is returned with the order.
2. **Given** an order was created with key K, **when** the same customer sends `POST /orders`
   again with key K and an identical body, **then** `201` is returned with the *same* order (same
   `id`, in its current state as returned by `getOrder`), and no new row is created in `orders` or
   `order_lines`.
3. **Given** an order was created with key K, **when** the same customer sends key K with a
   *different* body, **then** `409` is returned with `{ error: { code: "conflict", ... } }`, and
   no order is created.
4. **Given** a logged-in customer, **when** they send `POST /orders` without an `Idempotency-Key`,
   or with a key that is empty, whitespace-only, or longer than 255 characters, **then**
   `400 invalid_input` is returned and no order is created. A key of exactly 255 characters is
   accepted.
5. **Given** customer A created an order with key K, **when** customer B sends key K, **then**
   B's request is handled independently: keys are scoped per customer. B never receives A's order.
6. **Given** two concurrent requests with the same customer, key and body, **then** exactly one
   order is created, and both responses return that order.
7. **Given** a request with key K failed validation (`400`), **when** the client retries with key
   K and a corrected body, **then** the order is created, because nothing was stored for the
   failed attempt.
8. **Given** no `X-Customer-Id`, **then** `401` is returned as today. Authentication runs before
   the key check.

## Relevant Files

| File | Relevance |
|---|---|
| `src/routes/orders.ts:15-18` | `POST /orders` route. This is where the header would be read and passed to the service. |
| `src/services/orderService.ts:32-62` | `createOrder`. It inserts the order and its lines in one transaction. This is where the dedup logic belongs. |
| `src/services/orderService.ts:14-30` | `validateLines`. It validates the lines and is reused to normalise the body before fingerprinting. |
| `src/services/orderService.ts:64-83` | `getOrder`. Reused to build the replay response. |
| `src/result.ts:2` | `ErrorCode` already includes `"conflict"`. |
| `src/http.ts:4-9` | Maps `conflict` to 409 and `invalid_input` to 400. No change is needed. |
| `src/auth.ts:7-16` | `requireCustomer` sets `req.customerId`. Keys must be scoped to this value. |
| `db/schema.sql:24-30` | The `orders` table. It has no idempotency column or unique constraint. |
| `db/seed.sql:20-29` | Seeded orders 1040–1047, all without a key. A new column must allow `NULL` for these rows. |
| `tests/orders.test.ts:10-39` | The existing `POST /orders` tests. |
| `tests/helpers/db.ts:10-14` | Resets the test DB from `schema.sql` and `seed.sql` before each test. |
| `docs/api.md:11` | API documentation for `POST /orders`. It must be updated. |
| `docs/standard.md` | Rules for Result/HTTP, auth, transactions, parameterised SQL and tests. |
| `docs/user-stories.md:14` | Requires DB changes to be done as reversible, step-wise migrations. |

## Existing Implementation

Verified by reading the code:

- **No idempotency exists.** A search for `idempot` and `retry` in `src`, `tests`, `db`, `docs`
  and `scripts` found no matches.
- `POST /orders` (`src/routes/orders.ts:15-18`) calls
  `createOrder(customerId, req.body ?? {})` and responds with `sendResult(res, result, 201)`.
- `createOrder` (`src/services/orderService.ts:32-62`):
  1. validates the lines (`validateLines`) and returns `err("invalid_input", ...)` on failure;
  2. coerces `discountCode` to a `string | null` (line 38). The discount code is not validated
     against the `discounts` table;
  3. opens a client, runs `BEGIN`, inserts into `orders`, inserts each line in a loop, then
     `COMMIT`;
  4. rolls back and rethrows on an unexpected error;
  5. returns `getOrder(orderId, customerId)` *after* the commit, using the pool rather than the
     transaction client.
- `orders` (`db/schema.sql:24-30`) has `id SERIAL`, `customer_id`, `status`, `discount_code`,
  `created_at`. There are no foreign keys and no unique constraints apart from the PK. The schema
  file notes "known weaknesses" (line 2).
- **There is no migration tooling.** `db/` contains only `schema.sql` (which runs `DROP TABLE` and
  `CREATE TABLE`) and `seed.sql`. `scripts/db-reset.ts` re-runs both against the dev and test DBs.
- The legacy Python code reads `orders` by explicit column names only
  (`src/legacy/price_calc.py:30`, `jobs/nightly_report.py:8`). Adding a column will not break it.
- The JSON body parser is `express.json()` (`src/app.ts:7`). There is no CORS setup, so custom
  request headers are not an issue for the current clients.

## Existing Tests

`tests/orders.test.ts` (Jest and Supertest, against the test DB, which is reset before each test):

| Test | Line | Effect of the change |
|---|---|---|
| creates an order with lines (201) | 11-20 | **Will fail.** It sends no `Idempotency-Key`, and the key is now required. It needs the header added. This is a justified update, because the required key is an intentional behaviour change (CLAUDE.md §6). |
| 400 without lines | 22-25 | It still passes, but now for the wrong reason (missing key, not empty lines). The test should add a valid key so that it keeps testing line validation. |
| 400 when quantity is not positive | 27-32 | Same as above: add a key so the test still targets quantity validation. |
| 401 without login | 35-38 | Unaffected, because auth runs first. |
| GET tests | 41-71 | Unaffected. |

**Coverage gaps (new tests needed):**
- Replay with the same key and body returns 201 with the same `id`, and the row count in
  `orders`/`order_lines` is unchanged.
- Same key with a different body returns 409 `conflict`.
- Missing, empty, whitespace-only or over-long (256 characters) key returns 400 `invalid_input`.
  A 255-character key is accepted (boundary test).
- The same key used by different customers creates two independent orders, and neither leaks the
  other's order.
- A failed validation with key K followed by a valid retry with K creates the order.
- Concurrent requests with the same key create exactly one order (e.g. `Promise.all` with two
  Supertest requests).
- The 403 test for `POST /orders` is not applicable, because a customer can only create their own
  orders (`docs/standard.md:33`, "where possible").
- No tests exist for `discountCode` on `POST /orders` today. The replay comparison should include
  it, so a test where only `discountCode` differs (expect 409) is useful.

## Risks and Considerations

**Correctness and concurrency**
- **Race condition (main risk).** A "SELECT then INSERT" check is not safe: two concurrent retries
  can both see "no existing order" and both insert. Use a DB-level unique constraint on
  `(customer_id, idempotency_key)` and `INSERT ... ON CONFLICT DO NOTHING RETURNING id` inside
  the existing transaction. In PostgreSQL, the second inserter blocks until the first transaction
  commits, then sees the conflict. If `RETURNING` gives no row, look up the existing order and
  compare fingerprints.
- **Body comparison.** Comparing raw JSON is fragile, because key order and whitespace vary.
  Compute a fingerprint from the *validated, normalised* input (lines in order with
  `product, quantity, unitPrice`, and `discountCode`). For example, use a SHA-256 hash of a
  canonical JSON string from `node:crypto`. Store it with the order. (This is an assumption; see
  the open questions. An alternative is to compare against the stored `order_lines`, but that is
  harder because `unit_price` is `NUMERIC(10,2)` and the input is a JS number. For example, input
  `200.001` is stored as `200.00`.)
- **Validation order.** Check the key first (400), then validate the lines (400), then dedupe. A
  failed request stores nothing, so a later corrected retry with the same key succeeds. This
  matches common practice (e.g. Stripe does not store keys for validation failures).
- **Replay shows the current state, not a snapshot (decided).** `getOrder` returns the order as
  it is now. If its status changes between the original request and the retry (e.g. a future
  cancel feature, user story 2), the replay shows the new status. The user has confirmed this is
  the intended behaviour.
- **The ROLLBACK path** (`orderService.ts:56-58`) must still work. A conflict handled through
  `ON CONFLICT` is not an exception and should not roll back the transaction.

**Security**
- **Scope keys per customer.** The unique constraint and the lookup must include `customer_id`
  from `req.customerId` (`docs/standard.md:21`), never from the body. Otherwise customer B could
  guess or reuse A's key and receive A's order, which would be an information leak.
- **Validate the key's format and length (decided).** Keys must be non-empty, not whitespace-only,
  and at most 255 characters. This avoids storing unbounded user input. Any characters are
  allowed; UUIDs are not required. All SQL stays parameterised
  (`docs/standard.md:10`).
- Do not log keys together with customer details (`docs/standard.md:30`).
- Observed, out of scope: `src/legacy/price_calc.py:30,36,42` and `jobs/nightly_report.py:8`
  build SQL with `%` string formatting (SQL injection risk). This is not related to this task,
  but should be noted for later work.

**Database and migration**
- The new columns must be `NULL`-able, because the seeded orders have no key. "Required" is
  enforced in the API layer, not with `NOT NULL`. A plain UNIQUE constraint on
  `(customer_id, idempotency_key)` allows multiple `NULL`s in PostgreSQL, which is the desired
  behaviour for old rows.
- There is no migration tooling, but `docs/user-stories.md:14` requires reversible, step-wise
  migrations. The user has decided on plain numbered `up`/`down` SQL files and a small runner
  with no external dependency. This is still an architectural decision and needs an ADR
  (CLAUDE.md §8).
- **Fitting migrations into the existing reset flow.** `tests/helpers/db.ts:10-14` and
  `scripts/db-reset.ts` rebuild the DB from `schema.sql` (which drops and recreates tables) and
  then `seed.sql`. The runner must work alongside this. For example, the reset could apply
  `schema.sql`, then all `up` migrations, then `seed.sql`. Otherwise the test DB will not have the
  new columns. The exact order belongs in the plan.
- **Tracking applied migrations.** Without a library, the runner needs its own record of which
  migrations have run (e.g. a `schema_migrations` table). `schema.sql` currently drops only the
  four known tables, so it would not reset such a table. The plan must handle this.
- **Reversibility.** Each `down` script must undo exactly its `up` script (drop the constraint,
  then the columns). Rolling back permanently deletes the stored keys, so it needs approval
  before running (CLAUDE.md §7).
- The runner uses the existing `pg` dependency and parameterised queries where values are
  involved. It reads the connection string from environment variables, like
  `scripts/db-reset.ts:11-14` does.
- Schema changes on the dev DB are a DB change that needs approval before running (CLAUDE.md §7).

**Regressions and API compatibility**
- **Requiring the header is a breaking API change.** Any existing client that does not send it
  will get 400. `docs/api.md` must be updated.
- Existing tests need updating as described above. The intent of each test stays the same.

**Key retention (decided).** Keys are stored indefinitely with their order, with no expiry. This
is simple, and the cost is low because it is one column per order. As a result, a client can
never reuse a key for a different order, which is the intended behaviour.

## Recommended Approach

Follow TDD (CLAUDE.md §6). Implementation will start only after a plan is approved.

1. **ADRs.** Write ADRs in `docs/adr/` covering:
   - storing the idempotency key on `orders`, compared with a separate `idempotency_keys` table,
     and comparing bodies by fingerprint;
   - the migration approach: plain numbered `up`/`down` SQL files and a small runner without an
     external dependency (decided), with the alternatives considered (`node-pg-migrate`, or only
     editing `schema.sql`).
2. **Migration runner.** Write a small script, e.g. in `scripts/`, using the existing `pg`
   dependency. It applies or reverts numbered migrations (e.g.
   `db/migrations/0001_add_order_idempotency.up.sql` / `.down.sql`) and records which ones have
   been applied. Integrate it with `scripts/db-reset.ts` and `tests/helpers/db.ts` so that both
   the dev and test DBs get the new schema.
3. **Migration 0001 (reversible).** The `up` script adds `idempotency_key VARCHAR(255) NULL` and
   `request_hash TEXT NULL` to `orders`, plus `UNIQUE (customer_id, idempotency_key)`. The `down`
   script drops the constraint and the columns.
   - The length limit is enforced in the service. `VARCHAR(255)` adds a database-level guard.
     (This choice of column type is a suggestion, not a user decision.)
   - Columns on `orders` are the simplest option, because a key maps to exactly one order. A
     separate table is only needed if non-order responses (such as stored 400s) must be replayed,
     which they don't.
4. **Tests first** in `tests/orders.test.ts`. Add the new cases listed under *Existing Tests*, and
   add a valid header to the three existing `POST /orders` tests (with the justification noted).
   Run the tests and confirm they fail for the expected reasons.
5. **Route** (`src/routes/orders.ts`): read `req.header("Idempotency-Key")` and pass it to
   `createOrder` as a separate parameter. It must not be read from the body.
6. **Service** (`src/services/orderService.ts`):
   - Validate the key: it must be present, not empty or whitespace-only (`key.trim() === ""`),
     and at most 255 characters. If it is invalid, return `err("invalid_input", ...)`.
   - Validate the lines as today, then compute a fingerprint from the normalised input.
   - In the existing transaction, run
     `INSERT INTO orders (..., idempotency_key, request_hash) VALUES (...) ON CONFLICT (customer_id, idempotency_key) DO NOTHING RETURNING id`.
   - If a row is returned, insert the lines as today and commit.
   - If no row is returned, select the existing `id` and `request_hash` for
     `(customer_id, key)`, then commit or roll back (nothing was written). If the hash differs,
     return `err("conflict", ...)`. Otherwise return `getOrder(existingId, customerId)`, which
     gives the order's current state (decided).
   - The route keeps returning 201 on success, so the replay automatically gets 201.
7. **Docs.** Update `docs/api.md` with the header, the key rules, the 409 response, and the replay
   semantics. Document how to run and roll back migrations (e.g. in `README.md`).
8. **Verify.** Run `npm test`, `npm run lint`, `npm run typecheck` and `npm run format:check`.
   Write a session log in `sessions/`.

## Open Questions and Assumptions

**Resolved questions (user decisions, 2026-11-15)**
1. **Migration tooling:** plain numbered `up`/`down` SQL files and a small runner, with no
   external dependency.
2. **Key format:** any non-empty string of up to 255 characters. Empty and whitespace-only
   strings are rejected. UUIDs are not required.
3. **Key retention:** keys are kept indefinitely with their orders. No expiry.
4. **Replay state:** the current state of the original order, via `getOrder`. No snapshot.

**Remaining details for the planning phase** (no user decision required unless the plan
proposes something unusual)
- How the migration runner tracks applied migrations, and how it fits into `scripts/db-reset.ts`
  and `tests/helpers/db.ts` (see *Risks and Considerations*).
- The file layout and naming of migrations (e.g. `db/migrations/NNNN_name.up.sql`).

**Assumptions (not verified with the user)**
- The fingerprint covers `lines` (in order) and `discountCode`. Reordering lines counts as a
  *different* body.
- Validation failures (400) are not stored, so the same key can be retried after a fix.
- Keys are scoped per customer. The same key from two customers is not a conflict.
- Keys are stored and compared exactly as sent, without trimming. `" abc"` and `"abc"` are
  different keys. Trimming is used only to detect whitespace-only keys. The 255-character limit
  applies to the raw value.
- The 255-character limit counts JavaScript string length (UTF-16 code units). For non-ASCII
  keys, this can differ slightly from the number of characters PostgreSQL counts in
  `VARCHAR(255)`. This only matters at the boundary.

**Verified facts vs. assumptions**
- Everything under *Existing Implementation* and *Existing Tests* is verified by reading the files
  cited.
- The behaviour of PostgreSQL `ON CONFLICT` and multiple `NULL`s in a UNIQUE constraint is based
  on general PostgreSQL knowledge. It was not tested in this project.
- No tests or other commands that change state were run during this research.
