import { expect } from '@open-wc/testing';

// Mock Tauri API
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
let lastInvokedCommand: string | null = null;
let lastInvokedArgs: unknown = null;

(globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    lastInvokedCommand = command;
    lastInvokedArgs = args;
    return mockInvoke(command, args);
  },
};

import {
  getIssueTemplates,
  getIssueTemplateContent,
  type IssueTemplate,
} from '../git.service.ts';

describe('git.service - Issue Template detection', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getIssueTemplates', () => {
    it('invokes get_issue_templates command with path', async () => {
      const mockTemplates: IssueTemplate[] = [
        {
          name: 'Issue Template',
          path: '.github/ISSUE_TEMPLATE.md',
          isDefault: true,
          description: null,
        },
      ];
      mockInvoke = () => Promise.resolve(mockTemplates);

      const result = await getIssueTemplates('/test/repo');
      expect(lastInvokedCommand).to.equal('get_issue_templates');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.have.length(1);
    });

    it('returns empty array when no templates found', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getIssueTemplates('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('returns multiple templates from a directory', async () => {
      const mockTemplates: IssueTemplate[] = [
        {
          name: 'Bug Report',
          path: '.github/ISSUE_TEMPLATE/bug_report.md',
          isDefault: true,
          description: 'Create a report to help us improve',
        },
        {
          name: 'Feature Request',
          path: '.github/ISSUE_TEMPLATE/feature_request.md',
          isDefault: false,
          description: 'Suggest an idea for this project',
        },
      ];
      mockInvoke = () => Promise.resolve(mockTemplates);

      const result = await getIssueTemplates('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.have.length(2);
      expect(result.data![0].isDefault).to.be.true;
      expect(result.data![1].isDefault).to.be.false;
    });

    it('returns both single-file and directory templates', async () => {
      const mockTemplates: IssueTemplate[] = [
        {
          name: 'Issue Template',
          path: '.github/ISSUE_TEMPLATE.md',
          isDefault: true,
          description: null,
        },
        {
          name: 'Bug Report',
          path: '.github/ISSUE_TEMPLATE/bug_report.md',
          isDefault: false,
          description: 'Create a report to help us improve',
        },
        {
          name: 'Feature Request',
          path: '.github/ISSUE_TEMPLATE/feature_request.md',
          isDefault: false,
          description: null,
        },
      ];
      mockInvoke = () => Promise.resolve(mockTemplates);

      const result = await getIssueTemplates('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.have.length(3);

      // Only one default
      const defaults = result.data!.filter((t) => t.isDefault);
      expect(defaults).to.have.length(1);
      expect(defaults[0].path).to.equal('.github/ISSUE_TEMPLATE.md');
    });

    it('supports GitLab issue templates', async () => {
      const mockTemplates: IssueTemplate[] = [
        {
          name: 'Default',
          path: '.gitlab/issue_templates/default.md',
          isDefault: true,
          description: null,
        },
        {
          name: 'Bug',
          path: '.gitlab/issue_templates/bug.md',
          isDefault: false,
          description: null,
        },
      ];
      mockInvoke = () => Promise.resolve(mockTemplates);

      const result = await getIssueTemplates('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.have.length(2);
      expect(result.data![0].path).to.include('.gitlab/issue_templates/');
    });

    it('includes description from YAML front matter', async () => {
      const mockTemplates: IssueTemplate[] = [
        {
          name: 'Bug Report',
          path: '.github/ISSUE_TEMPLATE/bug_report.md',
          isDefault: true,
          description: 'Create a report to help us improve',
        },
      ];
      mockInvoke = () => Promise.resolve(mockTemplates);

      const result = await getIssueTemplates('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data![0].description).to.equal(
        'Create a report to help us improve',
      );
    });

    it('handles errors gracefully', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'INVALID_PATH', message: 'Path not found' });

      const result = await getIssueTemplates('/nonexistent/path');
      expect(result.success).to.be.false;
      expect(result.error).to.exist;
    });
  });

  describe('getIssueTemplateContent', () => {
    it('invokes get_issue_template_content command', async () => {
      const content = '## Bug Description\n\nPlease describe the issue.';
      mockInvoke = () => Promise.resolve(content);

      const result = await getIssueTemplateContent(
        '/test/repo',
        '.github/ISSUE_TEMPLATE.md',
      );
      expect(lastInvokedCommand).to.equal('get_issue_template_content');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.templatePath).to.equal('.github/ISSUE_TEMPLATE.md');
      expect(result.success).to.be.true;
      expect(result.data).to.equal(content);
    });

    it('reads content from directory templates', async () => {
      const content = '## Bug Report\n\n### Description\n\n### Steps to Reproduce';
      mockInvoke = () => Promise.resolve(content);

      const result = await getIssueTemplateContent(
        '/test/repo',
        '.github/ISSUE_TEMPLATE/bug_report.md',
      );
      expect(result.success).to.be.true;
      expect(result.data).to.equal(content);
    });

    it('reads GitLab issue template content', async () => {
      const content = '## Issue\n\nDescription of the issue.';
      mockInvoke = () => Promise.resolve(content);

      const result = await getIssueTemplateContent(
        '/test/repo',
        '.gitlab/issue_templates/default.md',
      );
      expect(result.success).to.be.true;
      expect(result.data).to.equal(content);
    });

    it('handles missing template gracefully', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'OPERATION_FAILED',
          message: 'Template not found',
        });

      const result = await getIssueTemplateContent(
        '/test/repo',
        '.github/ISSUE_TEMPLATE.md',
      );
      expect(result.success).to.be.false;
      expect(result.error).to.exist;
    });

    it('handles invalid path rejection', async () => {
      mockInvoke = () =>
        Promise.reject({
          code: 'INVALID_PATH',
          message: 'Template path must be relative',
        });

      const result = await getIssueTemplateContent('/test/repo', '/etc/passwd');
      expect(result.success).to.be.false;
      expect(result.error).to.exist;
    });
  });
});
