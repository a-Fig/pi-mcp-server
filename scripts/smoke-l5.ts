#!/usr/bin/env tsx
/**
 * End-to-end MCP smoke test for L5 — per-session cost cap.
 *
 * Spins up a real pi-mcp-server (HTTP transport), creates a session with a
 * tiny max_cost_usd (small enough that the first prompt will trip the cap),
 * then issues two prompts:
 *   1. A normal text prompt — expected to abort mid-stream with finishReason: 'cost_cap'.
 *   2. A follow-up prompt — expected to short-circuit immediately with the
 *      same finishReason (pre-flight cap check, no real pi call).
 *
 * Cost target: a few hundred microcents at most.
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
// Cap small enough that even one short prompt will reach it. nova-micro input
// is ~$0.035/M tokens; with a real system prompt the first turn easily clears
// $0.00005 (the contract's worked example).
const CAP_USD = 0.00005;

function makeConfig(port: number, sessionDir: string): Config {
  return { port, host: '127.0.0.1', sessionDir, logLevel: 'info' };
}

function pickPort(): number {
  return 3810 + Math.floor(Math.random() * 100);
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

interface PromptStructured {
  finishReason?: string;
  errorMessage?: string;
  cumulativeCostUsd?: number;
}

async function main(): Promise<void> {
  if (!process.env['OPENROUTER_API_KEY']) {
    throw new Error('OPENROUTER_API_KEY env var is required for the smoke test');
  }

  const tmpRoot = path.join(os.tmpdir(), `pi-mcp-smoke-l5-${randomUUID()}`);
  let sessionManager: SessionManager | undefined;
  let httpHandle: { close: () => Promise<void> } | undefined;
  let client: Client | undefined;
  let connected = false;

  try {
    const port = pickPort();
    const sessionDir = path.join(tmpRoot, 'pi-mcp');
    const config = makeConfig(port, sessionDir);
    const logger = createLogger(config.logLevel);
    const authStorage = AuthStorage.inMemory();
    sessionManager = new SessionManager({ sessionDir, authStorage, logger });

    httpHandle = await startHttpServer(
      config,
      () => buildMcpServer({ logger, sessionManager: sessionManager as SessionManager }),
      logger,
    );

    client = new Client(
      { name: 'pi-mcp-smoke-l5', version: '0.0.0' },
      { capabilities: {} },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    await client.connect(transport);
    connected = true;

    process.stdout.write(`# pi_new_session (max_cost_usd=${CAP_USD})\n`);
    const newRes = await client.callTool({
      name: 'pi_new_session',
      arguments: { cwd: process.cwd(), model: MODEL, max_cost_usd: CAP_USD },
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

    process.stdout.write(`# pi_prompt #1 (expect mid-turn cost_cap)\n`);
    const prompt1 = await client.callTool({
      name: 'pi_prompt',
      arguments: { sessionId, text: 'Summarize what an MCP server is in two sentences.' },
    });
    process.stdout.write(`${extractText(prompt1.content)}\n`);
    process.stdout.write(
      `structuredContent: ${JSON.stringify(prompt1.structuredContent, null, 2)}\n\n`,
    );
    const sc1 = prompt1.structuredContent as PromptStructured | undefined;
    if (sc1?.finishReason !== 'cost_cap') {
      throw new Error(
        `expected finishReason "cost_cap" on first prompt, got ${JSON.stringify(sc1?.finishReason)}`,
      );
    }
    if (!extractText(prompt1.content).toLowerCase().includes('cap')) {
      throw new Error('expected human-readable content to mention the cap');
    }
    if (prompt1.isError !== true) {
      throw new Error('expected isError=true for cost_cap result');
    }

    process.stdout.write(`# pi_prompt #2 (expect pre-flight cost_cap short-circuit)\n`);
    const prompt2 = await client.callTool({
      name: 'pi_prompt',
      arguments: { sessionId, text: 'Try again please.' },
    });
    process.stdout.write(`${extractText(prompt2.content)}\n`);
    process.stdout.write(
      `structuredContent: ${JSON.stringify(prompt2.structuredContent, null, 2)}\n\n`,
    );
    const sc2 = prompt2.structuredContent as PromptStructured | undefined;
    if (sc2?.finishReason !== 'cost_cap') {
      throw new Error(
        `expected finishReason "cost_cap" on second prompt, got ${JSON.stringify(sc2?.finishReason)}`,
      );
    }
    if (sc2.cumulativeCostUsd === undefined || sc2.cumulativeCostUsd < CAP_USD) {
      throw new Error(
        `expected cumulativeCostUsd >= cap (${CAP_USD}), got ${String(sc2.cumulativeCostUsd)}`,
      );
    }

    process.stdout.write(`# pi_close_session\n`);
    const closeRes = await client.callTool({
      name: 'pi_close_session',
      arguments: { sessionId },
    });
    process.stdout.write(`${extractText(closeRes.content)}\n\n`);

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
    `smoke-l5 failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
