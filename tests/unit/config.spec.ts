import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('returns defaults for empty env', () => {
    const c = loadConfig({});
    expect(c.port).toBe(3700);
    expect(c.host).toBe('127.0.0.1');
    expect(c.logLevel).toBe('info');
    expect(c.sessionDir).toBe(path.join(os.homedir(), '.pi-mcp'));
  });

  it('overrides port from PORT', () => {
    expect(loadConfig({ PORT: '4000' }).port).toBe(4000);
  });

  it('throws on non-numeric PORT', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid PORT/);
  });

  it('throws on out-of-range PORT (0)', () => {
    expect(() => loadConfig({ PORT: '0' })).toThrow(/Invalid PORT/);
  });

  it('throws on out-of-range PORT (65536)', () => {
    expect(() => loadConfig({ PORT: '65536' })).toThrow(/Invalid PORT/);
  });

  it('throws on invalid LOG_LEVEL', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'wow' })).toThrow(/Invalid LOG_LEVEL/);
  });

  it('accepts valid LOG_LEVEL', () => {
    expect(loadConfig({ LOG_LEVEL: 'debug' }).logLevel).toBe('debug');
    expect(loadConfig({ LOG_LEVEL: 'error' }).logLevel).toBe('error');
  });

  it('resolves SESSION_DIR to absolute path', () => {
    const c = loadConfig({ SESSION_DIR: 'rel/dir' });
    expect(path.isAbsolute(c.sessionDir)).toBe(true);
  });
});
