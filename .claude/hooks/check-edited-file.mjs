// PostToolUse hook for Edit and Write. Runs ESLint and a Prettier check on the edited file only,
// and marks the session for a type check at the end of the turn. The type check is not run here,
// because it checks the whole project and code is often briefly broken in the middle of a change.
import { spawnSync } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pendingTypecheckPath, projectDirFrom, readStdin, truncate } from "./quality-state.mjs";

// Same scope as the project scripts: `npm run lint` and `npm run format:check` cover src and
// tests, and tsconfig.json also includes scripts.
const lintScope = ["src", "tests"];
const typecheckScope = ["src", "tests", "scripts"];

async function resolved(filePath) {
  try {
    return await realpath(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

// Runs a locally installed tool. Returns its output when it fails, or null when it passes.
function failureOutput(projectDir, tool, args) {
  const result = spawnSync(path.join(projectDir, "node_modules", ".bin", tool), args, {
    cwd: projectDir,
    encoding: "utf8",
  });
  if (result.error) return `Could not run ${tool}: ${result.error.message}`;
  if (result.status === 0) return null;
  return `${result.stdout}${result.stderr}`.trim();
}

try {
  const event = JSON.parse(await readStdin());
  const projectDir = await resolved(projectDirFrom(event));
  const filePath = event.tool_input?.file_path;

  if (typeof filePath === "string" && filePath.endsWith(".ts")) {
    const relativePath = path.relative(projectDir, await resolved(filePath));
    const topDir = relativePath.split(path.sep)[0];
    const insideProject = !relativePath.startsWith("..") && !path.isAbsolute(relativePath);

    if (insideProject && typecheckScope.includes(topDir)) {
      const marker = pendingTypecheckPath(projectDir, event.session_id);
      await mkdir(path.dirname(marker), { recursive: true });
      await writeFile(marker, "");
    }

    if (insideProject && lintScope.includes(topDir)) {
      const findings = [];
      const eslint = failureOutput(projectDir, "eslint", [relativePath]);
      if (eslint !== null) findings.push(`ESLint:\n${eslint}`);
      const prettier = failureOutput(projectDir, "prettier", ["--check", relativePath]);
      if (prettier !== null) {
        findings.push(`Prettier (the file is not formatted; run \`npm run format\`):\n${prettier}`);
      }

      if (findings.length > 0) {
        const reason = truncate(
          `Quality checks failed for ${relativePath}. Fix these before continuing.\n\n` +
            findings.join("\n\n"),
        );
        console.log(JSON.stringify({ decision: "block", reason }));
      }
    }
  }
} catch (error) {
  // Exit 1 is a non-blocking error: the user sees a notice, the tool call is not affected.
  console.error(`Could not run quality checks: ${error.message}`);
  process.exitCode = 1;
}
