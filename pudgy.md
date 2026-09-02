# pudgy.md — Architecture

A personal finance system: a TypeScript full-stack app aggregating bank, credit, and investment
accounts, with budget/category tracking, installed as a PWA on iOS. Built to replace Rocket
Money with something less cumbersome and fully custom.

## Tech stack

- **Architecture:** pnpm monorepo with a separate backend and frontend, sharing a common types
  package. Split chosen over a merged SvelteKit app so background sync jobs (Plaid/SimpleFIN
  polling, webhook handling) can run as a proper long-lived/scheduled process instead of being
  squeezed into serverless-style API route handlers.
- **Backend:** Hono + tRPC, running as a persistent Node (or Bun) process. tRPC specifically to
  preserve end-to-end type inference across the frontend/backend split — the type-duplication
  cost of a split backend is otherwise the same problem a Kotlin backend would have had.
- **Frontend:** SvelteKit — pure frontend now, no API routes of its own, calls the backend via
  the tRPC client.
- **Shared package:** domain models, category definitions, provider adapter interfaces — one
  source of truth imported by both apps.
- **DB access:** SQLite via Drizzle ORM (`better-sqlite3` driver), owned by the backend app —
  the frontend never talks to the DB directly, only through the API.
- **Account aggregation:**
  - **Plaid** — free Trial plan, capped at 10 lifetime Items (per Plaid team, not per end user —
    worth watching if a second person's accounts get added later). Used for accounts where
    investment holdings matter (brokerage, 401k).
  - **SimpleFIN Bridge** ($15/year flat, no per-item billing) — used for everyday
    checking/savings/credit accounts, to conserve Plaid's Item cap.
- **Sync jobs:** run inside the backend app via a scheduler (e.g. `node-cron`), writing directly
  to the DB — not triggered by frontend requests.
- **PWA:** manifest + service worker via a SvelteKit PWA plugin (e.g. `vite-plugin-pwa`),
  installed to iOS home screen. No native app — no home screen widgets, Live Activities, or
  background sync available on iOS PWAs; push notifications are the fallback for glanceable
  budget alerts.

## Project structure

```
finance-monorepo/
├── pnpm-workspace.yaml
├── package.json
├── apps/
│   ├── api/                       # backend — Hono + tRPC
│   │   ├── src/
│   │   │   ├── index.ts           # server entry point
│   │   │   ├── router.ts          # tRPC router, composes sub-routers
│   │   │   ├── routers/
│   │   │   │   ├── accounts.ts
│   │   │   │   ├── transactions.ts
│   │   │   │   └── budgets.ts
│   │   │   ├── services/
│   │   │   │   ├── accountSyncService.ts
│   │   │   │   └── budgetService.ts
│   │   │   ├── providers/
│   │   │   │   ├── providerAdapter.ts
│   │   │   │   ├── plaidAdapter.ts
│   │   │   │   └── simpleFinAdapter.ts
│   │   │   ├── db/
│   │   │   │   ├── schema.ts       # Drizzle table definitions
│   │   │   │   └── repositories/
│   │   │   └── jobs/
│   │   │       └── syncSchedule.ts # cron-scheduled sync job
│   │   └── package.json
│   └── web/                        # frontend — SvelteKit
│       ├── src/
│       │   ├── routes/             # pages only, no API routes
│       │   └── lib/
│       │       ├── trpc.ts         # tRPC client setup
│       │       └── components/     # charts, budget views, etc.
│       └── package.json
└── packages/
    └── shared/                     # imported by both apps
        ├── src/
        │   └── models/
        │       ├── account.ts
        │       ├── transaction.ts
        │       ├── category.ts
        │       └── budget.ts
        └── package.json
```

Build order used for scaffolding: backend health-check tRPC procedure → shared model types →
fake-data provider adapters → tRPC routers wired to fake adapters → frontend calling the fake
data end to end → real DB (Drizzle + SQLite) → real Plaid/SimpleFIN calls and the sync job last.

## Core architectural pattern: provider adapters

Plaid and SimpleFIN are abstracted behind a shared interface so the rest of the app never
references either by name:

```typescript
interface ProviderAdapter {
  provider: "plaid" | "simplefin";
  getAccounts(): Promise<Account[]>;
  getTransactions(accountId: string, since: string): Promise<Transaction[]>;
}
```

`PlaidAdapter` and `SimpleFINAdapter` each implement this, translating their respective API
responses into the canonical `Account`/`Transaction` model (defined in `packages/shared`).
`accountSyncService` iterates over an array of `ProviderAdapter`s and never knows which
provider it's talking to. Adding a third provider later means writing one new adapter —
nothing else changes. This lives entirely in `apps/api`; the frontend never sees a provider
type at all, only the canonical models via tRPC.

## Data model

(Lives in `packages/shared/src/models/`, imported by both `apps/api` and `apps/web`.)

```typescript
// Cents is the only money representation in this system. It is always a signed
// integer — positive on a Transaction means money left the account, negative
// means it returned (refund/reversal). Never a decimal string, never a float.
type Cents = number;

type Provider = "plaid" | "simplefin";

type AccountType =
  | "checking" | "savings" | "credit_card" | "investment" | "loan" | "other";

interface Account {
  id: string;
  institutionName: string;
  name: string;
  type: AccountType;
  balance: Cents;
  provider: Provider;
}

interface Transaction {
  id: string;
  accountId: string;
  date: string;              // "YYYY-MM-DD", date-only, no time, no zone
  amount: Cents;              // positive = outflow, negative = inflow
  description: string;
  providerCategory: Category | null;
  userCategory: Category | null;
  pending: boolean;
}

// derive effective category wherever a transaction's category is needed:
// userCategory ?? providerCategory ?? "UNCATEGORIZED"

type CategoryGroup = "ESSENTIAL" | "LIFESTYLE" | "FINANCIAL" | "INCOME" | "OTHER";

type Category =
  | "HOUSING" | "UTILITIES" | "GROCERIES" | "TRANSPORTATION" | "INSURANCE"
  | "HEALTHCARE" | "CHILDCARE"
  | "DINING" | "ENTERTAINMENT" | "SHOPPING" | "TRAVEL" | "PERSONAL_CARE" | "SUBSCRIPTIONS"
  | "SAVINGS" | "INVESTMENTS" | "DEBT_PAYMENT" | "FEES"
  | "SALARY" | "INVESTMENT_INCOME" | "OTHER_INCOME"
  | "TRANSFER" | "UNCATEGORIZED";

const CATEGORY_GROUP: Record<Category, CategoryGroup> = {
  HOUSING: "ESSENTIAL", UTILITIES: "ESSENTIAL", GROCERIES: "ESSENTIAL",
  TRANSPORTATION: "ESSENTIAL", INSURANCE: "ESSENTIAL", HEALTHCARE: "ESSENTIAL",
  CHILDCARE: "ESSENTIAL",
  DINING: "LIFESTYLE", ENTERTAINMENT: "LIFESTYLE", SHOPPING: "LIFESTYLE",
  TRAVEL: "LIFESTYLE", PERSONAL_CARE: "LIFESTYLE", SUBSCRIPTIONS: "LIFESTYLE",
  SAVINGS: "FINANCIAL", INVESTMENTS: "FINANCIAL", DEBT_PAYMENT: "FINANCIAL", FEES: "FINANCIAL",
  SALARY: "INCOME", INVESTMENT_INCOME: "INCOME", OTHER_INCOME: "INCOME",
  TRANSFER: "OTHER", UNCATEGORIZED: "OTHER",
};

// discriminated union — makes invalid period states unrepresentable
type BudgetPeriod =
  | { kind: "recurring" }
  | { kind: "fixedTerm"; endDate: string };

interface CategoryLimit {
  category: Category;
  limit: Cents;
}

interface Budget {
  id: string;
  name: string;
  startDate: string;
  period: BudgetPeriod;
  totalIncome: Cents;
  categoryLimits: CategoryLimit[];
}
```

Hardcoded category union is intentional — single-user app (for now, see current.md), new
categories are a code change, not a runtime feature.

Matching on `BudgetPeriod` uses a `switch` on `period.kind`, with TypeScript narrowing the type
inside each branch — pair it with a `never`-typed default case to get a compile error if a new
`kind` is added and not handled.

## Domain logic: `monthlySpend`

Lives in `packages/shared` as a pure function — no I/O, no clock access, fully testable in
isolation. This is the calculation behind every spend number the UI displays.

```typescript
type YearMonth = string; // "2026-09"

function monthlySpend(
  budget: Budget,
  category: Category,
  transactions: readonly Transaction[],
  month: YearMonth,
): Cents;
```

Note the signature takes `category` as a separate parameter rather than a single-category
`Budget`: `Budget` holds an array of `CategoryLimit`s (one budget, many category limits), so
this function looks up the matching limit's category internally rather than assuming a budget
maps 1:1 to a category. `limit` itself is never read by this function — comparing spend against
a limit is a separate calculation that consumes this one's output.

Inclusion rules, in brief (full spec lives in the project's spec doc for this feature):
- Effective category (`userCategory ?? providerCategory ?? "UNCATEGORIZED"`) matches `category`
- Not `TRANSFER`
- `date` falls within `month`, on or after `budget.startDate`, and (for `fixedTerm` budgets) on
  or before `period.endDate`
- `pending` is `false` — **settled transactions only** (see decision below)

Result is the signed sum of matching transactions' `amount`; may be negative (net refunds).
Never clamped to zero.

## Key design decisions (see current.md for the dated log)

- **Backend and frontend are separate apps in a monorepo**, connected via tRPC, specifically so
  sync jobs can run as real scheduled processes rather than living inside request handlers.
  Shared types package keeps the original "define once" benefit that motivated going
  TypeScript-only in the first place.
- **Money is always integer cents (`Cents = number`)**, never a decimal string and never a raw
  float. Avoids floating-point drift on currency values and needs no decimal library for
  arithmetic. Final decision — decimal strings are no longer under consideration.
- **`monthlySpend` excludes pending transactions.** Considered including them for a
  "budget is always current" feel, but pending amounts and categories can change on settlement,
  and Plaid represents settlement as a remove-and-replace with a new transaction id (not an
  in-place update) — meaning "include pending" would require pending→posted reconciliation logic
  in the sync layer that doesn't otherwise need to exist, with a real risk of silent
  double-counting if that reconciliation has a bug. Settled-only is stale by at most a day or
  two but is never wrong. Revisit once the sync layer is proven solid.
- **`BudgetPeriod` is a discriminated union**, not a `boolean` + optional `endDate` pair — makes
  invalid combinations unrepresentable and enables exhaustive `switch` checks.
- **Recurring budget spend is computed on the fly** from the current month's transactions and
  the budget's current limits — no per-month snapshot table. Trade-off: editing a limit
  reinterprets past months rather than preserving history. Accepted for simplicity.
- **Transaction categorization is provider-category-first, with manual override** — effective
  category resolves `userCategory ?? providerCategory ?? "UNCATEGORIZED"`.
- **`TRANSFER` is its own category**, not folded into `OTHER` — must be excluded from spending
  totals to avoid double-counting money moved between the user's own accounts.
- **Auth is currently single-user.** Multi-user (see current.md) is a deferred, not-yet-designed
  feature — don't assume any request implicitly belongs to more than one person yet.
