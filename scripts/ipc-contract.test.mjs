/**
 * IPC contract test.
 *
 * Every Playwright spec runs against the Tauri mock in `e2e/fixtures/tauri-mock.ts`
 * and the unit tests stub `invoke`, so nothing else in this repository checks
 * that the command names the frontend sends actually exist on the Rust side. A
 * name that drifts — renamed in Rust, invented on the frontend, or dropped from
 * `generate_handler!` — passes every other test and fails only in a real build.
 *
 * This test compares the two halves directly:
 *   - fails when the frontend invokes a command the backend does not register
 *   - fails when a command name is computed at runtime and not allowlisted,
 *     because such a name cannot be checked
 *   - reports (without failing) backend commands nothing on the frontend calls;
 *     those are legitimate for the MCP server or for callers inside Rust
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  BACKEND_LIB_RS,
  DYNAMIC_ALLOWLIST,
  blankComments,
  compareContracts,
  extractFrontendContract,
  extractInvocations,
  parseHandlerList,
} from './ipc-contract.mjs';

// ---------------------------------------------------------------------------
// Frontend extraction
// ---------------------------------------------------------------------------

test('extracts command names from every invoke wrapper and quote style', () => {
  const source = `
import { invoke } from '@tauri-apps/api/core';

await invokeCommand<Branch[]>("get_branches", { path });
await invokeCommand<void>('checkout', { path, name });
await invokeProviderCommand<Pr[]>("list_pull_requests", { token });
await invoke<number>('build_embedding_index', { path });
await invokeCommand<MultiPushResult>(
  "push_multiple",
  { path, remotes },
);
`;
  const { literals, dynamic } = extractInvocations(source, 'src/x.ts');

  assert.deepEqual(
    literals.map((l) => l.command),
    [
      'get_branches',
      'checkout',
      'list_pull_requests',
      'build_embedding_index',
      'push_multiple',
    ]
  );
  assert.deepEqual(dynamic, []);
});

test('reports accurate file and line for each call site', () => {
  const source = ['', '// a comment', 'invokeCommand("get_status", { path });'].join(
    '\n'
  );
  const { literals } = extractInvocations(source, 'src/services/git.service.ts');

  assert.deepEqual(literals, [
    { command: 'get_status', file: 'src/services/git.service.ts', line: 3 },
  ]);
});

test('ignores invoke mentions in comments and wrapper declarations', () => {
  const source = `
// invokeCommand("not_a_real_command") is only mentioned here
/* invokeCommand('also_not_real', {}) */
export async function invokeCommand<T, A = unknown>(command: string, args?: A) {
  return null;
}
`;
  const { literals, dynamic } = extractInvocations(source, 'src/x.ts');

  assert.deepEqual(literals, []);
  assert.deepEqual(dynamic, []);
});

test('ignores unrelated methods named invoke', () => {
  const source = `
someObject.invoke('not_a_tauri_command');
await invoke('also_not_tauri');
`;
  const { literals, dynamic } = extractInvocations(source, 'src/x.ts');

  // No `@tauri-apps/api/core` import, so neither call is a Tauri command.
  assert.deepEqual(literals, []);
  assert.deepEqual(dynamic, []);
});

test('reports a computed command name as dynamic instead of skipping it', () => {
  const source = `
await invokeCommand<T>(command, args);
await invokeCommand(\`get_\${kind}_list\`, { path });
await invokeCommands([{ command: 'a' }, { command: 'b' }]);
`;
  const { literals, dynamic } = extractInvocations(source, 'src/x.ts');

  assert.deepEqual(literals, []);
  assert.deepEqual(
    dynamic.map((d) => d.expression),
    ['command', '`get_${kind}_list`', "[{ command: 'a' }, { command: 'b' }]"]
  );
});

test('blankComments preserves offsets and leaves string contents alone', () => {
  const source = 'const a = "// not a comment"; // real comment\nnext';
  const blanked = blankComments(source);

  assert.equal(blanked.length, source.length);
  assert.ok(blanked.includes('"// not a comment"'));
  assert.ok(!blanked.includes('real comment'));
  assert.equal(blanked.split('\n').length, source.split('\n').length);
});

// ---------------------------------------------------------------------------
// Backend extraction
// ---------------------------------------------------------------------------

test('parseHandlerList normalises module paths and drops comments', () => {
  const rust = `
    .invoke_handler(tauri::generate_handler![
        // Repository
        commands::repository::open_repository,
        commands::branch::create_branch,
        /* inline */ standalone_command,
    ])
`;

  assert.deepEqual(parseHandlerList(rust), [
    'open_repository',
    'create_branch',
    'standalone_command',
  ]);
});

test('parseHandlerList fails loudly rather than returning a partial list', () => {
  assert.throws(
    () => parseHandlerList('fn main() {}'),
    /No generate_handler/,
    'a lib.rs without a handler list must fail, not silently pass the contract'
  );
  assert.throws(
    () => parseHandlerList('generate_handler![a, b'),
    /Unterminated/
  );
  assert.throws(
    () => parseHandlerList('generate_handler![a b]'),
    /Unparseable entry/
  );
});

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

test('compareContracts separates missing commands from backend-only ones', () => {
  const frontend = new Map([
    ['get_status', [{ file: 'src/a.ts', line: 1 }]],
    ['ghost_command', [{ file: 'src/b.ts', line: 9 }]],
  ]);
  const result = compareContracts(frontend, [
    'get_status',
    'mcp_only_command',
    'get_status',
  ]);

  assert.deepEqual(
    result.missingInBackend.map((m) => m.command),
    ['ghost_command']
  );
  assert.deepEqual(result.backendOnly, ['mcp_only_command']);
  assert.deepEqual(result.duplicateHandlers, ['get_status']);
});

// ---------------------------------------------------------------------------
// The contract itself
// ---------------------------------------------------------------------------

const frontend = extractFrontendContract();
const backend = parseHandlerList(readFileSync(BACKEND_LIB_RS, 'utf8'));
const contract = compareContracts(frontend.commands, backend);

test('both halves of the contract were actually parsed', () => {
  // Guards against a parser regression quietly turning this file into a no-op.
  assert.ok(
    frontend.commands.size > 200,
    `only ${frontend.commands.size} frontend commands found — the extractor is probably broken`
  );
  assert.ok(
    backend.length > 200,
    `only ${backend.length} backend handlers found — the extractor is probably broken`
  );
});

test('every command the frontend invokes is registered in generate_handler!', () => {
  const details = contract.missingInBackend
    .map(({ command, sites }) => {
      const where = sites.map((s) => `${s.file}:${s.line}`).join('\n        ');
      return `  - "${command}"\n      called from: ${where}\n      MISSING ON THE BACKEND: not in tauri::generate_handler![...] in src-tauri/src/lib.rs`;
    })
    .join('\n');

  assert.equal(
    contract.missingInBackend.length,
    0,
    `IPC contract drift: the frontend invokes ${contract.missingInBackend.length} command(s) the Rust backend does not register.\n` +
      'Each one fails at runtime with "Command <name> not found" the moment a user triggers it.\n' +
      `${details}\n` +
      'Fix: register the #[tauri::command] in tauri::generate_handler![...] (src-tauri/src/lib.rs), ' +
      'or correct the name at the frontend call site.'
  );
});

test('no command is registered twice in generate_handler!', () => {
  assert.deepEqual(
    contract.duplicateHandlers,
    [],
    `Duplicate entries in tauri::generate_handler![...] (src-tauri/src/lib.rs): ${contract.duplicateHandlers.join(', ')}`
  );
});

test('every computed command name is covered by the dynamic allowlist', () => {
  const unexpected = frontend.dynamic.filter(
    (site) =>
      !DYNAMIC_ALLOWLIST.some(
        (allowed) =>
          allowed.file === site.file && allowed.expression === site.expression
      )
  );

  const details = unexpected
    .map(
      (site) =>
        `  - ${site.file}:${site.line} invokes a command named by the expression \`${site.expression}\``
    )
    .join('\n');

  assert.equal(
    unexpected.length,
    0,
    'IPC contract cannot be verified: these call sites build the command name at runtime, ' +
      'so this test cannot check them against the backend.\n' +
      `${details}\n` +
      'Fix: pass a string literal, or — if this is a wrapper whose callers pass literals — ' +
      'add it to DYNAMIC_ALLOWLIST in scripts/ipc-contract.mjs with a reason.'
  );
});

test('the dynamic allowlist has no stale entries', () => {
  const stale = DYNAMIC_ALLOWLIST.filter(
    (allowed) =>
      !frontend.dynamic.some(
        (site) =>
          site.file === allowed.file && site.expression === allowed.expression
      )
  );

  assert.deepEqual(
    stale.map((s) => `${s.file} (${s.expression})`),
    [],
    'DYNAMIC_ALLOWLIST in scripts/ipc-contract.mjs lists call sites that no longer exist — remove them.'
  );
});

test('backend commands with no frontend caller (informational)', () => {
  // NOT a failure: commands may exist for the MCP server, be invoked from Rust,
  // or be kept for compatibility. Printed so drift can be reviewed on purpose.
  console.log(
    `\n  ${contract.backendOnly.length} registered command(s) have no frontend caller:`
  );
  for (const command of contract.backendOnly) {
    console.log(`    - ${command}`);
  }
  console.log(
    `  (${frontend.commands.size} frontend commands / ${backend.length} registered handlers)\n`
  );
  assert.ok(Array.isArray(contract.backendOnly));
});
