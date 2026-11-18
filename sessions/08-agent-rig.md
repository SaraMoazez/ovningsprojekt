# Session 08 – Agent Rig: Session Lifecycle Hooks

**Date:** 2026-11-16 – 2026-11-17  
**Phase:** AI Rig Setup – Session lifecycle and test-result hooks  
**Status:** Draft. Five hook events are configured and covered by automated tests. SessionEnd and the updated SessionStart behaviour still need live verification. Changes are uncommitted.

## 1. Current state

### Course requirements

| Requirement | Status |
|---|---|
| `CLAUDE.md` | Implemented |
| Three skills | Implemented: `/research`, `/plan`, `/tdd` |
| Four subagents | Missing: 0 of 4 |
| Five hooks | Five events configured using four scripts; partially verified |
| Permissions | Implemented and verified in Session 01 |
| Session logging | Curated logs 00–08; automatic logging implemented |
| TDD workflow | Implemented and used |
| Automated quality hooks | Not implemented; checks are run manually |

### Hook overview

| Event | Script | Responsibility |
|---|---|---|
| SessionStart | `load-session-log.mjs` | Loads the latest automatic log, or falls back to the latest curated log |
| PreCompact | `preserve-session-context.mjs` | Backs up the transcript and guides the compaction summary |
| SessionEnd | `session-end.mjs` | Writes an automatic end-of-session log |
| PostToolUse | `record-test-result.mjs` | Records successful test runs |
| PostToolUseFailure | `record-test-result.mjs` | Records failed test runs |

The SessionEnd hook has a 10-second timeout.

Automatic logs are stored in `sessions/automatic/`. Curated logs remain in `sessions/` and are reviewed by the user. The test-results JSON file and transcript backups are gitignored.

### Permissions

The existing permission rules remain unchanged:

- **Allow:** Read, Glob, Grep, test commands, lint, typecheck, format checks, Git status and diff.
- **Ask:** Edit, Write, Git commit and npm install.
- **Deny:** Reading `.env`, `rm`, `curl` and `git push`.

### Project status

No application code was changed in this session. Migration 0001 (Step 3) is committed as `9584ac7`. Step 4 has not started.

## 2. What worked

### Live verification

| Behaviour | Result |
|---|---|
| SessionStart after manual compaction | Verified; loaded the latest curated log |
| PreCompact on manual trigger | Verified |
| Transcript backup | Verified; 781,267 bytes, file permission `600` |
| Backup content | First 100 lines matched the original transcript |
| Backup gitignore | Verified |
| Successful test recording | Verified live |
| Failed test recording | Verified live |
| pytest exit code 5 | Verified live as `no-tests-collected` |

Automatic compaction, SessionEnd execution and loading an automatic log have not yet been verified live.

### TDD implementation

The hook tests were developed test-first. Each test runs the hook in a temporary project directory.

| Cycle | Behaviour | RED evidence | Final result |
|---|---|---|---|
| 1 | Test recording, SessionEnd and SessionStart | 8 of 10 tests failed because the new behaviour was missing | 10/10 passed |
| 2 | Piped commands reported as unknown | Incorrectly reported as passed | 11/11 passed |
| 3 | Ignore commands that only mention test tools | Investigation command was incorrectly recorded as a test | 13/13 passed |
| 4 | pytest exit code 5 | Incorrectly recorded as failed | 15/15 passed |
| 5 | Only report current-session test runs | Earlier-session results were included | 16/16 hook tests passed |

### Final verification

| Check | Result |
|---|---|
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run format:check` | Passed |
| `npx jest tests/session-hooks.test.ts` | 16/16 passed |
| `npm test` | 43/43 passed |
| `npm run test:legacy` | Not run in final verification |

The legacy Python suite previously exited with code 5 because pytest collected no tests.

## 3. What failed

Two bugs were found in the test-result hook and fixed:

1. **Piped commands:** `npm test 2>&1 | tail -15` was incorrectly recorded as passed. Pipeline results are now recorded as `unknown`.
2. **Commands mentioning test tools:** An investigation command containing `pytest` was incorrectly recorded as a test run. Commands are now split at shell separators and matched at the start of each command.

Other findings:

- A Prettier check failed once due to a long line; formatting was corrected.
- The Python project currently has no pytest test files.
- Jest exit code 1 cannot distinguish between failed tests and no matching tests.
- Concurrent sessions can overwrite each other's latest test result for the same suite.
- Transcript backups and automatic logs grow without a retention policy.
- Backups contain full transcripts and may include sensitive tool output. They are gitignored and were observed with file permission `600`.
- SessionEnd and the updated SessionStart behaviour have not yet been tested live.

No hook failures were observed during the verified runs.

## 4. What remains

### Rig work

- Implement four subagents.
- Verify SessionEnd writes an automatic log and stays within its timeout.
- Start a new session and verify SessionStart loads that automatic log.
- Verify SessionStart on `startup`, `resume` and `clear`.
- Verify PreCompact on an automatic trigger.
- Decide whether automated lint, typecheck and formatting hooks are required.
- Define a retention policy for backups and automatic logs.
- Confirm with the teacher whether five hook events using four scripts satisfy the requirement.
- Consider documenting the lifecycle design in an ADR.

### Project work

- Add Python tests for the legacy module.
- Continue with Step 4: require and validate `Idempotency-Key`.
- Complete Steps 5–8.
- Apply migration 0001 to the development database with user approval.
- Review the minor cleanup items carried over from Session 07.

### Uncommitted changes

- Modified: `load-session-log.mjs`, `settings.json`, `.gitignore`
- New: `preserve-session-context.mjs`, `record-test-result.mjs`, `session-end.mjs`, `tests/session-hooks.test.ts`, `sessions/08-agent-rig.md`
- Runtime state: `sessions/automatic/.test-results.json` (gitignored)

Nothing has been committed or pushed.

## 5. Decisions made

- Follow the lifecycle: **SessionStart reads, PreCompact preserves, SessionEnd writes.**
- Keep automatic logs separate from curated, user-reviewed logs.
- SessionStart loads the latest automatic log and falls back to the latest curated log when none exists.
- Automatic logs reference the latest curated log.
- Commit automatic logs, but never let hooks commit automatically.
- Back up the transcript before compaction; keep backups gitignored.
- PreCompact preserves context only; it does not write session logs.
- SessionEnd records facts only and does not run tests.
- Test-result hooks record the latest known result per suite.
- SessionEnd reports only test runs from the current session.
- pytest exit code 5 means no tests collected; piped test results are reported as unknown.
- Use a 10-second SessionEnd timeout.
- Do not modify historical session logs.

**Next steps:** Review and commit the rig changes, end the session to test SessionEnd, start a new session to test automatic log loading, then plan the four subagents.

## 6. Resource Usage

Not recorded. Read cost, duration and token statistics from `/cost` or `/usage`.