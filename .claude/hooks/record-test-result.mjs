// PostToolUse / PostToolUseFailure hook for Bash.
// Records the latest test run per suite, so that the SessionEnd hook can report the last known
// test status without running the tests itself.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Each pattern must match at the start of a command, so that commands which only mention a
// tool (for example `cat pytest.ini` or `cat jest.config.js`) are not recorded as test runs.
const suites = [
  {
    key: "jest",
    suite: "TypeScript tests (Jest)",
    pattern: /^(npm (run )?test|(npx )?(\S*\/)?jest)(\s|$)/,
  },
  {
    key: "pytest",
    suite: "Python tests (pytest)",
    pattern: /^(npm run test:legacy|(\S*\/)?pytest|(\S*\/)?python3? -m pytest)(\s|$)/,
  },
];

// Splits a shell command line into its individual commands at &&, ||, ; and |.
function commandsIn(commandLine) {
  return commandLine.split(/&&|\|\||;|\|/).map((part) => part.trim());
}

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

try {
  const event = JSON.parse(input);
  const command = String(event.tool_input?.command ?? "");
  const matched = suites.filter((s) => commandsIn(command).some((part) => s.pattern.test(part)));

  if (event.tool_name === "Bash" && matched.length > 0) {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
    const resultsPath = path.join(projectDir, "sessions", "automatic", ".test-results.json");

    // PostToolUse fires for commands that exit 0. A non-zero exit fires PostToolUseFailure,
    // whose error message starts with "Exit code N".
    // In a pipeline (`npm test | tail`), the exit status belongs to the last command, so the
    // test result cannot be known.
    const piped = /(?<!\|)\|(?!\|)/.test(command);
    const failed = event.hook_event_name === "PostToolUseFailure";
    const exitCodeMatch = /^Exit code (\d+)/.exec(String(event.error ?? ""));
    const exitCode = piped ? null : failed ? (exitCodeMatch ? Number(exitCodeMatch[1]) : null) : 0;
    // pytest exits with 5 when it collects no tests. That is not a test failure.
    const statusFor = (key) =>
      piped
        ? "unknown"
        : !failed
          ? "passed"
          : key === "pytest" && exitCode === 5
            ? "no-tests-collected"
            : "failed";

    let results = {};
    try {
      results = JSON.parse(await readFile(resultsPath, "utf8"));
    } catch {
      // No earlier results, or an unreadable file: start again.
    }

    for (const { key, suite } of matched) {
      results[key] = {
        suite,
        command,
        status: statusFor(key),
        exitCode,
        recordedAt: new Date().toISOString(),
        sessionId: String(event.session_id ?? "unknown"),
      };
    }

    await mkdir(path.dirname(resultsPath), { recursive: true });
    await writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
  }
} catch (error) {
  // Never block or fail the tool call because of this hook.
  console.error(`Could not record test result: ${error.message}`);
}
