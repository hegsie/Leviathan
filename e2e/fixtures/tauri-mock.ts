import type { Page } from '@playwright/test';

/**
 * Mock data types matching the Rust backend responses
 */
export interface MockRepository {
  path: string;
  name: string;
  isValid: boolean;
  isBare: boolean;
  headRef: string | null;
  state: string;
}

export interface MockBranch {
  name: string;
  shorthand: string;
  isHead: boolean;
  isRemote: boolean;
  upstream: string | null;
  targetOid: string;
  aheadBehind?: { ahead: number; behind: number };
  lastCommitTimestamp?: number;
  isStale: boolean;
}

export interface MockCommit {
  oid: string;
  shortId: string;
  message: string;
  summary: string;
  body: string | null;
  author: { name: string; email: string; timestamp: number };
  committer: { name: string; email: string; timestamp: number };
  parentIds: string[];
  timestamp: number;
}

export interface MockStatusEntry {
  path: string;
  status: string;
  isStaged: boolean;
  isConflicted: boolean;
}

export interface MockStash {
  index: number;
  message: string;
  oid: string;
}

export interface MockTag {
  name: string;
  targetOid: string;
  message: string | null;
  tagger: { name: string; email: string; timestamp: number } | null;
  isAnnotated: boolean;
}

export interface MockRemote {
  name: string;
  url: string;
  pushUrl: string | null;
}

/**
 * Default mock data for a typical repository state
 */
export const defaultMockData = {
  // Repository info
  repository: {
    path: '/tmp/test-repo',
    name: 'test-repo',
    isValid: true,
    isBare: false,
    headRef: 'refs/heads/main',
    state: 'clean',
  } as MockRepository,

  // Branches
  branches: [
    {
      name: 'refs/heads/main',
      shorthand: 'main',
      isHead: true,
      isRemote: false,
      upstream: 'refs/remotes/origin/main',
      targetOid: 'abc123def456',
      aheadBehind: { ahead: 0, behind: 0 },
      lastCommitTimestamp: Date.now() / 1000,
      isStale: false,
    },
    {
      name: 'refs/heads/feature/test',
      shorthand: 'feature/test',
      isHead: false,
      isRemote: false,
      upstream: null,
      targetOid: 'def456abc789',
      isStale: false,
    },
    {
      name: 'refs/remotes/origin/main',
      shorthand: 'origin/main',
      isHead: false,
      isRemote: true,
      upstream: null,
      targetOid: 'abc123def456',
      isStale: false,
    },
  ] as MockBranch[],

  // Commit history
  commits: [
    {
      oid: 'abc123def456',
      shortId: 'abc123d',
      message: 'Initial commit\n\nThis is the first commit.',
      summary: 'Initial commit',
      body: 'This is the first commit.',
      author: { name: 'Test User', email: 'test@example.com', timestamp: Date.now() / 1000 },
      committer: { name: 'Test User', email: 'test@example.com', timestamp: Date.now() / 1000 },
      parentIds: [],
      timestamp: Date.now() / 1000,
    },
    {
      oid: 'def456abc789',
      shortId: 'def456a',
      message: 'Add feature\n\nImplemented new feature.',
      summary: 'Add feature',
      body: 'Implemented new feature.',
      author: { name: 'Test User', email: 'test@example.com', timestamp: Date.now() / 1000 - 3600 },
      committer: {
        name: 'Test User',
        email: 'test@example.com',
        timestamp: Date.now() / 1000 - 3600,
      },
      parentIds: ['abc123def456'],
      timestamp: Date.now() / 1000 - 3600,
    },
  ] as MockCommit[],

  // Status
  status: {
    staged: [] as MockStatusEntry[],
    unstaged: [
      { path: 'src/main.ts', status: 'modified', isStaged: false, isConflicted: false },
      { path: 'README.md', status: 'modified', isStaged: false, isConflicted: false },
    ] as MockStatusEntry[],
  },

  // Stashes
  stashes: [] as MockStash[],

  // Tags
  tags: [
    {
      name: 'v1.0.0',
      targetOid: 'abc123def456',
      message: 'Release v1.0.0',
      tagger: { name: 'Test User', email: 'test@example.com', timestamp: Date.now() / 1000 },
      isAnnotated: true,
    },
  ] as MockTag[],

  // Remotes
  remotes: [{ name: 'origin', url: 'https://github.com/test/repo.git', pushUrl: null }] as MockRemote[],

  // Settings
  settings: {
    theme: 'dark' as const,
    vimMode: false,
    showAvatars: true,
    showCommitSize: true,
    wordWrap: false,
    confirmBeforeDiscard: true,
  },
};

/**
 * Tauri command handler that returns mock data
 */
function createMockHandler(mocks: typeof defaultMockData) {
  return (command: string, args?: Record<string, unknown>): unknown => {
    switch (command) {
      // Repository commands
      case 'open_repository':
      case 'get_repository_info':
        return mocks.repository;

      case 'get_recent_repositories':
        return [mocks.repository];

      // Branch commands
      case 'get_branches':
        return mocks.branches;

      case 'get_current_branch':
        return mocks.branches.find((b) => b.isHead) || null;

      case 'checkout_branch':
      case 'create_branch':
      case 'delete_branch':
      case 'rename_branch':
        return null;

      case 'get_remote_status': {
        // Get ahead/behind from the current branch
        const headBranch = mocks.branches.find((b) => b.isHead);
        if (headBranch?.aheadBehind) {
          return { ahead: headBranch.aheadBehind.ahead, behind: headBranch.aheadBehind.behind };
        }
        return { ahead: 0, behind: 0 };
      }

      // Commit commands
      case 'get_commit_history':
        return mocks.commits;

      case 'get_commit':
        return mocks.commits.find((c) => c.oid === args?.oid) || mocks.commits[0];

      case 'get_refs_by_commit':
        return {};

      case 'create_commit':
        return 'new-commit-oid';

      // Status commands
      case 'get_status':
        return [...mocks.status.staged, ...mocks.status.unstaged];

      case 'get_staged_files':
        return mocks.status.staged;

      case 'get_unstaged_files':
        return mocks.status.unstaged;

      // Staging commands
      case 'stage_files':
      case 'unstage_files':
      case 'stage_all':
      case 'unstage_all':
        return null;

      // Stash commands
      case 'get_stashes':
        return mocks.stashes;

      case 'create_stash':
      case 'apply_stash':
      case 'pop_stash':
      case 'drop_stash':
        return null;

      // Tag commands
      case 'get_tags':
        return mocks.tags;

      case 'create_tag':
      case 'delete_tag':
        return null;

      // Remote commands
      case 'get_remotes':
        return mocks.remotes;

      case 'fetch':
      case 'pull':
      case 'push':
        return null;

      // Diff commands
      case 'get_diff':
      case 'get_file_diff':
        return {
          path: args?.path || 'src/main.ts',
          oldPath: null,
          status: 'modified',
          hunks: [
            {
              header: '@@ -1,5 +1,6 @@',
              oldStart: 1,
              oldLines: 5,
              newStart: 1,
              newLines: 6,
              lines: [
                { content: 'line 1', origin: 'context', oldLineNo: 1, newLineNo: 1 },
                { content: 'line 2', origin: 'deletion', oldLineNo: 2, newLineNo: null },
                { content: 'new line 2', origin: 'addition', oldLineNo: null, newLineNo: 2 },
              ],
            },
          ],
          isBinary: false,
          isImage: false,
          imageType: null,
          additions: 1,
          deletions: 1,
        };

      // Profile commands
      case 'get_profiles':
        return [{ id: 'default', name: 'Default', gitName: 'Test User', gitEmail: 'test@example.com' }];

      case 'get_active_profile':
        return { id: 'default', name: 'Default', gitName: 'Test User', gitEmail: 'test@example.com' };

      // Integration account commands
      case 'get_integration_accounts':
        return [];

      // AI commands
      case 'get_ai_model_status':
        return { available: false, downloading: false };

      case 'generate_commit_message':
        return { summary: 'Auto-generated commit', body: null };

      // Settings
      case 'get_settings':
        return mocks.settings;

      // GitHub commands
      case 'check_github_connection':
        return { connected: false, user: null, scopes: [] };

      case 'detect_github_repo':
        return null;

      // Default - log unmocked commands
      default:
        console.warn(`[Tauri Mock] Unmocked command: ${command}`, args);
        return null;
    }
  };
}

/**
 * Setup Tauri mocks on a Playwright page
 *
 * @param page - Playwright page instance
 * @param customMocks - Optional custom mock data to merge with defaults
 */
export async function setupTauriMocks(
  page: Page,
  customMocks?: Partial<typeof defaultMockData>
): Promise<void> {
  const mocks = { ...defaultMockData, ...customMocks };

  // Inject the mock before any page scripts run
  await page.addInitScript(
    ({ mockData }) => {
      // Create the mock handler
      const handler = (command: string, args?: Record<string, unknown>): unknown => {
        const data = mockData as typeof defaultMockData;

        switch (command) {
          case 'open_repository':
          case 'get_repository_info':
            return data.repository;
          case 'get_recent_repositories':
            return [data.repository];
          case 'get_branches':
            return data.branches;
          case 'get_current_branch':
            return data.branches.find((b: MockBranch) => b.isHead) || null;
          case 'get_remote_status': {
            const headBranch = data.branches.find((b: MockBranch) => b.isHead);
            if (headBranch?.aheadBehind) {
              return { ahead: headBranch.aheadBehind.ahead, behind: headBranch.aheadBehind.behind };
            }
            return { ahead: 0, behind: 0 };
          }
          case 'get_commit_history':
            return data.commits;
          case 'get_commit':
            return (
              data.commits.find((c: MockCommit) => c.oid === (args as { oid?: string })?.oid) ||
              data.commits[0]
            );
          case 'get_refs_by_commit':
            return {};
          case 'get_status':
            return [...data.status.staged, ...data.status.unstaged];
          case 'get_staged_files':
            return data.status.staged;
          case 'get_unstaged_files':
            return data.status.unstaged;
          case 'get_stashes':
            return data.stashes;
          case 'get_tags':
            return data.tags;
          case 'get_remotes':
            return data.remotes;
          case 'get_profiles':
            return [
              { id: 'default', name: 'Default', gitName: 'Test User', gitEmail: 'test@example.com' },
            ];
          case 'get_active_profile':
            return {
              id: 'default',
              name: 'Default',
              gitName: 'Test User',
              gitEmail: 'test@example.com',
            };
          case 'get_integration_accounts':
            return [];
          case 'get_ai_model_status':
            return { available: false, downloading: false };
          case 'check_github_connection':
            return { connected: false, user: null, scopes: [] };
          case 'detect_github_repo':
            return null;
          case 'get_settings':
            return data.settings;
          case 'get_diff':
          case 'get_file_diff':
            return {
              path: (args as { path?: string })?.path || 'src/main.ts',
              oldPath: null,
              status: 'modified',
              hunks: [],
              isBinary: false,
              isImage: false,
              imageType: null,
              additions: 1,
              deletions: 1,
            };
          case 'checkout_branch':
          case 'create_branch':
          case 'delete_branch':
          case 'rename_branch':
          case 'create_commit':
          case 'stage_files':
          case 'unstage_files':
          case 'stage_all':
          case 'unstage_all':
          case 'create_stash':
          case 'apply_stash':
          case 'pop_stash':
          case 'drop_stash':
          case 'create_tag':
          case 'delete_tag':
          case 'fetch':
          case 'pull':
          case 'push':
            return null;
          default:
            console.warn(`[Tauri Mock] Unmocked command: ${command}`, args);
            return null;
        }
      };

      // Set up the Tauri internals mock
      (window as Record<string, unknown>).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args?: Record<string, unknown>) => {
          return handler(command, args);
        },
        transformCallback: () => 0,
        convertFileSrc: (path: string) => path,
      };

      // Also mock the event system
      (window as Record<string, unknown>).__TAURI_INTERNALS__ = {
        ...(window as Record<string, unknown>).__TAURI_INTERNALS__,
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      };
    },
    { mockData: mocks }
  );
}

/**
 * Create mock data with modified files in the working directory
 */
export function withModifiedFiles(files: MockStatusEntry[]): Partial<typeof defaultMockData> {
  return {
    status: {
      staged: [],
      unstaged: files,
    },
  };
}

/**
 * Create mock data with staged files ready to commit
 */
export function withStagedFiles(files: MockStatusEntry[]): Partial<typeof defaultMockData> {
  return {
    status: {
      staged: files.map((f) => ({ ...f, isStaged: true })),
      unstaged: [],
    },
  };
}

/**
 * Create mock data for an empty/new repository
 */
export function emptyRepository(): Partial<typeof defaultMockData> {
  return {
    repository: {
      ...defaultMockData.repository,
      headRef: null,
    },
    branches: [],
    commits: [],
    status: { staged: [], unstaged: [] },
    stashes: [],
    tags: [],
  };
}

/**
 * Create mock data for a repository with conflicts
 */
export function withConflicts(): Partial<typeof defaultMockData> {
  return {
    repository: {
      ...defaultMockData.repository,
      state: 'merge',
    },
    status: {
      staged: [],
      unstaged: [{ path: 'CONFLICT.md', status: 'conflicted', isStaged: false, isConflicted: true }],
    },
  };
}

/**
 * Initialize the repository store with mock data.
 * Call this after page.goto() to simulate an open repository.
 *
 * @param page - Playwright page instance
 * @param customMocks - Optional custom mock data
 */
export async function initializeRepositoryStore(
  page: Page,
  customMocks?: Partial<typeof defaultMockData>
): Promise<void> {
  const mocks = { ...defaultMockData, ...customMocks };

  // Wait for stores to be available
  await page.waitForFunction(() => {
    return typeof (window as Record<string, unknown>).__LEVIATHAN_STORES__ !== 'undefined';
  }, { timeout: 10000 });

  // Initialize the repository store with mock data
  await page.evaluate(
    ({ repository, branches, stashes, tags, status }) => {
      const stores = (window as Record<string, unknown>).__LEVIATHAN_STORES__ as {
        repositoryStore: {
          getState: () => {
            addRepository: (repo: unknown) => void;
            setBranches: (branches: unknown[]) => void;
            setStashes: (stashes: unknown[]) => void;
            setTags: (tags: unknown[]) => void;
            setStatus: (status: unknown[]) => void;
            setCurrentBranch: (branch: unknown) => void;
          };
        };
      };

      if (!stores?.repositoryStore) {
        throw new Error('Repository store not available');
      }

      const state = stores.repositoryStore.getState();

      // Add the repository to open it
      state.addRepository(repository);

      // Set branches, stashes, tags, and status
      state.setBranches(branches);
      state.setStashes(stashes);
      state.setTags(tags);
      state.setStatus([...status.staged, ...status.unstaged]);

      // Set current branch
      const currentBranch = branches.find((b: { isHead?: boolean }) => b.isHead);
      if (currentBranch) {
        state.setCurrentBranch(currentBranch);
      }
    },
    {
      repository: mocks.repository,
      branches: mocks.branches,
      stashes: mocks.stashes,
      tags: mocks.tags,
      status: mocks.status,
    }
  );

  // Wait for the UI to update
  await page.waitForTimeout(100);
}

/**
 * Combined setup: Tauri mocks + repository store initialization.
 * This is the recommended way to set up tests that need an open repository.
 *
 * @param page - Playwright page instance
 * @param customMocks - Optional custom mock data
 */
export async function setupOpenRepository(
  page: Page,
  customMocks?: Partial<typeof defaultMockData>
): Promise<void> {
  // First set up Tauri IPC mocks
  await setupTauriMocks(page, customMocks);

  // Navigate to the app
  await page.goto('/');

  // Wait for app to load
  await page.waitForLoadState('domcontentloaded');

  // Initialize the repository store
  await initializeRepositoryStore(page, customMocks);
}

/**
 * Helper to create mock data with vim mode enabled
 */
export function withVimMode(): Partial<typeof defaultMockData> {
  return {
    settings: {
      ...defaultMockData.settings,
      vimMode: true,
    },
  };
}

// =============================================================================
// Profile and Account Types for E2E Tests
// =============================================================================

export interface MockUnifiedProfile {
  id: string;
  name: string;
  gitName: string;
  gitEmail: string;
  signingKey: string | null;
  urlPatterns: string[];
  isDefault: boolean;
  color: string;
  defaultAccounts: Partial<Record<'github' | 'gitlab' | 'azure-devops' | 'bitbucket', string>>;
}

export interface MockIntegrationAccount {
  id: string;
  name: string;
  integrationType: 'github' | 'gitlab' | 'azure-devops' | 'bitbucket';
  config: { type: string; instanceUrl?: string; organization?: string; workspace?: string };
  color: string | null;
  cachedUser: { username: string; displayName: string; avatarUrl: string | null } | null;
  urlPatterns: string[];
  isDefault: boolean;
}

export interface ProfilesAndAccountsOptions {
  profiles: MockUnifiedProfile[];
  accounts: MockIntegrationAccount[];
  repositoryAssignments?: Record<string, string>;
  /** Account IDs that are connected (have valid tokens) */
  connectedAccounts?: string[];
}

/**
 * Initialize the unified profile store with profiles and accounts.
 * Call this after page.goto() to set up test profiles and accounts.
 *
 * @param page - Playwright page instance
 * @param options - Profiles and accounts configuration
 */
export async function initializeUnifiedProfileStore(
  page: Page,
  options: ProfilesAndAccountsOptions
): Promise<void> {
  // Wait for stores to be available
  await page.waitForFunction(() => {
    return typeof (window as Record<string, unknown>).__LEVIATHAN_STORES__ !== 'undefined' &&
           typeof ((window as Record<string, unknown>).__LEVIATHAN_STORES__ as Record<string, unknown>).unifiedProfileStore !== 'undefined';
  }, { timeout: 10000 });

  // Initialize the unified profile store with test data
  await page.evaluate(
    ({ profiles, accounts, repositoryAssignments, connectedAccounts }) => {
      const stores = (window as Record<string, unknown>).__LEVIATHAN_STORES__ as {
        unifiedProfileStore: {
          getState: () => {
            setConfig: (config: unknown) => void;
            setProfiles: (profiles: unknown[]) => void;
            setAccounts: (accounts: unknown[]) => void;
            setActiveProfile: (profile: unknown) => void;
            setAccountConnectionStatus: (accountId: string, status: string) => void;
          };
        };
      };

      if (!stores?.unifiedProfileStore) {
        throw new Error('Unified profile store not available');
      }

      const state = stores.unifiedProfileStore.getState();

      // Set the full config
      const config = {
        version: 3,
        profiles,
        accounts,
        repositoryAssignments: repositoryAssignments ?? {},
      };
      state.setConfig(config);

      // Set the active profile (first default or first profile)
      const defaultProfile = profiles.find((p: { isDefault?: boolean }) => p.isDefault) || profiles[0];
      if (defaultProfile) {
        state.setActiveProfile(defaultProfile);
      }

      // Set connection status for connected accounts
      if (connectedAccounts && connectedAccounts.length > 0) {
        for (const accountId of connectedAccounts) {
          state.setAccountConnectionStatus(accountId, 'connected');
        }
      }
    },
    {
      profiles: options.profiles,
      accounts: options.accounts,
      repositoryAssignments: options.repositoryAssignments ?? {},
      connectedAccounts: options.connectedAccounts ?? [],
    }
  );

  // Wait for the UI to update
  await page.waitForTimeout(100);
}

/**
 * Combined setup: Tauri mocks + repository store + unified profile store.
 * Use this to set up tests that need an open repository with specific profiles/accounts.
 *
 * @param page - Playwright page instance
 * @param options - Profiles and accounts configuration
 * @param customMocks - Optional custom mock data for repository
 */
export async function setupProfilesAndAccounts(
  page: Page,
  options: ProfilesAndAccountsOptions,
  customMocks?: Partial<typeof defaultMockData>
): Promise<void> {
  // First set up Tauri IPC mocks - include profile/account data in mocks
  await setupTauriMocks(page, customMocks);

  // Navigate to the app
  await page.goto('/');

  // Wait for app to load
  await page.waitForLoadState('domcontentloaded');

  // Initialize the repository store
  await initializeRepositoryStore(page, customMocks);

  // Initialize the unified profile store with profiles and accounts
  await initializeUnifiedProfileStore(page, options);
}
