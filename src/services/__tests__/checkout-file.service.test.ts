import { expect } from "@open-wc/testing";

// Mock Tauri API
type MockInvoke = (command: string, args?: unknown) => Promise<unknown>;
let mockInvoke: MockInvoke = () => Promise.resolve(null);
let lastInvokedCommand: string | null = null;
let lastInvokedArgs: unknown = null;

(
  globalThis as unknown as { __TAURI_INTERNALS__: { invoke: MockInvoke } }
).__TAURI_INTERNALS__ = {
  invoke: (command: string, args?: unknown) => {
    lastInvokedCommand = command;
    lastInvokedArgs = args;
    return mockInvoke(command, args);
  },
};

import {
  checkoutFileFromCommit,
  checkoutFileFromBranch,
  getFileAtCommit,
} from "../git.service.ts";

describe("git.service - Checkout file operations", () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe("checkoutFileFromCommit", () => {
    it("invokes checkout_file_from_commit command with correct args", async () => {
      mockInvoke = () =>
        Promise.resolve({
          filePath: "src/main.rs",
          commitOid: "abc123",
          content: "fn main() {}",
          isBinary: false,
          size: 13,
        });

      const result = await checkoutFileFromCommit("/test/repo", {
        filePath: "src/main.rs",
        commit: "abc123",
      });

      expect(lastInvokedCommand).to.equal("checkout_file_from_commit");
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal("/test/repo");
      expect(args.filePath).to.equal("src/main.rs");
      expect(args.commit).to.equal("abc123");
      expect(result.success).to.be.true;
      expect(result.data?.filePath).to.equal("src/main.rs");
      expect(result.data?.content).to.equal("fn main() {}");
      expect(result.data?.isBinary).to.be.false;
      expect(result.data?.size).to.equal(13);
    });

    it("handles commit not found error", async () => {
      mockInvoke = () =>
        Promise.reject({
          code: "COMMIT_NOT_FOUND",
          message: "Cannot resolve reference: invalid",
        });

      const result = await checkoutFileFromCommit("/test/repo", {
        filePath: "file.txt",
        commit: "invalid",
      });

      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal("COMMIT_NOT_FOUND");
    });

    it("handles file not found in commit error", async () => {
      mockInvoke = () =>
        Promise.reject({
          code: "OPERATION_FAILED",
          message: "File 'nonexistent.txt' not found in commit abc123",
        });

      const result = await checkoutFileFromCommit("/test/repo", {
        filePath: "nonexistent.txt",
        commit: "abc123",
      });

      expect(result.success).to.be.false;
    });

    it("supports HEAD~N syntax for commit ref", async () => {
      mockInvoke = () =>
        Promise.resolve({
          filePath: "README.md",
          commitOid: "def456",
          content: "# Old version",
          isBinary: false,
          size: 14,
        });

      const result = await checkoutFileFromCommit("/test/repo", {
        filePath: "README.md",
        commit: "HEAD~2",
      });

      expect(lastInvokedCommand).to.equal("checkout_file_from_commit");
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.commit).to.equal("HEAD~2");
      expect(result.success).to.be.true;
    });
  });

  describe("checkoutFileFromBranch", () => {
    it("invokes checkout_file_from_branch command with correct args", async () => {
      mockInvoke = () =>
        Promise.resolve({
          filePath: "config.json",
          commitOid: "branch-tip-oid",
          content: '{"key": "value"}',
          isBinary: false,
          size: 16,
        });

      const result = await checkoutFileFromBranch("/test/repo", {
        filePath: "config.json",
        branch: "feature/new-config",
      });

      expect(lastInvokedCommand).to.equal("checkout_file_from_branch");
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal("/test/repo");
      expect(args.filePath).to.equal("config.json");
      expect(args.branch).to.equal("feature/new-config");
      expect(result.success).to.be.true;
      expect(result.data?.commitOid).to.equal("branch-tip-oid");
    });

    it("handles branch not found error", async () => {
      mockInvoke = () =>
        Promise.reject({
          code: "BRANCH_NOT_FOUND",
          message: "Branch not found: nonexistent",
        });

      const result = await checkoutFileFromBranch("/test/repo", {
        filePath: "file.txt",
        branch: "nonexistent",
      });

      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal("BRANCH_NOT_FOUND");
    });

    it("handles file not found on branch error", async () => {
      mockInvoke = () =>
        Promise.reject({
          code: "OPERATION_FAILED",
          message: "File 'missing.txt' not found in commit abc",
        });

      const result = await checkoutFileFromBranch("/test/repo", {
        filePath: "missing.txt",
        branch: "main",
      });

      expect(result.success).to.be.false;
    });
  });

  describe("getFileAtCommit", () => {
    it("invokes get_file_at_commit command with correct args", async () => {
      mockInvoke = () =>
        Promise.resolve({
          filePath: "lib.rs",
          commitOid: "abc123",
          content: "pub fn hello() {}",
          isBinary: false,
          size: 18,
        });

      const result = await getFileAtCommit("/test/repo", {
        filePath: "lib.rs",
        commit: "abc123",
      });

      expect(lastInvokedCommand).to.equal("get_file_at_commit");
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal("/test/repo");
      expect(args.filePath).to.equal("lib.rs");
      expect(args.commit).to.equal("abc123");
      expect(result.success).to.be.true;
      expect(result.data?.content).to.equal("pub fn hello() {}");
      expect(result.data?.size).to.equal(18);
    });

    it("handles binary file content", async () => {
      mockInvoke = () =>
        Promise.resolve({
          filePath: "image.png",
          commitOid: "abc123",
          content: "",
          isBinary: true,
          size: 4096,
        });

      const result = await getFileAtCommit("/test/repo", {
        filePath: "image.png",
        commit: "abc123",
      });

      expect(result.success).to.be.true;
      expect(result.data?.isBinary).to.be.true;
      expect(result.data?.content).to.equal("");
      expect(result.data?.size).to.equal(4096);
    });

    it("handles commit not found error", async () => {
      mockInvoke = () =>
        Promise.reject({
          code: "COMMIT_NOT_FOUND",
          message: "Cannot resolve reference: badref",
        });

      const result = await getFileAtCommit("/test/repo", {
        filePath: "file.txt",
        commit: "badref",
      });

      expect(result.success).to.be.false;
      expect(result.error?.code).to.equal("COMMIT_NOT_FOUND");
    });

    it("handles file not found in commit error", async () => {
      mockInvoke = () =>
        Promise.reject({
          code: "OPERATION_FAILED",
          message: "File 'gone.txt' not found in commit abc",
        });

      const result = await getFileAtCommit("/test/repo", {
        filePath: "gone.txt",
        commit: "abc123",
      });

      expect(result.success).to.be.false;
    });

    it("supports tag references", async () => {
      mockInvoke = () =>
        Promise.resolve({
          filePath: "version.txt",
          commitOid: "tagged-oid",
          content: "1.0.0",
          isBinary: false,
          size: 5,
        });

      const result = await getFileAtCommit("/test/repo", {
        filePath: "version.txt",
        commit: "v1.0.0",
      });

      expect(lastInvokedCommand).to.equal("get_file_at_commit");
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.commit).to.equal("v1.0.0");
      expect(result.success).to.be.true;
      expect(result.data?.content).to.equal("1.0.0");
    });
  });
});
