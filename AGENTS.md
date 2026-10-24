# AGENTS.md

malnest is a NestJS 12 file malware scanner. The API takes uploads and stores them in a private quarantine bucket, and a BullMQ worker scans them with ClamAV, VirusTotal (hash lookup), a file type check, and a zip bomb check.

The full coding rules live in `.claude/rules/`. Read the files that match your task before writing code. They apply to every agent, not only Claude.

## Rule files

| File | Read it when you touch |
|---|---|
| `.claude/rules/00-project.md` | Anything. Read this first. |
| `.claude/rules/architecture.md` | Modules, folders, services, events |
| `.claude/rules/dependency-injection.md` | Providers, injection tokens, scopes |
| `.claude/rules/error-handling.md` | Exceptions, filters, try/catch, async code |
| `.claude/rules/security.md` | Validation, guards, API keys, CORS, rate limits, webhooks |
| `.claude/rules/file-safety.md` | Uploads, storage, file types, archives, VirusTotal |
| `.claude/rules/database.md` | Entities, repositories, migrations, queries |
| `.claude/rules/api-design.md` | Routes, DTOs, status codes, Swagger |
| `.claude/rules/queues-and-workers.md` | BullMQ jobs, the worker, retries, health checks |
| `.claude/rules/testing.md` | Unit tests and e2e tests |
| `.claude/rules/config-and-ops.md` | Env vars, logging, shutdown, Docker, CI |
| `.claude/rules/git.md` | Branches, commits, pushes, pull requests |

## Rules you must never break

- Use **bun** for packages and scripts. Run tests with `bun run test` / `bun run test:e2e` (Vitest), never `bun test`.
- Relative imports end in `.js` (ESM, `nodenext`).
- Modular monolith with DDD: a context imports another only through its `index.ts`. `domain/` never imports NestJS, Drizzle, or any I/O. See `docs/ARCHITECTURE.md`.
- Never execute, import, or open an uploaded file. Only read its bytes.
- Never upload a user's file to VirusTotal without opt-in. Look up by hash.
- Tests use the EICAR test string only, never real malware.
- Never commit secrets or `.env`. Never read `process.env` outside the config module.
- Never commit, push, or merge unless the owner asks. Never force-push `main`. Use Conventional Commits.
- Before saying a task is done, run `bun run check` and `bun run build`, and report the result.
