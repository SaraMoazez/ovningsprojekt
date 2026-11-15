# Session 01 – Claude Code Permissions

**Date:** 2026-11-14  
**Phase:** AI Rig Setup – Permissions  
**Status:** Implemented and verified

## 1. Current state

Project-level permissions for Claude Code have been configured in .claude/settings.json.

The configuration follows the principle of least privilege. Claude is allowed to execute selected development and inspection commands automatically, must request approval for potentially risky operations, and is explicitly blocked from prohibited operations.

The permission configuration contains three rule categories:

### Allow

The following operations are allowed without approval:

- Read
- Glob
- Grep
- `npm test`
- `npm run test:legacy`
- `npm run lint`
- `npm run typecheck`
- `npm run format:check`
- `git status`
- `git diff`

### Ask

The following operations require approval:

- Edit
- Write
- `git commit`
- `npm install`

### Deny

The following operations are explicitly blocked:

- Reading `.env`
- `rm` commands
- `curl` commands
- `git push`

## 2. What worked

The project settings were successfully loaded in Claude Code.

Verification was performed using:

- `/status` to confirm that shared project settings were loaded.
- `/permissions` to inspect the configured allow, ask and deny rules.
- Practical tests to verify the actual permission behavior.

### Behavioral test results

| Test | Expected result | Observed result |
|---|---|---|
| `npm test -- --listTests` | Execute without approval | Passed |
| `npm install --help` | Request approval | Passed – approval requested and rejected |
| `rm --help` | Block execution | Passed – blocked |
| `git push` | Block execution | Passed – blocked |
| Read `.env` | Block access | Passed – blocked |
| `curl` command | Block execution | Passed – blocked |

### Test evidence

**Allow:** Claude executed `npm test -- --listTests` without requesting permission. Jest discovered two test files:

- `tests/orders.test.ts`
- `tests/customers.test.ts`

**Ask:** Claude requested permission before executing `npm install --help`. The request was rejected by the user, and the command was not executed.

**Deny:** Claude Code blocked `rm --help` with a permission-denied message.

**Environment file protection:** Claude attempted to read `.env`, but access was denied by the configured permission rules. The file was not opened.

**Additional deny checks:** The configured rules for `git push` and `curl` were also tested and blocked.

All six behavioral tests produced the expected results.

## 3. What failed

No unexpected failures occurred during the permission verification.

The configured allow, ask and deny rules behaved as expected in all six tests.

## 4. What remains

- Integrate permissions with the planned hooks and subagents.
- Review whether additional permissions are needed for specific workflows.
- Revisit the security model as the AI rig becomes more advanced.
- Implement reusable Claude Code skills and slash commands.
- Continue building the AI rig incrementally and document each implementation session.

## 5. Decisions made

- Use a restrictive permission model.
- Allow selected development and inspection commands without approval.
- Require approval for file modifications and selected operations.
- Block potentially dangerous commands and git push.
- Keep project permissions version controlled.
- Verify permission behavior through practical tests rather than relying only on configuration inspection.