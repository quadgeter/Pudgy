import type { Cents } from "./account.ts";
import type { Category } from "./category.ts";

export type YearMonth = string; // "YYYY-MM"

export type BudgetPeriod =
  | { kind: "recurring" }
  | { kind: "fixedTerm"; endDate: string };

export interface CategoryLimit {
  category: Category;
  limit: Cents;
}

export interface Budget {
  id: string;
  name: string;
  startDate: string; // "YYYY-MM-DD"
  period: BudgetPeriod;
  totalIncome: Cents;
  categoryLimits: CategoryLimit[];
}
