import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerPingTool } from './ping.js';

export function registerAllTools(server: McpServer): void {
  registerPingTool(server);
}
