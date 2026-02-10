import { expect } from '@open-wc/testing';
import type { FilterPreset, SearchFilter } from '../toolbar/lv-search-bar.ts';

// Mock Tauri API before importing any modules that use it
const mockInvoke = (_command: string): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

const PRESETS_STORAGE_KEY = 'leviathan-search-filter-presets';
const PRESETS_MAX = 10;

/**
 * Helper functions that mirror the component's preset logic
 * for pure unit testing without requiring full component rendering.
 */
function loadPresets(): FilterPreset[] {
  try {
    const stored = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.slice(0, PRESETS_MAX);
      }
    }
  } catch {
    // silently ignore
  }
  return [];
}

let presetIdCounter = 0;
function savePreset(presets: FilterPreset[], name: string, filter: SearchFilter): FilterPreset[] {
  const preset: FilterPreset = {
    id: `preset-${Date.now()}-${presetIdCounter++}`,
    name,
    filter,
  };
  const updated = [preset, ...presets].slice(0, PRESETS_MAX);
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

function deletePreset(presets: FilterPreset[], id: string): FilterPreset[] {
  const updated = presets.filter((p) => p.id !== id);
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

describe('lv-search-bar - filter presets', () => {
  beforeEach(() => {
    localStorage.removeItem(PRESETS_STORAGE_KEY);
  });

  it('should save and load presets from localStorage', () => {
    const filter: SearchFilter = {
      query: 'test',
      author: 'alice',
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
      filePath: 'src/**',
      branch: 'main',
    };

    const presets = savePreset([], 'My Preset', filter);
    expect(presets).to.have.length(1);
    expect(presets[0].name).to.equal('My Preset');
    expect(presets[0].filter).to.deep.equal(filter);

    // Reload from localStorage
    const loaded = loadPresets();
    expect(loaded).to.have.length(1);
    expect(loaded[0].name).to.equal('My Preset');
    expect(loaded[0].filter).to.deep.equal(filter);
  });

  it('should enforce max presets limit', () => {
    const filter: SearchFilter = {
      query: '',
      author: '',
      dateFrom: '',
      dateTo: '',
      filePath: '',
      branch: '',
    };

    let presets: FilterPreset[] = [];
    for (let i = 0; i < 12; i++) {
      presets = savePreset(presets, `Preset ${i}`, filter);
    }

    expect(presets).to.have.length(PRESETS_MAX);
    // Most recent preset should be first
    expect(presets[0].name).to.equal('Preset 11');
  });

  it('should delete a preset by id', () => {
    const filter: SearchFilter = {
      query: 'test',
      author: '',
      dateFrom: '',
      dateTo: '',
      filePath: '',
      branch: '',
    };

    let presets = savePreset([], 'Preset A', filter);
    presets = savePreset(presets, 'Preset B', filter);
    expect(presets).to.have.length(2);

    const idToDelete = presets[0].id;
    presets = deletePreset(presets, idToDelete);
    expect(presets).to.have.length(1);
    expect(presets[0].name).to.equal('Preset A');

    // Verify localStorage is updated
    const loaded = loadPresets();
    expect(loaded).to.have.length(1);
  });

  it('should return empty array when localStorage is empty', () => {
    const loaded = loadPresets();
    expect(loaded).to.deep.equal([]);
  });

  it('should return empty array when localStorage has invalid data', () => {
    localStorage.setItem(PRESETS_STORAGE_KEY, 'not-json');
    const loaded = loadPresets();
    expect(loaded).to.deep.equal([]);
  });

  it('should return empty array when localStorage has non-array JSON', () => {
    localStorage.setItem(PRESETS_STORAGE_KEY, '{"foo": "bar"}');
    const loaded = loadPresets();
    expect(loaded).to.deep.equal([]);
  });

  it('should apply preset filter values correctly', () => {
    const filter: SearchFilter = {
      query: 'search term',
      author: 'bob',
      dateFrom: '2024-06-01',
      dateTo: '2024-06-30',
      filePath: '*.rs',
      branch: 'develop',
    };

    const presets = savePreset([], 'Test Preset', filter);
    const preset = presets[0];

    // Simulates what loadPreset does - applies filter values
    expect(preset.filter.query).to.equal('search term');
    expect(preset.filter.author).to.equal('bob');
    expect(preset.filter.dateFrom).to.equal('2024-06-01');
    expect(preset.filter.dateTo).to.equal('2024-06-30');
    expect(preset.filter.filePath).to.equal('*.rs');
    expect(preset.filter.branch).to.equal('develop');
  });
});
