import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installShutdownHandlers, type ShutdownProcess } from '../../src/shutdown.js';
import type { Logger } from '../../src/log.js';

const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

interface FakeProcess extends ShutdownProcess {
  emit(event: 'SIGINT' | 'SIGTERM'): void;
  exitCalls: number[];
}

function makeProc(): FakeProcess {
  const handlers = new Map<'SIGINT' | 'SIGTERM', () => void>();
  const exitCalls: number[] = [];
  return {
    exitCalls,
    // Real `process.exit` never returns; we instead just record calls. The
    // shutdown code clears the force-timer and ends its promise chain after
    // calling exit(), so leaking control here doesn't change observable
    // behaviour in production.
    exit(code: number): never {
      exitCalls.push(code);
      return undefined as never;
    },
    on(event, listener) {
      handlers.set(event, listener);
    },
    emit(event) {
      const h = handlers.get(event);
      if (h !== undefined) h();
    },
  };
}

describe('installShutdownHandlers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs closeSessions before closeHttp then exits 0', async () => {
    const proc = makeProc();
    const order: string[] = [];
    installShutdownHandlers({
      logger: silentLogger,
      target: {
        closeSessions: async () => {
          order.push('sessions');
        },
        closeHttp: async () => {
          order.push('http');
        },
      },
      proc,
    });
    proc.emit('SIGINT');
    await vi.runAllTimersAsync();
    expect(order).toEqual(['sessions', 'http']);
    expect(proc.exitCalls).toEqual([0]);
  });

  it('force-exits with code 1 if cleanup hangs past graceMs', async () => {
    const proc = makeProc();
    installShutdownHandlers({
      logger: silentLogger,
      target: {
        closeSessions: () => new Promise(() => {}),
        closeHttp: () => new Promise(() => {}),
      },
      proc,
      graceMs: 5_000,
    });
    proc.emit('SIGTERM');
    expect(proc.exitCalls).toEqual([]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(proc.exitCalls).toEqual([1]);
  });

  it('still exits 0 if closeSessions rejects (closeHttp still runs)', async () => {
    const proc = makeProc();
    let httpClosed = false;
    installShutdownHandlers({
      logger: silentLogger,
      target: {
        closeSessions: async () => {
          throw new Error('boom');
        },
        closeHttp: async () => {
          httpClosed = true;
        },
      },
      proc,
    });
    proc.emit('SIGINT');
    await vi.runAllTimersAsync();
    expect(httpClosed).toBe(true);
    expect(proc.exitCalls).toEqual([0]);
  });

  it('second signal during shutdown forces immediate exit 130', () => {
    const proc = makeProc();
    installShutdownHandlers({
      logger: silentLogger,
      target: {
        closeSessions: () => new Promise(() => {}),
        closeHttp: () => new Promise(() => {}),
      },
      proc,
    });
    proc.emit('SIGINT');
    expect(proc.exitCalls).toEqual([]);
    proc.emit('SIGINT');
    expect(proc.exitCalls).toEqual([130]);
  });
});
