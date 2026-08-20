import { decide } from './dependabot-policy.mjs';

/**
 * This job's own check run, which is still in progress while it inspects the
 * head commit. Excluded from the "everything is green" test so it cannot block
 * itself. Must match the `name:` of the job in dependabot-auto-merge.yml.
 */
const SELF_CHECK_NAME = 'Auto-merge';

/** Must match the `name:` at the top of dependabot-auto-merge.yml. */
const SELF_WORKFLOW_NAME = 'Dependabot auto-merge';

/** Identifies the comment this job leaves, so it only ever leaves one. */
const COMMENT_MARKER = '<!-- dependabot-auto-merge -->';

const DEPENDABOT = 'dependabot[bot]';

/** Conclusions that do not stand in the way of a merge. */
const PASSING = new Set(['success', 'neutral', 'skipped']);

/** Events whose workflow runs are the pull request's own checks. */
const PR_EVENTS = new Set(['pull_request', 'pull_request_target']);

/**
 * Merges Dependabot pull requests whose checks have all passed.
 *
 * Called from .github/workflows/dependabot-auto-merge.yml via actions/github-script,
 * which supplies an authenticated Octokit as `github`, the event payload as
 * `context`, and @actions/core as `core`.
 *
 * A `workflow_run` event considers the one pull request whose checks just
 * finished. Any other event (the hourly sweep, or a manual dispatch) considers
 * every open Dependabot pull request, which is what makes a dropped or missing
 * webhook self-correcting rather than a pull request stuck forever.
 */
export async function run({ github, context, core }) {
  const { owner, repo } = context.repo;
  const defaultBranch =
    context.payload.repository?.default_branch ??
    (await github.rest.repos.get({ owner, repo })).data.default_branch;

  const numbers = await candidates({ github, context, owner, repo, defaultBranch });
  if (numbers.length === 0) {
    return finish(core, [{ merged: false, reason: 'No open Dependabot pull request to consider.' }]);
  }

  const results = [];
  for (const number of numbers) {
    results.push(await consider({ github, core, owner, repo, number, defaultBranch }));
  }
  return finish(core, results);
}

async function finish(core, results) {
  for (const result of results) core.info(result.reason);
  await core.summary.addRaw(results.map((result) => result.reason).join('\n\n'), true).write();
  return results;
}

async function candidates({ github, context, owner, repo, defaultBranch }) {
  if (context.eventName === 'workflow_run') {
    const branch = context.payload.workflow_run.head_branch;
    const open = await github.rest.pulls.list({
      owner,
      repo,
      state: 'open',
      head: `${owner}:${branch}`,
    });
    return open.data.map((pr) => pr.number);
  }

  const open = await github.paginate(github.rest.pulls.list, {
    owner,
    repo,
    state: 'open',
    base: defaultBranch,
    per_page: 100,
  });
  return open.filter((pr) => pr.user?.login === DEPENDABOT && !pr.draft).map((pr) => pr.number);
}

async function consider({ github, core, owner, repo, number, defaultBranch }) {
  // Re-read the pull request rather than trusting the list entry: the event may
  // be minutes old by the time this job gets a runner.
  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: number });

  if (pr.user.login !== DEPENDABOT) {
    return { merged: false, reason: `#${number} was opened by ${pr.user.login}, not Dependabot.` };
  }
  if (pr.draft) {
    return { merged: false, reason: `#${number} is a draft.` };
  }
  if (pr.state !== 'open') {
    return { merged: false, reason: `#${number} is ${pr.state}.` };
  }
  if (pr.base.ref !== defaultBranch) {
    return { merged: false, reason: `#${number} targets ${pr.base.ref}, not ${defaultBranch}.` };
  }

  const readiness = await checksAreGreen({ github, owner, repo, sha: pr.head.sha });
  if (!readiness.ready) {
    return { merged: false, reason: `#${number} is not ready: ${readiness.reason}` };
  }

  const commits = await github.paginate(github.rest.pulls.listCommits, {
    owner,
    repo,
    pull_number: number,
    per_page: 100,
  });
  const decision = decide(commits.map((entry) => entry.commit.message));

  if (!decision.merge) {
    await explainOnce({ github, owner, repo, number, reason: decision.reason });
    return { merged: false, reason: `Held #${number}. ${decision.reason}` };
  }

  try {
    await github.rest.pulls.merge({
      owner,
      repo,
      pull_number: number,
      merge_method: 'squash',
      // Refuse to merge anything other than the commit that was tested.
      sha: pr.head.sha,
    });
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      core.setFailed(
        `Not permitted to merge #${number}: ${error.message}. Check that Actions has ` +
          'write access under Settings > Actions > General > Workflow permissions, or supply ' +
          'a DEPENDABOT_AUTOMERGE_TOKEN secret.',
      );
      return { merged: false, reason: `Could not merge #${number}: ${error.message}` };
    }
    // 405 and 409 mean the branch went stale or conflicted between the check
    // and the merge. Dependabot rebases and CI runs again, which comes back here.
    return { merged: false, reason: `Could not merge #${number} right now: ${error.message}` };
  }

  return { merged: true, reason: `Merged #${number}. ${decision.reason}` };
}

/**
 * Decides whether every check on a commit has passed.
 *
 * Workflow runs are the authority for GitHub Actions, because CodeQL is
 * configured through default setup and so has no file in .github/workflows to
 * enumerate. Check runs and commit statuses cover anything reported by another
 * app. Requiring at least one workflow run closes the window just after a push
 * where nothing has registered yet and "no failures" would otherwise be
 * vacuously true.
 */
async function checksAreGreen({ github, owner, repo, sha }) {
  const runs = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
    owner,
    repo,
    head_sha: sha,
    per_page: 100,
  });
  const relevant = runs.filter(
    (workflowRun) => workflowRun.name !== SELF_WORKFLOW_NAME && PR_EVENTS.has(workflowRun.event),
  );

  if (relevant.length === 0) {
    return { ready: false, reason: `no workflow runs have registered for ${sha.slice(0, 7)} yet.` };
  }

  const unfinished = relevant.filter(
    (workflowRun) =>
      !(workflowRun.status === 'completed' && PASSING.has(workflowRun.conclusion)),
  );
  if (unfinished.length > 0) {
    const names = unfinished.map(
      (workflowRun) => `${workflowRun.name} (${workflowRun.conclusion ?? workflowRun.status})`,
    );
    return { ready: false, reason: `waiting on ${names.join(', ')}.` };
  }

  const checkRuns = await github.paginate(github.rest.checks.listForRef, {
    owner,
    repo,
    ref: sha,
    per_page: 100,
  });
  const failing = checkRuns.filter(
    (check) =>
      check.name !== SELF_CHECK_NAME &&
      !(check.status === 'completed' && PASSING.has(check.conclusion)),
  );
  if (failing.length > 0) {
    const names = failing.map((check) => `${check.name} (${check.conclusion ?? check.status})`);
    return { ready: false, reason: `waiting on ${names.join(', ')}.` };
  }

  const { data: combined } = await github.rest.repos.getCombinedStatusForRef({
    owner,
    repo,
    ref: sha,
  });
  // A commit with no statuses at all reports "pending", so only a non-success
  // state with statuses actually present counts against us.
  if (combined.statuses.length > 0 && combined.state !== 'success') {
    return { ready: false, reason: `commit statuses are in state "${combined.state}".` };
  }

  return { ready: true, reason: 'every check passed.' };
}

/**
 * Says why a pull request was held, at most once per pull request. Dependabot
 * rebases often and every rebase re-runs CI, so this would otherwise repeat the
 * same note on every push.
 */
async function explainOnce({ github, owner, repo, number, reason }) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: number,
    per_page: 100,
  });
  if (comments.some((comment) => comment.body?.includes(COMMENT_MARKER))) return;

  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: number,
    body: [
      COMMENT_MARKER,
      '**Not auto-merging this one.** Every check passed, so the build is fine — but this update falls outside the auto-merge policy and wants a human decision.',
      '',
      reason,
      '',
      'Merge it by hand once you have looked it over. The policy lives in `.github/scripts/dependabot-policy.mjs`.',
    ].join('\n'),
  });
}
