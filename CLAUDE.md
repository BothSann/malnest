# CLAUDE.md

malnest is a self-hosted NestJS API that scans uploaded files for malware (ClamAV, VirusTotal hash lookup, file type check, zip bomb check) and returns `clean`, `suspicious`, or `malicious`.

This is a learning project. The owner is learning NestJS, security, CI/CD, and infrastructure. Explain non-obvious choices briefly, and prefer clear code over clever code.

@AGENTS.md

## Docs are the source of truth

Read the docs that match your task before writing code:

| Doc | Answers |
|---|---|
| `docs/PRODUCT_SPEC.md` | What are we building, for whom, and what is out of scope? |
| `docs/BUSINESS_RULES.md` | Exact behavior rules (`BR-xx`): statuses, verdict logic, limits, access. |
| `docs/REQUIREMENTS.md` | Testable requirements (`FR-xx`, `NFR-xx`) and endpoints. |
| `docs/ARCHITECTURE.md` | Apps, modules, queues, scan flow, tokens, deployment. |
| `docs/DATA_MODEL.md` | Tables, columns, indexes, Redis keys, job payloads, report shape. |
| `docs/TECH_STACK.md` | Allowed libraries and tools, and why. |
| `docs/TASK_PLAN.md` | Milestones and tasks (`T-xx`) in build order. |

## Working rules

- Work on one task from `docs/TASK_PLAN.md` at a time. Do not build ahead of the plan.
- If the code needs to differ from a doc, stop and say so. If the owner agrees, update the doc in the same PR as the code.
- Do not add a dependency that is not in `docs/TECH_STACK.md` without asking.
- Reference rule and requirement IDs in tests, for example `it('marks EICAR as malicious (BR-13)')`.
- When something is unclear, ask instead of guessing.

## Commands

```bash
bun install             # install deps
bun run services:up     # start Postgres, Redis, ClamAV, MinIO in Docker
bun run dev             # run the app in watch mode
bun run check           # typecheck + lint + format check + unit tests
bun run test            # unit tests (Vitest), never `bun test`
bun run test:e2e
bun run build
```
