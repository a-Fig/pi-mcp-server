#!/usr/bin/env tsx
/**
 * Real OpenRouter smoke test for PiSession.
 *
 * Spawns a fresh pi agent against a cheap OpenRouter model, sends one prompt,
 * prints the streamed response, then prints a JSON summary. Cleans up the temp
 * agentDir on exit (success or failure).
 *
 * Cost target: < $0.001. Default model: openrouter:amazon/nova-micro-v1
 * ($0.035 in / $0.14 out per million tokens).
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AuthStorage } from '@earendil-works/pi-coding-agent';
import { PiSession } from '../src/sessions/session.js';

const MODEL = process.env['SMOKE_MODEL'] ?? 'openrouter:amazon/nova-micro-v1';

async function main(): Promise<void> {
  if (!process.env['OPENROUTER_API_KEY']) {
    throw new Error('OPENROUTER_API_KEY env var is required for the smoke test');
  }
  const sessionId = randomUUID();
  const smokeParent = path.join(os.tmpdir(), 'pi-mcp-smoke');
  const agentDir = path.join(smokeParent, sessionId);
  const cwd = process.cwd();
  // In-memory auth so we don't read/write the user's ~/.pi/agent/auth.json.
  // Pi will fall back to the OPENROUTER_API_KEY env var.
  const authStorage = AuthStorage.inMemory();
  let session: PiSession | null = null;
  try {
    session = await PiSession.create({
      id: sessionId,
      cwd,
      agentDir,
      authStorage,
      model: MODEL,
    });
    const result = await session.prompt('Say hi in exactly 3 words. No punctuation.', {
      onText: (delta) => process.stdout.write(delta),
    });
    process.stdout.write('\n');
    const summary = {
      model: MODEL,
      text: result.text,
      costUsd: result.costUsd,
      cumulativeCostUsd: result.cumulativeCostUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      finishReason: result.finishReason,
      ...(result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {}),
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (result.finishReason !== 'completed') {
      throw new Error(`prompt did not complete: ${result.errorMessage ?? 'unknown'}`);
    }
  } finally {
    if (session !== null) await session.close();
    await fs.rm(agentDir, { recursive: true, force: true });
    // Also remove the shared parent dir so repeated runs don't accumulate
    // empty UUID dirs. force-recursive is safe: only this script writes here.
    await fs.rm(smokeParent, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`smoke failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
