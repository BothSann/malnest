# Data Model

Postgres holds all lasting state. Redis holds only queues and rate-limit counters. File bytes live only in object storage.

## Conventions

- **One Postgres schema per bounded context:** `identity`, `scanning`, `webhooks`, plus `messaging` for the outbox and inbox. A context reads and writes only its own schema.
- **No foreign keys or joins across schemas.** Cross-context references are plain UUID columns (D11). Inside one schema, foreign keys are fine.
- IDs are UUID v7 (time-ordered, good for indexes and cursor pagination).
- Times are `timestamptz` in UTC. Column names are `snake_case`.
- Every aggregate root table has `version integer not null default 0` for optimistic locking.
- Schema changes go through Drizzle migrations in `db/migrations/` only.
- Domain objects and table rows are different types. Mappers in each context's `infrastructure/persistence/` convert between them.

## Diagram

```
identity                 scanning                     webhooks
────────                 ────────                     ────────
owners 1──* api_keys     scans 1──* scan_results      webhooks 1──* webhook_deliveries
   ▲                       │  owner_id (no FK)           │ owner_id (no FK)
   └───── by ID only ──────┴─────────────────────────────┘ scan_id in deliveries (no FK)

messaging
─────────
outbox   inbox
```

## Enums

| Enum | Schema | Values |
|---|---|---|
| `scan_status` | scanning | `queued`, `scanning`, `done`, `failed` |
| `verdict` | scanning | `clean`, `suspicious`, `malicious` |
| `engine_name` | scanning | `filetype`, `archive`, `clamav`, `virustotal` |
| `engine_status` | scanning | `ok`, `error`, `skipped` |

## identity

### identity.owners — `Owner` aggregate root

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text not null | 1 to 100 chars |
| `version` | integer not null default 0 | |
| `created_at` | timestamptz not null | |

### identity.api_keys — `ApiKey` entity inside `Owner`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid not null FK → identity.owners, on delete cascade | same schema, FK allowed |
| `name` | text not null | label, 1 to 100 chars |
| `prefix` | text not null | first 8 chars of the key |
| `key_hash` | bytea not null unique | SHA-256 of the full key |
| `last_used_at` | timestamptz null | updated at most once per minute, outside the aggregate (no version bump) |
| `revoked_at` | timestamptz null | null means active |
| `created_at` | timestamptz not null | |

Saved only through `OwnerRepository` together with its owner. Key format: `mn_live_` + 32 random bytes in base64url.

Indexes: `(owner_id) WHERE revoked_at IS NULL`.

## scanning

### scanning.scans — `Scan` aggregate root

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | also the storage key suffix |
| `owner_id` | uuid not null | identity owner, **no FK** |
| `status` | `scan_status` not null default `queued` | BR-01, BR-02 |
| `verdict` | `verdict` null | set only when `done` (BR-04) |
| `reasons` | text[] not null default `{}` | BR-16 |
| `partial` | boolean not null default false | BR-08 |
| `reused_from_id` | uuid null FK → scanning.scans, on delete set null | BR-21 |
| `error` | text null | short code when `failed`, for example `timeout` |
| `sha256` | bytea not null | 32 bytes |
| `md5` | bytea not null | 16 bytes |
| `size_bytes` | bigint not null | > 0 |
| `original_name` | text null | cleaned, max 255 (BR-19) |
| `claimed_type` | text null | |
| `detected_type` | text null | |
| `storage_key` | text null | `quarantine/<id>`; null after the file is deleted |
| `file_deleted_at` | timestamptz null | BR-35 |
| `version` | integer not null default 0 | |
| `created_at` | timestamptz not null | |
| `started_at` | timestamptz null | |
| `finished_at` | timestamptz null | |

Checks:
- `verdict IS NULL` unless `status = 'done'`.
- `finished_at IS NOT NULL` when `status IN ('done', 'failed')`.

Indexes:
- `(owner_id, id DESC)`: list scans, cursor pagination.
- `(owner_id, sha256, finished_at DESC) WHERE status = 'done'`: reuse check and hash lookup.
- `(status, created_at) WHERE status IN ('queued', 'scanning')`: stuck-scan sweep.
- `(created_at)`: retention.

`sha256` is **not** unique: many owners, and the same owner many times, can scan the same file.

### scanning.scan_results — `ScanResult` aggregate root

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `scan_id` | uuid not null FK → scanning.scans, on delete cascade | same schema, FK allowed |
| `engine` | `engine_name` not null | |
| `status` | `engine_status` not null | |
| `finding` | text null | |
| `details` | jsonb not null default `{}` | engine-specific raw data |
| `duration_ms` | integer null | |
| `version` | integer not null default 0 | |
| `created_at` | timestamptz not null | |

Unique: `(scan_id, engine)`. The repository upserts on this key, so a re-run job does not duplicate rows.

## webhooks

### webhooks.webhooks — `Webhook` aggregate root

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid not null | identity owner, **no FK** |
| `url` | text not null | https only (BR-30) |
| `secret_encrypted` | bytea not null | AES-256-GCM with `WEBHOOK_ENCRYPTION_KEY`, nonce stored with it |
| `secret_prefix` | text not null | for display |
| `consecutive_failures` | integer not null default 0 | BR-34 |
| `disabled_at` | timestamptz null | |
| `version` | integer not null default 0 | |
| `created_at` | timestamptz not null | |

The secret is encrypted, not hashed, because the worker needs it to sign deliveries.

Indexes: `(owner_id) WHERE disabled_at IS NULL`.

### webhooks.webhook_deliveries — `WebhookDelivery` aggregate root

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `webhook_id` | uuid not null FK → webhooks.webhooks, on delete cascade | same schema |
| `scan_id` | uuid not null | scanning scan, **no FK** |
| `attempt` | integer not null | 1 to 6 |
| `status_code` | integer null | null on network error or timeout |
| `success` | boolean not null | |
| `error` | text null | short code |
| `created_at` | timestamptz not null | |

Append-only, so no `version` column. Old rows are deleted by the webhooks context after `RECORD_RETENTION_DAYS`, because deleting a scan does not cascade across contexts.

Indexes: `(webhook_id, created_at DESC)`, `(created_at)`.

## messaging

### messaging.outbox

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | also the event ID consumers dedupe on |
| `type` | text not null | for example `scanning.scan-completed.v1` |
| `payload` | jsonb not null | |
| `occurred_at` | timestamptz not null | |
| `processed_at` | timestamptz null | null means not sent yet |
| `attempts` | integer not null default 0 | |
| `last_error` | text null | |

Indexes: `(occurred_at) WHERE processed_at IS NULL`. The relay reads with `FOR UPDATE SKIP LOCKED`. Rows with `attempts >= 10` stop retrying and need a person to look. Sent rows are deleted after 7 days.

### messaging.inbox

| Column | Type | Notes |
|---|---|---|
| `message_id` | uuid not null | the outbox `id` |
| `handler` | text not null | consumer name |
| `processed_at` | timestamptz not null | |

Primary key: `(message_id, handler)`. A consumer inserts here with `ON CONFLICT DO NOTHING` in the same transaction as its work, and stops if no row was inserted.

If `@nestjs/outbox` is adopted (see `docs/TECH_STACK.md`), its own tables replace these two, still in the `messaging` schema.

## Object storage

| Bucket | Key | Content |
|---|---|---|
| `malnest-quarantine` (private) | `quarantine/<scanId>` | raw uploaded bytes, `Content-Type: application/octet-stream` |

No public access. A lifecycle rule deletes objects after `FILE_RETENTION_DAYS + 1` days, as a safety net behind the cleanup job.

## Redis

| Key / use | Context | Notes |
|---|---|---|
| `bull:*` | scanning, webhooks | queues listed in `docs/ARCHITECTURE.md` |
| `throttle:*` | shared | per-key rate limits |
| `vt:quota:<YYYY-MM-DD>` | scanning | daily VirusTotal counter, expires after 48 h |

Redis is not backed up. Losing it loses queued jobs, which the stuck-scan sweep then marks `failed`.

## Job payloads

Each context defines its own in `infrastructure/queue/`. Payloads hold IDs only, never file bytes or secrets.

```ts
// scanning
interface LocalScanJob   { scanId: string }
interface VirusTotalJob  { scanId: string }
interface FinalizeJob    { scanId: string }
// webhooks
interface WebhookJob     { webhookId: string; scanId: string; eventId: string }
```

## Report shape (API response)

```json
{
  "id": "0192f0c4-...",
  "status": "done",
  "verdict": "malicious",
  "reasons": ["clamav:Eicar-Signature"],
  "partial": false,
  "reused": false,
  "file": {
    "name": "test.txt",
    "size": 68,
    "sha256": "275a021b...",
    "claimedType": "text/plain",
    "detectedType": "text/plain"
  },
  "engines": [
    { "engine": "clamav", "status": "ok", "finding": "Eicar-Signature", "durationMs": 41 },
    { "engine": "virustotal", "status": "ok", "finding": "62/70", "durationMs": 380 }
  ],
  "createdAt": "2026-10-23T10:00:00Z",
  "finishedAt": "2026-10-23T10:00:03Z"
}
```

Never returned: `owner_id`, `storage_key`, `version`, raw `details` with internal hosts.
