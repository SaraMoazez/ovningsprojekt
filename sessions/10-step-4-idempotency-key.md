# Session 10 – Require and Validate Idempotency-Key (Step 4), First Subagent Run

**Date:** 2026-11-18
**Phase:** Implementation of Step 4 of `docs/plans/idempotent-order-retry.md` using the `/tdd` skill, coordinated across the four project subagents

## 1. Current state

**Status:** Step 4 is implemented and verified, and is **not committed**. It is waiting for the user's review. Step 5 has not started.

Before work started, the main agent checked that the plan status was `Approved.`, that Steps 1–3 were committed (`7a00ca5`, `d155a37`, `9584ac7`) and that the working tree was clean.

`POST /orders` now requires an `Idempotency-Key` header:

- If the key is missing, `""`, whitespace-only, or longer than 255 characters (JS `string.length`), the response is `400 invalid_input` with the message "The Idempotency-Key header is required and must be 1-255 characters." and nothing is written.
- The checks run in this order: authentication (`requireCustomer`, 401), then the key, then the lines.
- A valid key is stored raw (untrimmed) in `orders.idempotency_key` through the existing parameterised `INSERT`.
- The key is read only from the header, never from the body.
- Nothing from Step 5 or later was added: no `request_hash`, no `ON CONFLICT`, no replay.

- `src/routes/orders.ts` – passes `req.header("Idempotency-Key")` to `createOrder`.
- `src/services/orderService.ts` – adds `validateIdempotencyKey`, a new `idempotencyKey` parameter, and `idempotency_key` as `$3` in the INSERT.
- `tests/orders.test.ts` – adds a `countRows` helper, a `validBody` constant, a nested `describe("Idempotency-Key")` block with 10 tests (4 from `it.each`), and a `describe("createOrder service")` block with 1 test. Three existing tests were changed (see section 5).

## 2. Subagents invoked

All four subagents were invoked, each for the first time on a real task. Each was briefed by the main agent. Their reports were checked by the main agent before being acted on.

| Order | Subagent | Task | Mode | Files changed |
|---|---|---|---|---|
| 1 (parallel with 2) | `database-engineer` | Review migration 0001 and schema compatibility with Step 4 | Review only | None |
| 2 (parallel with 1) | `test-engineer` | Review the planned Step 4 test coverage before implementation | Review only | None (see section 4) |
| 3 | `backend-developer` | Implement Step 4 and own its TDD cycle, using the findings from 1 and 2 | Implementation | The 3 files above |
| 4 | `code-reviewer` | Independent review of the uncommitted diff | Review only, told not to run Jest because the main agent was using the test DB | None |

### Contributions and findings

**Database engineer** – no blocking issue and no schema change needed.
- JS `length <= 255` always fits `VARCHAR(255)`, because PostgreSQL counts code points and a string never has more code points than UTF-16 code units.
- Node rejects NUL and control characters in header values before Express runs.
- Seeded rows keep `NULL` keys, which the unique constraint allows.
- The Step 5 lookup can use the constraint's index.
- **Finding for Step 5 (medium, plan inaccuracy):** the plan expects a duplicate key to give a 500 before `ON CONFLICT` exists. The project uses Express 4 (verified by the main agent: `4.22.3`, and `src/app.ts` has no error middleware), so a rejected promise in the async handler gets no response. The request will most likely hang instead. The agent did not run this, so it is unverified.

**Test engineer** – ran a throwaway Express + Supertest script in the scratchpad (outside the repo) and observed:
- `""` arrives as `""`, so the plan's empty-header assumption holds.
- `"   "` also arrives as `""`, and `" abc "` arrives as `"abc"`, because Node trims leading and trailing whitespace from header values.

As a result, the HTTP whitespace test covers the same path as the empty test, and untrimmed storage cannot be proven over HTTP for leading or trailing whitespace. The agent's recommendations, all passed to the backend developer:
- Assert that the key is actually stored (AC1 was not asserted anywhere in the plan).
- On every invalid-key case, assert `error.code` and that the `orders` and `order_lines` row counts are unchanged.
- Add a test for the check order (key before lines).
- Make the AC8 test send a valid body, so it differs from the existing 401 test.
- Add a test that the key is not read from the body.
- Add one direct service-level test for the `trim()` branch.

**Backend developer** – implemented the change and the tests. See section 3 for its TDD evidence and section 4 for its process deviation.

**Code reviewer** – "Approved with suggestions. No blocking findings for Step 4." Its findings, all low severity:
1. `tests/orders.test.ts:12-15`: `countRows` builds SQL with a template literal (`FROM ${table}`). The table name is limited to `"orders" | "order_lines"`, so there is no injection risk, but it breaks the letter of `docs/standard.md` ("SQL byggs aldrig med strängmallar eller sammanslagning"). Suggested fix: a constant map of two fixed query strings.
2. `res.rows[0].n` is implicitly `any` (the same pattern exists in `orderService.ts`). Optional fix: `db.query<{ n: number }>`.
3. The body-key test proves only the case where the header is absent. This is acceptable, because the route reads only the header.
4. The new error message and test names are in English next to existing Swedish ones. This is defensible under CLAUDE.md and the plan's language decision.

The reviewer did not open ADR 0002 or the research document's AC list. Its search for AC4 in the research document returned nothing.

## 3. Evidence

### TDD evidence (as reported by the backend developer)

The main agent did not see these RED runs. They come from the backend developer's report.

| # | Test | RED (observed failure) | GREEN |
|---|---|---|---|
| 1 | missing / empty / whitespace-only / 256-char key → 400 `invalid_input`, counts unchanged (4 cases) | `Expected: 400 Received: 201` | Passed after the validation code |
| 2 | AC1: key `"key with spaces 1"` is stored | `Expected: "key with spaces 1" Received: null` | Passed after the INSERT change |
| 3 | 255-char key → 201, stored length 255 | `Received has value: null` | Passed |
| 4 | key only in the body → 400 | Passed when written; RED shown afterwards (`Expected: 400 Received: 201`) | Passed |
| 5 | key is checked before lines | Passed when written; RED shown afterwards (`Received string: "En beställning måste ha minst en rad."`) | Passed |
| 6 | AC8: 401 `unauthorized` with no customer header and no key | Passed immediately. Regression guard: `requireCustomer` runs before the service. | Passed |
| 7 | AC7: 400 with key K, then 201 with K and K stored | The 400/201 part passed already. RED from the stored-key assertion, shown afterwards (`Received: null`). | Passed |
| 8 | service level: `createOrder(3, "   ", validBody)` → `invalid_input`, no row | Against the old signature: `TS2554: Expected 2 arguments, but got 3` (compile error). With only the `trim()` check removed: `Expected: false Received: true` (runtime). | Passed with `trim()` restored |

Refactor: none.

### Final verification (run by the main agent, one command at a time, after the subagents finished)

- `npm run lint` – passed, no output.
- `npm run typecheck` – passed, no output.
- `npm run format:check` – passed: "All matched files use Prettier code style!"
- `source .venv/bin/activate && npm test` – passed: 6 test suites, 81 of 81 tests.
- No warnings were reported by any check.
- `npm run test:legacy` was **not run**. The plan schedules it for Step 8.
- No command was run against the development database.

The backend developer reported that `format:check` first failed on `tests/orders.test.ts` and that it fixed this with `npx prettier --write tests/orders.test.ts`.

## 4. What failed / problems

- **TDD ordering deviation (backend developer).** Test 1 forced the signature change and the validation, and test 2 forced the INSERT change, before tests 4, 5 and 7 were written. So those three tests were never seen failing before their code existed. The agent then temporarily restored the original route and service from git, ran the file (9 failures, 10 passes), and restored its own implementation from a copy in the scratchpad. It also removed the `trim()` check temporarily to show test 8 failing at runtime. The RED reasons are valid, but the order was not strictly test-first for those tests. The main agent's `git status` afterwards showed only the three intended files changed.
- **Test 8's first RED was a compile error.** It became a runtime assertion failure only after the signature existed.
- **Test engineer, review-only task:** reported a `sed -i` attempt that failed on BSD sed "(no effect)". The main agent checked `git status` and `git diff --stat` afterwards: there were no changes. A review-only agent should not try in-place edits at all; its agent file may need a clearer rule.
- **Standards violation (fixed after user approval):** the user approved fixing code reviewer finding 1. `countRows` now picks one of two constant query strings from a `COUNT_SQL` map and uses `db.query<{ n: number }>`, which also resolves finding 2 for the helper. Behaviour is unchanged. Afterwards `npx jest --runInBand tests/orders.test.ts` passed 20 of 20, and the full verification passed again (lint, typecheck and format clean; `npm test` 6 suites, 81 of 81).
- **Probe setup problems (main agent):** the first throwaway Jest probe in the scratchpad could not resolve `supertest` (TS2307). The second attempt set `moduleDirectories`, which made superagent load the wrong `mime` (`mime.getType is not a function`). Removing that setting fixed it. A `| tail` pipe hid the output of a hung run until it was killed. No probe process was left running.

## 5. Decisions made

- **Changes to existing tests (justified by the plan's approved breaking change):** only `.set("Idempotency-Key", …)` was added to "lägger en beställning med rader", "returnerar 400 utan rader" and "returnerar 400 när antalet inte är positivt". Without the header, the two 400 tests would pass for the wrong reason. Assertions and names are unchanged. Prettier split the "utan rader" chain onto several lines. "returnerar 401 utan inloggning" is unchanged.
- **Subagent order:** the database and test reviews ran before implementation, so their findings could shape the tests. The code review ran after.
- **Planned test dropped:** the plan's "no `X-Customer-Id` and no key → 401" test duplicated the existing 401 test. It was replaced by a test that sends a valid body (Test engineer recommendation).
- **Direct service test added:** it is the only way to prove the `trim()` branch, because Node trims header values.
- **New error message in English,** per the plan's language decision.

### Duplicate-key behaviour in the Step 4 state (verified by the main agent, on user request)

Two throwaway probes in the scratchpad, run against the test DB only. Neither is part of the suite. Each sent the same customer, key and body twice, one after the other.

- **Jest + Supertest:** the first request returned `201`. The second failed with `error: duplicate key value violates unique constraint "orders_customer_idempotency_key_unique"` at `orderService.ts:58`, then with `Exceeded timeout of 5000 ms for a test`. Jest printed "Jest did not exit one second after the test run has completed" and was still running after 30 s, when it was killed.
- **Real HTTP server (`tsx`, Node v24.19.0, `fetch`):** the first request returned `201`. The second raised an unhandled rejection with code `23505` and `Key (customer_id, idempotency_key)=(3, probe-2) already exists.`, and the **process exited with code 1**.
- The concurrent case was not tested. Its behaviour remains unverified and will be tested in Step 5.

**Conclusion:** before Step 5, a duplicate key gets no response at all, not a 500. In a running server it crashes the process.

**Plan updated** (`docs/plans/idempotent-order-retry.md`, Step 5 sections only):
- A "Verified step 4 behaviour" note under Step 5.
- The expected first failures in the Step 5 testing strategy (replay and concurrent).
- The "What makes test A fail" table.
- The "Hangs on failure" limitation.

Red-phase runs use `--forceExit` on the command line only; no config is changed. Step 7's sentence "not fail with 404/500" describes the desired behaviour and was left as it is.

## 6. What remains

- User review of Step 4 and the plan update, then a commit.
- **Do not release Step 4 without Step 5.** In the Step 4 state, a retry with the same key crashes the API process.
- Update the Test Engineer and Code Reviewer instructions to explicitly prohibit file modifications and in-place editing commands.
- Steps 5–8 of the plan.

## 7. Resource usage

**Claude Code usage dashboard** (approximate; sessions on this computer only):

### Usage limits at the time of recording

- Current session: 20% used
- Current week (all models): 6% used
- Usage credits: Off.

### Usage breakdown – last 24 hours

The dashboard reported the following contributors:

- 68% – checking which models subagents use.
- 30% – context usage (`/context`).
- 10% – starting fresh when switching tasks (`/clear`).

These percentages overlap and should not be added together.

**Skills:**
- `/tdd`: 2%.

**Subagents:**
- `tdd`: 2%.
- `web-fetch`: 2%.
- `backend-developer`: 1%.
- `code-reviewer`: 1%.

### Session statistics

- Estimated cost: **$3.15**
- API duration: 10m 39s
- Wall-clock duration: 29m 40s
- Code changes: 306 lines added, 16 lines removed.

### Usage by model

| Model | Input tokens | Output tokens | Cache read | Cache write | Cost |
|---|---:|---:|---:|---:|---:|
| Claude Haiku 5.5 | 9.0k | 1.1k | 0 | 0 | $0.0015 |
| Claude Opus 5.5 | 1.2k | 36.9k | 5.0m | 110.2k | $2.62 |
| Claude Sonnet 5.5 | 56 | 22.8k | 531.0k | 101.4k | $0.54 |

### Prompt cache

- 48 requests.
- 98% of input tokens came from cache.
- No cache misses.
- Cache status: warm (1-hour TTL).

**Limitations:** The dashboard figures are approximate and cover sessions on this computer only. The 24-hour usage percentages overlap. Model usage and cost are not necessarily attributable exclusively to the Step 4 implementation or to subagents.
