// Stop hook. Protects the tests (CLAUDE.md and docs/standard.md: tests are never deleted, skipped
// or weakened to make the suite pass). It compares the test files in the working tree with the
// last commit, so it catches changes made through Edit, Write, Bash or any other route.
//
// It reports a test file that was deleted or renamed, an added skip or only marker, and a file
// with fewer test cases. A justified change is allowed, so the hook does not forbid it: the
// first time, it sends Claude back to restore the tests or explain the change. If the same
// findings are still there at the next stop, it tells the user instead, and then stays silent
// until the findings change. Weakened assertions cannot be detected reliably and need review.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectDirFrom, readStdin, sessionStatePath, truncate } from "./quality-state.mjs";

// Same files as the Jest testMatch in jest.config.js.
const isTestFile = (file) => file.startsWith("tests/") && file.endsWith(".test.ts");

// `it(` and `test(`. A skipped `it.skip(` is not counted here, but as a marker below.
const testCasePattern = /\b(?:it|test)\s*\(/g;
const markerPattern =
  /\b(?:it|test|describe)\.(?:skip|only)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(/g;

// Removes comments and the contents of string literals, so that markers and test calls in
// fixtures or comments are not counted. `${...}` inside template literals is removed as well.
function codeOnly(text) {
  let code = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];
    if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (char === '"' || char === "'" || char === "`") {
      i++;
      while (i < text.length && text[i] !== char) i += text[i] === "\\" ? 2 : 1;
      i++;
      code += '""';
    } else {
      code += char;
      i++;
    }
  }
  return code;
}

const count = (text, pattern) => (codeOnly(text).match(pattern) ?? []).length;

function git(projectDir, args) {
  return execFileSync("git", args, {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const lines = (output) => output.split("\n").filter((line) => line !== "");

function hasCommit(projectDir) {
  try {
    git(projectDir, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

async function findingsFor(projectDir) {
  const committed = lines(
    git(projectDir, ["ls-tree", "-r", "--name-only", "HEAD", "--", "tests"]),
  ).filter(isTestFile);
  const current = [
    ...lines(git(projectDir, ["ls-files", "--", "tests"])),
    ...lines(git(projectDir, ["ls-files", "--others", "--exclude-standard", "--", "tests"])),
  ].filter((file) => isTestFile(file) && existsSync(path.join(projectDir, file)));

  const findings = [];
  for (const file of [...new Set([...committed, ...current])].sort()) {
    if (!current.includes(file)) {
      findings.push(`${file}: deleted or renamed`);
      continue;
    }
    const before = committed.includes(file) ? git(projectDir, ["show", `HEAD:${file}`]) : "";
    const after = await readFile(path.join(projectDir, file), "utf8");

    const markers = [count(before, markerPattern), count(after, markerPattern)];
    if (markers[1] > markers[0]) {
      findings.push(`${file}: skip or only markers: ${markers[0]} → ${markers[1]}`);
    }
    const cases = [count(before, testCasePattern), count(after, testCasePattern)];
    if (cases[1] < cases[0]) {
      findings.push(`${file}: test cases: ${cases[0]} → ${cases[1]}`);
    }
  }
  return findings;
}

async function readState(statePath) {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return null;
  }
}

try {
  const event = JSON.parse(await readStdin());
  const projectDir = projectDirFrom(event);

  if (hasCommit(projectDir)) {
    const statePath = sessionStatePath(projectDir, "test-protection", event.session_id);
    const findings = await findingsFor(projectDir);
    const list = findings.map((finding) => `- ${finding}`).join("\n");

    if (findings.length === 0) {
      await rm(statePath, { force: true });
    } else {
      const state = await readState(statePath);
      const unchanged =
        state !== null && JSON.stringify(state.findings) === JSON.stringify(findings);

      if (!unchanged) {
        const reason = truncate(
          "Test protection: these changes to the tests were found, compared with the last commit:\n" +
            `${list}\n\n` +
            "CLAUDE.md and docs/standard.md: never delete, disable, skip or weaken tests just to " +
            "make the suite pass. Restore the tests. If the change is an intentional and justified " +
            "behaviour change, explain to the user why it is needed.",
        );
        console.log(JSON.stringify({ decision: "block", reason }));
        await mkdir(path.dirname(statePath), { recursive: true });
        await writeFile(statePath, JSON.stringify({ findings, told: "claude" }));
      } else if (state.told === "claude") {
        const systemMessage = truncate(
          "Test protection: Claude was asked about these test changes, and they are still " +
            `present. Review them before committing:\n${list}`,
        );
        console.log(JSON.stringify({ systemMessage }));
        await writeFile(statePath, JSON.stringify({ findings, told: "user" }));
      }
    }
  }
} catch (error) {
  // Exit 1 is a non-blocking error: the user sees a notice, Claude can still stop.
  console.error(`Could not run test protection: ${error.message}`);
  process.exitCode = 1;
}
