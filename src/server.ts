import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from './log.js';
import { PACKAGE_NAME, PACKAGE_VERSION } from './pkg.js';
import { registerAllTools } from './tools/index.js';

export interface ServerDeps {
  readonly logger: Logger;
}

export function buildMcpServer(deps: ServerDeps): McpServer {
  const server = new McpServer(
    { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    { capabilities: {} },
  );
  registerAllTools(server);
  deps.logger.debug('mcp server built', { name: PACKAGE_NAME, version: PACKAGE_VERSION });
  return server;
}
