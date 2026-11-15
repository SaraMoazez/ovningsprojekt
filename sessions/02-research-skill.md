# Session 02 – Research Skill

**Date:** 2026-11-15  
**Phase:** Research skill implementation and testing

## 1. Current state

The `/research` skill has been created and tested using the following user story:

"Customers can retry an order when the network fails without creating duplicate orders."

The skill generated the research document:

`docs/research/idempotent-order-retry.md`

The research covers:
- Task understanding and expected behaviour
- Relevant files and existing implementation
- Existing tests and coverage gaps
- Risks, concurrency and security considerations
- Recommended implementation approach
- Open questions and assumptions

## 2. What worked

- The `/research` skill was successfully invoked.
- Claude inspected the relevant source files, database schema and existing tests.
- Claude asked clarifying questions before making important API design decisions.
- The skill generated a structured research document.
- The research identified concurrent requests as an important risk and recommended database-level uniqueness to prevent duplicate orders.
- The report distinguishes verified facts from assumptions and identifies areas requiring further decisions.

### Resource Usage

#### Initial research execution

Metrics reported by Claude Code using `/usage`, immediately after the initial `/research` execution.

| Metric | Result |
|---|---:|
| Total estimated cost | $0.62 |
| API duration | 1m 58s |
| Wall-clock duration | 16m 51s |
| Opus input tokens | 620 |
| Opus output tokens | 10.7k |
| Opus cache read tokens | 543.4k |
| Opus cache write tokens | 36.8k |
| Prompt cache hit rate | 92% |
| Haiku input tokens | 1.2k |
| Haiku output tokens | 21 |
| Code changes | 237 lines added, 0 removed |
| Usage attribution to `/research` | 100% |

#### Follow-up measurement

A later measurement was taken after answering the four open design questions and updating the research document.

| Metric | Result |
|---|---:|
| Total estimated cost | $0.85 |
| API duration | 2m 59s |
| Wall-clock duration | 36m 30s |
| Opus input tokens | 1.1k |
| Opus output tokens | 17.2k |
| Opus cache read tokens | 737.8k |
| Opus cache write tokens | 44.8k |
| Prompt cache hit rate | 93% |
| Haiku input tokens | 1.2k |
| Haiku output tokens | 21 |
| Code changes | 326 lines added, 40 removed |
| Usage attribution to `/research` | 72% |

**Observation:** The initial measurement provides the best reference for the research skill's initial execution. The follow-up measurement includes additional interaction and document updates, so the two measurements should not be treated as directly comparable skill-only costs.

**Note:** Token counts and costs are approximate values reported by Claude Code. Cache read tokens represent reused context, not newly generated output. The reported costs are estimated model usage costs, not additional charges to the Claude Pro subscription.

## 3. What failed

No execution failures occurred during `/research`. However, a documentation inconsistency was discovered during the subsequent `/plan` workflow.

- AC5 (per-customer idempotency key scoping) was listed both as a confirmed acceptance criterion and as an unverified assumption.
- The inconsistency was not detected during the initial research review.
- The `/plan` skill exposed the issue when checking the relationship between research findings and implementation requirements.

**Corrections made:**
- Updated the research document to consistently identify AC1-AC8 as confirmed acceptance criteria.
- Removed the contradictory AC5 assumption.
- Updated the implementation plan to reflect the confirmed requirement and improve acceptance-criteria traceability.
- Corrected the existing test count in the plan.

**Improvement identified:** The research skill should explicitly verify that confirmed acceptance criteria and unverified assumptions do not contradict each other.

## 4. What remains

- Test the `/plan` skill using the completed research document.
- Review and approve the generated implementation plan before implementation begins.

## 5. Decisions made

The following API behaviour decisions were confirmed during the research process:

| Topic | Decision |
|---|---|
| Idempotency mechanism | `Idempotency-Key` HTTP header |
| Key required? | Yes |
| Same key, different request body | `409 Conflict` |
| Same key, identical request body | `201 Created` with the original order |

The following process decisions were also made:

- Research findings are saved in `docs/research/`.
- Session logs are saved in `sessions/`.
- The research phase must be completed and reviewed before implementation planning begins.

### Evidence

- Skill definition: `.claude/skills/research/SKILL.md`
- Research output: `docs/research/idempotent-order-retry.md`
- Usage metrics: Claude Code `/usage` output from 2026-11-15