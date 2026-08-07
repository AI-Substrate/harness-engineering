# Telemetry segment schema v2 — event stream (draft)

> **Implemented field name: `event_stream` (not `events`).** This draft calls the
> ordered stream `events[]`; the shipped segment names it **`event_stream`**, because
> the v1 `events` object (`compactions`/`api_errors`/`local_commands`) is retained
> as a compat field and the names must not collide. Read every `events[]` /
> `"events":` below as **`event_stream`** (AC-10/AC-11 reconciliation, T5.9). The
> derived view is `rollup`. Source of truth: `segment.schema.json` + `events.ts`.

Grounded in the spike (`scratch/telem/poc/`). v1.x shipped **counts per command
window**; v2 makes the atom a **timestamped event** and derives the counts from
it. Same privacy stance as v1 (counts + names + timestamps; never content), plus
*when* and *order*.

## Principles

1. **Events are the substrate; counts are a rollup.** Everything v1 reported
   (`tokens`, `tools`, `skills` histograms) is computable from `events[]`.
2. **Work is a timestamp question, not a token question** (proven on all 3
   harnesses). `turn(dur_s)` carries tokens only as an optional intensity layer.
3. **Privacy unchanged.** An event is `t + kind + name + a number`. No prompt
   text, file contents, or arg strings. Prompts → word counts only.
4. **Team aggregation is pseudonymous + team-level** (Measuring-HVE governance):
   never an individual-performance surface. `actor`/`team` keys are opaque.

## Session envelope (unchanged-ish header + new fields)

```jsonc
{
  "schema_version": "2.0",
  "harness": "claude-code | copilot-cli | cursor-agent",
  "harness_session_id": "…",
  "command": "boot",                 // the harness command that flushed this segment
  "window": { "since": "last-command", "from": 9, "to": 13 },
  "timecode": "2026-06-24T04:14:23Z",
  "branch": "telemetry-enhancements",
  "plans_touched": ["034-…"],
  "models": { "claude-opus-4-8": { "turns": 12, "output_tokens": 48120 } },
  "effort": "high",
  "event_stream": [ /* the ordered stream, below */ ],
  "rollup": { /* derived measures, below — emitted for convenience, recomputable */ }
}
```

A **session timeline** = concatenate every segment's `events[]` for a
`harness_session_id`, ordered by `t`.

## The event record

```jsonc
{ "t": "2026-06-24T04:14:21Z", "kind": "<kind>", /* kind-specific fields */ }
```

| kind | fields | meaning | claude | copilot | cursor |
|---|---|---|---|---|---|
| `prompt` | `words` | a human steer | ✅ | ✅ | ✅ |
| `turn` | `dur_s`, `in?`,`out?`,`cache_read?`,`cache_create?`, `model?` | one agent generation (the work primitive) | ✅ +all tokens | ✅ exact `dur_s`, tokens via process-log join | ✅ `dur_s` from bubbles, **no tokens** |
| `tools` | `name`, `count`, `span_s` | a tool burst (collapsed run) | ✅ per-turn | ✅ + exact tool `dur`/`success` | ⚠️ untimed (counts only) |
| `skill` | `name`, `status`, `dur_s?` | a skill span; status ∈ `completed\|abandoned\|superseded\|active` | ✅ | ✅ `skill.invoked` | ⚠️ untimed |
| `flow` | `flow`, `stage`, `status` (`from?` **reserved**) | flight-plan stage, read from `the-flow.json` nav; command-level capture omits `from` (current position, not the transition) — the **current-stage anchor** | ✅ | ✅ | ✅ (command-level) |
| `flow_log` | `op` + `node?`/`from?`/`to?`/`type?`/`edge_op?` | a flight-plan mutation, projected from `the-flow.json` `events[]` (the **transition history** — moves, completions, edits); shape only, never free-form; offset-windowed; rollup-excluded (plan 035) | ✅ | ✅ | ✅ |
| `branch` | `to`, `from?` | a git branch switch between captures (computed in capture-service, not per-harness) | ✅ | ✅ | ✅ |
| `harness` | `verb` | a harness sub-command (sans-params) | ✅ | ✅ | ✅ |
| `checks` | `status`, `gates?` | quality-gate outcome (`ok\|degraded\|error`) | ✅ | ✅ | ✅ |
| `command_exit` | `verb`, `exit`, `status` | a command's exit code / disposition | ✅ | ✅ | ✅ |
| `subagent` | `name`, `dur_s?`, `status` | a spawned sub-agent span | ✅ Task | ✅ start/complete | ⚠️ untimed |
| `compaction` | — | context compaction fired | ✅ | ✅ | ✅ (bubble signal) |
| `model` | `model`, `effort?` | model / effort switch | ✅ | ✅ | ✅ |
| `api_error` | `signature?` | an API/tool error (no detail) | ✅ | ✅ | ⚠️ |

> Dropped vs the wishlist: **commits / git events** — git is queryable directly
> later, no need to duplicate in the stream (per decision).

## Derived rollup (recomputable from `events[]`)

```jsonc
"rollup": {
  "activity": {
    "wall_s": 1271, "agent_working_s": 933, "human_s": 293, "idle_s": 45,
    "working_ratio": 0.76               // agent / (agent + human); idle excluded
  },
  "flow_stage_time_s": { "plan": 480, "implement": 612, "review": 130 },
  "skills": { "the-flow": { "runs": 2, "abandoned": 1, "superseded": 0 } },
  "tokens": { "in": 95713, "out": 48120, "cache_read": 560979, "cache_create": 11237 },
  "tools": { "Edit": 14, "Bash": 6 },
  "outcomes": { "checks": "degraded", "exits": { "checks": 1, "boot": 1 } }
}
```

### Gap classification (the activity engine)
For each adjacent pair of events, the gap is:
- **human** — ends at a `prompt` AND `gap ≤ IDLE_CAP` (thinking / typing)
- **idle** — ends at a `prompt` AND `gap > IDLE_CAP` (walked away)
- **agent** — ends at any agent event (the model was generating / running tools)

Splitting `idle` out was essential: without it, an overnight-open session counted
hours of "human thinking." Real spike numbers — Claude session went from a
meaningless 0.34 to **0.78** working ratio once idle was separated.

## Per-harness ceilings (honest)
- **Claude** — fullest: turns + all four token buckets + tools/skills/flow, all timed.
- **Copilot** — best *timeline* (exact turn + tool durations, `skill.invoked`,
  subagent spans); tokens require the cli.telemetry process-log join (already built).
- **Cursor** — turn-grained timeline + working ratio + model from sqlite bubbles;
  **no tokens** (server-side) and tool/skill/flow detail is **untimed** (transcript
  has no timestamps). Needs the `DbPort` we shipped, not the transcript.

## Open knobs (decide before building)
1. **`IDLE_CAP`** — gap-before-prompt threshold for human-vs-idle. Spike used 300s.
2. **Tool-burst rule** — "same tool, inter-gap < N s → one burst." N ≈ 30s.
3. **Skill completion inference** — how `status` is decided (next-skill-started →
   `superseded`; same-skill restart → prior `abandoned`; session-end mid-skill →
   `active`). Observable transitions only — no confidence scoring.

## Example log (a real-shaped segment)

A short Claude session: user kicks off `/the-flow`, it plans, the user steers,
implement runs a build burst, `checks` comes back degraded, user walks away.

### Rendered timeline (what you'd eyeball)
```
════════ session 15eaa924 · claude-code · plan 034 ════════
events=11  turns=4  wall=14m20s  agent-working=6m12s  human=1m48s  idle=6m20s
working_ratio=0.78 (agent/(agent+human))
tokens: in=42118 out=18904 cache_read=1120340 cache_create=33210

09:00:00  prompt (12w)
09:00:03  · flow → plan                    ⟂ 3s agent
09:00:41  turn opus-4-8  out=8120  [Read×4, Grep×2]   ⟂ 38s agent
09:02:55  prompt (31w)                      ⟂ 2m05s idle      ← read the plan, came back
09:03:38  · flow → implement               ⟂ 43s human
09:03:44  turn opus-4-8  out=6240  [Edit×9, Bash×3]   ⟂ 6s agent
09:05:10  · skill /validate-v2 (completed)  ⟂ 1m26s agent
09:05:52  turn opus-4-8  out=3110  [Write×2]          ⟂ 42s agent
09:06:01  · harness checks                  ⟂ 9s agent
09:06:05  · checks → degraded               ⟂ 4s agent
09:06:05  · command_exit checks exit=1      ⟂ 0s agent
09:14:20  prompt (8w)                        ⟂ 8m15s idle     ← walked away
```

### The segment JSON
```jsonc
{
  "schema_version": "2.0",
  "harness": "claude-code",
  "harness_session_id": "15eaa924-…",
  "command": "checks",
  "window": { "since": "last-command", "from": 412, "to": 470 },
  "timecode": "2026-06-24T09:06:05Z",
  "branch": "telemetry-enhancements",
  "plans_touched": ["034-harness-telemetry-collection"],
  "models": { "claude-opus-4-8": { "turns": 4, "output_tokens": 18904 } },
  "effort": "high",
  "event_stream": [
    { "t": "2026-06-24T09:00:00Z", "kind": "prompt",  "words": 12 },
    { "t": "2026-06-24T09:00:03Z", "kind": "flow",    "flow": "the-flow", "stage": "plan", "status": "in_progress" },
    { "t": "2026-06-24T09:00:41Z", "kind": "turn",    "dur_s": 38, "out": 8120, "cache_read": 280110, "model": "claude-opus-4-8" },
    { "t": "2026-06-24T09:00:41Z", "kind": "tools",   "name": "Read", "count": 4, "span_s": 30 },
    { "t": "2026-06-24T09:02:55Z", "kind": "prompt",  "words": 31 },
    { "t": "2026-06-24T09:03:38Z", "kind": "flow",    "flow": "the-flow", "stage": "implement", "status": "in_progress" },
    { "t": "2026-06-24T09:03:44Z", "kind": "turn",    "dur_s": 86, "out": 6240, "cache_read": 410220, "model": "claude-opus-4-8" },
    { "t": "2026-06-24T09:03:44Z", "kind": "tools",   "name": "Edit", "count": 9, "span_s": 71 },
    { "t": "2026-06-24T09:05:10Z", "kind": "skill",   "name": "validate-v2", "status": "completed", "dur_s": 42 },
    { "t": "2026-06-24T09:06:01Z", "kind": "harness", "verb": "checks" },
    { "t": "2026-06-24T09:06:05Z", "kind": "checks",  "status": "degraded", "gates": { "tests": "ok", "arch-check": "degraded" } },
    { "t": "2026-06-24T09:06:05Z", "kind": "command_exit", "verb": "checks", "exit": 1, "status": "degraded" }
  ],
  "rollup": {
    "activity": { "wall_s": 860, "agent_working_s": 372, "human_s": 108, "idle_s": 380, "working_ratio": 0.78 },
    "flow_stage_time_s": { "plan": 177, "implement": 147 },
    "skills": { "validate-v2": { "runs": 1, "abandoned": 0, "superseded": 0 } },
    "tokens": { "in": 42118, "out": 18904, "cache_read": 1120340, "cache_create": 33210 },
    "tools": { "Read": 4, "Grep": 2, "Edit": 9, "Bash": 3, "Write": 2 },
    "outcomes": { "checks": "degraded", "exits": { "checks": 1 } }
  }
}
```

> **Cursor variant:** identical shape, but every `turn` drops `out`/`cache_*`
> (`"dur_s"` only), `tokens` is `null`, and `tools`/`skill` events are absent from
> the stream (untimed — surfaced in `rollup.tools` as counts only).

## Migration (1.1 → 2.0)
- Add `events[]` + `rollup{}`. Keep the v1 top-level count fields as a thin
  compatibility view derived from the rollup, OR cut over consumers and drop them.
- The capture core, windowing, buffer layout, sync rails, and kill-switch are
  unchanged — adapters just emit `events[]` instead of (only) counts.
- Cursor `events[]` is populated via the existing `DbPort` bubble read + transcript.
