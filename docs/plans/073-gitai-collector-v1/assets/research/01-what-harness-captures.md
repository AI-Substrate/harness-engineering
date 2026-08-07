# What harness telemetry captures

**Reviewed**: 2026-08-06, against `main` @ `bf58bea9`.
**Method**: read the schemas and services directly. Every claim below cites a file
in `harness/cli/src/services/telemetry/`. Nothing here is inherited from memory.

---

## The design axiom

`segment.schema.json` states it in its own title and description:

> **Harness telemetry segment (counts-only)** — "Normalized, counts-only per-session
> telemetry record (plan 034). The load-bearing cross-tool/cross-repo contract.
> **NO content fields ever** — only allowlisted counts and identifiers; file paths
> are repo-relative. Capability fields are nullable (null when unimplemented,
> never estimated)."

Three commitments follow from that sentence, and they are the whole comparison:

1. **No content, ever.** Not prompts, not responses, not file text, not patches.
   `user_prompts` is `array<integer>` — word counts, nothing else. A `file`
   event's `delta` is documented as "computed from the tool payload
   (**never the file text**)".
2. **Nullable, never estimated.** A capability that isn't implemented emits `null`.
   There is no imputation anywhere.
3. **Closed key set.** `segment-schema.test.ts` keeps the schema key-set-equal to
   `SEGMENT_FIELD_KEYS`. A field cannot appear without a schema change.

---

## Where it lives

| Store | Path | Contents | Retention |
|---|---|---|---|
| Local staging | `.harness/temp/telemetry/<session-id>/` + sidecars (`.branch`, `.cursor`, `.flushed`, `.startdate`) | in-flight segments per session | until flushed/swept |
| Published | `refs/harness-telemetry/<YYYY>/<MM>/<DD>/<session>` | rolled shards + `manifest.json`, out of tree | indefinite (123 refs in this repo today) |
| Skills lock / update check | `~/.harness/` | not telemetry | — |

Published telemetry is **out of tree**. It rides in the same object store as the
code but on its own ref namespace, so it never appears in a working tree, a diff,
a branch, or a PR.

---

## The segment — top-level fields

```
schema_version, command, harness, harness_version, harness_session_id,
timecode, window{since, from, to}, branch,
tokens{input, output, cache_create, cache_read, total,
       subagent_tokens, grand_total},
models{<model>: {turns, output_tokens}},
effort,
skills{<name>: count},
tools{<name>: count},
user_prompts[]                      ← integers (word counts)
subagents[{type, agent_name, model, status, count, tokens, tool_uses}],
files{written[], edited[]},         ← repo-relative paths
plans_touched[],
events{compactions[{trigger, pre_tokens, post_tokens}],
       api_errors, local_commands},
thinking{blocks},
captured_env{PIJ_SESSION_ID, PIJ_PARENT_ID, PIJ_HARNESS, PIJ_ROLE,
             PIJ_ANNOUNCE_TO, PIJ_SPAWN_ID, PIJ_SPAWN_MODEL, PIJ_SPAWN_EFFORT},
product_commit,                     ← the join anchor (plan 060)
capture_mode,                       ← 'reconciled' marks a late/orphan-lane repair
event_stream[]
```

`captured_env` is explicitly "a finite pij environment snapshot. Exactly eight
current keys" — an allowlist, not a dump of the environment.

## The event stream — 18 kinds

```
prompt · turn · usage · tools · skill · flow · flow_log · branch · harness ·
checks · command_exit · subagent · compaction · model · api_error ·
artifact · file · mark
```

Every event carries `t` plus **`t_precision`** — `exact | anchored | interpolated |
interval`. This is a first-class honesty field with no counterpart in most
telemetry systems: it says how much the timestamp can be trusted, and `interval`
means only "somewhere in this capture window".

`observation_kind` — `message_output | cumulative_checkpoint | partial_compaction |
final_shutdown` — records *why* the observation exists, which is how a stalled
capture is distinguished from a quiet one (plan 070 liveness).

Notable per-kind payloads:

| kind | carries |
|---|---|
| `file` | `path`, `change` (`written`\|`edited`), `delta{lines_added, lines_removed, bytes_added, bytes_removed}` |
| `tools` | `name`, `count`, `signature` (shell chain-HEAD), `control{git push, git commit}` — a **closed** control-command allowlist |
| `usage` | `in`, `out`, `cache_read`, `cache_create`, `nano_aiu`, `model` |
| `checks` | `gates{<name>: <status>}`, `exit` |
| `flow` / `flow_log` | `stage`, `op`, `node`, `edge_op`, `from`, `to`, `verb` |
| `mark` | `mark_kind`, `verdict` — both shape-guarded slugs (`^[a-z][a-z0-9...]`) |
| `artifact` | `artifact_type` — closed 11-enum (review, plan, workshop, dossier, tasks, execution-log, backpressure, validation, ship-report, flight-plan, retro) |
| `harness`/`observe` | `observe_kind` — closed 8-enum |
| `counts` | **58 allowlisted integer keys** (findings by severity, gates pass/fail/na, chores done/skipped/todo, dispositions, workshops, phases, CS, …) |

The `counts` block is where the process telemetry lives. It is a closed vocabulary
of 58 integers describing *plan and review state*, not code.

---

## Derived: the time model

`rollup.ts` is the piece with no equivalent in an attribution tool. Its stated
premise:

> "is the agent working?" is a **TIMESTAMP question, not a token question. Every
> inter-event gap is classified by what it ENDS at — a gap that ends at a human
> prompt is HUMAN time (≤ cap) or IDLE (> cap, walked away); every other gap is
> AGENT time."

So harness produces an **agent-time / human-time / idle-time** split from the event
ordering alone, plus tool bursts (`rollup.ts:102` — a maximal run of the same
`(name, signature, control)` collapses into one burst under a gap threshold, so
`bash:rg ×54` and `bash:git ×12` stay distinguishable).

`computeRollup` is a pure function of an ordered `Event[]` — no I/O — so any
downstream consumer can recompute it.

---

## Attribution: a read-time join, not a stored record

Harness stores **no per-line attribution anywhere**. The AI share is computed at
read time (`docs/how/measuring-ai-contribution.md`):

```
agent_lines(X, file) = Σ lines_added over file events where product_commit == parent(X)
total_lines          = git diff --numstat parent(X)..X
share                = Σagent / Σtotal
human                = residual (total − agent), never measured
```

Match on **parent SHA, never timestamps** — the doc says timestamp matching
"breaks under amend, rebase, cherry-pick, and branch switching, and this repo
routinely [does all of them]".

Two consequences worth stating plainly:

- **Human share is a residual.** Nothing observes a human typing. Untracked and
  human are the same bucket.
- **Gross-churn bias always inflates the agent.** Telemetry counts gross churn;
  git counts the net committed diff. Mitigated by clamping per file at
  `min(agent, git)`, but the doc is explicit that this and the blind-spot
  deflation "do not cancel in any principled way".

---

## Coverage

**5 adapters, ~4 products**: `claude-adapter`, `cursor-adapter` (+ `cursor-tools`
registry), `copilot-adapter` (CLI), `copilot-vscode-adapter`, `harness-adapter`
(self-telemetry).

**Documented blind spots** (`measuring-ai-contribution.md:156`):

- files written via Bash redirects (`>`, `>>`, `tee`) or MCP writers;
- surfaces exposing no per-file path;
- any commit with no intervening capture flush (no segment → no attribution);
- **an agent write tool this repo has never seen** — the FX009 class.

The FX009 mitigation is the honest part: a Cursor window whose write-capable tools
produced zero `file` events is marked `event_skipped:unhandled_write_tools:<tool>`
in `degraded[]`, which **degrades the envelope rather than passing as measured**.
That guard is Cursor-only; `cursor-tools.ts` treats an unknown name as
write-capable so the guard fires instead of the share quietly sagging.

---

## What harness does NOT capture

Stated up front so the comparison is fair:

- **No prompt or response text.** By design, permanently.
- **No line-level attribution.** No per-line ranges, no blame, no note in the repo.
- **No known-human signal.** No IDE extension; human is always residual.
- **No USD cost.** `nano_aiu` exists for Copilot's AIC billing unit
  (`copilot-ledger.ts:22`) and there is **no cost model anywhere else** — grep for
  `usd` in the telemetry tree returns nothing.
- **No autocomplete/tab-completion attribution.**
- **No survival through git rewrites.** The join anchors on `parent(X)`; a rebase
  changes the parent, so the join no longer finds the segment.
- **No machine-wide observation.** Capture is per-session, in-repo, opt-in via the
  harness itself. Nothing watches other repos.
