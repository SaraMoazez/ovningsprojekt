import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git, HookResult, runHook, writeProjectFile } from "./helpers/hooks";

// Tests for the Stop hook that protects tests from being deleted, skipped or removed.
// The hook compares the test files in the working tree with the last commit, so each test
// uses a temporary git repository.

interface HookOutput {
  decision?: string;
  reason?: string;
  systemMessage?: string;
}

let projectDir: string;

function write(relativePath: string, content: string): void {
  writeProjectFile(projectDir, relativePath, content);
}

function stop(sessionId = "session-a"): HookResult {
  return runHook(projectDir, "protect-tests.mjs", {
    hook_event_name: "Stop",
    session_id: sessionId,
    cwd: projectDir,
    stop_hook_active: false,
  });
}

function parseOutput(result: HookResult): HookOutput {
  return JSON.parse(result.stdout) as HookOutput;
}

const twoTests = [
  'describe("orders", () => {',
  '  it("creates an order", () => {',
  "    expect(1).toBe(1);",
  "  });",
  '  test("rejects an empty order", () => {',
  "    expect(2).toBe(2);",
  "  });",
  "});",
  "",
].join("\n");

beforeEach(() => {
  projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "protect-tests-")));
  git(projectDir, "init", "-q");
  write("tests/orders.test.ts", twoTests);
  write("tests/helpers/db.ts", "export const url = 'test';\n");
  git(projectDir, "add", ".");
  git(projectDir, "commit", "-q", "-m", "Initial test commit");
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("protect-tests hook", () => {
  it("prints nothing when the tests are unchanged", () => {
    const result = stop();

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("prints nothing when a test is added", () => {
    write("tests/orders.test.ts", twoTests.replace("});\n", '  it("new", () => {});\n});\n'));

    const result = stop();

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("ignores changes to test helpers that are not test files", () => {
    fs.rmSync(path.join(projectDir, "tests/helpers/db.ts"));

    const result = stop();

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("blocks when a committed test file is deleted", () => {
    fs.rmSync(path.join(projectDir, "tests/orders.test.ts"));

    const output = parseOutput(stop());

    expect(output.decision).toBe("block");
    expect(output.reason).toContain("tests/orders.test.ts");
    expect(output.reason).toContain("deleted or renamed");
  });

  it("blocks when a test is skipped", () => {
    write("tests/orders.test.ts", twoTests.replace('it("creates', 'it.skip("creates'));

    const output = parseOutput(stop());

    expect(output.decision).toBe("block");
    expect(output.reason).toContain("tests/orders.test.ts");
    expect(output.reason).toContain("skip or only markers: 0 → 1");
  });

  it("blocks when .only is added, because it disables the other tests", () => {
    write("tests/orders.test.ts", twoTests.replace('describe("orders"', 'describe.only("orders"'));

    const output = parseOutput(stop());

    expect(output.decision).toBe("block");
    expect(output.reason).toContain("skip or only markers: 0 → 1");
  });

  it("blocks when a test case is removed", () => {
    const oneTest = twoTests.replace(
      '  test("rejects an empty order", () => {\n    expect(2).toBe(2);\n  });\n',
      "",
    );
    write("tests/orders.test.ts", oneTest);

    const output = parseOutput(stop());

    expect(output.decision).toBe("block");
    expect(output.reason).toContain("test cases: 2 → 1");
  });

  it("blocks when a new, uncommitted test file contains a skip marker", () => {
    write("tests/customers.test.ts", 'xit("lists customers", () => {});\n');

    const output = parseOutput(stop());

    expect(output.decision).toBe("block");
    expect(output.reason).toContain("tests/customers.test.ts");
    expect(output.reason).toContain("skip or only markers: 0 → 1");
  });

  it("ignores markers and test calls inside strings and comments", () => {
    const withStrings = [
      "const fixture = 'it.skip(\"x\", () => {});';",
      'const other = "describe.only(\\"y\\")";',
      'const template = `xit("z")`;',
      "// it.skip is not allowed here",
      "/* xdescribe( */",
      twoTests,
    ].join("\n");
    write("tests/orders.test.ts", withStrings);

    const result = stop();

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("does not count test calls inside strings as test cases", () => {
    const fixtureOnly = [
      'const fixture = \'it("a", () => {}); test("b", () => {});\';',
      'it("creates an order", () => {});',
      "",
    ].join("\n");
    write("tests/orders.test.ts", fixtureOnly);

    const output = parseOutput(stop());

    expect(output.decision).toBe("block");
    expect(output.reason).toContain("test cases: 2 → 1");
  });

  it("tells the user instead of blocking when the same findings are still present", () => {
    fs.rmSync(path.join(projectDir, "tests/orders.test.ts"));
    stop();

    const output = parseOutput(stop());

    expect(output.decision).toBeUndefined();
    expect(output.systemMessage).toContain("tests/orders.test.ts");
  });

  it("stays silent after the user has been told about the same findings", () => {
    fs.rmSync(path.join(projectDir, "tests/orders.test.ts"));
    stop();
    stop();

    const result = stop();

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("blocks again when the findings change after the user was told", () => {
    write("tests/orders.test.ts", twoTests.replace('it("creates', 'it.skip("creates'));
    stop();
    stop();
    write("tests/customers.test.ts", 'xit("lists customers", () => {});\n');

    const output = parseOutput(stop());

    expect(output.decision).toBe("block");
    expect(output.reason).toContain("tests/customers.test.ts");
  });

  it("forgets earlier findings once the tests are restored", () => {
    write("tests/orders.test.ts", twoTests.replace('it("creates', 'it.skip("creates'));
    stop();
    write("tests/orders.test.ts", twoTests);
    expect(stop().stdout).toBe("");
    write("tests/orders.test.ts", twoTests.replace('it("creates', 'it.skip("creates'));

    const output = parseOutput(stop());

    expect(output.decision).toBe("block");
  });

  it("keeps the findings of different sessions apart", () => {
    fs.rmSync(path.join(projectDir, "tests/orders.test.ts"));
    stop("session-a");

    const output = parseOutput(stop("session-b"));

    expect(output.decision).toBe("block");
  });

  it("does nothing outside a git repository", () => {
    fs.rmSync(path.join(projectDir, ".git"), { recursive: true, force: true });

    const result = stop();

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});
