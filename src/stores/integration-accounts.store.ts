/**
 * Integration Accounts Store
 * Manages multiple accounts for GitHub, GitLab, and Azure DevOps integrations
 */

import { createStore } from 'zustand/vanilla';
import type {
  IntegrationAccount,
  IntegrationType,
} from '../types/integration-accounts.types.ts';

export interface IntegrationAccountsState {
  // State
  accounts: IntegrationAccount[];
  activeAccounts: Partial<Record<IntegrationType, IntegrationAccount | null>>;
  repositoryAssignments: Record<string, string>;
  isLoading: boolean;
  error: string | null;

  // Actions
  setAccounts: (accounts: IntegrationAccount[]) => void;
  setActiveAccount: (type: IntegrationType, account: IntegrationAccount | null) => void;
  setRepositoryAssignments: (assignments: Record<string, string>) => void;
  addAccount: (account: IntegrationAccount) => void;
  updateAccount: (account: IntegrationAccount) => void;
  removeAccount: (accountId: string) => void;
  assignAccountToRepository: (repoPath: string, accountId: string) => void;
  unassignAccountFromRepository: (repoPath: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  accounts: [] as IntegrationAccount[],
  activeAccounts: {} as Partial<Record<IntegrationType, IntegrationAccount | null>>,
  repositoryAssignments: {} as Record<string, string>,
  isLoading: false,
  error: null as string | null,
};

export const integrationAccountsStore = createStore<IntegrationAccountsState>()((set, _get) => ({
  ...initialState,

  setAccounts: (accounts) => set({ accounts, error: null }),

  setActiveAccount: (type, account) =>
    set((state) => ({
      activeAccounts: {
        ...state.activeAccounts,
        [type]: account,
      },
    })),

  setRepositoryAssignments: (repositoryAssignments) => set({ repositoryAssignments }),

  addAccount: (account) =>
    set((state) => {
      // If this account is default, unset other defaults of the same type
      let accounts = state.accounts;
      if (account.isDefault) {
        accounts = accounts.map((a) =>
          a.integrationType === account.integrationType && a.id !== account.id
            ? { ...a, isDefault: false }
            : a
        );
      }
      return {
        accounts: [...accounts, account],
        error: null,
      };
    }),

  updateAccount: (account) =>
    set((state) => {
      // If this account is being set as default, unset other defaults of the same type
      const accounts = state.accounts.map((a) => {
        if (a.id === account.id) {
          return account;
        }
        if (account.isDefault && a.integrationType === account.integrationType) {
          return { ...a, isDefault: false };
        }
        return a;
      });

      // Update active account if it was the one being updated
      const activeAccounts = { ...state.activeAccounts };
      const type = account.integrationType;
      if (activeAccounts[type]?.id === account.id) {
        activeAccounts[type] = account;
      }

      return {
        accounts,
        activeAccounts,
        error: null,
      };
    }),

  removeAccount: (accountId) =>
    set((state) => {
      const accountToRemove = state.accounts.find((a) => a.id === accountId);
      const accounts = state.accounts.filter((a) => a.id !== accountId);

      // Clear active account if it was the one being removed
      const activeAccounts = { ...state.activeAccounts };
      if (accountToRemove) {
        const type = accountToRemove.integrationType;
        if (activeAccounts[type]?.id === accountId) {
          activeAccounts[type] = null;
        }
      }

      // Remove repository assignments for this account
      const repositoryAssignments = { ...state.repositoryAssignments };
      for (const [path, id] of Object.entries(repositoryAssignments)) {
        if (id === accountId) {
          delete repositoryAssignments[path];
        }
      }

      return {
        accounts,
        activeAccounts,
        repositoryAssignments,
        error: null,
      };
    }),

  assignAccountToRepository: (repoPath, accountId) =>
    set((state) => ({
      repositoryAssignments: {
        ...state.repositoryAssignments,
        [repoPath]: accountId,
      },
    })),

  unassignAccountFromRepository: (repoPath) =>
    set((state) => {
      const { [repoPath]: _removed, ...rest } = state.repositoryAssignments;
      void _removed; // Intentionally unused - destructuring to remove key
      return { repositoryAssignments: rest };
    }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error, isLoading: false }),

  reset: () => set(initialState),
}));

// =============================================================================
// Selectors / Helper Functions
// =============================================================================

/**
 * Get accounts filtered by integration type
 */
export function getAccountsByType(type: IntegrationType): IntegrationAccount[] {
  return integrationAccountsStore.getState().accounts.filter((a) => a.integrationType === type);
}

/**
 * Get an account by ID
 */
export function getAccountById(id: string): IntegrationAccount | undefined {
  return integrationAccountsStore.getState().accounts.find((a) => a.id === id);
}

/**
 * Get the default account for an integration type
 */
export function getDefaultAccount(type: IntegrationType): IntegrationAccount | undefined {
  return integrationAccountsStore
    .getState()
    .accounts.find((a) => a.integrationType === type && a.isDefault);
}

/**
 * Get the active account for an integration type
 */
export function getActiveAccount(type: IntegrationType): IntegrationAccount | null | undefined {
  return integrationAccountsStore.getState().activeAccounts[type];
}

/**
 * Get the account assigned to a repository
 */
export function getAccountForRepository(
  repoPath: string,
  type: IntegrationType
): IntegrationAccount | undefined {
  const state = integrationAccountsStore.getState();
  const assignedId = state.repositoryAssignments[repoPath];

  if (assignedId) {
    const account = state.accounts.find((a) => a.id === assignedId);
    if (account && account.integrationType === type) {
      return account;
    }
  }

  return undefined;
}

/**
 * Find the best account for a repository (checks assignment, URL patterns, then default)
 */
export function findBestAccountForRepository(
  repoPath: string,
  remoteUrl: string | null,
  type: IntegrationType
): IntegrationAccount | undefined {
  const state = integrationAccountsStore.getState();
  const accounts = state.accounts.filter((a) => a.integrationType === type);

  // 1. Check for explicit assignment
  const assignedId = state.repositoryAssignments[repoPath];
  if (assignedId) {
    const assigned = accounts.find((a) => a.id === assignedId);
    if (assigned) {
      return assigned;
    }
  }

  // 2. Check URL patterns
  if (remoteUrl) {
    for (const account of accounts) {
      if (account.urlPatterns.some((pattern) => urlMatchesPattern(remoteUrl, pattern))) {
        return account;
      }
    }
  }

  // 3. Return default account
  return accounts.find((a) => a.isDefault);
}

/**
 * Check if any accounts exist for an integration type
 */
export function hasAccountsForType(type: IntegrationType): boolean {
  return integrationAccountsStore.getState().accounts.some((a) => a.integrationType === type);
}

/**
 * Check if any accounts exist at all
 */
export function hasAnyAccounts(): boolean {
  return integrationAccountsStore.getState().accounts.length > 0;
}

// =============================================================================
// URL Pattern Matching (mirrors backend logic)
// =============================================================================

/**
 * Check if a URL matches a glob-like pattern
 */
function urlMatchesPattern(url: string, pattern: string): boolean {
  // Normalize URL: remove protocol and trailing slashes
  const normalizedUrl = url
    .replace(/^https?:\/\//, '')
    .replace(/^git@/, '')
    .replace(/:/g, '/')
    .replace(/\/$/, '')
    .replace(/\.git$/, '')
    .toLowerCase();

  const normalizedPattern = pattern
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .toLowerCase();

  // Handle wildcard patterns
  if (normalizedPattern.endsWith('/*')) {
    const prefix = normalizedPattern.slice(0, -2);
    return normalizedUrl.startsWith(prefix);
  } else if (normalizedPattern.includes('*')) {
    // Simple glob matching for patterns like "github.com/*/repo"
    const parts = normalizedPattern.split('*');
    if (parts.length === 2) {
      return normalizedUrl.startsWith(parts[0]) && normalizedUrl.endsWith(parts[1]);
    }
    return normalizedUrl === normalizedPattern;
  } else {
    return (
      normalizedUrl === normalizedPattern ||
      normalizedUrl.startsWith(normalizedPattern + '/')
    );
  }
}
