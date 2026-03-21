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
  private building = false;
  private currentRepoPath: string | null = null;

  /**
   * Build the embedding index for a repository.
   * Non-blocking - meant to be called fire-and-forget.
   */
  async buildIndex(repoPath: string): Promise<void> {
    if (this.building) return;
    this.building = true;

    try {
      const count = await invoke<number>('build_embedding_index', { path: repoPath });
      this.currentRepoPath = repoPath;
      console.log(`[EmbeddingIndex] Built index with ${count} commits`);
    } catch (err) {
      console.warn('[EmbeddingIndex] Failed to build index:', err);
    } finally {
      this.building = false;
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
   * Cancel an in-progress embedding build
   */
  async cancelBuild(repoPath: string): Promise<void> {
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

  /**
   * Invalidate the index (e.g., when switching repos)
   */
  invalidate(): void {
    this.currentRepoPath = null;
  }
}

export const embeddingIndexService = new EmbeddingIndexService();
