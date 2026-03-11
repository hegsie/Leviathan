import { expect } from '@open-wc/testing';
import type { McpStatus, McpConfig } from '../mcp.service.ts';
import {
  startMcpServer,
  stopMcpServer,
  getMcpStatus,
  getMcpConfig,
  setMcpConfig,
} from '../mcp.service.ts';

// Mock Tauri API
const mockResults: Record<string, unknown> = {
  start_mcp_server: null,
  stop_mcp_server: null,
  get_mcp_status: {
    running: true,
    port: 3000,
    url: 'http://localhost:3000',
  } as McpStatus,
  get_mcp_config: {
    enabled: true,
    port: 3000,
  } as McpConfig,
  set_mcp_config: null,
};

const mockInvoke = (command: string, _args?: Record<string, unknown>): Promise<unknown> => {
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
    expect(result.data!.running).to.be.true;
    expect(result.data!.port).to.equal(3000);
    expect(result.data!.url).to.equal('http://localhost:3000');
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
