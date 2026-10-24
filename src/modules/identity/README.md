# identity

Owns **owners**, **API keys**, and **authentication**. Every other context trusts the owner ID this context puts on the request.

## Aggregates

| Aggregate root | Children | Rules |
|---|---|---|
| `Owner` | `ApiKey` entities | BR-24, BR-26, BR-27, BR-28 |

## Commands and queries

| Commands | Queries |
|---|---|
| `CreateOwner`, `IssueApiKey`, `RevokeApiKey` | `AuthenticateApiKey`, `ListApiKeys` |

## Public contract (`index.ts`)

- `IdentityModule`, `IdentityHttpModule`
- `ApiKeyGuard` (registered globally by `ApiModule`), `@Public()`, `@CurrentOwner()`
- type `AuthenticatedOwner { ownerId, apiKeyId }`

Publishes no integration events in v1. Consumes none.

## Planned layout

```
identity/
├── domain/
│   ├── owner.ts                     # aggregate root
│   ├── api-key.ts                   # entity inside Owner
│   ├── value-objects/               # OwnerName, ApiKeyHash, KeyPrefix
│   ├── errors/                      # KeyLimitReached, CannotRevokeLastKey, ...
│   └── owner.repository.ts          # interface + OWNER_REPOSITORY token
├── application/
│   ├── commands/                    # create-owner, issue-api-key, revoke-api-key
│   ├── queries/                     # authenticate-api-key, list-api-keys
│   └── ports/                       # ApiKeyGenerator
├── infrastructure/
│   ├── persistence/                 # identity.* tables, mapper, Drizzle repository
│   └── crypto/                      # random key generator, SHA-256 hashing
├── api/
│   ├── http/                        # api-keys.controller.ts, dto/
│   ├── guards/                      # api-key.guard.ts
│   ├── decorators/                  # public, current-owner
│   └── cli/                         # create-owner command
├── contracts/                       # AuthenticatedOwner, re-exported guard + decorators
├── identity.module.ts
├── identity-http.module.ts
└── index.ts
```

Postgres schema: `identity`.
