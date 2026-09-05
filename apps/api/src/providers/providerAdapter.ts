import type { Account, Provider, Transaction } from "@pudgy/shared";

/**
 * Shared interface Plaid and SimpleFIN are abstracted behind, so the rest of
 * the app (accountSyncService, tRPC routers) never references either
 * provider by name. See pudgy.md's "Core architectural pattern".
 */
export interface ProviderAdapter {
  provider: Provider;
  getAccounts(): Promise<Account[]>;
  getTransactions(accountId: string, since: string): Promise<Transaction[]>;
}
