# Telemetry segment schema v2 — detail reference (b)

Companion to [`event-schema-v2.md`](./event-schema-v2.md) (the contract overview).
This doc is the **field-by-field reference**: exact types, optionality, the
per-harness *source* of every field, and the derivation algorithms (gap
classification, tool-burst rule, skill-status inference, rollup math). Grounded
in the spike (`scratch/telem/poc/` — proven against real Claude/Copilot/Cursor
data). Where a field's availability differs by harness, the **Source matrix**
is authoritative.

> Status: design reference for Plan 034 **Phase 5**. Privacy invariant is
> inherited unchanged from v1: counts + names + timestamps only — never prompt
> text, file contents, or free-form tool-arg strings.

> **Implemented field name: `event_stream` (not `events`).** This reference calls
> the stream `events` / `events[]`; the shipped segment names it **`event_stream`**
> (the v1 `events` count object is retained, so the names can't collide). Read every
> `events[]` below as `event_stream` (AC-10/AC-11 reconciliation, T5.9). Source of
> truth: `segment.schema.json` + `events.ts`.

---

## 1. Types (TypeScript-shaped)

```ts
type Iso = string;            // RFC3339 UTC, e.g. "2026-06-24T09:00:41Z"

interface SegmentV2 {
  schema_version: "2.0";
  harness: "claude-code" | "copilot-cli" | "cursor-agent";
  harness_session_id: string;
  command: string;            // the harness command that flushed this segment
  window: { since: "session-start" | "last-command"; from: number; to: number };
  timecode: Iso;
  branch: string | null;
  plans_touched: string[];
  models: Record<string, { turns: number; output_tokens: number }>;
  effort: string | null;
  event_stream: Event[];      // ordered by t; the substrate (shipped name; draft called it `events`)
  rollup: Rollup | null;      // derived from event_stream; null when the stream is empty
}

type Event =
  | Prompt | Turn | Tools | Skill | Flow | Harness
  | Checks | CommandExit | Subagent | Compaction | Model | ApiError;

interface EventBase { t: Iso; kind: string; }
```

### 1.1 Event kinds (field-by-field)

| kind | field | type | req | notes |
|---|---|---|---|---|
| **prompt** | `words` | int | ✅ | word count of a human prompt; never the text |
| **turn** | `dur_s` | int | ✅ | agent generation duration (the work primitive) |
| | `in` `out` `cache_read` `cache_create` | int | ⬚ | token buckets; omitted when unavailable (Cursor) |
| | `model` | string | ⬚ | model that produced the turn |
| **tools** | `name` | string | ✅ | tool name; a burst is always a single tool (same-name runs only — see §4.2) |
| | `count` | int | ✅ | calls collapsed into this burst |
| | `span_s` | int | ✅ | wall span of the burst (0 if single/instant) |
| **skill** | `name` | string | ✅ | skill slug (e.g. `the-flow`) |
| | `status` | enum | ✅ | `completed \| abandoned \| superseded \| active` (§4.3) |
| | `dur_s` | int | ⬚ | span when both ends observable |
| **flow** | `flow` | string | ✅ | `the-flow \| harness-loop` (the plan's `provenance.agent`) |
| | `stage` | string | ✅ | flight-plan stage = `nav.now` (e.g. `phase-5`) |
| | `from` | string | ⬚ | **reserved** — previous stage (transition source); command-level capture OMITS it (a single window observes the current position, not the transition that reached it) |
| | `status` | string | ✅ | `in_progress \| done \| blocked` — the `nav.now` node's lifecycle, narrowed (any other status ⇒ `in_progress`) |
| **branch** | `to` | string | ✅ | the new git branch (switch observed between captures) |
| | `from` | string | ⬚ | the prior branch |
| **harness** | `verb` | string | ✅ | harness sub-command, sans-params (e.g. `checks`) |
| **checks** | `status` | enum | ✅ | `ok \| degraded \| error` |
| | `gates` | `Record<string,string>` | ⬚ | per-gate verdicts (names only) |
| **command_exit** | `verb` | string | ✅ | the command |
| | `exit` | int | ✅ | process exit code |
| | `status` | string | ⬚ | normalized disposition |
| **subagent** | `name` | string | ✅ | sub-agent / agent-type name |
| | `dur_s` | int | ⬚ | span when start+complete observable |
| | `status` | enum | ✅ | `completed \| active` |
| **compaction** | — | — | — | context compaction fired (presence only) |
| **model** | `model` | string | ✅ | model after a switch |
| | `effort` | string | ⬚ | reasoning effort after a switch |
| **api_error** | `signature` | string | ⬚ | coarse error class; never a message body |

`req` ✅ = always present for that kind; ⬚ = optional (omitted, never `null`-padded,
when the source can't supply it — keeps Cursor turns lean).

---

## 2. Source matrix (where each field comes from, per harness)

| field / kind | claude-code | copilot-cli | cursor-agent |
|---|---|---|---|
| `prompt.words` | transcript user msg (string content) | `user.message.data.content` | bubble `type:1` text |
| `turn.dur_s` | gap into the assistant requestId group | `turn_end − turn_start` (**exact**) | bubble `createdAt` spread (`type:2`) |
| `turn.in/out/cache_*` | `message.usage` (**all 4**) | cli.telemetry process-log join | **absent** (server-side) |
| `turn.model` | `message.model` | `session.model_change` | bubble `modelInfo.modelName` (sqlite) |
| `tools.*` | assistant `tool_use` blocks | `tool.execution_start/complete` (+ exact dur/success) | transcript `tool_use` — **untimed** (counts only) |
| `skill.*` | `Skill`/`Task` tool_use | `skill.invoked` / subagent events | transcript — **untimed** |
| `flow.*` | read from `the-flow.json` nav | same | same (command-level) |
| `harness.verb` | Bash `harness …` | tool args `harness …` | transcript Shell `harness …` |
| `checks` / `command_exit` | harness command result | same | same |
| `compaction` | transcript signal | events signal | bubble signal |

**Cursor ceiling (honest):** turn-grained timeline + working ratio + model, but
**no tokens** and tool/skill/flow beats are **untimed** (the transcript carries no
timestamps; only bubble `createdAt` is timed). Cursor reads the IDE store via the
`DbPort` shipped earlier — not the transcript — for `model`.

---

## 3. The rollup (derived; recomputable from `events[]`)

```ts
interface Rollup {
  activity: { wall_s: number; agent_working_s: number; human_s: number; idle_s: number; working_ratio: number };
  flow_stage_time_s: Record<string, number>;
  skills: Record<string, { runs: number; abandoned: number; superseded: number }>;
  tokens: { in: number; out: number; cache_read: number; cache_create: number } | null;
  tools: Record<string, number>;
  outcomes: { checks?: string; exits: Record<string, number> };
}
```

- `tokens` is `null` when no turn carried token buckets (Cursor) — never zero-filled.
- `working_ratio = agent_working_s / (agent_working_s + human_s)` — **idle excluded**.
- `flow_stage_time_s[stage]` = Σ gaps spent while `nav.now == stage` (from `flow` events).
- Everything here is a pure function of `events[]`; consumers may recompute and
  ignore the emitted rollup.

---

## 4. Derivation algorithms

### 4.1 Gap classification (the activity engine)
For each adjacent pair `(a, b)` in time-ordered `events`, `gap = b.t − a.t`:

```
if b.kind == "prompt":
    gap <= IDLE_CAP  → human     # thinking / typing
    gap >  IDLE_CAP  → idle      # walked away
else:
    → agent                      # the model was generating / running tools
```

`IDLE_CAP` default **300 s** (knob §5). Agent-side gaps are **never** capped — a
long tool/research run is real work, not idle. Rationale proven by the spike:
splitting `idle` out moved a real Claude session from a meaningless 0.34 to 0.78
working ratio (overnight-open sessions had inflated "human").

### 4.2 Tool-burst rule
A maximal run of consecutive **same-name** tool calls with inter-call gap
`< BURST_N` collapses to one `tools` event: `count` = number of calls, `span_s` =
last − first. A name change (or a gap ≥ `BURST_N`) **starts a new burst** — a burst
is therefore always a single tool name, so the per-tool counts survive and
`rollup.tools` equals the v1 `tools` histogram (AC-16). (A lossy `"mixed"` bucket
was considered and rejected for exactly that reason.) `BURST_N` default **30 s** (knob §5).

### 4.3 Skill-status inference (observable transitions only — no confidence scoring)
```
a skill opens at its first detection (Skill/Task/skill.invoked).
it closes as:
  completed   — an explicit finalizer / next non-skill activity resumes after it
  superseded  — a DIFFERENT skill opens before this one closed
  abandoned   — the SAME skill restarts before this one closed
  active      — session/segment ends with the skill still open
```
This is the minimum needed for the "skill confusion index" (restarts /
supersessions / compactions per skill) — a thrash detector. No completion-
confidence float (that is Measuring-HVE's harness plane, not ours).

### 4.4 Flow-stage time
On each `flow` event, attribute subsequent gap-time to `stage` until the next
`flow` event. Read `stage` (`nav.now`) + `status` (the `nav.now` node's lifecycle)
from `the-flow.json` `nav` at capture (not from command args), so stage timing is
exact even when `harness flow nav` carried the target as a dropped param.

**Command-level capture emits ONE `flow` event per window** (a window sits at one
stage), anchored to the window start, and **omits `from`** — a single capture
observes the current position, not the transition that reached it. `from` stays
reserved for a future explicit transition event; downstream readers must treat it
as optional and never require it.

---

## 5. Knobs (defaults; configurable)

| knob | default | controls |
|---|---|---|
| `IDLE_CAP` | 300 s | human-vs-idle threshold on a gap before a prompt (§4.1) |
| `BURST_N` | 30 s | same-tool inter-call gap that still counts as one burst (§4.2) |
| skill-status policy | observable-transition | how `skill.status` is decided (§4.3) — transitions only, no scoring |

---

## 6. Tail-flush (RESOLVED — session-end flush via `telemetry sync`)

Capture fires **on** a harness command, so work *after the last harness command of
a session* would otherwise never be flushed (no trigger), losing the most
interesting tail (did it finish / ship / stall?).

**Decision (plan 034 Phase 5, T5.8): session-end flush, reusing the existing
machinery — no new capture path.** The capture preamble runs for *every*
non-display command (`app.ts`, `shouldCaptureForArgv`), including
`harness telemetry sync`. So wiring a harness **SessionEnd hook to
`harness telemetry sync`** flushes the tail in one step:

1. the preamble captures the **tail segment** — the cursor delta since the last
   command's capture (`computeWindow(prevCursor, currentPosition)`), written as the
   next `<seq>.json`;
2. the `sync` act then flushes the whole buffer (tail included) to
   `refs/harness-telemetry/<date>/<session>`.

This needs **no new command or capture logic** — it falls out of the tiling
property below. The only integration point is the host-specific hook registration
(Claude `SessionEnd`, Copilot/Cursor shutdown), documented in
`docs/how/telemetry.md`; the-flow's `ship` verb already runs `telemetry sync`, so a
shipped session flushes its tail for free.

> A session that ends *without* a SessionEnd hook (or is killed) still loses only
> its final tail — every segment up to the last command is intact. Tail loss is
> bounded, never silent corruption.

Segments **tile** the session — reassembly (concat by `harness_session_id`, sort by
`t`) reproduces the identical timeline regardless of where the per-command
boundaries fall, so variable segment size (and a final tail segment) is harmless.

---

## 7. Privacy invariants (unchanged from v1, restated for events)

1. An event is `t + kind + name + numbers`. No prompt text, file contents, or
   free-form tool-arg strings — ever.
2. Prompts → **word counts** only.
3. File paths (if ever added) → repo-relative only.
4. `command_exit`/`api_error` carry codes/coarse classes, never message bodies.
5. Team aggregation is **pseudonymous + team-level**; never an individual-
   performance surface (Constitution P12 / `harness-value-measures.md`).

## 8. Migration (1.1 → 2.0)

Add `events[]` + `rollup{}`; keep v1 top-level count fields as a thin derived
compatibility view **or** cut consumers over and drop them. Capture core,
windowing, buffer layout, sync rails, and kill-switch are unchanged — adapters
emit `events[]` instead of (only) counts. Cursor `events[]` populates via the
existing `DbPort` bubble read + the transcript.
