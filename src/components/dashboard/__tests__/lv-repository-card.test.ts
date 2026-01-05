import { expect } from '@open-wc/testing';
import type { Repository, Branch, Remote } from '../../../types/git.types.ts';
import type { IntegrationType, ProfileAssignmentSource } from '../../../types/unified-profile.types.ts';

// Mock Tauri API before importing any modules that use it
const mockInvoke = (_command: string): Promise<unknown> => {
  return Promise.resolve(null);
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

describe('LvRepositoryCard Data Structures', () => {
  const mockRepository: Repository = {
    path: '/Users/test/Projects/my-awesome-project',
    name: 'my-awesome-project',
    isValid: true,
    isBare: false,
    headRef: 'refs/heads/feature/new-feature',
    state: 'clean',
  };

  const mockBranch: Branch = {
    name: 'feature/new-feature',
    shorthand: 'feature/new-feature',
    isHead: true,
    isRemote: false,
    upstream: null,
    targetOid: 'abc123',
    isStale: false,
  };

  const mockRemotes: Remote[] = [
    { name: 'origin', url: 'https://github.com/user/my-awesome-project.git', pushUrl: null },
    { name: 'upstream', url: 'https://github.com/org/my-awesome-project.git', pushUrl: null },
  ];

  describe('Repository type', () => {
    it('should have path field', () => {
      expect(mockRepository.path).to.equal('/Users/test/Projects/my-awesome-project');
    });

    it('should have name field', () => {
      expect(mockRepository.name).to.equal('my-awesome-project');
    });
  });

  describe('Branch type', () => {
    it('should have name field', () => {
      expect(mockBranch.name).to.equal('feature/new-feature');
    });

    it('should have isHead field', () => {
      expect(mockBranch.isHead).to.be.true;
    });
  });

  describe('Remote type', () => {
    it('should have name field', () => {
      expect(mockRemotes[0].name).to.equal('origin');
    });

    it('should have url field', () => {
      expect(mockRemotes[0].url).to.include('github.com');
    });
  });

  describe('provider detection from URL', () => {
    function detectProvider(url: string): IntegrationType | null {
      const lowerUrl = url.toLowerCase();
      if (lowerUrl.includes('github.com')) return 'github';
      if (lowerUrl.includes('gitlab.com') || lowerUrl.includes('gitlab')) return 'gitlab';
      if (lowerUrl.includes('dev.azure.com') || lowerUrl.includes('visualstudio.com')) return 'azure-devops';
      if (lowerUrl.includes('bitbucket.org') || lowerUrl.includes('bitbucket')) return 'bitbucket';
      return null;
    }

    it('should detect GitHub from github.com URL', () => {
      expect(detectProvider('https://github.com/user/repo.git')).to.equal('github');
    });

    it('should detect GitHub from SSH URL', () => {
      expect(detectProvider('git@github.com:user/repo.git')).to.equal('github');
    });

    it('should detect GitLab from gitlab.com URL', () => {
      expect(detectProvider('https://gitlab.com/user/repo.git')).to.equal('gitlab');
    });

    it('should detect GitLab from self-hosted URL', () => {
      expect(detectProvider('https://gitlab.company.com/user/repo.git')).to.equal('gitlab');
    });

    it('should detect Azure DevOps from dev.azure.com URL', () => {
      expect(detectProvider('https://dev.azure.com/org/project/_git/repo')).to.equal('azure-devops');
    });

    it('should detect Azure DevOps from visualstudio.com URL', () => {
      expect(detectProvider('https://org.visualstudio.com/project/_git/repo')).to.equal('azure-devops');
    });

    it('should detect Bitbucket from bitbucket.org URL', () => {
      expect(detectProvider('https://bitbucket.org/user/repo.git')).to.equal('bitbucket');
    });

    it('should return null for unknown provider', () => {
      expect(detectProvider('https://unknown-git-host.com/repo.git')).to.be.null;
    });
  });

  describe('assignment source labels', () => {
    function getAssignmentLabel(source: ProfileAssignmentSource): string {
      switch (source) {
        case 'manual':
          return 'Profile manually assigned';
        case 'url-pattern':
          return 'Profile matched by URL pattern';
        case 'default':
          return 'Using default profile';
        default:
          return '';
      }
    }

    it('should return correct label for manual', () => {
      expect(getAssignmentLabel('manual')).to.include('manually');
    });

    it('should return correct label for url-pattern', () => {
      expect(getAssignmentLabel('url-pattern')).to.include('URL pattern');
    });

    it('should return correct label for default', () => {
      expect(getAssignmentLabel('default')).to.include('default');
    });

    it('should return empty string for none', () => {
      expect(getAssignmentLabel('none')).to.equal('');
    });
  });

  describe('path truncation', () => {
    function truncatePath(path: string, maxLength: number = 40): string {
      if (path.length <= maxLength) return path;

      const parts = path.split('/');
      let result = parts[parts.length - 1];
      let i = parts.length - 2;

      while (i >= 0 && result.length + parts[i].length + 1 < maxLength - 3) {
        result = parts[i] + '/' + result;
        i--;
      }

      return '...' + (result.startsWith('/') ? '' : '/') + result;
    }

    it('should not truncate short paths', () => {
      const shortPath = '/Users/test/project';
      expect(truncatePath(shortPath)).to.equal(shortPath);
    });

    it('should truncate long paths', () => {
      const longPath = '/Users/developer/Documents/Projects/Company/Team/Category/my-very-long-project-name';
      const truncated = truncatePath(longPath);
      expect(truncated).to.include('...');
      expect(truncated.length).to.be.lessThanOrEqual(43); // maxLength + 3 for ellipsis
    });

    it('should preserve the last directory', () => {
      const longPath = '/Users/developer/Documents/Projects/Company/Team/Category/my-project';
      const truncated = truncatePath(longPath);
      expect(truncated).to.include('my-project');
    });
  });

  describe('remote selection', () => {
    function getPrimaryRemote(remotes: Remote[]): Remote | undefined {
      return remotes.find((r) => r.name === 'origin') || remotes[0];
    }

    it('should prefer origin remote', () => {
      const primary = getPrimaryRemote(mockRemotes);
      expect(primary?.name).to.equal('origin');
    });

    it('should fall back to first remote if no origin', () => {
      const remotesWithoutOrigin: Remote[] = [
        { name: 'upstream', url: 'https://github.com/org/repo.git', pushUrl: null },
        { name: 'fork', url: 'https://github.com/user/repo.git', pushUrl: null },
      ];
      const primary = getPrimaryRemote(remotesWithoutOrigin);
      expect(primary?.name).to.equal('upstream');
    });

    it('should return undefined for empty remotes', () => {
      const primary = getPrimaryRemote([]);
      expect(primary).to.be.undefined;
    });
  });
});
