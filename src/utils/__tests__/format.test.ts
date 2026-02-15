import { expect } from '@open-wc/testing';
import {
  formatRelativeTime,
  truncate,
  formatSha,
  formatFileSize,
  pluralize,
} from '../format.ts';

describe('format', () => {
  describe('formatRelativeTime', () => {
    it('should return "just now" for timestamps within the last minute', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(formatRelativeTime(now)).to.equal('just now');
      expect(formatRelativeTime(now - 30)).to.equal('just now');
    });

    it('should return minutes ago for timestamps within the last hour', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(formatRelativeTime(now - 120)).to.equal('2m ago');
      expect(formatRelativeTime(now - 3000)).to.equal('50m ago');
    });

    it('should return hours ago for timestamps within the last day', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(formatRelativeTime(now - 7200)).to.equal('2h ago');
      expect(formatRelativeTime(now - 43200)).to.equal('12h ago');
    });

    it('should return days ago for timestamps within the last week', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(formatRelativeTime(now - 86400)).to.equal('1d ago');
      expect(formatRelativeTime(now - 86400 * 5)).to.equal('5d ago');
    });

    it('should return weeks ago for timestamps within the last month', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(formatRelativeTime(now - 86400 * 14)).to.equal('2w ago');
    });

    it('should return months ago for timestamps within the last year', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(formatRelativeTime(now - 86400 * 60)).to.equal('2mo ago');
    });

    it('should return years ago for old timestamps', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(formatRelativeTime(now - 86400 * 400)).to.equal('1y ago');
    });
  });

  describe('truncate', () => {
    it('should return the original string if shorter than maxLength', () => {
      expect(truncate('hello', 10)).to.equal('hello');
    });

    it('should return the original string if equal to maxLength', () => {
      expect(truncate('hello', 5)).to.equal('hello');
    });

    it('should truncate and add ellipsis if longer than maxLength', () => {
      expect(truncate('hello world', 5)).to.equal('hell…');
    });

    it('should handle empty string', () => {
      expect(truncate('', 5)).to.equal('');
    });

    it('should handle maxLength of 1', () => {
      expect(truncate('hello', 1)).to.equal('…');
    });
  });

  describe('formatSha', () => {
    it('should return first 7 characters by default', () => {
      expect(formatSha('abc1234567890')).to.equal('abc1234');
    });

    it('should accept custom length', () => {
      expect(formatSha('abc1234567890', 4)).to.equal('abc1');
    });

    it('should handle short sha', () => {
      expect(formatSha('abc', 7)).to.equal('abc');
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes', () => {
      expect(formatFileSize(500)).to.equal('500 B');
    });

    it('should format kilobytes', () => {
      expect(formatFileSize(1024)).to.equal('1.0 KB');
    });

    it('should format megabytes', () => {
      expect(formatFileSize(1024 * 1024)).to.equal('1.0 MB');
    });

    it('should format gigabytes', () => {
      expect(formatFileSize(1024 * 1024 * 1024)).to.equal('1.0 GB');
    });

    it('should format zero', () => {
      expect(formatFileSize(0)).to.equal('0 B');
    });

    it('should format fractional KB', () => {
      expect(formatFileSize(1536)).to.equal('1.5 KB');
    });
  });

  describe('pluralize', () => {
    it('should return singular for count of 1', () => {
      expect(pluralize(1, 'file')).to.equal('1 file');
    });

    it('should return plural with s for count > 1', () => {
      expect(pluralize(5, 'file')).to.equal('5 files');
    });

    it('should return plural with s for count of 0', () => {
      expect(pluralize(0, 'file')).to.equal('0 files');
    });

    it('should use custom plural form', () => {
      expect(pluralize(5, 'index', 'indices')).to.equal('5 indices');
    });

    it('should use singular for custom plural with count 1', () => {
      expect(pluralize(1, 'index', 'indices')).to.equal('1 index');
    });
  });
});
