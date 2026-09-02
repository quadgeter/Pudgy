import type { Category } from "../models/category.ts";
import type { Cents } from "../models/account.ts";
import type { Transaction } from "../models/transaction.ts";
import type { Budget, YearMonth } from "../models/budget.ts";

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return DAYS_IN_MONTH[month - 1]!;
}

function monthBounds(month: YearMonth): { first: string; last: string } {
  const year = parseInt(month.slice(0, 4), 10);
  const mo = parseInt(month.slice(5, 7), 10);
  const lastDay = daysInMonth(year, mo);
  const first = `${month}-01`;
  const last = `${month}-${String(lastDay).padStart(2, "0")}`;
  return { first, last };
}

export function effectiveCategory(tx: Transaction): Category {
  return tx.userCategory ?? tx.providerCategory ?? "UNCATEGORIZED";
}

export function monthlySpend(
  budget: Budget,
  category: Category,
  transactions: readonly Transaction[],
  month: YearMonth,
): Cents {
  // SPEND-06: TRANSFER is never spend
  if (category === "TRANSFER") return 0;

  const { first, last } = monthBounds(month);

  // SPEND-07 + SPEND-08: effective lower bound
  const lowerDate = budget.startDate > first ? budget.startDate : first;

  // SPEND-07 + SPEND-09: effective upper bound
  const upperDate =
    budget.period.kind === "fixedTerm" && budget.period.endDate < last
      ? budget.period.endDate
      : last;

  // Empty range — no transactions can be in scope
  if (lowerDate > upperDate) return 0;

  // SPEND-15: deduplicate by id, keep first occurrence
  const seen = new Set<string>();

  let total: Cents = 0;

  for (const tx of transactions) {
    // SPEND-15
    if (seen.has(tx.id)) continue;
    seen.add(tx.id);

    // SPEND-11: pending transactions excluded
    if (tx.pending) continue;

    // SPEND-04 + SPEND-05: effective category must match
    if (effectiveCategory(tx) !== category) continue;

    // SPEND-07 + SPEND-08 + SPEND-09: date within bounds
    if (tx.date < lowerDate || tx.date > upperDate) continue;

    // SPEND-12: accumulate
    total += tx.amount;
  }

  return total;
}
