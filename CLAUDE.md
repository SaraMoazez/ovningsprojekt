# Project Instructions

## 1. Project Overview

This project contains:
- A TypeScript REST API for customers and orders.
- A legacy Python module for price calculations.
- A PostgreSQL database.

The goal is to develop and maintain the project using
a secure, test-driven and traceable development process.

## 2. Technology Stack

- Node.js and TypeScript
- Express
- PostgreSQL
- Python
- Jest and Supertest
- pytest
- ESLint
- Prettier
- Docker Compose

## 3. Development Commands

Use the existing project scripts:

- `npm test` - Run TypeScript tests.
- `npm run test:legacy` - Run Python tests.
- `npm run lint` - Run ESLint.
- `npm run typecheck` - Run TypeScript type checking.
- `npm run format:check` - Check formatting.
- `npm run db:up` - Start the database using Docker Compose.
- `python3 -m venv .venv` - Create the project's Python virtual environment if it does not exist.
- `.venv/bin/pytest` - Run Python tests using the project's virtual environment.

## 4. Python Virtual Environment

- Always activate the project's `.venv` before running Python-related commands.
- Use `source .venv/bin/activate` to activate the virtual environment.
- Always use the Python interpreter and dependencies from `.venv`.
- Never rely on the system Python installation for project commands.
- Never install Python dependencies globally.

## 5. Coding Style

- Write all code, comments, and documentation in English.
- Use strict TypeScript and avoid the any type. Prefer explicit types and type safety.
- Follow the existing project structure and established coding patterns.
- Reuse existing components, functions, and utilities before creating new ones.
- Prefer simple solutions over unnecessary complexity.
- Avoid duplicating code.
- Before creating or modifying components, API endpoints, database logic, or tests, read and follow the relevant rules in `docs/standard.md`.

## 6. Workflow & Verification
- Keep changes focused and do not modify unrelated code.
- Run `npm run lint`, `npm run typecheck`, and `npm run format:check` after making code changes.
- Run relevant tests (`npm test`, `npm run test:legacy` and/or `.venv/bin/pytest`) after making code changes.
- Verify that all relevant checks pass before considering a task complete.
- Run verification commands one at a time rather than combining them.
- Review each command's output before proceeding to the next command.
- If a command fails, investigate and report the cause before continuing.

## 7. Testing Requirements

Follow Test-Driven Development (TDD) when implementing new functionality or fixing bugs.

The expected workflow is:
1. Inspect relevant parts of the codebase, understand existing behavior, and identify relevant existing tests.
2. Define the expected behavior and write or update tests before implementing the changes.
3. Run the new or updated tests and verify that they fail for the expected reason.
4. Implement the smallest necessary change to make the tests pass.
5. Run the tests again and verify that they pass.
6. Run relevant regression tests to ensure existing functionality has not been broken.

Additional requirements:

- Never delete, disable, skip or weaken tests just to make
the test suite pass.
- Do not modify existing tests unless required to reflect an intentional and justified behavior change.
- Explain the reason for any changes to existing tests.
- Do not change implementation code merely to satisfy a test if doing so violates the expected behavior or project standards.
- Never claim that a test passed unless it was actually executed and passed.

## 8. Security

- Never use production data or real customer information.
- Never expose secrets, API keys or credentials.
- Do not read or print `.env` files.
- Do not commit secrets or local environment files.
- Ask for approval before destructive operations,
  database resets or potentially irreversible changes.

## 9. Documentation and Traceability

- Create and maintain Architectural Decision Records (ADRs) in `docs/adr/` for significant architectural decisions.
- Propose ADRs when significant architectural decisions arise. Explain the decision, considered alternatives and rationale.
- Record development sessions in `sessions/` after completing implementation tasks.
- Session logs must include status, changes made, evidence, failures, decisions and remaining work.
- Never invent test results, measurements, evidence or completed work.
- Ask for clarification when important decisions or information cannot be determined from the codebase or conversation.