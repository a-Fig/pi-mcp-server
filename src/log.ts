import type { LogLevel } from './config.js';

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

interface LogLine {
  time: string;
  level: LogLevel;
  msg: string;
  fields?: Record<string, unknown>;
}

function write(level: LogLevel, msg: string, fields: Record<string, unknown> | undefined): void {
  const line: LogLine = { time: new Date().toISOString(), level, msg };
  if (fields !== undefined) line.fields = fields;
  process.stderr.write(`${JSON.stringify(line)}\n`);
}

export function createLogger(level: LogLevel): Logger {
  const threshold = LEVEL_RANK[level];
  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_RANK[lvl] >= threshold) write(lvl, msg, fields);
  };
  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  };
}
