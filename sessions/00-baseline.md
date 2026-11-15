# Session 00 – Baseline

**Date:** 2026-11-14
**Phase:** Preparation and Initial Assessment
**Status:** Initial baseline documented

## 1. Project purpose

This project is a practical exercise for Course Module 2: AI-Assisted Software Development.

It contains a REST API for customers and orders, implemented in TypeScript, with automated tests, as well as a legacy Python module for price calculations.

The purpose of the project is to establish a structured foundation for implementing an AI-assisted development workflow.

## 2. Existing technology and tools

- TypeScript and Node.js
- Express
- PostgreSQL
- Jest and Supertest
- Python and pytest
- ESLint
- Prettier
- Docker Compose

## 3. Existing quality checks

- npm test
- npm run test:legacy
- npm run lint
- npm run typecheck
- npm run format:check

## 4. Initial AI configuration

- .claude/agents/ exists but contains only .gitkeep.
- .claude/skills/ exists but contains only .gitkeep.
- CLAUDE.md has not yet been created.
- sessions/ contains only .gitkeep.
- Hooks and agent configurations has not yet been implemented.

## 5. Existing security measures

- The Python virtual environment (.venv) was previously tracked by Git.
- It was removed from the Git index and added to .gitignore.
- The local virtual environment was retained.
- .env was excluded from Git tracking.

## 6. Decisions and implementation plan

The AI rig will be developed incrementally. Changes should be version controlled through separate, traceable commits.

The planned components include:
- CLAUDE.md
- At least three reusable skills and slash commands.
- At least four subagents.
- At least five hooks, including a chain for loading and saving session state.
- Permission configuration.
- Session logging.
- A test-driven development workflow.
- Automated code quality checks using ESLint, Prettier and TypeScript type checking.

## 7. Initial next step

Create CLAUDE.md containing the project's shared instructions and development standards.