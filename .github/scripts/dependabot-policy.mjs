/**
 * Decides which Dependabot pull requests may merge themselves once CI is green.
 *
 * Dependabot labels a bump by which semver field moved, which is not the same
 * question as whether the bump can break us. Below 1.0.0 both Cargo and npm
 * treat the *minor* field as the compatibility boundary, so 0.22 -> 0.23 is
 * every bit as breaking as 1.x -> 2.x, and Dependabot still calls it
 * "semver-minor". Most of this repo's Rust tree is 0.x — git2, candle,
 * rusqlite, base64 — so that distinction decides the majority of PRs.
 *
 * Everything here is pure so it can be unit tested; the workflow supplies the
 * commit messages and performs the merge.
 */

const TRAILER_KEY = 'updated-dependencies:';

/** A bump CI can be trusted to vet on its own. */
export const COMPATIBLE = 'compatible';
/** A bump that can change behaviour without failing CI. Needs a human. */
export const BREAKING = 'breaking';
/** Metadata we could not read. Treated like `BREAKING`. */
export const UNKNOWN = 'unknown';

function toCamelCase(key) {
  return key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function unquote(value) {
  return value.trim().replace(/^["']|["']$/g, '');
}

/**
 * Reads the `updated-dependencies:` YAML block Dependabot appends to every
 * commit message it writes. A grouped update contributes one entry per
 * dependency.
 */
export function parseUpdatedDependencies(commitMessage) {
  const lines = String(commitMessage ?? '').split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === TRAILER_KEY);
  if (start === -1) return [];

  const entries = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    // The block is a YAML document; `...` closes it, and Dependabot follows it
    // with a blank line and the sign-off.
    if (trimmed === '' || trimmed === '...' || trimmed === '---') break;

    const listItem = line.match(/^\s*-\s+([\w-]+):\s*(.*)$/);
    if (listItem) {
      entries.push({ [toCamelCase(listItem[1])]: unquote(listItem[2]) });
      continue;
    }

    const field = line.match(/^\s+([\w-]+):\s*(.*)$/);
    if (field && entries.length > 0) {
      entries[entries.length - 1][toCamelCase(field[1])] = unquote(field[2]);
      continue;
    }

    break;
  }

  return entries;
}

function parseVersion(raw) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(raw ?? '').trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2] ?? 0) };
}

/**
 * Classifies one `updated-dependencies` entry. `dependencyVersion` is the
 * version being moved *to*, which combined with Dependabot's `updateType` is
 * enough to locate the bump relative to the nearest compatibility boundary.
 */
export function classifyUpdate(entry) {
  const updateType = entry?.updateType;

  if (updateType === 'version-update:semver-major') return BREAKING;

  const version = parseVersion(entry?.dependencyVersion);
  if (!version) return UNKNOWN;

  if (updateType === 'version-update:semver-minor') {
    // 0.22.1 -> 0.23.1: a new compatibility range, not a compatible bump.
    return version.major === 0 ? BREAKING : COMPATIBLE;
  }

  if (updateType === 'version-update:semver-patch') {
    // 0.0.x releases are mutually incompatible; every other patch is safe.
    return version.major === 0 && version.minor === 0 ? BREAKING : COMPATIBLE;
  }

  return UNKNOWN;
}

function describe(update) {
  const name = update.dependencyName ?? 'unknown dependency';
  const version = update.dependencyVersion;
  const target = version ? `${name} -> ${version}` : name;

  if (update.classification === UNKNOWN) {
    return `${target} (could not read Dependabot's update metadata)`;
  }
  if (update.updateType === 'version-update:semver-major') {
    return `${target} (major release)`;
  }
  return `${target} (pre-1.0 release that crosses a compatibility boundary, so it is breaking despite Dependabot calling it ${update.updateType?.replace('version-update:', '') ?? 'compatible'})`;
}

/**
 * Given every commit message on a Dependabot pull request, decides whether it
 * may merge. A grouped update merges only if every dependency in it qualifies.
 */
export function decide(commitMessages) {
  const seen = new Set();
  const updates = [];
  for (const message of commitMessages ?? []) {
    for (const entry of parseUpdatedDependencies(message)) {
      const key = `${entry.dependencyName}@${entry.dependencyVersion}`;
      if (seen.has(key)) continue;
      seen.add(key);
      updates.push({ ...entry, classification: classifyUpdate(entry) });
    }
  }

  if (updates.length === 0) {
    return {
      merge: false,
      updates,
      reason:
        'No Dependabot `updated-dependencies` metadata was found on this pull request, so the update could not be classified.',
    };
  }

  const held = updates.filter((update) => update.classification !== COMPATIBLE);
  if (held.length > 0) {
    return {
      merge: false,
      updates,
      reason: `This update needs a human look before it lands:\n${held
        .map((update) => `- ${describe(update)}`)
        .join('\n')}`,
    };
  }

  return {
    merge: true,
    updates,
    reason: `Every dependency in this update stays inside its current compatibility range:\n${updates
      .map((update) => `- ${update.dependencyName} -> ${update.dependencyVersion}`)
      .join('\n')}`,
  };
}
