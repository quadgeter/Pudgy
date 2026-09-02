/**
 * A signed integer counting cents. $47.99 is 4799.
 * Positive on a Transaction means money left the account (outflow),
 * negative means it returned (inflow/refund).
 */
export type Cents = number;

export type Provider = "plaid" | "simplefin";

export type AccountType =
  | "checking"
  | "savings"
  | "credit_card"
  | "investment"
  | "loan"
  | "other";

export interface Account {
  id: string;
  institutionName: string;
  name: string;
  type: AccountType;
  balance: Cents;
  provider: Provider;
}
