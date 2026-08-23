import { expect } from '@open-wc/testing';
import { cloneRepository } from '../git.service.ts';
import { unifiedProfileStore } from '../../stores/unified-profile.store.ts';
import { createEmptyIntegrationAccount } from '../../types/unified-profile.types.ts';
import type { IntegrationAccount } from '../../types/unified-profile.types.ts';

/**
 * Clone happens before a repository exists on disk, so the remote-based token
 * detection fetch/pull/push use cannot run. These cover the URL-host lookup
 * that stands in for it.
 */

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

const keyring = new Map<string, string>();
const invokedCommands: string[] = [];
let cloneArgs: Record<string, unknown> | null = null;
let keyringFails = false;

const repositoryStub = {
  path: '/dest/repo',
  name: 'repo',
  currentBranch: 'main',
  isBare: false,
  headCommit: null,
};

const mockInvoke: MockInvoke = async (command: string, args?: unknown) => {
  const a = args as Record<string, unknown> | undefined;
  if (command === 'get_keyring_token') {
    if (keyringFails) throw new Error('keyring unavailable');
    return keyring.get(a!.key as string) ?? null;
  }
  if (command === 'store_keyring_token') {
    keyring.set(a!.key as string, a!.value as string);
    return null;
  }
  if (command === 'clone_repository') return repositoryStub;
  return null;
};

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    invokedCommands.push(command);
    if (command === 'clone_repository') {
      cloneArgs = { ...(args as Record<string, unknown>) };
    }
    return mockInvoke(command, args);
  },
};

function account(
  integrationType: 'github' | 'gitlab' | 'azure-devops',
  id: string,
  instanceOrOrg?: string,
  isDefault = true,
): IntegrationAccount {
  return {
    ...createEmptyIntegrationAccount(integrationType, instanceOrOrg),
    id,
    name: id,
    isDefault,
  };
}

/** Seed a per-account keyring token, plus the OAuth bundle ADO refreshes from. */
function seedAccountToken(
  integrationType: 'github' | 'gitlab' | 'azure-devops',
  accountId: string,
  token: string,
  withOAuthBundle = false,
) {
  const key = `${integrationType}_token_${accountId}`;
  keyring.set(key, token);
  if (withOAuthBundle) {
    // Far-future expiry → getFreshAccountToken returns the stored token
    // without attempting a refresh grant.
    keyring.set(
      `${key}_oauth`,
      JSON.stringify({ accessToken: token, refreshToken: 'r', expiresAt: Date.now() + 3_600_000 }),
    );
  }
}

async function cloneAndReadArgs(url: string, extra: Record<string, unknown> = {}) {
  const result = await cloneRepository({ url, path: '/dest/repo', ...extra });
  expect(result.success, 'clone resolved').to.be.true;
  return (cloneArgs ?? {}) as { token?: string };
}

describe('git.service - cloneRepository token lookup', () => {
  beforeEach(() => {
    keyring.clear();
    invokedCommands.length = 0;
    cloneArgs = null;
    keyringFails = false;
  });

  afterEach(() => {
    unifiedProfileStore.getState().reset();
  });

  it("attaches the connected GitLab account's token when cloning from gitlab.com", async () => {
    unifiedProfileStore.getState().setAccounts([account('gitlab', 'gl-1', 'https://gitlab.com')]);
    seedAccountToken('gitlab', 'gl-1', 'gl-tok');

    const args = await cloneAndReadArgs('https://gitlab.com/group/proj.git');

    expect(args.token, "the connected GitLab account's token").to.equal('gl-tok');
  });

  it('uses the token of the GitLab account matching a self-hosted instance host', async () => {
    unifiedProfileStore.getState().setAccounts([
      account('gitlab', 'gl-dotcom', 'https://gitlab.com', true),
      account('gitlab', 'gl-self', 'https://git.acme.dev', false),
    ]);
    seedAccountToken('gitlab', 'gl-dotcom', 'dotcom-tok');
    seedAccountToken('gitlab', 'gl-self', 'selfhosted-tok');

    const args = await cloneAndReadArgs('https://git.acme.dev/group/proj.git');

    expect(args.token, "the self-hosted instance's own token, not the default account's")
      .to.equal('selfhosted-tok');
  });

  it('attaches the Azure DevOps token for a dev.azure.com clone', async () => {
    unifiedProfileStore.getState().setAccounts([account('azure-devops', 'ado-1', 'myorg')]);
    seedAccountToken('azure-devops', 'ado-1', 'ado-tok', true);

    const args = await cloneAndReadArgs('https://dev.azure.com/myorg/proj/_git/repo');

    expect(args.token, 'the connected Azure DevOps token').to.equal('ado-tok');
  });

  it('attaches the Azure DevOps token for an {org}.visualstudio.com clone', async () => {
    unifiedProfileStore.getState().setAccounts([account('azure-devops', 'ado-1', 'myorg')]);
    seedAccountToken('azure-devops', 'ado-1', 'ado-tok', true);

    const args = await cloneAndReadArgs('https://myorg.visualstudio.com/proj/_git/repo');

    expect(args.token, 'the connected Azure DevOps token').to.equal('ado-tok');
  });

  it('does not attach the GitHub token to a look-alike host', async () => {
    unifiedProfileStore.getState().setAccounts([account('github', 'gh-1')]);
    seedAccountToken('github', 'gh-1', 'gh-tok');

    const args = await cloneAndReadArgs('https://github.com.evil.example/a/b.git');

    expect(args.token, 'no token for a look-alike host').to.be.undefined;
  });

  it('still attaches the GitHub token for a github.com clone', async () => {
    unifiedProfileStore.getState().setAccounts([account('github', 'gh-1')]);
    seedAccountToken('github', 'gh-1', 'gh-tok');

    const args = await cloneAndReadArgs('https://github.com/o/r.git');

    expect(args.token, 'the connected GitHub token').to.equal('gh-tok');
  });

  it('attaches no token for a host with no connected account', async () => {
    unifiedProfileStore.getState().setAccounts([account('gitlab', 'gl-1', 'https://gitlab.com')]);
    seedAccountToken('gitlab', 'gl-1', 'gl-tok');

    const bitbucket = await cloneAndReadArgs('https://bitbucket.org/w/r.git');
    expect(bitbucket.token, 'no credential is resolved for Bitbucket').to.be.undefined;

    invokedCommands.length = 0;
    const other = await cloneAndReadArgs('https://example.com/x/y.git');
    expect(other.token, 'no token for an unknown host').to.be.undefined;
    expect(invokedCommands, 'no keyring read for an unknown host')
      .to.not.include('get_keyring_token');
  });

  it('does not overwrite a token the caller supplied', async () => {
    unifiedProfileStore.getState().setAccounts([account('gitlab', 'gl-1', 'https://gitlab.com')]);
    seedAccountToken('gitlab', 'gl-1', 'gl-tok');

    const args = await cloneAndReadArgs('https://gitlab.com/group/proj.git', { token: 'explicit' });

    expect(args.token, "the caller's token wins").to.equal('explicit');
  });

  it('clones without a token when the credential lookup fails', async () => {
    unifiedProfileStore.getState().setAccounts([account('gitlab', 'gl-1', 'https://gitlab.com')]);
    seedAccountToken('gitlab', 'gl-1', 'gl-tok');
    keyringFails = true;

    const args = await cloneAndReadArgs('https://gitlab.com/group/proj.git');

    expect(invokedCommands, 'the clone still ran').to.include('clone_repository');
    expect(args.token, 'unauthenticated rather than blocked').to.be.undefined;
  });
});
