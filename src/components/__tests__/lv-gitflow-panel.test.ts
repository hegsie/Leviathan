import { expect } from '@open-wc/testing';

// Mock Tauri API before importing any modules that use it
let lastInvokedCommand: string | null = null;
let lastInvokedArgs: Record<string, unknown> | null = null;
const invokeHistory: { command: string; args: Record<string, unknown> }[] = [];

// Default mock responses per command
let mockResponses: Record<string, unknown> = {};

const mockInvoke = (command: string, args?: Record<string, unknown>): Promise<unknown> => {
  lastInvokedCommand = command;
  lastInvokedArgs = args ?? null;
  invokeHistory.push({ command, args: args ?? {} });

  if (command in mockResponses) {
    return Promise.resolve(mockResponses[command]);
  }
  return Promise.resolve(null);
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

// --- Replicate pure logic from lv-gitflow-panel.ts for testing ---

type GitFlowCategory = 'feature' | 'release' | 'hotfix';

interface GitFlowConfig {
  initialized: boolean;
  masterBranch: string;
  developBranch: string;
  featurePrefix: string;
  releasePrefix: string;
  hotfixPrefix: string;
  supportPrefix: string;
  versionTagPrefix: string;
}

interface Branch {
  name: string;
  shorthand: string;
  isHead: boolean;
  isRemote: boolean;
  upstream: string | null;
  targetOid: string;
  lastCommitTimestamp?: number;
  isStale: boolean;
}

interface ActiveItem {
  name: string;
  branch: string;
}

// Replicate extractActiveItems logic from lv-gitflow-panel.ts
function extractActiveItems(branches: Branch[], prefix: string): ActiveItem[] {
  return branches
    .filter((b) => b.name.startsWith(prefix))
    .map((b) => ({
      name: b.name.slice(prefix.length),
      branch: b.name,
    }));
}

// Replicate toggleSection logic from lv-gitflow-panel.ts
function toggleSection(
  expandedSections: Set<GitFlowCategory>,
  category: GitFlowCategory,
): Set<GitFlowCategory> {
  const next = new Set(expandedSections);
  if (next.has(category)) {
    next.delete(category);
  } else {
    next.add(category);
  }
  return next;
}

// Helper: create a Branch for testing
function createBranch(
  name: string,
  opts: Partial<Branch> = {},
): Branch {
  return {
    name,
    shorthand: opts.shorthand ?? name,
    isHead: opts.isHead ?? false,
    isRemote: opts.isRemote ?? false,
    upstream: opts.upstream ?? null,
    targetOid: opts.targetOid ?? 'abc123',
    lastCommitTimestamp: opts.lastCommitTimestamp ?? undefined,
    isStale: opts.isStale ?? false,
    ...opts,
  };
}

// Helper: create a default GitFlowConfig
function createConfig(overrides: Partial<GitFlowConfig> = {}): GitFlowConfig {
  return {
    initialized: true,
    masterBranch: 'main',
    developBranch: 'develop',
    featurePrefix: 'feature/',
    releasePrefix: 'release/',
    hotfixPrefix: 'hotfix/',
    supportPrefix: 'support/',
    versionTagPrefix: 'v',
    ...overrides,
  };
}

describe('lv-gitflow-panel - extractActiveItems', () => {
  const branches = [
    createBranch('main', { isHead: true }),
    createBranch('develop'),
    createBranch('feature/login'),
    createBranch('feature/signup'),
    createBranch('release/1.0.0'),
    createBranch('hotfix/critical-bug'),
  ];

  it('extracts feature branches', () => {
    const items = extractActiveItems(branches, 'feature/');
    expect(items.length).to.equal(2);
    expect(items[0].name).to.equal('login');
    expect(items[0].branch).to.equal('feature/login');
    expect(items[1].name).to.equal('signup');
    expect(items[1].branch).to.equal('feature/signup');
  });

  it('extracts release branches', () => {
    const items = extractActiveItems(branches, 'release/');
    expect(items.length).to.equal(1);
    expect(items[0].name).to.equal('1.0.0');
    expect(items[0].branch).to.equal('release/1.0.0');
  });

  it('extracts hotfix branches', () => {
    const items = extractActiveItems(branches, 'hotfix/');
    expect(items.length).to.equal(1);
    expect(items[0].name).to.equal('critical-bug');
    expect(items[0].branch).to.equal('hotfix/critical-bug');
  });

  it('returns empty array when no branches match prefix', () => {
    const items = extractActiveItems(branches, 'bugfix/');
    expect(items.length).to.equal(0);
  });

  it('returns empty array for empty branches list', () => {
    const items = extractActiveItems([], 'feature/');
    expect(items.length).to.equal(0);
  });

  it('filters out remote branches by passing only local branches', () => {
    const localAndRemote = [
      createBranch('feature/local-only'),
      createBranch('origin/feature/remote-only', { isRemote: true }),
    ];
    // The component filters remotes before calling extractActiveItems, so
    // we replicate that: only pass non-remote branches
    const localOnly = localAndRemote.filter((b) => !b.isRemote);
    const items = extractActiveItems(localOnly, 'feature/');
    expect(items.length).to.equal(1);
    expect(items[0].name).to.equal('local-only');
  });

  it('handles custom prefixes', () => {
    const customBranches = [
      createBranch('feat/my-feature'),
      createBranch('feature/standard-feature'),
    ];
    const items = extractActiveItems(customBranches, 'feat/');
    expect(items.length).to.equal(1);
    expect(items[0].name).to.equal('my-feature');
  });

  it('handles branches with nested slashes in name', () => {
    const nestedBranches = [
      createBranch('feature/auth/login'),
      createBranch('feature/auth/signup'),
    ];
    const items = extractActiveItems(nestedBranches, 'feature/');
    expect(items.length).to.equal(2);
    expect(items[0].name).to.equal('auth/login');
    expect(items[1].name).to.equal('auth/signup');
  });
});

describe('lv-gitflow-panel - toggleSection', () => {
  it('expands a collapsed section', () => {
    const expanded = new Set<GitFlowCategory>(['feature']);
    const result = toggleSection(expanded, 'release');
    expect(result.has('feature')).to.be.true;
    expect(result.has('release')).to.be.true;
  });

  it('collapses an expanded section', () => {
    const expanded = new Set<GitFlowCategory>(['feature', 'release', 'hotfix']);
    const result = toggleSection(expanded, 'release');
    expect(result.has('feature')).to.be.true;
    expect(result.has('release')).to.be.false;
    expect(result.has('hotfix')).to.be.true;
  });

  it('does not mutate the original set', () => {
    const expanded = new Set<GitFlowCategory>(['feature']);
    const result = toggleSection(expanded, 'feature');
    expect(expanded.has('feature')).to.be.true;
    expect(result.has('feature')).to.be.false;
  });

  it('toggles to empty when only one section is expanded', () => {
    const expanded = new Set<GitFlowCategory>(['hotfix']);
    const result = toggleSection(expanded, 'hotfix');
    expect(result.size).to.equal(0);
  });

  it('can expand all sections', () => {
    let expanded = new Set<GitFlowCategory>();
    expanded = toggleSection(expanded, 'feature');
    expanded = toggleSection(expanded, 'release');
    expanded = toggleSection(expanded, 'hotfix');
    expect(expanded.size).to.equal(3);
    expect(expanded.has('feature')).to.be.true;
    expect(expanded.has('release')).to.be.true;
    expect(expanded.has('hotfix')).to.be.true;
  });
});

describe('lv-gitflow-panel - config initialization state', () => {
  it('detects uninitialized config', () => {
    const config = createConfig({ initialized: false });
    expect(config.initialized).to.be.false;
  });

  it('detects initialized config', () => {
    const config = createConfig({ initialized: true });
    expect(config.initialized).to.be.true;
  });

  it('has correct default prefix values', () => {
    const config = createConfig();
    expect(config.featurePrefix).to.equal('feature/');
    expect(config.releasePrefix).to.equal('release/');
    expect(config.hotfixPrefix).to.equal('hotfix/');
    expect(config.masterBranch).to.equal('main');
    expect(config.developBranch).to.equal('develop');
  });

  it('accepts custom config overrides', () => {
    const config = createConfig({
      masterBranch: 'master',
      developBranch: 'dev',
      featurePrefix: 'feat/',
      releasePrefix: 'rel/',
      hotfixPrefix: 'fix/',
    });
    expect(config.masterBranch).to.equal('master');
    expect(config.developBranch).to.equal('dev');
    expect(config.featurePrefix).to.equal('feat/');
    expect(config.releasePrefix).to.equal('rel/');
    expect(config.hotfixPrefix).to.equal('fix/');
  });
});

describe('lv-gitflow-panel - active item categorization', () => {
  it('categorizes branches into correct active item groups', () => {
    const config = createConfig();
    const branches = [
      createBranch('main'),
      createBranch('develop'),
      createBranch('feature/auth'),
      createBranch('feature/dashboard'),
      createBranch('release/2.0.0'),
      createBranch('hotfix/security-patch'),
      createBranch('hotfix/data-fix'),
    ];

    const features = extractActiveItems(branches, config.featurePrefix);
    const releases = extractActiveItems(branches, config.releasePrefix);
    const hotfixes = extractActiveItems(branches, config.hotfixPrefix);

    expect(features.length).to.equal(2);
    expect(releases.length).to.equal(1);
    expect(hotfixes.length).to.equal(2);

    expect(features.map((f) => f.name)).to.deep.equal(['auth', 'dashboard']);
    expect(releases.map((r) => r.name)).to.deep.equal(['2.0.0']);
    expect(hotfixes.map((h) => h.name)).to.deep.equal(['security-patch', 'data-fix']);
  });

  it('returns empty categories when no in-progress items exist', () => {
    const config = createConfig();
    const branches = [
      createBranch('main'),
      createBranch('develop'),
    ];

    const features = extractActiveItems(branches, config.featurePrefix);
    const releases = extractActiveItems(branches, config.releasePrefix);
    const hotfixes = extractActiveItems(branches, config.hotfixPrefix);

    expect(features.length).to.equal(0);
    expect(releases.length).to.equal(0);
    expect(hotfixes.length).to.equal(0);
  });

  it('handles config with custom prefixes', () => {
    const config = createConfig({
      featurePrefix: 'feat/',
      releasePrefix: 'rel/',
      hotfixPrefix: 'fix/',
    });
    const branches = [
      createBranch('feat/custom-feature'),
      createBranch('rel/3.0'),
      createBranch('fix/urgent'),
      createBranch('feature/standard-wont-match'),
    ];

    const features = extractActiveItems(branches, config.featurePrefix);
    const releases = extractActiveItems(branches, config.releasePrefix);
    const hotfixes = extractActiveItems(branches, config.hotfixPrefix);

    expect(features.length).to.equal(1);
    expect(features[0].name).to.equal('custom-feature');

    expect(releases.length).to.equal(1);
    expect(releases[0].name).to.equal('3.0');

    expect(hotfixes.length).to.equal(1);
    expect(hotfixes[0].name).to.equal('urgent');
  });
});

describe('lv-gitflow-panel - Tauri command invocations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    invokeHistory.length = 0;
    mockResponses = {};
  });

  it('invokes get_gitflow_config with correct path', async () => {
    const { getGitFlowConfig } = await import('../../services/git.service.ts');

    mockResponses['get_gitflow_config'] = createConfig({ initialized: false });
    await getGitFlowConfig('/test/repo');

    expect(lastInvokedCommand).to.equal('get_gitflow_config');
    expect(lastInvokedArgs).to.deep.include({ path: '/test/repo' });
  });

  it('invokes init_gitflow with correct arguments', async () => {
    const { initGitFlow } = await import('../../services/git.service.ts');

    mockResponses['init_gitflow'] = createConfig();
    await initGitFlow('/test/repo');

    expect(lastInvokedCommand).to.equal('init_gitflow');
    expect(lastInvokedArgs).to.deep.include({ path: '/test/repo' });
  });

  it('invokes gitflow_start_feature with name', async () => {
    const { gitFlowStartFeature } = await import('../../services/git.service.ts');

    mockResponses['gitflow_start_feature'] = createBranch('feature/new-feature');
    await gitFlowStartFeature('/test/repo', 'new-feature');

    expect(lastInvokedCommand).to.equal('gitflow_start_feature');
    expect(lastInvokedArgs).to.deep.include({ path: '/test/repo', name: 'new-feature' });
  });

  it('invokes gitflow_finish_feature with correct arguments', async () => {
    const { gitFlowFinishFeature } = await import('../../services/git.service.ts');

    await gitFlowFinishFeature('/test/repo', 'done-feature', true, false);

    expect(lastInvokedCommand).to.equal('gitflow_finish_feature');
    expect(lastInvokedArgs).to.deep.include({
      path: '/test/repo',
      name: 'done-feature',
      deleteBranch: true,
      squash: false,
    });
  });

  it('invokes gitflow_start_release with version', async () => {
    const { gitFlowStartRelease } = await import('../../services/git.service.ts');

    mockResponses['gitflow_start_release'] = createBranch('release/1.0.0');
    await gitFlowStartRelease('/test/repo', '1.0.0');

    expect(lastInvokedCommand).to.equal('gitflow_start_release');
    expect(lastInvokedArgs).to.deep.include({ path: '/test/repo', version: '1.0.0' });
  });

  it('invokes gitflow_finish_release with tag message', async () => {
    const { gitFlowFinishRelease } = await import('../../services/git.service.ts');

    await gitFlowFinishRelease('/test/repo', '1.0.0', 'Release v1.0.0', true);

    expect(lastInvokedCommand).to.equal('gitflow_finish_release');
    expect(lastInvokedArgs).to.deep.include({
      path: '/test/repo',
      version: '1.0.0',
      tagMessage: 'Release v1.0.0',
      deleteBranch: true,
    });
  });

  it('invokes gitflow_start_hotfix with version', async () => {
    const { gitFlowStartHotfix } = await import('../../services/git.service.ts');

    mockResponses['gitflow_start_hotfix'] = createBranch('hotfix/1.0.1');
    await gitFlowStartHotfix('/test/repo', '1.0.1');

    expect(lastInvokedCommand).to.equal('gitflow_start_hotfix');
    expect(lastInvokedArgs).to.deep.include({ path: '/test/repo', version: '1.0.1' });
  });

  it('invokes gitflow_finish_hotfix with tag message', async () => {
    const { gitFlowFinishHotfix } = await import('../../services/git.service.ts');

    await gitFlowFinishHotfix('/test/repo', '1.0.1', 'Hotfix v1.0.1', true);

    expect(lastInvokedCommand).to.equal('gitflow_finish_hotfix');
    expect(lastInvokedArgs).to.deep.include({
      path: '/test/repo',
      version: '1.0.1',
      tagMessage: 'Hotfix v1.0.1',
      deleteBranch: true,
    });
  });
});
