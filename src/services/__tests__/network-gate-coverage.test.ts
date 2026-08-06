/**
 * Exhaustive guard on the network gate's coverage.
 *
 * Twice now the gate has shipped covering less than it claimed, both times for
 * the same reason: coverage was a hand-written list, so it only held what
 * someone remembered to add. Round 18 missed six operations. Round 19 missed a
 * seventh (`prune_remote_tracking_branches`) plus every hosting-provider API —
 * and the test written to catch that class of gap missed them too, because it
 * was another hand-written list of *functions*.
 *
 * This test inverts it. It turns offline mode on, calls EVERY exported function
 * in git.service, and asserts that not one of them reaches a command known to
 * make an outbound request. Adding an ungated network call fails this test
 * without anyone having to remember to register it.
 */

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
const invoked: string[] = [];

(globalThis as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: ((command: string) => {
    invoked.push(command);
    // Shapes permissive enough that callers which post-process a result don't
    // throw before reaching their invoke.
    if (command === 'get_remotes') return Promise.resolve([]);
    return Promise.resolve(null);
  }) as MockInvoke,
  transformCallback: () => 0,
};

import { expect } from '@open-wc/testing';
import * as gitService from '../git.service.ts';
import { settingsStore } from '../../stores/settings.store.ts';

/**
 * Tauri commands that make an outbound request.
 *
 * `detect_*_repo` parse the local remote URL, `gitflow_*` are local git
 * operations, and `lfs_prune` / `init_submodules` / `sync_submodules` /
 * `get_remote_status` touch only on-disk state — all deliberately absent.
 */
const NETWORK_COMMANDS = new Set([
  // git operations
  'clone_repository', 'fetch', 'pull', 'push', 'push_tag',
  'push_to_multiple_remotes', 'fetch_all_remotes', 'add_submodule',
  'update_submodules', 'lfs_pull', 'lfs_fetch',
  'prune_remote_tracking_branches', 'start_auto_fetch',
  // hosting-provider APIs
  'check_ado_connection', 'check_github_connection', 'check_gitlab_connection',
  'create_ado_pull_request', 'create_azure_devops_work_item',
  'create_bitbucket_issue', 'create_bitbucket_pull_request',
  'create_gitlab_issue', 'create_gitlab_merge_request', 'create_issue',
  'create_pull_request', 'create_release', 'delete_release',
  'get_ado_pull_request', 'get_ado_work_items', 'get_bitbucket_pull_request',
  'get_check_runs', 'get_gitlab_labels', 'get_gitlab_merge_request',
  'get_issue', 'get_issue_comments', 'get_issue_template_content',
  'get_issue_templates', 'get_latest_release', 'get_pull_request',
  'get_pull_request_reviews', 'get_release_by_tag', 'get_workflow_runs',
  'list_ado_organizations', 'list_ado_pipeline_runs', 'list_ado_pull_requests',
  'list_bitbucket_issues', 'list_bitbucket_pipelines',
  'list_bitbucket_pull_requests', 'list_gitlab_issues',
  'list_gitlab_merge_requests', 'list_gitlab_pipelines', 'list_issues',
  'list_pull_requests', 'list_releases', 'query_ado_work_items',
  'test_ssh_connection', 'update_issue_state', 'add_issue_comment',
]);

/**
 * Exports that register long-lived listeners or intentionally never invoke.
 * Calling them would leak subscriptions across the suite, and none of them
 * reach the network themselves.
 */
const SKIP = new Set([
  'setupRemoteOperationListeners',
  'cleanupRemoteOperationListeners',
  'onFileChange',
  'onOperationProgress',
  'isNetworkGateRefusal',
]);

/** A grab-bag of arguments wide enough to get any of these functions to its
 * invoke. Extra arguments are ignored by JS; missing ones arrive undefined. */
const ARGS: unknown[] = [
  { path: '/repo', name: 'v1', url: 'https://example.test/x.git', title: 't', head: 'h', base: 'b' },
  'https://example.test/x.git',
  'main',
  'feature',
  1,
];

describe('network gate coverage', () => {
  afterEach(() => {
    settingsStore.setState({ offlineMode: false, confirmNetworkOps: false, remoteAllowlist: [] });
  });

  it('offline mode stops every exported function from reaching a network command', async () => {
    settingsStore.setState({ offlineMode: true, confirmNetworkOps: false, remoteAllowlist: [] });

    const leaked = new Map<string, string>();
    for (const [name, value] of Object.entries(gitService)) {
      if (typeof value !== 'function' || SKIP.has(name)) continue;
      invoked.length = 0;
      try {
        await (value as (...a: unknown[]) => unknown)(...ARGS);
      } catch {
        // A rejected call is fine — it certainly didn't reach the network.
      }
      const hit = invoked.find((c) => NETWORK_COMMANDS.has(c));
      if (hit) leaked.set(name, hit);
    }

    expect(
      Array.from(leaked, ([fn, cmd]) => `${fn} -> ${cmd}`),
      'these reached the network with offline mode on',
    ).to.deep.equal([]);
  });

  it('the same sweep does reach those commands when offline mode is off', async () => {
    // Guards the test itself: if the sweep stopped exercising anything (an
    // argument shape drifting, say), the assertion above would pass vacuously.
    settingsStore.setState({ offlineMode: false, confirmNetworkOps: false, remoteAllowlist: [] });

    const reached = new Set<string>();
    for (const [name, value] of Object.entries(gitService)) {
      if (typeof value !== 'function' || SKIP.has(name)) continue;
      invoked.length = 0;
      try {
        await (value as (...a: unknown[]) => unknown)(...ARGS);
      } catch {
        /* ignore */
      }
      for (const c of invoked) if (NETWORK_COMMANDS.has(c)) reached.add(c);
    }

    expect(reached.size, 'the sweep actually exercises network commands').to.be.greaterThan(10);
  });
});
