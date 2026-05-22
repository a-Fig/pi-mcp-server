import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { parseModelString } from './parseModel.js';
import { buildInnerSession } from './bootstrap.js';
import { buildTerminalResult, capReachedMessage, validateMaxCostUsd } from './costGuard.js';
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

type TerminalReason = 'completed' | 'error' | 'cost_cap';

interface TurnState {
  text: string;
  onText?: (delta: string) => void;
  resolve: (r: PromptResult) => void;
  statsBefore: UsageSnapshot;
}

export class PiSession {
  static async create(opts: PiSessionOptions): Promise<PiSession> {
    const inner = await buildInnerSession(opts);
    return new PiSession(opts, inner);
  }

  readonly id: string;
  readonly model: string;
  readonly cwd: string;
  readonly maxCostUsd: number | undefined;
  private readonly inner: PiInnerSession;
  private readonly unsubscribe: () => void;
  private _cumulativeCostUsd = 0;
  private closed = false;
  private active: TurnState | null = null;

  /** Test/internal hook: construct from an already-built inner session. */
  constructor(opts: PiSessionOptions, inner: PiInnerSession) {
    validateMaxCostUsd(opts.maxCostUsd);
    this.id = opts.id;
    this.model = opts.model;
    this.cwd = opts.cwd;
    this.maxCostUsd = opts.maxCostUsd;
    this.inner = inner;
    this.unsubscribe = inner.subscribe((ev) => this.onEvent(ev));
  }

  get cumulativeCostUsd(): number {
    return this._cumulativeCostUsd;
  }

  async prompt(text: string, opts?: PromptOptions): Promise<PromptResult> {
    if (this.closed) return this.terminalResult('error', 'session closed');
    if (this.active !== null) return this.terminalResult('error', 'another prompt is already in progress');
    const cap = this.maxCostUsd;
    if (cap !== undefined && this._cumulativeCostUsd >= cap) {
      return this.terminalResult('cost_cap', capReachedMessage(this._cumulativeCostUsd, cap));
    }
    const signal = opts?.signal;
    if (signal?.aborted === true) return this.terminalResult('error', 'aborted before send');

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

  // We assume pi delivers subscribe events synchronously and in order. A
  // single prompt may produce MULTIPLE `turn_end` events when the model uses
  // tools (one per tool-call round); the agent's final answer lands at
  // `agent_end`. We therefore resolve on `agent_end`, accumulating text_deltas
  // across all intermediate turns (tool-call deltas are filtered out by their
  // discriminator).
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
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const cap = this.maxCostUsd;
      if (cap !== undefined) {
        const after = this.inner.getUsageSnapshot();
        if (after.cost >= cap) {
          this.inner.abort().catch(() => {});
          this.finishActive('cost_cap', capReachedMessage(after.cost, cap));
        }
      }
      return;
    }
    if (event.type === 'agent_end') {
      this.finishActive('completed');
    }
  }

  private finishActive(finishReason: TerminalReason, errorMessage?: string): void {
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
    if (finishReason === 'completed') {
      turn.resolve({ ...base, finishReason });
    } else {
      turn.resolve({ ...base, finishReason, errorMessage: errorMessage ?? 'unknown error' });
    }
  }

  private terminalResult(finishReason: 'error' | 'cost_cap', message: string): PromptResult {
    return buildTerminalResult(finishReason, message, this._cumulativeCostUsd);
  }
}
