import path from 'node:path';

// Reject both `/` and `\` regardless of host OS: sessionIds may come from
// clients on a different platform (e.g. macOS Claude Code talking to a
// Windows-hosted server), and we don't want a client-side string to escape
// the sessions root on either side.
const SEP_RE = /[\\/]/;

export function agentDirFor(sessionId: string, sessionDir: string): string {
  if (sessionId === '' || sessionId === '.' || sessionId === '..') {
    throw new Error(`Invalid sessionId: ${JSON.stringify(sessionId)}`);
  }
  if (SEP_RE.test(sessionId)) {
    throw new Error(`Invalid sessionId: contains path separator: ${JSON.stringify(sessionId)}`);
  }
  if (sessionId.includes('..')) {
    throw new Error(`Invalid sessionId: contains "..": ${JSON.stringify(sessionId)}`);
  }
  return path.join(sessionDir, 'sessions', sessionId);
}
