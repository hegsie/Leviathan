/**
 * MCP (Model Context Protocol) Service
 * Manages the MCP server that exposes Git context to external tools
 */

import { invokeCommand } from './tauri-api.ts';
import type { CommandResult } from '../types/api.types.ts';

/**
 * MCP server configuration
 */
export interface McpConfig {
  enabled: boolean;
  port: number;
  allowedOrigins: string[];
}

/**
 * MCP server status
 */
export interface McpStatus {
  running: boolean;
  port: number;
  url: string | null;
}

/**
 * Start the MCP server
 */
export async function startMcpServer(): Promise<CommandResult<void>> {
  return invokeCommand<void>('start_mcp_server');
}

/**
 * Stop the MCP server
 */
export async function stopMcpServer(): Promise<CommandResult<void>> {
  return invokeCommand<void>('stop_mcp_server');
}

/**
 * Get the current MCP server status
 */
export async function getMcpStatus(): Promise<CommandResult<McpStatus>> {
  return invokeCommand<McpStatus>('get_mcp_status');
}

/**
 * Get MCP server configuration
 */
export async function getMcpConfig(): Promise<CommandResult<McpConfig>> {
  return invokeCommand<McpConfig>('get_mcp_config');
}

/**
 * Update MCP server configuration
 */
export async function setMcpConfig(config: McpConfig): Promise<CommandResult<void>> {
  return invokeCommand<void>('set_mcp_config', { config });
}
