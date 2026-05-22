---
name: pi-delegation
description: |
  Use this skill when the user mentions pi-mcp-server, pi-mcp, the pi coding
  agent, @earendil-works/pi-coding-agent, or any of the pi_new_session /
  pi_prompt / pi_list_sessions / pi_close_session MCP tools. It covers when
  to delegate work to pi, the 4-tool surface, model selection (DeepSeek V4
  Flash / Pro, Hy3 preview, Kimi K2.6, Qwen 3.6 Plus, Qwen 3.6 35B A3B,
  Qwen 3.7 Max, MiMo-V2.5-Pro), cost caps, and common patterns. Skip for unrelated coding
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

Pi sees a `provider:modelId` string. All models below route via OpenRouter
(`openrouter:<id>`) — one key, one billing surface. The user has explicitly
opted out of going through model-direct APIs from pi.

Pricing, context, and release dates below were pulled live from each
model's OpenRouter page on 2026-05-22 (the headline values shown at the
top of `https://openrouter.ai/<id>`). Provider tables on OpenRouter are
JavaScript-rendered and can't be scraped programmatically — when you need
to know which physical backend will serve a request (or its max output
cap), open the page's "Providers" tab manually. Pricing drifts; treat
these as current-as-of date, not forever-truth.

Hy3 preview is the one model we've actually exercised end-to-end through
pi-mcp-server (`scripts/use-it.ts` — file read + directory enumeration
via pi's tools). The rest are listed but not behavior-tested by us; run
`scripts/use-it.ts` with `DEMO_MODEL=<id>` to verify tool-use behaviour
before relying on any of them.

| Model | provider:modelId | In / Out ($/M) | Context | Released | Notes |
|---|---|---|---|---|---|
| **Tencent Hy3 preview** | `openrouter:tencent/hy3-preview` | 0.066 / 0.26 | 262K | Apr 22, 2026 | High-efficiency Tencent MoE for agentic workflows. Configurable reasoning levels (off / low / high). **Only model we've tested through pi-mcp-server.** Cheapest in the table. Two real verification tasks cost ~$0.001 total. |
| DeepSeek V4 Flash | `openrouter:deepseek/deepseek-v4-flash` | 0.10 / 0.20 | 1M | Apr 24, 2026 | Efficiency-optimised MoE, 284B total / 13B active. Page says "designed for fast inference and high-throughput workloads, while maintaining strong reasoning and coding performance". Pi's local registry caches a different price ($0.112/$0.224); the headline OpenRouter page wins. |
| DeepSeek V4 Pro | `openrouter:deepseek/deepseek-v4-pro` | 0.435 / 0.87 | 1M | Apr 24, 2026 | DeepSeek flagship MoE, 1.6T total / 49B active. Page positions it for advanced reasoning, coding, and long-horizon agent workflows. ~4× the cost of V4 Flash. |
| Moonshot Kimi K2.6 | `openrouter:moonshotai/kimi-k2.6` | 0.73 / 3.49 | 262K | Apr 20, 2026 | Multimodal. Page positions it for long-horizon coding, UI/UX generation, and multi-agent orchestration. Output token cost is ~5× input — watch chatty prompts. |
| Alibaba Qwen 3.6 35B A3B | `openrouter:qwen/qwen3.6-35b-a3b` | 0.15 / 1.00 | 262K | Apr 27, 2026 | Open-weight MoE, 35B total / 3B active per token. Hybrid sparse architecture with Gated DeltaNet attention. **Multimodal: text, image, AND video input.** Cheapest reasoning-capable Qwen here — pick it over 3.6 Plus when cost beats needing the 1M context. |
| Alibaba Qwen 3.6 Plus | `openrouter:qwen/qwen3.6-plus` | 0.325 / 1.95 | 1M | Apr 2, 2026 | Hybrid linear attention + sparse MoE. **Page currently shows a 35% promo discount on this pricing — list price may revert without notice.** Pay the ~2× over 35B A3B for the 1M context window. |
| Alibaba Qwen 3.7 Max | `openrouter:qwen/qwen3.7-max` | 2.50 / 7.50 | 1M | May 21, 2026 | **Brand-new — released yesterday.** Flagship Qwen3.7 series; text-only. Page describes "agent-centric workloads, with particular strengths in coding, office and productivity tasks, and long-horizon autonomous execution". Treat behaviour and pricing as preview-stage. |
| Xiaomi MiMo-V2.5-Pro | `openrouter:xiaomi/mimo-v2.5-pro` | 1.00 / 3.00 | 1M | Apr 22, 2026 | Xiaomi flagship. Page advertises top rankings on ClawEval, GDPVal, and SWE-bench Pro (no numeric scores rendered on the page itself). Targets general agentic capabilities and long-horizon software-engineering tasks. |

### Picking a model

1. **Cheap and tested**: `openrouter:tencent/hy3-preview` — until you've run `use-it.ts` against the others.
2. **Cheapest reasoning model in the table**: same as above ($0.066/$0.26). For a non-Tencent alternative at similar tier: `openrouter:deepseek/deepseek-v4-flash` ($0.10/$0.20, 1M context).
3. **Open-weights / locally-runnable alternative**: `openrouter:qwen/qwen3.6-35b-a3b` — sparse MoE (~3B active), open weights, multimodal including video.
4. **Harder reasoning**: `openrouter:deepseek/deepseek-v4-pro` or `openrouter:moonshotai/kimi-k2.6`.
5. **Long-horizon agentic preview**: `openrouter:qwen/qwen3.7-max` — released yesterday; treat as preview, budget accordingly.
6. **Anthropic models**: use Claude Code's native Task tool / subagents, not pi.

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
- **Max output varies per OpenRouter provider, not per model.** OpenRouter
  routes a single model id (e.g. `deepseek/deepseek-v4-flash`) to one of
  several physical backends (DeepInfra, GMICloud, Baidu, SiliconFlow,
  Parasail, AtlasCloud, etc.) — and they advertise wildly different output
  caps. For V4 Flash alone: 16.4K on DeepInfra, 131K on Baidu, 393K on
  SiliconFlow/AtlasCloud, 1.05M on GMICloud/Parasail. If pi's reply gets
  truncated, suspect that the routed provider has a tighter cap than you
  expected. Open the model's "Providers" tab on OpenRouter to see the
  spread and constrain routing if needed.
- **Heartbeat ≠ streaming.** Pi doesn't stream the answer to the MCP
  client; the 10s heartbeat just prevents a tool-call timeout. The full
  reply lands at the end of the turn.
