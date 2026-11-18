import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Tests for the code quality hooks in .claude/hooks/.
// Each hook runs as a separate Node process against a temporary project directory that uses
// this project's ESLint, Prettier and TypeScript configuration and its installed node_modules.

const repoRoot = path.join(__dirname, "..");
const hooksDir = path.join(repoRoot, ".claude", "hooks");
const configFiles = ["package.json", "eslint.config.js", ".prettierrc.json", "tsconfig.json"];

interface HookResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface HookOutput {
  decision?: string;
  reason?: string;
  systemMessage?: string;
}

let projectDir: string;

function runHook(script: string, input: object): HookResult {
  const result = spawnSync("node", [path.join(hooksDir, script)], {
    input: JSON.stringify(input),
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function parseOutput(result: HookResult): HookOutput {
  return JSON.parse(result.stdout) as HookOutput;
}

function writeFile(relativePath: string, content: string): void {
  const fullPath = path.join(projectDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function editEvent(relativePath: string, toolName = "Edit", sessionId = "session-a"): object {
  return {
    hook_event_name: "PostToolUse",
    session_id: sessionId,
    cwd: projectDir,
    tool_name: toolName,
    tool_input: { file_path: path.join(projectDir, relativePath) },
    tool_response: {},
  };
}

function stopEvent(sessionId = "session-a", stopHookActive = false): object {
  return {
    hook_event_name: "Stop",
    session_id: sessionId,
    cwd: projectDir,
    stop_hook_active: stopHookActive,
  };
}

function pendingMarker(sessionId = "session-a"): string {
  return path.join(projectDir, ".claude", "state", "typecheck-pending", sessionId);
}

const cleanCode = "export const answer: number = 42;\n";
const lintError = "const unused = 1;\nexport const answer = 42;\n";
const unformatted = "export const answer   =   42\n";
const typeError = 'export const answer: number = "forty-two";\n';

beforeEach(() => {
  projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "quality-hooks-")));
  for (const file of configFiles) {
    fs.copyFileSync(path.join(repoRoot, file), path.join(projectDir, file));
  }
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(projectDir, "node_modules"));
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("check-edited-file hook", () => {
  it("prints nothing for a clean TypeScript file and marks the session for a type check", () => {
    writeFile("src/clean.ts", cleanCode);

    const result = runHook("check-edited-file.mjs", editEvent("src/clean.ts"));

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(fs.existsSync(pendingMarker())).toBe(true);
  });

  it("blocks with the ESLint errors when the edited file has lint errors", () => {
    writeFile("src/lint-error.ts", lintError);

    const result = runHook("check-edited-file.mjs", editEvent("src/lint-error.ts"));

    expect(result.status).toBe(0);
    const output = parseOutput(result);
    expect(output.decision).toBe("block");
    expect(output.reason).toContain("src/lint-error.ts");
    expect(output.reason).toContain("ESLint");
    expect(output.reason).toContain("no-unused-vars");
  });

  it("blocks with a Prettier finding when a written file is not formatted", () => {
    writeFile("tests/unformatted.ts", unformatted);

    const result = runHook("check-edited-file.mjs", editEvent("tests/unformatted.ts", "Write"));

    const output = parseOutput(result);
    expect(output.decision).toBe("block");
    expect(output.reason).toContain("Prettier");
    expect(output.reason).not.toContain("ESLint");
  });

  it("does not lint files outside the lint scope, but marks them for the type check", () => {
    writeFile("scripts/tool.ts", lintError);

    const result = runHook("check-edited-file.mjs", editEvent("scripts/tool.ts"));

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(fs.existsSync(pendingMarker())).toBe(true);
  });

  it("ignores files that are not TypeScript", () => {
    writeFile("src/notes.md", "not   formatted\n");

    const result = runHook("check-edited-file.mjs", editEvent("src/notes.md"));

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(fs.existsSync(pendingMarker())).toBe(false);
  });

  it("ignores TypeScript files outside the project directory", () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-hooks-outside-"));
    const outsideFile = path.join(outsideDir, "outside.ts");
    fs.writeFileSync(outsideFile, lintError);

    const result = runHook("check-edited-file.mjs", {
      ...editEvent("unused.ts"),
      tool_input: { file_path: outsideFile },
    });
    fs.rmSync(outsideDir, { recursive: true, force: true });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(fs.existsSync(pendingMarker())).toBe(false);
  });
});

describe("typecheck-on-stop hook", () => {
  it("does nothing when no TypeScript file was changed in the session", () => {
    writeFile("src/type-error.ts", typeError);

    const result = runHook("typecheck-on-stop.mjs", stopEvent());

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("blocks with the type errors and keeps the marker when the type check fails", () => {
    writeFile("src/type-error.ts", typeError);
    writeFile(".claude/state/typecheck-pending/session-a", "");

    const result = runHook("typecheck-on-stop.mjs", stopEvent());

    expect(result.status).toBe(0);
    const output = parseOutput(result);
    expect(output.decision).toBe("block");
    expect(output.reason).toContain("TS2322");
    expect(fs.existsSync(pendingMarker())).toBe(true);
  });

  it("prints nothing and removes the marker when the type check passes", () => {
    writeFile("src/clean.ts", cleanCode);
    writeFile(".claude/state/typecheck-pending/session-a", "");

    const result = runHook("typecheck-on-stop.mjs", stopEvent());

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(fs.existsSync(pendingMarker())).toBe(false);
  });

  it("does not block again when Claude is already continuing because of a stop hook", () => {
    writeFile("src/type-error.ts", typeError);
    writeFile(".claude/state/typecheck-pending/session-a", "");

    const result = runHook("typecheck-on-stop.mjs", stopEvent("session-a", true));

    expect(result.status).toBe(0);
    const output = parseOutput(result);
    expect(output.decision).toBeUndefined();
    expect(output.systemMessage).toContain("TS2322");
    expect(fs.existsSync(pendingMarker())).toBe(true);
  });

  it("ignores a marker that belongs to another session", () => {
    writeFile("src/type-error.ts", typeError);
    writeFile(".claude/state/typecheck-pending/session-old", "");

    const result = runHook("typecheck-on-stop.mjs", stopEvent("session-a"));

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});
