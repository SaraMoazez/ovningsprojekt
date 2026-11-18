# Session 12 – Isolated Python Test Database (Step 1), with Subagents

**Date:** 2026-11-18
**Phase:** Implementation of Step 1 of `docs/plans/legacy-price-calc-modernization.md` using the `/tdd` skill, coordinated by the main agent with three subagents.

## 1. Current state

**Status:** Step 1 is implemented and verified. It is **not committed** and is waiting for the user's review. Step 2 has not started.

Before work started, the main agent checked:

- that the plan status was `Approved.`;
- that the research, ADR 0003 and the plan were committed (`d085f62`);
- that the only untracked file was `sessions/11-legacy-price-calc-research-and-plan.md`.

What Step 1 delivers:

- **pytest can reset and use `butik_test`.**
- **The guards are in two layers:** a Python guard and a TypeScript guard. Each checks the name of the database that its own library would actually connect to, and it must end in `_test`.
- **Every subprocess gets an explicit environment.**
- **`scripts/db-reset.ts` was never used,** and no command was run against the dev database `butik`.

New files (all untracked):

- `scripts/reset-test-db.ts`: resets only the database in `TEST_DATABASE_URL` through `resetDatabase`. It has no default URL and never reads `DATABASE_URL`. It checks pg's resolved `client.database` before `connect()`.
- `tests/legacy_db.py`, with these helpers:
  - `resolve_test_database_url()`;
  - `require_test_database(url)`, which uses libpq's own parser `conninfo_to_dict`;
  - `guarded_test_database_url()`;
  - `child_env(**settings)`;
  - `reset_test_database()`;
  - `run_script(path, *args)`;
  - `run_sql(sql, params)`.
- `tests/conftest.py`: an autouse fixture that resets the test database before each Python test.
- `tests/test_legacy_db.py`: 18 tests, counting each parametrized case.
- `tests/fixtures/print_db_env.py`: a fixture script that prints the `DATABASE_URL` and the names of any `PG*` variables it received.

No production code, existing tests or configuration were changed.

## 2. Subagents invoked

| Order | Subagent | Task | Mode | Files changed |
|---|---|---|---|---|
| 1 (parallel with 2) | `database-engineer` | Review the test-database architecture, the reset script and the guards before implementation | Review only | None |
| 2 (parallel with 1) | `test-engineer` | Review the proposed `tests/test_legacy_db.py` before implementation | Review only | None |
| 3 | `code-reviewer` | Independent review of all Step 1 files after implementation | Review only. It was allowed to run only `pytest -q tests/test_legacy_db.py` | None |

The main agent wrote all the code. Before relying on the subagents' main claims, it checked them itself (see section 4 for one claim that turned out wrong).

### Findings and how they were used

**Database engineer.** No path to `butik` was found. Recommendations:

- Remove every `PG*` variable and `DATABASE_URL` from subprocess environments. **Adopted** as `child_env()`, which also removes `TEST_DATABASE_URL`, and covered by tests.
- Close `run_sql` connections, and add timeouts to subprocesses. **Adopted**: `with psycopg.connect(...)`, and `timeout=60`.
- Run the subprocesses from the repo root with absolute paths. **Adopted.**
- The reset script must import only `src/migrate`, never `src/db`, because `src/db` creates a Pool with the `butik` fallback. **Verified and followed.**
- Use English messages in the new script. **Followed.**
- `resetDatabase` doesn't clean up the `migration_fixture_*` tables that an interrupted Jest run leaves behind. These are harmless. **No action.**

**Test engineer.** Recommendations:

- Avoid helper names that start with `test_`. **Followed.**
- The reset-script test must check the guard's message and the absence of `ECONNREFUSED`, not only the exit code. **Adopted.**
- The seed-restore test must check its preconditions, that the delete and the extra row really took effect. **Adopted.**
- Test that the Python helpers refuse a non-test database before connecting. **Adopted** as a parametrized test covering all three helpers.
- Raise a specific error type, and treat URLs that can't be parsed as rejected. **Adopted** as `UnsafeDatabaseError`, which also wraps `ProgrammingError`.
- Parametrize the rejection cases. **Adopted.**
- Write a stub script first, so the reset-script RED isn't just "file missing". **Adopted** (see section 3, cycle 5).

**Code reviewer.** Verdict: **"approve with suggestions"**, with no Critical or High findings. It ran `pytest -q tests/test_legacy_db.py`: 18 passed. Findings and how they were handled:

1. *Medium:* the autouse fixture has no direct test. **Accepted as a known gap** (see section 6).
2. *Medium:* `run_sql` connects from the parent process. If a `TEST_DATABASE_URL` had no host, libpq could take `PGHOST`/`PGSERVICE` from the parent's environment. The database name is still guarded, so `butik` can't be reached. The risk is a `*_test` database on another host, which is the limitation the plan already accepts (Test Database Safety rule 7). `run_sql` also has no `connect_timeout`. **Not changed. Documented here and offered to the user as a test-first fix.**
3. *Low:* the test that replaces `subprocess.run` affects the whole process. **Addressed** with a comment explaining why it is safe. Nothing else changed, and pytest still passes 18 of 18.
4. *Low:* the asymmetry between the two parsers, the duplicated default URL, and the "before connecting" proxy. **No action**; the reviewer agreed that none is needed.

## 3. Evidence

### RED → GREEN → REFACTOR (all runs by the main agent, with `.venv` activated)

| # | Behavior | RED (observed) | GREEN |
|---|---|---|---|
| 1 | The guard rejects `…/butik` | `ModuleNotFoundError: No module named 'legacy_db'` | A stub that always raises → 1 passed |
| 2 | The guard accepts `…/butik_test` | `UnsafeDatabaseError` from the always-raise stub | A naive `url.endswith("_test")` → 2 passed |
| 3 | The guard checks the effective name. 6 cases: `?dbname=butik`, `_test` only in a query value, a keyword DSN, an empty path, a name that is only `_test`, a string that isn't a connection string | 4 cases `DID NOT RAISE` against the naive check. 2 cases already rejected, kept as regression tests | `conninfo_to_dict`, which rejects empty names, suffix-only names and parse errors → 8 passed |
| 4 | The test URL defaults to `butik_test` and ignores `DATABASE_URL` | `ImportError: cannot import name 'resolve_test_database_url'` | 9 passed |
| 5 | The reset script refuses a non-test database before connecting | First the script was missing (`ERR_MODULE_NOT_FOUND`). Then a stub with no guard gave `connect ECONNREFUSED 127.0.0.1:1`, a proper RED | A guard on `client.database` before `connect()` → 10 passed, 1 failed (see section 4), then 11 passed after the test case was corrected |
| 6 | The reset script requires `TEST_DATABASE_URL` and ignores `DATABASE_URL` | stderr: `Refusing to reset database "sara"…` instead of a message naming the variable | An explicit check → 12 passed |
| 7 | Reset restores seed data: order 1042's lines come back, and an extra `STRAY` discount is gone. The test checks first that the delete and insert took effect | `ImportError: cannot import name 'reset_test_database'` | `reset_test_database` and `run_sql` → 13 passed |
| 8 | `reset_test_database` and `run_sql` refuse a non-test database before any subprocess or connection | `CalledProcessError` (the subprocess was started) and `OperationalError … Connection refused` (a connection was attempted) | `guarded_test_database_url()` → 15 passed |
| 9 | `run_script` passes the test URL and no inherited `PG*` variables or `DATABASE_URL` | `ImportError: cannot import name 'run_script'` | 16 passed |
| 10 | `run_script` refuses a non-test database | `DID NOT RAISE` | Use the guarded URL → 17 passed |
| 11 | The reset subprocess gets only `TEST_DATABASE_URL`, with no `PG*` variables or `DATABASE_URL` | `AssertionError: 'DATABASE_URL' not in {…}` | `child_env()`, shared by both subprocess helpers → 18 passed |

Before cycle 7, the main agent checked the shell environment, masking credentials: `TEST_DATABASE_URL` was not set, and there were no `PG*` or `DATABASE_URL` variables. So the default `butik_test` was the target.

**Conftest wiring**, with no RED: `pytest --setup-show` shows `SETUP F reset_test_db` before each test, and 18 passed in 4.18 s.

**REFACTOR:**

- the test file reuses `REPO_ROOT`, `TSX`, `RESET_SCRIPT` and `child_env` from `legacy_db`;
- two assertions now compare against `resolve_test_database_url()` instead of the hard-coded default, so they also work when `TEST_DATABASE_URL` is set;
- `_child_env` was renamed to `child_env`, because the tests use it.

18 passed after each change.

### Final verification (one command at a time)

- `npm run lint`: passed, no output.
- `npm run typecheck`: passed, no output. This also covers `scripts/` through `tsconfig.json`.
- `npm run format:check`: passed. "All matched files use Prettier code style!"
- `npx eslint scripts/reset-test-db.ts` and `npx prettier --check scripts/reset-test-db.ts`: both passed. They were run separately, because `lint` and `format:check` do not cover `scripts/`.
- `npm test`: passed. 6 of 6 suites, 81 of 81 tests (10.1 s).
- `npm run test:legacy`: 18 passed (4.15 s), exit code 0. After the comment change from code review finding 3, it was run again: 18 passed (4.08 s), exit code 0.
- No warnings were reported.

## 4. What failed / problems

- **A wrong assumption in a test case (main agent).** Cycle 5 first included `…/butik_test?database=butik`. The assumption was that pg lets `?database=` override the path, as libpq does with `?dbname=`. The test-engineer's report repeated this. But pg ignores the parameter: `new Client(...).database` gave `butik_test`. So the guard correctly let it through, and the test failed with `ECONNREFUSED`. The main agent had already seen this in an earlier probe (`…/butik?database=butik_test` gave `butik`) and misread it. The case was replaced by an empty-path URL, which pg resolves to the user name `postgres`. That replacement case was not run against the unguarded stub. By reasoning, it would fail there the same way the `/butik` case did.
- **A misleading comment was found while presenting the results.** `scripts/reset-test-db.ts` said pg resolves the name "(including ?database=)", which is the same wrong assumption as above. Only the comment was corrected. Afterwards eslint and prettier on the script passed, `npm run typecheck` exited 0, and `npm run test:legacy` passed 18 of 18 with exit code 0.
- **The first RED in cycle 5 had a weak reason** (the script file didn't exist yet). An unguarded stub was written to get a meaningful RED.
- No check failed in the final verification.

## 5. Decisions made, and deviations from the plan

All of these were reviewed by the code reviewer, which called them "justified".

1. **Helper names.** The plan's `test_database_url()` became `resolve_test_database_url()`, because pytest would collect an imported `test_*` function as a test. The plan's `insert_fixture()` became `run_sql()`, because it is also used for `DELETE` and `SELECT`. `guarded_test_database_url()` and `child_env()` were added.
2. **`scripts/reset-test-db.ts` has no default `TEST_DATABASE_URL`.** The plan said it would default to the `tests/helpers/env.ts` URL. Python always passes the URL, and leaving out the default avoids another hard-coded credential URL.
3. **The reset runs `node_modules/.bin/tsx`, not `npx tsx`.** This avoids any download fallback, and the script never loads `.env`.
4. **All subprocesses get a stripped environment**: no `PG*`, `DATABASE_URL` or `TEST_DATABASE_URL`, then only the guarded value. The plan only said to "pass `DATABASE_URL` set to the test URL".
5. **Each guard uses its own library's parser.** ADR 0003 decision 9 says the test setup checks `DATABASE_URL`. The implementation guards the resolved test URL and *overwrites* `DATABASE_URL` in every subprocess. That has the same intent, with `TEST_DATABASE_URL` as the source.
6. **The conftest fixture has no dedicated test** (see section 6).

## 6. What remains

- User review of Step 1, then a commit.
- **Code review finding 2 was accepted as documented** (user decision, 2026-11-18). `run_sql` can follow the parent's `PG*` settings when the URL has no host, and it has no `connect_timeout`. The database name is still guarded. No code change.
- **Known gap:** there is no direct test that the autouse fixture resets before each test. It was checked only with `--setup-show`.
- **Side effect for later steps:** every Python test now needs the Docker database, and `npm run test:legacy` fails fast if it is down. The suite also takes about 0.2 s per test for the reset.
- Steps 2–16 of the plan.

## 7. Resource usage

Not recorded. No usage dashboard figures were available to the main agent. The user can add them.
