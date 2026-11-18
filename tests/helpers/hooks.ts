import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Shared helpers for tests that run the hooks in .claude/hooks/ as separate Node processes
// against a temporary project directory.

const hooksDir = path.join(__dirname, "..", "..", ".claude", "hooks");

export interface HookResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function runHook(projectDir: string, script: string, input: object): HookResult {
  const result = spawnSync("node", [path.join(hooksDir, script)], {
    input: JSON.stringify(input),
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function writeProjectFile(projectDir: string, relativePath: string, content: string): void {
  const fullPath = path.join(projectDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

export function git(projectDir: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd: projectDir, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}
