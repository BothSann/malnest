# Product Spec

## One line

malnest is a self-hosted API that scans uploaded files for malware and returns a clear verdict: `clean`, `suspicious`, or `malicious`.

## Problem

Apps that accept file uploads (avatars, invoices, attachments) often store them without checking them. A bad file can then reach other users or internal systems. Adding scanning is hard: antivirus engines are heavy, online services have strict limits, and upload handling has many traps (huge files, fake file types, zip bombs).

malnest wraps all of this behind one small HTTP API.

## Who it is for

| User | Need |
|---|---|
| **App developer** (main user) | Send a file or a hash, get a verdict, and get told when a scan finishes. |
| **Owner / operator** (the person running malnest) | Create API keys, deploy it cheaply, see that it is healthy. |

This is also a learning project. The owner builds it to learn NestJS, security, CI/CD, and infrastructure, so clear code and good tests matter as much as features.

## Goals

1. Accept a file upload safely and return a scan ID fast.
2. Scan with several engines: ClamAV, VirusTotal (hash lookup), real file type check, and archive (zip bomb) check.
3. Combine the engine results into one verdict with a short reason.
4. Let callers get results by polling or by webhook.
5. Keep each API key's scans private from everyone else.
6. Run on one small VPS for a few euros a month.

## Non-goals (v1)

- No web UI. API only.
- No user sign-up, passwords, or OAuth. The owner creates API keys.
- No uploading user files to VirusTotal. Hash lookups only.
- No sandbox that runs files to watch what they do.
- No cleaning or "fixing" infected files.
- No billing, teams, or multi-region setup.

## Features

### v1 (MVP)

| ID | Feature |
|---|---|
| F1 | Upload a file and get a scan ID (`POST /v1/scans`). |
| F2 | Get a scan's status and report (`GET /v1/scans/:id`). |
| F3 | List your scans with pagination (`GET /v1/scans`). |
| F4 | Look up your latest scan by SHA-256 (`GET /v1/scans/hash/:sha256`). |
| F5 | Scan engines: file type, archive check, ClamAV, VirusTotal hash lookup. |
| F6 | One combined verdict with reasons. |
| F7 | Reuse recent results when the same file is uploaded again. |
| F8 | API key auth, per-key rate limits, and owner-only access. |
| F9 | Create, list, and revoke API keys. |
| F10 | Webhooks that call your URL when a scan finishes, signed with HMAC. |
| F11 | Delete a scan and its stored file. |
| F12 | Health checks and OpenAPI docs. |
| F13 | Automatic cleanup of old files. |

### Later

- Live status over Server-Sent Events or WebSocket.
- YARA rules (custom malware patterns).
- Looking inside PDF and Office files for scripts and macros.
- Opt-in upload of unknown files to VirusTotal.
- Small drag-and-drop web page.
- Auto-scaling workers on k3s.

## Main user stories

1. As a developer, I upload a file and get `202 Accepted` with a scan ID in under a second after the upload finishes.
2. As a developer, I poll the scan ID and see `queued`, then `scanning`, then `done` with a verdict and reasons.
3. As a developer, I upload the EICAR test file and get `malicious`.
4. As a developer, I upload a `.pdf` that is really a Windows `.exe` and get `suspicious` with the reason "file type mismatch".
5. As a developer, I upload a zip bomb and get `suspicious` without the server running out of disk or memory.
6. As a developer, I register a webhook and receive a signed `scan.completed` call.
7. As a developer, I try to read another key owner's scan and get `404`.
8. As the owner, I deploy with one merge to `main` and see green health checks.

## Success measures

- Every user story above has an e2e test that passes in CI.
- EICAR is always flagged. Plain text files are always `clean`.
- No scan stays in `queued` or `scanning` for more than 10 minutes without becoming `done` or `failed`.
- Monthly running cost is under 10 EUR.

## Related docs

- Rules the system must follow: `docs/BUSINESS_RULES.md`
- Testable requirements: `docs/REQUIREMENTS.md`
- How it is built: `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/TECH_STACK.md`
- Build order: `docs/TASK_PLAN.md`
