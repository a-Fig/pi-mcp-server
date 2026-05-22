import fs from 'node:fs/promises';
import {
  type AgentSession,
  type AgentSessionEvent,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';
import { parseModelString } from './parseModel.js';
import type {
  PiInnerSession,
  PiSessionOptions,
  PromptOptions,
  PromptResult,
  UsageSnapshot,
} from './types.js';

export { parseModelString };
export type {
  PiInnerSession,
  PiSessionOptions,
  PromptOptions,
  PromptResult,
  ThinkingLevel,
  UsageSnapshot,
} from './types.js';

interface TurnState {
  text: string;
  onText?: (delta: string) => void;
  resolve: (r: PromptResult) => void;
  statsBefore: UsageSnapshot;
}

function adaptAgentSession(s: AgentSession): PiInnerSession {
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

export class PiSession {
  static async create(opts: PiSessionOptions): Promise<PiSession> {
    // Validate model BEFORE creating the agent dir so a bad string doesn't leak an empty dir.
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
    return new PiSession(opts, adaptAgentSession(created.session));
  }

  readonly id: string;
  readonly model: string;
  readonly cwd: string;
  private readonly inner: PiInnerSession;
  private readonly unsubscribe: () => void;
  private _cumulativeCostUsd = 0;
  private closed = false;
  private active: TurnState | null = null;

  /** Test/internal hook: construct from an already-built inner session. */
  constructor(opts: PiSessionOptions, inner: PiInnerSession) {
    this.id = opts.id;
    this.model = opts.model;
    this.cwd = opts.cwd;
    this.inner = inner;
    this.unsubscribe = inner.subscribe((ev) => this.onEvent(ev));
  }

  get cumulativeCostUsd(): number {
    return this._cumulativeCostUsd;
  }

  async prompt(text: string, opts?: PromptOptions): Promise<PromptResult> {
    if (this.closed) return this.errorResult('session closed');
    if (this.active !== null) return this.errorResult('another prompt is already in progress');
    const signal = opts?.signal;
    if (signal?.aborted === true) return this.errorResult('aborted before send');

    const turn: TurnState = {
      text: '',
      resolve: () => {},
      statsBefore: this.inner.getUsageSnapshot(),
    };
    if (opts?.onText !== undefined) turn.onText = opts.onText;
    const result = new Promise<PromptResult>((resolve) => {
      turn.resolve = resolve;
    });
    this.active = turn;

    const onAbort = (): void => {
      this.inner.abort().catch(() => {});
      this.finishActive('error', 'aborted');
    };
    if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true });

    try {
      await this.inner.prompt(text);
    } catch (err) {
      this.finishActive('error', err instanceof Error ? err.message : String(err));
    } finally {
      if (signal !== undefined) signal.removeEventListener('abort', onAbort);
    }
    return result;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    if (this.active !== null) this.finishActive('error', 'session closed mid-turn');
    this.inner.dispose();
  }

  // We assume pi delivers subscribe events synchronously and in order within a
  // turn, so by the time `turn_end` fires, every `message_end` for that turn
  // has already been observed here. If pi ever switches to async delivery this
  // invariant would need re-checking.
  private onEvent(event: AgentSessionEvent): void {
    const turn = this.active;
    if (turn === null) return;
    if (event.type === 'message_update') {
      const ev = event.assistantMessageEvent;
      if (ev.type === 'text_delta') {
        turn.text += ev.delta;
        if (turn.onText !== undefined) turn.onText(ev.delta);
      }
      return;
    }
    if (event.type === 'turn_end') {
      this.finishActive('completed');
      return;
    }
    if (event.type === 'agent_end') {
      // Terminal fallback: if turn_end already fired, this.active is null and
      // finishActive is a no-op. Otherwise the turn ended without turn_end →
      // surface as error so the prompt() caller never sees a fake success.
      this.finishActive('error', 'agent ended without turn_end');
    }
  }

  private finishActive(finishReason: 'completed' | 'error', errorMessage?: string): void {
    const turn = this.active;
    if (turn === null) return;
    this.active = null;
    const after = this.inner.getUsageSnapshot();
    const costUsd = Math.max(0, after.cost - turn.statsBefore.cost);
    const inputTokens = Math.max(0, after.inputTokens - turn.statsBefore.inputTokens);
    const outputTokens = Math.max(0, after.outputTokens - turn.statsBefore.outputTokens);
    this._cumulativeCostUsd = after.cost;
    const base = {
      text: turn.text,
      costUsd,
      cumulativeCostUsd: this._cumulativeCostUsd,
      inputTokens,
      outputTokens,
    } as const;
    if (finishReason === 'error') {
      turn.resolve({ ...base, finishReason, errorMessage: errorMessage ?? 'unknown error' });
    } else {
      turn.resolve({ ...base, finishReason });
    }
  }

  private errorResult(msg: string): PromptResult {
    return {
      text: '',
      costUsd: 0,
      cumulativeCostUsd: this._cumulativeCostUsd,
      inputTokens: 0,
      outputTokens: 0,
      finishReason: 'error',
      errorMessage: msg,
    };
  }
}
