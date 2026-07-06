/**
 * Search Index Service
 * Provides fast commit searching via a Rust-side background index.
 * Indexes are per-repository: every open repo can have its own index at the
 * same time, and searching one repo never returns another repo's commits.
 */

import { invokeCommand } from './tauri-api.ts';
import { searchResultCache, createCacheKey } from './cache.service.ts';

export interface IndexedCommit {
  oid: string;
  shortOid: string;
  summary: string;
  messageLower: string;
  authorName: string;
  authorEmail: string;
  authorDate: number;
  parentCount: number;
}

export interface SearchOptions {
  query?: string;
  author?: string;
  dateFrom?: number;
  dateTo?: number;
  limit?: number;
}

class SearchIndexService {
  private readyRepos = new Set<string>();
  // In-flight builds, keyed by path, storing the drop epoch each build
  // started under. Deduplication is epoch-aware: a build started BEFORE the
  // repo was dropped must not block a rebuild after the repo is reopened.
  private buildingRepos = new Map<string, number>();
  // Bumped by drop(); a build/refresh that finishes after its repo was
  // dropped must not resurrect readiness (or leak the backend index) for a
  // closed tab
  private dropEpochs = new Map<string, number>();

  /**
   * Build the search index for a repository.
   * Non-blocking - meant to be called fire-and-forget.
   * Builds for different repositories can run concurrently; only a build for
   * the SAME repository is deduplicated.
   */
  async buildIndex(repoPath: string): Promise<void> {
    const epoch = this.dropEpochs.get(repoPath) ?? 0;
    // Dedupe only builds from the SAME epoch: a pre-drop build still in
    // flight must not block the rebuild for a reopened tab (it will discard
    // itself on completion via the epoch check below).
    if (this.buildingRepos.get(repoPath) === epoch) return;
    this.buildingRepos.set(repoPath, epoch);

    try {
      const result = await invokeCommand<number>('build_search_index', { path: repoPath });
      if ((this.dropEpochs.get(repoPath) ?? 0) !== epoch) {
        // The repo was closed while this build ran. The BACKEND guards its
        // own insert by generation, so it already discarded this stale
        // build (and a reopen build's fresh index is untouched) — nothing to
        // clean up here; just don't mark this closed epoch as ready.
        return;
      }
      if (result.success) {
        this.readyRepos.add(repoPath);
        console.log(`[SearchIndex] Built index for ${repoPath} with ${result.data} commits`);
      } else {
        this.readyRepos.delete(repoPath);
        console.warn('[SearchIndex] Failed to build index:', result.error?.message);
      }
    } finally {
      // Only remove the marker if it still belongs to THIS build — a newer
      // (post-drop) build may have replaced it
      if (this.buildingRepos.get(repoPath) === epoch) {
        this.buildingRepos.delete(repoPath);
      }
    }
  }

  /**
   * Search commits using the repo's index if available, otherwise return null
   * to signal the caller should use the fallback.
   */
  async search(repoPath: string, options: SearchOptions): Promise<IndexedCommit[] | null> {
    // Check cache first
    const cacheKey = createCacheKey(repoPath, `search:${JSON.stringify(options)}`);
    const cached = searchResultCache.get(cacheKey) as IndexedCommit[] | undefined;
    if (cached) return cached;

    if (!this.readyRepos.has(repoPath)) return null;

    const result = await invokeCommand<IndexedCommit[]>('search_index', {
      path: repoPath,
      query: options.query || null,
      author: options.author || null,
      dateFrom: options.dateFrom || null,
      dateTo: options.dateTo || null,
      limit: options.limit || null,
    });

    if (result.success && result.data) {
      searchResultCache.set(cacheKey, result.data);
      return result.data;
    }
    return null;
  }

  /**
   * Refresh a repo's index incrementally after repo-mutating operations
   */
  async refresh(repoPath: string): Promise<void> {
    if (!this.readyRepos.has(repoPath)) return;
    const epoch = this.dropEpochs.get(repoPath) ?? 0;

    const result = await invokeCommand<number>('refresh_search_index', { path: repoPath });
    if ((this.dropEpochs.get(repoPath) ?? 0) !== epoch) {
      // The repo was closed while the refresh ran. The backend guards its
      // reinsert by generation (and discards the stale result), so there is
      // nothing to clean up here.
      return;
    }
    if (result.success) {
      // Invalidate search cache since results may have changed
      searchResultCache.clear();
    } else {
      console.warn('[SearchIndex] Failed to refresh index:', result.error?.message);
    }
  }

  /**
   * Drop a repo's index entirely (e.g., when its tab is closed) so the
   * backend releases the memory.
   */
  async drop(repoPath: string): Promise<void> {
    this.dropEpochs.set(repoPath, (this.dropEpochs.get(repoPath) ?? 0) + 1);
    this.readyRepos.delete(repoPath);
    searchResultCache.clear();
    const result = await invokeCommand<void>('drop_search_index', { path: repoPath });
    if (!result.success) {
      console.warn('[SearchIndex] Failed to drop index:', result.error?.message);
    }
  }

  /**
   * Invalidate readiness state — for one repo if a path is given, for all
   * repos otherwise. The backend index is kept; a later search simply won't
   * use it until buildIndex marks it ready again.
   */
  invalidate(repoPath?: string): void {
    if (repoPath) {
      this.readyRepos.delete(repoPath);
    } else {
      this.readyRepos.clear();
    }
    searchResultCache.clear();
  }

  /**
   * Check if the index is ready — for a specific repo if a path is given,
   * for any repo otherwise.
   */
  isReady(repoPath?: string): boolean {
    if (repoPath) return this.readyRepos.has(repoPath);
    return this.readyRepos.size > 0;
  }
}

export const searchIndexService = new SearchIndexService();
