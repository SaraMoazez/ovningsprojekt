import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Tests for the session lifecycle hooks in .claude/hooks/.
// Each hook runs as a separate Node process against a temporary project directory.

const hooksDir = path.join(__dirname, "..", ".claude", "hooks");

interface HookResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface TestRunRecord {
  suite: string;
  command: string;
  status: string;
  exitCode: number | null;
  recordedAt: string;
  sessionId: string;
}

type TestResults = Record<string, TestRunRecord>;

let projectDir: string;

function runHook(script: string, input: object): HookResult {
  const result = spawnSync("node", [path.join(hooksDir, script)], {
    input: JSON.stringify(input),
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, TZ: "Australia/Sydney" },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function git(...args: string[]): string {
  const result = spawnSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd: projectDir, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

function writeFile(relativePath: string, content: string): void {
  const fullPath = path.join(projectDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(projectDir, relativePath), "utf8");
}

const automaticDir = path.join("sessions", "automatic");
const resultsFile = path.join(automaticDir, ".test-results.json");

function readResults(): TestResults {
  return JSON.parse(readFile(resultsFile)) as TestResults;
}

function sessionEndEvent(sessionId = "session-a"): object {
  return {
    hook_event_name: "SessionEnd",
    session_id: sessionId,
    transcript_path: "/nonexistent/transcript.jsonl",
    cwd: projectDir,
    reason: "prompt_input_exit",
  };
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-hooks-"));
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("record-test-result hook", () => {
  it("records a successful npm test run as passed", () => {
    const result = runHook("record-test-result.mjs", {
      hook_event_name: "PostToolUse",
      session_id: "session-a",
      tool_name: "Bash",
      tool_input: { command: "source .venv/bin/activate && npm test" },
      tool_response: { stdout: "Tests: 27 passed", stderr: "", interrupted: false },
    });

    expect(result.status).toBe(0);
    const results = readResults();
    expect(results.jest).toMatchObject({
      suite: "TypeScript tests (Jest)",
      command: "source .venv/bin/activate && npm test",
      status: "passed",
      exitCode: 0,
      sessionId: "session-a",
    });
    expect(results.pytest).toBeUndefined();
  });

  it("records a failed pytest run with its exit code", () => {
    const result = runHook("record-test-result.mjs", {
      hook_event_name: "PostToolUseFailure",
      session_id: "session-a",
      tool_name: "Bash",
      tool_input: { command: ".venv/bin/pytest" },
      error: "Exit code 1\n1 failed, 3 passed",
    });

    expect(result.status).toBe(0);
    expect(readResults().pytest).toMatchObject({
      suite: "Python tests (pytest)",
      command: ".venv/bin/pytest",
      status: "failed",
      exitCode: 1,
    });
  });

  it("records pytest exit code 5 as no tests collected, not as failed", () => {
    runHook("record-test-result.mjs", {
      hook_event_name: "PostToolUseFailure",
      session_id: "session-a",
      tool_name: "Bash",
      tool_input: { command: "npm run test:legacy" },
      error: "Exit code 5\n\nno tests ran in 0.00s",
    });

    expect(readResults().pytest).toMatchObject({ status: "no-tests-collected", exitCode: 5 });
  });

  it("keeps the latest run per suite and does not count test:legacy as a Jest run", () => {
    runHook("record-test-result.mjs", {
      hook_event_name: "PostToolUseFailure",
      session_id: "session-a",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      error: "Exit code 1",
    });
    runHook("record-test-result.mjs", {
      hook_event_name: "PostToolUse",
      session_id: "session-a",
      tool_name: "Bash",
      tool_input: { command: "npm run test:legacy" },
      tool_response: { stdout: "", stderr: "", interrupted: false },
    });

    const results = readResults();
    expect(results.jest.status).toBe("failed");
    expect(results.pytest).toMatchObject({ command: "npm run test:legacy", status: "passed" });
  });

  it("records a piped test run as unknown, because the exit status belongs to the last command", () => {
    runHook("record-test-result.mjs", {
      hook_event_name: "PostToolUse",
      session_id: "session-a",
      tool_name: "Bash",
      tool_input: { command: "npm test 2>&1 | tail -15" },
      tool_response: { stdout: "", stderr: "", interrupted: false },
    });

    expect(readResults().jest).toMatchObject({ status: "unknown", exitCode: null });
  });

  it("ignores commands that only mention a test tool, such as reading its config file", () => {
    for (const command of [
      "cat pytest.ini; ls src/legacy",
      "cat jest.config.js",
      "grep -r npm-test docs",
    ]) {
      runHook("record-test-result.mjs", {
        hook_event_name: "PostToolUse",
        session_id: "session-a",
        tool_name: "Bash",
        tool_input: { command },
        tool_response: { stdout: "", stderr: "", interrupted: false },
      });
    }

    expect(fs.existsSync(path.join(projectDir, resultsFile))).toBe(false);
  });

  it("recognizes test commands after a shell separator or with a path prefix", () => {
    runHook("record-test-result.mjs", {
      hook_event_name: "PostToolUse",
      session_id: "session-a",
      tool_name: "Bash",
      tool_input: { command: "cd /project && .venv/bin/pytest -q" },
      tool_response: { stdout: "", stderr: "", interrupted: false },
    });
    runHook("record-test-result.mjs", {
      hook_event_name: "PostToolUse",
      session_id: "session-a",
      tool_name: "Bash",
      tool_input: { command: "cd /project; npx jest --runInBand tests/a.test.ts" },
      tool_response: { stdout: "", stderr: "", interrupted: false },
    });

    const results = readResults();
    expect(results.pytest.status).toBe("passed");
    expect(results.jest.status).toBe("passed");
  });

  it("ignores Bash commands that are not test runs", () => {
    const result = runHook("record-test-result.mjs", {
      hook_event_name: "PostToolUse",
      session_id: "session-a",
      tool_name: "Bash",
      tool_input: { command: "git status --short" },
      tool_response: { stdout: "", stderr: "", interrupted: false },
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(projectDir, resultsFile))).toBe(false);
  });
});

describe("session-end hook", () => {
  beforeEach(() => {
    git("init", "-q");
    writeFile("sessions/07-old.md", "# Session 07\n");
    writeFile("sessions/08-agent-rig.md", "# Session 08\n");
    writeFile("README.md", "first\n");
    git("add", ".");
    git("commit", "-q", "-m", "Initial test commit");
    writeFile("README.md", "changed\n");
  });

  it("writes the first automatic log as 00-session-end.md with the session facts", () => {
    const result = runHook("session-end.mjs", sessionEndEvent());

    expect(result.status).toBe(0);
    const log = readFile(path.join(automaticDir, "00-session-end.md"));
    expect(log).toContain("# Automatic Session Log 00");
    expect(log).toMatch(
      /\*\*Date:\*\* \d{4}-\d{2}-\d{2} \d{2}:\d{2} Australia\/Sydney \(UTC\+1[01]:00\)/,
    );
    expect(log).toContain("**Session ID:** session-a");
    expect(log).toContain("**End reason:** prompt_input_exit");
    expect(log).toContain("**Latest curated log:** `sessions/08-agent-rig.md`");
    expect(log).toContain("Initial test commit");
    expect(log).toContain(" M README.md");
    expect(log).toContain("No test runs recorded during this session.");
  });

  it("numbers the log after the highest existing automatic log", () => {
    writeFile("sessions/automatic/00-session-end.md", "# old\n");
    writeFile("sessions/automatic/01-session-end.md", "# old\n");

    runHook("session-end.mjs", sessionEndEvent());

    expect(fs.existsSync(path.join(projectDir, automaticDir, "02-session-end.md"))).toBe(true);
  });

  it("reports only the test runs recorded during the current session", () => {
    const results: TestResults = {
      jest: {
        suite: "TypeScript tests (Jest)",
        command: "npm test",
        status: "passed",
        exitCode: 0,
        recordedAt: "2026-11-17T03:05:00.000Z",
        sessionId: "session-a",
      },
      pytest: {
        suite: "Python tests (pytest)",
        command: ".venv/bin/pytest",
        status: "failed",
        exitCode: 1,
        recordedAt: "2026-11-16T03:05:00.000Z",
        sessionId: "session-old",
      },
    };
    writeFile(resultsFile, JSON.stringify(results));

    runHook("session-end.mjs", sessionEndEvent("session-a"));

    const log = readFile(path.join(automaticDir, "00-session-end.md"));
    expect(log).toMatch(/TypeScript tests \(Jest\) \| passed \| `npm test` \|/);
    expect(log).not.toContain("Python tests (pytest)");
    expect(log).not.toContain("No test runs recorded during this session.");
  });

  it("reports no test runs when all recorded runs are from earlier sessions", () => {
    const results: TestResults = {
      jest: {
        suite: "TypeScript tests (Jest)",
        command: "npm test",
        status: "passed",
        exitCode: 0,
        recordedAt: "2026-11-16T03:05:00.000Z",
        sessionId: "session-old",
      },
    };
    writeFile(resultsFile, JSON.stringify(results));

    runHook("session-end.mjs", sessionEndEvent("session-a"));

    const log = readFile(path.join(automaticDir, "00-session-end.md"));
    expect(log).toContain("No test runs recorded during this session.");
    expect(log).not.toContain("TypeScript tests (Jest)");
  });

  it("reports a pytest run that collected no tests separately from a failure", () => {
    const results: TestResults = {
      pytest: {
        suite: "Python tests (pytest)",
        command: "npm run test:legacy",
        status: "no-tests-collected",
        exitCode: 5,
        recordedAt: "2026-11-17T03:05:00.000Z",
        sessionId: "session-a",
      },
    };
    writeFile(resultsFile, JSON.stringify(results));

    runHook("session-end.mjs", sessionEndEvent("session-a"));

    const log = readFile(path.join(automaticDir, "00-session-end.md"));
    expect(log).toMatch(/Python tests \(pytest\) \| no tests collected \(exit code 5\) \|/);
    expect(log).not.toContain("failed");
  });
});

describe("load-session-log hook", () => {
  beforeEach(() => {
    writeFile("sessions/07-old.md", "# Session 07 content\n");
    writeFile("sessions/08-agent-rig.md", "# Session 08 content\n");
  });

  it("loads only the latest automatic log when one exists", () => {
    writeFile("sessions/automatic/01-session-end.md", "# Automatic 01 content\n");
    writeFile("sessions/automatic/02-session-end.md", "# Automatic 02 content\n");

    const result = runHook("load-session-log.mjs", { hook_event_name: "SessionStart" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Latest automatic session log: automatic/02-session-end.md");
    expect(result.stdout).toContain("# Automatic 02 content");
    expect(result.stdout).not.toContain("# Automatic 01 content");
    expect(result.stdout).not.toContain("# Session 08 content");
  });

  it("falls back to the latest curated log when there is no automatic log", () => {
    const result = runHook("load-session-log.mjs", { hook_event_name: "SessionStart" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Latest project session log: 08-agent-rig.md");
    expect(result.stdout).toContain("# Session 08 content");
  });

  it("falls back to the curated log when the automatic folder holds no logs", () => {
    writeFile(resultsFile, "{}");

    const result = runHook("load-session-log.mjs", { hook_event_name: "SessionStart" });

    expect(result.stdout).toContain("Latest project session log: 08-agent-rig.md");
  });
});
