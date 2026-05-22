import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Config } from './config.js';
import type { Logger } from './log.js';

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface HttpServerHandle {
  readonly server: http.Server;
  close(): Promise<void>;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}

function send(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on('error', reject);
  });
}

export async function startHttpServer(
  config: Config,
  buildServer: () => McpServer,
  logger: Logger,
): Promise<HttpServerHandle> {
  const sessions = new Map<string, Session>();

  function makeSession(): Session {
    const mcpServer = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, server: mcpServer });
        logger.debug('session initialized', { sessionId: id });
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
        logger.debug('session closed', { sessionId: id });
      },
    });
    // SDK 1.29's StreamableHTTPServerTransport declares `onclose`/`onerror`/`onmessage`
    // as get/set accessors of type `(... ) => void | undefined`, while the `Transport`
    // interface uses `?:` optionals. Under `exactOptionalPropertyTypes` those shapes are
    // incompatible even though the runtime behaviour matches. Cast through `unknown`
    // exactly once at this boundary.
    mcpServer.connect(transport as unknown as Transport).catch((err: unknown) => {
      logger.error('mcp server connect failed', { err: String(err) });
    });
    return { transport, server: mcpServer };
  }

  const allowedHosts = new Set([
    `${config.host}:${config.port}`,
    `localhost:${config.port}`,
  ]);

  async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // DNS-rebinding defence: only accept Host headers that match our bind address.
    // Localhost MCP servers without this check can be hit by attacker-controlled
    // pages whose hostname resolves to 127.0.0.1.
    const hostHeader = getHeader(req, 'host');
    if (hostHeader === undefined || !allowedHosts.has(hostHeader)) {
      send(res, 421, JSON.stringify({ error: 'host header mismatch' }));
      return;
    }
    const url = req.url ?? '';
    const method = req.method ?? 'GET';
    const pathOnly = url.split('?')[0];
    if (pathOnly !== '/mcp') {
      send(res, 404, JSON.stringify({ error: 'not found' }));
      return;
    }
    if (method !== 'POST' && method !== 'GET' && method !== 'DELETE') {
      res.setHeader('allow', 'GET, POST, DELETE');
      send(res, 405, JSON.stringify({ error: 'method not allowed' }));
      return;
    }
    let body: unknown;
    if (method === 'POST') {
      const ct = getHeader(req, 'content-type') ?? '';
      if (!ct.toLowerCase().includes('application/json')) {
        send(res, 415, JSON.stringify({ error: 'unsupported media type; expected application/json' }));
        return;
      }
      try {
        body = await readJsonBody(req);
      } catch (err) {
        const code = err instanceof Error && err.message === 'payload too large' ? 413 : 400;
        send(res, code, JSON.stringify({ error: 'invalid request body', detail: String(err) }));
        return;
      }
    }
    const sid = getHeader(req, 'mcp-session-id');
    let session: Session | undefined;
    let provisional = false;
    if (sid !== undefined) {
      session = sessions.get(sid);
      if (!session) {
        send(res, 404, JSON.stringify({ error: 'unknown session id' }));
        return;
      }
    } else {
      session = makeSession();
      provisional = true;
    }
    const transport = session.transport;
    try {
      await transport.handleRequest(req, res, body);
    } catch (err) {
      logger.error('transport handleRequest threw', { err: String(err) });
      if (!res.headersSent) {
        send(res, 500, JSON.stringify({ error: 'internal error' }));
      }
    } finally {
      // If a fresh transport was created but the request did not establish a session
      // (e.g. the client didn't send a valid initialize), `onsessioninitialized` never
      // fired and the transport is not in the sessions map. Close it to avoid leaks.
      if (provisional && transport.sessionId === undefined) {
        transport.close().catch((err: unknown) => {
          logger.warn('orphan transport close failed', { err: String(err) });
        });
      }
    }
  }

  const httpServer = http.createServer((req, res) => {
    onRequest(req, res).catch((err: unknown) => {
      logger.error('unhandled request error', { err: String(err) });
      if (!res.headersSent) {
        send(res, 500, JSON.stringify({ error: 'internal error' }));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  async function close(): Promise<void> {
    const transports = Array.from(sessions.values()).map((s) => s.transport);
    sessions.clear();
    await Promise.allSettled(transports.map((t) => t.close()));
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  }

  return { server: httpServer, close };
}
