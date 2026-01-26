/**
 * Cache Service
 * Simple LRU cache for frequently accessed data
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  accessCount: number;
}

export interface CacheOptions {
  /** Maximum number of entries to store */
  maxSize: number;
  /** Time-to-live in milliseconds (default: 5 minutes) */
  ttl: number;
}

const DEFAULT_OPTIONS: CacheOptions = {
  maxSize: 100,
  ttl: 5 * 60 * 1000, // 5 minutes
};

/**
 * Generic LRU cache with TTL support
 */
export class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private options: CacheOptions;

  constructor(options: Partial<CacheOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Get a cached value
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > this.options.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    // Update access count and move to end (most recently used)
    entry.accessCount++;
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.data;
  }

  /**
   * Set a cached value
   */
  set(key: string, data: T): void {
    // Remove if already exists (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest entries if at capacity
    while (this.cache.size >= this.options.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }

    // Add new entry
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      accessCount: 1,
    });
  }

  /**
   * Check if a key exists and is valid
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check TTL
    if (Date.now() - entry.timestamp > this.options.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a cached value
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cached values
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; ttl: number } {
    return {
      size: this.cache.size,
      maxSize: this.options.maxSize,
      ttl: this.options.ttl,
    };
  }

  /**
   * Invalidate entries matching a prefix
   */
  invalidatePrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }
}

// Singleton caches for different data types
export const commitStatsCache = new LRUCache<{ additions: number; deletions: number; filesChanged: number }>({
  maxSize: 500,
  ttl: 10 * 60 * 1000, // 10 minutes
});

export const commitSignatureCache = new LRUCache<unknown>({
  maxSize: 500,
  ttl: 30 * 60 * 1000, // 30 minutes (signatures don't change)
});

export const fileContentCache = new LRUCache<string>({
  maxSize: 50,
  ttl: 2 * 60 * 1000, // 2 minutes
});

export const diffCache = new LRUCache<unknown>({
  maxSize: 30,
  ttl: 5 * 60 * 1000, // 5 minutes
});

/**
 * Escape repository path for use in cache keys.
 * Colons are URL-encoded so they don't conflict with our key separator.
 */
function escapeRepoPath(repoPath: string): string {
  return repoPath.replace(/:/g, '%3A');
}

/**
 * Create a cache key from repository path and identifier.
 * Uses escaped repo path to avoid key collisions from paths containing colons.
 */
export function createCacheKey(repoPath: string, id: string): string {
  return `${escapeRepoPath(repoPath)}:${id}`;
}

/**
 * Invalidate all caches for a repository
 */
export function invalidateRepositoryCache(repoPath: string): void {
  const prefix = escapeRepoPath(repoPath) + ':';
  commitStatsCache.invalidatePrefix(prefix);
  commitSignatureCache.invalidatePrefix(prefix);
  fileContentCache.invalidatePrefix(prefix);
  diffCache.invalidatePrefix(prefix);
}

/**
 * Clear all caches
 */
export function clearAllCaches(): void {
  commitStatsCache.clear();
  commitSignatureCache.clear();
  fileContentCache.clear();
  diffCache.clear();
}
