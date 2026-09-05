import { expect } from '@open-wc/testing';
import type { McpStatus, McpConfig } from '../mcp.service.ts';
import {
  startMcpServer,
  stopMcpServer,
  getMcpStatus,
  getMcpConfig,
  setMcpConfig,
  regenerateMcpToken,
} from '../mcp.service.ts';

// Mock Tauri API
const mockResults: Record<string, unknown> = {
  start_mcp_server: null,
  stop_mcp_server: null,
  get_mcp_status: {
    running: false,
    port: 3000,
    url: null,
    lastError: 'Failed to bind to 127.0.0.1:3000: Address already in use',
  } as McpStatus,
  get_mcp_config: {
    enabled: true,
    port: 3000,
    allowedOrigins: [],
    authToken: 'token-abc123',
  } as McpConfig,
  set_mcp_config: null,
  regenerate_mcp_token: 'token-new456',
};

/** Arguments of every invoked command, so the saved payload can be inspected */
const invoked: Array<{ command: string; args?: Record<string, unknown> }> = [];

const mockInvoke = (command: string, args?: Record<string, unknown>): Promise<unknown> => {
  invoked.push({ command, args });
  return Promise.resolve(mockResults[command] ?? { success: false, error: 'Unknown command' });
};

(globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {
  invoke: mockInvoke,
};

describe('MCP Service - startMcpServer', () => {
  it('should invoke start_mcp_server command', async () => {
    const result = await startMcpServer();
    expect(result.success).to.be.true;
  });
});

describe('MCP Service - stopMcpServer', () => {
  it('should invoke stop_mcp_server command', async () => {
    const result = await stopMcpServer();
    expect(result.success).to.be.true;
  });
});

describe('MCP Service - getMcpStatus', () => {
  it('should return MCP server status', async () => {
    const result = await getMcpStatus();
    expect(result.success).to.be.true;
    expect(result.data).to.not.be.undefined;
    expect(result.data!.running).to.be.false;
    expect(result.data!.port).to.equal(3000);
    expect(result.data!.url).to.be.null;
  });

  it('should surface why a stopped server failed to start', async () => {
    const result = await getMcpStatus();
    expect(result.success).to.be.true;
    expect(result.data!.lastError).to.equal(
      'Failed to bind to 127.0.0.1:3000: Address already in use'
    );
  });
});

describe('MCP Service - getMcpConfig', () => {
  it('should return MCP server configuration', async () => {
    const result = await getMcpConfig();
    expect(result.success).to.be.true;
    expect(result.data).to.not.be.undefined;
    expect(result.data!.enabled).to.be.true;
    expect(result.data!.port).to.equal(3000);
  });

  it('should return the access token required by MCP clients', async () => {
    const result = await getMcpConfig();
    expect(result.data!.authToken).to.equal('token-abc123');
  });
});

describe('MCP Service - setMcpConfig', () => {
  it('should invoke set_mcp_config command', async () => {
    const result = await setMcpConfig({ enabled: true, port: 4000, allowedOrigins: [] });
    expect(result.success).to.be.true;
  });

  it('should accept disabled configuration', async () => {
    const result = await setMcpConfig({ enabled: false, port: 3000, allowedOrigins: [] });
    expect(result.success).to.be.true;
  });
});

describe('MCP Service - setMcpConfig token handling', () => {
  it('should never send the token back to the backend', async () => {
    invoked.length = 0;
    await setMcpConfig({
      enabled: true,
      port: 4000,
      allowedOrigins: ['http://localhost:5173'],
      authToken: 'token-abc123',
    });

    const save = invoked.find((c) => c.command === 'set_mcp_config');
    expect(save).to.not.be.undefined;
    expect(save!.args).to.deep.equal({
      config: { enabled: true, port: 4000, allowedOrigins: ['http://localhost:5173'] },
    });
  });
});

describe('MCP Service - regenerateMcpToken', () => {
  it('should return the newly generated token', async () => {
    const result = await regenerateMcpToken();
    expect(result.success).to.be.true;
    expect(result.data).to.equal('token-new456');
  });
});
