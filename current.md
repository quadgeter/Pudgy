# current.md — Current State

## Status

Shared model types and first domain function (`monthlySpend`) implemented and tested. Monorepo
scaffold in place. Architecture is a separate backend + frontend monorepo (see decision log).
Data model itself is unchanged in substance — see pudgy.md for full current architecture.

## TODO

### Scaffolding
- [ ] Set up pnpm workspace (`pnpm-workspace.yaml`, root `package.json`)
- [ ] `packages/shared` — init package, TypeScript config
- [ ] `apps/api` — init Hono app, add tRPC, confirm a health-check procedure responds
- [ ] `apps/web` — init SvelteKit app (frontend only), add tRPC client pointed at `apps/api`
- [ ] Confirm end-to-end type inference works: a type change in `packages/shared` should show up
      as a type error in both apps without any manual sync step
- [ ] Install and configure `vite-plugin-pwa` in `apps/web` (manifest, service worker,
      install-to-home-screen)

### Shared model layer
- [x] `packages/shared/src/models/account.ts`, `transaction.ts`, `category.ts`, `budget.ts` per
      shapes in pudgy.md (money fields are `Cents = number`, per 2026-09-01 decision)
- [x] `packages/shared/src/domain/monthlySpend.ts` — implement per the SPEND spec, all rules
      SPEND-01 through SPEND-16 plus properties P1–P9 as generative tests (see test checklist
      in the spec doc). 42 tests passing (33 rule tests + 9 property tests).

### Provider adapters (in `apps/api`)
- [ ] `providers/providerAdapter.ts` — interface
- [ ] `providers/plaidAdapter.ts` — start with hardcoded fake data, no real Plaid calls yet
- [ ] `providers/simpleFinAdapter.ts` — same, fake data first
- [ ] `services/accountSyncService.ts` — orchestrates adapters

### tRPC routers (in `apps/api`)
- [ ] `routers/accounts.ts` — wired to fake adapter data, confirm type-safe round trip to the
      frontend (esp. decimal string handling)
- [ ] `routers/transactions.ts`
- [ ] `routers/budgets.ts`

### Persistence (in `apps/api`)
- [ ] Set up Drizzle ORM + `better-sqlite3`
- [ ] `db/schema.ts` — table definitions for accounts, transactions, budgets,
      budget_category_limits
- [ ] `db/repositories/` — typed query functions per entity
- [ ] Swap fake adapter data for real persisted data

### Sync job (in `apps/api`)
- [ ] `jobs/syncSchedule.ts` — scheduled process (`node-cron` or similar) calling
      `accountSyncService` on an interval, independent of any frontend request
- [ ] Confirm the job runs as part of the backend's persistent process, not as a
      request-triggered handler

### Real provider integration
- [ ] Register Plaid Trial account, get redirect URI set up for OAuth institutions
- [ ] Implement Plaid Link token flow, exchange, `/transactions/sync` cursor handling (Node SDK)
- [ ] Implement Link update mode (handle `ITEM_LOGIN_REQUIRED`)
- [ ] Subscribe to Plaid webhooks (`SYNC_UPDATES_AVAILABLE`) — have the backend receive these
      directly, since it's now a persistent addressable service
- [ ] Set up SimpleFIN Bridge account, get access URLs for non-investment accounts

### Budget logic (in `apps/api`)
- [ ] `services/budgetService.ts` — on-the-fly spend calculation per category for the current
      period (calendar month for `recurring`)
- [ ] Exclude `TRANSFER` (and possibly `DEBT_PAYMENT`) from spend totals

### Frontend (`apps/web`)
- [ ] Dashboard page — account balances, budget status
- [ ] Budget setup UI — create/edit budgets and category limits
- [ ] Transaction list + manual category override UI
- [ ] Push notification setup for budget alerts (iOS 16.4+, non-EU, requires explicit
      in-app opt-in tap)

### Deployment (new consideration from the backend split)
- [ ] Decide hosting for `apps/api` as a persistent process (VPS, Fly.io, Railway, etc.) —
      no longer deployable as pure serverless functions since it needs to run the sync job
- [ ] Decide hosting for `apps/web` (can stay serverless/static-friendly, e.g. Vercel/Netlify)
- [ ] Set up CORS between the two once real domains/ports are known

## Future considerations (not being designed yet)

- **Multi-user / shared use with partner.** Raised but deliberately deferred. When revisited,
  needs a decision on shape first — fully separate accounts per person, a fully shared/joint
  view, or a mixed model (some accounts/budgets shared, some private) — before touching the
  schema, since each implies a different ownership model (`userId` scoping vs a
  `Household`/membership concept). Also raises the Plaid Item cap faster, since Items are
  counted per Plaid team, not per end user. Do not add a `userId` field speculatively until this
  is actually decided — right now the whole schema assumes a single user.

## Recent decisions

**2026-09-01 — `monthlySpend` spec finalized; three open questions resolved.** First domain
spec written (pure function in `packages/shared`, see pudgy.md's "Domain logic" section for
summary). Resolutions:
- **Money representation: integer cents (`Cents = number`), final.** Supersedes the still-open
  "decimal string vs cents" TODO — `Account.balance`, `Transaction.amount`,
  `CategoryLimit.limit`, and `Budget.totalIncome` all changed from decimal `string` to `Cents`
  in pudgy.md. No decimal library needed; native integer arithmetic only.
- **Pending transactions: excluded from spend calculations.** Considered including them for
  always-current numbers, but rejected — Plaid represents settlement as a remove-and-replace
  with a new transaction id rather than an in-place update, so "include pending" would require
  pending→posted reconciliation logic in the sync layer that doesn't otherwise need to exist,
  risking silent double-counting if that logic has a bug. Settled-only trades a day or two of
  staleness for numbers that are never wrong. Revisit once the sync layer is proven solid —
  `monthlySpend` itself won't need to change if this is revisited later, since it already
  treats `pending` as a plain filter field.
- **Removed transactions: hard delete**, not tombstoned. No audit-trail requirement exists
  anywhere in the project, and since spend is computed live from current data, a tombstone
  would add a field nothing reads.
- **`Transaction.pending: boolean` added to the shared model** to support the above.

Also fixed a type-design bug caught during spec review: the spec's draft `Budget` type assumed
one budget maps to a single category/limit pair, which doesn't match the real `Budget` shape
(one budget, many `CategoryLimit`s, decided 2026-08-29). Fixed by having `monthlySpend` take
`category` as a separate parameter and look up the relevant limit internally, rather than
changing the `Budget` model to fit the spec. `limit` is deliberately not part of
`monthlySpend`'s inputs at all — comparing spend against a limit is a separate, not-yet-written
calculation that consumes this function's output.

**2026-08-31 — Split into a separate backend + frontend (pnpm monorepo), reversing the earlier
merged-SvelteKit decision.** Driving reason: background sync (polling Plaid/SimpleFIN,
handling webhooks) doesn't fit a request/response model well, especially under serverless
deployment. A persistent backend process can run a real scheduled sync job; a merged
serverless-deployed SvelteKit app could not, without awkward workarounds. To avoid
reintroducing the type-duplication problem that caused the earlier merge, the split uses tRPC
(full type inference across the network boundary) and a shared `packages/shared` types package
consumed by both apps. Stack: Hono + tRPC for the backend, SvelteKit (frontend only) for the
web app.

**2026-08-31 — Multi-user support explicitly deferred.** Possibility of a partner also using
the app was raised; decided not to design for it now. Logged as a future consideration (see
above) so it isn't forgotten, but no schema changes made — current data model still assumes a
single user throughout.

**2026-08-31 — Switched stack from Kotlin/Ktor to TypeScript/SvelteKit (superseded in part by
the entry above).** The original Kotlin choice was motivated by wanting to learn the language;
once that motivation dropped (learning Kotlin through work instead), Kotlin no longer had a
product advantage. TypeScript end-to-end remains the choice; the merged-vs-split backend
question was revisited the same day (see above).

**2026-08-29 — Provider category + manual override for categorization.** `Transaction` carries
both `providerCategory` and `userCategory`; effective category resolves the override first,
falling back to provider, then `UNCATEGORIZED`. Rejected manual-only to reduce categorization
busywork.

**2026-08-29 — Recurring budgets compute spend on the fly**, no snapshot/instance table per
period. Simpler for a single-user app; accepted trade-off that editing a limit today
reinterprets past months.

**2026-08-29 — `Budget` needs an explicit `startDate`** even when recurring, so "since I
started this budget" is answerable later even though current spend calculation only uses
calendar-month boundaries for now.

**2026-08-29 — `BudgetPeriod` modeled to make invalid states unrepresentable** — a
discriminated union (`{ kind: "recurring" }` / `{ kind: "fixedTerm", endDate }`), so no
combination like "short-term with no end date" can exist.

**Earlier — Category set finalized as hardcoded, ~20 categories, grouped via a category-group
mapping.** Includes `TRANSFER` as its own category (must be excluded from spend totals) and
`UNCATEGORIZED` as a required fallback.

**Earlier — Split account aggregation across two providers**: Plaid (free Trial, 10 lifetime
Items) for investment/brokerage accounts where its data is strongest; SimpleFIN Bridge
($15/year) for everyday checking/savings/credit accounts to conserve Plaid's Item cap.
Unaffected by later architecture changes.

**Superseded — Backend was Kotlin + Ktor, DB access was raw JDBC.** No longer applicable.

**Superseded — SvelteKit hosted both frontend and API routes in one app.** Replaced by the
separate backend/frontend split above.
