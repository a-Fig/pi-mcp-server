import type { Logger } from './log.js';

export interface ShutdownTarget {
  /** Close pi sessions first so no in-flight prompt tries to notify a closed transport. */
  closeSessions(): Promise<void>;
  /** Close the HTTP server (and its transports) after sessions are disposed. */
  closeHttp(): Promise<void>;
}

export interface ShutdownDeps {
  readonly target: ShutdownTarget;
  readonly logger: Logger;
  /**
   * How long to wait for graceful close before forcing exit. Default 5s.
   * The timer is `.unref()`'d so it doesn't keep the loop alive on the
   * happy path; it only matters if cleanup hangs.
   */
  readonly graceMs?: number;
  /** Test seam — defaults to the real process. */
  readonly proc?: ShutdownProcess;
  /** Test seam — defaults to the real setTimeout. */
  readonly setTimer?: typeof setTimeout;
}

export interface ShutdownProcess {
  exit(code: number): never;
  /** Multi-fire registration — a second signal during shutdown must still reach the handler. */
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): void;
}

/**
 * Wire SIGINT / SIGTERM to a two-phase graceful shutdown:
 *
 * 1. First signal → close sessions, then HTTP, then exit 0.
 *    A `graceMs` timeout (default 5s) is the upper bound; if cleanup
 *    deadlocks, the timer fires `process.exit(1)`.
 * 2. Second signal during shutdown → skip the wait and exit immediately
 *    with code 130 (128 + SIGINT). Lets users force-quit with Ctrl+C twice
 *    if the first attempt is stuck.
 *
 * Returns a `runShutdown` reference that callers can invoke directly (for
 * tests, or in response to a non-signal trigger such as an unhandled
 * rejection at the entry point).
 */
export function installShutdownHandlers(deps: ShutdownDeps): () => void {
  const graceMs = deps.graceMs ?? 5_000;
  const proc: ShutdownProcess = deps.proc ?? process;
  const setTimer = deps.setTimer ?? setTimeout;
  let shuttingDown = false;

  const runShutdown = (signal: 'SIGINT' | 'SIGTERM' | 'manual'): void => {
    if (shuttingDown) {
      deps.logger.info('second shutdown signal — forcing exit', { signal });
      proc.exit(130);
      return;
    }
    shuttingDown = true;
    deps.logger.info('shutdown signal received', { signal });

    const forceTimer = setTimer(() => {
      deps.logger.error('forceful exit after timeout', { graceMs });
      proc.exit(1);
    }, graceMs);
    // Unref so the timer never holds the loop open on the happy path.
    if (typeof forceTimer.unref === 'function') forceTimer.unref();

    deps.target
      .closeSessions()
      .catch((err: unknown) => {
        deps.logger.error('closeSessions error', { err: String(err) });
      })
      .then(() => deps.target.closeHttp())
      .then(() => {
        clearTimeout(forceTimer);
        proc.exit(0);
      })
      .catch((err: unknown) => {
        clearTimeout(forceTimer);
        deps.logger.error('shutdown error', { err: String(err) });
        proc.exit(1);
      });
  };

  proc.on('SIGINT', () => runShutdown('SIGINT'));
  proc.on('SIGTERM', () => runShutdown('SIGTERM'));

  return () => runShutdown('manual');
}
