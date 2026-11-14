# Session 00 – Baseline

**Datum:** 2026-11-14
**Fas:** Förberedelse och nulägesanalys

## 1. Projektets syfte

Projektet är ett övningsprojekt för Delkurs 2: AI-assisterad systemutveckling.
Det innehåller ett REST-API för kunder och beställningar i TypeScript med tester samt en äldre Python modul för prisberäkning.

## 2. Befintlig teknik och verktyg

- TypeScript och Node.js
- Express
- PostgreSQL
- Jest och Supertest
- Python och pytest
- ESLint
- Prettier
- Docker Compose

## 3. Befintliga kvalitetskontroller

- npm test
- npm run test:legacy
- npm run lint
- npm run typecheck
- npm run format:check

## 4. Befintlig AI-konfiguration

- .claude/agents/ finns men innehåller endast .gitkeep.
- .claude/skills/ finns men innehåller endast .gitkeep.
- CLAUDE.md saknas.
- sessions/ innehöll endast .gitkeep.
- Hooks och agentkonfigurationer har ännu inte implementerats.

## 5. Säkerhetsåtgärder

Python-miljön .venv var tidigare spårad av Git.
Den har tagits bort från Git-indexet och lagts till i .gitignore.
Den lokala virtuella miljön har behållits.

.env är ignorerad av Git.

## 6. Beslut och plan

AI-riggen byggs stegvis och förändringar ska versionshanteras i separata, spårbara commits.

Planerade delar:
- CLAUDE.md
- Minst tre skills och slash commands
- Minst fyra subagents
- Minst fem Hooks inklusive en kedja för att ladda och spara sessionens läge
- Permissions
- Sessionsloggning
- Testdrivet utvecklingsflöde
- Automatisk kodstandard genom ESLint, Prettier och TypeScript typecheck

## 7. Nästa steg

Skapa CLAUDE.md med projektets gemensamma instruktioner.
