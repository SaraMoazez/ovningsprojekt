import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const sessionsDir = path.resolve(process.cwd(), "sessions");

try {
  const files = await readdir(sessionsDir);

  const sessionLogs = files
    .filter((file) => /^\d+-.*\.md$/.test(file))
    .sort((a, b) => {
      const numberA = Number(a.match(/^\d+/)[0]);
      const numberB = Number(b.match(/^\d+/)[0]);
      return numberB - numberA;
    });

  if (sessionLogs.length === 0) {
    console.log("No previous session logs found.");
    process.exit(0);
  }

  const latestLog = sessionLogs[0];
  const content = await readFile(
    path.join(sessionsDir, latestLog),
    "utf8",
  );

  console.log(
    `Latest project session log: ${latestLog}\n` +
    "Use this log to restore project context. Verify the current " +
    "repository state before taking action.\n\n" +
    content,
  );
} catch (error) {
  console.error(`Could not load session log: ${error.message}`);
  process.exitCode = 1;
}
