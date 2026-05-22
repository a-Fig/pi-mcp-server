#!/usr/bin/env tsx
/**
 * End-to-end MCP smoke test for L4.
 *
 * Spins up a real pi-mcp-server (HTTP transport), connects an MCP client over
 * Streamable HTTP, exercises pi_new_session → pi_prompt → pi_list_sessions →
 * pi_close_session against a cheap OpenRouter model, and tears everything
 * down. Cost target: < $0.001.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AuthStorage } from '@earendil-works/pi-coding-agent';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createLogger } from '../src/log.js';
import { buildMcpServer } from '../src/server.js';
import { startHttpServer } from '../src/http.js';
import { SessionManager } from '../src/sessions/manager.js';
import type { Config } from '../src/config.js';

const MODEL = process.env['SMOKE_MODEL'] ?? 'openrouter:amazon/nova-micro-v1';

function makeConfig(port: number, sessionDir: string): Config {
  return { port, host: '127.0.0.1', sessionDir, logLevel: 'info' };
}

function pickPort(): number {
  return 3710 + Math.floor(Math.random() * 100);
}

interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as TextBlock).text === 'string'
    ) {
      parts.push((block as TextBlock).text);
    }
  }
  return parts.join('');
}

async function main(): Promise<void> {
  if (!process.env['OPENROUTER_API_KEY']) {
    throw new Error('OPENROUTER_API_KEY env var is required for the smoke test');
  }

  // Hoist every resource that may need cleanup to outer scope so the `finally`
  // can run regardless of which await rejects first.
  const tmpRoot = path.join(os.tmpdir(), `pi-mcp-smoke-l4-${randomUUID()}`);
  let sessionManager: SessionManager | undefined;
  let httpHandle: { close: () => Promise<void> } | undefined;
  let client: Client | undefined;
  let connected = false;

  try {
    const port = pickPort();
    const sessionDir = path.join(tmpRoot, 'pi-mcp');
    const config = makeConfig(port, sessionDir);
    const logger = createLogger(config.logLevel);
    // In-memory AuthStorage: pi falls back to the OPENROUTER_API_KEY env var.
    // We deliberately don't touch the user's global ~/.pi/agent/auth.json.
    const authStorage = AuthStorage.inMemory();
    sessionManager = new SessionManager({ sessionDir, authStorage, logger });

    httpHandle = await startHttpServer(
      config,
      () => buildMcpServer({ logger, sessionManager: sessionManager as SessionManager }),
      logger,
    );

    client = new Client(
      { name: 'pi-mcp-smoke-l4', version: '0.0.0' },
      { capabilities: {} },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    await client.connect(transport);
    connected = true;

    process.stdout.write(`# pi_new_session\n`);
    const newRes = await client.callTool({
      name: 'pi_new_session',
      arguments: { cwd: process.cwd(), model: MODEL },
    });
    if (newRes.isError === true) {
      throw new Error(`pi_new_session failed: ${extractText(newRes.content)}`);
    }
    const sc = newRes.structuredContent as { sessionId?: string } | undefined;
    const sessionId = sc?.sessionId;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('pi_new_session did not return a sessionId');
    }
    process.stdout.write(`sessionId: ${sessionId}\n`);
    process.stdout.write(`${extractText(newRes.content)}\n\n`);

    process.stdout.write(`# pi_prompt\n`);
    const promptRes = await client.callTool({
      name: 'pi_prompt',
      arguments: { sessionId, text: 'Say hi in exactly 3 words. No punctuation.' },
    });
    process.stdout.write(`${extractText(promptRes.content)}\n`);
    process.stdout.write(
      `structuredContent: ${JSON.stringify(promptRes.structuredContent, null, 2)}\n\n`,
    );
    if (promptRes.isError === true) {
      throw new Error(`pi_prompt failed: ${extractText(promptRes.content)}`);
    }

    process.stdout.write(`# pi_list_sessions\n`);
    const listRes = await client.callTool({ name: 'pi_list_sessions', arguments: {} });
    process.stdout.write(`${extractText(listRes.content)}\n`);
    process.stdout.write(
      `structuredContent: ${JSON.stringify(listRes.structuredContent, null, 2)}\n\n`,
    );

    process.stdout.write(`# pi_close_session\n`);
    const closeRes = await client.callTool({
      name: 'pi_close_session',
      arguments: { sessionId },
    });
    process.stdout.write(`${extractText(closeRes.content)}\n`);
    process.stdout.write(
      `structuredContent: ${JSON.stringify(closeRes.structuredContent, null, 2)}\n\n`,
    );

    process.stdout.write(`OK\n`);
  } finally {
    if (connected && client !== undefined) {
      await client.close().catch(() => {});
    }
    if (sessionManager !== undefined) {
      await sessionManager.closeAll().catch(() => {});
    }
    if (httpHandle !== undefined) {
      await httpHandle.close().catch(() => {});
    }
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `smoke-l4 failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
