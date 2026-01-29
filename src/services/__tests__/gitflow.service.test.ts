import { expect } from '@open-wc/testing';

// Mock Tauri API
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
let lastInvokedCommand: string | null = null;
let lastInvokedArgs: unknown = null;
const invokeHistory: Array<{ command: string; args: unknown }> = [];

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    lastInvokedCommand = command;
    lastInvokedArgs = args;
    invokeHistory.push({ command, args });
    return mockInvoke(command, args);
  },
};

import {
  getGitFlowConfig,
  initGitFlow,
  gitFlowStartFeature,
  gitFlowFinishFeature,
  gitFlowStartRelease,
  gitFlowFinishRelease,
  gitFlowStartHotfix,
  gitFlowFinishHotfix,
  type GitFlowConfig,
} from '../git.service.ts';

describe('git.service - Git Flow operations', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
    invokeHistory.length = 0;
  });

  describe('getGitFlowConfig', () => {
    it('invokes get_gitflow_config command', async () => {
      const mockConfig: GitFlowConfig = {
        initialized: false,
        masterBranch: 'main',
        developBranch: 'develop',
        featurePrefix: 'feature/',
        releasePrefix: 'release/',
        hotfixPrefix: 'hotfix/',
        supportPrefix: 'support/',
        versionTagPrefix: 'v',
      };
      mockInvoke = () => Promise.resolve(mockConfig);

      const result = await getGitFlowConfig('/test/repo');
      expect(lastInvokedCommand).to.equal('get_gitflow_config');
      expect((lastInvokedArgs as Record<string, unknown>).path).to.equal('/test/repo');
      expect(result.success).to.be.true;
    });

    it('returns uninitialized config for fresh repo', async () => {
      mockInvoke = () =>
        Promise.resolve({
          initialized: false,
          masterBranch: 'main',
          developBranch: 'develop',
          featurePrefix: 'feature/',
          releasePrefix: 'release/',
          hotfixPrefix: 'hotfix/',
          supportPrefix: 'support/',
          versionTagPrefix: 'v',
        });

      const result = await getGitFlowConfig('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.initialized).to.be.false;
    });

    it('returns initialized config after init', async () => {
      mockInvoke = () =>
        Promise.resolve({
          initialized: true,
          masterBranch: 'main',
          developBranch: 'develop',
          featurePrefix: 'feature/',
          releasePrefix: 'release/',
          hotfixPrefix: 'hotfix/',
          supportPrefix: 'support/',
          versionTagPrefix: 'v',
        });

      const result = await getGitFlowConfig('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.initialized).to.be.true;
    });
  });

  describe('initGitFlow', () => {
    it('invokes init_gitflow with default config', async () => {
      mockInvoke = () =>
        Promise.resolve({
          initialized: true,
          masterBranch: 'main',
          developBranch: 'develop',
          featurePrefix: 'feature/',
          releasePrefix: 'release/',
          hotfixPrefix: 'hotfix/',
          supportPrefix: 'support/',
          versionTagPrefix: 'v',
        });

      const result = await initGitFlow('/test/repo');
      expect(lastInvokedCommand).to.equal('init_gitflow');
      expect(result.success).to.be.true;
      expect(result.data?.initialized).to.be.true;
    });

    it('invokes init_gitflow with custom config', async () => {
      mockInvoke = () =>
        Promise.resolve({
          initialized: true,
          masterBranch: 'production',
          developBranch: 'dev',
          featurePrefix: 'feat/',
          releasePrefix: 'rel/',
          hotfixPrefix: 'fix/',
          supportPrefix: 'sup/',
          versionTagPrefix: 'ver',
        });

      await initGitFlow('/test/repo', {
        masterBranch: 'production',
        developBranch: 'dev',
        featurePrefix: 'feat/',
      });
      expect(lastInvokedCommand).to.equal('init_gitflow');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.masterBranch).to.equal('production');
      expect(args.developBranch).to.equal('dev');
      expect(args.featurePrefix).to.equal('feat/');
    });
  });

  describe('gitFlowStartFeature', () => {
    it('invokes gitflow_start_feature command', async () => {
      mockInvoke = () =>
        Promise.resolve({
          name: 'feature/my-feature',
          shorthand: 'feature/my-feature',
          isHead: true,
          isRemote: false,
        });

      const result = await gitFlowStartFeature('/test/repo', 'my-feature');
      expect(lastInvokedCommand).to.equal('gitflow_start_feature');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.name).to.equal('my-feature');
      expect(result.success).to.be.true;
    });

    it('returns the created branch', async () => {
      mockInvoke = () =>
        Promise.resolve({
          name: 'feature/login-system',
          shorthand: 'feature/login-system',
          isHead: true,
          isRemote: false,
        });

      const result = await gitFlowStartFeature('/test/repo', 'login-system');
      expect(result.data?.name).to.equal('feature/login-system');
      expect(result.data?.isHead).to.be.true;
    });
  });

  describe('gitFlowFinishFeature', () => {
    it('invokes gitflow_finish_feature with delete', async () => {
      mockInvoke = () => Promise.resolve(null);

      await gitFlowFinishFeature('/test/repo', 'my-feature', true);
      expect(lastInvokedCommand).to.equal('gitflow_finish_feature');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.name).to.equal('my-feature');
      expect(args.deleteBranch).to.be.true;
    });

    it('invokes gitflow_finish_feature with squash', async () => {
      mockInvoke = () => Promise.resolve(null);

      await gitFlowFinishFeature('/test/repo', 'my-feature', true, true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.squash).to.be.true;
    });
  });

  describe('gitFlowStartRelease', () => {
    it('invokes gitflow_start_release command', async () => {
      mockInvoke = () =>
        Promise.resolve({
          name: 'release/1.0.0',
          isHead: true,
        });

      const result = await gitFlowStartRelease('/test/repo', '1.0.0');
      expect(lastInvokedCommand).to.equal('gitflow_start_release');
      expect(result.data?.name).to.equal('release/1.0.0');
    });
  });

  describe('gitFlowFinishRelease', () => {
    it('invokes gitflow_finish_release with tag message', async () => {
      mockInvoke = () => Promise.resolve(null);

      await gitFlowFinishRelease('/test/repo', '1.0.0', 'Release v1.0.0');
      expect(lastInvokedCommand).to.equal('gitflow_finish_release');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.version).to.equal('1.0.0');
      expect(args.tagMessage).to.equal('Release v1.0.0');
    });
  });

  describe('gitFlowStartHotfix', () => {
    it('invokes gitflow_start_hotfix command', async () => {
      mockInvoke = () =>
        Promise.resolve({
          name: 'hotfix/1.0.1',
          isHead: true,
        });

      const result = await gitFlowStartHotfix('/test/repo', '1.0.1');
      expect(lastInvokedCommand).to.equal('gitflow_start_hotfix');
      expect(result.data?.name).to.equal('hotfix/1.0.1');
    });
  });

  describe('gitFlowFinishHotfix', () => {
    it('invokes gitflow_finish_hotfix command', async () => {
      mockInvoke = () => Promise.resolve(null);

      await gitFlowFinishHotfix('/test/repo', '1.0.1', 'Hotfix 1.0.1');
      expect(lastInvokedCommand).to.equal('gitflow_finish_hotfix');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.version).to.equal('1.0.1');
      expect(args.tagMessage).to.equal('Hotfix 1.0.1');
    });
  });
});
