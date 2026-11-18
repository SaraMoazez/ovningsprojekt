# ADR 0003: Staged, characterization-first modernization of the legacy price module

Date: 2026-11-18
Status: Accepted (2026-11-18)

Related: `docs/research/legacy-price-calc-modernization.md`, `docs/tech-debt/0001-express-async-error-handling.md`.

## Context

`src/legacy/price_calc.py` calculates net, VAT and total for an order. It has two callers: the API
(`GET /orders/:id/price`, through `src/pricing/legacyPrice.ts`) and the cron job
`jobs/nightly_report.py`. The nightly job also imports the module-level connection `conn`. The
research (2026-11-18) found these problems:

- **There are no Python tests.** One Jest test (`tests/orders.test.ts:193-199`) checks only
  `Number(total)` for order 1042.
- **SQL injection.** A customer-controlled `discount_code` is put into SQL with `%`-formatting
  (`price_calc.py:42`). Lines 30 and 36 build SQL the same way.
- **Amounts are truncated, not rounded** (`_kapa`, line 23–25). The comment on line 3 says finance
  has reconciled its figures against this.
- **Output strings do not always have two decimals.** The module returns `"950"` and `"588.8"`,
  but `docs/standard.md` (Money: amounts are returned as strings with two decimals) requires two.
- **Loose discount rules.** Expired discount codes still apply, unknown codes are ignored, order
  status is ignored, and percent values over 100 give negative amounts.
- **Side effects on import.** Importing the module opens a database connection, and the
  connection URL falls back to hard-coded dev credentials.
- **Errors are hidden.** The bridge reports every Python failure as `404 not_found`, has no
  timeout, and calls `JSON.parse` in a callback without catching errors.

The user decided on 2026-11-18 to follow the recommendations in the research.

## Decision

1. **The end state for now is the Python module, refactored in place.** The module stays in
   Python, and the API keeps reaching it through `calcPrice` in `src/pricing/legacyPrice.ts`.
   That bridge is still the only entry point for pricing in the API (`docs/standard.md`, Money:
   all price calculation goes through `calcPrice`). A port to TypeScript is not part of this work.
   If it is wanted later, it needs its own ADR, and the nightly job must move too, so that no
   pricing logic exists twice.
2. **Characterization tests come before any change to the module.** The pytest tests (in
   `tests/test_price_calc.py`) run the module **as a subprocess through its CLI**, the same way
   the bridge does.
   - They assert the exact stdout JSON and exit code for seed orders 1040–1047, a nonexistent
     order, and edge cases inserted into the test database.
   - Subprocess tests also cover the nightly report for fixed dates.
   - New Jest tests cover `GET /orders/:id/price`: exact response bodies, plus 400, 401, 403
     and 404.
   - The expected values in all these tests come from running the current code, not from the
     research document.
   - All characterization tests must pass against the code as it is before refactoring starts.
3. **The SQL injection is fixed first, right after characterization.** All queries in
   `price_calc.py` and `jobs/nightly_report.py` use parameters (`cur.execute(sql, (value,))`).
   A test first shows that a discount code containing a quote is treated as a literal value. This
   is a deliberate behavior change for malicious input only.
4. **Refactoring keeps behavior.** Every refactoring step passes the characterization suite
   unchanged. In order:
   - Extract a pure calculation function, covered by unit tests that do not need a database.
   - Make the database connection lazy, while keeping `calc_price`, `Pris.total` and a
     module-level `conn` usable by `jobs/nightly_report.py`. If that interface changes, the job
     is updated in the same step.
   - Remove the hard-coded credential fallback.
   - Replace the bare `except`. Logging must still never fail the calculation.
   - Translate names and comments into English.
   - Fetch prices with one query per order instead of several, and remove the
     one-calculation-per-order (N+1) pattern in the nightly job.
5. **Truncation is preserved.** The two-decimal truncation in `_kapa` and the order of the
   calculation stay as they are:
   - the discount is applied to the raw sum;
   - the net is truncated;
   - VAT is calculated on the truncated net and then truncated.

   Any change needs confirmation from finance and a new ADR.
6. **Output becomes two-decimal strings, as a deliberate behavior change after refactoring.**
   `net`, `vat` and `total` will be formatted with exactly two decimals (`"950.00"`). The numeric
   values do not change. The characterization tests that pin the current strings are updated in
   that step, with the reason stated, and `docs/api.md` is updated.
7. **Discount semantics are kept for now.** Expired codes still apply, unknown codes are still
   ignored, order status is still ignored, and percent values outside 0–100 are not rejected.
   Characterization tests pin this behavior and mark it as questionable. Changing any of it is a
   later, separate decision that needs confirmation from finance or the product owner, because
   reconciled totals may depend on it.
8. **The bridge's error handling is improved as a separate step, after refactoring.** The bridge
   will:
   - tell "order not found" (exit code 1 with `{"error": ...}`) apart from internal failures;
   - get a timeout;
   - parse stdout safely.

   How internal errors map to HTTP is decided together with
   `docs/tech-debt/0001-express-async-error-handling.md`, so that both use the same error format.
9. **The test database has safety rules for Python tests.**
   - Python tests run only against `butik_test`. The test setup fails before any query if
     `DATABASE_URL` does not point at a database whose name ends in `_test`.
   - Resetting reuses the existing `resetDatabase` (`src/migrate.ts`), so the reset logic is not
     duplicated, and resets **only** the test database. `scripts/db-reset.ts` is not used from
     tests, because it also resets the dev database.

## Alternatives considered

### End state

- **Port to TypeScript now.** This removes the Python process per request and the dependency on
  `PATH`. However, `jobs/nightly_report.py` runs from cron on a production server whose setup is
  not known from this repository, and the standard forbids keeping two pricing implementations.
  **Deferred** to a possible later ADR.
- **Refactor in place.** Small steps, each with its own tests, and both callers keep working.
  **Chosen.**

### Test level for characterization

- **Import `calc_price` in pytest.** Importing opens a database connection and causes side
  effects, and it skips the CLI contract that the API depends on. **Rejected** for
  characterization. Unit tests on the extracted pure function are used later.
- **Subprocess through the CLI.** This pins exactly what the bridge and the API see. **Chosen.**
- **Only HTTP tests in Jest.** These would not cover the nightly job, and they would slow down
  feedback on the calculation. **Used in addition, not instead.**

### Order of the security fix

- **Strict "refactor first, fix later".** This leaves a known, customer-reachable injection open
  during the whole refactoring. **Rejected.**
- **Fix it before writing characterization tests.** Behavior would then change before it has been
  pinned. **Rejected.**
- **Fix it right after characterization.** **Chosen.**

### Output format

- **Keep `"950"` / `"588.8"`.** This breaks the standard and is ambiguous for clients.
  **Rejected.**
- **Switch to two decimals during refactoring.** This mixes a behavior change into steps that
  should keep behavior. **Rejected.**
- **Switch to two decimals as a separate step.** **Chosen.**

### Test database reset

- **Use `scripts/db-reset.ts`.** It also resets the dev database. **Rejected.**
- **Write a Python version of the reset (schema, then migrations, then seed).** This duplicates
  the logic in `resetDatabase`, including the order in which migrations run. **Rejected.**
- **Reuse `resetDatabase` for the test URL only, with a check on the database name.** **Chosen.**

## Consequences

**Positive**
- Every change to the module is guarded by tests that pin today's exact output.
- The customer-reachable SQL injection is closed early.
- The nightly job keeps working throughout, because its interface is kept or updated in the same
  step.
- Finance's reconciled figures (truncation) are protected.

**Negative / risks**
- **API change:** clients will see `"950.00"` where they used to see `"950"` (decision 6). The
  numeric values are the same.
- Questionable discount behavior (decision 7) stays in production until someone decides
  otherwise.
- Every price request still starts a Python process until a possible TypeScript port.
- Python tests need a running database and Node/`tsx` for the reset, so the Python test setup
  depends on the Node toolchain.
- `jobs/nightly_report.py` has no automated deployment in this repository. Changes to it must be
  rolled out to the production server by hand. That process is unknown.
- Whether the injection could run stacked statements (it depends on how psycopg 3 sends queries
  without parameters) has not been verified. The fix in decision 3 closes it either way.
