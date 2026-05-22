import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { agentDirFor } from '../../src/sessions/paths.js';

describe('agentDirFor', () => {
  it('joins sessionDir/sessions/<id>', () => {
    const root = path.resolve('/tmp/pi-mcp');
    expect(agentDirFor('abc123', root)).toBe(path.join(root, 'sessions', 'abc123'));
  });

  it('rejects ".."', () => {
    expect(() => agentDirFor('..', '/tmp/pi-mcp')).toThrow(/Invalid sessionId/);
  });

  it('rejects ids containing ".."', () => {
    expect(() => agentDirFor('a..b', '/tmp/pi-mcp')).toThrow(/contains/);
  });

  it('rejects forward slash separator', () => {
    expect(() => agentDirFor('a/b', '/tmp/pi-mcp')).toThrow(/separator/);
  });

  it('rejects backslash separator', () => {
    expect(() => agentDirFor('a\\b', '/tmp/pi-mcp')).toThrow(/separator/);
  });

  it('rejects empty id', () => {
    expect(() => agentDirFor('', '/tmp/pi-mcp')).toThrow(/Invalid sessionId/);
  });

  it('rejects "."', () => {
    expect(() => agentDirFor('.', '/tmp/pi-mcp')).toThrow(/Invalid sessionId/);
  });
});
