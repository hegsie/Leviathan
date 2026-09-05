/**
 * Git command formatting for the Output panel.
 *
 * Leviathan runs most operations through libgit2 (git2), so there is no `git`
 * process to quote. The panel would otherwise show the IPC command name
 * (`create_commit`, `stage_files`), which tells a user nothing about what git
 * was asked to do. `synthesizeGitCommand` renders the EQUIVALENT command line
 * for the main operations instead.
 *
 * Two properties this module exists to guarantee:
 *
 * 1. **Honesty.** A synthesised line is not a command that ran. Callers mark
 *    these entries (`synthesized: true`) and the panel renders them with a `≈`
 *    and a legend, so the panel never implies a CLI invocation happened.
 * 2. **No secrets.** The IPC layer deliberately logs no arguments at all,
 *    because arguments can carry credentials. Synthesis reads an EXPLICIT,
 *    per-command allowlist of fields — never the whole args object — so a
 *    field like `token` is not merely filtered, it is never read. Everything
 *    that does get rendered is then passed through `redactSecrets` as a safety
 *    net, because a user's own remote URL can carry `user:token@host`.
 */

/**
 * Patterns for anything that looks like a credential.
 *
 * Mirrors `redact_secrets` in `src-tauri/src/utils/command.rs` — the backend
 * scrubs what it captures from real `git` processes, this scrubs what the
 * frontend synthesises. Kept as two implementations on purpose: they run in
 * different runtimes and each must hold on its own.
 */
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Credentials embedded in a URL: https://user:token@host, ssh://user@host.
  // The userinfo goes; the host stays so the line still says which remote.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1***@'],
  // Provider tokens, by their documented prefixes.
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, '***'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '***'],
  [/\bglpat-[A-Za-z0-9_-]{16,}/g, '***'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '***'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '***'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '***'],
  // JSON Web Tokens (three base64url segments).
  [/\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '***'],
  // `Bearer <token>` — matched BEFORE the named-secret rule below, which would
  // otherwise consume the word `Bearer` as `Authorization`'s value and leave
  // the token itself standing.
  [/\bbearer\s+[A-Za-z0-9._\-+/=]{6,}/gi, 'Bearer ***'],
  // Anything explicitly NAMED as a secret, whatever its shape.
  [
    /\b(password|passwd|token|access[_-]?token|api[_-]?key|secret|authorization)([=:]\s*|\s+)\S+/gi,
    '$1=***',
  ],
];

/**
 * Replace anything that looks like a credential with `***`.
 *
 * Applied to every synthesised command line and to every error message before
 * it reaches the Output panel.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Quote an argument so a multi-word value reads as one token. */
function quoteArg(value: string): string {
  if (value === '') return '""';
  if (/[\s"'\\]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

/** A string field, or undefined when absent/blank/of the wrong type. */
function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function bool(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** A `paths: string[]` field, keeping only the entries that really are strings. */
function paths(args: Record<string, unknown>): string[] {
  const value = args['paths'];
  return Array.isArray(value)
    ? value.filter((p): p is string => typeof p === 'string')
    : [];
}

/** `stash@{n}` for an index, falling back to the plain form when absent. */
function stashRef(args: Record<string, unknown>): string {
  const index = num(args, 'index');
  return index === undefined ? 'stash@{0}' : `stash@{${index}}`;
}

/**
 * Builders for the main operations, keyed by IPC command name.
 *
 * Deliberately not exhaustive: the app exposes hundreds of commands, and a
 * half-guessed line is worse than the honest IPC name. Anything absent here
 * falls through to the command name, exactly as before.
 *
 * Each builder returns the argv AFTER `git`, or `undefined` when the arguments
 * it needs are missing (a line built from absent values would be a lie).
 */
const BUILDERS: Record<
  string,
  (args: Record<string, unknown>) => string[] | undefined
> = {
  // --- commit ---
  create_commit: (a) => {
    const argv = ['commit'];
    if (bool(a, 'amend')) argv.push('--amend');
    if (bool(a, 'signCommit')) argv.push('-S');
    if (bool(a, 'allowEmpty')) argv.push('--allow-empty');
    const message = str(a, 'message');
    if (message) argv.push('-m', message);
    return argv;
  },
  amend_commit: (a) => {
    const argv = ['commit', '--amend'];
    if (bool(a, 'resetAuthor')) argv.push('--reset-author');
    if (bool(a, 'signAmend')) argv.push('-S');
    const message = str(a, 'message');
    if (message) argv.push('-m', message);
    else argv.push('--no-edit');
    return argv;
  },
  commit_merge: (a) => {
    const argv = ['commit'];
    const message = str(a, 'message');
    if (message) argv.push('-m', message);
    else argv.push('--no-edit');
    return argv;
  },

  // --- staging ---
  stage_files: (a) => {
    const files = paths(a);
    return files.length > 0 ? ['add', '--', ...files] : ['add', '-A'];
  },
  unstage_files: (a) => {
    const files = paths(a);
    return files.length > 0
      ? ['restore', '--staged', '--', ...files]
      : ['restore', '--staged', '.'];
  },
  discard_changes: (a) => {
    const files = paths(a);
    return files.length > 0 ? ['restore', '--', ...files] : undefined;
  },

  // --- branches / checkout ---
  checkout: (a) => {
    const ref = str(a, 'refName');
    if (!ref) return undefined;
    return bool(a, 'force') ? ['checkout', '--force', ref] : ['checkout', ref];
  },
  checkout_with_autostash: (a) => {
    const ref = str(a, 'refName');
    if (!ref) return undefined;
    // The autostash variant is a checkout wrapped in a stash push/pop; showing
    // the checkout alone would misrepresent what the operation does to the
    // working tree, so spell out all three steps. (`&&` has nothing that needs
    // quoting, so it survives `quoteArg` as the operator it is.)
    return bool(a, 'autoStash')
      ? ['stash', 'push', '&&', 'git', 'checkout', ref, '&&', 'git', 'stash', 'pop']
      : ['checkout', ref];
  },
  create_branch: (a) => {
    const name = str(a, 'name');
    if (!name) return undefined;
    const startPoint = str(a, 'startPoint');
    const argv = bool(a, 'checkout') ? ['checkout', '-b', name] : ['branch', name];
    if (startPoint) argv.push(startPoint);
    return argv;
  },
  delete_branch: (a) => {
    const name = str(a, 'name');
    if (!name) return undefined;
    return ['branch', bool(a, 'force') ? '-D' : '-d', name];
  },
  rename_branch: (a) => {
    const oldName = str(a, 'oldName');
    const newName = str(a, 'newName');
    if (!oldName || !newName) return undefined;
    return ['branch', '-m', oldName, newName];
  },

  // --- merge ---
  merge: (a) => {
    const source = str(a, 'sourceRef');
    if (!source) return undefined;
    const argv = ['merge'];
    if (bool(a, 'noFf')) argv.push('--no-ff');
    if (bool(a, 'squash')) argv.push('--squash');
    const message = str(a, 'message');
    if (message) argv.push('-m', message);
    argv.push(source);
    return argv;
  },
  abort_merge: () => ['merge', '--abort'],

  // --- rebase ---
  rebase: (a) => {
    const onto = str(a, 'onto');
    return onto ? ['rebase', onto] : undefined;
  },
  continue_rebase: () => ['rebase', '--continue'],
  abort_rebase: () => ['rebase', '--abort'],
  skip_rebase_commit: () => ['rebase', '--skip'],

  // --- remote transfer ---
  fetch: (a) => {
    const argv = ['fetch'];
    if (bool(a, 'prune')) argv.push('--prune');
    const remote = str(a, 'remote');
    if (remote) argv.push(remote);
    return argv;
  },
  fetch_all_remotes: (a) => (bool(a, 'prune') ? ['fetch', '--all', '--prune'] : ['fetch', '--all']),
  pull: (a) => {
    const argv = ['pull'];
    if (bool(a, 'rebase')) argv.push('--rebase');
    const remote = str(a, 'remote');
    const branch = str(a, 'branch');
    if (remote) argv.push(remote);
    if (remote && branch) argv.push(branch);
    return argv;
  },
  push: (a) => {
    const argv = ['push'];
    if (bool(a, 'forceWithLease')) argv.push('--force-with-lease');
    else if (bool(a, 'force')) argv.push('--force');
    if (bool(a, 'pushTags')) argv.push('--tags');
    if (bool(a, 'setUpstream')) argv.push('--set-upstream');
    const remote = str(a, 'remote');
    const branch = str(a, 'branch');
    if (remote) argv.push(remote);
    if (remote && branch) argv.push(branch);
    return argv;
  },

  // --- stash ---
  create_stash: (a) => {
    const argv = ['stash', 'push'];
    if (bool(a, 'includeUntracked')) argv.push('--include-untracked');
    const message = str(a, 'message');
    if (message) argv.push('-m', message);
    return argv;
  },
  apply_stash: (a) => [
    'stash',
    bool(a, 'dropAfter') ? 'pop' : 'apply',
    stashRef(a),
  ],
  pop_stash: (a) => ['stash', 'pop', stashRef(a)],
  drop_stash: (a) => ['stash', 'drop', stashRef(a)],

  // --- reset ---
  reset: (a) => {
    const target = str(a, 'targetRef');
    const mode = str(a, 'mode');
    if (!target || !mode) return undefined;
    return ['reset', `--${mode}`, target];
  },

  // --- cherry-pick / revert ---
  cherry_pick: (a) => {
    const oid = str(a, 'commitOid');
    if (!oid) return undefined;
    const argv = ['cherry-pick'];
    if (bool(a, 'noCommit')) argv.push('--no-commit');
    const mainline = num(a, 'mainline');
    if (mainline !== undefined) argv.push('-m', String(mainline));
    argv.push(oid);
    return argv;
  },
  continue_cherry_pick: () => ['cherry-pick', '--continue'],
  abort_cherry_pick: () => ['cherry-pick', '--abort'],
  skip_cherry_pick: () => ['cherry-pick', '--skip'],
  revert: (a) => {
    const oid = str(a, 'commitOid');
    if (!oid) return undefined;
    const argv = ['revert'];
    const mainline = num(a, 'mainline');
    if (mainline !== undefined) argv.push('-m', String(mainline));
    argv.push(oid);
    return argv;
  },
  continue_revert: () => ['revert', '--continue'],
  abort_revert: () => ['revert', '--abort'],
  skip_revert: () => ['revert', '--skip'],

  // --- tags ---
  create_tag: (a) => {
    const name = str(a, 'name');
    if (!name) return undefined;
    const argv = ['tag'];
    const message = str(a, 'message');
    if (message) argv.push('-a', '-m', message);
    argv.push(name);
    const target = str(a, 'target');
    if (target) argv.push(target);
    return argv;
  },
  delete_tag: (a) => {
    const name = str(a, 'name');
    return name ? ['tag', '-d', name] : undefined;
  },
  push_tag: (a) => {
    const name = str(a, 'name');
    if (!name) return undefined;
    const argv = ['push'];
    if (bool(a, 'force')) argv.push('--force');
    argv.push(str(a, 'remote') ?? 'origin', `refs/tags/${name}`);
    return argv;
  },
  delete_remote_tag: (a) => {
    const name = str(a, 'name');
    if (!name) return undefined;
    return ['push', str(a, 'remote') ?? 'origin', '--delete', `refs/tags/${name}`];
  },
};

/**
 * The `git` command line equivalent to an IPC command, or `undefined` when the
 * operation has no synthesis (the caller then shows the IPC command name).
 *
 * The returned line describes what git2 was asked to do — it is NOT a command
 * that ran. Callers must mark it as synthesised.
 */
export function synthesizeGitCommand(
  command: string,
  args?: unknown,
): string | undefined {
  const build = BUILDERS[command];
  if (!build) return undefined;

  const record =
    typeof args === 'object' && args !== null
      ? (args as Record<string, unknown>)
      : {};

  const argv = build(record);
  if (!argv) return undefined;

  return redactSecrets(['git', ...argv.map(quoteArg)].join(' '));
}

/** The operations `synthesizeGitCommand` covers — exported for tests. */
export const SYNTHESIZED_COMMANDS: ReadonlyArray<string> = Object.keys(BUILDERS);
