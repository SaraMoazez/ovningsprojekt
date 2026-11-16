# ADR 0002: Idempotency key stored on `orders`

Date: 2026-11-16
Status: Accepted (2026-11-16)

Related: `docs/plans/idempotent-order-retry.md` (step 0), `docs/research/idempotent-order-retry.md`
(acceptance criteria AC1–AC8), ADR 0001.

## Context

User story 1, "Omförsök utan dubbla beställningar" (`docs/user-stories.md`): customers must be
able to retry an order when the network fails without creating duplicate orders. Today every
`POST /orders` creates a new order (`createOrder` in `src/services/orderService.ts`).

Decisions already confirmed by the user (2026-11-15):

- The client sends a required `Idempotency-Key` header. Missing, empty, whitespace-only or keys
  longer than 255 characters give `400 invalid_input`.
- Same key and same body: `201` with the same order, in its *current* state via `getOrder`. No
  response snapshot is stored.
- Same key and different body: `409 conflict`.
- Keys are scoped per customer (AC5) and kept indefinitely, with no expiry.
- Concurrent requests with the same customer, key and body create exactly one order (AC6).
- A request that fails validation stores nothing, so the key can be reused after a fix (AC7).

Three design questions remain, and are decided here.

## Decision

1. **Store the key on `orders`.** Migration 0001 adds two nullable columns to `orders`:
   `idempotency_key VARCHAR(255)` and `request_hash TEXT`, plus a named unique constraint on
   `(customer_id, idempotency_key)`. The columns are nullable because seeded and older orders have
   no key. The "required" rule is enforced in the service, not with `NOT NULL`. PostgreSQL allows
   several `NULL` keys under a plain unique constraint.
2. **Compare bodies with a request fingerprint.** The service builds a normalised object from the
   *validated* input only: `{ lines: [{ product, quantity, unitPrice }] (in request order),
   discountCode }`. It stores `sha256(JSON.stringify(normalised))` (via `node:crypto`) in
   `request_hash`. On a repeated key, the stored hash is compared with the new one.
   - `discountCode` uses the existing normalisation in `createOrder`: a missing, `null` or
     non-string value becomes `null`, while any string, including `""`, is kept as sent. No new
     validation rules are added (user decision, 2026-11-16).
   - Lines are kept in request order. Reordering lines gives a different fingerprint, so a retry
     with reordered lines returns `409 conflict` (user decision, 2026-11-16).
3. **Prevent duplicates in the database.** The insert becomes
   `INSERT … ON CONFLICT (customer_id, idempotency_key) DO NOTHING RETURNING id`, inside the
   existing transaction in `createOrder`.
   - A returned row means a new order: insert its lines and commit, as today.
   - No returned row means the key exists for this customer: select its `id` and `request_hash`,
     commit (nothing was written), and return either the existing order (same hash) or
     `err("conflict", …)` (different hash).
4. **Scope by the authenticated customer only.** Both the constraint and the lookup use
   `customer_id` from `req.customerId` (`docs/standard.md`, §Behörighet), never from the body.

## Alternatives considered

### Where to store the key

- **Separate `idempotency_keys` table** (key, customer, request hash, order id, maybe a response
  snapshot and an expiry time). This is the general pattern when any kind of response (including
  errors) must be replayed, or when keys expire. Here, a key maps to exactly one order, keys never
  expire, failed requests are not stored, and replay uses the current order state rather than a
  snapshot. A separate table would add a join, a second insert, and more migration code without
  any benefit. **Rejected.**
- **Columns on `orders`.** One extra column pair per order, simple lookup, and the unique
  constraint lives on the same row that is inserted. **Chosen.**

### How to compare request bodies

- **Compare the raw JSON body.** Fragile: key order, whitespace and extra fields would turn an
  identical retry into a conflict. **Rejected.**
- **Compare against the stored `order_lines` and `discount_code`.** No new column needed, but
  `unit_price` is `NUMERIC(10,2)` while the input is a JS number (`200.001` is stored as
  `200.00`), so the comparison would need rounding rules. It also needs an extra query and
  depends on line order in the table. **Rejected.**
- **Fingerprint of the validated, normalised input.** Stable against key order, whitespace and
  extra fields, cheap to compare, one column. **Chosen.**

### How to handle concurrent retries

- **SELECT, then INSERT if nothing was found.** Not safe: two concurrent requests can both see no
  existing row. With a unique constraint the second one would fail with a unique violation (500);
  without one it would create a duplicate order. **Rejected.**
- **Database unique constraint + `INSERT … ON CONFLICT DO NOTHING`.** The database guarantees at
  most one order per `(customer_id, idempotency_key)`. A second insert with the same key waits for
  the first transaction, then either sees the conflict (first committed) or inserts normally
  (first rolled back). The guarantee also holds across several API instances. **Chosen.**
- **Application-level lock or advisory lock.** Would work, but adds locking code that the unique
  constraint already gives for free. **Rejected.**

## Consequences

**Positive**
- Retries are safe, including concurrent ones, without any locking code in the application.
- Customers cannot read each other's orders by guessing a key.
- Small schema change: two nullable columns and one constraint, reversible via migration 0001.

**Negative / risks**
- **Breaking API change:** clients that do not send `Idempotency-Key` get `400`. Must be
  documented in `docs/api.md`.
- **Fingerprint format is a contract.** Changing what is hashed (fields, order, number handling)
  would make retries of old keys return `409`. Any change must be treated as a breaking change.
- `unitPrice` is hashed as the JS number, so `200.001` and `200.00` are different bodies even
  though both are stored as `200.00`. This is accepted.
- Reordering lines counts as a different body (`409`), even if the lines are otherwise the same.
  This is intended (user decision).
- Keys are kept forever, so a client can never reuse a key for a different order. This is the
  intended behaviour.
- A replay shows the order's current state, so it may differ from the original response (e.g.
  after a future status change). This is the intended behaviour (user decision).
- Reverting migration 0001 permanently deletes all stored keys and fingerprints.
- The concurrency behaviour of `ON CONFLICT` is documented PostgreSQL behaviour but has not yet
  been tested in this project. The deterministic lock-based tests in plan steps 5 and 7 are meant
  to verify it.
