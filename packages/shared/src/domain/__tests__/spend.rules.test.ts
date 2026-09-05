import { describe, it, expect } from "vitest";
import { monthlySpend, effectiveCategory } from "../monthlySpend.ts";
import type { Transaction } from "../../models/transaction.ts";
import type { Budget } from "../../models/budget.ts";

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: crypto.randomUUID(),
    accountId: "acc-1",
    date: "2026-09-15",
    amount: 1000,
    description: "Test transaction",
    providerCategory: "GROCERIES",
    userCategory: null,
    pending: false,
    ...overrides,
  };
}

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: "budget-1",
    name: "Monthly",
    startDate: "2020-01-01",
    period: { kind: "recurring" },
    totalIncome: 500000,
    categoryLimits: [{ category: "GROCERIES", limit: 40000 }],
    ...overrides,
  };
}

describe("monthlySpend — representation rules", () => {
  it("SPEND-01: result is an integer for integer-cent inputs", () => {
    const txs = [
      makeTx({ amount: 4799 }),
      makeTx({ amount: 3201 }),
      makeTx({ amount: -1500 }),
    ];
    const result = monthlySpend(makeBudget(), "GROCERIES", txs, "2026-09");
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBe(6500);
  });

  it("SPEND-02: positive amount is outflow, negative is inflow, both sum correctly", () => {
    const txs = [
      makeTx({ amount: 5000 }),
      makeTx({ amount: -2000 }),
    ];
    const result = monthlySpend(makeBudget(), "GROCERIES", txs, "2026-09");
    expect(result).toBe(3000);
  });

  it("SPEND-03: first and last day of month both included without timezone effects", () => {
    const txs = [
      makeTx({ date: "2026-09-01", amount: 1000 }),
      makeTx({ date: "2026-09-30", amount: 2000 }),
    ];
    const result = monthlySpend(makeBudget(), "GROCERIES", txs, "2026-09");
    expect(result).toBe(3000);
  });

  it("SPEND-03: dates outside the month are excluded", () => {
    const txs = [
      makeTx({ date: "2026-08-31", amount: 1000 }),
      makeTx({ date: "2026-10-01", amount: 2000 }),
      makeTx({ date: "2026-09-15", amount: 500 }),
    ];
    const result = monthlySpend(makeBudget(), "GROCERIES", txs, "2026-09");
    expect(result).toBe(500);
  });

  it("SPEND-10: month is a parameter, no system clock dependency", () => {
    const tx = makeTx({ date: "2025-03-10", amount: 7777 });
    const result = monthlySpend(makeBudget(), "GROCERIES", [tx], "2025-03");
    expect(result).toBe(7777);
  });
});

describe("monthlySpend — inclusion rules", () => {
  it("SPEND-04: uses userCategory when set", () => {
    const tx = makeTx({
      providerCategory: "DINING",
      userCategory: "GROCERIES",
      amount: 3000,
    });
    expect(effectiveCategory(tx)).toBe("GROCERIES");
    expect(monthlySpend(makeBudget(), "GROCERIES", [tx], "2026-09")).toBe(3000);
  });

  it("SPEND-04: falls through to providerCategory when userCategory is null", () => {
    const tx = makeTx({
      providerCategory: "GROCERIES",
      userCategory: null,
      amount: 3000,
    });
    expect(effectiveCategory(tx)).toBe("GROCERIES");
    expect(monthlySpend(makeBudget(), "GROCERIES", [tx], "2026-09")).toBe(3000);
  });

  it("SPEND-04: userCategory wins when both are set", () => {
    const tx = makeTx({
      providerCategory: "GROCERIES",
      userCategory: "DINING",
      amount: 3000,
    });
    expect(effectiveCategory(tx)).toBe("DINING");
    // Should NOT appear in GROCERIES spend
    expect(monthlySpend(makeBudget(), "GROCERIES", [tx], "2026-09")).toBe(0);
    // Should appear in DINING spend
    expect(monthlySpend(makeBudget(), "DINING", [tx], "2026-09")).toBe(3000);
  });

  it("SPEND-04: neither set resolves to UNCATEGORIZED", () => {
    const tx = makeTx({
      providerCategory: null,
      userCategory: null,
      amount: 3000,
    });
    expect(effectiveCategory(tx)).toBe("UNCATEGORIZED");
    expect(monthlySpend(makeBudget(), "UNCATEGORIZED", [tx], "2026-09")).toBe(3000);
    expect(monthlySpend(makeBudget(), "GROCERIES", [tx], "2026-09")).toBe(0);
  });

  it("SPEND-05: non-matching category excluded", () => {
    const txs = [
      makeTx({ providerCategory: "DINING", amount: 1000 }),
      makeTx({ providerCategory: "ENTERTAINMENT", amount: 2000 }),
      makeTx({ providerCategory: "GROCERIES", amount: 3000 }),
    ];
    const result = monthlySpend(makeBudget(), "GROCERIES", txs, "2026-09");
    expect(result).toBe(3000);
  });

  it("SPEND-06: TRANSFER excluded even when category argument is TRANSFER", () => {
    const tx = makeTx({
      providerCategory: "TRANSFER",
      userCategory: null,
      amount: 5000,
    });
    expect(monthlySpend(makeBudget(), "TRANSFER", [tx], "2026-09")).toBe(0);
  });

  it("SPEND-06: transaction with userCategory TRANSFER excluded from other categories", () => {
    const tx = makeTx({
      providerCategory: "GROCERIES",
      userCategory: "TRANSFER",
      amount: 5000,
    });
    // Effective category is TRANSFER, which doesn't match GROCERIES
    expect(monthlySpend(makeBudget(), "GROCERIES", [tx], "2026-09")).toBe(0);
  });

  it("SPEND-07: boundary dates — day 1 and last day included, one day either side excluded", () => {
    const txs = [
      makeTx({ date: "2026-08-31", amount: 100 }), // before
      makeTx({ date: "2026-09-01", amount: 200 }), // first day
      makeTx({ date: "2026-09-30", amount: 300 }), // last day
      makeTx({ date: "2026-10-01", amount: 400 }), // after
    ];
    expect(monthlySpend(makeBudget(), "GROCERIES", txs, "2026-09")).toBe(500);
  });

  it("SPEND-07: handles February correctly in a non-leap year", () => {
    const txs = [
      makeTx({ date: "2025-02-28", amount: 1000 }), // last day
      makeTx({ date: "2025-03-01", amount: 2000 }), // next month
    ];
    expect(monthlySpend(makeBudget(), "GROCERIES", txs, "2025-02")).toBe(1000);
  });

  it("SPEND-07: handles February correctly in a leap year", () => {
    const txs = [
      makeTx({ date: "2024-02-29", amount: 1000 }), // last day of leap Feb
      makeTx({ date: "2024-03-01", amount: 2000 }), // next month
    ];
    expect(monthlySpend(makeBudget(), "GROCERIES", txs, "2024-02")).toBe(1000);
  });

  it("SPEND-07: handles months with 31 days", () => {
    const txs = [
      makeTx({ date: "2026-01-31", amount: 1000 }), // last day
      makeTx({ date: "2026-02-01", amount: 2000 }), // next month
    ];
    expect(monthlySpend(makeBudget(), "GROCERIES", txs, "2026-01")).toBe(1000);
  });

  it("SPEND-07: handles months with 30 days", () => {
    const txs = [
      makeTx({ date: "2026-04-30", amount: 1000 }), // last day
      makeTx({ date: "2026-05-01", amount: 2000 }), // next month
    ];
    expect(monthlySpend(makeBudget(), "GROCERIES", txs, "2026-04")).toBe(1000);
  });

  it("SPEND-08: excludes transactions dated before budget.startDate", () => {
    const budget = makeBudget({ startDate: "2026-09-15" });
    const txs = [
      makeTx({ date: "2026-09-14", amount: 1000 }), // before startDate
      makeTx({ date: "2026-09-15", amount: 2000 }), // on startDate
      makeTx({ date: "2026-09-16", amount: 3000 }), // after startDate
    ];
    expect(monthlySpend(budget, "GROCERIES", txs, "2026-09")).toBe(5000);
  });

  it("SPEND-08: includes transactions on budget.startDate", () => {
    const budget = makeBudget({ startDate: "2026-09-15" });
    const tx = makeTx({ date: "2026-09-15", amount: 4000 });
    expect(monthlySpend(budget, "GROCERIES", [tx], "2026-09")).toBe(4000);
  });

  it("SPEND-08: startDate in a prior month does not restrict current month", () => {
    const budget = makeBudget({ startDate: "2026-08-20" });
    const tx = makeTx({ date: "2026-09-01", amount: 1500 });
    expect(monthlySpend(budget, "GROCERIES", [tx], "2026-09")).toBe(1500);
  });

  it("SPEND-09: fixedTerm budget excludes transactions after endDate", () => {
    const budget = makeBudget({
      period: { kind: "fixedTerm", endDate: "2026-09-20" },
    });
    const txs = [
      makeTx({ date: "2026-09-20", amount: 1000 }), // on endDate
      makeTx({ date: "2026-09-21", amount: 2000 }), // after endDate
    ];
    expect(monthlySpend(budget, "GROCERIES", txs, "2026-09")).toBe(1000);
  });

  it("SPEND-09: fixedTerm budget includes transactions on endDate", () => {
    const budget = makeBudget({
      period: { kind: "fixedTerm", endDate: "2026-09-25" },
    });
    const tx = makeTx({ date: "2026-09-25", amount: 5000 });
    expect(monthlySpend(budget, "GROCERIES", [tx], "2026-09")).toBe(5000);
  });

  it("SPEND-09: recurring budget has no upper date restriction beyond month end", () => {
    const budget = makeBudget({ period: { kind: "recurring" } });
    const tx = makeTx({ date: "2026-09-30", amount: 5000 });
    expect(monthlySpend(budget, "GROCERIES", [tx], "2026-09")).toBe(5000);
  });

  it("SPEND-09: fixedTerm endDate before the queried month yields 0", () => {
    const budget = makeBudget({
      period: { kind: "fixedTerm", endDate: "2026-08-31" },
    });
    const tx = makeTx({ date: "2026-09-15", amount: 5000 });
    expect(monthlySpend(budget, "GROCERIES", [tx], "2026-09")).toBe(0);
  });

  it("SPEND-11: pending transaction excluded regardless of category/date match", () => {
    const txs = [
      makeTx({ pending: false, amount: 1000 }),
      makeTx({ pending: true, amount: 2000 }),
    ];
    expect(monthlySpend(makeBudget(), "GROCERIES", txs, "2026-09")).toBe(1000);
  });
});

describe("monthlySpend — result rules", () => {
  it("SPEND-12: empty transaction array yields 0", () => {
    expect(monthlySpend(makeBudget(), "GROCERIES", [], "2026-09")).toBe(0);
  });

  it("SPEND-12: all transactions filtered out yields 0", () => {
    const txs = [
      makeTx({ providerCategory: "DINING", amount: 1000 }),
      makeTx({ pending: true, amount: 2000 }),
      makeTx({ date: "2026-08-01", amount: 3000 }),
    ];
    expect(monthlySpend(makeBudget(), "GROCERIES", txs, "2026-09")).toBe(0);
  });

  it("SPEND-13: net-negative month returns negative number, never clamped", () => {
    const txs = [
      makeTx({ amount: 5000 }),
      makeTx({ amount: -20000 }),
    ];
    expect(monthlySpend(makeBudget(), "GROCERIES", txs, "2026-09")).toBe(-15000);
  });

  it("SPEND-14: result is identical regardless of transaction order", () => {
    const txs = [
      makeTx({ amount: 1000 }),
      makeTx({ amount: 2000 }),
      makeTx({ amount: -500 }),
      makeTx({ amount: 3000 }),
    ];
    const result1 = monthlySpend(makeBudget(), "GROCERIES", txs, "2026-09");
    const result2 = monthlySpend(makeBudget(), "GROCERIES", [...txs].reverse(), "2026-09");
    expect(result1).toBe(result2);
    expect(result1).toBe(5500);
  });

  it("SPEND-15: duplicate transaction IDs counted once, using first occurrence", () => {
    const id = "dup-id";
    const txs = [
      makeTx({ id, amount: 1000 }),
      makeTx({ id, amount: 9999 }),
    ];
    expect(monthlySpend(makeBudget(), "GROCERIES", txs, "2026-09")).toBe(1000);
  });

  it("SPEND-16: category not in budget.categoryLimits still computes normally", () => {
    const budget = makeBudget({
      categoryLimits: [{ category: "DINING", limit: 30000 }],
    });
    const tx = makeTx({
      providerCategory: "GROCERIES",
      amount: 4500,
    });
    expect(monthlySpend(budget, "GROCERIES", [tx], "2026-09")).toBe(4500);
  });

  it("SPEND-16: empty categoryLimits array still computes normally", () => {
    const budget = makeBudget({ categoryLimits: [] });
    const tx = makeTx({ amount: 3000 });
    expect(monthlySpend(budget, "GROCERIES", [tx], "2026-09")).toBe(3000);
  });
});

describe("monthlySpend — worked example from spec §8", () => {
  it("reproduces the spec worked example with expected result 13900", () => {
    const budget = makeBudget({
      startDate: "2026-09-10",
      period: { kind: "recurring" },
      categoryLimits: [{ category: "GROCERIES", limit: 40000 }],
    });

    const txs: Transaction[] = [
      // 1: in scope — providerCategory GROCERIES, userCategory null
      makeTx({
        id: "tx-1",
        date: "2026-09-12",
        amount: 8450,
        providerCategory: "GROCERIES",
        userCategory: null,
      }),
      // 2: in scope — user override to GROCERIES
      makeTx({
        id: "tx-2",
        date: "2026-09-12",
        amount: 8450,
        providerCategory: "DINING",
        userCategory: "GROCERIES",
      }),
      // 3: out — user override to DINING
      makeTx({
        id: "tx-3",
        date: "2026-09-12",
        amount: 8450,
        providerCategory: "GROCERIES",
        userCategory: "DINING",
      }),
      // 4: out — before startDate
      makeTx({
        id: "tx-4",
        date: "2026-09-03",
        amount: 2000,
        providerCategory: "GROCERIES",
        userCategory: null,
      }),
      // 5: out — wrong month
      makeTx({
        id: "tx-5",
        date: "2026-08-31",
        amount: 2000,
        providerCategory: "GROCERIES",
        userCategory: null,
      }),
      // 6: in scope — refund (negative amount)
      makeTx({
        id: "tx-6",
        date: "2026-09-15",
        amount: -3000,
        providerCategory: "GROCERIES",
        userCategory: null,
      }),
      // 7: out — resolves to UNCATEGORIZED
      makeTx({
        id: "tx-7",
        date: "2026-09-15",
        amount: 5000,
        providerCategory: null,
        userCategory: null,
      }),
      // 8: out — TRANSFER
      makeTx({
        id: "tx-8",
        date: "2026-09-15",
        amount: 5000,
        providerCategory: "TRANSFER",
        userCategory: null,
      }),
      // 9: out — pending
      makeTx({
        id: "tx-9",
        date: "2026-09-16",
        amount: 1200,
        providerCategory: "GROCERIES",
        userCategory: null,
        pending: true,
      }),
    ];

    expect(monthlySpend(budget, "GROCERIES", txs, "2026-09")).toBe(13900);
  });
});
