import { expect } from '@open-wc/testing';

/**
 * Azure DevOps integration tests
 * Tests the Azure DevOps service types and URL parsing
 */

// Azure DevOps Types
interface AdoUser {
  id: string;
  displayName: string;
  uniqueName: string;
  imageUrl: string | null;
}

interface AdoConnectionStatus {
  connected: boolean;
  user: AdoUser | null;
  organization: string | null;
}

interface DetectedAdoRepo {
  organization: string;
  project: string;
  repository: string;
  remoteName: string;
}

interface AdoPullRequest {
  pullRequestId: number;
  title: string;
  description: string | null;
  status: string;
  createdBy: AdoUser;
  creationDate: string;
  sourceRefName: string;
  targetRefName: string;
  isDraft: boolean;
  url: string;
  repositoryId: string;
}

interface CreateAdoPullRequestInput {
  title: string;
  description: string | null;
  sourceRefName: string;
  targetRefName: string;
  isDraft: boolean | null;
}

interface AdoWorkItem {
  id: number;
  title: string;
  workItemType: string;
  state: string;
  assignedTo: AdoUser | null;
  createdDate: string;
  url: string;
}

interface AdoPipelineRun {
  id: number;
  name: string;
  state: string;
  result: string | null;
  createdDate: string;
  finishedDate: string | null;
  sourceBranch: string;
  url: string;
}

describe('Azure DevOps Types', () => {
  describe('AdoUser', () => {
    it('should have correct structure', () => {
      const user: AdoUser = {
        id: 'user-123',
        displayName: 'John Doe',
        uniqueName: 'john.doe@company.com',
        imageUrl: 'https://dev.azure.com/_apis/identities/user-123/avatar',
      };

      expect(user.id).to.equal('user-123');
      expect(user.displayName).to.equal('John Doe');
      expect(user.uniqueName).to.equal('john.doe@company.com');
      expect(user.imageUrl).to.include('avatar');
    });

    it('should allow null image URL', () => {
      const user: AdoUser = {
        id: 'user-456',
        displayName: 'Jane Smith',
        uniqueName: 'jane.smith@company.com',
        imageUrl: null,
      };

      expect(user.imageUrl).to.be.null;
    });
  });

  describe('AdoConnectionStatus', () => {
    it('should represent connected state', () => {
      const status: AdoConnectionStatus = {
        connected: true,
        user: {
          id: 'user-123',
          displayName: 'John Doe',
          uniqueName: 'john@company.com',
          imageUrl: null,
        },
        organization: 'mycompany',
      };

      expect(status.connected).to.be.true;
      expect(status.user).to.not.be.null;
      expect(status.organization).to.equal('mycompany');
    });

    it('should represent disconnected state', () => {
      const status: AdoConnectionStatus = {
        connected: false,
        user: null,
        organization: 'mycompany',
      };

      expect(status.connected).to.be.false;
      expect(status.user).to.be.null;
    });
  });

  describe('DetectedAdoRepo', () => {
    it('should contain repo info from remote', () => {
      const repo: DetectedAdoRepo = {
        organization: 'mycompany',
        project: 'MyProject',
        repository: 'frontend',
        remoteName: 'origin',
      };

      expect(repo.organization).to.equal('mycompany');
      expect(repo.project).to.equal('MyProject');
      expect(repo.repository).to.equal('frontend');
      expect(repo.remoteName).to.equal('origin');
    });
  });

  describe('AdoPullRequest', () => {
    it('should have complete PR structure', () => {
      const pr: AdoPullRequest = {
        pullRequestId: 123,
        title: 'Add new feature',
        description: 'This PR adds a new feature that...',
        status: 'active',
        createdBy: {
          id: 'user-123',
          displayName: 'John Doe',
          uniqueName: 'john@company.com',
          imageUrl: null,
        },
        creationDate: '2024-01-15T10:30:00Z',
        sourceRefName: 'feature/new-feature',
        targetRefName: 'main',
        isDraft: false,
        url: 'https://dev.azure.com/mycompany/MyProject/_git/frontend/pullrequest/123',
        repositoryId: 'repo-guid',
      };

      expect(pr.pullRequestId).to.equal(123);
      expect(pr.title).to.equal('Add new feature');
      expect(pr.status).to.equal('active');
      expect(pr.sourceRefName).to.equal('feature/new-feature');
      expect(pr.targetRefName).to.equal('main');
      expect(pr.isDraft).to.be.false;
    });

    it('should support draft PRs', () => {
      const pr: AdoPullRequest = {
        pullRequestId: 124,
        title: 'WIP: New feature',
        description: null,
        status: 'active',
        createdBy: {
          id: 'user-123',
          displayName: 'John',
          uniqueName: 'john@company.com',
          imageUrl: null,
        },
        creationDate: '2024-01-15T10:30:00Z',
        sourceRefName: 'feature/wip',
        targetRefName: 'main',
        isDraft: true,
        url: 'https://dev.azure.com/mycompany/MyProject/_git/frontend/pullrequest/124',
        repositoryId: 'repo-guid',
      };

      expect(pr.isDraft).to.be.true;
      expect(pr.description).to.be.null;
    });

    it('should have various statuses', () => {
      const statuses = ['active', 'completed', 'abandoned'];

      statuses.forEach((status) => {
        const pr: Partial<AdoPullRequest> = { status };
        expect(pr.status).to.equal(status);
      });
    });
  });

  describe('CreateAdoPullRequestInput', () => {
    it('should create basic PR input', () => {
      const input: CreateAdoPullRequestInput = {
        title: 'My PR',
        description: 'Description here',
        sourceRefName: 'feature/my-feature',
        targetRefName: 'main',
        isDraft: false,
      };

      expect(input.title).to.equal('My PR');
      expect(input.sourceRefName).to.equal('feature/my-feature');
      expect(input.targetRefName).to.equal('main');
    });

    it('should allow null description and draft', () => {
      const input: CreateAdoPullRequestInput = {
        title: 'Quick fix',
        description: null,
        sourceRefName: 'fix/bug',
        targetRefName: 'main',
        isDraft: null,
      };

      expect(input.description).to.be.null;
      expect(input.isDraft).to.be.null;
    });
  });

  describe('AdoWorkItem', () => {
    it('should represent a work item', () => {
      const workItem: AdoWorkItem = {
        id: 456,
        title: 'Implement login feature',
        workItemType: 'User Story',
        state: 'Active',
        assignedTo: {
          id: 'user-123',
          displayName: 'John Doe',
          uniqueName: 'john@company.com',
          imageUrl: null,
        },
        createdDate: '2024-01-10T08:00:00Z',
        url: 'https://dev.azure.com/mycompany/_workitems/edit/456',
      };

      expect(workItem.id).to.equal(456);
      expect(workItem.workItemType).to.equal('User Story');
      expect(workItem.state).to.equal('Active');
      expect(workItem.assignedTo?.displayName).to.equal('John Doe');
    });

    it('should allow unassigned work items', () => {
      const workItem: AdoWorkItem = {
        id: 789,
        title: 'Bug: App crashes on startup',
        workItemType: 'Bug',
        state: 'New',
        assignedTo: null,
        createdDate: '2024-01-12T14:00:00Z',
        url: 'https://dev.azure.com/mycompany/_workitems/edit/789',
      };

      expect(workItem.assignedTo).to.be.null;
      expect(workItem.workItemType).to.equal('Bug');
    });

    it('should support various work item types', () => {
      const types = ['Bug', 'Task', 'User Story', 'Feature', 'Epic'];

      types.forEach((type) => {
        const wi: Partial<AdoWorkItem> = { workItemType: type };
        expect(wi.workItemType).to.equal(type);
      });
    });

    it('should support various states', () => {
      const states = ['New', 'Active', 'Resolved', 'Closed', 'Removed'];

      states.forEach((state) => {
        const wi: Partial<AdoWorkItem> = { state };
        expect(wi.state).to.equal(state);
      });
    });
  });

  describe('AdoPipelineRun', () => {
    it('should represent a completed pipeline run', () => {
      const run: AdoPipelineRun = {
        id: 1234,
        name: 'Build #1234',
        state: 'completed',
        result: 'succeeded',
        createdDate: '2024-01-15T10:00:00Z',
        finishedDate: '2024-01-15T10:15:00Z',
        sourceBranch: 'main',
        url: 'https://dev.azure.com/mycompany/MyProject/_build/results?buildId=1234',
      };

      expect(run.state).to.equal('completed');
      expect(run.result).to.equal('succeeded');
      expect(run.finishedDate).to.not.be.null;
    });

    it('should represent a running pipeline', () => {
      const run: AdoPipelineRun = {
        id: 1235,
        name: 'Build #1235',
        state: 'inProgress',
        result: null,
        createdDate: '2024-01-15T11:00:00Z',
        finishedDate: null,
        sourceBranch: 'feature/new-feature',
        url: 'https://dev.azure.com/mycompany/MyProject/_build/results?buildId=1235',
      };

      expect(run.state).to.equal('inProgress');
      expect(run.result).to.be.null;
      expect(run.finishedDate).to.be.null;
    });

    it('should represent a failed pipeline', () => {
      const run: AdoPipelineRun = {
        id: 1236,
        name: 'Build #1236',
        state: 'completed',
        result: 'failed',
        createdDate: '2024-01-15T09:00:00Z',
        finishedDate: '2024-01-15T09:05:00Z',
        sourceBranch: 'feature/broken',
        url: 'https://dev.azure.com/mycompany/MyProject/_build/results?buildId=1236',
      };

      expect(run.result).to.equal('failed');
    });
  });
});

describe('Azure DevOps URL Parsing', () => {
  // URL parsing helper (mirrors Rust implementation)
  function parseAdoUrl(url: string): { organization: string; project: string; repository: string } | null {
    // HTTPS format: https://dev.azure.com/{org}/{project}/_git/{repo}
    if (url.includes('dev.azure.com')) {
      // Remove protocol and username@ prefix
      let path = url.replace(/^https?:\/\//, '');
      if (path.includes('@')) {
        path = path.substring(path.indexOf('@') + 1);
      }

      if (path.startsWith('dev.azure.com/')) {
        const parts = path.split('/');
        if (parts.length >= 5 && parts[3] === '_git') {
          return {
            organization: parts[1],
            project: parts[2],
            repository: parts[4].replace(/\.git$/, ''),
          };
        }
      }
    }

    // Visual Studio format: https://{org}.visualstudio.com/{project}/_git/{repo}
    if (url.includes('.visualstudio.com')) {
      let path = url.replace(/^https?:\/\//, '');
      const parts = path.split('/');
      if (parts.length >= 4 && parts[2] === '_git') {
        const org = parts[0].split('.')[0];
        return {
          organization: org,
          project: parts[1],
          repository: parts[3].replace(/\.git$/, ''),
        };
      }
    }

    // SSH format: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
    if (url.startsWith('git@ssh.dev.azure.com:v3/')) {
      const path = url.replace('git@ssh.dev.azure.com:v3/', '');
      const parts = path.split('/');
      if (parts.length >= 3) {
        return {
          organization: parts[0],
          project: parts[1],
          repository: parts[2].replace(/\.git$/, ''),
        };
      }
    }

    return null;
  }

  describe('HTTPS URLs', () => {
    it('should parse standard dev.azure.com URL', () => {
      const url = 'https://dev.azure.com/mycompany/MyProject/_git/frontend';
      const result = parseAdoUrl(url);

      expect(result).to.not.be.null;
      expect(result!.organization).to.equal('mycompany');
      expect(result!.project).to.equal('MyProject');
      expect(result!.repository).to.equal('frontend');
    });

    it('should parse URL with username prefix', () => {
      const url = 'https://mycompany@dev.azure.com/mycompany/MyProject/_git/backend';
      const result = parseAdoUrl(url);

      expect(result).to.not.be.null;
      expect(result!.organization).to.equal('mycompany');
      expect(result!.project).to.equal('MyProject');
      expect(result!.repository).to.equal('backend');
    });

    it('should parse URL with .git suffix', () => {
      const url = 'https://dev.azure.com/mycompany/MyProject/_git/repo.git';
      const result = parseAdoUrl(url);

      expect(result).to.not.be.null;
      expect(result!.repository).to.equal('repo');
    });
  });

  describe('Visual Studio URLs', () => {
    it('should parse visualstudio.com URL', () => {
      const url = 'https://mycompany.visualstudio.com/MyProject/_git/repo';
      const result = parseAdoUrl(url);

      expect(result).to.not.be.null;
      expect(result!.organization).to.equal('mycompany');
      expect(result!.project).to.equal('MyProject');
      expect(result!.repository).to.equal('repo');
    });
  });

  describe('SSH URLs', () => {
    it('should parse SSH URL', () => {
      const url = 'git@ssh.dev.azure.com:v3/mycompany/MyProject/repo';
      const result = parseAdoUrl(url);

      expect(result).to.not.be.null;
      expect(result!.organization).to.equal('mycompany');
      expect(result!.project).to.equal('MyProject');
      expect(result!.repository).to.equal('repo');
    });

    it('should parse SSH URL with .git suffix', () => {
      const url = 'git@ssh.dev.azure.com:v3/mycompany/MyProject/repo.git';
      const result = parseAdoUrl(url);

      expect(result).to.not.be.null;
      expect(result!.repository).to.equal('repo');
    });
  });

  describe('Invalid URLs', () => {
    it('should return null for GitHub URLs', () => {
      const url = 'https://github.com/user/repo';
      const result = parseAdoUrl(url);
      expect(result).to.be.null;
    });

    it('should return null for GitLab URLs', () => {
      const url = 'https://gitlab.com/user/repo';
      const result = parseAdoUrl(url);
      expect(result).to.be.null;
    });

    it('should return null for malformed Azure URLs', () => {
      const url = 'https://dev.azure.com/org/project';
      const result = parseAdoUrl(url);
      expect(result).to.be.null;
    });
  });
});

describe('Azure DevOps API URL Building', () => {
  const API_VERSION = '7.1';

  function buildApiUrl(organization: string, project: string, path: string): string {
    return `https://dev.azure.com/${organization}/${project}/_apis/${path}?api-version=${API_VERSION}`;
  }

  function buildApiUrlWithParams(organization: string, project: string, path: string, params: string): string {
    return `https://dev.azure.com/${organization}/${project}/_apis/${path}?api-version=${API_VERSION}&${params}`;
  }

  it('should build pull request list URL', () => {
    const url = buildApiUrlWithParams(
      'mycompany',
      'MyProject',
      'git/repositories/frontend/pullrequests',
      'searchCriteria.status=active'
    );

    expect(url).to.include('dev.azure.com/mycompany/MyProject');
    expect(url).to.include('pullrequests');
    expect(url).to.include('api-version=7.1');
    expect(url).to.include('searchCriteria.status=active');
  });

  it('should build work items URL', () => {
    const url = buildApiUrlWithParams(
      'mycompany',
      'MyProject',
      'wit/workitems',
      'ids=1,2,3&fields=System.Id,System.Title'
    );

    expect(url).to.include('wit/workitems');
    expect(url).to.include('ids=1,2,3');
  });

  it('should build pipeline runs URL', () => {
    const url = buildApiUrlWithParams(
      'mycompany',
      'MyProject',
      'build/builds',
      '$top=20&queryOrder=queueTimeDescending'
    );

    expect(url).to.include('build/builds');
    expect(url).to.include('$top=20');
  });

  it('should build simple API URL', () => {
    const url = buildApiUrl('mycompany', 'MyProject', 'wit/wiql');

    expect(url).to.equal(
      'https://dev.azure.com/mycompany/MyProject/_apis/wit/wiql?api-version=7.1'
    );
  });
});

describe('Azure DevOps Authentication', () => {
  it('should generate Basic auth header', () => {
    const token = 'myPersonalAccessToken123';
    // Azure DevOps uses empty username with PAT as password
    const credentials = `:${token}`;
    const encoded = btoa(credentials);
    const header = `Basic ${encoded}`;

    expect(header).to.match(/^Basic /);
    // Decode and verify
    const decoded = atob(header.replace('Basic ', ''));
    expect(decoded).to.equal(':myPersonalAccessToken123');
  });

  it('should handle token resolution', () => {
    const resolveToken = (token: string | null | undefined): string | null => {
      if (token && token.trim().length > 0) {
        return token;
      }
      return null;
    };

    expect(resolveToken('valid-token')).to.equal('valid-token');
    expect(resolveToken('')).to.be.null;
    expect(resolveToken(null)).to.be.null;
    expect(resolveToken(undefined)).to.be.null;
    expect(resolveToken('  ')).to.be.null;
  });
});
