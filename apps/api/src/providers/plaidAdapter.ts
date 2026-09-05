import type { Account, Transaction } from "@pudgy/shared";
import type { ProviderAdapter } from "./providerAdapter.ts";

// Hardcoded fake data — scaffolding to unblock tRPC routers before real
// Plaid SDK calls/credentials exist. No network access.

const FAKE_ACCOUNTS: Account[] = [
  {
    id: "plaid-acc-brokerage-1",
    institutionName: "Vanguard",
    name: "Brokerage Account",
    type: "investment",
    balance: 5231045,
    provider: "plaid",
  },
  {
    id: "plaid-acc-checking-1",
    institutionName: "Chase",
    name: "Total Checking",
    type: "checking",
    balance: 284512,
    provider: "plaid",
  },
];

const FAKE_TRANSACTIONS: Transaction[] = [
  {
    id: "plaid-txn-1",
    accountId: "plaid-acc-checking-1",
    date: "2026-08-30",
    amount: 320000,
    description: "ACME CORP PAYROLL",
    providerCategory: "SALARY",
    userCategory: null,
    pending: false,
  },
  {
    id: "plaid-txn-2",
    accountId: "plaid-acc-checking-1",
    date: "2026-09-01",
    amount: 5499,
    description: "WHOLE FOODS MARKET",
    providerCategory: "GROCERIES",
    userCategory: null,
    pending: false,
  },
  {
    id: "plaid-txn-3",
    accountId: "plaid-acc-checking-1",
    date: "2026-09-02",
    amount: 1899,
    description: "NETFLIX.COM",
    providerCategory: "SUBSCRIPTIONS",
    userCategory: null,
    pending: false,
  },
  {
    id: "plaid-txn-4",
    accountId: "plaid-acc-checking-1",
    date: "2026-09-03",
    amount: 4200,
    description: "SHELL OIL",
    providerCategory: "TRANSPORTATION",
    userCategory: null,
    pending: true,
  },
  {
    id: "plaid-txn-5",
    accountId: "plaid-acc-checking-1",
    date: "2026-09-03",
    amount: 50000,
    description: "TRANSFER TO SAVINGS",
    providerCategory: "TRANSFER",
    userCategory: null,
    pending: false,
  },
  {
    id: "plaid-txn-6",
    accountId: "plaid-acc-checking-1",
    date: "2026-09-04",
    amount: 7625,
    description: "AMC THEATRES",
    providerCategory: "ENTERTAINMENT",
    userCategory: "DINING",
    pending: false,
  },
  {
    id: "plaid-txn-7",
    accountId: "plaid-acc-brokerage-1",
    date: "2026-09-01",
    amount: -320000,
    description: "DIVIDEND PAYMENT",
    providerCategory: "INVESTMENT_INCOME",
    userCategory: null,
    pending: false,
  },
];

export class PlaidAdapter implements ProviderAdapter {
  provider = "plaid" as const;

  async getAccounts(): Promise<Account[]> {
    return FAKE_ACCOUNTS;
  }

  async getTransactions(accountId: string, since: string): Promise<Transaction[]> {
    return FAKE_TRANSACTIONS.filter(
      (transaction) => transaction.accountId === accountId && transaction.date >= since,
    );
  }
}
