import { expect } from '@open-wc/testing';
import {
  ACCOUNT_COLORS,
  INTEGRATION_TYPE_NAMES,
  createEmptyGitHubAccount,
  createEmptyGitLabAccount,
  createEmptyAzureDevOpsAccount,
  createEmptyBitbucketAccount,
  createGitHubAccount,
  createGitLabAccount,
  createAzureDevOpsAccount,
  createBitbucketAccount,
  getInstanceUrl,
  getOrganization,
  generateAccountId,
  isGitLabConfig,
  isAzureDevOpsConfig,
  isBitbucketConfig,
  safeGetInstanceUrl,
  safeSetInstanceUrl,
  safeGetOrganization,
  safeSetOrganization,
  safeGetWorkspace,
  safeSetWorkspace,
} from '../integration-accounts.types.ts';
import { getAccountDisplayLabel } from '../unified-profile.types.ts';

describe('integration-accounts.types', () => {
  describe('ACCOUNT_COLORS', () => {
    it('should have 8 colors', () => {
      expect(ACCOUNT_COLORS).to.have.lengthOf(8);
    });

    it('should contain valid hex colors', () => {
      for (const color of ACCOUNT_COLORS) {
        expect(color).to.match(/^#[0-9a-f]{6}$/);
      }
    });
  });

  describe('INTEGRATION_TYPE_NAMES', () => {
    it('should map github to GitHub', () => {
      expect(INTEGRATION_TYPE_NAMES.github).to.equal('GitHub');
    });

    it('should map gitlab to GitLab', () => {
      expect(INTEGRATION_TYPE_NAMES.gitlab).to.equal('GitLab');
    });

    it('should map azure-devops to Azure DevOps', () => {
      expect(INTEGRATION_TYPE_NAMES['azure-devops']).to.equal('Azure DevOps');
    });

    it('should map bitbucket to Bitbucket', () => {
      expect(INTEGRATION_TYPE_NAMES.bitbucket).to.equal('Bitbucket');
    });
  });

  describe('createEmpty* functions', () => {
    it('should create an empty GitHub account', () => {
      const account = createEmptyGitHubAccount();
      expect(account.integrationType).to.equal('github');
      expect(account.config).to.deep.equal({ type: 'github' });
      expect(account.name).to.equal('');
      expect(account.isDefault).to.be.false;
      expect(account.cachedUser).to.be.null;
    });

    it('should create an empty GitLab account with default URL', () => {
      const account = createEmptyGitLabAccount();
      expect(account.integrationType).to.equal('gitlab');
      expect(account.config).to.deep.equal({ type: 'gitlab', instanceUrl: 'https://gitlab.com' });
    });

    it('should create an empty GitLab account with custom URL', () => {
      const account = createEmptyGitLabAccount('https://gitlab.mycompany.com');
      expect(account.config).to.deep.equal({ type: 'gitlab', instanceUrl: 'https://gitlab.mycompany.com' });
    });

    it('should create an empty Azure DevOps account', () => {
      const account = createEmptyAzureDevOpsAccount();
      expect(account.integrationType).to.equal('azure-devops');
      expect(account.config).to.deep.equal({ type: 'azure-devops', organization: '' });
    });

    it('should create an empty Azure DevOps account with org', () => {
      const account = createEmptyAzureDevOpsAccount('myorg');
      expect(account.config).to.deep.equal({ type: 'azure-devops', organization: 'myorg' });
    });

    it('should create an empty Bitbucket account', () => {
      const account = createEmptyBitbucketAccount();
      expect(account.integrationType).to.equal('bitbucket');
      expect(account.config).to.deep.equal({ type: 'bitbucket', workspace: '' });
    });

    it('should create an empty Bitbucket account with workspace', () => {
      const account = createEmptyBitbucketAccount('myworkspace');
      expect(account.config).to.deep.equal({ type: 'bitbucket', workspace: 'myworkspace' });
    });
  });

  describe('create* functions with IDs', () => {
    it('should create a GitHub account with generated ID', () => {
      const account = createGitHubAccount('My GitHub');
      expect(account.id).to.be.a('string');
      expect(account.id.length).to.be.greaterThan(0);
      expect(account.name).to.equal('My GitHub');
      expect(account.integrationType).to.equal('github');
    });

    it('should create a GitLab account with generated ID', () => {
      const account = createGitLabAccount('My GitLab', 'https://gitlab.example.com');
      expect(account.id).to.be.a('string');
      expect(account.name).to.equal('My GitLab');
      expect(account.integrationType).to.equal('gitlab');
    });

    it('should create an Azure DevOps account with generated ID', () => {
      const account = createAzureDevOpsAccount('My Azure', 'myorg');
      expect(account.id).to.be.a('string');
      expect(account.name).to.equal('My Azure');
      expect(account.integrationType).to.equal('azure-devops');
    });

    it('should create a Bitbucket account with generated ID', () => {
      const account = createBitbucketAccount('My BB', 'ws');
      expect(account.id).to.be.a('string');
      expect(account.name).to.equal('My BB');
      expect(account.integrationType).to.equal('bitbucket');
    });

    it('should generate unique IDs', () => {
      const a1 = createGitHubAccount();
      const a2 = createGitHubAccount();
      expect(a1.id).to.not.equal(a2.id);
    });
  });

  describe('generateAccountId', () => {
    it('should return a string', () => {
      expect(generateAccountId()).to.be.a('string');
    });

    it('should generate unique IDs', () => {
      const ids = new Set(Array.from({ length: 10 }, () => generateAccountId()));
      expect(ids.size).to.equal(10);
    });
  });

  describe('getInstanceUrl', () => {
    it('should return instanceUrl for GitLab accounts', () => {
      const account = createGitLabAccount('GL', 'https://gitlab.example.com');
      expect(getInstanceUrl(account)).to.equal('https://gitlab.example.com');
    });

    it('should return null for non-GitLab accounts', () => {
      const account = createGitHubAccount('GH');
      expect(getInstanceUrl(account)).to.be.null;
    });
  });

  describe('getOrganization', () => {
    it('should return organization for Azure DevOps accounts', () => {
      const account = createAzureDevOpsAccount('Azure', 'myorg');
      expect(getOrganization(account)).to.equal('myorg');
    });

    it('should return null for non-Azure DevOps accounts', () => {
      const account = createGitHubAccount('GH');
      expect(getOrganization(account)).to.be.null;
    });
  });

  describe('getAccountDisplayLabel', () => {
    it('should return name for GitHub accounts', () => {
      const account = createGitHubAccount('My GitHub');
      expect(getAccountDisplayLabel(account)).to.equal('My GitHub');
    });

    it('should include hostname for self-hosted GitLab', () => {
      const account = createGitLabAccount('My GL', 'https://gitlab.mycompany.com');
      expect(getAccountDisplayLabel(account)).to.equal('My GL (gitlab.mycompany.com)');
    });

    it('should not include hostname for gitlab.com', () => {
      const account = createGitLabAccount('My GL', 'https://gitlab.com');
      expect(getAccountDisplayLabel(account)).to.equal('My GL');
    });

    it('should include organization for Azure DevOps', () => {
      const account = createAzureDevOpsAccount('My Azure', 'contoso');
      expect(getAccountDisplayLabel(account)).to.equal('My Azure (contoso)');
    });

    it('should return just name for Bitbucket accounts', () => {
      const account = createBitbucketAccount('My BB', 'ws');
      expect(getAccountDisplayLabel(account)).to.equal('My BB');
    });
  });

  describe('type guards', () => {
    it('isGitLabConfig should return true for gitlab config', () => {
      expect(isGitLabConfig({ type: 'gitlab', instanceUrl: 'https://gitlab.com' })).to.be.true;
    });

    it('isGitLabConfig should return false for github config', () => {
      expect(isGitLabConfig({ type: 'github' })).to.be.false;
    });

    it('isAzureDevOpsConfig should return true for azure config', () => {
      expect(isAzureDevOpsConfig({ type: 'azure-devops', organization: 'org' })).to.be.true;
    });

    it('isAzureDevOpsConfig should return false for github config', () => {
      expect(isAzureDevOpsConfig({ type: 'github' })).to.be.false;
    });

    it('isBitbucketConfig should return true for bitbucket config', () => {
      expect(isBitbucketConfig({ type: 'bitbucket', workspace: 'ws' })).to.be.true;
    });

    it('isBitbucketConfig should return false for github config', () => {
      expect(isBitbucketConfig({ type: 'github' })).to.be.false;
    });
  });

  describe('safe getters and setters', () => {
    it('safeGetInstanceUrl should return URL for GitLab', () => {
      const account = createGitLabAccount('GL', 'https://gitlab.example.com');
      expect(safeGetInstanceUrl(account)).to.equal('https://gitlab.example.com');
    });

    it('safeGetInstanceUrl should return null for non-GitLab', () => {
      const account = createGitHubAccount('GH');
      expect(safeGetInstanceUrl(account)).to.be.null;
    });

    it('safeSetInstanceUrl should update GitLab URL', () => {
      const account = createGitLabAccount('GL', 'https://old.com');
      safeSetInstanceUrl(account, 'https://new.com');
      expect(safeGetInstanceUrl(account)).to.equal('https://new.com');
    });

    it('safeSetInstanceUrl should not affect non-GitLab accounts', () => {
      const account = createGitHubAccount('GH');
      safeSetInstanceUrl(account, 'https://test.com');
      // Should not throw and config should remain unchanged
      expect(account.config.type).to.equal('github');
    });

    it('safeGetOrganization should return org for Azure DevOps', () => {
      const account = createAzureDevOpsAccount('Az', 'myorg');
      expect(safeGetOrganization(account)).to.equal('myorg');
    });

    it('safeGetOrganization should return null for non-Azure', () => {
      const account = createGitHubAccount('GH');
      expect(safeGetOrganization(account)).to.be.null;
    });

    it('safeSetOrganization should update Azure DevOps org', () => {
      const account = createAzureDevOpsAccount('Az', 'old');
      safeSetOrganization(account, 'new');
      expect(safeGetOrganization(account)).to.equal('new');
    });

    it('safeSetOrganization should not affect non-Azure accounts', () => {
      const account = createGitHubAccount('GH');
      safeSetOrganization(account, 'org');
      expect(account.config.type).to.equal('github');
    });

    it('safeGetWorkspace should return workspace for Bitbucket', () => {
      const account = createBitbucketAccount('BB', 'myws');
      expect(safeGetWorkspace(account)).to.equal('myws');
    });

    it('safeGetWorkspace should return null for non-Bitbucket', () => {
      const account = createGitHubAccount('GH');
      expect(safeGetWorkspace(account)).to.be.null;
    });

    it('safeSetWorkspace should update Bitbucket workspace', () => {
      const account = createBitbucketAccount('BB', 'old');
      safeSetWorkspace(account, 'new');
      expect(safeGetWorkspace(account)).to.equal('new');
    });

    it('safeSetWorkspace should not affect non-Bitbucket accounts', () => {
      const account = createGitHubAccount('GH');
      safeSetWorkspace(account, 'ws');
      expect(account.config.type).to.equal('github');
    });
  });
});
