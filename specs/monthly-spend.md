# SPEND — Monthly spend for a budget

- **Status:** Ready for implementation. All open questions resolved (see §12 changelog).
- **Feature area:** Budget calculation (domain core)
- **Location:** `packages/shared/src/domain/monthlySpend.ts` — pure function, no I/O
- **Related decisions in `current.md`:** provider category + manual override (2026-08-29);
  recurring budgets compute on the fly (2026-08-29); `Budget.startDate` is explicit (2026-08-29);
  category set hardcoded with `TRANSFER` and `UNCATEGORIZED` (earlier); money is integer cents,
  final (2026-09-01); pending transactions excluded, hard-delete on removal (2026-09-01)

---

## 1. Purpose

Given a budget, a category, a set of transactions, and a calendar month, compute how much has
been spent against that category during that month.

This is the calculation behind every spend number the UI displays. It is deliberately a pure
function so it can be tested exhaustively without a database, a network, or a clock.

---

## 2. Vocabulary

| Term | Meaning |
| --- | --- |
| **cents** | A signed integer. `4799` is $47.99. There is no other money representation in this system. |
| **outflow** | A transaction with a positive amount. Money leaving the user's account. |
| **inflow** | A transaction with a negative amount. A refund, reversal, or credit. |
| **effective category** | The category a transaction actually counts as, after applying the override chain in SPEND-04. |
| **in scope** | A transaction that passes every filter in §5 and therefore contributes to the total. |
| **month** | A calendar month identified as `YYYY-MM`, e.g. `2026-09`. |
| **settled** | A transaction with `pending: false`. Only settled transactions are ever in scope (SPEND-11). |

---

## 3. Signature

```ts
function monthlySpend(
  budget: Budget,
  category: Category,
  transactions: readonly Transaction[],
  month: YearMonth,          // "2026-09"
): Cents;                     // signed integer, may be negative
```

`category` is a required, separate parameter. `Budget` holds an array of `CategoryLimit`s (one
budget, many category limits — see `packages/shared/src/models/budget.ts`), so this function
does not assume a budget maps 1:1 to a single category. It looks up `budget.startDate` and
`budget.period` (both budget-level, not per-category) and combines them with the `category`
argument to build the inclusion filter in §5. **`CategoryLimit.limit` is never read by this
function** — comparing spend against a limit is a separate, not-yet-written calculation that
consumes this function's output. If `category` has no matching entry in `budget.categoryLimits`,
that is a caller error; this function does not validate it (see SPEND-16).

Types, matching the real shared model (`packages/shared/src/models/`):

```ts
type Cents = number;          // integer; branded type preferred if cheap
type YearMonth = string;      // "YYYY-MM"

type Transaction = {
  id: string;
  accountId: string;
  date: string;                // "YYYY-MM-DD", date-only, no time, no zone
  amount: Cents;                // positive = outflow (SPEND-02)
  providerCategory: Category | null;
  userCategory: Category | null;
  pending: boolean;
};

type BudgetPeriod =
  | { kind: "recurring" }
  | { kind: "fixedTerm"; endDate: string };

type CategoryLimit = {
  category: Category;
  limit: Cents;                 // not used by this function — see above
};

type Budget = {
  id: string;
  name: string;
  startDate: string;            // "YYYY-MM-DD"
  period: BudgetPeriod;
  totalIncome: Cents;
  categoryLimits: CategoryLimit[];
};
```

---

## 4. Representation rules

**SPEND-01** — All monetary values are integer cents. Floating-point numbers must not appear
anywhere in this calculation, in its inputs, or in its outputs. A non-integer amount reaching
this function is a bug upstream, not a case to be rounded here.

**SPEND-02** — Positive `amount` means money left the account. Negative `amount` means money
returned to it. This matches Plaid's convention and the SimpleFIN adapter is responsible for
normalising to it.

**SPEND-03** — `date` is a date-only string. No timezone conversion is performed at any point.
A transaction dated `2026-08-31` belongs to `2026-08` regardless of where anyone is standing.

**SPEND-10** — `month` is a parameter. This function never reads the system clock. Callers that
want "the current month" compute it themselves and pass it in.

---

## 5. Inclusion rules

A transaction is **in scope** if and only if all of the following hold.

**SPEND-04** — Its effective category is resolved as:

```
userCategory ?? providerCategory ?? UNCATEGORIZED
```

A `userCategory` always wins, including when it is set to `UNCATEGORIZED` deliberately. Only
`null` falls through to the next level.

**SPEND-05** — Its effective category equals the `category` argument.

**SPEND-06** — Its effective category is not `TRANSFER`. Transfers move money between the
user's own accounts and are never spend. This rule is already implied by SPEND-05 (effective
category must equal the `category` argument, and a caller should never pass `TRANSFER` as that
argument) — it is stated separately so the exclusion is explicit and doesn't silently depend on
callers behaving correctly.

**SPEND-07** — Its `date` falls within `month`, inclusive of the first and last day.

**SPEND-08** — Its `date` is not earlier than `budget.startDate`. A budget created on the 15th
does not retroactively claim the first half of that month.

**SPEND-09** — For a `fixedTerm` budget (`budget.period.kind === "fixedTerm"`), its `date` is
not later than `budget.period.endDate`.

**SPEND-11** — Its `pending` is `false`. **Decided 2026-09-01: pending transactions are always
excluded.** Rationale: Plaid represents settlement as a remove-and-replace with a new
transaction id rather than an in-place amount update, so including pending transactions would
require pending→posted reconciliation logic in the sync layer that doesn't otherwise need to
exist — with a real risk of silent double-counting during the swap window. Settled-only is
stale by at most a day or two but is never wrong. This is a closed decision, not a
configuration flag; do not add a parameter to toggle it.

---

## 6. Result rules

**SPEND-12** — The result is the arithmetic sum of the `amount` of every in-scope transaction.
An empty scope yields `0`.

**SPEND-13** — The result may be negative, and must be returned as such. A month containing a
$200 refund and $50 of purchases returns `-15000`. Clamping to zero is forbidden; a negative
number is real information and the UI is responsible for presenting it sensibly.

**SPEND-14** — The result is independent of the order of the `transactions` array.

**SPEND-15** — Transactions are identified by `id`. If the same `id` appears more than once in
the input, that is a caller bug; this function counts it once, using the first occurrence.

**SPEND-16** — If `category` has no corresponding entry in `budget.categoryLimits`, this
function still computes and returns the sum as normal — it does not throw or return a sentinel.
Validating that a budget "has" a given category is the caller's responsibility, not this
function's; `monthlySpend` only needs `budget.startDate` and `budget.period`, both of which
exist regardless.

---

## 7. Removed and pending transactions — handling outside this function

These decisions affect what data reaches `monthlySpend`, not the function's logic itself, since
it operates on whatever `transactions` array it's given.

**Removed transactions: hard delete.** Decided 2026-09-01. When Plaid's sync reports a removal,
the sync layer deletes the row entirely rather than tombstoning it. No audit-trail requirement
exists anywhere in this project, and since spend is always computed live from current data, a
tombstone would add a field nothing reads. Consequence for this spec: `monthlySpend` never
needs to filter out tombstoned rows — a removed transaction simply will not appear in the
`transactions` array passed in.

**Pending transactions: excluded, see SPEND-11 above.** No further data-layer implication for
this function beyond the `pending: false` filter — the sync layer's pending→posted
reconciliation (removing the pending row, inserting the posted one) is out of scope for
`monthlySpend` and for this spec entirely; it belongs to `accountSyncService`.

---

## 8. Worked examples

Budget: `startDate: 2026-09-10`, `period: { kind: "recurring" }`,
`categoryLimits: [{ category: "GROCERIES", limit: 40000 }, ...]`. Called with
`category: "GROCERIES"`, `month: "2026-09"`.

| # | Transaction | In scope? | Why |
| --- | --- | --- | --- |
| 1 | 2026-09-12, +8450, providerCategory GROCERIES, userCategory null, pending false | yes | SPEND-04 falls through to provider |
| 2 | 2026-09-12, +8450, providerCategory DINING, userCategory GROCERIES, pending false | yes | user override wins |
| 3 | 2026-09-12, +8450, providerCategory GROCERIES, userCategory DINING, pending false | no | user override wins the other way |
| 4 | 2026-09-03, +2000, GROCERIES, pending false | no | before `startDate` (SPEND-08) |
| 5 | 2026-08-31, +2000, GROCERIES, pending false | no | wrong month (SPEND-07) |
| 6 | 2026-09-15, −3000, GROCERIES, pending false | yes | refund, subtracts (SPEND-13) |
| 7 | 2026-09-15, +5000, providerCategory null, userCategory null, pending false | no | resolves to UNCATEGORIZED |
| 8 | 2026-09-15, +5000, TRANSFER, pending false | no | SPEND-06 |
| 9 | 2026-09-16, +1200, GROCERIES, `pending: true` | no | SPEND-11 |

Expected result across rows 1–9: `8450 + 8450 − 3000 = 13900`.

---

## 9. Properties

These hold for all inputs and should be expressed as generative tests, not examples.

**P1 — Order independence.** Shuffling `transactions` never changes the result. *(SPEND-14)*

**P2 — Category isolation.** Adding a transaction whose effective category differs from
`category` never changes the result.

**P3 — Refund symmetry.** Adding any transaction together with an exact negation of it (same
date, same category, same pending status, negated amount) leaves the result unchanged.

**P4 — Recategorisation conservation.** Setting `userCategory` on a previously uncategorised
transaction moves exactly its amount out of the UNCATEGORIZED total and into the target
category's total, and changes no other category's total.

**P5 — Sum bound.** Across all categories in a budget's `categoryLimits` for a month, the sum
of results never exceeds the sum of all non-transfer, settled outflows dated in that month and
on or after the budget's `startDate`.

**P6 — Integrality.** The result is always an integer. *(SPEND-01)*

**P7 — Empty is zero.** An empty transaction array yields `0` for any budget, category, and
month. *(SPEND-12)*

**P8 — Month partition.** For a recurring budget with a `startDate` before the earliest
transaction, the sum of results over every month covered by the data equals the sum of all
in-scope transactions computed without a month filter.

**P9 — Pending irrelevance.** Toggling any transaction's `pending` from `false` to `true` never
increases the result, and toggling it to `false` never decreases it below the all-settled sum.
*(SPEND-11)*

---

## 10. Out of scope

Explicitly not handled here, and not to be added without a spec change:

- Multi-currency. Every amount is assumed to be in one currency.
- Two `CategoryLimit`s in the same budget sharing a category. Assumed forbidden; enforced
  elsewhere, not defended here.
- Rollover of unspent budget between months.
- Per-week or per-fortnight budget periods. Calendar months only.
- Comparison against `CategoryLimit.limit`, percentage-remaining, or over-budget flags. Those
  are a separate calculation that consumes this one.
- Any notion of "today", partial months, or projected end-of-month spend.
- Pending→posted transaction reconciliation. That is `accountSyncService`'s responsibility, not
  this function's — see §7.
- Validating that `category` exists in `budget.categoryLimits`. See SPEND-16.

---

## 11. Test checklist

Every rule below needs at least one test naming its ID, so that spec coverage can be checked by
grep rather than guessed at.

- [ ] SPEND-01 — non-integer input rejected or impossible by type
- [ ] SPEND-02 — sign convention, one outflow and one inflow
- [ ] SPEND-03 — first and last day of month both included, no zone shift
- [ ] SPEND-04 — all four resolution cases: user set, provider only, both set, neither
- [ ] SPEND-05 — non-matching category excluded
- [ ] SPEND-06 — TRANSFER excluded even when categories otherwise match
- [ ] SPEND-07 — boundary dates, day 1 and last day, plus one day either side
- [ ] SPEND-08 — transaction before `startDate` excluded; on `startDate` included
- [ ] SPEND-09 — fixedTerm budget, transaction after `endDate` excluded
- [ ] SPEND-11 — pending transaction excluded regardless of category/date match
- [ ] SPEND-12 — empty scope yields 0
- [ ] SPEND-13 — net-negative month returns a negative number
- [ ] SPEND-14 — covered by P1
- [ ] SPEND-15 — duplicate id counted once
- [ ] SPEND-16 — category with no matching CategoryLimit entry still computes normally
- [ ] P1–P9 — generative tests

---

## 12. Changelog

| Date | Change |
| --- | --- |
| 2026-09-01 | Fixed dangling cross-reference: SPEND-06 previously cited "SPEND-13" for a `TRANSFER`-forbidden-in-`CategoryLimit` constraint that doesn't exist in this document. Reworded to explain SPEND-06's redundancy in terms of SPEND-05 instead, which is the rule actually doing that work. |
| 2026-09-01 | **Resolved for implementation.** All three original open questions closed: pending transactions excluded (SPEND-11 rewritten from proposal to decided rule); removed transactions hard-deleted (§7 added, no new inclusion rule needed); all account types in scope (no restriction added, §10 updated to note this explicitly is not filtered). Fixed `Budget`/`monthlySpend` signature mismatch: function now takes `category` as an explicit parameter instead of assuming `Budget` has a single `category`/`limit` pair, matching the real `packages/shared` model where one `Budget` holds many `CategoryLimit`s. Added SPEND-16 (unmatched category is not an error). Added P9 (pending irrelevance property). Status moved from Draft to Ready for implementation. |
| 2026-09-01 | Initial draft. Three open questions raised (§7, now closed above). |
