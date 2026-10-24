# shared (shared kernel)

Technical building blocks used by every bounded context. **No business concepts here.** If a type mentions scans, owners, or webhooks, it belongs in a context, not here.

## Planned layout

```
shared/
├── domain/                  # plain TypeScript only
│   ├── aggregate-root.ts    # collects domain events, pullEvents()
│   ├── domain-event.ts
│   ├── domain-error.ts      # base class with a stable `code`
│   └── concurrency-error.ts
├── application/
│   └── ports/               # Clock, IdGenerator (+ tokens)
├── infrastructure/
│   ├── config/              # zod env schema, typed config service
│   ├── database/            # Drizzle client, DB_WRITER / DB_READER, transaction helper
│   ├── outbox/              # messaging.outbox + messaging.inbox, relay (worker only)
│   ├── queue/               # BullMQ root connection
│   ├── logging/             # nestjs-pino setup
│   └── health/              # terminus indicators
└── api/
    ├── filters/             # DomainError → HTTP status, error JSON shape
    ├── interceptors/        # request ID
    └── dto/                 # pagination
```

Contexts may import from `src/shared/*`. `src/shared` never imports from `src/modules/*`.
