# Architecture

## Overview

malnest has two Nest apps that share one library, plus four backing services.

```
                Client (developer's app)
                         │  HTTPS, Bearer API key
                         ▼
   ┌───────────────────────────────────────────┐
   │ apps/api                                  │
   │  auth guard ─ throttler ─ validation      │
   │  scans · api-keys · webhooks · health     │
   └──────┬───────────────┬──────────────┬─────┘
          │ stream file   │ rows         │ add flow
          ▼               ▼              ▼
   ┌────────────┐   ┌───────────┐   ┌──────────────┐
   │ S3 storage │   │ Postgres  │   │ Redis        │
   │ quarantine │   │           │   │ BullMQ +     │
   │ bucket     │   │           │   │ rate limits  │
   └─────▲──────┘   └─────▲─────┘   └──────┬───────┘
         │ read stream    │ rows           │ jobs
   ┌─────┴────────────────┴────────────────▼─────┐
   │ apps/worker                                 │
   │  local-scan · virustotal · finalize ·       │
   │  webhook-delivery · maintenance (cron)      │
   └─────┬──────────────────────┬────────────────┘
         │ TCP INSTREAM         │ HTTPS (hash only)
         ▼                      ▼
   ┌────────────┐        ┌──────────────┐
   │ ClamAV     │        │ VirusTotal   │
   │ (clamd)    │        │ API v3       │
   └────────────┘        └──────────────┘
```

- **apps/api**: the public HTTP surface. It accepts uploads, stores files, writes rows, and adds jobs. It never scans.
- **apps/worker**: no HTTP routes except health. It runs all scan, webhook, and cleanup jobs.
- **libs/shared**: database schema, repositories, job payload types, queue names, the verdict function, config schema, and shared utilities.

## Scan flow

1. The client sends `POST /v1/scans` with a file.
2. `ApiKeyGuard` checks the key. The throttler checks the upload limit.
3. `UploadsService` streams the request body into storage under the key `quarantine/<scanId>`, hashing (SHA-256, MD5) and counting bytes on the way. If the size limit is passed, it aborts and deletes the partial object.
4. `ScansService` checks for a reusable result (BR-21).
   - Reusable: create a scan row with copied results, delete the new object, return `200`.
   - Not reusable: create a scan row with status `queued`, add a BullMQ flow, return `202`.
5. The flow (BullMQ `FlowProducer`) has one parent and two children:

   ```
   finalize (parent, queue: scan-finalize)
     ├── local-scan  (queue: scan-local)       filetype → archive → clamav
     └── virustotal  (queue: scan-virustotal)  rate-limited hash lookup
   ```

   Children use `ignoreDependencyOnFailure: true`, so `finalize` still runs when a child fails for good.
6. Each child sets the scan to `scanning` (if still `queued`), runs its engines, and upserts one `scan_results` row per engine.
7. `finalize` reads all results, runs `computeVerdict()` from `libs/shared`, and updates the scan to `done` or `failed` in one transaction.
8. `finalize` emits `scan.completed`, which adds one `webhook-delivery` job per active webhook.
9. The client polls `GET /v1/scans/:id` or receives the webhook.

## Queues

| Queue | Producer | Job ID | Concurrency | Notes |
|---|---|---|---|---|
| `scan-local` | api (flow) | `local:<scanId>` | `WORKER_CONCURRENCY` | 3 attempts, exponential backoff |
| `scan-virustotal` | api (flow) | `vt:<scanId>` | 1 | Limiter: 4 jobs per 60 s. Daily quota counter in Redis. |
| `scan-finalize` | api (flow) | `finalize:<scanId>` | `WORKER_CONCURRENCY` | Runs after both children |
| `webhook-delivery` | worker | `wh:<webhookId>:<scanId>` | 4 | 5 attempts, exponential backoff |
| `maintenance` | worker (repeatable) | fixed IDs | 1 | Stuck-scan sweep every 5 min, retention cleanup daily |

Job IDs are built from record IDs, so adding the same job twice does nothing (idempotency).

## Module layout

```
apps/
  api/src/
    main.ts
    app.module.ts
    auth/            ApiKeyGuard, @Public(), @CurrentOwner()
    scans/           controller, service, DTOs
    uploads/         streaming upload + hashing
    api-keys/        controller, service, DTOs
    webhooks/        controller, service, DTOs, URL safety check
    health/
    cli/             create-owner script (standalone app context)
  worker/src/
    main.ts
    worker.module.ts
    engines/
      filetype/      FiletypeEngine
      archive/       ArchiveEngine
      clamav/        ClamavEngine (+ clamd TCP client)
      virustotal/    VirusTotalEngine
    processors/      local-scan, virustotal, finalize, webhook-delivery, maintenance
    health/
libs/shared/src/
  config/            env schema (zod), typed config service
  database/          Drizzle schema, migrations, DatabaseModule
  repositories/      ScansRepository, ResultsRepository, OwnersRepository, ...
  storage/           FILE_STORAGE token + S3 implementation
  queues/            queue names, job payload types, flow builder
  verdict/           computeVerdict() + tests
  security/          hashing helpers, URL safety, HMAC signing, secret encryption
  logging/
```

## Injection tokens

| Token | Interface | Implementations |
|---|---|---|
| `FILE_STORAGE` | `FileStorage { put, getStream, delete, exists }` | `S3FileStorage` (MinIO locally, R2 in production), in-memory fake in tests |
| `MALWARE_ENGINES` | `MalwareEngine[]` with `name` and `scan(input): Promise<EngineResult>` | Filetype, Archive, ClamAV, VirusTotal |
| `CLOCK` | `Clock { now(): Date }` | System clock, fixed clock in tests |
| `DRIZZLE` | Drizzle database client | Postgres pool |

## Security boundaries

- **Trust boundary 1: the internet → api.** Everything is untrusted: headers, body, file name, file bytes. Guards, throttler, and DTO validation run before any service code.
- **Trust boundary 2: file bytes → worker.** The worker treats file bytes as hostile. It only streams them to ClamAV and reads headers and archive metadata. Its container is non-root, read-only, and has no secrets except what it needs.
- **Trust boundary 3: worker → outside URLs.** Webhook calls go only to URLs that pass the safety check at send time. Redirects are not followed.
- **Secrets:** API keys and webhook secrets are stored as hashes or encrypted values (see `docs/DATA_MODEL.md`). Config secrets come from env vars only.

## Deployment

### Local (docker-compose)

`api`, `worker`, `postgres`, `redis`, `clamav`, `minio`. The apps can also run on the host with `bun run start:dev api` / `worker` while the services run in Docker.

### Production (one VPS)

- Hetzner VPS with 4 GB RAM, created with Terraform.
- docker-compose runs `api`, `worker`, `postgres`, `redis`, `clamav`.
- Storage is a private Cloudflare R2 bucket (also created with Terraform).
- Caddy in front of `api` for HTTPS.
- Only ports 80, 443, and the admin SSH port are open.
- GitHub Actions builds images, pushes them to GHCR, and deploys over SSH on merge to `main`.

### ClamAV settings

`clamd` has a default stream limit of 25 MB, below our 50 MB upload limit. Set `StreamMaxLength`, `MaxFileSize`, and `MaxScanSize` to at least `MAX_UPLOAD_BYTES`. Signatures update with `freshclam` inside the ClamAV container. The worker's readiness check waits until `clamd` answers `PING`.

## Key decisions

| # | Decision | Why |
|---|---|---|
| D1 | Split api and worker | Scans are slow and risky. Keeping them out of the HTTP process keeps the API fast and limits damage. |
| D2 | BullMQ flows (parent + children) | VirusTotal is rate-limited and slow. Running it in parallel with local engines and joining in `finalize` keeps scans fast. |
| D3 | Polling + webhooks in v1, live updates later | Simplest thing that meets the stories. |
| D4 | API keys, no user accounts | API-to-API product. Less auth code, smaller attack surface. |
| D5 | Hash-only VirusTotal | Uploading files makes them visible to other VirusTotal customers. |
| D6 | No sharing results across owners | Privacy over a small speed gain. |
| D7 | Postgres for state, Redis only for queues and rate limits | Redis data can be lost without losing scan history. |
