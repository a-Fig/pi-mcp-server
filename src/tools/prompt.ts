import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../sessions/manager.js';
import type { PromptResult } from '../sessions/types.js';

/** Progress token is an opaque MCP value (string or number). */
type ProgressToken = string | number;

interface ProgressParams {
  readonly progressToken: ProgressToken;
  readonly progress: number;
  readonly message: string;
}

/**
 * Start a 10s heartbeat ticker that calls `send` with monotonically increasing
 * progress values. Returns a `stop()` to clear the interval. If `token` is
 * undefined (no progress requested by the client) this is a no-op.
 *
 * Exposed for unit testing — the timer lifecycle is the interesting bit.
 */
export function startHeartbeat(
  send: (params: ProgressParams) => void,
  token: ProgressToken | undefined,
  intervalMs = 10_000,
): () => void {
  if (token === undefined) {
    return () => {};
  }
  let counter = 0;
  const handle = setInterval(() => {
    counter += 1;
    send({ progressToken: token, progress: counter, message: 'pi running' });
  }, intervalMs);
  return () => {
    clearInterval(handle);
  };
}

const inputSchema = {
  sessionId: z.string(),
  text: z.string().min(1).describe('User message text to send to the pi agent.'),
};

function summarize(result: PromptResult): string {
  const base =
    `${result.text}\n\n---\n` +
    `cost: $${result.costUsd.toFixed(6)} | ` +
    `cumulative: $${result.cumulativeCostUsd.toFixed(6)} | ` +
    `tokens (in/out): ${result.inputTokens}/${result.outputTokens} | ` +
    `finishReason: ${result.finishReason}`;
  return result.errorMessage !== undefined ? `${base} | error: ${result.errorMessage}` : base;
}

export function registerPromptTool(server: McpServer, sessionManager: SessionManager): void {
  server.registerTool(
    'pi_prompt',
    {
      description:
        'Send a message to a pi session and wait for the full reply. Emits notifications/progress every 10s during execution so MCP clients don\'t time out. If the session has a max_cost_usd cap, the turn aborts mid-stream when cumulative spend reaches the cap and returns finishReason: "cost_cap" (with any partial text already streamed).',
      inputSchema,
    },
    async (args, extra) => {
      // Start the heartbeat inside the try so any future throw during setup
      // doesn't leak the interval.
      let stopHeartbeat: () => void = () => {};
      try {
        const token = extra._meta?.progressToken;
        stopHeartbeat = startHeartbeat((params) => {
          // Fire-and-forget: don't await inside the timer (would serialize ticks
          // if the network stalls). Swallow errors — the client may have closed.
          extra
            .sendNotification({ method: 'notifications/progress', params })
            .catch(() => {});
        }, token);
        const result = await sessionManager.prompt(args.sessionId, args.text, {
          signal: extra.signal,
        });
        const structured: Record<string, unknown> = {
          text: result.text,
          costUsd: result.costUsd,
          cumulativeCostUsd: result.cumulativeCostUsd,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          finishReason: result.finishReason,
        };
        if (result.errorMessage !== undefined) structured['errorMessage'] = result.errorMessage;
        return {
          content: [{ type: 'text', text: summarize(result) }],
          structuredContent: structured,
          // Any non-completed terminal state (error or cost_cap) is surfaced as
          // isError so MCP clients can react uniformly.
          isError: result.finishReason !== 'completed',
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: message }],
          structuredContent: { errorMessage: message },
        };
      } finally {
        stopHeartbeat();
      }
    },
  );
}
