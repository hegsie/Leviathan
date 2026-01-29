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
  verifyCommitSignature,
  getCommitsSignatureInfo,
  getSigningConfig,
  type CommitSignatureInfo,
  type SigningConfig,
} from '../git.service.ts';

describe('git.service - Commit Signature Verification', () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe('verifyCommitSignature', () => {
    it('invokes verify_commit_signature command', async () => {
      const mockSig: CommitSignatureInfo = {
        commitId: 'abc123',
        isSigned: true,
        signatureStatus: 'good',
        signerName: 'John Doe',
        signerEmail: 'john@example.com',
        keyId: 'ABCDEF1234567890',
        signatureType: 'gpg',
      };
      mockInvoke = () => Promise.resolve(mockSig);

      const result = await verifyCommitSignature('/test/repo', 'abc123');
      expect(lastInvokedCommand).to.equal('verify_commit_signature');
      expect(result.success).to.be.true;
      expect(result.data?.isSigned).to.be.true;
      expect(result.data?.signatureStatus).to.equal('good');
      expect(result.data?.signerName).to.equal('John Doe');
      expect(result.data?.keyId).to.equal('ABCDEF1234567890');
    });

    it('passes correct arguments', async () => {
      mockInvoke = () =>
        Promise.resolve({
          commitId: 'def456',
          isSigned: false,
          signatureStatus: 'unsigned',
          signerName: null,
          signerEmail: null,
          keyId: null,
          signatureType: null,
        });

      await verifyCommitSignature('/test/repo', 'def456');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.commitId).to.equal('def456');
    });

    it('handles unsigned commits', async () => {
      mockInvoke = () =>
        Promise.resolve({
          commitId: 'unsigned123',
          isSigned: false,
          signatureStatus: 'unsigned',
          signerName: null,
          signerEmail: null,
          keyId: null,
          signatureType: null,
        });

      const result = await verifyCommitSignature('/test/repo', 'unsigned123');
      expect(result.success).to.be.true;
      expect(result.data?.isSigned).to.be.false;
      expect(result.data?.signatureStatus).to.equal('unsigned');
      expect(result.data?.signerName).to.be.null;
    });

    it('handles bad signatures', async () => {
      mockInvoke = () =>
        Promise.resolve({
          commitId: 'bad123',
          isSigned: true,
          signatureStatus: 'bad',
          signerName: 'Suspicious User',
          signerEmail: 'suspicious@example.com',
          keyId: 'BADKEY123',
          signatureType: 'gpg',
        });

      const result = await verifyCommitSignature('/test/repo', 'bad123');
      expect(result.success).to.be.true;
      expect(result.data?.signatureStatus).to.equal('bad');
      expect(result.data?.isSigned).to.be.true;
    });

    it('handles SSH signatures', async () => {
      mockInvoke = () =>
        Promise.resolve({
          commitId: 'ssh123',
          isSigned: true,
          signatureStatus: 'good',
          signerName: 'SSH User',
          signerEmail: 'ssh@example.com',
          keyId: 'SHA256:abc123',
          signatureType: 'ssh',
        });

      const result = await verifyCommitSignature('/test/repo', 'ssh123');
      expect(result.success).to.be.true;
      expect(result.data?.signatureType).to.equal('ssh');
    });

    it('handles errors', async () => {
      mockInvoke = () => Promise.reject(new Error('Git error'));

      const result = await verifyCommitSignature('/test/repo', 'error123');
      expect(result.success).to.be.false;
    });
  });

  describe('getCommitsSignatureInfo', () => {
    it('invokes get_commits_signature_info command', async () => {
      const mockSigs: CommitSignatureInfo[] = [
        {
          commitId: 'abc123',
          isSigned: true,
          signatureStatus: 'good',
          signerName: 'John Doe',
          signerEmail: 'john@example.com',
          keyId: 'KEY1',
          signatureType: 'gpg',
        },
        {
          commitId: 'def456',
          isSigned: false,
          signatureStatus: 'unsigned',
          signerName: null,
          signerEmail: null,
          keyId: null,
          signatureType: null,
        },
      ];
      mockInvoke = () => Promise.resolve(mockSigs);

      const result = await getCommitsSignatureInfo('/test/repo', [
        'abc123',
        'def456',
      ]);
      expect(lastInvokedCommand).to.equal('get_commits_signature_info');
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(2);
      expect(result.data?.[0].isSigned).to.be.true;
      expect(result.data?.[1].isSigned).to.be.false;
    });

    it('passes correct arguments', async () => {
      mockInvoke = () => Promise.resolve([]);

      await getCommitsSignatureInfo('/test/repo', ['abc', 'def', 'ghi']);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/test/repo');
      expect(args.commitIds).to.deep.equal(['abc', 'def', 'ghi']);
    });

    it('handles empty commit list', async () => {
      mockInvoke = () => Promise.resolve([]);

      const result = await getCommitsSignatureInfo('/test/repo', []);
      expect(result.success).to.be.true;
      expect(result.data?.length).to.equal(0);
    });

    it('handles mixed signature statuses', async () => {
      const mockSigs: CommitSignatureInfo[] = [
        {
          commitId: 'good1',
          isSigned: true,
          signatureStatus: 'good',
          signerName: 'Good User',
          signerEmail: 'good@example.com',
          keyId: 'GOODKEY',
          signatureType: 'gpg',
        },
        {
          commitId: 'bad1',
          isSigned: true,
          signatureStatus: 'bad',
          signerName: 'Bad User',
          signerEmail: null,
          keyId: 'BADKEY',
          signatureType: 'gpg',
        },
        {
          commitId: 'unknown1',
          isSigned: true,
          signatureStatus: 'unknown',
          signerName: null,
          signerEmail: null,
          keyId: 'UNKNOWNKEY',
          signatureType: 'gpg',
        },
      ];
      mockInvoke = () => Promise.resolve(mockSigs);

      const result = await getCommitsSignatureInfo('/test/repo', [
        'good1',
        'bad1',
        'unknown1',
      ]);
      expect(result.success).to.be.true;
      expect(result.data?.[0].signatureStatus).to.equal('good');
      expect(result.data?.[1].signatureStatus).to.equal('bad');
      expect(result.data?.[2].signatureStatus).to.equal('unknown');
    });
  });

  describe('getSigningConfig', () => {
    it('invokes get_signing_config command', async () => {
      const mockConfig: SigningConfig = {
        signingEnabled: true,
        signingKey: 'ABCDEF1234567890',
        signingFormat: 'gpg',
      };
      mockInvoke = () => Promise.resolve(mockConfig);

      const result = await getSigningConfig('/test/repo');
      expect(lastInvokedCommand).to.equal('get_signing_config');
      expect(result.success).to.be.true;
      expect(result.data?.signingEnabled).to.be.true;
      expect(result.data?.signingKey).to.equal('ABCDEF1234567890');
      expect(result.data?.signingFormat).to.equal('gpg');
    });

    it('passes correct arguments', async () => {
      mockInvoke = () =>
        Promise.resolve({
          signingEnabled: false,
          signingKey: null,
          signingFormat: null,
        });

      await getSigningConfig('/my/repo/path');
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal('/my/repo/path');
    });

    it('handles disabled signing config', async () => {
      mockInvoke = () =>
        Promise.resolve({
          signingEnabled: false,
          signingKey: null,
          signingFormat: null,
        });

      const result = await getSigningConfig('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.signingEnabled).to.be.false;
      expect(result.data?.signingKey).to.be.null;
      expect(result.data?.signingFormat).to.be.null;
    });

    it('handles SSH signing format', async () => {
      mockInvoke = () =>
        Promise.resolve({
          signingEnabled: true,
          signingKey: '/home/user/.ssh/id_ed25519.pub',
          signingFormat: 'ssh',
        });

      const result = await getSigningConfig('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.signingFormat).to.equal('ssh');
      expect(result.data?.signingKey).to.contain('.ssh');
    });

    it('handles x509 signing format', async () => {
      mockInvoke = () =>
        Promise.resolve({
          signingEnabled: true,
          signingKey: 'certificate-id-123',
          signingFormat: 'x509',
        });

      const result = await getSigningConfig('/test/repo');
      expect(result.success).to.be.true;
      expect(result.data?.signingFormat).to.equal('x509');
    });

    it('handles errors', async () => {
      mockInvoke = () => Promise.reject(new Error('Config error'));

      const result = await getSigningConfig('/test/repo');
      expect(result.success).to.be.false;
    });
  });
});
