# Requirements

Each requirement is testable. `FR` means functional (what the system does). `NFR` means non-functional (how well it does it). Business rules (`BR-xx`) are in `docs/BUSINESS_RULES.md`.

## Functional requirements

### Scans

| ID | Requirement | Rules |
|---|---|---|
| FR-01 | `POST /v1/scans` accepts one `multipart/form-data` file in the field `file` and returns `202` with `{ id, status: "queued" }`. | BR-01, BR-18 |
| FR-02 | The upload is streamed to storage while SHA-256 and MD5 are computed. The whole file is never held in memory. | BR-18 |
| FR-03 | Uploads over the size limit get `413`. Empty uploads and requests with no `file` field get `400`. | BR-18 |
| FR-04 | A repeat upload of a recently scanned file returns `200` with the copied report and `reused: true`. | BR-21, BR-22 |
| FR-05 | `GET /v1/scans/:id` returns status, verdict, reasons, `partial`, `reused`, file metadata, and each engine result. | BR-04, BR-16 |
| FR-06 | `GET /v1/scans` lists the caller's scans, newest first, with cursor pagination (`limit` 1 to 100, default 20). Filters: `status`, `verdict`. | BR-25 |
| FR-07 | `GET /v1/scans/hash/:sha256` returns the caller's latest scan for that hash or `404`. Invalid hashes get `400`. | BR-23 |
| FR-08 | `DELETE /v1/scans/:id` deletes the stored file and the record and returns `204`. | BR-37 |

### Engines and verdict

| ID | Requirement | Rules |
|---|---|---|
| FR-10 | The `filetype` engine detects the real type from magic bytes and flags executable or script content hidden behind another extension. | BR-14 |
| FR-11 | The `archive` engine checks zip files against the archive limits without writing unpacked files to disk. | BR-20 |
| FR-12 | The `clamav` engine streams the file to `clamd` over TCP (`INSTREAM`) and records the signature name when one is found. | BR-07, BR-13 |
| FR-13 | The `virustotal` engine looks up the SHA-256 and records detection counts, or `unknown`, or `skipped`. | BR-09 to BR-11 |
| FR-14 | When all engines finish, the verdict function sets `verdict`, `reasons`, and `partial`, and the scan becomes `done` or `failed`. | BR-07, BR-08, BR-12 to BR-17 |
| FR-15 | A scheduled job fails scans that stay stuck past the timeout. | BR-03 |

### API keys and access

| ID | Requirement | Rules |
|---|---|---|
| FR-20 | Every `/v1` route needs the header `Authorization: Bearer <api key>`. Missing or wrong keys get `401`. | BR-24 |
| FR-21 | Reading or deleting another owner's scan or webhook returns `404`. | BR-25 |
| FR-22 | `POST /v1/api-keys` creates a key and returns it once. `GET /v1/api-keys` lists keys by prefix and name only. `DELETE /v1/api-keys/:id` revokes a key. | BR-26, BR-27 |
| FR-23 | A CLI script creates an owner and their first key: `bun run cli:create-owner --name <name>`. | BR-28 |
| FR-24 | Rate limits apply per key and return `429` with `Retry-After`. | BR-29 |

### Webhooks

| ID | Requirement | Rules |
|---|---|---|
| FR-30 | `POST /v1/webhooks` saves a URL and returns its signing secret once. `GET` lists webhooks. `DELETE /v1/webhooks/:id` removes one. | BR-30 to BR-32 |
| FR-31 | Unsafe URLs (http, private IPs, localhost, metadata IPs) are rejected with `400`. | BR-30 |
| FR-32 | On `scan.completed`, every active webhook of the owner gets a signed `POST`, with retries and auto-disable. | BR-32 to BR-34 |

### Operations

| ID | Requirement | Rules |
|---|---|---|
| FR-40 | `GET /health` (liveness) and `GET /health/ready` (Postgres, Redis, storage, and in the worker ClamAV) need no auth. | |
| FR-41 | The OpenAPI spec is served at `/docs/openapi.json` and a Scalar docs page at `/docs`, both only when `NODE_ENV` is not `production`. | |
| FR-42 | A daily job deletes old files and old records. | BR-35, BR-36 |

### Error format

All errors use one JSON shape:

```json
{ "statusCode": 404, "error": "Not Found", "message": "Scan not found", "requestId": "..." }
```

## Non-functional requirements

### Security

| ID | Requirement |
|---|---|
| NFR-01 | Uploaded files are never executed, imported, or opened by another program. Only their bytes are read. |
| NFR-02 | The quarantine bucket is private. No public URLs. |
| NFR-03 | API keys and webhook secrets never appear in logs, errors, or responses after creation. |
| NFR-04 | All input is validated with DTOs. Unknown fields are rejected. |
| NFR-05 | Security headers via `helmet`. CORS is off by default (API-to-API use). |
| NFR-06 | Containers run as a non-root user. The worker has a read-only root filesystem. |
| NFR-07 | CI blocks merges on high or critical findings from Trivy or CodeQL. |

### Performance

| ID | Requirement |
|---|---|
| NFR-10 | After an upload finishes arriving, the API answers within 300 ms (p95). |
| NFR-11 | For a 50 MB file, local engines (filetype, archive, clamav) finish within 30 seconds (p95) once the job starts, on a 4 GB VPS. |
| NFR-12 | API memory does not grow with upload size (streaming). |
| NFR-13 | Worker concurrency is set by `WORKER_CONCURRENCY` (default 2). |

### Reliability

| ID | Requirement |
|---|---|
| NFR-20 | Every job is idempotent. Running it twice gives the same result and no duplicate rows. |
| NFR-21 | Every outside call has a timeout: ClamAV 60 s, VirusTotal 15 s, storage 30 s, webhooks 10 s. |
| NFR-22 | On shutdown, apps stop taking new work, finish running jobs (up to 30 s), then close connections. |
| NFR-23 | The app refuses to start if a required env var is missing or invalid. |

### Observability

| ID | Requirement |
|---|---|
| NFR-30 | Logs are structured JSON in production, with a `requestId` on every HTTP log line and a `scanId` on every job log line. |
| NFR-31 | Each response includes an `X-Request-Id` header. |

### Quality

| ID | Requirement |
|---|---|
| NFR-40 | `VerdictPolicy` has 100% branch coverage. |
| NFR-41 | Every `domain/` folder has at least 90% line coverage. The whole project has at least 70%. |
| NFR-42 | Every user story in `docs/PRODUCT_SPEC.md` has an e2e test. |
| NFR-43 | `bun run lint`, `bun run test`, `bun run test:e2e`, and `bun run build` pass on every PR. |

## Constraints

- Free VirusTotal API: 4 requests per minute, 500 per day.
- One VPS with 4 GB RAM. ClamAV alone uses about 1.5 GB.
- Monthly cost under 10 EUR.
- Solo developer, part time.
