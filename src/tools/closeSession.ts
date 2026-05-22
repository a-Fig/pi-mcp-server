import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../sessions/manager.js';

const inputSchema = {
  sessionId: z.string(),
};

export function registerCloseSessionTool(
  server: McpServer,
  sessionManager: SessionManager,
): void {
  server.registerTool(
    'pi_close_session',
    {
      description:
        'Close a pi session and dispose its resources. Idempotent: closing an unknown sessionId succeeds.',
      inputSchema,
    },
    async (args) => {
      try {
        await sessionManager.close(args.sessionId);
        return {
          content: [{ type: 'text', text: `session ${args.sessionId} closed` }],
          structuredContent: { closed: true },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: message }],
          structuredContent: { closed: false, errorMessage: message },
        };
      }
    },
  );
}
