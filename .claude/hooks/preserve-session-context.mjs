
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

let input = "";

for await (const chunk of process.stdin) {
  input += chunk;
}

try {
  const event = JSON.parse(input);

  if (event.hook_event_name !== "PreCompact") {
    throw new Error("Unexpected hook event.");
  }

  const projectDir = event.cwd;
  const backupDir = path.join(
    projectDir,
    "sessions",
    ".compaction-backups",
  );

  // Preserve a copy of the conversation transcript.
  if (event.transcript_path) {
    try {
      const transcriptStats = await stat(event.transcript_path);

      if (!transcriptStats.isFile()) {
        throw new Error("Transcript path is not a file.");
      }

      await mkdir(backupDir, { recursive: true });

      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-");

      const sessionId = String(event.session_id || "unknown-session")
        .replace(/[^a-zA-Z0-9_-]/g, "_");

      const backupFilename = `${sessionId}-${timestamp}.jsonl`;
      const backupPath = path.join(backupDir, backupFilename);

      await copyFile(event.transcript_path, backupPath);
    } catch (error) {
      console.error(
        `Could not back up transcript: ${error.message}`,
      );
    }
  } else {
    console.error("No transcript path provided. Backup skipped.");
  }

  // Provide instructions for the compaction summary.
  const instructions = [
    "PROJECT CONTEXT PRESERVATION",
    "",
    "This project uses sessions/*.md as its source of truth for project history and state.",
    "",
    "When summarizing this conversation, preserve enough information to continue the work accurately.",
    "",
    "Preserve the following information:",
    "- Current implementation step, phase and progress.",
    "- Files changed and important implementation details.",
    "- TDD cycles, including observed RED, GREEN and REFACTOR evidence.",
    "- Verification commands and their actual results.",
    "- Failures, warnings and unresolved issues.",
    "- Decisions made, alternatives considered and rationale.",
    "- Git status, commits and uncommitted changes.",
    "- Remaining work and the next concrete action.",
    "- Resource usage, when available.",
    "",
    "Never invent test results, measurements, decisions or completed work.",
    "Distinguish verified facts from assumptions and pending work.",
    "Do not modify historical session logs during compaction.",
    "Do not create a new session log for every compaction.",
    "",
    `Compaction trigger: ${event.trigger}`,
    `Session ID: ${event.session_id || "Unavailable"}`,
    `Transcript backup directory: ${backupDir}`,
  ];

  process.stdout.write(instructions.join("\n"));
} catch (error) {
  console.error(
    `Could not prepare compaction instructions: ${error.message}`,
  );
  process.exitCode = 1;
}
