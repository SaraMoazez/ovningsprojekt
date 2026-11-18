// SessionEnd hook: writes a factual, automatic end-of-session log to sessions/automatic/.
// It only reports data a script can collect (git state and recorded test runs). It does not
// summarize the session; the curated logs in sessions/ hold the narrative.
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

function git(projectDir, args) {
  try {
    return execFileSync("git", args, { cwd: projectDir, encoding: "utf8" }).trimEnd();
  } catch {
    return null;
  }
}

function highestNumber(files) {
  const numbers = files
    .filter((f) => /^\d+-.*\.md$/.test(f))
    .map((f) => Number(f.match(/^\d+/)[0]));
  return numbers.length > 0 ? Math.max(...numbers) : null;
}

async function listDir(dir) {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

// Local time with the zone name and UTC offset, e.g. "2026-11-17 14:05 Australia/Sydney (UTC+11:00)".
function formatLocalDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())} ${zone} ` +
    `(UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)})`
  );
}

function formatTestRuns(results, sessionId) {
  const runs = Object.values(results).filter((run) => run.sessionId === sessionId);
  if (runs.length === 0) return "No test runs recorded during this session.";

  const rows = runs.map((run) => {
    const exitCode = `exit code ${run.exitCode ?? "unknown"}`;
    const result =
      run.status === "failed"
        ? `failed (${exitCode})`
        : run.status === "no-tests-collected"
          ? `no tests collected (${exitCode})`
          : run.status;
    return `| ${run.suite} | ${result} | \`${run.command}\` | ${run.recordedAt} |`;
  });

  return [
    "Last result per suite during this session, recorded when Claude ran the tests. The tests were not re-run by this hook.",
    "",
    "| Suite | Result | Command | Recorded (UTC) |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}

try {
  const event = JSON.parse(input);
  const projectDir = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
  const sessionsDir = path.join(projectDir, "sessions");
  const automaticDir = path.join(sessionsDir, "automatic");
  const sessionId = String(event.session_id ?? "unknown");

  const curatedFiles = (await listDir(sessionsDir)).filter((f) => /^\d+-.*\.md$/.test(f));
  const latestCuratedNumber = highestNumber(curatedFiles);
  const latestCurated = curatedFiles.find(
    (f) => Number(f.match(/^\d+/)[0]) === latestCuratedNumber,
  );

  const previous = highestNumber(await listDir(automaticDir));
  const number = String(previous === null ? 0 : previous + 1).padStart(2, "0");

  let results = {};
  try {
    results = JSON.parse(await readFile(path.join(automaticDir, ".test-results.json"), "utf8"));
  } catch {
    // No test runs recorded yet.
  }

  const latestCommit = git(projectDir, ["log", "-1", "--format=%h %s (%ad)", "--date=iso"]);
  const changedFiles = git(projectDir, ["status", "--short"]);

  const log = [
    `# Automatic Session Log ${number}`,
    "",
    "**Written by:** SessionEnd hook. This log is automatic and has not been reviewed.",
    `**Date:** ${formatLocalDate(new Date())}`,
    `**Session ID:** ${sessionId}`,
    `**End reason:** ${event.reason ?? "unknown"}`,
    `**Latest curated log:** ${latestCurated ? `\`sessions/${latestCurated}\`` : "none found"}`,
    "",
    "## Latest commit",
    "",
    latestCommit ? `\`${latestCommit}\`` : "Not available (git failed or there are no commits).",
    "",
    "## Uncommitted changes (`git status --short`)",
    "",
    changedFiles === null
      ? "Not available (git failed)."
      : changedFiles === ""
        ? "None."
        : `\`\`\`\n${changedFiles}\n\`\`\``,
    "",
    "## Test status",
    "",
    formatTestRuns(results, sessionId),
    "",
  ].join("\n");

  await mkdir(automaticDir, { recursive: true });
  await writeFile(path.join(automaticDir, `${number}-session-end.md`), log);
} catch (error) {
  console.error(`Could not write automatic session log: ${error.message}`);
  process.exitCode = 1;
}
