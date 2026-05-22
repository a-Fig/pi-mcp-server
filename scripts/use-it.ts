#!/usr/bin/env tsx
/**
 * "Use the tool for real work" demo.
 *
 * Boots pi-mcp-server in-process, attaches an MCP client over Streamable
 * HTTP, asks pi to read two files from THIS repo and answer questions whose
 * truth we can verify independently. Proves the whole stack end-to-end:
 * MCP transport → tool routing → SessionManager → PiSession → pi SDK →
 * OpenRouter → network → response back to the client.
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

const MODEL = process.env['DEMO_MODEL'] ?? 'openrouter:anthropic/claude-3.5-haiku';
const MAX_COST = 0.05;

interface TextBlock { readonly type: 'text'; readonly text: string }

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (
      typeof block === 'object' && block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as TextBlock).text === 'string'
    ) parts.push((block as TextBlock).text);
  }
  return parts.join('');
}

function makeConfig(port: number, sessionDir: string): Config {
  return { port, host: '127.0.0.1', sessionDir, logLevel: 'warn' };
}

async function main(): Promise<void> {
  if (!process.env['OPENROUTER_API_KEY']) {
    throw new Error('OPENROUTER_API_KEY env var is required');
  }
  const tmpRoot = path.join(os.tmpdir(), `pi-mcp-use-${randomUUID()}`);
  let sessionManager: SessionManager | undefined;
  let httpHandle: { close: () => Promise<void> } | undefined;
  let client: Client | undefined;
  let connected = false;

  try {
    const port = 3850 + Math.floor(Math.random() * 100);
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

    client = new Client({ name: 'use-it', version: '0.0.0' }, { capabilities: {} });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
    );
    connected = true;

    process.stdout.write(`Model: ${MODEL}\n`);
    process.stdout.write(`Repo: ${process.cwd()}\n\n`);

    // --- Spawn session ---
    const newRes = await client.callTool({
      name: 'pi_new_session',
      arguments: { cwd: process.cwd(), model: MODEL, max_cost_usd: MAX_COST },
    });
    if (newRes.isError === true) {
      throw new Error(`pi_new_session failed: ${extractText(newRes.content)}`);
    }
    const sessionId = (newRes.structuredContent as { sessionId?: string } | undefined)?.sessionId;
    if (typeof sessionId !== 'string') throw new Error('no sessionId');
    process.stdout.write(`Spawned session ${sessionId}\n\n`);

    // --- Real task 1: read CHANGELOG.md and pull the version ---
    process.stdout.write(`### Task 1 — version from CHANGELOG.md\n`);
    process.stdout.write(`Asking pi to read CHANGELOG.md and report the latest version.\n\n`);
    const t1 = await client.callTool({
      name: 'pi_prompt',
      arguments: {
        sessionId,
        text:
          'Read the file CHANGELOG.md in the current working directory. Reply with ONLY the latest version number (e.g. "0.1.0"). No prose, no markdown, just the version.',
      },
    });
    const t1sc = t1.structuredContent as { text?: string; costUsd?: number; outputTokens?: number; finishReason?: string } | undefined;
    const t1text = (t1sc?.text ?? '').trim();
    process.stdout.write(`Pi structuredContent: ${JSON.stringify(t1sc)}\n`);
    process.stdout.write(`Pi text: ${JSON.stringify(t1text)}\n`);

    // Independent verification.
    const changelog = await fs.readFile(path.join(process.cwd(), 'CHANGELOG.md'), 'utf8');
    const versionMatch = changelog.match(/##\s*\[(\d+\.\d+\.\d+)\]/);
    const trueVersion = versionMatch?.[1] ?? '';
    const t1ok = t1text.includes(trueVersion);
    process.stdout.write(`Truth (from file): ${trueVersion}\n`);
    process.stdout.write(`Match: ${t1ok ? 'YES' : 'NO'}\n\n`);

    // --- Real task 2: count source files under src/sessions/ ---
    process.stdout.write(`### Task 2 — count .ts files under src/sessions/\n`);
    process.stdout.write(`Asking pi to use its tools to enumerate src/sessions/.\n\n`);
    const t2 = await client.callTool({
      name: 'pi_prompt',
      arguments: {
        sessionId,
        text:
          'Using your tools, list the .ts files directly inside the src/sessions/ directory (not subdirs). Reply with EXACTLY two lines: line 1 is the integer count; line 2 is the filenames sorted alphabetically and joined by commas with no spaces. No prose, no markdown.',
      },
    });
    const t2text = extractText(t2.content).split('\n---\n')[0]?.trim() ?? '';
    const t2cost = (t2.structuredContent as { costUsd?: number } | undefined)?.costUsd;
    process.stdout.write(`Pi answered:\n${t2text}\n(cost $${(t2cost ?? 0).toFixed(6)})\n`);

    // Independent verification.
    const realFiles = (await fs.readdir(path.join(process.cwd(), 'src', 'sessions')))
      .filter((f) => f.endsWith('.ts'))
      .sort();
    const trueLine1 = String(realFiles.length);
    const trueLine2 = realFiles.join(',');
    const piLines = t2text.split('\n').map((l) => l.trim());
    const t2ok = piLines[0] === trueLine1 && piLines[1] === trueLine2;
    process.stdout.write(`Truth: ${trueLine1}\n${trueLine2}\n`);
    process.stdout.write(`Match: ${t2ok ? 'YES' : 'NO'}\n\n`);

    // --- List + close ---
    const listRes = await client.callTool({ name: 'pi_list_sessions', arguments: {} });
    process.stdout.write(
      `Sessions before close: ${extractText(listRes.content).split('\n')[0]}\n`,
    );

    const closeRes = await client.callTool({
      name: 'pi_close_session',
      arguments: { sessionId },
    });
    process.stdout.write(`${extractText(closeRes.content)}\n\n`);

    // --- Final verdict ---
    const allOk = t1ok && t2ok;
    process.stdout.write(`OVERALL: ${allOk ? 'PASS' : 'FAIL'}\n`);
    if (!allOk) process.exit(1);
  } finally {
    if (connected && client !== undefined) await client.close().catch(() => {});
    if (sessionManager !== undefined) await sessionManager.closeAll().catch(() => {});
    if (httpHandle !== undefined) await httpHandle.close().catch(() => {});
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`use-it failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
