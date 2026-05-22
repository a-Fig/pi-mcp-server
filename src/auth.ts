import { AuthStorage } from '@earendil-works/pi-coding-agent';

/**
 * Create the process-wide AuthStorage. There MUST be exactly one of these
 * across all sessions — pi uses file locking on OAuth refresh, and multiple
 * in-process AuthStorage instances would see stale data even with the lock.
 * Callers (the MCP server entry point) create one and pass it to SessionManager.
 */
export function createAuthStorage(authPath?: string): AuthStorage {
  return authPath === undefined ? AuthStorage.create() : AuthStorage.create(authPath);
}
