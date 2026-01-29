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
  revealInFileManager,
  openInDefaultApp,
  openInConfiguredEditor,
  getEditorConfig,
  setEditorConfig,
} from "../git.service.ts";

describe("git.service - File operations", () => {
  beforeEach(() => {
    lastInvokedCommand = null;
    lastInvokedArgs = null;
  });

  describe("revealInFileManager", () => {
    it("invokes reveal_in_file_manager command", async () => {
      mockInvoke = () => Promise.resolve({ success: true, message: null });

      const result = await revealInFileManager("/path/to/file.txt");
      expect(lastInvokedCommand).to.equal("reveal_in_file_manager");
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal("/path/to/file.txt");
      expect(result.success).to.be.true;
      expect(result.data?.success).to.be.true;
    });

    it("handles invalid path error", async () => {
      mockInvoke = () =>
        Promise.reject({ code: "INVALID_PATH", message: "Path not found" });

      const result = await revealInFileManager("/nonexistent/path");
      expect(result.success).to.be.false;
    });
  });

  describe("openInDefaultApp", () => {
    it("invokes open_in_default_app command", async () => {
      mockInvoke = () => Promise.resolve({ success: true, message: null });

      const result = await openInDefaultApp("/path/to/file.pdf");
      expect(lastInvokedCommand).to.equal("open_in_default_app");
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal("/path/to/file.pdf");
      expect(result.success).to.be.true;
    });

    it("handles invalid path error", async () => {
      mockInvoke = () =>
        Promise.reject({ code: "INVALID_PATH", message: "File not found" });

      const result = await openInDefaultApp("/nonexistent/file.txt");
      expect(result.success).to.be.false;
    });
  });

  describe("openInConfiguredEditor", () => {
    it("invokes open_in_configured_editor command", async () => {
      mockInvoke = () =>
        Promise.resolve({ success: true, message: "Opened in code" });

      const result = await openInConfiguredEditor(
        "/test/repo",
        "src/main.rs",
        42,
      );
      expect(lastInvokedCommand).to.equal("open_in_configured_editor");
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal("/test/repo");
      expect(args.filePath).to.equal("src/main.rs");
      expect(args.line).to.equal(42);
      expect(result.success).to.be.true;
    });

    it("works without line number", async () => {
      mockInvoke = () =>
        Promise.resolve({ success: true, message: "Opened in vim" });

      const result = await openInConfiguredEditor("/test/repo", "src/main.rs");
      expect(lastInvokedCommand).to.equal("open_in_configured_editor");
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.line).to.be.undefined;
      expect(result.success).to.be.true;
    });

    it("handles file not found error", async () => {
      mockInvoke = () =>
        Promise.reject({ code: "INVALID_PATH", message: "File not found" });

      const result = await openInConfiguredEditor(
        "/test/repo",
        "nonexistent.txt",
      );
      expect(result.success).to.be.false;
    });
  });

  describe("getEditorConfig", () => {
    it("invokes get_editor_config command", async () => {
      mockInvoke = () =>
        Promise.resolve({ editor: "code --wait", visual: null });

      const result = await getEditorConfig("/test/repo");
      expect(lastInvokedCommand).to.equal("get_editor_config");
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal("/test/repo");
      expect(args.global).to.be.false;
      expect(result.success).to.be.true;
      expect(result.data?.editor).to.equal("code --wait");
    });

    it("can request global config only", async () => {
      mockInvoke = () => Promise.resolve({ editor: "vim", visual: "vim" });

      const result = await getEditorConfig("/test/repo", true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.global).to.be.true;
      expect(result.success).to.be.true;
    });

    it("handles missing config", async () => {
      mockInvoke = () => Promise.resolve({ editor: null, visual: null });

      const result = await getEditorConfig("/test/repo");
      expect(result.success).to.be.true;
      expect(result.data?.editor).to.be.null;
    });
  });

  describe("setEditorConfig", () => {
    it("invokes set_editor_config command", async () => {
      mockInvoke = () =>
        Promise.resolve({
          success: true,
          message: "Editor set to 'code --wait' (local)",
        });

      const result = await setEditorConfig("/test/repo", "code --wait");
      expect(lastInvokedCommand).to.equal("set_editor_config");
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.path).to.equal("/test/repo");
      expect(args.editor).to.equal("code --wait");
      expect(args.global).to.be.false;
      expect(result.success).to.be.true;
    });

    it("can set global config", async () => {
      mockInvoke = () =>
        Promise.resolve({
          success: true,
          message: "Editor set to 'vim' (global)",
        });

      const result = await setEditorConfig("/test/repo", "vim", true);
      const args = lastInvokedArgs as Record<string, unknown>;
      expect(args.global).to.be.true;
      expect(result.success).to.be.true;
    });

    it("handles repository not found error", async () => {
      mockInvoke = () =>
        Promise.reject({
          code: "REPO_NOT_FOUND",
          message: "Repository not found",
        });

      const result = await setEditorConfig("/nonexistent/repo", "code");
      expect(result.success).to.be.false;
    });
  });
});
