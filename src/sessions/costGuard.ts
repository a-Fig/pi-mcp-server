import type { PromptResult } from './types.js';

/**
 * Validate a maxCostUsd value at PiSession construction time. Defined values
 * must be a positive, non-NaN finite number; undefined means "no cap".
 *
 * Throws a descriptive Error rather than returning a result so misconfigured
 * sessions fail fast at create() time instead of at first prompt().
 */
export function validateMaxCostUsd(value: number | undefined): void {
  if (value === undefined) return;
  if (Number.isNaN(value) || value <= 0) {
    throw new Error(`maxCostUsd must be > 0: ${String(value)}`);
  }
}

/** Build a synthetic result for terminal short-circuits (pre-flight cap, error pre-conditions). */
export function buildTerminalResult(
  finishReason: 'error' | 'cost_cap',
  errorMessage: string,
  cumulativeCostUsd: number,
): PromptResult {
  return {
    text: '',
    costUsd: 0,
    cumulativeCostUsd,
    inputTokens: 0,
    outputTokens: 0,
    finishReason,
    errorMessage,
  };
}

/** Render the message used when the cap trips mid-turn or pre-flight. */
export function capReachedMessage(cumulative: number, cap: number): string {
  return `cumulative cost $${cumulative.toFixed(6)} reached cap $${cap.toFixed(6)}`;
}
