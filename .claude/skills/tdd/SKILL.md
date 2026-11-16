---
name: tdd
description: Implement a single approved implementation plan step using test-driven development. Invoke with /tdd <plan-file> <step-number>.
argument-hint: <plan-file> <step-number>
---

You are going to implement the specified step from the implementation plan:

$ARGUMENTS

Work in the following order and do not skip any steps:

1. Read `CLAUDE.md`, the relevant sections of `docs/standard.md`, and the specified implementation plan.

2. Validate the arguments and locate the requested implementation step.
  - Verify that the plan's status field is `Status: **Approved.**`.
  - If the plan is not approved, or the requested step is unclear, stop and ask the user.
  - Implement only the specified step.

3. Inspect the relevant source code and existing tests. Follow the testing strategy defined in the implementation plan.


4. TDD LOOP:
  Repeat the RED-GREEN-REFACTOR cycle for each small behavior required by the specified plan step.

  - Work only on behaviors explicitly included in the current plan step.
  - Complete one behavior at a time.
  - Stop the loop when all requirements and verification criteria for the plan step are satisfied.

  a. RED:
    - Write ONE small test for the next single behavior in the existing `tests/` directory, following the project's test structure.
    - Do not modify production code.
    - Run the test and verify that it fails for the expected reason.
    - If it passes already or fails for an unrelated reason, stop and explain why.

  b. GREEN:
    - Write the **minimum amount of code** required to pass the failing test.
    - Run the test and verify that it passes.
   
  c. REFACTOR:
    - Clean up duplication and naming within the scope of this step without changing behavior.
    - Run the tests again to confirm they stay green.

5. FINAL VERIFICATION:
  - Run the full test suite and relevant project typechecks and linters defined in `CLAUDE.md`.
  - Verify that all checks pass and report any warnings separately.
  - If a check fails, investigate and report the cause. Do not continue blindly.

6. PRESENT RESULTS:
  - Summarize the implementation and explain any deviations from the plan.
  - List created and modified files.
  - Show `git diff --stat` and the complete diff.
  - Show the actual test and verification results.
  - Wait for user review. Do not commit or proceed to the next step.

Rules:
- Never delete, disable, skip, weaken, or bypass existing tests.
- Never modify existing tests merely to make them pass.
- Never change test configuration to bypass failures.
- Always activate the project's `.venv` before running Python-related commands. Never rely on the system Python installation.
- Do not modify unrelated code to resolve pre-existing warnings or failures.
- Do not implement additional functionality outside the specified plan step.
- Never claim a test passed unless it was actually executed successfully.
- If the RED phase cannot be demonstrated, stop before modifying production code.
- Do not commit or push changes.
