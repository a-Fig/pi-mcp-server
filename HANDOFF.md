# Handoff: pi-mcp-server

## What we're building and why

Claude Code's bash/PowerShell tools run inside a sandbox that has no outbound DNS resolution — it cannot reach external APIs. The pi coding agent (`@earendil-works/pi-coding-agent`) makes API calls to OpenRouter (or other providers) to do its work. So Claude cannot call pi directly.

MCP server processes run *outside* Claude Code's sandbox, with full OS and network access. This project is an MCP server that wraps pi, giving Claude a set of MCP tools to spawn pi agents, send them tasks, and receive results — with full session continuity, streaming, and multi-agent parallelism.

## Research done (May 2026)

### Pi capabilities
- `@earendil-works/pi-coding-agent` v0.74.1 installed globally
- Supports `--print` (one-shot), `--mode rpc` (JSONL over stdin/stdout), and a Node.js SDK (`createAgentSession`)
- Full RPC command set: prompt, steer, follow_up, abort, get_state, get_messages, get_session_stats, set_model, cycle_model, set_thinking_level, new_session, fork, clone, bash, compact, export_html
- Event stream: agent_start, message_update (text_delta / thinking_delta / toolcall_delta), tool_execution_start/update/end, queue_update, compaction_start/end
- Sessions stored as JSONL files at `~/.pi/agent/sessions/`
- Extension UI sub-protocol: extensions can emit blocking `extension_ui_request` (select/confirm/input/editor) that must be responded to or pi hangs

### MCP spec capabilities being used
- **Progress notifications** (`notifications/progress`) — heartbeat every 10s during pi runs, prevents client timeout
- **Resource subscriptions** — expose sessions as `pi-session:///<id>` resources, push updates on each `message_update`
- **Elicitation** (`elicitation/create`) — forward pi's blocking extension dialogs to the user through Claude Code
- **Roots** (`roots/list`) — on connect, query Claude Code's open directories and use as default pi cwd
- **Sampling** (`sampling/createMessage`) — optionally ask Claude to review pi's output before returning
- **Streamable HTTP transport** — so sessions survive Claude Code restarts (stdio doesn't)
- **Tasks (experimental, 2025-11-25 spec)** — async task handles for long-running pi sessions; design for it even if not all clients support it yet

### Key architectural decision: SDK not subprocess
Use `createAgentSession()` from the pi Node SDK directly in the MCP server process, rather than spawning pi as a child process in `--mode rpc`. Reasons:
- No JSONL framing bugs (Node's readline is non-compliant with the RPC protocol)
- Extension UI dialogs handled via `ctx.ui` callbacks, not raw stdin/stdout interleaving
- No subprocess lifecycle management / zombie process risk
- Fully typed via pi's exported TypeScript types
- `AgentSessionRuntime` handles session replacement (fork/switch) cleanly
- `SessionManager.open(filePath)` lets us reconnect to any session from its file

RPC mode is still worth supporting as an option for users who want strict process isolation.

### Session isolation
Multiple concurrent pi sessions sharing `~/.pi/agent/` collide on `auth.json`, `settings.json`, and session list files. Each session must use:
- Its own `--session-dir` / `agentDir` under `~/.pi-mcp/sessions/<uuid>/`
- `SettingsManager.inMemory()` for per-session settings

### Session persistence across MCP reconnects
Claude Code restarts drop the MCP connection. Pi sessions need to outlive that. Solution:
- Streamable HTTP transport with `MCP-Session-Id` — sessions live in the server process
- SQLite registry (`better-sqlite3`) maps session UUID → file path, metadata
- On reconnect, `SessionManager.open(filePath)` resumes from disk

### Progress heartbeat
Without `notifications/progress` heartbeats, Claude Code's default MCP tool timeout kills long-running pi tasks. Emit every 10 seconds during active runs.

### Prior art reviewed
- `steipete/claude-code-mcp` (now archived) — wraps Claude Code as MCP server. Showed: heartbeat pattern, session resumption via `--resume`, cleanup registry on shutdown. Now archived because Claude Code has native MCP support.
- `grahama1970/claude-code-mcp-enhanced` — boomerang/subtask orchestration pattern
- `rchern/pi-claude-cli` — reverse: makes pi use Claude Code as its LLM backend via `claude -p` subprocess
- `prateekmedia/claude-agent-sdk-pi` — Claude Agent SDK as pi provider

## Current state

Repository initialized. CLAUDE.md and HANDOFF.md written. No code yet.

## Immediate next steps (to be planned)

1. **Project setup**: `package.json`, `tsconfig.json`, directory structure, dependencies
2. **MCP server scaffold**: Streamable HTTP transport, server init, `MCP-Session-Id` handling
3. **Session manager**: SQLite registry, `~/.pi-mcp/sessions/<uuid>/` isolation
4. **Pi SDK integration**: `createAgentSession` wrapper, event → MCP notification mapping
5. **Core tools**: `pi_new_session`, `pi_prompt`, `pi_abort`, `pi_close_session`
6. **Extended tools**: fork, set_model, set_thinking_level, get_stats, get_history, list_sessions
7. **Resources**: `pi-session:///` resource + subscription + update notifications
8. **Elicitation**: Handle pi's blocking extension UI dialogs
9. **Roots integration**: Auto-detect Claude Code's working directories
10. **Progress heartbeat**: 10s keepalive during active runs
11. **Graceful shutdown**: SIGTERM/SIGINT → abort + dispose all sessions
12. **Tests**: vitest, mock pi SDK
13. **README + npm publish prep**: MCP registry submission requirements

## Open questions for planning session

- What's the target first milestone? Full tool set, or core loop (new_session + prompt + close) first?
- Cost guardrails: `max_cost_usd` per session? Global budget?
- Should we support RPC mode as an opt-in fallback (for isolation)?
- Sampling (Claude reviewing pi output): opt-in per tool call, or always on?
- Auth model: localhost-only initially, or API key auth from day one?
- npm package name: `@a-fig/pi-mcp-server`? `pi-mcp`? `@earendil-works` scope is taken
- MCP registry submission: immediate goal, or post-v1?

## Key files / locations

| Path | Purpose |
|---|---|
| `src/index.ts` | Entry point, HTTP server |
| `src/server.ts` | MCP server definition, tool/resource registration |
| `src/sessions/` | Session manager, SQLite registry |
| `src/tools/` | One file per MCP tool |
| `src/events.ts` | Pi event → MCP notification mapping |
| `src/elicitation.ts` | Pi extension UI dialog → MCP elicitation |
| `~/.pi-mcp/` | Runtime data: sessions, SQLite DB |
