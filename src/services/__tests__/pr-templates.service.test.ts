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
  getPrTemplates,
  getPrTemplateContent,
  type PrTemplate,
} from '../git.service.ts';

describe('git.service - PR/MR Template detection', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('getPrTemplates', () => {
    it('invokes get_pr_templates command with path', async () => {
      const mockTemplates: PrTemplate[] = [
        {
          name: 'Pull Request Template',
          path: '.github/PULL_REQUEST_TEMPLATE.md',
          isDefault: true,
        },
      ];
      mockInvoke = () => Promise.resolve(mockTemplates);

      const result = await getPrTemplates('/test/repo');
      expect(lastInvokedCommand).to.equal('get_pr_templates');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.have.length(1);
    });

    it('returns empty array when no templates found', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getPrTemplates('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal([]);
    });

    it('returns multiple templates from a directory', async () => {
      const mockTemplates: PrTemplate[] = [
        {
          name: 'Bug Fix',
          path: '.github/PULL_REQUEST_TEMPLATE/bug_fix.md',
          isDefault: true,
        },
        {
          name: 'Feature Request',
          path: '.github/PULL_REQUEST_TEMPLATE/feature_request.md',
          isDefault: false,
        },
      ];
      mockInvoke = () => Promise.resolve(mockTemplates);

      const result = await getPrTemplates('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.have.length(2);
      expect(result.data![0].isDefault).to.be.true;
      expect(result.data![1].isDefault).to.be.false;
    });

    it('returns both single-file and directory templates', async () => {
      const mockTemplates: PrTemplate[] = [
        {
          name: 'Pull Request Template',
          path: '.github/PULL_REQUEST_TEMPLATE.md',
          isDefault: true,
        },
        {
          name: 'Bug Fix',
          path: '.github/PULL_REQUEST_TEMPLATE/bug_fix.md',
          isDefault: false,
        },
        {
          name: 'Feature',
          path: '.github/PULL_REQUEST_TEMPLATE/feature.md',
          isDefault: false,
        },
      ];
      mockInvoke = () => Promise.resolve(mockTemplates);

      const result = await getPrTemplates('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.have.length(3);

      // Only one default
      const defaults = result.data!.filter((t) => t.isDefault);
      expect(defaults).to.have.length(1);
      expect(defaults[0].path).to.equal('.github/PULL_REQUEST_TEMPLATE.md');
    });

    it('supports GitLab merge request templates', async () => {
      const mockTemplates: PrTemplate[] = [
        {
          name: 'Default',
          path: '.gitlab/merge_request_templates/default.md',
          isDefault: true,
        },
        {
          name: 'Hotfix',
          path: '.gitlab/merge_request_templates/hotfix.md',
          isDefault: false,
        },
      ];
      mockInvoke = () => Promise.resolve(mockTemplates);

      const result = await getPrTemplates('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data).to.have.length(2);
      expect(result.data![0].path).to.include('.gitlab/merge_request_templates/');
    });

    it('handles errors gracefully', async () => {
      mockInvoke = () =>
        Promise.reject({ code: 'INVALID_PATH', message: 'Path not found' });

      const result = await getPrTemplates('/nonexistent/path');
      expect(result.success).to.be.false;
      expect(result.error).to.exist;
    });
  });

  describe('getPrTemplateContent', () => {
    it('invokes get_pr_template_content command', async () => {
      const content = '## Description\n\nPlease describe your changes.';
      mockInvoke = () => Promise.resolve(content);

      const result = await getPrTemplateContent(
        '/test/repo',
        '.github/PULL_REQUEST_TEMPLATE.md',
      );
      expect(lastInvokedCommand).to.equal('get_pr_template_content');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.templatePath).to.equal('.github/PULL_REQUEST_TEMPLATE.md');
      expect(result.success).to.be.true;
      expect(result.data).to.equal(content);
    });

    it('reads content from directory templates', async () => {
      const content = '## Bug Fix\n\n### Root Cause\n\n### Fix Description';
      mockInvoke = () => Promise.resolve(content);

      const result = await getPrTemplateContent(
        '/test/repo',
        '.github/PULL_REQUEST_TEMPLATE/bug_fix.md',
      );
      expect(result.success).to.be.true;
      expect(result.data).to.equal(content);
    });

    it('reads GitLab merge request template content', async () => {
      const content = '## Merge Request\n\nDescription of changes.';
      mockInvoke = () => Promise.resolve(content);

      const result = await getPrTemplateContent(
        '/test/repo',
        '.gitlab/merge_request_templates/default.md',
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

      const result = await getPrTemplateContent(
        '/test/repo',
        '.github/PULL_REQUEST_TEMPLATE.md',
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

      const result = await getPrTemplateContent('/test/repo', '/etc/passwd');
      expect(result.success).to.be.false;
      expect(result.error).to.exist;
    });
  });
});
