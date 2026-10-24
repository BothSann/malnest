# scanning

The core of malnest. Owns **uploads**, the **quarantine** bucket, the four **engines**, the **scan lifecycle**, the **verdict**, and **retention**.

## Aggregates

| Aggregate root | Rules |
|---|---|
| `Scan` | Status moves, verdict only when done, reuse, delete (BR-01 to BR-04, BR-18, BR-19, BR-21 to BR-23, BR-25, BR-35 to BR-37) |
| `ScanResult` | One per scan and engine, upserted (BR-05 to BR-11) |

Domain service: `VerdictPolicy` turns scan results into a verdict and reasons (BR-12 to BR-17).

`Scan` and `ScanResult` are separate so the local-scan and VirusTotal jobs can save in parallel without fighting over one aggregate.

## Commands and queries

| Commands | Queries |
|---|---|
| `SubmitScan`, `RunLocalEngines`, `RunVirusTotalLookup`, `FinalizeScan`, `DeleteScan`, `FailStuckScans`, `PurgeExpiredFiles`, `PurgeExpiredScans` | `GetScan`, `ListScans`, `FindLatestScanByHash` |

## Public contract (`index.ts`)

- `ScanningModule`, `ScanningHttpModule`, `ScanningJobsModule`
- integration event `scanning.scan-completed.v1` (type only)

Uses from identity: `@CurrentOwner()`, `AuthenticatedOwner`. Consumes no integration events.

## Planned layout

```
scanning/
├── domain/
│   ├── scan.ts                      # aggregate root
│   ├── scan-result.ts               # aggregate root
│   ├── verdict-policy.ts            # domain service, pure
│   ├── value-objects/               # Sha256, FileSize, FileName, ScanStatus, Verdict, EngineName, Reason
│   ├── events/                      # ScanCompleted
│   ├── errors/                      # ScanNotFound, InvalidStatusMove, FileTooLarge, ...
│   ├── scan.repository.ts           # interface + SCAN_REPOSITORY token
│   └── scan-result.repository.ts    # interface + SCAN_RESULT_REPOSITORY token
├── application/
│   ├── commands/                    # submit-scan, run-local-engines, run-virustotal-lookup, finalize-scan, ...
│   ├── queries/                     # get-scan, list-scans, find-latest-scan-by-hash
│   └── ports/                       # FileStorage, MalwareEngine, ScanPipeline
├── infrastructure/
│   ├── persistence/                 # scanning.* tables, mappers, Drizzle repositories, outbox write
│   ├── storage/                     # S3 FileStorage (MinIO / R2)
│   ├── engines/
│   │   ├── filetype/
│   │   ├── archive/
│   │   ├── clamav/                  # INSTREAM TCP client
│   │   └── virustotal/
│   └── queue/                       # BullMQ flow ScanPipeline, job payload types
├── api/
│   ├── http/                        # scans.controller.ts, dto/
│   └── jobs/                        # local-scan, virustotal, finalize, maintenance processors
├── contracts/                       # scan-completed.integration-event.ts
├── scanning.module.ts
├── scanning-http.module.ts
├── scanning-jobs.module.ts
└── index.ts
```

Postgres schema: `scanning`. Redis: `bull:scan-*`, `vt:quota:*`. Bucket: `malnest-quarantine`.

**Handle uploads with care:** read `.claude/rules/file-safety.md` before touching storage or engines.
