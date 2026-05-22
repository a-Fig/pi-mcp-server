import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager, SessionInfo } from '../sessions/manager.js';

function summarize(sessions: readonly SessionInfo[]): string {
  if (sessions.length === 0) return 'no sessions';
  const header = `${sessions.length} session(s):`;
  const lines = sessions.map(
    (s) =>
      `  - ${s.sessionId} model=${s.model} cumulativeCostUsd=${s.cumulativeCostUsd} lastActiveAt=${new Date(
        s.lastActiveAt,
      ).toISOString()}`,
  );
  return [header, ...lines].join('\n');
}

export function registerListSessionsTool(
  server: McpServer,
  sessionManager: SessionManager,
): void {
  server.registerTool(
    'pi_list_sessions',
    {
      description:
        'List all known pi sessions in this server process, sorted by creation time.',
    },
    async () => {
      const sessions = sessionManager.list();
      return {
        content: [{ type: 'text', text: summarize(sessions) }],
        structuredContent: { sessions },
      };
    },
  );
}
