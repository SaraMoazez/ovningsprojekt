
---
name: research
description: Investigate a feature, bug, or refactoring task before implementation. Analyze relevant code, architecture, dependencies, and tests. Invoke with /research <task>.
argument-hint: <task>
---

You are going to investigate the following task:

$ARGUMENTS

Work in the following order and do not skip any steps:

1. Understand the task. Identify the expected behavior and any unclear requirements.
2. Ask the user for clarification if important information is missing or ambiguous. Do not make assumptions or proceed until the uncertainties are resolved.
3. Read `CLAUDE.md` and the relevant sections of `docs/standard.md`.
4. Inspect the relevant parts of the codebase. Start with targeted searches (Glob/Grep) to locate relevant files, then read only the necessary source files, dependencies, interfaces, and existing implementation patterns to keep context focused.
5. Read the relevant tests. Understand what is currently tested and identify potential coverage gaps.
6. Analyze potential risks, edge cases, security implications, and possible regressions.
7. Save the research findings as a Markdown file in `docs/research/`. Use a descriptive filename based on the task. The document must use the following headings:
  - Task Understanding
  - Relevant Files
  - Existing Implementation
  - Existing Tests
  - Risks and Considerations
  - Recommended Approach
  - Open Questions and Assumptions

Do not omit sections. If a section is not applicable or information is unavailable, explicitly state that.

Rules:
- Only create or modify the research document in `docs/research/`.
- Do not modify source code, tests, configuration files, or any other project files.
- Never delete or remove any project files or directories.
- Do not implement the requested functionality.
- Do not modify existing tests or write new tests.
- Do not overwrite an existing research document without asking the user for confirmation.
- Base findings on actual code inspection, not assumptions.
- Include file paths and line references where possible.
- Clearly distinguish verified facts from assumptions.
- Do not execute tests or other commands that modify project state.
- Wait for further instructions before proceeding with implementation.