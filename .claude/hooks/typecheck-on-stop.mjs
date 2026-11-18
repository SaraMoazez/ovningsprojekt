// Stop hook. Runs the type check once at the end of Claude's turn, but only if a TypeScript file
// was changed in this session since the last passing type check (see check-edited-file.mjs).
import { spawnSync } from "node:child_process";
import { access, unlink } from "node:fs/promises";
import path from "node:path";
import { pendingTypecheckPath, projectDirFrom, readStdin, truncate } from "./quality-state.mjs";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

try {
  const event = JSON.parse(await readStdin());
  const projectDir = projectDirFrom(event);
  const marker = pendingTypecheckPath(projectDir, event.session_id);

  if (await exists(marker)) {
    const result = spawnSync(path.join(projectDir, "node_modules", ".bin", "tsc"), ["--noEmit"], {
      cwd: projectDir,
      encoding: "utf8",
    });
    const output = result.error
      ? `Could not run tsc: ${result.error.message}`
      : `${result.stdout}${result.stderr}`.trim();

    if (!result.error && result.status === 0) {
      await unlink(marker);
    } else if (event.stop_hook_active) {
      // Claude has already been sent back once in this turn. Blocking again could loop on an
      // error Claude cannot fix, so tell the user instead. The marker stays, so the check runs
      // again at the end of the next turn.
      console.log(
        JSON.stringify({
          systemMessage: truncate(`Type check still fails after a retry:\n${output}`),
        }),
      );
    } else {
      const reason = truncate(
        "`npm run typecheck` failed after TypeScript files were changed. " +
          `Fix these errors before finishing.\n\n${output}`,
      );
      console.log(JSON.stringify({ decision: "block", reason }));
    }
  }
} catch (error) {
  // Exit 1 is a non-blocking error: the user sees a notice, Claude can still stop.
  console.error(`Could not run type check: ${error.message}`);
  process.exitCode = 1;
}
