# pi-mcp-server

An MCP server that bridges Claude Code and the pi coding agent, enabling Claude to spawn, orchestrate, and communicate with pi agents as first-class MCP tools.

## What this is

Claude Code's bash tool runs in a sandboxed environment with no outbound network access. MCP server processes run outside that sandbox with full OS/network access. This project wraps pi inside an MCP server so Claude can delegate coding tasks to pi agents running any LLM (via OpenRouter, Anthropic, Google, etc.).

## Tech stack

- **Runtime**: Node.js 20+ / TypeScript
- **MCP**: `@modelcontextprotocol/sdk` — Streamable HTTP transport (not stdio, so sessions survive Claude Code restarts)
- **Pi**: `@earendil-works/pi-coding-agent` Node SDK (`createAgentSession`) — in-process, not subprocess
- **Persistence**: SQLite via `better-sqlite3` — session registry survives MCP server restarts
- **Package manager**: npm

## Architecture

```
Claude Code (MCP client, Streamable HTTP)
    │
    ▼
pi-mcp-server (Node.js HTTP server, port configurable)
    │  - MCP-Session-Id per client connection
    │  - SQLite session registry (id → file path, cwd, model, cost)
    │  - Progress heartbeat every 10s (prevents client timeout)
    │  - Resource subscriptions for live streaming
    │  - Elicitation for pi's blocking extension UI dialogs
    │  - Roots-aware: uses Claude's open directories as pi cwd
    │
    ├─► AgentSession A (pi SDK, isolated agentDir)
    ├─► AgentSession B (pi SDK, isolated agentDir)
    └─► AgentSession N ...
```

## MCP tools exposed

| Tool | Description |
|---|---|
| `pi_new_session` | Spawn a new pi agent (model, cwd, system prompt) |
| `pi_prompt` | Send a message to a session, stream response |
| `pi_steer` | Inject a steering message mid-execution |
| `pi_abort` | Stop current operation |
| `pi_fork_session` | Branch from a prior message |
| `pi_set_model` | Switch model on an active session |
| `pi_set_thinking_level` | Set reasoning depth (off/low/medium/high/xhigh) |
| `pi_get_history` | Get conversation messages for a session |
| `pi_get_stats` | Token usage and cost for a session |
| `pi_get_available_models` | List models available via configured provider |
| `pi_list_sessions` | List all known sessions (active and historical) |
| `pi_close_session` | Cleanly dispose a session |

## MCP resources exposed

- `pi-session:///<sessionId>` — live session resource; subscribe for streaming updates

## Key design decisions

- **SDK not subprocess**: Use `createAgentSession()` in-process rather than spawning `pi --mode rpc`. Avoids JSONL framing bugs, handles extension UI dialogs via callbacks, fully typed.
- **Streamable HTTP transport**: Survives Claude Code restarts. Sessions live in the server process independent of client connections.
- **Isolated agentDir per session**: Each session gets its own directory under `~/.pi-mcp/sessions/<id>/` to prevent settings/auth collision between concurrent sessions.
- **SQLite registry**: Session metadata (id, filePath, cwd, model, createdAt, costUsd) persisted to disk so history survives server restarts.
- **Progress heartbeats**: Every 10 seconds during active pi runs, emit `notifications/progress` to prevent MCP client timeout.
- **Elicitation for pi dialogs**: When pi's extensions emit blocking `extension_ui_request` events, forward to the MCP client via `elicitation/create`.

## Development

```bash
npm install
npm run dev          # ts-node watch mode
npm run build        # tsc → dist/
npm run start        # node dist/index.js
npm test             # vitest
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3700` | HTTP port for MCP server |
| `SESSION_DIR` | `~/.pi-mcp` | Root directory for session data and SQLite DB |
| `OPENROUTER_API_KEY` | — | Passed through to pi sessions |
| `ANTHROPIC_API_KEY` | — | Passed through to pi sessions |
| `LOG_LEVEL` | `info` | Logging verbosity |

## Adding to Claude Code

```bash
claude mcp add pi-mcp --transport http --url http://localhost:3700/mcp
```
