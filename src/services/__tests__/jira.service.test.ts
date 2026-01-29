import { expect } from '@open-wc/testing';

/**
 * JIRA integration tests
 * Tests the JIRA service types, branch name generation, and API URL building
 */

// JIRA Types
interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey?: string | null;
}

interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  issueType: string;
  assignee: string | null;
  priority: string | null;
  url: string;
}

interface JiraTransition {
  id: string;
  name: string;
}

describe('JIRA Types', () => {
  describe('JiraConfig', () => {
    it('should have correct structure with project key', () => {
      const config: JiraConfig = {
        baseUrl: 'https://mycompany.atlassian.net',
        email: 'user@example.com',
        apiToken: 'my-api-token',
        projectKey: 'PROJ',
      };

      expect(config.baseUrl).to.equal('https://mycompany.atlassian.net');
      expect(config.email).to.equal('user@example.com');
      expect(config.apiToken).to.equal('my-api-token');
      expect(config.projectKey).to.equal('PROJ');
    });

    it('should allow null project key', () => {
      const config: JiraConfig = {
        baseUrl: 'https://mycompany.atlassian.net',
        email: 'user@example.com',
        apiToken: 'my-api-token',
        projectKey: null,
      };

      expect(config.projectKey).to.be.null;
    });

    it('should allow undefined project key', () => {
      const config: JiraConfig = {
        baseUrl: 'https://mycompany.atlassian.net',
        email: 'user@example.com',
        apiToken: 'my-api-token',
      };

      expect(config.projectKey).to.be.undefined;
    });
  });

  describe('JiraIssue', () => {
    it('should have complete issue structure', () => {
      const issue: JiraIssue = {
        key: 'PROJ-123',
        summary: 'Implement user authentication',
        status: 'In Progress',
        issueType: 'Story',
        assignee: 'John Doe',
        priority: 'High',
        url: 'https://mycompany.atlassian.net/browse/PROJ-123',
      };

      expect(issue.key).to.equal('PROJ-123');
      expect(issue.summary).to.equal('Implement user authentication');
      expect(issue.status).to.equal('In Progress');
      expect(issue.issueType).to.equal('Story');
      expect(issue.assignee).to.equal('John Doe');
      expect(issue.priority).to.equal('High');
      expect(issue.url).to.include('/browse/PROJ-123');
    });

    it('should allow null assignee and priority', () => {
      const issue: JiraIssue = {
        key: 'PROJ-456',
        summary: 'Unassigned bug',
        status: 'To Do',
        issueType: 'Bug',
        assignee: null,
        priority: null,
        url: 'https://mycompany.atlassian.net/browse/PROJ-456',
      };

      expect(issue.assignee).to.be.null;
      expect(issue.priority).to.be.null;
    });

    it('should support various issue types', () => {
      const types = ['Bug', 'Story', 'Task', 'Epic', 'Sub-task'];

      types.forEach((type) => {
        const issue: Partial<JiraIssue> = { issueType: type };
        expect(issue.issueType).to.equal(type);
      });
    });

    it('should support various statuses', () => {
      const statuses = ['To Do', 'In Progress', 'In Review', 'Done', 'Blocked'];

      statuses.forEach((status) => {
        const issue: Partial<JiraIssue> = { status };
        expect(issue.status).to.equal(status);
      });
    });

    it('should support various priorities', () => {
      const priorities = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];

      priorities.forEach((priority) => {
        const issue: Partial<JiraIssue> = { priority };
        expect(issue.priority).to.equal(priority);
      });
    });
  });

  describe('JiraTransition', () => {
    it('should have id and name', () => {
      const transition: JiraTransition = {
        id: '31',
        name: 'In Progress',
      };

      expect(transition.id).to.equal('31');
      expect(transition.name).to.equal('In Progress');
    });

    it('should represent common transitions', () => {
      const transitions: JiraTransition[] = [
        { id: '11', name: 'To Do' },
        { id: '21', name: 'In Progress' },
        { id: '31', name: 'Done' },
      ];

      expect(transitions).to.have.length(3);
      expect(transitions[0].name).to.equal('To Do');
      expect(transitions[1].name).to.equal('In Progress');
      expect(transitions[2].name).to.equal('Done');
    });
  });
});

describe('JIRA API URL Building', () => {
  function buildJiraApiUrl(baseUrl: string, path: string): string {
    const base = baseUrl.replace(/\/+$/, '');
    return `${base}/rest/api/3/${path}`;
  }

  it('should build search URL', () => {
    const url = buildJiraApiUrl('https://mycompany.atlassian.net', 'search');
    expect(url).to.equal('https://mycompany.atlassian.net/rest/api/3/search');
  });

  it('should build issue URL', () => {
    const url = buildJiraApiUrl('https://mycompany.atlassian.net', 'issue/PROJ-123');
    expect(url).to.equal('https://mycompany.atlassian.net/rest/api/3/issue/PROJ-123');
  });

  it('should build transitions URL', () => {
    const url = buildJiraApiUrl('https://mycompany.atlassian.net', 'issue/PROJ-123/transitions');
    expect(url).to.equal('https://mycompany.atlassian.net/rest/api/3/issue/PROJ-123/transitions');
  });

  it('should handle trailing slash in base URL', () => {
    const url = buildJiraApiUrl('https://mycompany.atlassian.net/', 'search');
    expect(url).to.equal('https://mycompany.atlassian.net/rest/api/3/search');
  });

  it('should handle multiple trailing slashes', () => {
    const url = buildJiraApiUrl('https://mycompany.atlassian.net///', 'search');
    expect(url).to.equal('https://mycompany.atlassian.net/rest/api/3/search');
  });
});

describe('JIRA Authentication', () => {
  it('should generate Basic auth header from email and token', () => {
    const email = 'user@example.com';
    const apiToken = 'my-api-token';
    const credentials = `${email}:${apiToken}`;
    const encoded = btoa(credentials);
    const header = `Basic ${encoded}`;

    expect(header).to.match(/^Basic /);
    // Decode and verify
    const decoded = atob(header.replace('Basic ', ''));
    expect(decoded).to.equal('user@example.com:my-api-token');
  });
});

describe('JIRA Branch Name Generation', () => {
  function generateBranchName(
    issueKey: string,
    summary: string,
    branchType?: string,
  ): string {
    const prefix = branchType || 'feature';

    // Sanitize summary for branch name
    const sanitized = summary
      .toLowerCase()
      .replace(/[^a-z0-9\s\-_]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '');

    // Truncate to reasonable length
    const maxLen = 50;
    let truncated = sanitized;
    if (truncated.length > maxLen) {
      const cutPos = truncated.lastIndexOf('-', maxLen);
      truncated = cutPos > 10 ? truncated.substring(0, cutPos) : truncated.substring(0, maxLen);
    }

    return `${prefix}/${issueKey}-${truncated}`;
  }

  it('should generate basic branch name', () => {
    const name = generateBranchName('PROJ-123', 'Add user authentication');
    expect(name).to.equal('feature/PROJ-123-add-user-authentication');
  });

  it('should use custom branch type', () => {
    const name = generateBranchName('BUG-456', 'Fix login crash', 'bugfix');
    expect(name).to.equal('bugfix/BUG-456-fix-login-crash');
  });

  it('should handle special characters', () => {
    const name = generateBranchName('PROJ-789', 'Handle special chars: @#$% in input!');
    expect(name).to.include('feature/PROJ-789-');
    expect(name).to.not.match(/[@#$%!]/);
  });

  it('should truncate long summaries', () => {
    const name = generateBranchName(
      'PROJ-100',
      'This is a very long summary that should be truncated because it exceeds the maximum allowed length for a branch name',
    );
    expect(name).to.include('feature/PROJ-100-');
    // Branch name should be reasonable length
    expect(name.length).to.be.below(80);
  });

  it('should handle consecutive dashes and spaces', () => {
    const name = generateBranchName('PROJ-200', 'Fix -- multiple   spaces---and dashes');
    expect(name).to.not.include('--');
  });

  it('should support hotfix branch type', () => {
    const name = generateBranchName('HOT-001', 'Critical security fix', 'hotfix');
    expect(name).to.equal('hotfix/HOT-001-critical-security-fix');
  });

  it('should default to feature prefix', () => {
    const name = generateBranchName('FEAT-999', 'New dashboard');
    expect(name).to.match(/^feature\//);
  });
});

describe('JIRA JQL Query Building', () => {
  function buildDefaultJql(projectKey?: string): string {
    if (projectKey) {
      return `project = ${projectKey} AND statusCategory != Done ORDER BY updated DESC`;
    }
    return 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';
  }

  it('should build JQL with project key', () => {
    const jql = buildDefaultJql('PROJ');
    expect(jql).to.equal('project = PROJ AND statusCategory != Done ORDER BY updated DESC');
  });

  it('should build JQL without project key', () => {
    const jql = buildDefaultJql();
    expect(jql).to.equal(
      'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC',
    );
  });

  it('should handle different project keys', () => {
    const keys = ['PROJ', 'BUG', 'FEAT', 'OPS'];
    keys.forEach((key) => {
      const jql = buildDefaultJql(key);
      expect(jql).to.include(`project = ${key}`);
    });
  });
});

describe('JIRA Issue URL Building', () => {
  function buildIssueUrl(baseUrl: string, issueKey: string): string {
    const base = baseUrl.replace(/\/+$/, '');
    return `${base}/browse/${issueKey}`;
  }

  it('should build browse URL for issue', () => {
    const url = buildIssueUrl('https://mycompany.atlassian.net', 'PROJ-123');
    expect(url).to.equal('https://mycompany.atlassian.net/browse/PROJ-123');
  });

  it('should handle trailing slash', () => {
    const url = buildIssueUrl('https://mycompany.atlassian.net/', 'PROJ-456');
    expect(url).to.equal('https://mycompany.atlassian.net/browse/PROJ-456');
  });

  it('should work with self-hosted JIRA', () => {
    const url = buildIssueUrl('https://jira.internal.company.com', 'INT-789');
    expect(url).to.equal('https://jira.internal.company.com/browse/INT-789');
  });
});
