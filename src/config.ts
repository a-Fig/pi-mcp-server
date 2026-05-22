import os from 'node:os';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  readonly port: number;
  readonly host: string;
  readonly sessionDir: string;
  readonly logLevel: LogLevel;
}

const DEFAULT_PORT = 3700;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_LOG_LEVEL: LogLevel = 'info';
const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`Invalid PORT: ${JSON.stringify(raw)} is not a positive integer`);
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid PORT: ${JSON.stringify(raw)} is out of range (1-65535)`);
  }
  return n;
}

function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined || raw === '') return DEFAULT_LOG_LEVEL;
  if (!(LOG_LEVELS as readonly string[]).includes(raw)) {
    throw new Error(
      `Invalid LOG_LEVEL: ${JSON.stringify(raw)} (expected one of ${LOG_LEVELS.join(', ')})`,
    );
  }
  return raw as LogLevel;
}

function resolveSessionDir(raw: string | undefined): string {
  if (raw === undefined || raw === '') {
    return path.join(os.homedir(), '.pi-mcp');
  }
  return path.resolve(raw);
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: parsePort(env['PORT']),
    host: DEFAULT_HOST,
    sessionDir: resolveSessionDir(env['SESSION_DIR']),
    logLevel: parseLogLevel(env['LOG_LEVEL']),
  };
}
