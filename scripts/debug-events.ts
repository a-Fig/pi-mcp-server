#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';

const MODEL = process.env['DEBUG_MODEL'] ?? 'openrouter:anthropic/claude-3.5-haiku';

async function main(): Promise<void> {
  const [provider, ...rest] = MODEL.split(':');
  const modelId = rest.join(':');
  const tmp = path.join(os.tmpdir(), `pi-debug-${randomUUID()}`);
  await fs.mkdir(tmp, { recursive: true });
  try {
    const auth = AuthStorage.inMemory();
    const registry = ModelRegistry.create(auth);
    const model = registry.find(provider!, modelId);
    if (!model) throw new Error(`Model not found: ${MODEL}`);
    const { session } = await createAgentSession({
      cwd: process.cwd(),
      agentDir: tmp,
      authStorage: auth,
      modelRegistry: registry,
      model,
      settingsManager: SettingsManager.inMemory(),
      sessionManager: SessionManager.create(process.cwd(), tmp),
    });
    session.subscribe((ev) => {
      // Compact: print type + the smallest distinguishing fields.
      const e = ev as { type: string; assistantMessageEvent?: { type?: string; delta?: string }; message?: { role?: string; content?: unknown[] } };
      const detail: string[] = [e.type];
      if (e.assistantMessageEvent?.type) detail.push(`ame=${e.assistantMessageEvent.type}`);
      if (typeof e.assistantMessageEvent?.delta === 'string') {
        detail.push(`delta=${JSON.stringify(e.assistantMessageEvent.delta.slice(0, 60))}`);
      }
      if (e.message?.role) detail.push(`role=${e.message.role}`);
      if (Array.isArray(e.message?.content)) {
        const types = e.message.content.map((c) => (c as { type?: string }).type ?? '?').join(',');
        detail.push(`content=[${types}]`);
      }
      process.stdout.write(detail.join(' ') + '\n');
    });
    await session.prompt('Read CHANGELOG.md in the current directory. Reply with only the version string from the top entry.');
    process.stdout.write('\n--- prompt done ---\n');
    session.dispose();
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => { process.stderr.write(`${String(e)}\n`); process.exit(1); });
