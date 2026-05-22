import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../sessions/manager.js';
import { registerNewSessionTool } from './newSession.js';
import { registerPromptTool } from './prompt.js';
import { registerListSessionsTool } from './listSessions.js';
import { registerCloseSessionTool } from './closeSession.js';

export function registerAllTools(server: McpServer, sessionManager: SessionManager): void {
  registerNewSessionTool(server, sessionManager);
  registerPromptTool(server, sessionManager);
  registerListSessionsTool(server, sessionManager);
  registerCloseSessionTool(server, sessionManager);
}
