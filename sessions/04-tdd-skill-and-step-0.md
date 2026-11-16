# Session 04 – TDD Skill and Step 0

**Date:** 2026-11-16
**Phase:** TDD skill development and first implementation plan step

## 1. Current state

The `/tdd` skill has been created and tested as part of the Claude Code agent rig.

The approved implementation plan `docs/plans/idempotent-order-retry.md` has reached Step 0, which focuses on documenting architectural decisions through ADRs.

Two ADRs have been created:

- `docs/adr/0001-sql-migrations-with-in-house-runner.md`
- `docs/adr/0002-idempotency-key-on-orders.md`

Both ADRs were reviewed, revised and formally accepted by the user on 2026-11-16.

No application source code or existing tests were modified during Step 0.

## 2. What worked

- The `/tdd` skill successfully located and used the approved implementation plan.
- The skill followed the documentation-only scope of Step 0. No RED-GREEN-REFACTOR cycle was needed because no application behavior was implemented.
- Two ADRs were created based on the implementation plan and research document.
- Initially, the verification commands were not run individually. After explicitly asking Claude to execute each command separately and review its output before proceeding, the checks were rerun individually.
- Updated `CLAUDE.md` afterwards to make running verification commands one at a time a mandatory project-wide instruction, ensuring consistent behavior in future sessions and for all team members.
- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm run format:check` passed.
- The review identified that Python commands were using the system Python instead of the project's virtual environment.
- After activating `.venv`, `npm test` passed with all 16 tests passing, including the previously failing legacy price calculation test.
- Verified that `pytest` is available through the project's `.venv`.
- `npm run test:legacy` executed using the project's `.venv`, but no Python tests were collected (exit code 5).

## 3. What failed

The initial verification revealed two Python environment-related issues:

- `npm test`: 1 test failed and 15 passed. The failing test was `GET /orders/:id/price`, which returned 404 instead of the expected 200.
- `npm run test:legacy`: failed with exit code 127 because `pytest` was not found.

The investigation identified a Python environment configuration issue:

- The legacy price calculation script uses `python3` from PATH.
- The system Python was Homebrew Python 3.15, which did not have `psycopg` installed.
- The project's `.venv` uses Python 3.12 and contains `psycopg` 3.2.3.
- The legacy test command could not find `pytest` because the virtual environment was not activated.

**Preventive changes:**
- Updated `CLAUDE.md` with a dedicated Python Virtual Environment section, requiring the use of the project's `.venv` for Python-related commands.
- Updated `.claude/skills/tdd/SKILL.md` to explicitly instruct the agent to activate `.venv` before running Python-related commands.

These changes are intended to prevent the same environment issue from recurring in future development tasks.

## 4. What remains

- Proceed to Step 1 of the approved implementation plan.

## 5. Decisions made

- Step 0 is documentation-only and does not require a RED-GREEN-REFACTOR cycle.
- Significant architectural decisions are documented in separate ADR files under `docs/adr/`.
- ADRs remain Proposed until reviewed and accepted by the user.
- The project must use its own `.venv` for Python-related commands instead of relying on system Python.
- Existing test failures must be investigated and documented rather than bypassed or fixed through unrelated code changes.
- No commits or pushes are made by the `/tdd` skill. Changes are reviewed and committed separately by the user.