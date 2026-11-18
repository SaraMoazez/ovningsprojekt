# Session 16 – Price Endpoint Characterization (Step 5)

**Date:** 2026-11-18
**Phase:** Implementation of Step 5 of `docs/plans/legacy-price-calc-modernization.md` using the `/tdd` skill. These are characterization tests, so there is no RED phase (user decision, 2026-11-18). No subagents were used, because the user did not ask for them in this step.

## 1. Current state

**Status:** Step 5 is implemented and verified. It is **not committed** and is waiting for the user's review. Step 6 has not started.

Before work started, the main agent checked:

- that the plan status was `Approved.`;
- that the working tree was clean;
- that Steps 1–4 were committed (`f7a1172`, `286bbcd`, `22e2a40`).

The user had asked whether Step 5 could be skipped, and was told that it was not required for Steps 6–12. The user then chose to run it anyway.

**Changed file:** `tests/orders.test.ts`. It gains 7 new tests in the existing `describe("GET /orders/:id/price")` block: 3 from an `it.each` and 4 single tests. **The existing test `räknar pris med moms via den äldre modulen` is unchanged.** No production code or configuration was changed.

| Test | Verifies (exact status and body) |
|---|---|
| `returns the exact price body for order 1042` (customer 1) | 200, `{ net: "950", vat: "237.5", total: "1187.5" }` |
| `… for order 1041` (customer 2, SOMMAR20) | 200, `{ net: "588.8", vat: "147.2", total: "736.0" }` |
| `… for order 1044` (customer 4, VAR10, truncated VAT) | 200, `{ net: "179.91", vat: "44.97", total: "224.88" }` |
| `returns 401 without X-Customer-Id` | 401, `{ error: { code: "unauthorized", message: "Logga in först." } }` |
| `returns 403 for another customer's order` (1042 as customer 2) | 403, `{ error: { code: "forbidden", message: "Beställningen tillhör en annan kund." } }` |
| `returns 404 for an order that does not exist` (9999) | 404, `{ error: { code: "not_found", message: "Beställning 9999 finns inte." } }` |
| `returns 400 for an id that is not a positive integer` (`abc`) | 400, `{ error: { code: "invalid_input", message: "Ogiltigt id." } }` |

Read in the code: 401 comes from `requireCustomer` (`src/auth.ts`). 400 comes from `parseId`, and 403 and 404 from `getOrder`, all **before** the bridge is called (`src/routes/orders.ts:35-47`). Only the 200 cases reach `price_calc.py`.

## 2. Evidence

### Raw capture (characterization procedure)

`butik_test` was reset with `legacy_db.reset_test_database()`. Then the real API was started with `node_modules/.bin/tsx src/server.ts`, with `PORT=3999` and an environment from `child_env(DATABASE_URL=<guarded butik_test URL>)`, so no `PG*` variables and no dev `DATABASE_URL`. It was queried with Python `urllib` and stopped afterwards:

```
/orders/1042/price customer 1 -> 200 {"net":"950","vat":"237.5","total":"1187.5"}
/orders/1041/price customer 2 -> 200 {"net":"588.8","vat":"147.2","total":"736.0"}
/orders/1044/price customer 4 -> 200 {"net":"179.91","vat":"44.97","total":"224.88"}
/orders/1042/price customer None -> 401 {"error":{"code":"unauthorized","message":"Logga in först."}}
/orders/1042/price customer 2 -> 403 {"error":{"code":"forbidden","message":"Beställningen tillhör en annan kund."}}
/orders/9999/price customer 1 -> 404 {"error":{"code":"not_found","message":"Beställning 9999 finns inte."}}
/orders/abc/price customer 1 -> 400 {"error":{"code":"invalid_input","message":"Ogiltigt id."}}
```

**Cross-check:** the three 200 bodies equal the Step 2 CLI output for the same orders. The bridge passes the parsed stdout through unchanged. The error bodies match the messages in `src/auth.ts`, `src/routes/orders.ts` and `getOrder` in `src/services/orderService.ts`.

### Runs

- **Characterization:** `npx jest --runInBand tests/orders.test.ts -t "GET /orders/:id/price"` gave **8 passed** (7 new and the existing test) on the first run against the unchanged code. The 19 "skipped" tests were only filtered out by `-t`; no skip markers were added.

### Final verification (one command at a time, with `.venv` activated)

- `npm run lint`: exit code 0.
- `npm run typecheck`: exit code 0.
- `npm run format:check`: "All matched files use Prettier code style!", exit code 0.
- `npm test`: 6 of 6 suites, **88 of 88** tests (81 + 7 new, 10.7 s).
- `npm run test:legacy`: 41 passed in 12.23 s, exit code 0.
- No warnings were reported. No command was run against the dev database `butik`.

## 3. What failed / problems

- **No test or check failed.**
- **A wrong comment was corrected before verification.** The first version said "(plan step 2 of … step 5)". It now says "(step 5 of docs/plans/legacy-price-calc-modernization.md)".

## 4. Decisions made, and deviations from the plan

- **The new test names are in English**, following CLAUDE.md (Coding Style). The older tests in the file have Swedish names, and they were left as they are.
- **The error tests compare the full error body,** not just the status. This is stronger than the plan's list of status codes, but it is still characterization, because it is true today.
- **The capture used a running server, not Jest,** so that the expected values came from real responses before any test was written.
- **The test server ran on port 3999 against `butik_test` only** and was terminated afterwards.

## 5. What remains

- User review of Step 5, then a commit.
- **For Step 14:** the three 200 bodies here get two-decimal strings, as planned.
- **For Step 15:** these tests are the safety net for the bridge.
- **Course minimum:** the refactoring steps 7, 8 and 11 (R1–R3), with Step 6 (SQL injection fix) recommended before them.
- **Counts:** there are now 23 characterization tests across Python and Jest, counted as separate test functions plus the Jest tests added here.

## 6. Overall status of the modernization work: what was not done, and why

This section covers the whole legacy price modernization (sessions 11–16), not only Step 5.

### Why the work stops here

- **The course assignment does not require the work to be finished.** It says that the parts do not have to be completed. What is assessed is that the rig is used and that it can be shown what it did. Anything not done is to be written in the session log, with the reason.
- **The remaining steps were not reached in the time available** (the user's statement, 2026-11-18).
- **The work was spent on using the rig from start to end**, with each step checked: research, then an ADR, then an approved plan, then `/tdd` steps with subagents, green checks and one commit per step. Building the characterization safety net came before changing any production code, which is the order the plan and ADR 0003 require.

### Done

| Part | Rig used | Result | Commit |
|---|---|---|---|
| Research | `/research` skill | `docs/research/legacy-price-calc-modernization.md` | `d085f62` |
| Decisions | ADR (written from the user's decisions) | `docs/adr/0003-legacy-price-calc-modernization.md` | `d085f62` |
| Plan | `/plan` skill; revised on the user's request; approved | `docs/plans/legacy-price-calc-modernization.md`, including the **codemap** and the **database migration plan** | `d085f62` |
| Step 1: isolated Python test database | `/tdd`; `database-engineer`, `test-engineer` and `code-reviewer` subagents | 18 tests, guards in Python and TypeScript, 11 RED → GREEN cycles | `f7a1172` |
| Steps 2–3: CLI characterization | `/tdd`; `test-engineer` and `code-reviewer` (Step 2) | 19 tests (12 functions) | `286bbcd` |
| Step 4: nightly report characterization | `/tdd` | 4 tests, plus a shared fixture helper | `22e2a40` |
| Step 5: price endpoint characterization | `/tdd` | 7 Jest tests | **Not yet committed** |

At the end of Step 5: Jest passes 88 of 88, pytest passes 41 of 41, and lint, typecheck and format all pass.

### Not done

| Plan step | What it would do | Consequence of not doing it |
|---|---|---|
| **6** SQL injection fix | Parameterize the SQL in `price_calc.py` and `nightly_report.py` | **The customer-reachable SQL injection in `src/legacy/price_calc.py:42` is still in the code.** It is the most important open item. ADR 0003 decision 3 says it is fixed right after characterization, so this is an open deviation from the ADR. |
| **7, 8, 11, 12** Refactoring R1–R4 | A pure `compute_price`, a lazy connection, English names, fewer queries | **The course item "at least three small refactoring steps, with green tests after each" is not met in code.** The steps are planned in detail and ready to run with `/tdd`, and the safety net they depend on (Steps 2–5) is in place. |
| **9, 10** Hardening | Remove the credential fallback, narrow the `except` | The module still connects to `butik` if `DATABASE_URL` is missing, and the bare `except` still hides errors. |
| **13** Migration 0002 | Add an index on `order_lines(order_id)` as a reversible migration | The migration is **planned** (Database Migration Plan section in the plan, with up/down, prerequisites and rollback) but not written or run. |
| **14** Two-decimal output | `"950"` → `"950.00"` | The API still breaks `docs/standard.md` (Money). |
| **15** Bridge error handling | Tell not-found apart from internal errors; add a timeout | Every Python failure is still reported as 404. |
| **16** Documentation and tech debt | Update `docs/api.md`; add a tech-debt note for the credential fallbacks | Not written. |

### Other open items

- **The expand/contract migration plan is only in the conversation.** It was described on 2026-11-18: index, then the foreign key as `NOT VALID`, then the orphan cleanup, then `VALIDATE`, then removing the archive table, with which steps can be rolled back. It was not saved to a file. The plan file has the earlier version: the index migration, plus the prerequisites for the foreign key.
- **Step 5 is not committed.**
- **The research document's Open Questions** are not annotated with a pointer to ADR 0003.
- **The session 11 log says "Nothing is committed"**, but its documents were committed in `d085f62`.
- **Step 1 code review finding 2 was accepted as documented** (user decision): `run_sql` can follow the parent's `PG*` host settings. The database name is still guarded.

### How to continue

Run the next steps one at a time with `/tdd docs/plans/legacy-price-calc-modernization.md <step>`: first 6, then 7, 8 and 11. Commit after each step, with all checks green. The plan is still `Approved.`, and none of its content was changed.

## 7. Resource usage

Not recorded. No usage dashboard figures were available to the main agent. The user can add them.
