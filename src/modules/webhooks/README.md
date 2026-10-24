# webhooks

Owns **webhook endpoints**, **signing secrets**, and **deliveries**. Tells owners when a scan finishes.

## Aggregates

| Aggregate root | Rules |
|---|---|
| `Webhook` | HTTPS-only URL, per-owner limit, failure counter, auto-disable (BR-30, BR-31, BR-34) |
| `WebhookDelivery` | One append-only record per attempt (BR-32 to BR-34) |

## Commands and queries

| Commands | Queries |
|---|---|
| `RegisterWebhook`, `RemoveWebhook`, `ScheduleDeliveries`, `DeliverWebhook`, `PurgeOldDeliveries` | `ListWebhooks` |

## Public contract (`index.ts`)

- `WebhooksModule`, `WebhooksHttpModule`, `WebhooksJobsModule`

Uses from identity: `@CurrentOwner()`, `AuthenticatedOwner`.
Consumes: `scanning.scan-completed.v1` (from scanning's contracts), deduped through the inbox.
Never calls scanning directly. Everything it needs about a scan is in the event payload.

## Planned layout

```
webhooks/
├── domain/
│   ├── webhook.ts                   # aggregate root
│   ├── webhook-delivery.ts          # aggregate root, append-only
│   ├── value-objects/               # WebhookUrl, SecretPrefix
│   ├── errors/                      # WebhookLimitReached, UnsafeWebhookUrl, ...
│   ├── webhook.repository.ts
│   └── webhook-delivery.repository.ts
├── application/
│   ├── commands/                    # register-webhook, remove-webhook, schedule-deliveries, deliver-webhook
│   ├── queries/                     # list-webhooks
│   └── ports/                       # UrlSafetyChecker, WebhookSender, SecretCipher, DeliveryQueue
├── infrastructure/
│   ├── persistence/                 # webhooks.* tables, mappers, Drizzle repositories
│   ├── http/                        # fetch WebhookSender (no redirects, 10 s timeout)
│   ├── security/                    # DNS + ipaddr.js UrlSafetyChecker, AES-256-GCM SecretCipher, HMAC signer
│   └── queue/                       # BullMQ DeliveryQueue, job payload types
├── api/
│   ├── http/                        # webhooks.controller.ts, dto/
│   ├── jobs/                        # webhook-delivery processor
│   └── events/                      # scan-completed handler (inbox dedupe)
├── webhooks.module.ts
├── webhooks-http.module.ts
├── webhooks-jobs.module.ts
└── index.ts
```

Postgres schema: `webhooks`. Redis: `bull:webhook-delivery`.
