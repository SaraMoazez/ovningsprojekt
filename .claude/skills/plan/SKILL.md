---
name: plan
description: Create a structured implementation plan for a feature, bug fix, or refactoring task. Use research findings to define implementation steps, affected files, and testing strategy. Invoke with /plan <task>.
argument-hint: <task>
---

You are going to create an implementation plan for the following task:

$ARGUMENTS

Work in the following order and do not skip any steps:

1. Understand the task. Identify the expected behavior, scope, and requirements.
2. Ask the user for clarification if important information is missing or ambiguous. Do not make assumptions about important technical decisions.
3. Read `CLAUDE.md` and the relevant sections of `docs/standard.md`.
4. Locate and read the relevant research document(s) in `docs/research/`. Verify that the research matches the requested task. Use the research findings as the basis for the implementation plan. If no relevant research document exists, ask the user to run `/research` first.
5. Identify the files and components that need to be created or modified. Explain why each change is necessary.
6. Break the implementation into small, logical, ordered steps.
   - Each step must have a clear objective.
   - Each step must describe the expected changes.
   - Each step must be independently verifiable where possible.
   - Keep the steps small enough to be implemented individually using `/tdd`.
7. Define the testing strategy for each implementation step.
   - Identify relevant existing tests.
   - Specify which new tests need to be written.
   - Describe the expected behavior each test should verify.
   - Follow the project's TDD requirements.
8. Identify dependencies, risks, edge cases, security implications, and potential regressions.
9. Save the implementation plan as a Markdown file in `docs/plans/`. Use the same base filename as the relevant research document. Use the following headings:
   - Task Overview
   - Research References
   - Files to Change
   - Implementation Steps
   - Testing Strategy
   - Risks and Considerations
   - Open Questions and Assumptions
   - Include a status field directly below the document title and date: `Status: **Draft – awaiting approval.**`
10. Present the completed plan and explain how the implementation steps can be executed using `/tdd`.
  - Clearly state that the plan requires user approval before implementation.
  - Keep the status as `Status: **Draft – awaiting approval.**` until the user explicitly approves the plan.
  - Once the user explicitly approves the plan, update the status to `Status: **Approved.**`
  - Do not change the plan's content when updating its status unless requested.
  - If the plan's content is materially changed after approval, reset its status to `Status: **Draft – awaiting approval.**` and request user approval again.

Rules:
- Do not implement the requested functionality.
- Do not modify source code, tests, or configuration files.
- Only create or modify the implementation plan in `docs/plans/`.
- Never delete or remove project files or directories.
- Do not overwrite an existing implementation plan without asking the user for confirmation.
- Do not execute tests or commands that modify project state.
- Keep implementation steps specific, small, and independently verifiable where possible.
- Base the plan on actual research findings and code inspection.
- Clearly distinguish verified facts from assumptions.
- Ask the user for clarification when important requirements or technical decisions are unclear.
- Never invent files, dependencies, test results, or technical requirements.
- Never mark an implementation plan as approved without explicit user approval.
- Do not commit or push changes.
