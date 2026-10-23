# Task Plan

Work goes milestone by milestone. Each task becomes one GitHub issue, one branch, and one PR (see the Issue and PR Contract in the git rules). Tick a task only when its PR is merged and CI is green.

Task IDs (`T-xx`) go in issue titles. Requirement IDs (`FR`/`NFR`) and rule IDs (`BR`) say what the task must satisfy.

## M0. Foundation

Goal: an empty but solid monorepo with CI, so every later PR is checked automatically.

- [ ] **T-01** Planning docs, agent rules, `CLAUDE.md`, `AGENTS.md`.
- [ ] **T-02** Convert to Nest monorepo: `apps/api`, `apps/worker`, `libs/shared`. Remove the starter app. Update scripts, Vitest, and tsconfig paths.
- [ ] **T-03** `docker-compose.yml` with Postgres, Redis, ClamAV (raised stream limits), MinIO. `.env.example`.
- [ ] **T-04** Config module in `libs/shared`: zod env schema, fail fast on bad config. (NFR-23)
- [ ] **T-05** Logging with `nestjs-pino`, request IDs, global exception filter, error JSON shape. (NFR-30, NFR-31)
- [ ] **T-06** CI workflow: install, lint, unit tests, build. Dependabot config. GitHub issue and PR templates. (NFR-43)

## M1. Upload and storage

Goal: a file can be uploaded, hashed, stored, and recorded, but not yet scanned.

- [ ] **T-07** Drizzle setup: `DRIZZLE` provider, migration scripts, `owners`, `api_keys`, `scans` tables.
- [ ] **T-08** `FILE_STORAGE` token, S3 implementation, in-memory fake for tests.
- [ ] **T-09** Streaming upload with SHA-256/MD5, size limit, file name cleaning. (FR-01 to FR-03, BR-18, BR-19)
- [ ] **T-10** `GET /v1/scans/:id`, `GET /v1/scans`, `DELETE /v1/scans/:id`, response DTOs. (FR-05, FR-06, FR-08)
- [ ] **T-11** E2E test setup in CI with service containers.

## M2. Worker and ClamAV

Goal: uploads get scanned by ClamAV and reach `done` with a verdict.

- [ ] **T-12** Queue names, job payload types, flow builder in `libs/shared`. API adds the flow after upload.
- [ ] **T-13** Worker app skeleton: BullMQ processors, health check, graceful shutdown. (NFR-22)
- [ ] **T-14** `scan_results` table and repository with upsert.
- [ ] **T-15** ClamAV `INSTREAM` client and `ClamavEngine`, with timeout. (FR-12, BR-07)
- [ ] **T-16** `computeVerdict()` with full branch tests. (BR-12 to BR-17, NFR-40)
- [ ] **T-17** `finalize` processor: verdict, status change in one transaction. (FR-14)
- [ ] **T-18** E2E: EICAR is `malicious`, plain text is `clean`.

## M3. More engines

Goal: all four engines run and feed the verdict.

- [ ] **T-19** `FiletypeEngine`: magic bytes, extension mismatch. (FR-10)
- [ ] **T-20** `ArchiveEngine`: zip limits with `yauzl`, encrypted archives. (FR-11, BR-20)
- [ ] **T-21** `VirusTotalEngine`: hash lookup, rate limiter, daily quota, `skipped`/`unknown`. (FR-13, BR-09 to BR-11)
- [ ] **T-22** Result reuse and hash lookup endpoint. (FR-04, FR-07, BR-21 to BR-23)
- [ ] **T-23** Maintenance queue: stuck-scan sweep. (FR-15, BR-03)

## M4. Access control and webhooks

Goal: safe for more than one owner.

- [ ] **T-24** `ApiKeyGuard`, `@Public()`, `@CurrentOwner()`, owner checks everywhere. (FR-20, FR-21, BR-24, BR-25)
- [ ] **T-25** CLI `cli:create-owner`. (FR-23, BR-28)
- [ ] **T-26** API key endpoints. (FR-22, BR-26, BR-27)
- [ ] **T-27** Per-key rate limits with Redis storage. (FR-24, BR-29)
- [ ] **T-28** Webhook endpoints, URL safety check, encrypted secrets. (FR-30, FR-31, BR-30 to BR-32)
- [ ] **T-29** `webhook-delivery` processor: signing, retries, auto-disable. (FR-32, BR-33, BR-34)
- [ ] **T-30** Security e2e tests: no key, other owner's scan, oversized upload, path-traversal name, private-IP webhook.

## M5. Production

Goal: live on the internet, deployed by merging to `main`.

- [ ] **T-31** Dockerfiles for api and worker (multi-stage, non-root, read-only worker). (NFR-06)
- [ ] **T-32** CI: Trivy and CodeQL, block on high/critical. (NFR-07)
- [ ] **T-33** Terraform: Hetzner VPS, firewall, R2 bucket with lifecycle rule.
- [ ] **T-34** Production compose with Caddy, deploy workflow to GHCR and the VPS.
- [ ] **T-35** Retention cleanup job. (FR-42, BR-35, BR-36)
- [ ] **T-36** OpenAPI docs, README with setup and API examples. (FR-41)

## M6. Stretch

- [ ] Live status via Server-Sent Events.
- [ ] YARA engine.
- [ ] PDF / Office macro and script detection.
- [ ] Opt-in VirusTotal upload for unknown files.
- [ ] k3s with auto-scaled workers.

## Definition of done (every task)

- The issue's acceptance criteria are met and tested.
- `bun run lint`, `bun run test`, `bun run test:e2e`, `bun run build` pass.
- Docs are updated if behavior, rules, or schema changed.
- The PR follows the Issue and PR Contract and is rebase-merged.
