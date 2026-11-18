# Session 09 – Agent Rig: Four Subagents

**Date:** 2026-11-18
**Phase:** AI Rig Setup – Subagents
**Status:** Completed. Four subagents are defined in `.claude/agents/` and committed. None of them has been invoked on a real task yet.

## 1. Current state

### Subagents

| Agent | Tools | Model | Role |
|---|---|---|---|
| `backend-developer` | Read, Grep, Glob, Edit, Write, Bash | sonnet | API endpoints, services and business logic; owns its TDD cycle |
| `test-engineer` | Read, Grep, Glob, Edit, Write, Bash | sonnet | Test strategy, Jest and pytest tests, regression testing; does not change production code |
| `database-engineer` | Read, Grep, Glob, Edit, Write, Bash | sonnet | Schema and migrations following ADR 0001; owns its TDD cycle |
| `code-reviewer` | Read, Grep, Glob, Bash | sonnet | Read-only review; reports findings, does not fix them |

Each agent file has responsibilities, scope boundaries, working guidelines, a verification section (except the reviewer, which has a list of allowed commands) and a final report format. All final reports include a status, the commands actually executed, failures, decisions and remaining work, so the main agent can write session logs from them.

### Permissions added

- `Bash(source .venv/bin/activate)`, so `source .venv/bin/activate && npm test` runs without a prompt.
- `Bash(git log *)` and `Bash(git show *)`, for the code reviewer.

## 2. What was done

The user wrote a first version of each agent file. Claude reviewed it against `CLAUDE.md`, `docs/standard.md`, ADR 0001, `.claude/settings.json` and the code, and the file was revised in rounds until no actionable findings remained. The user made some revisions; Claude made others on request.

### Commits

| Commit | Message | Content |
|---|---|---|
| `e12032f` | Add backend developer subagent | `backend-developer.md`, `settings.json` |
| `27f5a2b` | Add test engineer subagent | Empty `code-reviewer.md` (see What failed) |
| `f0e7c43` | Add database engineer subagent | `database-engineer.md` |
| `aa89f79` | Add test engineer subagent | `test-engineer.md` |
| `a685bbb` | Add code reviewer subagent | `code-reviewer.md`, `settings.json` |

## 3. Evidence

- After each agent file was saved with valid frontmatter, Claude Code listed it as an available agent type in the session: `backend-developer`, `test-engineer`, `database-engineer` and `code-reviewer`.
- `.claude/settings.json` was checked as valid JSON with Node after the `git log` and `git show` permissions were added.

No tests, lint, typecheck or format checks were run in this session. Only Markdown files and `settings.json` were changed, and the lint and format scripts cover only `src` and `tests`. None of the subagents has been invoked, so their behaviour is not verified.

## 4. What failed

- **Hook limitation:** `protect-tests.mjs` is a `Stop` hook. Subagents fire `SubagentStop`, so the hook checks a subagent's changes only when the main agent stops. The agent files now say not to rely on the hook.
- **Wrong commit message:** `27f5a2b` is named "Add test engineer subagent" but only adds an empty `code-reviewer.md`. The test engineer was committed in `aa89f79`. The history was not rewritten.

## 5. Decisions made

- The backend developer and the database engineer own their TDD cycles. The test engineer handles test strategy and test quality and does not change production code.
- Subagents cannot ask the user. When something is unclear or destructive, they stop and report as blocked; approval comes from the user, relayed by the main agent.
- The database engineer verifies migrations only through `npm test` against the test database and never runs `db:migrate`, `db:migrate:down` or `db:reset` without user approval.
- The code reviewer gets no Edit or Write tool, so it cannot change files through those tools.
- All four agents use `sonnet`. Opus was considered for the reviewer for a more independent opinion, and the user chose to keep Sonnet.

## 6. What remains

- Invoke each subagent on a real task and check that it follows its file, especially the TDD evidence, the blocked rule and the final report.
- Add Python tests for the legacy module; `npm run test:legacy` still collects no tests.
- Continue with Step 4 of `docs/plans/idempotent-order-retry.md`.


## 7. Resource usage

### Session metrics

| Metric | Value |
|---|---:|
| Estimated cost | $2.88 |
| API duration | 9m 5s |
| Wall-clock duration | 57m 38s |
| Code changes | 199 lines added, 35 removed |

### Usage by model

| Model | Input tokens | Output tokens | Cache read | Cache write | Cost |
|---|---:|---:|---:|---:|---:|
| Claude Haiku 5.5 | 1.2k | 21 | 0 | 0 | $0.0001 |
| Claude Opus 5.5 | 11.3k | 40.5k | 6.6m | 87.8k | $2.88 |

### Usage observations

- Opus accounted for almost all recorded session cost.
- Main prompt cache: 61 requests, 99% of input tokens from cache, no cache misses.
- The usage dashboard attributed 2% of usage to the `web-fetch` subagent.
- The dashboard's contributing percentages (61%, 31%, 13%) overlap and should not be added together.
- Usage statistics are approximate and cover sessions on this computer only.

