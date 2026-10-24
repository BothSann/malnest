# Tech Stack

Pick from this list. Adding a new runtime dependency needs a reason in the PR and an update to this file. Exact versions are pinned in `bun.lock`.

## Core

| Area | Choice | Notes |
|---|---|---|
| Runtime | Node.js 24 LTS | Apps run on Node (`node dist/...`), not the Bun runtime. |
| Package manager | bun 1.x | `bun install`, `bun run <script>`. Lock file: `bun.lock`. |
| Language | TypeScript 6, `strict` | ESM, `module: nodenext`, relative imports end in `.js`. |
| Framework | NestJS 12, Express adapter | Modular monolith with DDD: one project, `src/modules/<context>`, two entry points (`src/main.ts`, `src/worker.ts`). See `docs/ARCHITECTURE.md`. |

## NestJS packages

| Package | Use |
|---|---|
| `@nestjs/cqrs` | Command, query, and event buses (CQRS inside each context) |
| `@nestjs/outbox` | Transactional outbox + inbox. **Evaluate in its task:** it is at 0.1.x. Adopt only if it has a working Drizzle store; otherwise build the small outbox described in `docs/DATA_MODEL.md`. |
| `@nestjs/config` + `zod` | Env config, validated at startup |
| `@nestjs/bullmq` + `bullmq` | Queues, flows, rate limiter |
| `@nestjs/throttler` + Redis storage | Per-key rate limits |
| `@nestjs/terminus` | Health checks |
| `@nestjs/swagger` + CLI plugin | Builds the OpenAPI spec. The CLI plugin (in `nest-cli.json`, with `classValidatorShim` and `introspectComments`) reads DTO types, `class-validator` rules, and `/** comments */` at build time, so most `@ApiProperty()` decorators are not needed. |
| `@scalar/nestjs-api-reference` | Docs page at `/docs` that renders the spec from `@nestjs/swagger`, with a built-in "try it" client. Replaces Swagger UI. |
| `@nestjs/event-emitter` | Only if the outbox relay is built by hand, to hand events to in-process handlers |
| `@nestjs/schedule` | Not needed; use BullMQ repeatable jobs instead so only one worker runs each cron job |
| `class-validator` + `class-transformer` | DTO validation |
| `nestjs-pino` + `pino` | Structured JSON logs |

## Data

| Area | Choice | Notes |
|---|---|---|
| Database | PostgreSQL 18 | |
| ORM | Drizzle ORM + `drizzle-kit` | SQL-like, no code generation step, works with ESM. Wrapped in a `DRIZZLE` provider. |
| Postgres driver | `pg` (node-postgres) | Connection pool |
| Queue and cache store | Redis 8 | BullMQ needs `maxmemory-policy noeviction`. |
| Object storage | S3 API via `@aws-sdk/client-s3` + `@aws-sdk/lib-storage` | MinIO locally, Cloudflare R2 in production. Same code, different endpoint. |

## Scanning

| Area | Choice | Notes |
|---|---|---|
| Antivirus | ClamAV (`clamav/clamav` Docker image) | Talk to `clamd` over TCP 3310 with our own small `INSTREAM` client. |
| File type | `file-type` | Magic-byte detection from a stream |
| Zip reading | `yauzl` | Reads the central directory and streams entries without unpacking to disk |
| Hash reputation | VirusTotal API v3 (`GET /files/{sha256}`) | Called with Node's built-in `fetch` and `AbortSignal.timeout` |

## Security

| Package | Use |
|---|---|
| `helmet` | Security headers |
| `node:crypto` | SHA-256, MD5, HMAC, AES-256-GCM, `timingSafeEqual`, random keys |
| `ipaddr.js` | Private / loopback / link-local IP checks for webhook URLs |

## Testing and quality

| Tool | Use |
|---|---|
| Vitest 4 | Unit (`bun run test`) and e2e (`bun run test:e2e`) tests |
| `@nestjs/testing` + Supertest | Testing modules and HTTP e2e tests |
| Testcontainers (optional) | Real Postgres/Redis in local e2e runs; CI uses service containers |
| oxlint (type-aware) | Lint |
| `dependency-cruiser` | Enforces DDD layer rules and context boundaries in CI (`bun run arch`) |
| Prettier | Format |

## DevOps

| Area | Choice |
|---|---|
| Containers | Docker, multi-stage builds, `node:24-slim` base, non-root user |
| Local stack | docker-compose |
| CI/CD | GitHub Actions |
| Image registry | GitHub Container Registry (GHCR) |
| Security scans | Trivy (images), CodeQL (code), Dependabot (dependencies) |
| Infrastructure as code | Terraform with the Hetzner Cloud and Cloudflare providers |
| Server | Hetzner Cloud VPS, 4 GB RAM |
| HTTPS proxy | Caddy |

## Watch out

- **`bun test` is not `bun run test`.** The first starts Bun's own runner. Always use `bun run test`.
- **MinIO:** the community edition stopped shipping new prebuilt images in 2025. Pin a known image tag for local use. If it becomes a problem, switch the local S3 store to SeaweedFS or Garage. No app code changes, because everything goes through the S3 API.
- **ClamAV memory:** about 1.5 GB at runtime and briefly double during signature reloads. Do not run it on a 2 GB server.
- **Swagger CLI plugin:** it only reads files ending in `.dto.ts` or `.entity.ts`, and it only runs during `nest build`. Vitest does not run it, so tests that check the spec need the plugin's generated metadata file (set up in T-39).
- **ClamAV stream limit:** default 25 MB. Raise it (see `docs/ARCHITECTURE.md`).

## Decided against (for now)

| Option | Why not |
|---|---|
| Prisma, TypeORM | Drizzle is lighter and closer to SQL, which suits learning Postgres. |
| Fastify adapter | Express has wider middleware support for multipart streaming. Code stays platform-agnostic, so we can switch later. |
| `nestjs-zod` | Would replace `class-validator` DTOs. One schema for everything is nice, but our rules and docs are built on `class-validator`. |
| Nestia (`@nestia/sdk` + `typia`) | Needs a TypeScript compiler patch that can break on new TS versions (we use TS 6). Revisit if a typed client SDK is wanted. |
| Swagger UI | Works, but Scalar is cleaner and has a better "try it" client. |
| Kafka, RabbitMQ | BullMQ on Redis is enough for one server. |
| Kubernetes in v1 | Too much for one VPS. k3s is a later stretch goal. |
| Nest monorepo (`apps/`, `libs/`) | Contexts are the real boundaries, not deployables. One project with two entry points is simpler, and `dependency-cruiser` keeps modules apart. |
| Microservices | One owner and three small contexts. A context can move out later because it already talks only through contracts and events. |
| Event sourcing | Not needed. Aggregates are saved as current state; the outbox covers reliable events. |
