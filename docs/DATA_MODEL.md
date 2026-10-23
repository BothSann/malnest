# Data Model

Postgres holds all lasting state. Redis holds only queues and rate-limit counters. File bytes live only in object storage.

All IDs are UUID v7 (time-ordered, good for indexes and cursor pagination). All times are `timestamptz` in UTC. Column names are `snake_case`. Schema changes go through Drizzle migrations only.

## Diagram

```
owners 1──* api_keys
owners 1──* scans 1──* scan_results
owners 1──* webhooks 1──* webhook_deliveries *──1 scans
```

## Enums

| Enum | Values |
|---|---|
| `scan_status` | `queued`, `scanning`, `done`, `failed` |
| `verdict` | `clean`, `suspicious`, `malicious` |
| `engine_name` | `filetype`, `archive`, `clamav`, `virustotal` |
| `engine_status` | `ok`, `error`, `skipped` |

## Tables

### owners

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text not null | 1 to 100 chars |
| `created_at` | timestamptz not null default now() | |

### api_keys

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid not null FK → owners, on delete cascade | |
| `name` | text not null | label, 1 to 100 chars |
| `prefix` | text not null | first 8 chars of the key, for display |
| `key_hash` | bytea not null unique | SHA-256 of the full key |
| `last_used_at` | timestamptz null | updated at most once per minute |
| `revoked_at` | timestamptz null | null means active |
| `created_at` | timestamptz not null | |

Key format: `mn_live_` + 32 random bytes in base64url. Lookup is by `key_hash`, then compared with `timingSafeEqual`.

Indexes: `(owner_id) WHERE revoked_at IS NULL`.

### scans

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | also the storage key suffix |
| `owner_id` | uuid not null FK → owners, on delete cascade | |
| `status` | `scan_status` not null default `queued` | BR-01, BR-02 |
| `verdict` | `verdict` null | set only when `done` (BR-04) |
| `reasons` | text[] not null default `{}` | BR-16 |
| `partial` | boolean not null default false | BR-08 |
| `reused_from_id` | uuid null FK → scans, on delete set null | BR-21 |
| `error` | text null | short code when `failed`, for example `timeout`, `clamav_unavailable` |
| `sha256` | bytea not null | 32 bytes |
| `md5` | bytea not null | 16 bytes |
| `size_bytes` | bigint not null | > 0 |
| `original_name` | text null | cleaned, max 255 (BR-19) |
| `claimed_type` | text null | from extension / Content-Type |
| `detected_type` | text null | from magic bytes |
| `storage_key` | text null | `quarantine/<id>`; null after the file is deleted |
| `file_deleted_at` | timestamptz null | BR-35 |
| `created_at` | timestamptz not null | |
| `started_at` | timestamptz null | first move to `scanning` |
| `finished_at` | timestamptz null | move to `done` or `failed` |

Checks:
- `verdict IS NULL` unless `status = 'done'`.
- `finished_at IS NOT NULL` when `status IN ('done', 'failed')`.

Indexes:
- `(owner_id, id DESC)`: list scans, cursor pagination.
- `(owner_id, sha256, finished_at DESC) WHERE status = 'done'`: reuse check and hash lookup.
- `(status, created_at) WHERE status IN ('queued', 'scanning')`: stuck-scan sweep.
- `(created_at)`: retention cleanup.

`sha256` is **not** unique: many owners, and the same owner many times, can scan the same file.

### scan_results

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `scan_id` | uuid not null FK → scans, on delete cascade | |
| `engine` | `engine_name` not null | |
| `status` | `engine_status` not null | |
| `finding` | text null | engine summary, for example `Eicar-Signature`, `5/70`, `unknown`, `mismatch:pe` |
| `details` | jsonb not null default `{}` | engine-specific raw data |
| `duration_ms` | integer null | |
| `created_at` | timestamptz not null | |

Unique: `(scan_id, engine)`. Processors upsert on this key, so re-running a job does not duplicate rows.

### webhooks

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid not null FK → owners, on delete cascade | |
| `url` | text not null | https only (BR-30) |
| `secret_encrypted` | bytea not null | AES-256-GCM with `WEBHOOK_ENCRYPTION_KEY`; nonce stored with it |
| `secret_prefix` | text not null | for display |
| `consecutive_failures` | integer not null default 0 | BR-34 |
| `disabled_at` | timestamptz null | |
| `created_at` | timestamptz not null | |

The secret is encrypted, not hashed, because the worker needs it to sign deliveries.

Indexes: `(owner_id) WHERE disabled_at IS NULL`.

### webhook_deliveries

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `webhook_id` | uuid not null FK → webhooks, on delete cascade | |
| `scan_id` | uuid not null FK → scans, on delete cascade | |
| `attempt` | integer not null | 1 to 6 |
| `status_code` | integer null | null on network error or timeout |
| `success` | boolean not null | |
| `error` | text null | short code |
| `created_at` | timestamptz not null | |

Indexes: `(webhook_id, created_at DESC)`.

## Object storage

| Bucket | Key | Content |
|---|---|---|
| `malnest-quarantine` (private) | `quarantine/<scanId>` | raw uploaded bytes, `Content-Type: application/octet-stream` |

The bucket has no public access and a lifecycle rule that deletes objects after `FILE_RETENTION_DAYS + 1` days, as a safety net behind the cleanup job.

## Redis

| Key / use | Owner | Notes |
|---|---|---|
| `bull:*` | BullMQ | queues listed in `docs/ARCHITECTURE.md` |
| `throttle:*` | `@nestjs/throttler` Redis storage | per-key rate limits |
| `vt:quota:<YYYY-MM-DD>` | worker | daily VirusTotal counter, expires after 48 h |

Redis is not backed up. Losing it loses queued jobs, which the stuck-scan sweep then marks `failed`.

## Job payloads

Defined in `libs/shared/src/queues/`. Payloads hold IDs, never file bytes or secrets.

```ts
interface LocalScanJob   { scanId: string; storageKey: string; originalName: string | null }
interface VirusTotalJob  { scanId: string; sha256Hex: string }
interface FinalizeJob    { scanId: string }
interface WebhookJob     { webhookId: string; scanId: string }
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

Never returned: `owner_id`, `storage_key`, `md5` as raw bytes, `details` with internal hosts.
