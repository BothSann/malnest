# Glossary

The shared language of malnest. Use these exact words in code, docs, issues, and tests. If a new term is needed, add it here first.

## Business terms

| Term | Context | Meaning | Code name |
|---|---|---|---|
| **Owner** | identity | The person or system that holds API keys and owns scans and webhooks. | `Owner` |
| **API key** | identity | A secret that proves a request comes from an owner. Shown once, stored as a hash. | `ApiKey` |
| **Key prefix** | identity | The first 8 characters of an API key, safe to show in lists. | `prefix` |
| **Revoke** | identity | Turn off an API key for good. | `revoke()` |
| **Scan** | scanning | One check of one uploaded file, from upload to verdict. | `Scan` |
| **Scan status** | scanning | Where a scan is: `queued`, `scanning`, `done`, `failed`. | `ScanStatus` |
| **Engine** | scanning | One way of checking a file: `filetype`, `archive`, `clamav`, `virustotal`. | `MalwareEngine` |
| **Scan result** | scanning | What one engine found for one scan. Status `ok`, `error`, or `skipped`, plus a finding. | `ScanResult` |
| **Finding** | scanning | An engine's short answer, for example `Eicar-Signature`, `5/70`, `unknown`, `mismatch:pe`. | `finding` |
| **Verdict** | scanning | The final answer for a scan: `clean`, `suspicious`, `malicious`. | `Verdict` |
| **Reason** | scanning | A short code explaining a verdict, for example `clamav:Eicar-Signature`. | `reasons` |
| **Verdict policy** | scanning | The rules that turn scan results into a verdict (BR-12 to BR-17). | `VerdictPolicy` |
| **Partial** | scanning | A `done` scan where an optional engine errored. | `partial` |
| **Reused scan** | scanning | A scan that copied results from the owner's recent scan of the same file (BR-21). | `reusedFromId` |
| **Quarantine** | scanning | The private bucket where uploaded files wait. Files there are never run or served publicly. | `FILE_STORAGE` |
| **Claimed type** | scanning | The file type the uploader says (name extension or header). | `claimedType` |
| **Detected type** | scanning | The real file type found from the first bytes. | `detectedType` |
| **Magic bytes** | scanning | The first bytes of a file that show its real type. | |
| **Zip bomb** | scanning | A small archive that unpacks to a huge size or very deep nesting. | |
| **Stuck scan** | scanning | A scan in `queued` or `scanning` for longer than the timeout (BR-03). | |
| **Retention** | scanning | How long files and records are kept before deletion (BR-35, BR-36). | |
| **Webhook** | webhooks | An owner's HTTPS URL that malnest calls when a scan finishes. | `Webhook` |
| **Delivery** | webhooks | One attempt to call a webhook for one scan. | `WebhookDelivery` |
| **Signing secret** | webhooks | The secret used to sign webhook bodies with HMAC. Shown once. | `secret` |
| **Disabled webhook** | webhooks | A webhook turned off after 20 failed deliveries in a row (BR-34). | `disabledAt` |

## Technical terms

| Term | Meaning |
|---|---|
| **Bounded context** | A part of the system with its own words and rules. malnest has three: identity, scanning, webhooks. |
| **Aggregate** | A group of objects saved and changed together as one unit. Only its root is used from outside. |
| **Aggregate root** | The one object in an aggregate that outside code talks to. It guards the rules. |
| **Value object** | A small, unchangeable type defined by its value, which checks itself when created (for example `Sha256`). |
| **Domain event** | Something that happened inside a context, raised by an aggregate (for example `ScanCompleted`). |
| **Integration event** | A versioned message one context publishes for others (for example `scanning.scan-completed.v1`). |
| **Outbox** | A table where integration events are saved in the same transaction as the data, then sent by a relay. |
| **Inbox** | A table where a consumer records handled event IDs, so the same event never runs twice. |
| **Command** | A request to change state. Goes through an aggregate. |
| **Query** | A request to read state. Reads SQL directly and returns a DTO. |
| **Port** | An interface the application layer needs from the outside world (storage, engines, queues). |
| **Adapter** | An infrastructure class that implements a port. |
| **Contract** | What a context exports in `contracts/` and `index.ts`. The only thing other contexts may import. |
| **EICAR** | A harmless test string that every antivirus flags as a virus. Used in tests instead of real malware. |
