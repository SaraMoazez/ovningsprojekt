# Session 13 – CLI Characterization for Seed Orders (Step 2), with Subagents

**Date:** 2026-11-18
**Phase:** Implementation of Step 2 of `docs/plans/legacy-price-calc-modernization.md` using the `/tdd` skill. These are characterization tests, so there is no RED phase (user decision, 2026-11-18).

## 1. Current state

**Status:** Step 2 is implemented and verified. It is **not committed** and is waiting for the user's review. Step 3 has not started.

Before work started, the main agent checked:

- that the plan status was `Approved.`;
- that the working tree was clean;
- that Step 1 was committed (`f7a1172`).

New file (untracked): `tests/test_price_calc.py`, with 10 tests (8 of them parametrized). **No production code, existing tests or configuration were changed.** The code reviewer confirmed this with `git status` and an empty `git diff HEAD --stat`.

| Test | Verifies |
|---|---|
| `test_prints_the_price_of_a_seed_order[order-1040 … order-1047]` | The exact `(returncode, stdout, stderr)` = `(0, <captured JSON line>, "")` for each seed order. The full string is compared, including key order, separators, the string values and the trailing newline. |
| `test_reports_a_missing_order_and_exits_with_1` | `999999` gives exactly `(1, '{"error": "finns inte"}\n', "")`. |
| `test_exits_non_zero_for_a_non_integer_order_id` | `abc` gives a non-zero exit code and empty stdout. Only the exit code is pinned, as the plan says. |

The tests use only the Step 1 infrastructure:

- `run_script`, which passes only the guarded `butik_test` URL;
- the autouse reset in `tests/conftest.py`.

There is no direct database access, and `scripts/db-reset.ts` was not used.

## 2. Subagents invoked

| Order | Subagent | Task | Mode | Files changed |
|---|---|---|---|---|
| 1 | `test-engineer` | Review the planned characterization tests and work out the expected CLI behavior from the code | Review only, with no DB access | None |
| 2 | `code-reviewer` | Independent review after implementation | Review only. It was allowed to run only `pytest -v tests/test_price_calc.py` | None |

**Test engineer**, working from the code only, without running anything. Recommendations:

- Compare the exact stdout string including the `\n`, not `json.loads`. That pins key order, separators and string types. **Adopted.**
- Compare `(returncode, stdout, stderr)` as one tuple, and require `stderr == ""` on success and for `999999`. **Adopted.**
- Use readable parametrize ids. **Adopted.**
- For `abc`, pin `!= 0`, not `== 1`, as the plan says, and also check `stdout == ""`. **Adopted.**
- For `abc`, optionally check that `"ValueError"` appears in stderr. **Not adopted**, because the plan pins only the exit code. A comment instead explains that the seed-order tests in the same file show the database connection works.
- Its hand-derived values (588.8 / 147.2 / 736.0 for 1041, 0 / 0 / 0 for 1043, and so on) matched the capture.
- Its scope list (no log, no edge cases, no injection, no nightly, no Jest) was followed.

**Code reviewer.** Verdict: **"Approved. No Critical, High or Medium findings."**

- It ran `pytest -v tests/test_price_calc.py`: 10 passed.
- It confirmed that the expected strings match the research table character for character.
- It checked every comment against the code and `db/seed.sql`. All were accurate.
- Low finding 1: the docstring's "950 vs 950.00" text will go stale at Step 14. **Recorded for Step 14** (see section 6). No change now.
- Low finding 2: the `abc` test is weak by design. **No change**, as the plan intends.

## 3. Evidence

### Raw capture (characterization procedure, step 1)

`butik_test` was reset with `legacy_db.reset_test_database()`. Then each argument was run with `legacy_db.run_script(src/legacy/price_calc.py, arg)`, using `.venv` Python:

```
1040: rc=0 stdout='{"net": "899", "vat": "224.75", "total": "1123.75"}\n' stderr_tail=''
1041: rc=0 stdout='{"net": "588.8", "vat": "147.2", "total": "736.0"}\n' stderr_tail=''
1042: rc=0 stdout='{"net": "950", "vat": "237.5", "total": "1187.5"}\n' stderr_tail=''
1043: rc=0 stdout='{"net": "0", "vat": "0", "total": "0"}\n' stderr_tail=''
1044: rc=0 stdout='{"net": "179.91", "vat": "44.97", "total": "224.88"}\n' stderr_tail=''
1045: rc=0 stdout='{"net": "551.65", "vat": "137.91", "total": "689.56"}\n' stderr_tail=''
1046: rc=0 stdout='{"net": "899", "vat": "224.75", "total": "1123.75"}\n' stderr_tail=''
1047: rc=0 stdout='{"net": "529", "vat": "132.25", "total": "661.25"}\n' stderr_tail=''
999999: rc=1 stdout='{"error": "finns inte"}\n' stderr_tail=''
abc: rc=1 stdout='' stderr_tail="ValueError: invalid literal for int() with base 10: 'abc'"
```

**Cross-check against the research table:** all 8 seed orders match exactly. This confirms the plan's Assumption **A1**: psycopg 3 returns `NUMERIC(10,2)` as `Decimal` with the scale kept, and `INTEGER` as `int`. The isolated `Decimal` re-implementation in the research gives the same strings as the real module.

### Characterization runs

These are the first runs of the new tests, against the unchanged module.

- `pytest -v tests/test_price_calc.py`: **10 passed** in 3.67 s, all on the first run, as the plan expects for characterization tests.

### Final verification (one command at a time, with `.venv` activated)

- `npm run lint`: passed, exit code 0.
- `npm run typecheck`: passed, exit code 0.
- `npm run format:check`: passed. "All matched files use Prettier code style!", exit code 0.
- `npm test`: passed. 6 of 6 suites, 81 of 81 tests (10.6 s).
- `npm run test:legacy`: **28 passed** (18 from Step 1 and 10 new) in 8.21 s, exit code 0.
- No warnings were reported.

Side effect: each successful price run appends a line to `src/legacy/price_calc.log`, which is gitignored. The `999999` and `abc` cases write nothing. No command was run against the dev database `butik`.

## 4. What failed / problems

- **No test or check failed.**
- **Minor:** the first lint run used `${PIPESTATUS[0]}`, which zsh doesn't support, so no exit code was shown. Lint was run again without a pipe and exited 0.

## 5. Decisions made, and deviations from the plan

- **Actual behavior matched the plan and the research.** There were no discrepancies to document.
- **Slightly stronger than the plan text:** the plan asks for "exact stdout JSON and exit code". The tests also require empty stderr on success and for `999999`, and empty stdout for `abc`. This is still characterization, because it is true today. The code reviewer accepted it, but noted that later refactoring steps must keep stderr empty.
- **The `abc` test pins only `!= 0`**, as the plan says, even though the capture showed exactly 1.

## 6. What remains

- User review of Step 2, then a commit.
- **For Step 14** (two-decimal output): update the module docstring of `tests/test_price_calc.py` along with the expected strings, because it cites `"950"` vs `"950.00"` (code review Low finding 1).
- **For Steps 7–12** (refactoring): stderr must stay empty on success and for a missing order, or these tests will fail.
- Steps 3–16 of the plan. Step 3 is the CLI edge cases and the log line.

## 7. Resource usage

Not recorded. No usage dashboard figures were available to the main agent. The user can add them.
