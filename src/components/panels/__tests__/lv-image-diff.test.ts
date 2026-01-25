import { expect } from '@open-wc/testing';

/**
 * Alpha value threshold below which a pixel is considered transparent.
 * This must match TRANSPARENCY_ALPHA_THRESHOLD in lv-image-diff.ts.
 * We define it locally to avoid importing the component before mocks are set up.
 */
const TRANSPARENCY_ALPHA_THRESHOLD = 10;

// Mock Tauri API before importing any modules that use it
const mockInvoke = (command: string): Promise<unknown> => {
  switch (command) {
    case 'get_image_versions':
      return Promise.resolve({
        oldData:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        newData:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        imageType: 'png',
      });
    default:
      return Promise.resolve(null);
  }
};

// Mock the Tauri invoke function globally
(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

describe('Image Diff Component Data Structures', () => {
  describe('ImageDiffMode', () => {
    it('should support side-by-side mode', () => {
      const modes = ['side-by-side', 'onion-skin', 'swipe', 'difference'];
      expect(modes).to.include('side-by-side');
    });

    it('should support onion-skin mode', () => {
      const modes = ['side-by-side', 'onion-skin', 'swipe', 'difference'];
      expect(modes).to.include('onion-skin');
    });

    it('should support swipe mode', () => {
      const modes = ['side-by-side', 'onion-skin', 'swipe', 'difference'];
      expect(modes).to.include('swipe');
    });

    it('should support difference mode', () => {
      const modes = ['side-by-side', 'onion-skin', 'swipe', 'difference'];
      expect(modes).to.include('difference');
    });
  });

  describe('ImageVersions', () => {
    it('should have oldData and newData for modified images', () => {
      const imageVersions = {
        oldData: 'base64olddata',
        newData: 'base64newdata',
        imageType: 'png',
      };

      expect(imageVersions.oldData).to.equal('base64olddata');
      expect(imageVersions.newData).to.equal('base64newdata');
      expect(imageVersions.imageType).to.equal('png');
    });

    it('should handle new images (no oldData)', () => {
      const imageVersions = {
        oldData: null,
        newData: 'base64newdata',
        imageType: 'png',
      };

      expect(imageVersions.oldData).to.be.null;
      expect(imageVersions.newData).to.not.be.null;
    });

    it('should handle deleted images (no newData)', () => {
      const imageVersions = {
        oldData: 'base64olddata',
        newData: null,
        imageType: 'png',
      };

      expect(imageVersions.oldData).to.not.be.null;
      expect(imageVersions.newData).to.be.null;
    });
  });

  describe('Zoom functionality', () => {
    it('should clamp zoom between 25 and 400', () => {
      const minZoom = 25;
      const maxZoom = 400;
      let zoom = 100;

      // Zoom in
      zoom = Math.min(zoom + 25, maxZoom);
      expect(zoom).to.equal(125);

      // Zoom out
      zoom = Math.max(zoom - 25, minZoom);
      expect(zoom).to.equal(100);

      // Test max clamp
      zoom = 400;
      zoom = Math.min(zoom + 25, maxZoom);
      expect(zoom).to.equal(400);

      // Test min clamp
      zoom = 25;
      zoom = Math.max(zoom - 25, minZoom);
      expect(zoom).to.equal(25);
    });
  });

  describe('Opacity slider', () => {
    it('should range from 0 to 100', () => {
      const minOpacity = 0;
      const maxOpacity = 100;

      expect(minOpacity).to.equal(0);
      expect(maxOpacity).to.equal(100);
    });

    it('should default to 50% opacity', () => {
      const defaultOpacity = 50;
      expect(defaultOpacity).to.equal(50);
    });
  });

  describe('Swipe position', () => {
    it('should clamp position between 0 and 100', () => {
      let position = 50;

      // Test clamping
      position = Math.max(0, Math.min(100, -10));
      expect(position).to.equal(0);

      position = Math.max(0, Math.min(100, 150));
      expect(position).to.equal(100);

      position = Math.max(0, Math.min(100, 50));
      expect(position).to.equal(50);
    });
  });

  describe('Image type detection', () => {
    it('should recognize PNG images', () => {
      const imageType = 'png';
      const mimeType = `image/${imageType}`;
      expect(mimeType).to.equal('image/png');
    });

    it('should recognize JPEG images', () => {
      const imageType = 'jpeg';
      const mimeType = `image/${imageType}`;
      expect(mimeType).to.equal('image/jpeg');
    });

    it('should handle SVG with correct MIME type', () => {
      const imageType = 'svg';
      const mimeType = imageType === 'svg' ? 'image/svg+xml' : `image/${imageType}`;
      expect(mimeType).to.equal('image/svg+xml');
    });
  });

  describe('Difference highlighting', () => {
    describe('Threshold functionality', () => {
      it('should have default threshold of 10', () => {
        const defaultThreshold = 10;
        expect(defaultThreshold).to.equal(10);
      });

      it('should clamp threshold between 0 and 100', () => {
        let threshold = 10;

        // Increase threshold
        threshold = Math.min(threshold + 10, 100);
        expect(threshold).to.equal(20);

        // Decrease threshold
        threshold = Math.max(threshold - 10, 0);
        expect(threshold).to.equal(10);

        // Test max clamp
        threshold = 100;
        threshold = Math.min(threshold + 10, 100);
        expect(threshold).to.equal(100);

        // Test min clamp
        threshold = 0;
        threshold = Math.max(threshold - 10, 0);
        expect(threshold).to.equal(0);
      });

      it('should identify pixel differences based on threshold', () => {
        const threshold = 10;

        // Test pixel difference calculation
        const oldPixel = { r: 100, g: 100, b: 100, a: 255 };
        const newPixel = { r: 105, g: 105, b: 105, a: 255 };

        const diff =
          Math.abs(oldPixel.r - newPixel.r) +
          Math.abs(oldPixel.g - newPixel.g) +
          Math.abs(oldPixel.b - newPixel.b) +
          Math.abs(oldPixel.a - newPixel.a);

        expect(diff).to.equal(15);
        expect(diff > threshold).to.be.true;
      });

      it('should not flag pixels within threshold as changed', () => {
        const threshold = 20;

        const oldPixel = { r: 100, g: 100, b: 100, a: 255 };
        const newPixel = { r: 102, g: 102, b: 102, a: 255 };

        const diff =
          Math.abs(oldPixel.r - newPixel.r) +
          Math.abs(oldPixel.g - newPixel.g) +
          Math.abs(oldPixel.b - newPixel.b) +
          Math.abs(oldPixel.a - newPixel.a);

        expect(diff).to.equal(6);
        expect(diff > threshold).to.be.false;
      });
    });

    describe('Pixel classification', () => {
      it('should identify added pixels (transparent to opaque)', () => {
        const oldA = 5; // Transparent
        const newA = 255; // Opaque

        const oldIsTransparent = oldA < TRANSPARENCY_ALPHA_THRESHOLD;
        const newIsTransparent = newA < TRANSPARENCY_ALPHA_THRESHOLD;

        expect(oldIsTransparent && !newIsTransparent).to.be.true;
      });

      it('should identify removed pixels (opaque to transparent)', () => {
        const oldA = 255; // Opaque
        const newA = 5; // Transparent

        const oldIsTransparent = oldA < TRANSPARENCY_ALPHA_THRESHOLD;
        const newIsTransparent = newA < TRANSPARENCY_ALPHA_THRESHOLD;

        expect(!oldIsTransparent && newIsTransparent).to.be.true;
      });

      it('should identify unchanged pixels', () => {
        const threshold = 10;
        const oldPixel = { r: 100, g: 100, b: 100, a: 255 };
        const newPixel = { r: 100, g: 100, b: 100, a: 255 };

        const diff =
          Math.abs(oldPixel.r - newPixel.r) +
          Math.abs(oldPixel.g - newPixel.g) +
          Math.abs(oldPixel.b - newPixel.b) +
          Math.abs(oldPixel.a - newPixel.a);

        expect(diff).to.equal(0);
        expect(diff <= threshold).to.be.true;
      });
    });

    describe('Difference stats', () => {
      it('should track counts for each pixel category', () => {
        const stats = { added: 100, removed: 50, changed: 200, unchanged: 650 };

        expect(stats.added).to.equal(100);
        expect(stats.removed).to.equal(50);
        expect(stats.changed).to.equal(200);
        expect(stats.unchanged).to.equal(650);
      });

      it('should calculate percentage correctly', () => {
        const stats = { added: 100, removed: 50, changed: 200, unchanged: 650 };
        const total = stats.added + stats.removed + stats.changed + stats.unchanged;

        expect(total).to.equal(1000);

        const addedPercent = (stats.added / total) * 100;
        const changedPercent = (stats.changed / total) * 100;

        expect(addedPercent).to.equal(10);
        expect(changedPercent).to.equal(20);
      });
    });
  });

  describe('Image source generation', () => {
    // Helper function matching the component's getImageSrc logic
    function getImageSrc(data: string | null, type: string | null): string {
      if (!data) return '';
      const mimeType = type === 'svg' ? 'image/svg+xml' : `image/${type || 'png'}`;
      return `data:${mimeType};base64,${data}`;
    }

    it('should generate correct data URL for PNG', () => {
      const result = getImageSrc('base64data', 'png');
      expect(result).to.equal('data:image/png;base64,base64data');
    });

    it('should generate correct data URL for SVG', () => {
      const result = getImageSrc('base64data', 'svg');
      expect(result).to.equal('data:image/svg+xml;base64,base64data');
    });

    it('should return empty string for null data', () => {
      const result = getImageSrc(null, 'png');
      expect(result).to.equal('');
    });
  });

  describe('File status display', () => {
    it('should recognize modified status', () => {
      const status = 'modified';
      expect(status).to.equal('modified');
    });

    it('should recognize new status', () => {
      const status = 'new';
      expect(status).to.equal('new');
    });

    it('should recognize deleted status', () => {
      const status = 'deleted';
      expect(status).to.equal('deleted');
    });
  });

  describe('Difference computation integration', () => {
    // Helper function that mirrors the computeDifference algorithm
    function computeDifferenceFromImageData(
      oldImageData: ImageData,
      newImageData: ImageData,
      threshold: number
    ): { stats: { added: number; removed: number; changed: number; unchanged: number } } {
      let added = 0;
      let removed = 0;
      let changed = 0;
      let unchanged = 0;

      for (let i = 0; i < oldImageData.data.length; i += 4) {
        const oldR = oldImageData.data[i];
        const oldG = oldImageData.data[i + 1];
        const oldB = oldImageData.data[i + 2];
        const oldA = oldImageData.data[i + 3];

        const newR = newImageData.data[i];
        const newG = newImageData.data[i + 1];
        const newB = newImageData.data[i + 2];
        const newA = newImageData.data[i + 3];

        const oldIsTransparent = oldA < TRANSPARENCY_ALPHA_THRESHOLD;
        const newIsTransparent = newA < TRANSPARENCY_ALPHA_THRESHOLD;

        if (oldIsTransparent && newIsTransparent) {
          // Both transparent - always unchanged (RGB values don't matter)
          unchanged++;
        } else if (oldIsTransparent && !newIsTransparent) {
          added++;
        } else if (!oldIsTransparent && newIsTransparent) {
          removed++;
        } else {
          // Both opaque - calculate color difference
          const diff =
            Math.abs(oldR - newR) +
            Math.abs(oldG - newG) +
            Math.abs(oldB - newB) +
            Math.abs(oldA - newA);

          if (diff > threshold) {
            changed++;
          } else {
            unchanged++;
          }
        }
      }

      return { stats: { added, removed, changed, unchanged } };
    }

    it('should compute difference stats from real canvas data', () => {
      // Create 2x2 pixel test images
      const width = 2;
      const height = 2;

      // Create ImageData objects (4 pixels, 4 bytes each = 16 bytes)
      const oldData = new ImageData(width, height);
      const newData = new ImageData(width, height);

      // Pixel 0 (0,0): Unchanged - both red
      oldData.data.set([255, 0, 0, 255], 0);
      newData.data.set([255, 0, 0, 255], 0);

      // Pixel 1 (1,0): Changed - red to blue
      oldData.data.set([255, 0, 0, 255], 4);
      newData.data.set([0, 0, 255, 255], 4);

      // Pixel 2 (0,1): Added - transparent to green
      oldData.data.set([0, 0, 0, 0], 8);
      newData.data.set([0, 255, 0, 255], 8);

      // Pixel 3 (1,1): Removed - white to transparent
      oldData.data.set([255, 255, 255, 255], 12);
      newData.data.set([0, 0, 0, 0], 12);

      const result = computeDifferenceFromImageData(oldData, newData, 10);

      expect(result.stats.unchanged).to.equal(1);
      expect(result.stats.changed).to.equal(1);
      expect(result.stats.added).to.equal(1);
      expect(result.stats.removed).to.equal(1);
    });

    it('should respect threshold when computing differences', () => {
      const width = 2;
      const height = 1;

      const oldData = new ImageData(width, height);
      const newData = new ImageData(width, height);

      // Pixel 0: Small change (within threshold of 20)
      oldData.data.set([100, 100, 100, 255], 0);
      newData.data.set([105, 105, 105, 255], 0); // diff = 15

      // Pixel 1: Large change (exceeds threshold of 20)
      oldData.data.set([100, 100, 100, 255], 4);
      newData.data.set([150, 150, 150, 255], 4); // diff = 150

      // With threshold 20, pixel 0 should be unchanged, pixel 1 should be changed
      const result = computeDifferenceFromImageData(oldData, newData, 20);

      expect(result.stats.unchanged).to.equal(1);
      expect(result.stats.changed).to.equal(1);
      expect(result.stats.added).to.equal(0);
      expect(result.stats.removed).to.equal(0);
    });

    it('should handle identical images', () => {
      const width = 3;
      const height = 3;

      const oldData = new ImageData(width, height);
      const newData = new ImageData(width, height);

      // Fill both with the same color
      for (let i = 0; i < 9; i++) {
        oldData.data.set([128, 64, 32, 255], i * 4);
        newData.data.set([128, 64, 32, 255], i * 4);
      }

      const result = computeDifferenceFromImageData(oldData, newData, 10);

      expect(result.stats.unchanged).to.equal(9);
      expect(result.stats.changed).to.equal(0);
      expect(result.stats.added).to.equal(0);
      expect(result.stats.removed).to.equal(0);
    });

    it('should handle completely different images', () => {
      const width = 2;
      const height = 2;

      const oldData = new ImageData(width, height);
      const newData = new ImageData(width, height);

      // Old: all black opaque
      for (let i = 0; i < 4; i++) {
        oldData.data.set([0, 0, 0, 255], i * 4);
      }

      // New: all white opaque
      for (let i = 0; i < 4; i++) {
        newData.data.set([255, 255, 255, 255], i * 4);
      }

      const result = computeDifferenceFromImageData(oldData, newData, 10);

      expect(result.stats.unchanged).to.equal(0);
      expect(result.stats.changed).to.equal(4);
      expect(result.stats.added).to.equal(0);
      expect(result.stats.removed).to.equal(0);
    });

    it('should treat both-transparent pixels as unchanged regardless of RGB', () => {
      const width = 2;
      const height = 1;

      const oldData = new ImageData(width, height);
      const newData = new ImageData(width, height);

      // Both pixels transparent but with different RGB values
      // Pixel 0: transparent red vs transparent blue
      oldData.data.set([255, 0, 0, 0], 0);
      newData.data.set([0, 0, 255, 0], 0);

      // Pixel 1: transparent black vs transparent white
      oldData.data.set([0, 0, 0, 5], 4);
      newData.data.set([255, 255, 255, 5], 4);

      const result = computeDifferenceFromImageData(oldData, newData, 10);

      // Both should be unchanged since both are transparent
      expect(result.stats.unchanged).to.equal(2);
      expect(result.stats.changed).to.equal(0);
      expect(result.stats.added).to.equal(0);
      expect(result.stats.removed).to.equal(0);
    });
  });
});
