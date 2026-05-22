import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startHeartbeat } from '../../src/tools/prompt.js';

describe('startHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when token is undefined (and stop() is safe)', () => {
    const send = vi.fn();
    const stop = startHeartbeat(send, undefined);
    vi.advanceTimersByTime(60_000);
    expect(send).not.toHaveBeenCalled();
    // Calling stop() must not throw or call send.
    expect(() => stop()).not.toThrow();
    vi.advanceTimersByTime(60_000);
    expect(send).not.toHaveBeenCalled();
  });

  it('fires every 10s with monotonically increasing progress when token is set', () => {
    const send = vi.fn();
    const token = 'pt-1';
    const stop = startHeartbeat(send, token);
    // First tick at +10s.
    vi.advanceTimersByTime(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    // Then +20s and +30s.
    vi.advanceTimersByTime(20_000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0]?.[0]).toEqual({
      progressToken: token,
      progress: 1,
      message: 'pi running',
    });
    expect(send.mock.calls[1]?.[0]?.progress).toBe(2);
    expect(send.mock.calls[2]?.[0]?.progress).toBe(3);
    stop();
  });

  it('stops firing after stop()', () => {
    const send = vi.fn();
    const stop = startHeartbeat(send, 42);
    vi.advanceTimersByTime(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('accepts a custom intervalMs', () => {
    const send = vi.fn();
    const stop = startHeartbeat(send, 'tok', 250);
    vi.advanceTimersByTime(1_000);
    expect(send).toHaveBeenCalledTimes(4);
    stop();
  });
});
