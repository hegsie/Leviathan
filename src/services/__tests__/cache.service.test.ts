import { expect } from '@open-wc/testing';
import { LRUCache, createCacheKey, clearAllCaches } from '../cache.service.ts';

describe('cache.service', () => {
  describe('LRUCache', () => {
    it('should create a cache with default options', () => {
      const cache = new LRUCache();
      const stats = cache.getStats();
      expect(stats.maxSize).to.equal(100);
      expect(stats.ttl).to.equal(5 * 60 * 1000);
      expect(stats.size).to.equal(0);
    });

    it('should create a cache with custom options', () => {
      const cache = new LRUCache({ maxSize: 10, ttl: 1000 });
      const stats = cache.getStats();
      expect(stats.maxSize).to.equal(10);
      expect(stats.ttl).to.equal(1000);
    });

    describe('set and get', () => {
      it('should store and retrieve a value', () => {
        const cache = new LRUCache<string>();
        cache.set('key1', 'value1');
        expect(cache.get('key1')).to.equal('value1');
      });

      it('should return undefined for missing key', () => {
        const cache = new LRUCache<string>();
        expect(cache.get('missing')).to.be.undefined;
      });

      it('should overwrite existing value', () => {
        const cache = new LRUCache<string>();
        cache.set('key1', 'old');
        cache.set('key1', 'new');
        expect(cache.get('key1')).to.equal('new');
      });

      it('should store complex objects', () => {
        const cache = new LRUCache<{ a: number; b: string }>();
        cache.set('key1', { a: 1, b: 'hello' });
        const result = cache.get('key1');
        expect(result?.a).to.equal(1);
        expect(result?.b).to.equal('hello');
      });
    });

    describe('has', () => {
      it('should return true for existing key', () => {
        const cache = new LRUCache<string>();
        cache.set('key1', 'value1');
        expect(cache.has('key1')).to.be.true;
      });

      it('should return false for missing key', () => {
        const cache = new LRUCache<string>();
        expect(cache.has('missing')).to.be.false;
      });
    });

    describe('delete', () => {
      it('should remove a cached value', () => {
        const cache = new LRUCache<string>();
        cache.set('key1', 'value1');
        cache.delete('key1');
        expect(cache.get('key1')).to.be.undefined;
        expect(cache.has('key1')).to.be.false;
      });
    });

    describe('clear', () => {
      it('should remove all cached values', () => {
        const cache = new LRUCache<string>();
        cache.set('key1', 'value1');
        cache.set('key2', 'value2');
        cache.clear();
        expect(cache.getStats().size).to.equal(0);
      });
    });

    describe('LRU eviction', () => {
      it('should evict oldest entry when at capacity', () => {
        const cache = new LRUCache<string>({ maxSize: 2, ttl: 60000 });
        cache.set('key1', 'value1');
        cache.set('key2', 'value2');
        cache.set('key3', 'value3');

        expect(cache.get('key1')).to.be.undefined;
        expect(cache.get('key2')).to.equal('value2');
        expect(cache.get('key3')).to.equal('value3');
      });

      it('should move accessed entry to end (most recently used)', () => {
        const cache = new LRUCache<string>({ maxSize: 2, ttl: 60000 });
        cache.set('key1', 'value1');
        cache.set('key2', 'value2');

        // Access key1 to make it most recently used
        cache.get('key1');

        // Add key3, which should evict key2 (now the least recently used)
        cache.set('key3', 'value3');

        expect(cache.get('key1')).to.equal('value1');
        expect(cache.get('key2')).to.be.undefined;
        expect(cache.get('key3')).to.equal('value3');
      });
    });

    describe('TTL expiration', () => {
      it('should expire entries after TTL', async () => {
        const cache = new LRUCache<string>({ maxSize: 10, ttl: 50 });
        cache.set('key1', 'value1');

        // Wait for TTL to expire
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(cache.get('key1')).to.be.undefined;
      });

      it('should report has() as false for expired entries', async () => {
        const cache = new LRUCache<string>({ maxSize: 10, ttl: 50 });
        cache.set('key1', 'value1');

        await new Promise(resolve => setTimeout(resolve, 100));

        expect(cache.has('key1')).to.be.false;
      });
    });

    describe('invalidatePrefix', () => {
      it('should remove entries matching prefix', () => {
        const cache = new LRUCache<string>();
        cache.set('repo1:commit1', 'a');
        cache.set('repo1:commit2', 'b');
        cache.set('repo2:commit1', 'c');

        cache.invalidatePrefix('repo1:');

        expect(cache.get('repo1:commit1')).to.be.undefined;
        expect(cache.get('repo1:commit2')).to.be.undefined;
        expect(cache.get('repo2:commit1')).to.equal('c');
      });

      it('should handle no matching entries', () => {
        const cache = new LRUCache<string>();
        cache.set('key1', 'value1');
        cache.invalidatePrefix('other:');
        expect(cache.get('key1')).to.equal('value1');
      });
    });

    describe('getStats', () => {
      it('should report correct size', () => {
        const cache = new LRUCache<string>();
        cache.set('key1', 'value1');
        cache.set('key2', 'value2');
        expect(cache.getStats().size).to.equal(2);
      });
    });
  });

  describe('createCacheKey', () => {
    it('should create a key from repo path and id', () => {
      const key = createCacheKey('/test/repo', 'abc123');
      expect(key).to.equal('/test/repo:abc123');
    });

    it('should escape colons in repo path', () => {
      const key = createCacheKey('C:/Users/test', 'abc123');
      expect(key).to.equal('C%3A/Users/test:abc123');
    });

    it('should handle paths without colons', () => {
      const key = createCacheKey('/home/user/repo', 'commit-sha');
      expect(key).to.equal('/home/user/repo:commit-sha');
    });
  });

  describe('clearAllCaches', () => {
    it('should not throw', () => {
      expect(() => clearAllCaches()).to.not.throw();
    });
  });
});
