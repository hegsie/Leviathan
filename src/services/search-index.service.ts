/**
 * Search Index Service
 * Provides fast commit searching via a Rust-side background index
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
  private indexReady = false;
  private building = false;
  private currentRepoPath: string | null = null;

  /**
   * Build the search index for a repository.
   * Non-blocking - meant to be called fire-and-forget.
   */
  async buildIndex(repoPath: string): Promise<void> {
    if (this.building) return;
    this.building = true;

    try {
      const result = await invokeCommand<number>('build_search_index', { path: repoPath });
      if (result.success) {
        this.indexReady = true;
        this.currentRepoPath = repoPath;
        console.log(`[SearchIndex] Built index with ${result.data} commits`);
      } else {
        console.warn('[SearchIndex] Failed to build index:', result.error?.message);
        this.indexReady = false;
      }
    } catch (err) {
      console.warn('[SearchIndex] Failed to build index:', err);
      this.indexReady = false;
    } finally {
      this.building = false;
    }
  }

  /**
   * Search commits using the index if available, otherwise return null
   * to signal the caller should use the fallback.
   */
  async search(repoPath: string, options: SearchOptions): Promise<IndexedCommit[] | null> {
    // Check cache first
    const cacheKey = createCacheKey(repoPath, `search:${JSON.stringify(options)}`);
    const cached = searchResultCache.get(cacheKey) as IndexedCommit[] | undefined;
    if (cached) return cached;

    if (!this.indexReady) return null;

    try {
      const result = await invokeCommand<IndexedCommit[]>('search_index', {
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
    } catch {
      return null;
    }
  }

  /**
   * Refresh the index incrementally after repo-mutating operations
   */
  async refresh(repoPath: string): Promise<void> {
    if (!this.indexReady) return;

    try {
      const result = await invokeCommand<number>('refresh_search_index', { path: repoPath });
      if (result.success) {
        // Invalidate search cache since results may have changed
        searchResultCache.clear();
      } else {
        console.warn('[SearchIndex] Failed to refresh index:', result.error?.message);
      }
    } catch (err) {
      console.warn('[SearchIndex] Failed to refresh index:', err);
    }
  }

  /**
   * Invalidate the index (e.g., when switching repos)
   */
  invalidate(): void {
    this.indexReady = false;
    this.currentRepoPath = null;
    searchResultCache.clear();
  }

  /**
   * Check if the index is ready for the given repo
   */
  isReady(repoPath?: string): boolean {
    if (!this.indexReady) return false;
    if (repoPath && this.currentRepoPath !== repoPath) return false;
    return true;
  }
}

export const searchIndexService = new SearchIndexService();
