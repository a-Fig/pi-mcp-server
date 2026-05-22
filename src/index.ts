#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createLogger } from './log.js';
import { buildMcpServer } from './server.js';
import { startHttpServer } from './http.js';
import { PACKAGE_VERSION } from './pkg.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger(config.logLevel);
  const handle = await startHttpServer(config, () => buildMcpServer({ logger }), logger);
  const url = `http://${config.host}:${config.port}/mcp`;
  logger.info('pi-mcp-server listening', { url, version: PACKAGE_VERSION });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown signal received', { signal });
    setTimeout(() => {
      logger.error('forceful exit after timeout');
      process.exit(1);
    }, 5000).unref();
    handle
      .close()
      .then(() => {
        process.exit(0);
      })
      .catch((err: unknown) => {
        logger.error('shutdown error', { err: String(err) });
        process.exit(1);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'error', msg: 'fatal', fields: { err: String(err) } })}\n`);
  process.exit(1);
});
