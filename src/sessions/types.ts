import type { AgentSessionEvent, AuthStorage } from '@earendil-works/pi-coding-agent';

/** Mirrors pi-agent-core's ThinkingLevel union (not re-exported by pi-coding-agent). */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface PiSessionOptions {
  readonly id: string;
  readonly cwd: string;
  readonly agentDir: string;
  readonly authStorage: AuthStorage;
  readonly model: string;
  readonly thinkingLevel?: ThinkingLevel;
  readonly systemPrompt?: string;
}

export interface PromptResult {
  readonly text: string;
  readonly costUsd: number;
  readonly cumulativeCostUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly finishReason: 'completed' | 'error';
  readonly errorMessage?: string;
}

export interface PromptOptions {
  readonly onText?: (delta: string) => void;
  readonly signal?: AbortSignal;
}

/** Snapshot of cumulative usage for delta calculation across a turn. */
export interface UsageSnapshot {
  readonly cost: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Minimal adapter over the pi AgentSession. Only the surface PiSession actually
 * uses, so tests can drive a fake without depending on pi internals.
 */
export interface PiInnerSession {
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  /**
   * Intentionally narrowed to `(text)` only. Pi's real `prompt` accepts a
   * second `PromptOptions` arg for streaming-behavior / images / templates;
   * expand this signature when steering or follow-ups are wired in.
   */
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  getUsageSnapshot(): UsageSnapshot;
  dispose(): void;
}
