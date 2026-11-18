// SessionStart hook: loads the latest automatic session log from sessions/automatic/.
// Falls back to the latest curated log in sessions/ when no automatic log exists.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const sessionsDir = path.join(projectDir, "sessions");
const automaticDir = path.join(sessionsDir, "automatic");

async function latestLog(dir) {
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }

  const logs = files
    .filter((file) => /^\d+-.*\.md$/.test(file))
    .sort((a, b) => Number(b.match(/^\d+/)[0]) - Number(a.match(/^\d+/)[0]));

  return logs[0] ?? null;
}

try {
  const automaticLog = await latestLog(automaticDir);

  if (automaticLog) {
    const content = await readFile(path.join(automaticDir, automaticLog), "utf8");
    console.log(
      `Latest automatic session log: automatic/${automaticLog}\n` +
        "This log was written by the SessionEnd hook and has not been reviewed. It names the " +
        "latest curated log, which holds the plan step, decisions and next action. Verify the " +
        "current repository state before taking action.\n\n" +
        content,
    );
  } else {
    const curatedLog = await latestLog(sessionsDir);

    if (!curatedLog) {
      console.log("No previous session logs found.");
    } else {
      const content = await readFile(path.join(sessionsDir, curatedLog), "utf8");
      console.log(
        `Latest project session log: ${curatedLog}\n` +
          "Use this log to restore project context. Verify the current " +
          "repository state before taking action.\n\n" +
          content,
      );
    }
  }
} catch (error) {
  console.error(`Could not load session log: ${error.message}`);
  process.exitCode = 1;
}
