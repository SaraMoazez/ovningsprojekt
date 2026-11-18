# Session 14 – CLI Edge-Case Characterization (Step 3)

**Date:** 2026-11-18
**Phase:** Implementation of Step 3 of `docs/plans/legacy-price-calc-modernization.md` using the `/tdd` skill. These are characterization tests, so there is no RED phase (user decision, 2026-11-18). No subagents were used, because the user did not ask for them in this step.

## 1. Current state

**Status:** Step 3 is implemented and verified. It is **not committed** and is waiting for the user's review. Step 4 has not started.

Before work started, the main agent checked that the plan status was `Approved.` and that Step 1 was committed (`f7a1172`). Step 2 (`tests/test_price_calc.py` and `sessions/13-…`) was **staged but not committed**. Step 3's changes are unstaged changes on top of it.

Changed file: `tests/test_price_calc.py`, with 9 new test functions, two fixture helpers (`create_discount`, `create_order`), a `PRICE_LOG` constant, and a docstring now saying "plan steps 2 and 3". **No production code, other tests or configuration were changed.**

| Test | Verifies (current behavior) |
|---|---|
| `test_an_unknown_discount_code_is_ignored` | An order with code `NOSUCH` is priced with no discount: `100` / `25` / `125`. *Pins questionable behavior (ADR 0003 decision 7).* |
| `test_a_zero_percent_discount_changes_nothing` | A 0 % discount gives `100` / `25` / `125`. |
| `test_a_hundred_percent_discount_makes_the_order_free` | A 100 % discount gives `0` / `0` / `0`. |
| `test_a_discount_over_a_hundred_percent_gives_negative_amounts` | A 150 % discount gives `-50` / `-12.5` / `-62.5`. *Questionable (decision 7).* |
| `test_an_expired_discount_code_still_applies` | `OLD2020` (10 %, valid during 2020) still applies: `90` / `22.5` / `112.5`. *Questionable (decision 7).* |
| `test_vat_is_truncated_not_rounded` | 10.03 gives a VAT of 2.5075, which is truncated to `"2.5"`. Rounding would give 2.51. |
| `test_large_amounts_over_several_lines_stay_exact` | 3 lines of 99,999,999.99 (the `NUMERIC(10,2)` maximum) give `299999999.97` / `74999999.99` / `374999999.96`. |
| `test_a_zero_quantity_line_costs_nothing` | A line with quantity 0 gives `0` / `0` / `0`. |
| `test_a_successful_calculation_appends_one_log_line` | Pricing order 1042 appends exactly one line, `<ISO timestamp> 1042 1187.5`, to `src/legacy/price_calc.log`. Earlier content is kept. The timestamp is checked only as parseable ISO. |

The fixtures are inserted through the Step 1 helper `run_sql`, which is guarded and parameterized, always the order row before its lines. They use order ids 3001–3008, far from the seed ids. The autouse reset removes them before the next test. No discount code containing a quote is used; that input belongs to Step 6.

## 2. Evidence

### Raw capture (characterization procedure)

`butik_test` was reset with `legacy_db.reset_test_database()`. The fixtures were inserted with `run_sql`, and each order was run with `run_script(src/legacy/price_calc.py, id)`:

```
3001 (0, '{"net": "100", "vat": "25", "total": "125"}\n', '')
3002 (0, '{"net": "100", "vat": "25", "total": "125"}\n', '')
3003 (0, '{"net": "0", "vat": "0", "total": "0"}\n', '')
3004 (0, '{"net": "-50", "vat": "-12.5", "total": "-62.5"}\n', '')
3005 (0, '{"net": "90", "vat": "22.5", "total": "112.5"}\n', '')
3006 (0, '{"net": "10.03", "vat": "2.5", "total": "12.53"}\n', '')
3007 (0, '{"net": "299999999.97", "vat": "74999999.99", "total": "374999999.96"}\n', '')
3008 (0, '{"net": "0", "vat": "0", "total": "0"}\n', '')
log exists before: True
rc 0 new log content: '2026-11-18T23:37:21.612459 1042 1187.5\n'
```

**Cross-check:**

- The 150 % case matches the research table's `pct150` row exactly.
- The other values were checked by hand against the arithmetic in `price_calc.py`:
  - discount on the raw sum, then truncate the net, then 25 % VAT on the truncated net, then truncate the VAT;
  - 10.03 × 25 / 100 = 2.5075, which truncates to 2.50;
  - 299,999,999.97 × 25 / 100 = 74,999,999.9925, which truncates to 74,999,999.99.
- No discrepancy was found.

### Characterization run

- `pytest -v tests/test_price_calc.py`: **19 passed** in 7.65 s (10 from Step 2 and 9 new), all on the first run against the unchanged module.

### Final verification (one command at a time, with `.venv` activated)

- `npm run lint`: exit code 0.
- `npm run typecheck`: exit code 0.
- `npm run format:check`: "All matched files use Prettier code style!", exit code 0.
- `npm test`: 6 of 6 suites, 81 of 81 tests (10.8 s).
- `npm run test:legacy`: **37 passed** in 11.05 s, exit code 0.
- `git diff --stat`: only `tests/test_price_calc.py` (114 insertions, 2 deletions; the deletions are the docstring line and the import line that changed).
- No warnings were reported. No command was run against the dev database `butik`.

## 3. What failed / problems

No test or check failed.

## 4. Decisions made, and deviations from the plan

- **"A cancelled order" is not added as a separate test.** Step 2 already pins it: seed order 1046 has status `cancelled` and is priced like 1040 (`test_prints_the_price_of_a_seed_order[order-1046]`). A fixture would only duplicate that.
- **The plan's helper name `insert_fixture` is not used.** As decided in Step 1, the guarded `run_sql` is used, wrapped by two local helpers that make the fixtures readable.
- **The "questionable" comment** ("pins current behavior, see ADR 0003 decision 7") is on the three cases that ADR decision 7 keeps on purpose: an unknown code, over 100 %, and an expired code. The 0 %, 100 %, truncation, large-amount and zero-quantity cases are documented behavior, not questionable, so they don't carry the comment.
- **The log test checks the id and the total**, as the plan says, and only that the timestamp parses, not its value.
- **The log test reads `src/legacy/price_calc.log`**, which is gitignored and grows with each test run. This is accepted as existing behavior (plan, Risks).

## 5. What remains

- User review of Step 3, then a commit. Step 2 is staged but not yet committed.
- Steps 4–16 of the plan. To meet the course requirements, the user was offered a minimum path: Step 4 (nightly characterization) and refactoring steps 7, 8 and 11, plus Step 6 as recommended. With Step 3 done, there are now 12 separate characterization test functions, 19 cases with the parametrized ones counted separately.
- For Step 14: the docstring and the expected strings in this file will change (see session 13).

## 6. Resource usage

Not recorded. No usage dashboard figures were available to the main agent. The user can add them.
