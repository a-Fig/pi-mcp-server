import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerPingTool(server: McpServer): void {
  server.registerTool(
    'pi_ping',
    { description: 'Health check. Returns "pong".' },
    async () => ({ content: [{ type: 'text', text: 'pong' }] }),
  );
}
