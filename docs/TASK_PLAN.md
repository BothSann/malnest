# Task Plan

Work goes milestone by milestone. Each task becomes one GitHub issue, one branch, and one PR (see the Issue and PR Contract in the git rules). Tick a task only when its PR is merged and CI is green.

Task IDs (`T-xx`) go in issue titles. Requirement IDs (`FR`/`NFR`), rule IDs (`BR`), and decision IDs (`D`) say what the task must satisfy.

The project is a modular monolith with DDD (`docs/ARCHITECTURE.md`). Within each context, build in this order: **domain → application → infrastructure → api**, with domain tests first.

## M0. Foundation

Goal: an empty but solid modular monolith with CI, so every later PR is checked automatically.

- [x] **T-01** Planning docs, agent rules, `CLAUDE.md`, `AGENTS.md`, dev scripts.
- [ ] **T-02** Modular monolith skeleton: `src/main.ts` + `ApiModule`, `src/worker.ts` + `WorkerModule`, empty `identity`, `scanning`, `webhooks` modules with their `index.ts`, `src/shared`. Remove the starter app. Add `dev:worker`/`start:worker` scripts. Pick the import alias for context entry points. Add `dependency-cruiser` rules for layers and boundaries and a `bun run arch` script inside `check`. (D8, D9)
- [ ] **T-03** `docker-compose.yml` with Postgres, Redis, ClamAV (raised stream limits), MinIO. Credentials and ports match `.env.example`.
- [ ] **T-04** Config in `shared/infrastructure/config`: zod env schema covering every key in `.env.example`, fail fast. E2E tests load `.env.test` over `.env`. (NFR-23)
- [ ] **T-05** Shared kernel: `AggregateRoot`, `DomainEvent`, `DomainError`, `ConcurrencyError`, `Clock`, `IdGenerator`. Logging with `nestjs-pino`, request IDs, global filter mapping `DomainError` codes to HTTP. (NFR-30, NFR-31)
- [ ] **T-06** CI workflow: install, `check`, build. Dependabot. GitHub issue and PR templates. (NFR-43)

## M1. Database and identity

Goal: owners and API keys exist, and every `/v1` route is protected.

- [ ] **T-07** Drizzle in `shared/infrastructure/database`: `DB_WRITER`/`DB_READER`, transaction helper, schema-per-context setup, `db:generate` and `db:migrate` scripts. (D11)
- [ ] **T-08** identity domain: `Owner` aggregate with `ApiKey` entities, value objects, errors. Unit tests for BR-26, BR-27.
- [ ] **T-09** identity persistence: tables, mapper, Drizzle `OwnerRepository` with version check, in-memory repository.
- [ ] **T-10** CLI `cli:create-owner` sending `CreateOwner`. (FR-23, BR-28)
- [ ] **T-11** `AuthenticateApiKey` query, `ApiKeyGuard` (global), `@Public()`, `@CurrentOwner()` exported from identity contracts. (FR-20, BR-24)
- [ ] **T-12** API key endpoints (`IssueApiKey`, `ListApiKeys`, `RevokeApiKey`) and per-key rate limits with Redis storage. (FR-22, FR-24, BR-26, BR-27, BR-29)

## M2. Scanning: submit and read

Goal: a file can be uploaded, hashed, stored, and read back as a queued scan.

- [ ] **T-13** scanning domain: `Scan` aggregate (status rules), value objects (`Sha256`, `FileSize`, `FileName`, `ScanStatus`, `Verdict`), errors. Unit tests for BR-01 to BR-04, BR-19.
- [ ] **T-14** `ScanResult` aggregate and `VerdictPolicy` domain service with 100% branch tests. (BR-05 to BR-17, NFR-40)
- [ ] **T-15** `FILE_STORAGE` port, S3 adapter, in-memory fake.
- [ ] **T-16** scanning persistence: tables, mappers, `ScanRepository`, `ScanResultRepository`.
- [ ] **T-17** `SubmitScan`: streaming upload, hashing, size limit, file name cleaning. `SCAN_PIPELINE` port with a fake. (FR-01 to FR-03, BR-18, BR-19)
- [ ] **T-18** `GetScan`, `ListScans`, `FindLatestScanByHash` queries and `DeleteScan`. Owner-only access. (FR-05 to FR-08, BR-23, BR-25, BR-37)
- [ ] **T-19** E2E test setup in CI with service containers.

## M3. Worker and ClamAV

Goal: uploads get scanned by ClamAV and reach `done` with a verdict.

- [ ] **T-20** Worker process: `WorkerModule`, BullMQ connection, health check, graceful shutdown. (NFR-22)
- [ ] **T-21** BullMQ `SCAN_PIPELINE` adapter (flow) and processors that only dispatch commands. (D2)
- [ ] **T-22** ClamAV `INSTREAM` adapter and `RunLocalEngines` with ClamAV only. (FR-12, BR-07, NFR-21)
- [ ] **T-23** `FinalizeScan`: load results, `scan.complete()`, save. (FR-14)
- [ ] **T-24** E2E: EICAR is `malicious`, plain text is `clean`.

## M4. More engines

Goal: all four engines feed the verdict.

- [ ] **T-25** Filetype engine. (FR-10)
- [ ] **T-26** Archive engine with `yauzl`. (FR-11, BR-20)
- [ ] **T-27** VirusTotal engine: hash lookup, limiter, daily quota. (FR-13, BR-09 to BR-11)
- [ ] **T-28** Result reuse. (FR-04, BR-21, BR-22)
- [ ] **T-29** `scan-maintenance` queue: stuck-scan sweep and retention. (FR-15, FR-42, BR-03, BR-35, BR-36)

## M5. Outbox and webhooks

Goal: owners get signed webhooks, and no event is lost or sent twice.

- [ ] **T-30** Outbox and inbox in `messaging` schema (evaluate `@nestjs/outbox` first). `ScanRepository` writes `scanning.scan-completed.v1` in the same transaction. Relay in the worker. (D10)
- [ ] **T-31** webhooks domain: `Webhook` aggregate, `WebhookUrl` value object, failure and disable rules, `WebhookDelivery`. Unit tests. (BR-30 to BR-34)
- [ ] **T-32** webhooks persistence and endpoints (`RegisterWebhook`, `RemoveWebhook`, `ListWebhooks`), URL safety checker, secret cipher. (FR-30, FR-31)
- [ ] **T-33** `scan-completed` handler with inbox, `ScheduleDeliveries`, `DeliverWebhook` processor, delivery cleanup. (FR-32, BR-33, BR-34)
- [ ] **T-34** Security e2e suite: no key, other owner's scan, oversized upload, path-traversal name, private-IP webhook.

## M6. Production

Goal: live on the internet, deployed by merging to `main`.

- [ ] **T-35** One Dockerfile, one image, `api` and `worker` start commands. Multi-stage, non-root, read-only worker. (NFR-06)
- [ ] **T-36** CI: Trivy and CodeQL, block on high/critical. (NFR-07)
- [ ] **T-37** Terraform: Hetzner VPS, firewall, R2 bucket with lifecycle rule.
- [ ] **T-38** Production compose with Caddy, deploy workflow to GHCR and the VPS.
- [ ] **T-39** OpenAPI docs: `@nestjs/swagger` CLI plugin, Scalar page at `/docs`, plugin metadata for tests. README with setup and API examples. (FR-41)

## M7. Stretch

- [ ] Live status via Server-Sent Events.
- [ ] YARA engine.
- [ ] PDF / Office macro and script detection.
- [ ] Opt-in VirusTotal upload for unknown files.
- [ ] k3s with auto-scaled workers.

## Definition of done (every task)

- The issue's acceptance criteria are met and tested.
- `bun run check` and `bun run build` pass, including the architecture check.
- Docs are updated if behavior, rules, schema, or the glossary changed.
- The PR follows the Issue and PR Contract and is rebase-merged.
