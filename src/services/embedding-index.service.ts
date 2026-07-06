/**
 * Embedding Index Service
 * Provides semantic commit searching via ONNX-based embeddings
 * and SQLite vector storage on the Rust backend
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface VectorSearchResult {
  oid: string;
  distance: number;
  summary: string;
}

export interface EmbeddingIndexStatus {
  totalCommits: number;
  indexedCommits: number;
  isBuilding: boolean;
  isReady: boolean;
  modelDownloaded: boolean;
}

export interface EmbeddingIndexProgress {
  repoPath: string;
  indexedCount: number;
  totalCount: number;
  percent: number;
}

class EmbeddingIndexService {
  // Builds are tracked per repo: concurrent builds for DIFFERENT repos must
  // both run (a global flag silently dropped every build after the first
  // when several tabs were opened), only a build for the same repo is
  // deduplicated.
  private buildingRepos = new Set<string>();

  /**
   * Build the embedding index for a repository.
   * Non-blocking - meant to be called fire-and-forget.
   */
  async buildIndex(repoPath: string): Promise<void> {
    if (this.buildingRepos.has(repoPath)) return;
    this.buildingRepos.add(repoPath);

    try {
      const count = await invoke<number>('build_embedding_index', { path: repoPath });
      console.log(`[EmbeddingIndex] Built index for ${repoPath} with ${count} commits`);
    } catch (err) {
      console.warn('[EmbeddingIndex] Failed to build index:', err);
    } finally {
      this.buildingRepos.delete(repoPath);
    }
  }

  /**
   * Incrementally refresh the embedding index after repo mutations
   */
  async refreshIndex(repoPath: string): Promise<void> {
    try {
      await invoke<number>('refresh_embedding_index', { path: repoPath });
    } catch (err) {
      console.warn('[EmbeddingIndex] Failed to refresh index:', err);
    }
  }

  /**
   * Perform a semantic search on the embedding index
   */
  async semanticSearch(
    repoPath: string,
    query: string,
    limit?: number,
  ): Promise<VectorSearchResult[]> {
    const results = await invoke<VectorSearchResult[]>('semantic_search', {
      path: repoPath,
      query,
      limit: limit ?? 100,
    });
    return results;
  }

  /**
   * Get the status of the embedding index for a repository
   */
  async getStatus(repoPath: string): Promise<EmbeddingIndexStatus> {
    return invoke<EmbeddingIndexStatus>('get_embedding_index_status', {
      path: repoPath,
    });
  }

  /**
   * Cancel an in-progress embedding build (e.g. the tab was closed).
   * Clears the in-flight marker immediately so a reopened tab can start a
   * fresh build instead of being deduped against the cancelled one.
   */
  async cancelBuild(repoPath: string): Promise<void> {
    this.buildingRepos.delete(repoPath);
    await invoke<void>('cancel_embedding_build', { path: repoPath });
  }

  /**
   * Check if the embedding model is downloaded
   */
  async isModelDownloaded(): Promise<boolean> {
    return invoke<boolean>('is_embedding_model_downloaded');
  }

  /**
   * Download the embedding model
   */
  async downloadModel(): Promise<void> {
    await invoke<void>('download_embedding_model');
  }

  /**
   * Listen for embedding index progress events
   */
  async onProgress(
    callback: (progress: EmbeddingIndexProgress) => void,
  ): Promise<UnlistenFn> {
    return listen<EmbeddingIndexProgress>('embedding-index-progress', (event) => {
      callback(event.payload);
    });
  }

}

export const embeddingIndexService = new EmbeddingIndexService();
