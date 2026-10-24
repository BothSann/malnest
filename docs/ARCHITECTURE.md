# Architecture

malnest is a **modular monolith built with DDD** (domain-driven design). One codebase holds three bounded contexts. It runs as two processes, an HTTP API and a background worker, that load the same modules.

Terms used here are defined in `docs/GLOSSARY.md`.

## Overview

```
                Client (developer's app)
                         │  HTTPS, Bearer API key
                         ▼
   ┌─────────────────────────────────────────────┐
   │ API process  (src/main.ts → ApiModule)      │
   │  identity·http   scanning·http   webhooks·http
   └──────┬───────────────┬──────────────┬───────┘
          │ stream file   │ rows         │ add flow
          ▼               ▼              ▼
   ┌────────────┐   ┌───────────┐   ┌──────────────┐
   │ S3 storage │   │ Postgres  │   │ Redis        │
   │ quarantine │   │ 1 schema  │   │ BullMQ +     │
   │ bucket     │   │ / context │   │ rate limits  │
   └─────▲──────┘   └─────▲─────┘   └──────┬───────┘
         │                │                │ jobs
   ┌─────┴────────────────┴────────────────▼─────┐
   │ Worker process (src/worker.ts → WorkerModule)│
   │  scanning·jobs   webhooks·jobs   outbox relay │
   └─────┬──────────────────────┬────────────────┘
         │ TCP INSTREAM         │ HTTPS (hash only)
         ▼                      ▼
   ┌────────────┐        ┌──────────────┐
   │ ClamAV     │        │ VirusTotal   │
   └────────────┘        └──────────────┘
```

Why two processes from one codebase: scans are slow and touch hostile bytes, so they stay out of the HTTP process (D1). Why one codebase: the contexts are small and owned by one person, so separate services would add cost with no gain (D8).

## Bounded contexts

| Context | Owns | Aggregates | Talks to others by |
|---|---|---|---|
| **identity** | Owners, API keys, authentication | `Owner` (holds its `ApiKey` entities) | Exports `ApiKeyGuard`, `@CurrentOwner()`, `@Public()`, and the `AuthenticatedOwner` type |
| **scanning** | Uploads, quarantine storage, engines, scan lifecycle, verdict, retention | `Scan`, `ScanResult` | Publishes `scanning.scan-completed.v1` through the outbox |
| **webhooks** | Webhook endpoints, signing, delivery | `Webhook`, `WebhookDelivery` | Consumes `scanning.scan-completed.v1` through the inbox |

```
identity ──(guard + owner id)──► scanning ──(scan-completed.v1 via outbox)──► webhooks
```

- Dependencies only go left to right. `webhooks` never calls `scanning`, and `scanning` never calls `webhooks`.
- Other aggregates are referenced **by ID only**. `Scan.ownerId` is a plain UUID, not an `Owner` object.
- No database foreign keys and no joins across contexts.

### Why these aggregates

- **`Owner` holds its `ApiKey`s** because BR-27 (max 5 active keys, cannot revoke the last one) is a rule across all of an owner's keys. Only the aggregate root can guard it.
- **`Scan` and `ScanResult` are separate aggregates.** The local-scan and VirusTotal jobs run in parallel. If results lived inside `Scan`, both jobs would save the same aggregate at once and fight. Each job saves its own `ScanResult` instead, and `finalize` loads them all and calls `scan.complete(results)`.
- **`Webhook` and `WebhookDelivery` are separate.** Deliveries are an append-only log that grows without limit. `Webhook` only keeps the failure counter it needs for BR-34.

## Layers inside a context

Every context has the same four layers. Dependencies point inward only.

```
        api  ─────────┐
                      ▼
 infrastructure ──► application ──► domain
```

| Layer | Holds | May import | Must not import |
|---|---|---|---|
| `domain/` | Aggregates, entities, value objects, domain events, domain errors, repository interfaces + tokens, domain services | `src/shared/domain` only | `@nestjs/*`, Drizzle, BullMQ, any I/O |
| `application/` | Commands, queries, their handlers, ports (interfaces for outside services) | `domain/`, `src/shared/domain`, `src/shared/application`, `@nestjs/cqrs`, `@nestjs/common` (for `@Inject`) | `infrastructure/`, `api/`, HTTP exceptions |
| `infrastructure/` | Drizzle tables, mappers, repository implementations, adapters for storage, engines, queues, crypto | `domain/`, `application/`, `src/shared/*` | `api/` |
| `api/` | Inbound adapters: HTTP controllers and DTOs, BullMQ processors, integration event handlers, guards, CLI | `application/`, `contracts/`, `src/shared/*` | `infrastructure/` (use tokens), `domain/` internals |
| `contracts/` | The context's public surface: integration event types, exported guard and decorators, public DTO types | `src/shared/*` | Anything internal |

**Exception:** query handlers in `application/queries/` read with the Drizzle client directly (CQRS read side), through a read-only `DB_READER` token. They return DTOs, never aggregates.

Each context's `index.ts` exports only its Nest modules and `contracts/`. Other contexts import from that entry point only. `dependency-cruiser` enforces both the layer rules and the context boundaries in CI.

## Nest modules per context

Each context provides three Nest modules so each process loads only what it needs:

| Module | Contains | Loaded by |
|---|---|---|
| `<ctx>.module.ts` (core) | Command and query handlers, repositories, adapters | API and worker |
| `<ctx>-http.module.ts` | Controllers, guards | API only |
| `<ctx>-jobs.module.ts` | BullMQ processors, integration event handlers | Worker only |

```
ApiModule    = SharedModule + identity(core, http) + scanning(core, http) + webhooks(core, http)
WorkerModule = SharedModule + OutboxModule + scanning(core, jobs) + webhooks(core, jobs) + identity(core)
```

## CQRS

Uses `@nestjs/cqrs`.

- **Commands** change state. Handler: load the aggregate through its repository, call one method, save. Returns nothing or an ID.
- **Queries** read state. Handler: one SQL query shaped for the response. Never changes data.
- Controllers and processors only build a command or query and send it to the bus.

| Context | Commands | Queries |
|---|---|---|
| identity | `CreateOwner`, `IssueApiKey`, `RevokeApiKey` | `AuthenticateApiKey`, `ListApiKeys` |
| scanning | `SubmitScan`, `RunLocalEngines`, `RunVirusTotalLookup`, `FinalizeScan`, `DeleteScan`, `FailStuckScans`, `PurgeExpiredFiles`, `PurgeExpiredScans` | `GetScan`, `ListScans`, `FindLatestScanByHash` |
| webhooks | `RegisterWebhook`, `RemoveWebhook`, `ScheduleDeliveries`, `DeliverWebhook` | `ListWebhooks` |

## Events

| Kind | Example | Scope | Transport |
|---|---|---|---|
| Domain event | `ScanCompleted` | Inside one context | Collected on the aggregate, turned into rows on save |
| Integration event | `scanning.scan-completed.v1` | Across contexts | Transactional outbox → relay (worker) → handler with inbox dedupe |

- The `Scan` repository writes the scan update and the outbox row **in one transaction** (BR-02, NFR-20).
- The outbox relay runs only in the worker. It publishes unsent rows to in-process handlers, marks them sent, and retries failures.
- Each consumer records the event ID in the `inbox` table in the same transaction as its own work, so a second delivery does nothing.
- Integration event payloads are small, versioned (`.v1`), and never contain domain objects, file bytes, or secrets.

`scanning.scan-completed.v1` payload: `eventId`, `occurredAt`, `scanId`, `ownerId`, `status`, `verdict`, `reasons`, `finishedAt`.

## Scan flow

1. `POST /v1/scans`. `ApiKeyGuard` (identity) authenticates. The throttler checks the upload limit.
2. `ScansController` sends `SubmitScan` with the owner ID and the file stream.
3. `SubmitScanHandler`:
   - streams the file to `FILE_STORAGE` at `quarantine/<scanId>`, hashing and counting on the way, and aborts over the size limit (BR-18);
   - checks for a reusable result (BR-21). If found, creates a reused `Scan`, deletes the new object, and returns it (`200`);
   - otherwise creates `Scan` (`queued`), saves it, and calls the `SCAN_PIPELINE` port, which adds the BullMQ flow (`202`).
4. The flow:

   ```
   finalize (parent, queue: scan-finalize)
     ├── local-scan  (queue: scan-local)       filetype → archive → clamav
     └── virustotal  (queue: scan-virustotal)  rate-limited hash lookup
   ```

   Children use `ignoreDependencyOnFailure: true`, so `finalize` always runs.
5. `RunLocalEngines` and `RunVirusTotalLookup` call `scan.start()` (first one wins, the second is a no-op) and save one `ScanResult` per engine (upsert on `scan_id, engine`).
6. `FinalizeScan` loads the `Scan` and its `ScanResult`s and calls `scan.complete(results)`. The aggregate uses the `VerdictPolicy` domain service (BR-12 to BR-17), moves to `done` or `failed`, and raises `ScanCompleted`. The repository saves the scan and the outbox row in one transaction.
7. The relay publishes `scanning.scan-completed.v1`. `webhooks` handles it (inbox dedupe), runs `ScheduleDeliveries`, and adds one `webhook-delivery` job per active webhook.

## Queues

| Queue | Context | Job ID | Concurrency | Notes |
|---|---|---|---|---|
| `scan-local` | scanning | `local:<scanId>` | `WORKER_CONCURRENCY` | 3 attempts, exponential backoff |
| `scan-virustotal` | scanning | `vt:<scanId>` | 1 | Limiter: 4 per 60 s. Daily quota in Redis. |
| `scan-finalize` | scanning | `finalize:<scanId>` | `WORKER_CONCURRENCY` | Runs after both children |
| `scan-maintenance` | scanning | fixed IDs | 1 | Stuck-scan sweep every 5 min, retention daily |
| `webhook-delivery` | webhooks | `wh:<webhookId>:<scanId>` | 4 | 5 attempts, exponential backoff |

Job IDs come from record IDs, so adding the same job twice does nothing.

## Concurrency

- Every aggregate table has a `version` column. Repositories update with `WHERE id = $1 AND version = $2` and throw `ConcurrencyError` when no row changes.
- In jobs, `ConcurrencyError` is retryable, so BullMQ retries with a fresh load.
- `ScanResult` upserts are keyed on `(scan_id, engine)`, so retries never duplicate rows.

## Folder layout

```
src/
├── main.ts                      # API entry point
├── worker.ts                    # worker entry point
├── api.module.ts
├── worker.module.ts
├── shared/                      # shared kernel: tiny, no business concepts
│   ├── domain/                  # AggregateRoot, DomainEvent, DomainError, ConcurrencyError
│   ├── application/             # ports: Clock, IdGenerator
│   ├── infrastructure/
│   │   ├── config/              # zod env schema, typed config
│   │   ├── database/            # Drizzle client, DB_WRITER / DB_READER, transactions
│   │   ├── outbox/              # outbox + inbox tables, relay
│   │   ├── queue/               # BullMQ connection
│   │   ├── logging/
│   │   └── health/
│   └── api/                     # exception filter (DomainError → HTTP), request ID, pagination
└── modules/
    ├── identity/                # see src/modules/identity/README.md
    ├── scanning/                # see src/modules/scanning/README.md
    └── webhooks/                # see src/modules/webhooks/README.md
db/
└── migrations/                  # drizzle-kit output
test/                            # e2e tests
```

## Injection tokens

| Token | Context | Interface | Implementations |
|---|---|---|---|
| `OWNER_REPOSITORY` | identity | `OwnerRepository` | Drizzle, in-memory |
| `API_KEY_GENERATOR` | identity | `ApiKeyGenerator` | `node:crypto`, fixed in tests |
| `SCAN_REPOSITORY` | scanning | `ScanRepository` | Drizzle, in-memory |
| `SCAN_RESULT_REPOSITORY` | scanning | `ScanResultRepository` | Drizzle, in-memory |
| `FILE_STORAGE` | scanning | `FileStorage` | S3 (MinIO / R2), in-memory |
| `MALWARE_ENGINES` | scanning | `MalwareEngine[]` | filetype, archive, clamav, virustotal |
| `SCAN_PIPELINE` | scanning | `ScanPipeline` | BullMQ flow producer, fake |
| `WEBHOOK_REPOSITORY` | webhooks | `WebhookRepository` | Drizzle, in-memory |
| `WEBHOOK_DELIVERY_REPOSITORY` | webhooks | `WebhookDeliveryRepository` | Drizzle, in-memory |
| `URL_SAFETY_CHECKER` | webhooks | `UrlSafetyChecker` | DNS + `ipaddr.js`, fake |
| `WEBHOOK_SENDER` | webhooks | `WebhookSender` | `fetch`, fake |
| `SECRET_CIPHER` | webhooks | `SecretCipher` | AES-256-GCM |
| `CLOCK` | shared | `Clock` | system, fixed |
| `ID_GENERATOR` | shared | `IdGenerator` | UUID v7, sequence in tests |
| `DB_WRITER` / `DB_READER` | shared | Drizzle client | Postgres pool |

## Error handling

- The domain throws `DomainError` subclasses with a stable `code` (for example `scan.not_found`, `identity.key_limit_reached`).
- One global filter in `src/shared/api` maps codes to HTTP statuses. The domain never throws HTTP exceptions.
- Unknown errors become `500` with no details. The full error is logged with the request ID.

## Security boundaries

- **Internet → API.** Everything is untrusted. The guard, throttler, and DTO validation run before any handler.
- **File bytes → worker.** Only streamed to ClamAV and read for headers and archive metadata. The worker runs non-root with a read-only filesystem.
- **Worker → outside URLs.** Webhooks go only to URLs that pass the safety check at send time. Redirects are not followed.
- **Context → context.** Only through `index.ts` contracts and integration events, checked by `dependency-cruiser`.

## Deployment

### Local

docker-compose runs `postgres`, `redis`, `clamav`, `minio`. The API and worker run on the host with `bun run dev` and `bun run dev:worker`, or in compose.

### Production (one VPS)

- Hetzner VPS with 4 GB RAM, created with Terraform.
- docker-compose runs `api`, `worker`, `postgres`, `redis`, `clamav`, and Caddy for HTTPS. `api` and `worker` use the **same image** with different start commands.
- Storage is a private Cloudflare R2 bucket.
- Only ports 80, 443, and the admin SSH port are open.
- GitHub Actions builds the image, pushes it to GHCR, and deploys over SSH on merge to `main`.

### ClamAV settings

`clamd` defaults to a 25 MB stream limit. Set `StreamMaxLength`, `MaxFileSize`, and `MaxScanSize` to at least `MAX_UPLOAD_BYTES`. The worker's readiness check waits for `clamd` to answer `PING`.

## Key decisions

| # | Decision | Why |
|---|---|---|
| D1 | Separate API and worker processes | Scans are slow and risky. Keeping them out of the HTTP process keeps the API fast and limits damage. |
| D2 | BullMQ flows (parent + children) | VirusTotal is rate-limited. Running it in parallel with local engines and joining in `finalize` keeps scans fast. |
| D3 | Polling + webhooks in v1 | Simplest thing that meets the stories. |
| D4 | API keys, no user accounts | API-to-API product. Smaller attack surface. |
| D5 | Hash-only VirusTotal | Uploading makes files visible to other VirusTotal customers. |
| D6 | No sharing results across owners | Privacy over a small speed gain. |
| D7 | Postgres for state, Redis for queues and rate limits | Redis can be lost without losing scan history. |
| D8 | Modular monolith with DDD, not microservices | One owner, small contexts. Clear boundaries now, and a context can move out later if needed. |
| D9 | Three bounded contexts: identity, scanning, webhooks | Each has its own language and rules. Engines stay inside scanning, because they only exist to produce scan results. |
| D10 | Transactional outbox + inbox for integration events | No lost or duplicated `scan-completed` events when a process crashes. |
| D11 | One Postgres schema per context, no cross-context FKs | Keeps contexts independent and makes the boundary visible in the database. |
