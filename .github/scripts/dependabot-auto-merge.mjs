import { decide } from './dependabot-policy.mjs';

/**
 * This job's own check run, which is still in progress while it inspects the
 * head commit. Excluded from the "everything is green" test so it cannot block
 * itself. Must match the `name:` of the job in dependabot-auto-merge.yml.
 */
const SELF_CHECK_NAME = 'Auto-merge';

/** Identifies the comment this job leaves, so it only ever leaves one. */
const COMMENT_MARKER = '<!-- dependabot-auto-merge -->';

const DEPENDABOT = 'dependabot[bot]';

/** Check conclusions that do not stand in the way of a merge. */
const PASSING = new Set(['success', 'neutral', 'skipped']);

/**
 * Merges the Dependabot pull request whose checks just finished, if the update
 * is one the policy trusts CI to have vetted on its own.
 *
 * Called from .github/workflows/dependabot-auto-merge.yml via actions/github-script,
 * which supplies an authenticated Octokit as `github`, the event payload as
 * `context`, and @actions/core as `core`.
 */
export async function run({ github, context, core }) {
  const { owner, repo } = context.repo;
  const workflowRun = context.payload.workflow_run;
  const defaultBranch = context.payload.repository.default_branch;
  const branch = workflowRun.head_branch;

  const skip = async (message) => {
    core.info(message);
    await core.summary.addRaw(message, true).write();
    return { merged: false, reason: message };
  };

  const open = await github.rest.pulls.list({
    owner,
    repo,
    state: 'open',
    head: `${owner}:${branch}`,
  });
  if (open.data.length !== 1) {
    return skip(`Expected exactly one open pull request for ${branch}, found ${open.data.length}.`);
  }

  // Re-read the pull request rather than trusting the list entry: the event may
  // be minutes old by the time this job gets a runner.
  const { data: pr } = await github.rest.pulls.get({
    owner,
    repo,
    pull_number: open.data[0].number,
  });

  if (pr.user.login !== DEPENDABOT) {
    return skip(`#${pr.number} was opened by ${pr.user.login}, not Dependabot.`);
  }
  if (pr.draft) {
    return skip(`#${pr.number} is a draft.`);
  }
  if (pr.base.ref !== defaultBranch) {
    return skip(`#${pr.number} targets ${pr.base.ref}, not ${defaultBranch}.`);
  }
  if (pr.head.sha !== workflowRun.head_sha) {
    return skip(
      `#${pr.number} moved to ${pr.head.sha.slice(0, 7)} since these checks ran on ${workflowRun.head_sha.slice(0, 7)}.`,
    );
  }

  // The triggering workflow passed, but a pull request here runs more than one.
  // Every check on the head commit has to be green, not just the one that woke
  // this job.
  const checkRuns = await github.paginate(github.rest.checks.listForRef, {
    owner,
    repo,
    ref: pr.head.sha,
    per_page: 100,
  });
  const unfinished = checkRuns.filter(
    (check) =>
      check.name !== SELF_CHECK_NAME &&
      !(check.status === 'completed' && PASSING.has(check.conclusion)),
  );
  if (unfinished.length > 0) {
    const names = unfinished.map((check) => `${check.name} (${check.conclusion ?? check.status})`);
    return skip(`#${pr.number} still has checks that have not passed: ${names.join(', ')}.`);
  }

  const { data: combined } = await github.rest.repos.getCombinedStatusForRef({
    owner,
    repo,
    ref: pr.head.sha,
  });
  // A repository with no commit statuses at all reports "pending", so only a
  // non-success state with statuses actually present counts against us.
  if (combined.statuses.length > 0 && combined.state !== 'success') {
    return skip(`#${pr.number} has commit statuses in state "${combined.state}".`);
  }

  const commits = await github.paginate(github.rest.pulls.listCommits, {
    owner,
    repo,
    pull_number: pr.number,
    per_page: 100,
  });
  const decision = decide(commits.map((entry) => entry.commit.message));

  if (!decision.merge) {
    core.info(`Holding #${pr.number}: ${decision.reason}`);
    await explainOnce({ github, owner, repo, pr, reason: decision.reason });
    await core.summary.addRaw(`Held #${pr.number}. ${decision.reason}`, true).write();
    return { merged: false, reason: decision.reason };
  }

  core.info(`Merging #${pr.number}: ${decision.reason}`);
  try {
    await github.rest.pulls.merge({
      owner,
      repo,
      pull_number: pr.number,
      merge_method: 'squash',
      // Refuse to merge anything other than the commit that was tested.
      sha: pr.head.sha,
    });
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      core.setFailed(
        `Not permitted to merge #${pr.number}: ${error.message}. Check that Actions has ` +
          'write access under Settings > Actions > General > Workflow permissions, or supply ' +
          'a DEPENDABOT_AUTOMERGE_TOKEN secret.',
      );
      return { merged: false, reason: error.message };
    }
    // 405 and 409 mean the branch went stale or conflicted between the check
    // and the merge. Dependabot rebases and CI runs again, which comes back here.
    return skip(`Could not merge #${pr.number} right now: ${error.message}`);
  }

  await core.summary.addRaw(`Merged #${pr.number}. ${decision.reason}`, true).write();
  return { merged: true, reason: decision.reason };
}

/**
 * Says why a pull request was held, at most once per pull request. Dependabot
 * rebases often and every rebase re-runs CI, so this would otherwise repeat the
 * same note on every push.
 */
async function explainOnce({ github, owner, repo, pr, reason }) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pr.number,
    per_page: 100,
  });
  if (comments.some((comment) => comment.body?.includes(COMMENT_MARKER))) return;

  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: pr.number,
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
