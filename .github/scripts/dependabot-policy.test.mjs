import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BREAKING,
  COMPATIBLE,
  UNKNOWN,
  classifyUpdate,
  decide,
  parseUpdatedDependencies,
} from './dependabot-policy.mjs';

/** A verbatim commit message from PR #314, trailer and sign-off included. */
const BASE64_COMMIT = `deps(cargo): bump base64 from 0.22.1 to 0.23.1 in /src-tauri

Bumps [base64](https://github.com/marshallpierce/rust-base64) from 0.22.1 to 0.23.1.
- [Changelog](https://github.com/marshallpierce/rust-base64/blob/master/RELEASE-NOTES.md)
- [Commits](https://github.com/marshallpierce/rust-base64/compare/v0.22.1...v0.23.1)

---
updated-dependencies:
- dependency-name: base64
  dependency-version: 0.23.1
  dependency-type: direct:production
  update-type: version-update:semver-minor
...

Signed-off-by: dependabot[bot] <support@github.com>`;

const GROUPED_COMMIT = `deps(npm): bump the dev-dependencies group with 2 updates

Bumps the dev-dependencies group with 2 updates.

---
updated-dependencies:
- dependency-name: typescript-eslint
  dependency-version: 8.67.0
  dependency-type: direct:development
  update-type: version-update:semver-minor
  dependency-group: dev-dependencies
- dependency-name: prettier
  dependency-version: 3.9.7
  dependency-type: direct:development
  update-type: version-update:semver-patch
  dependency-group: dev-dependencies
...

Signed-off-by: dependabot[bot] <support@github.com>`;

function commit({ name, version, updateType }) {
  return [
    `deps: bump ${name}`,
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

test('parses a single-dependency trailer and stops at the closing marker', () => {
  assert.deepEqual(parseUpdatedDependencies(BASE64_COMMIT), [
    {
      dependencyName: 'base64',
      dependencyVersion: '0.23.1',
      dependencyType: 'direct:production',
      updateType: 'version-update:semver-minor',
    },
  ]);
});

test('parses every dependency out of a grouped update', () => {
  const entries = parseUpdatedDependencies(GROUPED_COMMIT);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => entry.dependencyName),
    ['typescript-eslint', 'prettier'],
  );
  assert.equal(entries[1].dependencyGroup, 'dev-dependencies');
});

test('returns nothing for a commit that carries no trailer', () => {
  assert.deepEqual(parseUpdatedDependencies('Fix a bug\n\nNo trailer here.'), []);
  assert.deepEqual(parseUpdatedDependencies(''), []);
  assert.deepEqual(parseUpdatedDependencies(undefined), []);
});

test('a bump within a stable major is compatible', () => {
  assert.equal(
    classifyUpdate({ dependencyVersion: '17.11.0', updateType: 'version-update:semver-minor' }),
    COMPATIBLE,
  );
  assert.equal(
    classifyUpdate({ dependencyVersion: '5.0.15', updateType: 'version-update:semver-patch' }),
    COMPATIBLE,
  );
});

test('a major bump is breaking', () => {
  assert.equal(
    classifyUpdate({ dependencyVersion: '7.0.2', updateType: 'version-update:semver-major' }),
    BREAKING,
  );
  assert.equal(
    classifyUpdate({ dependencyVersion: '4.0.0', updateType: 'version-update:semver-major' }),
    BREAKING,
  );
});

test('a pre-1.0 minor bump is breaking even though Dependabot calls it minor', () => {
  // base64 0.22.1 -> 0.23.1 and candle 0.10.2 -> 0.11.0 both land here.
  assert.equal(
    classifyUpdate({ dependencyVersion: '0.23.1', updateType: 'version-update:semver-minor' }),
    BREAKING,
  );
  assert.equal(
    classifyUpdate({ dependencyVersion: '0.11.0', updateType: 'version-update:semver-minor' }),
    BREAKING,
  );
});

test('a pre-1.0 patch bump is compatible, except below 0.1.0', () => {
  // rusqlite 0.40.1 -> 0.40.2 stays inside the 0.40 range.
  assert.equal(
    classifyUpdate({ dependencyVersion: '0.40.2', updateType: 'version-update:semver-patch' }),
    COMPATIBLE,
  );
  // 0.0.x releases are mutually incompatible under Cargo's rules.
  assert.equal(
    classifyUpdate({ dependencyVersion: '0.0.9', updateType: 'version-update:semver-patch' }),
    BREAKING,
  );
});

test('an action pinned to a bare major still classifies', () => {
  assert.equal(
    classifyUpdate({ dependencyVersion: 'v8', updateType: 'version-update:semver-major' }),
    BREAKING,
  );
  assert.equal(
    classifyUpdate({ dependencyVersion: '4.2.0', updateType: 'version-update:semver-minor' }),
    COMPATIBLE,
  );
});

test('unreadable metadata is never treated as compatible', () => {
  assert.equal(classifyUpdate({}), UNKNOWN);
  assert.equal(classifyUpdate({ dependencyVersion: '1.2.3' }), UNKNOWN);
  assert.equal(
    classifyUpdate({ dependencyVersion: 'not-a-version', updateType: 'version-update:semver-patch' }),
    UNKNOWN,
  );
});

test('decide holds a pull request with no Dependabot metadata', () => {
  const result = decide(['Hand-written commit, no trailer']);
  assert.equal(result.merge, false);
  assert.match(result.reason, /could not be classified/);
});

test('decide merges the compatible bumps from the August batch', () => {
  for (const update of [
    { name: 'glob', version: '0.3.4', updateType: 'patch' },
    { name: 'rusqlite', version: '0.40.2', updateType: 'patch' },
    { name: 'globals', version: '17.11.0', updateType: 'minor' },
    { name: 'zustand', version: '5.0.15', updateType: 'patch' },
    { name: 'typescript-eslint', version: '8.67.0', updateType: 'minor' },
  ]) {
    const result = decide([commit(update)]);
    assert.equal(result.merge, true, `${update.name} should auto-merge`);
  }
});

test('decide holds the bumps from the August batch that needed judgement', () => {
  for (const update of [
    { name: 'base64', version: '0.23.1', updateType: 'minor' },
    { name: 'pem', version: '4.0.0', updateType: 'major' },
    { name: 'candle-transformers', version: '0.11.0', updateType: 'minor' },
    { name: 'typescript', version: '7.0.2', updateType: 'major' },
  ]) {
    const result = decide([commit(update)]);
    assert.equal(result.merge, false, `${update.name} should be held`);
    assert.match(result.reason, new RegExp(update.name));
  }
});

test('decide holds a group when any single member is breaking', () => {
  const result = decide([
    commit({ name: 'globals', version: '17.11.0', updateType: 'minor' }),
    commit({ name: 'base64', version: '0.23.1', updateType: 'minor' }),
  ]);
  assert.equal(result.merge, false);
  assert.match(result.reason, /base64/);
  assert.doesNotMatch(result.reason, /globals/);
});

test('decide merges a grouped update whose members all qualify', () => {
  const result = decide([GROUPED_COMMIT]);
  assert.equal(result.merge, true);
  assert.equal(result.updates.length, 2);
});

test('decide reports each dependency once across a rebased pull request', () => {
  const message = commit({ name: 'glob', version: '0.3.4', updateType: 'patch' });
  const result = decide([message, message]);
  assert.equal(result.merge, true);
  assert.equal(result.updates.length, 1);
});
