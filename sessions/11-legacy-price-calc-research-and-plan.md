# Session 11 – Legacy Price Module: Research, ADR 0003 and Plan

**Date:** 2026-11-18
**Phase:** Research (`/research`), architectural decision (ADR 0003) and planning (`/plan`) for modernizing `src/legacy/price_calc.py`. No implementation.

## 1. Current state

**Status:** The research, ADR and plan are written. The plan is **Approved** (on explicit user approval) and the baseline checks are green. **Nothing is committed.** No source code, tests or configuration were changed. Step 1 of the plan has not started.

Files created in this session (all uncommitted):

- `docs/research/legacy-price-calc-modernization.md`: maps the module, its callers, the database access, tests, behavior, risks and the recommended strategy.
- `docs/adr/0003-legacy-price-calc-modernization.md`: status Accepted (2026-11-18).
- `docs/plans/legacy-price-calc-modernization.md`: 16 steps, status `Approved.`
- This session log.

Untracked files that already existed before this session and were not touched: `sessions/automatic/02-session-end.md`, `03-session-end.md`, `04-session-end.md`.

## 2. Work done

1. **Research.** Read `price_calc.py`, `legacyPrice.ts`, `orders.ts`, `nightly_report.py`, `schema.sql`, `seed.sql`, migration 0001, `orderService.ts`, the test helpers, `docs/standard.md`, `docs/api.md` and tech-debt 0001. Main findings:
   - **SQL injection:** a customer-controlled `discount_code` is put into SQL with `%`-formatting (`price_calc.py:42`).
   - **Truncation, not rounding,** in `_kapa`.
   - **Output strings without two decimals** (`"950"`, `"588.8"`), which conflicts with `docs/standard.md` (Money).
   - **Expired and unknown discount codes and order status are not checked,** and percentages over 100 give negative amounts.
   - **The connection is opened at import time,** with a hard-coded fallback URL.
   - **The bridge maps every failure to 404.**
   - **The nightly job imports the module's `conn`.**
   - **There are no Python tests,** and one Jest price test, which compares only `Number(total)`.
2. **ADR 0003.** The user asked to follow the research recommendations. Three of the questions (end state, output format, test-database reset) had no recommendation in the research. The main agent chose for them in the ADR and told the user so.
3. **Plan, first draft.** 14 steps.
4. **Plan, revised on user request.** The user's additions:
   - a codemap;
   - a clear split between characterization and TDD tests;
   - at least three separate refactoring steps;
   - the injection fix kept separate;
   - a database migration section;
   - a test-database safety section;
   - references to the research and to ADRs 0001 and 0003.

   The plan grew to 16 steps.
5. **User decisions** on the remaining open questions (see section 5), followed by explicit approval of the plan.
6. **Baseline checks** run (see section 3).

## 3. Evidence

### Isolated arithmetic check (research)

The `Decimal` arithmetic from `_kapa`/`calc_price` was copied into a scratchpad script with no database and no project imports. It was run with `.venv/bin/python -I`. The output was:

```
1040 ('899', '224.75', '1123.75')
1041 ('588.8', '147.2', '736.0')
1042 ('950', '237.5', '1187.5')
1043 ('0', '0', '0')
1044 ('179.91', '44.97', '224.88')
1045 ('551.65', '137.91', '689.56')
1046 ('899', '224.75', '1123.75')
1047 ('529', '132.25', '661.25')
pct150 ('-50', '-12.5', '-62.5')
trunc ('0.03', '0', '0.03')
```

`price_calc.py` itself was **not run**, because importing it connects to the database and running it appends to its log. Whether the real module produces exactly these strings depends on psycopg returning `NUMERIC` as `Decimal` with its scale kept. That is Assumption A1 in the plan, and step 2 will confirm it.

### Baseline checks (run by the main agent, one at a time, with `.venv` activated)

- The database container `ovningsprojekt-db-1` (postgres:16) was already running.
- `.venv` packages: `psycopg` 3.2.3, `psycopg-binary` 3.2.3, `pytest` 8.3.3, matching `requirements.txt`.
- `npm run lint`: passed, with no lint output. npm printed a notice that a new npm version is available.
- `npm run typecheck`: passed, no output.
- `npm run format:check`: passed. "All matched files use Prettier code style!"
- `npm test`: passed. 6 of 6 suites, 81 of 81 tests, 9.5 s.
- `npm run test:legacy`: "no tests ran in 0.01s", exit code **5**. This is expected, because no Python tests exist yet. It confirms the research assumption about the exit code.

Side effects of the baseline run:

- `npm test` reset `butik_test`, which is its normal behavior.
- The existing Jest price test appended a line to `src/legacy/price_calc.log`, which is gitignored.
- No command was run against the dev database `butik`.

## 4. What failed / problems

- **No check failed.** The `test:legacy` exit code 5 is expected (see section 3).
- **The research left three questions without a recommendation**: end state, output format and test-database reset. When the user said "go with your recommendations", the main agent had to make those recommendations in the ADR. It flagged them to the user afterwards.
- **The first plan draft was incomplete.** It had no codemap and no migration or test-database safety sections. It also described the characterization approach as a deviation from `/tdd` that needed approval. The user's revision request fixed this, and the user decided that characterization tests pass on their first run with no RED phase.
- **Conflict found with an existing test while planning migration 0002.** The 0001 reversibility test (`tests/migrations.test.ts:171-189`) calls `migrateDown` once. `migrateDown` reverts only the latest migration, so adding 0002 would make that test fail. The plan's step 13 includes a justified change to that test, which the user approved.
- **ADR file name mismatch.** The user's revision request referred to `docs/adr/0003-legacy-price-calculation-modernization.md`. The real file is `docs/adr/0003-legacy-price-calc-modernization.md`. The plan uses the real name, and the user was told.
- **The research document's Open Questions are now partly answered** by ADR 0003 and the plan. They were not updated, following the rule to explain before correcting a finished file. The user was offered a short note pointing to ADR 0003.

## 5. Decisions made

All by the user on 2026-11-18, following the main agent's recommendations.

**ADR 0003:**

- The module stays in Python and is refactored in place. A TypeScript port would need its own ADR.
- Characterization tests come first. They run the CLI as a subprocess, and Jest covers the endpoint.
- The SQL injection is fixed right after characterization.
- Truncation and calculation order are kept.
- Discount semantics are kept for now.
- Two-decimal output comes later, as its own step.
- Bridge error handling is a separate step, together with tech-debt 0001.
- Python tests run only against the test database, through `resetDatabase`, and never through `scripts/db-reset.ts`.

**Plan:**

- Characterization tests (steps 2–5) capture the current output and pass on their first run. No RED phase is introduced for them.
- The injection fix (step 6) is kept separate from the refactoring.
- There are four separate refactoring steps (7, 8, 11, 12), each gated on green tests, plus two small hardening steps (9, 10).
- Migration 0002, an index on `order_lines(order_id)`, is part of the plan, with no separate ADR.
- No `CHECK` constraint on `discounts.percent`, because it conflicts with decision 7.
- No foreign key. Its prerequisites are documented instead.
- Step 13 changes the existing 0001 reversibility test so that it reverts until 0001 is gone. Its assertions stay the same.
- Step 14 changes only the CLI/API output to two decimals. The nightly text is unchanged.
- Step 15 adds `internal_error` → 500 and a 10-second bridge timeout.
- The credential fallback in `src/db.ts:5` is out of scope and is to be recorded as tech debt.

## 6. What remains

- Commit the research, ADR 0003, the plan and this log.
- Run plan steps 1–16 one at a time with `/tdd docs/plans/legacy-price-calc-modernization.md <step>`, with a user review after each step. Start with step 1, the isolated Python test-database setup.
- Optional: add a note to the research document's Open Questions pointing to ADR 0003.
- Tech-debt note for the credential fallbacks in `src/db.ts:5` and the scripts. This is planned in step 16.

## 7. Resource usage

Not recorded. No usage dashboard figures were available to the main agent in this session. The user can add them.
