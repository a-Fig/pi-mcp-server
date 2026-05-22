import fs from 'node:fs/promises';
import {
  type AgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';
import { parseModelString } from './parseModel.js';
import type { PiInnerSession, PiSessionOptions } from './types.js';

/** Wrap a real pi AgentSession in the minimal PiInnerSession shape PiSession consumes. */
export function adaptAgentSession(s: AgentSession): PiInnerSession {
  return {
    subscribe: (l) => s.subscribe(l),
    prompt: (t) => s.prompt(t),
    abort: () => s.abort(),
    getUsageSnapshot: () => {
      const stats = s.getSessionStats();
      return { cost: stats.cost, inputTokens: stats.tokens.input, outputTokens: stats.tokens.output };
    },
    dispose: () => s.dispose(),
  };
}

/**
 * Resolve the model, ensure the agentDir exists, build a fresh pi AgentSession,
 * and return the PiInnerSession adapter ready to hand to PiSession's constructor.
 *
 * Model resolution happens BEFORE mkdir so a bad model string doesn't leak an
 * empty agent dir on disk.
 */
export async function buildInnerSession(opts: PiSessionOptions): Promise<PiInnerSession> {
  const registry = ModelRegistry.create(opts.authStorage);
  const { provider, modelId } = parseModelString(opts.model);
  const model = registry.find(provider, modelId);
  if (!model) {
    throw new Error(`Model not found: provider=${JSON.stringify(provider)} id=${JSON.stringify(modelId)}`);
  }
  await fs.mkdir(opts.agentDir, { recursive: true });
  const created = await createAgentSession({
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    authStorage: opts.authStorage,
    modelRegistry: registry,
    model,
    ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
    // In-memory settings so we never mutate the user's global pi settings.
    settingsManager: SettingsManager.inMemory(),
    // pi 0.74.1: SessionManager.create(cwd, agentDir)
    sessionManager: SessionManager.create(opts.cwd, opts.agentDir),
  });
  return adaptAgentSession(created.session);
}
