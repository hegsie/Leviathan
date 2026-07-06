/**
 * Embedding Index Service Tests
 *
 * Tests the TypeScript service layer for semantic search.
 */

// Track invoked commands
const invokedCommands: Array<{ command: string; args?: unknown }> = [];

type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;

// When set, build_embedding_index waits on this before resolving — lets
// tests overlap builds for different repos
let pendingBuildGate: Promise<void> | null = null;

const mockInvoke: MockInvoke = async (command: string, args?: unknown) => {
  invokedCommands.push({ command, args });

  switch (command) {
    case 'build_embedding_index':
      if (pendingBuildGate) await pendingBuildGate;
      return 42;
    case 'refresh_embedding_index':
      return 5;
    case 'semantic_search':
      return [
        { oid: 'abc123', distance: 0.15, summary: 'Fix auth bug' },
        { oid: 'def456', distance: 0.25, summary: 'Add login feature' },
      ];
    case 'get_embedding_index_status':
      return {
        totalCommits: 100,
        indexedCommits: 100,
        isBuilding: false,
        isReady: true,
        modelDownloaded: true,
      };
    case 'cancel_embedding_build':
      return null;
    case 'is_embedding_model_downloaded':
      return true;
    case 'download_embedding_model':
      return null;
    case 'plugin:notification|is_permission_granted':
      return false;
    default:
      return null;
  }
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => mockInvoke(command, args),
  transformCallback: (() => { let id = 0; return () => id++; })(),
};

import { expect } from '@open-wc/testing';
import { embeddingIndexService } from '../embedding-index.service.ts';

describe('EmbeddingIndexService', () => {
  beforeEach(() => {
    invokedCommands.length = 0;
    pendingBuildGate = null;
  });

  it('builds indexes for DIFFERENT repos concurrently without dropping any', async () => {
    // Regression: a single global "building" flag silently skipped repo B's
    // build while repo A's (slow ONNX) build was in flight, so activating a
    // second tab never got a semantic index.
    let releaseBuilds!: () => void;
    pendingBuildGate = new Promise((resolve) => {
      releaseBuilds = resolve;
    });

    const buildA = embeddingIndexService.buildIndex('/repo/a');
    const buildB = embeddingIndexService.buildIndex('/repo/b');
    releaseBuilds();
    await Promise.all([buildA, buildB]);

    const buildPaths = invokedCommands
      .filter((c) => c.command === 'build_embedding_index')
      .map((c) => (c.args as Record<string, unknown>).path);
    expect(buildPaths).to.have.members(['/repo/a', '/repo/b']);
  });

  it('deduplicates concurrent builds for the SAME repo', async () => {
    let releaseBuilds!: () => void;
    pendingBuildGate = new Promise((resolve) => {
      releaseBuilds = resolve;
    });

    const first = embeddingIndexService.buildIndex('/repo/a');
    const second = embeddingIndexService.buildIndex('/repo/a');
    releaseBuilds();
    await Promise.all([first, second]);

    const buildCalls = invokedCommands.filter((c) => c.command === 'build_embedding_index');
    expect(buildCalls.length).to.equal(1);
  });

  it('cancelBuild clears the in-flight marker so a reopened tab can rebuild immediately', async () => {
    // Regression: close-tab cancels the build but the dedup marker stayed
    // until the cancelled invoke unwound — a quick reopen was deduped
    // against the cancelled build and never got an index.
    let releaseOldBuild!: () => void;
    pendingBuildGate = new Promise((resolve) => {
      releaseOldBuild = resolve;
    });
    const cancelledBuild = embeddingIndexService.buildIndex('/repo/a');
    await embeddingIndexService.cancelBuild('/repo/a'); // tab closed

    pendingBuildGate = null;
    const reopenBuild = embeddingIndexService.buildIndex('/repo/a'); // tab reopened
    releaseOldBuild();
    await Promise.all([cancelledBuild, reopenBuild]);

    const buildCalls = invokedCommands.filter((c) => c.command === 'build_embedding_index');
    expect(buildCalls.length).to.equal(2);
    const cancelCall = invokedCommands.find((c) => c.command === 'cancel_embedding_build');
    expect((cancelCall!.args as Record<string, unknown>).path).to.equal('/repo/a');
  });

  it('allows rebuilding a repo after its previous build finished', async () => {
    await embeddingIndexService.buildIndex('/repo/a');
    await embeddingIndexService.buildIndex('/repo/a');

    const buildCalls = invokedCommands.filter((c) => c.command === 'build_embedding_index');
    expect(buildCalls.length).to.equal(2);
  });

  it('buildIndex invokes build_embedding_index command', async () => {
    await embeddingIndexService.buildIndex('/test/repo');

    const cmd = invokedCommands.find(c => c.command === 'build_embedding_index');
    expect(cmd).to.not.be.undefined;
    expect((cmd!.args as Record<string, unknown>).path).to.equal('/test/repo');
  });

  it('semanticSearch invokes semantic_search command', async () => {
    const results = await embeddingIndexService.semanticSearch('/test/repo', 'auth changes');

    const cmd = invokedCommands.find(c => c.command === 'semantic_search');
    expect(cmd).to.not.be.undefined;
    expect((cmd!.args as Record<string, unknown>).query).to.equal('auth changes');
    expect(results).to.have.length(2);
    expect(results[0].oid).to.equal('abc123');
  });

  it('getStatus invokes get_embedding_index_status command', async () => {
    const status = await embeddingIndexService.getStatus('/test/repo');

    const cmd = invokedCommands.find(c => c.command === 'get_embedding_index_status');
    expect(cmd).to.not.be.undefined;
    expect(status.isReady).to.be.true;
    expect(status.indexedCommits).to.equal(100);
  });

  it('isModelDownloaded invokes is_embedding_model_downloaded command', async () => {
    const downloaded = await embeddingIndexService.isModelDownloaded();

    const cmd = invokedCommands.find(c => c.command === 'is_embedding_model_downloaded');
    expect(cmd).to.not.be.undefined;
    expect(downloaded).to.be.true;
  });

  it('refreshIndex invokes refresh_embedding_index command', async () => {
    await embeddingIndexService.refreshIndex('/test/repo');

    const cmd = invokedCommands.find(c => c.command === 'refresh_embedding_index');
    expect(cmd).to.not.be.undefined;
  });

  it('cancelBuild invokes cancel_embedding_build command', async () => {
    await embeddingIndexService.cancelBuild('/test/repo');

    const cmd = invokedCommands.find(c => c.command === 'cancel_embedding_build');
    expect(cmd).to.not.be.undefined;
  });
});
