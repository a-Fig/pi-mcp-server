---
name: pi-delegation
description: |
  Use this skill when the user mentions pi-mcp-server, pi-mcp, the pi coding
  agent, @earendil-works/pi-coding-agent, or any of the pi_new_session /
  pi_prompt / pi_list_sessions / pi_close_session MCP tools. It covers when
  to delegate work to pi, the 4-tool surface, model selection, cost caps,
  and common patterns. Skip for unrelated coding tasks — pi delegation is
  niche and only useful when Claude Code's sandboxed environment is the
  bottleneck. context_cost: small ~600 words | skill_type: process
---

# Using pi-mcp-server

pi-mcp-server is an MCP server that lets Claude Code spawn and drive
[pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) coding
agents. Claude Code itself runs in a sandbox with no outbound DNS; pi runs
outside that sandbox and can hit OpenRouter / Anthropic / Google. Use pi
when you need work done that requires the network — or when you want to
parallelize an agent on a different LLM.

The server must already be registered with the user's Claude Code:
```
claude mcp add pi-mcp --transport http --url http://127.0.0.1:3700/mcp
```
If the user hasn't done this, point them at the project README before
trying to call the tools.

## When to delegate to pi

Good fits:

- **Network-dependent work**: anything Claude can't reach directly from the
  sandbox (third-party APIs, model providers, package registries that the
  sandbox blocks).
- **Different model**: when the user wants the work done by a specific
  model (e.g. cheap Haiku for bulk edits, Gemini for long-context reads,
  GPT-4o for a second opinion).
- **Parallel work**: spawn 2–3 pi sessions in different `cwd`s and run them
  concurrently while Claude reasons about something else.
- **Cheap bulk operations**: trivial codemods over many files where paying
  for Sonnet is overkill — delegate to Haiku via pi with a strict
  `max_cost_usd`.

Bad fits — do the work yourself instead:

- **Reasoning the user is actively watching**: pi runs detached; you can't
  show your work in real time. The 10s heartbeat just keeps the connection
  alive — it doesn't stream pi's thoughts.
- **Anything that needs Claude Code's own tools**: pi can't drive Claude's
  TodoWrite, Edit history, or other harness-level tools.
- **Tiny one-off questions**: spinning up a pi session costs ~$0.001
  overhead just for the system prompt. Not worth it for trivia.
- **Anything cost-sensitive without a cap**: if you can't reason about the
  cost ceiling, don't delegate.

## The 4 tools

### `pi_new_session(cwd, model, max_cost_usd?, thinking_level?, system_prompt?)`

Spawn a fresh pi agent. Returns `{ sessionId }`. The `cwd` must be an
**absolute path**. The `model` string is `provider:modelId`, e.g.
`openrouter:anthropic/claude-3.5-haiku`.

**Always set `max_cost_usd`.** A session without a cap is a budget hole.

### `pi_prompt(sessionId, text)`

Send a message and wait for the full reply. Returns
`{ text, costUsd, cumulativeCostUsd, inputTokens, outputTokens, finishReason, errorMessage? }`
in `structuredContent`. Heartbeats fire every 10s so the call doesn't time
out on long-running edits.

`finishReason`:
- `'completed'` — normal success
- `'cost_cap'` — the session hit its cap. `text` may contain a partial
  answer; `errorMessage` says which cap was hit.
- `'error'` — pi errored (transport, model unavailable, etc.)

If `isError: true`, treat the result as a soft failure: read the text if
present, but don't blindly retry.

### `pi_list_sessions()`

Returns active sessions with their cumulative cost and last activity. Use
this when you've lost track of which session is which, or before sending
another prompt to confirm the session is still alive.

### `pi_close_session(sessionId)`

Idempotent. Close every session you create, especially in a long Claude
Code session — they otherwise accumulate in the server's memory.

## Model ladder (cheap-first)

Default to the cheapest model that can do the job. Walk up only on failure.

| Tier | Model | Use for |
| --- | --- | --- |
| Tiny | `openrouter:amazon/nova-micro-v1` | Sanity checks; "is the server alive"; trivial classification. |
| Cheap | `openrouter:anthropic/claude-3.5-haiku` | **Default workhorse.** File reads, small edits, structured Q&A over the repo. Proven to use tools correctly. |
| Mid | `openrouter:openai/gpt-4o-mini` or `openrouter:google/gemini-2.0-flash-001` | Multi-file refactors, longer reasoning. |
| Strong | `openrouter:anthropic/claude-sonnet-4-6` or higher | Hard reasoning, architecture, debugging that the cheaper tiers failed on. |

Suggested `max_cost_usd` starting points (raise on explicit user request):
- Tiny task: `0.05`
- Standard delegation: `0.50`
- Multi-file refactor: `2.00`
- Open-ended exploration: confirm with the user before exceeding `5.00`.

## Patterns

**Single delegation:**
```
sessionId = pi_new_session({ cwd: <abs path>, model: 'openrouter:anthropic/claude-3.5-haiku', max_cost_usd: 0.50 })
result = pi_prompt({ sessionId, text: 'In src/auth/, find every place we cast to `any` and propose stricter types. Output a unified diff.' })
pi_close_session({ sessionId })
```

**Parallel delegation** (use multiple Bash/MCP calls in one assistant turn):
spawn N sessions with the same `cwd` but different prompts (or different
`cwd`s for isolated work), prompt them concurrently, await results.

**Verification:** when pi returns a non-trivial answer (a file listing, a
diff, a fact), independently verify the part you'll act on. Read the file,
diff the lines, etc. Don't act on pi's word alone for anything load-bearing.

## Pitfalls

- **Absolute paths only.** `cwd` must be absolute or `pi_new_session`
  returns `isError: true` immediately.
- **Don't leak sessions.** Close them. If the user kills the MCP server,
  in-memory sessions are gone but pi's JSONL on disk persists at
  `~/.pi-mcp/sessions/<uuid>/` and you can't currently re-attach.
- **Cap is not a hard guarantee.** Pi may have an in-flight LLM call when
  the cap is checked — the turn that trips the cap can exceed it by one
  assistant message. Set caps with headroom (target ~70% of your real
  ceiling).
- **Pi can edit files.** It has full filesystem access in `cwd`. If you
  don't want pi to write, point `cwd` at a read-only directory or use a
  `system_prompt` that forbids edits.
- **Model identifiers** must be exactly `provider:modelId`. Wrong format →
  pi rejects the session with "Model not found".
- **Heartbeat ≠ streaming.** Pi doesn't stream the answer to the MCP
  client; the 10s heartbeat just prevents a tool-call timeout. The full
  reply lands at the end of the turn.
