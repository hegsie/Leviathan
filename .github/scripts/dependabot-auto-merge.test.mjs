import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { run } from './dependabot-auto-merge.mjs';

const WORKFLOW = readFileSync(
  fileURLToPath(new URL('../workflows/dependabot-auto-merge.yml', import.meta.url)),
  'utf8',
);

const HEAD_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function dependabotCommit({ name = 'glob', version = '0.3.4', updateType = 'patch' } = {}) {
  return [
    `deps(cargo): bump ${name}`,
    '',
    '---',
    'updated-dependencies:',
    `- dependency-name: ${name}`,
    `  dependency-version: ${version}`,
    '  dependency-type: direct:production',
    `  update-type: version-update:semver-${updateType}`,
    '...',
    '',
    'Signed-off-by: dependabot[bot] <support@github.com>',
  ].join('\n');
}

/**
 * Builds a world where everything is in order, so each test can break exactly
 * one thing and assert on the consequence.
 */
function harness(overrides = {}) {
  const calls = { merged: [], comments: [], failures: [], info: [] };

  const state = {
    pr: {
      number: 318,
      draft: false,
      user: { login: 'dependabot[bot]' },
      base: { ref: 'main' },
      head: { sha: HEAD_SHA },
    },
    checkRuns: [
      { name: 'Lint Frontend', status: 'completed', conclusion: 'success' },
      { name: 'Test Backend', status: 'completed', conclusion: 'success' },
      { name: 'Auto-merge', status: 'in_progress', conclusion: null },
    ],
    combinedStatus: { state: 'pending', statuses: [] },
    commits: [dependabotCommit()],
    existingComments: [],
    mergeError: null,
    ...overrides,
  };

  const listForRef = () => state.checkRuns;
  const listCommits = () => state.commits.map((message) => ({ commit: { message } }));
  const listComments = () => state.existingComments;

  const github = {
    rest: {
      pulls: {
        list: async () => ({ data: [{ number: state.pr.number }] }),
        get: async () => ({ data: state.pr }),
        listCommits,
        merge: async (params) => {
          if (state.mergeError) throw state.mergeError;
          calls.merged.push(params);
          return { data: { merged: true } };
        },
      },
      checks: { listForRef },
      repos: { getCombinedStatusForRef: async () => ({ data: state.combinedStatus }) },
      issues: {
        listComments,
        createComment: async (params) => {
          calls.comments.push(params);
        },
      },
    },
    // The real Octokit paginate flattens the endpoint's collection; these
    // endpoints already return arrays.
    paginate: async (endpoint, params) => endpoint(params),
  };

  const summary = {
    written: [],
    addRaw(text) {
      this.written.push(text);
      return this;
    },
    async write() {},
  };

  const core = {
    info: (message) => calls.info.push(message),
    setFailed: (message) => calls.failures.push(message),
    summary,
  };

  const context = {
    repo: { owner: 'hegsie', repo: 'Leviathan' },
    payload: {
      workflow_run: { head_branch: 'dependabot/cargo/src-tauri/glob-0.3.4', head_sha: HEAD_SHA },
      repository: { default_branch: 'main' },
    },
  };

  return { github, core, context, state, calls, summary };
}

let h;
beforeEach(() => {
  h = harness();
});

test('merges a compatible update by squash, pinned to the tested commit', async () => {
  const result = await run(h);

  assert.equal(result.merged, true);
  assert.equal(h.calls.merged.length, 1);
  assert.deepEqual(h.calls.merged[0], {
    owner: 'hegsie',
    repo: 'Leviathan',
    pull_number: 318,
    merge_method: 'squash',
    sha: HEAD_SHA,
  });
  assert.equal(h.calls.comments.length, 0);
});

test('holds a breaking update, and says why exactly once', async () => {
  h = harness({ commits: [dependabotCommit({ name: 'base64', version: '0.23.1', updateType: 'minor' })] });

  const result = await run(h);
  assert.equal(result.merged, false);
  assert.equal(h.calls.merged.length, 0);
  assert.equal(h.calls.comments.length, 1);
  assert.match(h.calls.comments[0].body, /base64 -> 0\.23\.1/);
  assert.match(h.calls.comments[0].body, /<!-- dependabot-auto-merge -->/);

  // A rebase re-runs CI and lands here again; the note must not repeat.
  h.state.existingComments = [{ body: h.calls.comments[0].body }];
  await run(h);
  assert.equal(h.calls.comments.length, 1);
});

test('refuses a pull request that is not Dependabot\'s', async () => {
  h.state.pr.user.login = 'hegsie';

  const result = await run(h);
  assert.equal(result.merged, false);
  assert.match(result.reason, /opened by hegsie/);
  assert.equal(h.calls.merged.length, 0);
});

test('refuses a draft', async () => {
  h.state.pr.draft = true;

  assert.equal((await run(h)).merged, false);
  assert.equal(h.calls.merged.length, 0);
});

test('refuses a pull request aimed somewhere other than the default branch', async () => {
  h.state.pr.base.ref = 'release/v0.6.0';

  const result = await run(h);
  assert.match(result.reason, /targets release\/v0\.6\.0/);
  assert.equal(h.calls.merged.length, 0);
});

test('refuses to merge a commit the checks did not run on', async () => {
  h.state.pr.head.sha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  const result = await run(h);
  assert.match(result.reason, /moved to bbbbbbb/);
  assert.equal(h.calls.merged.length, 0);
});

test('waits on a check from another workflow that is still running', async () => {
  h.state.checkRuns.push({ name: 'Build Linux-x64', status: 'in_progress', conclusion: null });

  const result = await run(h);
  assert.match(result.reason, /Build Linux-x64 \(in_progress\)/);
  assert.equal(h.calls.merged.length, 0);
});

test('refuses when any check failed, even though the trigger succeeded', async () => {
  h.state.checkRuns.push({ name: 'Security Audit', status: 'completed', conclusion: 'failure' });

  const result = await run(h);
  assert.match(result.reason, /Security Audit \(failure\)/);
  assert.equal(h.calls.merged.length, 0);
});

test('treats neutral and skipped checks as passing', async () => {
  h.state.checkRuns.push(
    { name: 'Optional', status: 'completed', conclusion: 'neutral' },
    { name: 'E2E Tests', status: 'completed', conclusion: 'skipped' },
  );

  assert.equal((await run(h)).merged, true);
});

test('ignores its own in-progress check run', async () => {
  // Guards the deadlock where the job waits for a check that is itself.
  assert.equal(h.state.checkRuns.some((check) => check.name === 'Auto-merge'), true);
  assert.equal((await run(h)).merged, true);
});

test('a repository with no commit statuses does not read as pending', async () => {
  assert.equal(h.state.combinedStatus.state, 'pending');
  assert.equal((await run(h)).merged, true);
});

test('refuses when a real commit status is failing', async () => {
  h.state.combinedStatus = { state: 'failure', statuses: [{ context: 'legacy/check' }] };

  const result = await run(h);
  assert.match(result.reason, /state "failure"/);
  assert.equal(h.calls.merged.length, 0);
});

test('fails the job loudly when the token cannot merge', async () => {
  h.state.mergeError = Object.assign(new Error('Resource not accessible by integration'), { status: 403 });

  const result = await run(h);
  assert.equal(result.merged, false);
  assert.equal(h.calls.failures.length, 1);
  assert.match(h.calls.failures[0], /DEPENDABOT_AUTOMERGE_TOKEN/);
});

test('stays quiet when the branch went stale between the check and the merge', async () => {
  h.state.mergeError = Object.assign(new Error('Pull Request is not mergeable'), { status: 405 });

  const result = await run(h);
  assert.equal(result.merged, false);
  // Dependabot will rebase and CI will run again, so this is not a failure.
  assert.equal(h.calls.failures.length, 0);
  assert.match(result.reason, /Could not merge #318/);
});

test('refuses when the branch has no single open pull request', async () => {
  h.github.rest.pulls.list = async () => ({ data: [] });

  const result = await run(h);
  assert.match(result.reason, /found 0/);
  assert.equal(h.calls.merged.length, 0);
});

test('the workflow job is named what the self-check filter looks for', () => {
  // If these drift apart the job waits for its own check run and never merges.
  assert.match(WORKFLOW, /^ {4}name: Auto-merge$/m);
});

test('the workflow waits on every workflow that runs against a pull request', () => {
  const runsOnPullRequests = ['ci.yml', 'build.yml'].map((file) => {
    const source = readFileSync(fileURLToPath(new URL(`../workflows/${file}`, import.meta.url)), 'utf8');
    assert.match(source, /^ {2}pull_request:$/m, `${file} should run on pull requests`);
    return /^name:\s*(.+)$/m.exec(source)[1].trim();
  });

  for (const name of runsOnPullRequests) {
    assert.ok(
      WORKFLOW.includes(`\n      - ${name}\n`),
      `${name} runs on pull requests but auto-merge does not wait for it`,
    );
  }
});
