---
name: pi-delegation
description: |
  Use this skill when the user mentions pi-mcp-server, pi-mcp, the pi coding
  agent, @earendil-works/pi-coding-agent, or any of the pi_new_session /
  pi_prompt / pi_list_sessions / pi_close_session MCP tools. It covers when
  to delegate work to pi, the 4-tool surface, model selection (DeepSeek V4
  Flash / Pro, Hy3 preview, Kimi K2.6, Qwen 3.6 Plus, Qwen 3.7 Max,
  MiMo-V2.5-Pro), cost caps, and common patterns. Skip for unrelated coding
  tasks — pi delegation is niche and only useful when Claude Code's
  sandboxed environment is the bottleneck. context_cost: small ~800 words |
  skill_type: process
---

# Using pi-mcp-server

pi-mcp-server is an MCP server that lets Claude Code spawn and drive
[pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) coding
agents. Claude Code itself runs in a sandbox with no outbound DNS; pi runs
outside that sandbox and can hit OpenRouter / DeepSeek / Tencent / Alibaba /
Moonshot / etc. Use pi when you need work done that requires the network,
or when you want to parallelize an agent on a non-Anthropic LLM.

The server must already be registered with the user's Claude Code:
```
claude mcp add pi-mcp --transport http --url http://127.0.0.1:3700/mcp
```
If the user hasn't done this, point them at the project README before
trying to call the tools.

## When to delegate to pi

Good fits:

- **Non-Anthropic models**: any time the user wants work done by DeepSeek,
  Qwen, Kimi, Hy3, MiMo, GLM, GPT-4 / 5, Gemini, etc. Pi is the bridge.
- **Network-dependent work**: anything Claude Code can't reach directly
  from the sandbox.
- **Cheap bulk operations**: trivial codemods over many files where the
  user doesn't want to pay Anthropic rates. Delegate to a sub-dollar
  reasoning model with a strict `max_cost_usd`.
- **Parallel work**: spawn 2–3 pi sessions in different `cwd`s and run them
  concurrently while you reason about something else.

Bad fits — do the work yourself or use a native subagent:

- **Anthropic-family work** (Haiku, Sonnet, Opus): do NOT route through pi
  or OpenRouter — that bills the user's OpenRouter credits instead of
  their Claude subscription. Use Claude Code's native Task tool with the
  general-purpose / Plan / Explore agent types.
- **Reasoning the user is actively watching**: pi runs detached; the 10s
  heartbeat keeps the connection alive but doesn't stream thoughts in
  real time.
- **Tiny one-off questions**: spinning up a pi session costs ~$0.001
  in agent overhead. Not worth it for trivia.
- **Anything cost-sensitive without a cap**: if you can't reason about
  the cost ceiling, don't delegate.

## The 4 tools

### `pi_new_session(cwd, model, max_cost_usd?, thinking_level?, system_prompt?)`

Spawn a fresh pi agent. Returns `{ sessionId }`. The `cwd` must be an
**absolute path**. The `model` string is `provider:modelId`, e.g.
`openrouter:tencent/hy3-preview`.

**Always set `max_cost_usd`.** A session without a cap is a budget hole.

### `pi_prompt(sessionId, text)`

Send a message and wait for the full reply. Returns
`{ text, costUsd, cumulativeCostUsd, inputTokens, outputTokens, finishReason, errorMessage? }`
in `structuredContent`. Heartbeats fire every 10s so the call doesn't time
out on long-running edits.

`finishReason`:
- `'completed'` — normal success.
- `'cost_cap'` — the session hit its cap. `text` may contain a partial
  answer; `errorMessage` says which cap was hit.
- `'error'` — pi errored (transport, model unavailable, etc.).

If `isError: true`, treat the result as a soft failure: read the text if
present, but don't blindly retry.

### `pi_list_sessions()`

Returns active sessions with their cumulative cost and last activity.

### `pi_close_session(sessionId)`

Idempotent. Close every session you create.

## Model selection

Pi sees a `provider:modelId` string. Use the OpenRouter route when one key
covers everything; use the direct provider when its API has materially
better limits.

The recommendations below are based on pi 0.74.1's bundled
`models.generated.js`. Pricing drifts — verify before relying on a
specific number for billing.

### Tested with pi-mcp-server

End-to-end verified via `scripts/use-it.ts` (real file read + directory
enumeration through pi's tools):

| Model | provider:modelId | In / Out ($/M) | Context | Max out | Notes |
|---|---|---|---|---|---|
| **Tencent Hy3 preview** | `openrouter:tencent/hy3-preview` | 0.066 / 0.26 | 262K | 262K | **Recommended default.** Cheapest tested model. Reasoning. Tool use confirmed. Two real verification tasks cost ~$0.001 total. |

### Other models (in pi's registry, untested by us)

Pricing pulled from pi 0.74.1's registry; reasoning capability noted where
present.

| Model | provider:modelId | In / Out ($/M) | Context | Max out | Notes |
|---|---|---|---|---|---|
| DeepSeek V4 Flash (direct) | `deepseek:deepseek-v4-flash` | 0.14 / 0.28 | 1M | 384K | Cheap, fast, reasoning. **Use this not the OpenRouter route** — OpenRouter's variant caps output at 4,096 tokens which clips most code-gen. Direct API requires `DEEPSEEK_API_KEY`. |
| DeepSeek V4 Flash (OpenRouter) | `openrouter:deepseek/deepseek-v4-flash` | 0.112 / 0.224 | 1M | **4,096** | 20% cheaper than direct, but the 4K output cap kills it for real work. Only use when you genuinely only need short answers and don't have a DeepSeek key. |
| DeepSeek V4 Pro | `openrouter:deepseek/deepseek-v4-pro` or `deepseek:deepseek-v4-pro` | 0.435 / 0.87 | 1M | 384K | DeepSeek's flagship reasoner. Use for hard problems where Flash isn't enough. |
| Moonshot Kimi K2.6 | `openrouter:moonshotai/kimi-k2.6` | 0.73 / 3.49 | 262K | 262K | Frontier reasoner, accepts text + image inputs. Output-cost-heavy — be careful with chatty prompts. |
| Alibaba Qwen 3.6 Plus | `openrouter:qwen/qwen3.6-plus` | 0.325 / 1.95 | 1M | 65K | Mid-tier reasoner, multimodal (text + image). Solid price-to-context ratio. |
| Alibaba Qwen 3.7 Max | `openrouter:qwen/qwen3.7-max` | 2.50 / 7.50 | 1M | 65K | **Preview model — pricing and behavior subject to change.** Alibaba positions it for long-horizon agent runs. Distinct tier from 3.6 Plus, not a replacement; 3.6 Plus is the stable production tier. |
| Xiaomi MiMo-V2.5-Pro | `openrouter:xiaomi/mimo-v2.5-pro` | 1 / 3 | 1M | **16K** | Agentic-focused, open-source heritage. The 16K output cap is restrictive for multi-file refactors or long diffs — pick something with more headroom if you expect a big response. |

### Picking a model

1. **Cheap and proven**: `openrouter:tencent/hy3-preview` — until you've tested others against pi.
2. **Cheaper still, more output budget**: `deepseek:deepseek-v4-flash` (direct API) if `DEEPSEEK_API_KEY` is set.
3. **Harder reasoning**: `deepseek:deepseek-v4-pro` or `openrouter:moonshotai/kimi-k2.6`.
4. **Long-horizon agentic preview**: `openrouter:qwen/qwen3.7-max` — but note "preview" and budget accordingly.
5. **Anthropic models**: use Claude Code's native Task tool / subagents, not pi.

Caveat for every "untested by us" row: the model is in pi's registry so it
will resolve, but we haven't verified that it cleanly drives pi's `read` /
`bash` tools end-to-end. Run `scripts/use-it.ts` with `DEMO_MODEL=<id>` to
verify before relying on a model for tool-heavy delegation.

### Suggested `max_cost_usd` starting points

(Raise on explicit user request.)

- Sanity check / trivial Q&A: `0.05`
- Standard delegation (single file, contained edit): `0.50`
- Multi-file refactor on a frontier model: `2.00`
- Open-ended exploration: confirm with the user before exceeding `5.00`.

## Patterns

**Single delegation:**
```
sessionId = pi_new_session({
  cwd: <abs path>,
  model: 'openrouter:tencent/hy3-preview',
  max_cost_usd: 0.50,
})
result = pi_prompt({
  sessionId,
  text: 'In src/auth/, find every place we cast to `any` and propose stricter types. Output a unified diff.',
})
pi_close_session({ sessionId })
```

**Parallel delegation** (use multiple MCP calls in one assistant turn):
spawn N sessions with different `cwd`s or different prompts, prompt them
concurrently, await results.

**Verification:** when pi returns a non-trivial answer (a file listing, a
diff, a fact), independently verify the part you'll act on. Read the file,
diff the lines. Don't act on pi's word alone for anything load-bearing.

## Pitfalls

- **Absolute paths only.** `cwd` must be absolute or `pi_new_session`
  returns `isError: true` immediately.
- **Don't leak sessions.** Close them. If the user kills the MCP server,
  in-memory sessions are gone but pi's JSONL on disk persists at
  `~/.pi-mcp/sessions/<uuid>/` and you can't currently re-attach.
- **Cap is not a hard guarantee.** Pi may have an in-flight LLM call when
  the cap is checked — the turn that trips the cap can exceed it by one
  assistant message. Set caps with ~30% headroom.
- **Pi can edit files.** Full filesystem access in `cwd`. If you don't
  want pi to write, point `cwd` at a read-only directory or use a
  `system_prompt` that forbids edits.
- **Model identifiers** must be exactly `provider:modelId`. Wrong format →
  pi rejects the session with "Model not found".
- **`maxTokens` cap matters.** Some models in the table (DeepSeek V4 Flash
  via OpenRouter at 4K; MiMo-V2.5-Pro at 16K) cap output well below their
  context window. If pi's reply gets truncated, suspect the output cap.
- **Heartbeat ≠ streaming.** Pi doesn't stream the answer to the MCP
  client; the 10s heartbeat just prevents a tool-call timeout. The full
  reply lands at the end of the turn.
