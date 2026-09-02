import type { Cents } from "./account.ts";
import type { Category } from "./category.ts";

export interface Transaction {
  id: string;
  accountId: string;
  date: string; // "YYYY-MM-DD", date-only, no time, no zone
  amount: Cents; // positive = outflow, negative = inflow
  description: string;
  providerCategory: Category | null;
  userCategory: Category | null;
  pending: boolean;
}
