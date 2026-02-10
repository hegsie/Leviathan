import { expect } from '@open-wc/testing';
import type { Tag } from '../../types/git.types.ts';

// Mock Tauri API before importing any modules that use it
const mockInvoke = (_command: string): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

// --- Replicate pure logic from lv-tag-list.ts for testing ---

type TagSortMode = 'name' | 'date' | 'date-asc';

interface TagGroup {
  name: string;
  tags: Tag[];
}

// Helper: create a Tag for testing
function createTag(
  name: string,
  opts: Partial<Tag> = {},
): Tag {
  return {
    name,
    targetOid: opts.targetOid ?? 'abc123',
    message: opts.message ?? null,
    tagger: opts.tagger ?? null,
    isAnnotated: opts.isAnnotated ?? false,
  };
}

// Replicate filterTags logic from lv-tag-list.ts
function filterTags(tags: Tag[], filterText: string): Tag[] {
  if (!filterText) return tags;
  const lower = filterText.toLowerCase();
  return tags.filter((t) => t.name.toLowerCase().includes(lower));
}

// Replicate sortTags logic from lv-tag-list.ts
function sortTags(tags: Tag[], sortMode: TagSortMode): Tag[] {
  return [...tags].sort((a, b) => {
    switch (sortMode) {
      case 'date': {
        const aTime = a.tagger?.timestamp ?? 0;
        const bTime = b.tagger?.timestamp ?? 0;
        if (aTime === 0 && bTime === 0) return a.name.localeCompare(b.name);
        if (aTime === 0) return 1;
        if (bTime === 0) return -1;
        return bTime - aTime;
      }
      case 'date-asc': {
        const aTime = a.tagger?.timestamp ?? 0;
        const bTime = b.tagger?.timestamp ?? 0;
        if (aTime === 0 && bTime === 0) return a.name.localeCompare(b.name);
        if (aTime === 0) return 1;
        if (bTime === 0) return -1;
        return aTime - bTime;
      }
      case 'name':
      default:
        return a.name.localeCompare(b.name);
    }
  });
}

// Replicate groupTags logic from lv-tag-list.ts
function groupTags(tags: Tag[]): TagGroup[] {
  const versionRegex = /^v?(\d+)\./;
  const groupMap = new Map<string, Tag[]>();

  for (const tag of tags) {
    const match = tag.name.match(versionRegex);
    const key = match ? `v${match[1]}.x` : 'Other';
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
    }
    groupMap.get(key)!.push(tag);
  }

  if (groupMap.size <= 1) {
    return [{ name: '', tags }];
  }

  const groups = Array.from(groupMap.entries()).map(([name, tags]) => ({ name, tags }));
  groups.sort((a, b) => {
    if (a.name === 'Other') return 1;
    if (b.name === 'Other') return -1;
    const aNum = parseInt(a.name.replace('v', ''));
    const bNum = parseInt(b.name.replace('v', ''));
    return bNum - aNum;
  });

  return groups;
}

// --- Tests ---

describe('lv-tag-list - filterTags', () => {
  const tags = [
    createTag('v1.0.0'),
    createTag('v1.1.0'),
    createTag('v2.0.0'),
    createTag('release-candidate'),
    createTag('beta-1'),
  ];

  it('returns all tags when filter is empty', () => {
    const result = filterTags(tags, '');
    expect(result.length).to.equal(5);
  });

  it('filters by case-insensitive substring match', () => {
    const result = filterTags(tags, 'V1');
    expect(result.length).to.equal(2);
    expect(result[0].name).to.equal('v1.0.0');
    expect(result[1].name).to.equal('v1.1.0');
  });

  it('filters by partial match', () => {
    const result = filterTags(tags, 'release');
    expect(result.length).to.equal(1);
    expect(result[0].name).to.equal('release-candidate');
  });

  it('returns empty array when no match', () => {
    const result = filterTags(tags, 'nonexistent');
    expect(result.length).to.equal(0);
  });

  it('is case insensitive', () => {
    const result = filterTags(tags, 'BETA');
    expect(result.length).to.equal(1);
    expect(result[0].name).to.equal('beta-1');
  });
});

describe('lv-tag-list - sortTags', () => {
  const annotatedTags = [
    createTag('v2.0.0', { tagger: { name: 'User', email: 'u@e.com', timestamp: 3000 }, isAnnotated: true }),
    createTag('v1.0.0', { tagger: { name: 'User', email: 'u@e.com', timestamp: 1000 }, isAnnotated: true }),
    createTag('v1.5.0', { tagger: { name: 'User', email: 'u@e.com', timestamp: 2000 }, isAnnotated: true }),
  ];

  const mixedTags = [
    createTag('v2.0.0', { tagger: { name: 'User', email: 'u@e.com', timestamp: 3000 }, isAnnotated: true }),
    createTag('v1.0.0'), // lightweight, no tagger
    createTag('v1.5.0', { tagger: { name: 'User', email: 'u@e.com', timestamp: 2000 }, isAnnotated: true }),
    createTag('alpha'), // lightweight, no tagger
  ];

  it('sorts by name alphabetically', () => {
    const result = sortTags(annotatedTags, 'name');
    expect(result[0].name).to.equal('v1.0.0');
    expect(result[1].name).to.equal('v1.5.0');
    expect(result[2].name).to.equal('v2.0.0');
  });

  it('sorts by date newest first', () => {
    const result = sortTags(annotatedTags, 'date');
    expect(result[0].name).to.equal('v2.0.0');
    expect(result[1].name).to.equal('v1.5.0');
    expect(result[2].name).to.equal('v1.0.0');
  });

  it('sorts by date oldest first', () => {
    const result = sortTags(annotatedTags, 'date-asc');
    expect(result[0].name).to.equal('v1.0.0');
    expect(result[1].name).to.equal('v1.5.0');
    expect(result[2].name).to.equal('v2.0.0');
  });

  it('sorts lightweight tags (no tagger) to end when sorting by date', () => {
    const result = sortTags(mixedTags, 'date');
    expect(result[0].name).to.equal('v2.0.0');
    expect(result[1].name).to.equal('v1.5.0');
    // Lightweight tags at end, alphabetically among themselves
    expect(result[2].name).to.equal('alpha');
    expect(result[3].name).to.equal('v1.0.0');
  });

  it('sorts lightweight tags (no tagger) to end when sorting by date-asc', () => {
    const result = sortTags(mixedTags, 'date-asc');
    expect(result[0].name).to.equal('v1.5.0');
    expect(result[1].name).to.equal('v2.0.0');
    // Lightweight tags at end, alphabetically among themselves
    expect(result[2].name).to.equal('alpha');
    expect(result[3].name).to.equal('v1.0.0');
  });

  it('falls back to name when all tags have no dates', () => {
    const lightweightOnly = [
      createTag('beta'),
      createTag('alpha'),
      createTag('gamma'),
    ];
    const result = sortTags(lightweightOnly, 'date');
    expect(result[0].name).to.equal('alpha');
    expect(result[1].name).to.equal('beta');
    expect(result[2].name).to.equal('gamma');
  });
});

describe('lv-tag-list - groupTags', () => {
  it('groups tags by major version', () => {
    const tags = [
      createTag('v1.0.0'),
      createTag('v1.1.0'),
      createTag('v2.0.0'),
      createTag('v2.1.0'),
    ];
    const groups = groupTags(tags);
    expect(groups.length).to.equal(2);
    expect(groups[0].name).to.equal('v2.x');
    expect(groups[0].tags.length).to.equal(2);
    expect(groups[1].name).to.equal('v1.x');
    expect(groups[1].tags.length).to.equal(2);
  });

  it('puts non-semver tags in Other group', () => {
    const tags = [
      createTag('v1.0.0'),
      createTag('release-candidate'),
      createTag('beta'),
    ];
    const groups = groupTags(tags);
    expect(groups.length).to.equal(2);
    expect(groups[0].name).to.equal('v1.x');
    expect(groups[0].tags.length).to.equal(1);
    expect(groups[1].name).to.equal('Other');
    expect(groups[1].tags.length).to.equal(2);
  });

  it('sorts newest major version first, Other last', () => {
    const tags = [
      createTag('v1.0.0'),
      createTag('v3.0.0'),
      createTag('v2.0.0'),
      createTag('nightly'),
    ];
    const groups = groupTags(tags);
    expect(groups[0].name).to.equal('v3.x');
    expect(groups[1].name).to.equal('v2.x');
    expect(groups[2].name).to.equal('v1.x');
    expect(groups[3].name).to.equal('Other');
  });

  it('returns flat list when all tags are in single group', () => {
    const tags = [
      createTag('v1.0.0'),
      createTag('v1.1.0'),
      createTag('v1.2.0'),
    ];
    const groups = groupTags(tags);
    expect(groups.length).to.equal(1);
    expect(groups[0].name).to.equal('');
    expect(groups[0].tags.length).to.equal(3);
  });

  it('returns flat list when all tags are non-versioned', () => {
    const tags = [
      createTag('alpha'),
      createTag('beta'),
      createTag('gamma'),
    ];
    const groups = groupTags(tags);
    expect(groups.length).to.equal(1);
    expect(groups[0].name).to.equal('');
    expect(groups[0].tags.length).to.equal(3);
  });

  it('handles both v-prefixed and non-prefixed versions', () => {
    const tags = [
      createTag('v1.0.0'),
      createTag('1.1.0'),
      createTag('v2.0.0'),
      createTag('2.1.0'),
    ];
    const groups = groupTags(tags);
    expect(groups.length).to.equal(2);
    expect(groups[0].name).to.equal('v2.x');
    expect(groups[0].tags.length).to.equal(2);
    expect(groups[1].name).to.equal('v1.x');
    expect(groups[1].tags.length).to.equal(2);
  });

  it('returns flat list for empty input', () => {
    const groups = groupTags([]);
    expect(groups.length).to.equal(1);
    expect(groups[0].name).to.equal('');
    expect(groups[0].tags.length).to.equal(0);
  });
});
