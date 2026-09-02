import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { monthlySpend, effectiveCategory } from "../monthlySpend.ts";
import type { Transaction } from "../../models/transaction.ts";
import type { Budget, YearMonth, BudgetPeriod } from "../../models/budget.ts";
import type { Category } from "../../models/category.ts";
import type { Cents } from "../../models/account.ts";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const ALL_CATEGORIES: Category[] = [
  "HOUSING", "UTILITIES", "GROCERIES", "TRANSPORTATION", "INSURANCE",
  "HEALTHCARE", "CHILDCARE", "DINING", "ENTERTAINMENT", "SHOPPING",
  "TRAVEL", "PERSONAL_CARE", "SUBSCRIPTIONS", "SAVINGS", "INVESTMENTS",
  "DEBT_PAYMENT", "FEES", "SALARY", "INVESTMENT_INCOME", "OTHER_INCOME",
  "TRANSFER", "UNCATEGORIZED",
];

const SPEND_CATEGORIES: Category[] = ALL_CATEGORIES.filter(c => c !== "TRANSFER");

const categoryArb: fc.Arbitrary<Category> = fc.constantFrom(...ALL_CATEGORIES);
const spendCategoryArb: fc.Arbitrary<Category> = fc.constantFrom(...SPEND_CATEGORIES);

const DAYS_IN_MONTH_LOOKUP = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return DAYS_IN_MONTH_LOOKUP[month - 1]!;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const yearMonthArb: fc.Arbitrary<YearMonth> = fc.tuple(
  fc.integer({ min: 2020, max: 2030 }),
  fc.integer({ min: 1, max: 12 }),
).map(([y, m]) => `${y}-${pad2(m)}`);

function dateInMonthArb(month: YearMonth): fc.Arbitrary<string> {
  const year = parseInt(month.slice(0, 4), 10);
  const mo = parseInt(month.slice(5, 7), 10);
  const lastDay = daysInMonth(year, mo);
  return fc.integer({ min: 1, max: lastDay }).map(d => `${month}-${pad2(d)}`);
}

const centsArb: fc.Arbitrary<Cents> = fc.integer({ min: -1_000_000, max: 1_000_000 });

function transactionArb(
  month: YearMonth,
  category: Category,
): fc.Arbitrary<Transaction> {
  return fc.record({
    id: fc.uuid(),
    accountId: fc.constant("acc-1"),
    date: dateInMonthArb(month),
    amount: centsArb,
    description: fc.constant("gen"),
    providerCategory: fc.constant(category as Category | null),
    userCategory: fc.constant(null as Category | null),
    pending: fc.constant(false),
  });
}

function budgetArb(month: YearMonth): fc.Arbitrary<Budget> {
  const year = parseInt(month.slice(0, 4), 10);
  const mo = parseInt(month.slice(5, 7), 10);
  const lastDay = daysInMonth(year, mo);

  const startDateArb = fc.integer({ min: 1, max: lastDay }).map(
    d => `${month}-${pad2(d)}`,
  );

  const periodArb: fc.Arbitrary<BudgetPeriod> = fc.oneof(
    fc.constant({ kind: "recurring" } as BudgetPeriod),
    fc.integer({ min: 1, max: lastDay }).map(d => ({
      kind: "fixedTerm" as const,
      endDate: `${month}-${pad2(d)}`,
    })),
  );

  return fc.record({
    id: fc.constant("budget-gen"),
    name: fc.constant("Generated"),
    startDate: startDateArb,
    period: periodArb,
    totalIncome: fc.constant(500000),
    categoryLimits: fc.constant([]),
  });
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("monthlySpend — properties", () => {
  it("P1: shuffling transactions never changes the result", () => {
    fc.assert(
      fc.property(
        yearMonthArb.chain(month =>
          fc.tuple(
            fc.constant(month),
            spendCategoryArb,
            budgetArb(month),
            fc.array(transactionArb(month, "GROCERIES"), { minLength: 0, maxLength: 30 }),
          ),
        ),
        ([month, category, budget, txs]) => {
          const result1 = monthlySpend(budget, category, txs, month);
          const reversed = [...txs].reverse();
          const result2 = monthlySpend(budget, category, reversed, month);
          expect(result1).toBe(result2);
        },
      ),
    );
  });

  it("P2: adding a transaction with a different category never changes the result", () => {
    fc.assert(
      fc.property(
        yearMonthArb.chain(month =>
          fc.tuple(
            fc.constant(month),
            budgetArb(month),
            fc.array(transactionArb(month, "GROCERIES"), { minLength: 0, maxLength: 20 }),
          ),
        ),
        ([month, budget, txs]) => {
          const category: Category = "GROCERIES";
          const result1 = monthlySpend(budget, category, txs, month);

          const extraTx: Transaction = {
            id: crypto.randomUUID(),
            accountId: "acc-1",
            date: `${month}-15`,
            amount: 99999,
            description: "extra",
            providerCategory: "DINING",
            userCategory: null,
            pending: false,
          };
          const result2 = monthlySpend(budget, category, [...txs, extraTx], month);
          expect(result1).toBe(result2);
        },
      ),
    );
  });

  it("P3: a transaction and its exact negation leave the result unchanged", () => {
    fc.assert(
      fc.property(
        yearMonthArb.chain(month =>
          fc.tuple(
            fc.constant(month),
            budgetArb(month),
            fc.array(transactionArb(month, "GROCERIES"), { minLength: 0, maxLength: 20 }),
            transactionArb(month, "GROCERIES"),
          ),
        ),
        ([month, budget, txs, extra]) => {
          const category: Category = "GROCERIES";
          const result1 = monthlySpend(budget, category, txs, month);

          const negation: Transaction = {
            ...extra,
            id: crypto.randomUUID(),
            amount: -extra.amount,
          };
          const result2 = monthlySpend(budget, category, [...txs, extra, negation], month);
          expect(result1).toBe(result2);
        },
      ),
    );
  });

  it("P4: recategorising moves exactly the amount between categories", () => {
    fc.assert(
      fc.property(
        yearMonthArb.chain(month =>
          fc.tuple(
            fc.constant(month),
            budgetArb(month),
            transactionArb(month, "GROCERIES").map(tx => ({
              ...tx,
              providerCategory: null as Category | null,
              userCategory: null as Category | null,
            })),
            fc.array(transactionArb(month, "GROCERIES"), { minLength: 0, maxLength: 10 }),
          ),
        ),
        ([month, budget, uncatTx, otherTxs]) => {
          const target: Category = "GROCERIES";

          const allTxs = [...otherTxs, uncatTx];
          const uncatBefore = monthlySpend(budget, "UNCATEGORIZED", allTxs, month);
          const targetBefore = monthlySpend(budget, target, allTxs, month);

          const recategorised: Transaction = { ...uncatTx, userCategory: target };
          const allTxsAfter = [...otherTxs, recategorised];
          const uncatAfter = monthlySpend(budget, "UNCATEGORIZED", allTxsAfter, month);
          const targetAfter = monthlySpend(budget, target, allTxsAfter, month);

          // Compute how much this tx contributed when it was UNCATEGORIZED vs target
          const txAloneUncat = monthlySpend(budget, "UNCATEGORIZED", [uncatTx], month);
          const txAloneTarget = monthlySpend(budget, target, [recategorised], month);

          expect(uncatAfter).toBe(uncatBefore - txAloneUncat);
          expect(targetAfter).toBe(targetBefore + txAloneTarget);
        },
      ),
    );
  });

  it("P5: sum across all budget categories never exceeds total settled non-transfer outflows", () => {
    fc.assert(
      fc.property(
        yearMonthArb.chain(month => {
          const categoriesArb = fc.uniqueArray(spendCategoryArb, { minLength: 1, maxLength: 5 });
          return categoriesArb.chain(cats =>
            fc.tuple(
              fc.constant(month),
              fc.constant(cats),
              fc.record({
                id: fc.constant("budget-gen"),
                name: fc.constant("Generated"),
                startDate: fc.constant(`${month}-01`),
                period: fc.constant({ kind: "recurring" } as BudgetPeriod),
                totalIncome: fc.constant(500000),
                categoryLimits: fc.constant(
                  cats.map(c => ({ category: c, limit: 50000 })),
                ),
              }),
              fc.array(
                fc.oneof(...cats.map(c => transactionArb(month, c))),
                { minLength: 0, maxLength: 30 },
              ),
            ),
          );
        }),
        ([month, cats, budget, txs]) => {
          const categorySum = cats.reduce(
            (sum, cat) => sum + monthlySpend(budget, cat, txs, month),
            0,
          );

          const totalOutflows = txs
            .filter(tx => !tx.pending)
            .filter(tx => effectiveCategory(tx) !== "TRANSFER")
            .filter(tx => tx.amount > 0)
            .filter(tx => tx.date >= `${month}-01`)
            .reduce((sum, tx) => sum + tx.amount, 0);

          expect(categorySum).toBeLessThanOrEqual(totalOutflows);
        },
      ),
    );
  });

  it("P6: result is always an integer", () => {
    fc.assert(
      fc.property(
        yearMonthArb.chain(month =>
          fc.tuple(
            fc.constant(month),
            spendCategoryArb,
            budgetArb(month),
            fc.array(transactionArb(month, "GROCERIES"), { minLength: 0, maxLength: 20 }),
          ),
        ),
        ([month, category, budget, txs]) => {
          const result = monthlySpend(budget, category, txs, month);
          expect(Number.isInteger(result)).toBe(true);
        },
      ),
    );
  });

  it("P7: empty transaction array yields 0 for any budget, category, and month", () => {
    fc.assert(
      fc.property(
        yearMonthArb.chain(month =>
          fc.tuple(
            fc.constant(month),
            categoryArb,
            budgetArb(month),
          ),
        ),
        ([month, category, budget]) => {
          expect(monthlySpend(budget, category, [], month)).toBe(0);
        },
      ),
    );
  });

  it("P8: sum over all months equals sum of all in-scope transactions (partition)", () => {
    fc.assert(
      fc.property(
        spendCategoryArb.chain(category => {
          const year = 2026;
          const monthsArb = fc.uniqueArray(fc.integer({ min: 1, max: 12 }), {
            minLength: 2,
            maxLength: 4,
          });

          return monthsArb.chain(months => {
            const yearMonths = months.map(m => `${year}-${pad2(m)}`);
            const txArrays = yearMonths.map(ym =>
              fc.array(transactionArb(ym, category), { minLength: 0, maxLength: 10 }),
            );
            return fc.tuple(
              fc.constant(category),
              fc.constant(yearMonths),
              fc.tuple(...(txArrays as [typeof txArrays[0], ...typeof txArrays])),
            );
          });
        }),
        ([category, yearMonths, txArrays]) => {
          const allTxs = txArrays.flat();

          // P8 precondition: recurring budget with startDate before all transactions
          const budget: Budget = {
            id: "budget-p8",
            name: "P8",
            startDate: "2020-01-01",
            period: { kind: "recurring" },
            totalIncome: 500000,
            categoryLimits: [],
          };

          const monthByMonthSum = yearMonths.reduce(
            (sum, ym) => sum + monthlySpend(budget, category, allTxs, ym),
            0,
          );

          // Manual: sum all matching, non-pending, correct-category, deduped
          const seen = new Set<string>();
          let manualSum = 0;
          for (const tx of allTxs) {
            if (seen.has(tx.id)) continue;
            seen.add(tx.id);
            if (tx.pending) continue;
            if (effectiveCategory(tx) !== category) continue;
            manualSum += tx.amount;
          }

          expect(monthByMonthSum).toBe(manualSum);
        },
      ),
    );
  });

  it("P9: toggling a single transaction to pending changes the result by exactly its negated amount (if in scope) or zero", () => {
    fc.assert(
      fc.property(
        yearMonthArb.chain(month =>
          fc.tuple(
            fc.constant(month),
            budgetArb(month),
            fc.array(transactionArb(month, "GROCERIES"), { minLength: 1, maxLength: 20 }),
          ),
        ),
        ([month, budget, txs]) => {
          const category: Category = "GROCERIES";
          const allSettled = txs.map(tx => ({ ...tx, pending: false }));
          const resultSettled = monthlySpend(budget, category, allSettled, month);

          for (let i = 0; i < allSettled.length; i++) {
            const withOnePending = allSettled.map((tx, j) =>
              j === i ? { ...tx, pending: true } : tx,
            );
            const resultOnePending = monthlySpend(budget, category, withOnePending, month);
            const diff = resultSettled - resultOnePending;

            // diff is either 0 (tx was out of scope for other reasons) or equal
            // to tx.amount (the excluded tx's contribution). In both cases,
            // diff and tx.amount have the same sign (or diff is zero).
            expect(diff === 0 || diff === allSettled[i]!.amount).toBe(true);
          }
        },
      ),
    );
  });
});
