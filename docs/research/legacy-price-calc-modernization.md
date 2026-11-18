# Research: Modernize the Legacy Python Price Calculation Module

**Date:** 2026-11-18
**Scope:** Research only. No source, test or configuration files were changed.

Evidence labels used in this document:

- **Verified (code):** read directly in the repository.
- **Verified (isolated check):** the pure `Decimal` arithmetic from `_kapa` and `calc_price` was
  copied into a scratchpad script and run with `.venv/bin/python -I`. That script had no database
  and did not import the project, so it did not touch project state.
- **Assumption:** not verified. Must be confirmed before work relies on it.

`src/legacy/price_calc.py` itself was **not executed**. It connects to the database when it is
imported and appends to a log file inside `src/legacy/`, so running it would change project state.

## Task Understanding

The goal is to modernize `src/legacy/price_calc.py` safely. This research should:

- map the module, its dependencies, callers, tests, database access and current behavior;
- identify risks;
- recommend a characterization-testing and refactoring strategy.

"Modernize" is not defined further in the task. It could mean any of these:

1. Refactor the Python code in place, keeping behavior the same.
2. Also fix known defects, such as SQL injection or output that does not follow the standard.
3. Port the calculation to TypeScript under `src/pricing/` and retire the Python module.

These choices lead to different end states. The strategy below works for all three, because
characterization tests come first in every case. The choice itself is listed under Open Questions.

The README (`README.md:8`, `README.md:70`) describes this module as undocumented, untested and full
of unknown assumptions, and names its modernization as a course project task.

## Relevant Files

| File | Role |
|---|---|
| `src/legacy/price_calc.py` | The legacy module (66 lines). |
| `src/pricing/legacyPrice.ts` | TypeScript bridge. Runs the module as a subprocess. |
| `src/routes/orders.ts:34-47` | `GET /orders/:id/price`. The only API caller of `calcPrice`. |
| `jobs/nightly_report.py` | Second caller. Imports `calc_price` and `conn` directly. Run by cron on the production server (per the comment on line 1). |
| `db/schema.sql:17-38` | `discounts`, `orders` and `order_lines` tables. |
| `db/seed.sql` | Fictional seed data. Orders 1040–1047. Lines 19–20 say orders 1042–1044 are meant for characterization-test examples. |
| `db/migrations/0001_add_order_idempotency.up.sql` | Adds columns to `orders`. Does not affect the columns the module reads. |
| `src/migrate.ts:70-75` | `resetDatabase`: runs schema, then migrations, then seed. |
| `scripts/db-reset.ts` | Resets **both** the dev database and the test database. |
| `tests/orders.test.ts:193-199` | The only existing test that reaches the module. |
| `tests/helpers/env.ts` | Points `DATABASE_URL` at `butik_test` for Jest. |
| `pytest.ini` | `testpaths = tests`, `python_files = test_*.py`. |
| `requirements.txt` | `psycopg[binary]==3.2.3`, `pytest==8.3.3`. |
| `docs/standard.md` | The Money, Database, Errors and Tests rules apply (see Risks). |
| `docs/api.md:13,17-23` | Documents the price endpoint and the module. |
| `docs/tech-debt/0001-express-async-error-handling.md:93-96` | Already notes the `JSON.parse` crash risk in the bridge. |
| `src/services/orderService.ts:53` | Accepts any string as `discountCode` and stores it unvalidated. |
| `.gitignore:6` | Ignores `src/legacy/price_calc.log`. |

## Existing Implementation

### Module structure (`src/legacy/price_calc.py`)

- **Imports (line 5–7):** `os`, `sys`, `json`, `datetime`, `Decimal`, `psycopg`. `psycopg` is the
  only third-party dependency.
- **Side effects at import time (line 9–10):** reads `DATABASE_URL`. If that is unset, it falls back
  to a hard-coded dev URL with credentials (`postgres:postgres@localhost:5432/butik`). It then opens
  a module-global connection with `autocommit=True`. Importing the module therefore needs a running
  database.
- **Constants:** `MOMS = 25` (VAT percent, line 12). `LOGG` is a log file next to the module
  (line 13).
- **`Pris` (line 16–20):** a plain class with `net`, `vat` and `total`.
- **`_kapa(x)` (line 23–25):** `Decimal(int(x * 100)) / 100`. This **truncates** toward zero. It
  does not round. The comment on line 3 says: do not touch the rounding, finance has reconciled
  against it.
- **`calc_price(order_id)` (line 28–58):**
  1. Reads `orders.discount_code`. If there is no row, it returns `None` (line 30–33).
  2. Reads every `order_lines` row and adds up `quantity * unit_price` as `Decimal` (line 36–39).
  3. If there is a discount code, it looks up `discounts.percent`. If it finds a row, it applies
     `summa - summa * percent / 100` to the untruncated sum (line 41–45). An unknown code is
     ignored without any message.
  4. `net = _kapa(summa)`, `vat = _kapa(net * 25 / 100)`, `total = net + vat` (line 47–49). VAT is
     calculated on the already truncated net. `total` is not truncated again, but it does not need
     to be.
  5. Appends `"<iso timestamp> <order_id> <total>"` to the log file. All exceptions are swallowed
     by a bare `except:` (line 51–56).
- **CLI (line 61–66):** `python price_calc.py <id>`. On success it prints
  `{"net": str, "vat": str, "total": str}` and exits with code 0. For an unknown order it prints
  `{"error": "finns inte"}` and exits with code 1. A non-integer argument raises `ValueError`
  (traceback, exit code 1).

### Database access (Verified (code))

The module only reads. It does not write to the database.

| Line | Query | Built with |
|---|---|---|
| 30 | `select discount_code from orders where id = %s` | `%` string formatting |
| 36 | `select quantity, unit_price from order_lines where order_id = %s` | `%` string formatting |
| 42 | `select percent from discounts where code = '%s'` | `%` string formatting, **value from user input** |

- `discounts.valid_from` and `discounts.valid_to` (`db/schema.sql:20-21`) are **never checked**. An
  expired code still applies. Seed order 1045 uses `GAMMAL15`, which was valid during 2024.
- `orders.status` is not checked. Cancelled orders get a price too.
- The schema has no `CHECK` on `discounts.percent`, and no foreign keys from `order_lines` or
  `orders`.

### Observed behavior: exact output strings

These outputs come from running the same `Decimal` arithmetic on the seed rows. They are
**Verified (isolated check)**, with one **Assumption**: psycopg 3 returns `NUMERIC(10,2)` as
`Decimal` with two decimal places (for example `Decimal('899.00')`) and `INTEGER` as `int`.

| Order | Lines / discount | net | vat | total |
|---|---|---|---|---|
| 1040 | 1 × 899.00 | `899` | `224.75` | `1123.75` |
| 1041 | 3 × 129.00 + 349.00, SOMMAR20 | `588.8` | `147.2` | `736.0` |
| 1042 | 2 × 375.00 + 200.00 | `950` | `237.5` | `1187.5` |
| 1043 | no lines | `0` | `0` | `0` |
| 1044 | 199.90, VAR10 | `179.91` | `44.97` (rounding would give 44.98) | `224.88` |
| 1045 | 649.00, GAMMAL15 (expired) | `551.65` | `137.91` | `689.56` |
| 1046 | 899.00, status cancelled | `899` | `224.75` | `1123.75` |
| 1047 | 129.00 + 2 × 200.00 | `529` | `132.25` | `661.25` |

Key findings:

- **The output strings do not always have two decimals.** `Decimal(int)/100` keeps only the decimal
  places it needs, so the module returns `"950"`, `"588.8"` and `"0"`. This conflicts with
  `docs/standard.md` (Money: amounts are "returned as strings with two decimals").
- **Truncation, not rounding.** This is visible for order 1044, where the VAT is `44.97`.
- In the isolated check, a percent of 150 gave negative amounts (`-50`, `-12.5`, `-62.5`). Nothing
  guards against that.

### Callers

1. **API** (`src/pricing/legacyPrice.ts`)
   - Runs `execFile("python3", [script, id])` and resolves `python3` from `PATH`. This is why
     `npm test` needs `.venv` to be active.
   - Every request starts a new Python process and opens a new database connection.
   - There is no timeout.
   - Every error (exit code 1, Python missing, `psycopg` missing, database down, any traceback) is
     mapped to `err("not_found", ...)`, which becomes **404**.
   - `JSON.parse(stdout)` runs inside the callback with no `try`/`catch` (line 17). The
     tech-debt note says this can crash the process.
   - The route (`src/routes/orders.ts:41-45`) checks that the order exists and that the customer
     owns it (`getOrder`) before it calls `calcPrice`. The ownership check is therefore not part
     of the module.
2. **Nightly report** (`jobs/nightly_report.py`)
   - Adds `src/legacy` to `sys.path` and imports `calc_price` **and `conn`**. This makes the
     module-global connection a public interface.
   - Line 8 builds SQL with `%`-formatting, using the date taken from `argv`.
   - Calls `calc_price` once per paid order, which is three queries per order (N+1).
   - If an order disappears in between, `calc_price` returns `None`, and `p.total` raises
     `AttributeError`.
   - Sums `p.total` and prints a Swedish summary line.

No other callers were found. A `grep` for `price_calc`, `calc_price` and `calcPrice` outside
`node_modules` and `sessions/` matched only the files above and the docs.

## Existing Tests

- **Python:** there are **no** Python tests. `find` found no `test_*.py` files. This means
  `npm run test:legacy` / `pytest` currently collects nothing. (**Assumption:** pytest then exits
  with code 5, "no tests collected". Not run.)
- **Jest:** one test, `tests/orders.test.ts:193-199`. It calls `GET /orders/1042/price` as customer
  1 and asserts status 200 and `Number(res.body.total) === 1187.5`.
  - It converts the value to a number, so it cannot detect the string format (`"1187.5"` vs
    `"1187.50"`).
  - It does not check `net` or `vat`.
  - It does not cover discounts, truncation, unknown or expired codes, orders with no lines, or
    403/404/400/401 on the price endpoint. `docs/standard.md` (Tests: every endpoint has tests for
    the success case and for the 400, 401, 403 and 404 error cases where possible) requires those.
- The Jest tests reset `butik_test` before each test through `resetDb` (`tests/helpers/db.ts`).
  Python has no equivalent helper yet.
- `jobs/nightly_report.py` has no tests.

## Risks and Considerations

### Security

1. **SQL injection through `discount_code` (high).** `POST /orders` stores any string as
   `discountCode` (`orderService.ts:53`). `GET /orders/:id/price` then puts that string inside
   quotes in the SQL on `price_calc.py:42`. Any customer can therefore control that SQL. At the
   very least, a value like `x' OR '1'='1` would apply some discount to the order. The connection
   runs with `autocommit=True`.
   - **Assumption (to confirm in the psycopg docs):** psycopg 3 sends a query without parameters
     using the simple query protocol, which allows several statements in one call. If so, a
     stacked statement that writes or deletes data could run and be committed.
   - This was found by reading the code. It was not tried.
2. Lines 30 and 36 also use `%`-formatting. They are safe today only because both callers pass an
   `int`. `nightly_report.py:8` puts its `argv` date into the SQL the same way (only an operator can
   supply that value).
3. Hard-coded fallback credentials in `DATABASE_URL` (line 9). These are dev defaults, but
   `docs/standard.md` (Secrets and logs: no keys, passwords or tokens in the code) forbids them.
   The bridge passes the full `process.env` to the child process.
4. The log contains only order id, total and timestamp, with no personal data. Fine under the
   standard. The file grows without limit, and the bare `except` hides any write failure.

### Behavior that must be preserved or explicitly decided

- **Truncation**, as reconciled by finance (line 3). Changing it would change amounts.
- **Calculation order:** discount on the raw sum, then truncate net, then calculate VAT on the
  truncated net, then truncate VAT.
- **Output string format** (`"950"`, `"588.8"`). This violates the standard, but it is the current
  API contract. Switching to two-decimal strings is a visible API change. It is a small one, since
  the numeric values stay the same.
- **Expired codes apply, unknown codes are ignored, and status is ignored.** These may be bugs
  (user story 4 in `docs/user-stories.md:8` talks about a *valid* discount code), but the nightly
  totals and the reconciled figures may depend on them.
- **The nightly report's interface:** it imports `calc_price`, `Pris.total` and `conn`. Removing or
  renaming them breaks a cron job that runs outside this repository's test suite.

### Technical risks

- The connection opened at import time makes unit testing impossible without a database, and
  importing the module has side effects.
- **Test data safety.** `DATABASE_URL` falls back to the **dev** database `butik`. A pytest run
  without the right environment variable would read the dev database instead of `butik_test`.
  `scripts/db-reset.ts` resets both databases, so it is not a safe reset for Python tests.
  Resetting a database is a destructive operation and needs approval (CLAUDE.md, Security).
- Any Python failure is reported as 404, which hides infrastructure errors as "not found".
  Characterization tests must not mistake this for intended behavior.
- `JSON.parse` in the callback can crash the API process (tech-debt 0001).
- The bridge depends on whichever `python3` is on `PATH`. This makes tests depend on the
  environment.
- Duplicate logic. `docs/standard.md` (Money: all price calculation goes through `calcPrice` in
  `src/pricing/`, the logic is not duplicated) means a TypeScript port must not leave a second
  Python implementation behind for the nightly job.

### Edge cases to pin with tests

Orders with no lines; an unknown discount code; an expired code; percent 0, 100 and over 100; a
zero or negative quantity or price inserted directly (the schema allows them); amounts where
truncation and rounding give different results; large amounts close to `NUMERIC(10,2)` limits;
a nonexistent order id; a non-integer CLI argument.

## Recommended Approach

Characterize first, then refactor in small steps that keep behavior, and only then make deliberate
behavior changes, each with its own TDD step. Following CLAUDE.md (Testing Requirements), every
step writes or updates its tests first and runs them before the implementation changes.

**Phase 0: decisions (before any code).** Answer the Open Questions, especially the target end
state and whether the SQL injection is fixed first. Agree how Python tests get a safe, reset
`butik_test` database.

**Phase 1: characterization tests (no production code changes).**

1. Add `tests/test_price_calc.py`, collected by the existing `pytest.ini`. It calls the module
   **as a subprocess through the CLI**, just like the bridge does. This avoids the side effects at
   import time and pins the real contract.
   - Assert the exact stdout JSON strings and exit codes for seed orders 1040–1047 (the table
     above). The values the tests record must come from running them, not from this document.
   - Also cover a nonexistent id (`{"error": "finns inte"}`, exit code 1).
   - `DATABASE_URL` must point at `butik_test` explicitly, and the test should fail loudly if it
     does not.
2. Add targeted edge-case fixtures: insert extra orders and discounts into the test database (unknown
   code, percent 0/100/150, a truncation case with a different rounded result, a large amount).
   Pin the current behavior even where it looks wrong, and mark those tests as characterization of
   questionable behavior. Do not "fix" them in this phase.
3. Characterize `jobs/nightly_report.py` output for a fixed date (for example `2026-10-01` and
   `2026-10-05`) through a subprocess.
4. Extend Jest for `GET /orders/:id/price`: exact string bodies for a few orders, plus 401, 403
   (another customer's order), 404 and 400. Here only new tests are added. The existing test stays
   unchanged.
5. Run the new tests against the current code. They must **pass**. A characterization test that
   fails against current code is a wrong test, not a bug. Record the real results in a session
   log.

**Phase 2: refactorings that keep behavior (each step goes green against the Phase 1 suite).**

1. Extract a pure function, for example `compute_price(lines, percent) -> Pris`, holding the
   arithmetic and truncation. Add fast pytest unit tests that use no database. `calc_price` becomes
   a thin wrapper.
2. Make the connection lazy or injectable, while keeping a module-level `conn` (or updating
   `nightly_report.py` in the same step) so the job does not break.
3. Parameterize all queries (`cur.execute(sql, (value,))`). For normal input this keeps behavior.
   For malicious input it changes behavior, so add a test showing that a code containing a quote
   is treated as a literal (no discount). If the team prefers, this security fix can move ahead of
   Phase 2, right after Phase 1.
4. Remove the hard-coded credential fallback. Replace the bare `except`, keeping logging that
   never fails the calculation. Translate names and comments into English (CLAUDE.md, Coding
   Style). Fetch lines and discount in one query per the Database rules, and fix the N+1 in the
   nightly job.

**Phase 3: deliberate behavior changes (each one decided, given a test first, recorded).**

Candidates:

- two-decimal output strings (to follow the standard);
- respecting `valid_from` and `valid_to`;
- rejecting percent values outside 0–100;
- making the bridge tell "not found" apart from internal errors, and adding a timeout and safe JSON
  parsing. This overlaps with tech-debt 0001.

For each change, update the affected characterization test **as a justified behavior change**
(CLAUDE.md requires stating why). Truncation stays unless finance agrees otherwise.

**Phase 4 (optional): port to TypeScript.** If the decision is to retire Python, write an ADR in
`docs/adr/` first. Implement `calcPrice` natively in `src/pricing/` with exact decimal math, never
floats (`docs/standard.md`, Money). Run the Phase 1 golden values against both implementations
until they agree. Then move the nightly report to TypeScript, or make it call the TypeScript path,
so that no pricing logic is duplicated.

Recommended agents: `test-engineer` for Phase 1, `backend-developer` for the bridge and API changes,
`database-engineer` only if a `CHECK` constraint on `percent` is wanted, and `code-reviewer` after
each phase.

## Open Questions and Assumptions

### Open questions (need a decision from the user or team)

1. **Target end state:** refactor the Python in place, or port to TypeScript and retire Python?
   (The second needs an ADR.)
2. **SQL injection:** fix it right after characterization (recommended), or keep strict
   "refactor first, fix later" ordering?
3. **Output format:** keep `"950"` / `"588.8"`, or switch to two-decimal strings as
   `docs/standard.md` requires? This is an API change.
4. **Discount semantics:** should expired codes, unknown codes and cancelled orders keep today's
   behavior? Has finance reconciled against that behavior too, or only against truncation?
5. **Truncation:** confirm that it must stay exactly as it is (line 3 says so). Who at finance can
   confirm a change if one is ever wanted?
6. **Nightly job:** how is it deployed and run on the production server (Python version, `PATH`,
   environment)? Can it change at the same time as the module?
7. **Python test database:** how should pytest reset `butik_test` without touching the dev database?
   Options: a pytest fixture that runs `db/schema.sql`, the migrations and `db/seed.sql`, or calling
   the TypeScript `resetDatabase` only for the test URL. Each needs approval, because it is a
   database reset.

### Assumptions (not verified)

- psycopg 3 returns `NUMERIC` as `Decimal` with its scale kept, and `INTEGER` as `int`. The exact
  output strings in the behavior table depend on this.
- psycopg 3 allows several statements in one `execute` call when no parameters are passed (this
  affects how severe the injection is).
- pytest currently exits with code 5 because it collects no tests.
- The comment in `nightly_report.py` that it runs from cron on a production server is accurate.
  Nothing in this repository configures that cron job.

### Verified facts relied on above

All file and line references, the absence of Python tests, the single Jest price test, the
callers, and the truncation arithmetic and output strings (isolated check) were verified during
this research.
