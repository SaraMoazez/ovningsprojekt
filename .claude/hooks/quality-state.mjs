// Shared helpers for the code quality hooks.
import path from "node:path";

// Claude Code ignores plain stdout from PostToolUse and Stop hooks, and shows only a short
// notice for exit code 1. To make Claude react, a hook prints JSON with `decision: "block"`
// and a `reason`. Hook output strings are capped at 10,000 characters.
const maxReasonLength = 9000;

export function projectDirFrom(event) {
  return process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
}

// Marks that a TypeScript file was changed in this session, so that the Stop hook runs the
// type check once at the end of the turn instead of after every edit.
export function pendingTypecheckPath(projectDir, sessionId) {
  const safeId = String(sessionId ?? "unknown").replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(projectDir, ".claude", "state", "typecheck-pending", safeId);
}

export function truncate(text) {
  return text.length > maxReasonLength
    ? `${text.slice(0, maxReasonLength)}\n... (output truncated)`
    : text;
}

export async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input;
}
