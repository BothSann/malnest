# Business Rules

These rules decide how malnest behaves. Code must follow them exactly. Each rule has an ID so tests, issues, and PRs can point to it. To change a rule, change this file in the same PR as the code.

Numbers marked with a config key come from env vars, with the default shown here.

## Scan lifecycle

**BR-01. Statuses.** A scan is always in one of: `queued`, `scanning`, `done`, `failed`.

**BR-02. Allowed moves.** Only these status changes are allowed:

```
queued ──► scanning ──► done
   │           │
   └───────────┴──────► failed
```

`done` and `failed` are final. A final scan never changes status again.

**BR-03. Stuck scans.** A scan that stays in `queued` or `scanning` longer than `SCAN_TIMEOUT_MINUTES` (default 10) is moved to `failed` with the error `timeout`.

**BR-04. Verdict only when done.** `verdict` is set only when status is `done`. It is `null` for every other status.

## Engines

**BR-05. Engines in v1:** `filetype`, `archive`, `clamav`, `virustotal`.

**BR-06. Engine result status.** Each engine saves one result per scan with status `ok`, `error`, or `skipped`, plus its own finding.

**BR-07. ClamAV is required.** If the ClamAV result is `error` after all retries, the scan is `failed`. malnest never says `clean` without an antivirus result.

**BR-08. Other engines are optional.** If `filetype`, `archive`, or `virustotal` errors, the scan still finishes using the other results, and the report sets `partial: true`.

**BR-09. VirusTotal is hash-only.** malnest only looks up the SHA-256 on VirusTotal. It never uploads file bytes there in v1.

**BR-10. VirusTotal skipped.** VirusTotal is `skipped` (not `error`) when no API key is configured or when the daily quota (`VT_DAILY_LIMIT`, default 500) is used up. Skipped does not set `partial`.

**BR-11. VirusTotal "not found".** If VirusTotal has never seen the hash, its finding is `unknown`. Unknown is not evidence of `clean` or `malicious`.

## Verdict

**BR-12. Verdict values:** `clean`, `suspicious`, `malicious`.

**BR-13. Malicious** when any of these is true:
- ClamAV finds a signature.
- VirusTotal reports `VT_MALICIOUS_THRESHOLD` (default 3) or more engines flagging the file as malicious.

**BR-14. Suspicious** when not malicious and any of these is true:
- VirusTotal reports 1 to `VT_MALICIOUS_THRESHOLD - 1` malicious detections.
- The real file type is an executable or script (for example PE, ELF, Mach-O, shell script) but the file name extension says otherwise.
- The archive check hits any limit in BR-20.
- The archive is encrypted or password-protected, so its contents cannot be scanned.

**BR-15. Clean** when not malicious, not suspicious, and ClamAV finished with status `ok`.

**BR-16. Reasons.** Every verdict comes with a list of short, machine-readable reasons, for example `clamav:Eicar-Signature`, `virustotal:5/70`, `filetype:mismatch`, `archive:depth_limit`. A `clean` verdict has an empty list.

**BR-17. Verdict policy.** The verdict is computed by the `VerdictPolicy` domain service from the scan results, with no I/O. It lives in `src/modules/scanning/domain/` and has tests for every branch.

## Uploads

**BR-18. Size limit.** Files larger than `MAX_UPLOAD_BYTES` (default 50 MB) are rejected with `413` before the full body is read. Empty files (0 bytes) are rejected with `400`.

**BR-19. File names.** The original file name is kept only as metadata, after removing path parts and control characters and cutting it to 255 characters. It is never used as a storage path.

**BR-20. Archive limits.** For zip files, the archive check stops and reports `suspicious` when any limit is hit:

| Limit | Config key | Default |
|---|---|---|
| Nesting depth | `ARCHIVE_MAX_DEPTH` | 3 |
| Number of entries | `ARCHIVE_MAX_ENTRIES` | 1000 |
| Total unpacked size | `ARCHIVE_MAX_UNPACKED_BYTES` | 500 MB |
| Compression ratio of one entry | `ARCHIVE_MAX_RATIO` | 100 |

The check reads archive metadata and streams entries. It never writes unpacked files to disk.

## Reusing results

**BR-21. Same file again.** When an owner uploads a file whose SHA-256 matches one of their own `done` scans finished less than `RESULT_REUSE_HOURS` (default 24) ago, malnest creates a new scan record that copies those results, marks it `reused: true`, and returns `200` with the report instead of `202`. The file bytes are not stored again.

**BR-22. No sharing between owners.** Results are never reused across owners. Knowing that another owner scanned a file is private information.

**BR-23. Hash lookup.** `GET /v1/scans/hash/:sha256` returns only the caller's own latest scan for that hash, or `404`.

## Access

**BR-24. Owners and keys.** Every API key belongs to one owner. Every scan and webhook belongs to the owner of the key that created it.

**BR-25. Owner-only access.** A key can read, list, and delete only its owner's scans and webhooks. Anything else returns `404`, never `403`, so callers cannot learn that the record exists.

**BR-26. Key secrecy.** A new API key is shown once, at creation. malnest stores only its SHA-256 hash and an 8-character prefix for display.

**BR-27. Key limits.** An owner can have at most `MAX_KEYS_PER_OWNER` (default 5) active keys. A key cannot revoke itself if it is the owner's last active key.

**BR-28. First key.** The first owner and key are created with a command-line script run on the server. There is no public sign-up.

**BR-29. Rate limits per key.**

| Action | Config key | Default |
|---|---|---|
| Uploads | `RATE_UPLOADS_PER_MINUTE` | 10 per minute |
| Uploads | `RATE_UPLOADS_PER_DAY` | 200 per day |
| All other requests | `RATE_REQUESTS_PER_MINUTE` | 120 per minute |

Over the limit returns `429` with a `Retry-After` header.

## Webhooks

**BR-30. URL rules.** Webhook URLs must use `https`, must not contain credentials, and must not resolve to private, loopback, link-local, or cloud metadata addresses. The check runs when the webhook is saved and again before each delivery, because DNS can change.

**BR-31. Limit.** An owner can have at most `MAX_WEBHOOKS_PER_OWNER` (default 3) webhooks.

**BR-32. Signing.** Each webhook has a secret, shown once at creation. Every delivery has the header `X-Malnest-Signature: sha256=<hex HMAC of the raw body>` and an `X-Malnest-Timestamp` header.

**BR-33. Event.** v1 sends one event: `scan.completed`, fired when a scan becomes `done` or `failed`. The body holds the scan ID, status, verdict, and reasons, never file contents.

**BR-34. Delivery.** A delivery succeeds on any `2xx` response within 10 seconds. Otherwise it retries up to 5 times with exponential backoff. After 20 failed deliveries in a row, the webhook is disabled.

## Retention

**BR-35. Files.** Stored files are deleted from the quarantine bucket `FILE_RETENTION_DAYS` (default 7) days after upload. The scan record stays.

**BR-36. Records.** Scan records and results are deleted `RECORD_RETENTION_DAYS` (default 90) days after creation.

**BR-37. Manual delete.** `DELETE /v1/scans/:id` deletes the stored file right away and then deletes the record. It is allowed in any status. A queued or running job for that scan stops and does nothing.
