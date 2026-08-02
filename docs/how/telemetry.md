# Harness telemetry

How the harness captures a **counts-only**, per-session telemetry `segment` on
every command, buffers it out of your working tree, and rolls it up into **one
out-of-tree git ref per session, keyed at the session's start date**, for the
eng-thrive measurement program — plus how it is pushed (manually, or
automatically on `checks`), how to disable it, the structure it takes, and the
privacy / offline guarantees.

> **This is the sensor, not the analyst.** Telemetry **emits + commits** faithful
> counts. It builds no scanner, no dashboard, no correlation. Downstream
> eng-thrive tooling reads the committed ref and engineers the measures — see
> [Harness value measures](./harness-value-measures.md).

> **Stored shape is OTEL/OTLP.** The segment is re-serialized as OTLP Logs +
> Metrics (one file per signal) and published in that form — collector-ingestible
> with zero translation. The on-disk layout, the `schema_url` policy, the
> keep-and-harden ref contract, and the downstream read contract live in
> [Harness telemetry — the OTLP/OTEL stored shape](./telemetry-otlp.md).

---

## The model in one minute

Every `harness <verb>` runs a tiny, fail-safe **capture preamble** before the
command does its work. It detects the innermost agent harness (Claude Code,
Copilot CLI; Cursor later), reads everything that happened *since the last
command* via a per-session cursor, and writes one normalized `segment` — tokens,
skills, tools, subagents, files, plan links, model/branch/timecode — to a
**gitignored buffer**. Nothing is pushed on the hot path.

A separate, explicit step — `harness telemetry sync` — rolls each session's
buffered segments up into **one ref per session, keyed at the session's start
date** (`refs/harness-telemetry/<start-YYYY>/<MM>/<DD>/<session>`), via plumbing
(never touching your index or working tree), and force-pushes that single ref.
Each sync rewrites the ref with a fresh orphan commit whose tree — rebuilt from
the whole local buffer — carries the **entire** session (`session.logs.jsonl` +
`session.metrics.jsonl` + a `manifest.json`), so a reader that peels only the tip
tree always sees the complete session. One ref per session (rather than one per
capture-date, and rather than funnelling a whole team into one shared ref) is
what keeps a multi-day session to a single place *and* makes concurrent writers
safe (see [Team scale](#team-scale--many-engineers-one-repo)).

```
harness <verb>   ──preamble──▶  .harness/temp/telemetry/<session>/<seq>.json          (gitignored buffer)
harness telemetry sync          ──plumbing──▶  refs/harness-telemetry/<start-date>/<session>  ──force-push──▶  central scraper
```

The **first** `harness telemetry sync` in a repo that still holds old
per-capture-date refs also runs a one-time **migration**: it discovers every old
ref (the one sanctioned `ls-remote` + fetch), unions each session's segments
across its full commit history — recovering any buried by the earlier
clobber-on-rewrite behaviour — rewrites them to the new start-date-keyed rolled
refs, verifies the rollup, then deletes the old refs. Steady-state syncs after
that are fetch-free.

Two properties make this safe to run on **every** command:

- **Zero host impact.** Capture is wrapped so it can never change the host
  command's stdout, stderr, or exit code. Any error inside it is swallowed.
- **PR-invisible.** The buffer lives under `.harness/temp/`, which self-ignores
  (a nested `.gitignore` of `*`), and the durable write is a ref under
  `refs/harness-telemetry/` via plumbing — so `git status --porcelain` is
  byte-identical across a capture and a flush. PR/merge-base algorithms only walk
  `refs/heads/*` and `refs/tags/*`, so telemetry never appears in a feature branch
  or a PR diff.

## What a segment records (counts only)

The `segment` is a **counts/identifiers-only** record. The full, enumerated field
set is the cross-tool/cross-repo contract — see the plan's
`### Segment Schema` and the machine schema at
`harness/cli/src/services/telemetry/segment.schema.json`. In summary it carries:
token buckets, per-model turn/output counts, skill/tool histograms, subagent
identity, repo-relative file paths, plan links, compaction/api-error/local-command
event counts, branch + timecode, and the capture window.

It **never** carries content: no prompt or message text, no file contents, no
free-form tool-argument strings (those can leak secrets). Absent data is
represented honestly, never estimated and never omitted — but the shape differs
by field kind:

- **Nullable scalars** serialize `null` when the harness can't supply them:
  `tokens`, `effort`, `thinking`, `branch`, and the per-subagent values
  (`subagents[].tokens`, `.tool_uses`, etc.).
- **Collection fields are always present** with an empty default, never `null`:
  `models` `{}`, `skills` `{}`, `tools` `{}`, `subagents` `[]`, `files`
  `{written:[],edited:[]}`, `plans_touched` `[]`, `events`
  `{compactions:[],api_errors:0,local_commands:0}`, and the v2.0
  `event_stream` `[]`.

Either way the field is present (a stable shape for the scraper); only its value
reflects availability.

> **Schema v2.0 — the event stream.** As of `schema_version` `2.0`, the segment
> additionally carries an ordered **`event_stream[]`** (the timestamped substrate)
> and a derived **`rollup`** — see [The event stream](#the-event-stream-v20). The
> v1 count fields above are retained as a compatibility view; they are equal to the
> rollup's derived counts. (The legacy `events` object — compactions / api-errors /
> local-commands — is a *different*, retained field; the timestamped stream is
> `event_stream`.)

### Path semantics

File paths are recorded **repo-relative**. A path **outside** the repo is reduced
to its **basename only** — the directory is dropped (no information about your
home directory or machine layout leaks). For example, a write to
`/Users/alex/.claude/projects/abc/memory/note.md` is recorded as `note.md`,
while a write to `harness/cli/src/app.ts` keeps its full repo-relative path.

## The event stream (v2.0)

v1 recorded **counts per command window**. v2 makes the atom a **timestamped
event** and *derives* the counts from it, so a session's **shape** — order,
time-gaps, when the agent was working vs. when you were — is reconstructable, not
just its totals. The counts didn't go away: the rollup's tallies equal the v1
histograms exactly (a derived view, never a second source of truth).

**An event is still counts-only.** Each `event_stream[]` entry is
`t + kind + name + numbers` — never prompt text, file contents, or tool-arg
strings (the same privacy floor as v1, enforced by an allowlist *by construction*:
the serializer picks each field per-kind and never spreads its input). The event
kinds:

| kind | carries | from |
|---|---|---|
| `prompt` | word count of a human steer | user message |
| `turn` | `dur_s` + optional token buckets + model | one agent generation |
| `tools` | tool name + count + span (a same-name burst) | tool calls |
| `skill` | skill name + lifecycle status | skill/subagent opens |
| `flow` | flight-plan `flow`/`stage`/`status` (the **current-stage anchor**) | `the-flow.json` nav (not args) |
| `flow_log` | a flight-plan mutation: `op` + `node`/`from`/`to`/`type`/`edge_op` | `the-flow.json` `events[]` log (the **transition history**) |
| `artifact` | a counts-only snapshot of a changed flow/SDD artifact: `artifact_type` + `counts`/`enums`/`size` | a review/plan/workshop/… in the window's changed files |
| `mark` | a peer's counts-only **self-attestation**: `mark_kind` + optional `verdict` + finding `counts` | `harness telemetry mark` (agent-invoked, not auto-derived) |
| `branch` | the new branch (`to`) + prior (`from?`) | a git branch switch between captures |
| `harness` | sub-command verb (sans params) | `harness …` calls |
| `checks` / `command_exit` | gate verdicts / exit codes | a harness command's result |
| `subagent` · `compaction` · `model` · `api_error` | identity / presence / class | transcript signals |

**Flow replay (`flow_log`).** The `flow` event is a per-window *snapshot* of where
the flight plan sits; `flow_log` is the **movement history** — projected from
`the-flow.json`'s append-only `events[]` audit log, one marker per mutation
(`cursor-moved`, `status-changed`, `node-created`/`-updated`, `created`) at its real
`fired_at`. It carries only **shape** (ids, statuses, `from`/`to`, edge ops) — never
a manual event's free-form `description`/`value` or comment text. Windowed by an
append-only **array offset** kept per (session, plan), so each entry is surfaced
exactly once (a timestamp watermark would drop the several entries one CLI call can
stamp in the same millisecond). Joined on time with the work events, it lets a reader
reconstruct *which stages a session moved through, what completed/changed, and when*.
Two honest bounds: `flow_log` markers are **excluded from the rollup** (their real —
sometimes backfilled — times must not distort gap/stage math), and the **initial**
stage is recoverable only via the first `cursor-moved.from` (a flow that never moved,
or was positioned by an advisory `nav --next` only, leaves no journey — read absence
as *unknown*, not *stayed put*).

**Artifact semantics (`artifact`).** The flow writes rich, deterministic artifacts —
reviews, plans, workshops, dossiers, tasks, execution logs, backpressure coverage,
validations, ship reports, and `the-flow.json`. Their **process signals** (fixes per
review, phases per plan, workshop depth, gate PASS/FAIL, validation verdict) sit
unread in those files. The artifact pass reads them at **capture time**: when a
registered artifact appears in the window's `files.written`/`edited` set, a thin
regex extractor parses it and emits one `artifact` event carrying the artifact's
`path` (repo-relative), `plan_id`, `change` (`written`/`edited`), a `counts` map
(integers only), an `enums` map (fixed-vocabulary verdicts/statuses/proof-levels,
with an `other` fallback), and a `size` (`lines`/`bytes`). Files change over time, so
each change re-emits an updated snapshot — a **semantic time series** per artifact, at
zero added agent burden (the sensor rides the existing capture window; there is no
watcher and no form to fill in).

The **privacy floor is unchanged**: `counts` are integers, `enums` are allowlisted
tokens gated by the extractor itself (a novel verdict maps to `other`, never travels
verbatim), and there is **no free-text field by construction** — finding text, fix
descriptions, and decision prose can never be emitted. The `counts`/`enums` **keys**
are themselves a **closed, schema-enumerated union** (`additionalProperties: false`),
so an extractor cannot invent a key to smuggle text through the map name. Extraction
is **defensive**: an unparseable/garbage artifact yields empty counts (never a capture
failure), and missing / binary / oversized / out-of-repo files are skipped. Like
`flow_log`, an `artifact` event carries a **capture-time** `t` and is **excluded from
the rollup**, so its snapshot stamp never distorts gap/wall/stage math. It complements
the flight-plan replay: `flow_log` is the *transition history*, the `artifact` snapshot
of `the-flow.json` is the *current shape* (nodes by type/status, phases, workshops,
chores done/skipped/todo) — cheap to query without replaying every event.

**The rollup — derived, recomputable.** `rollup` is a pure function of
`event_stream[]` (a consumer may ignore it and recompute):

- **Activity** — every inter-event gap is classified by what it *ends at*: a gap
  before a `prompt` is **human** time (≤ 5 min) or **idle** (> 5 min, walked away);
  every other gap is **agent** time. `working_ratio = agent / (agent + human)` —
  idle excluded. This is the load-bearing idea: *"is the agent working?"* is a
  **timestamp** question, not a token one.
- **Flow-stage time** — gap-time attributed to the active flight-plan `stage`
  (`flow_stage_time_s`), so you can see *where* a session's time went by stage.
- **Outcomes** — the last `checks` verdict + each verb's exit code.
- **tokens / tools / skills** — the same totals as the v1 fields (`tokens` is
  `null` when no turn carried buckets — e.g. Cursor — never zero-filled).

**Per-harness ceilings (honest).** Claude and **Copilot CLI** (`copilot-cli`)
emit an *exact*-timed stream (Copilot CLI turns even carry per-interaction
tokens). The next two surfaces hit a **tokens-`null` ceiling** — they keep usage
server-side, so the adapter reports the timeline and **never estimates tokens**:

- **Cursor** (`cursor-agent`) has no transcript timestamps, so its events are
  **anchored** to the IDE-store bubble times (`t_precision: "anchored"`); a
  headless Cursor session with no bubbles serializes an **empty `event_stream`
  with `rollup: null`** rather than a fabricated one.
- **Copilot Chat in VS Code** (`copilot-vscode`) is a **distinct surface from
  `copilot-cli`** — the VS Code extension keeps its own SQLite store
  (`…/globalStorage/github.copilot-chat/session-store.db`, `sessions` + `turns`),
  not the CLI's `~/.copilot` JSONL. It is detected by `AI_AGENT=
  github_copilot_vscode_agent` (no session-id env var exists, so the active
  session is resolved from the store **by cwd**, latest `updated_at`), and its
  events are **anchored** to `turns.timestamp`. The store has **no token
  columns** (`tokens`/`models` are `null`); for privacy the word-count + a
  presence flag are computed **at the SQL boundary** (`user_message` /
  `assistant_response` appear only inside `length()`/`CASE`), so the message
  **text never enters the telemetry process** — only `turn_index`, `words`,
  `has_response`, `timestamp` cross the read-only `DbPort`.

`event_stream` itself is always present, never `null`. Outcome events follow each
harness's result-capture ability: Claude has the full result envelope (`checks` +
`command_exit`), Copilot CLI reports only success (`command_exit`), Cursor and
Copilot-VS-Code neither.

## Disabling telemetry

Two switches, broad and narrow. Both are environment variables (telemetry is on
by default when unset):

| Variable | Effect |
|---|---|
| `HARNESS_NO_TELEMETRY=1` | **Off entirely** — no capture, no sync, no ref writes, zero side effects. The hard kill-switch. |
| `HARNESS_NO_TELEMETRY_AUTOSYNC=1` | **Unprompted pushes off** — capture and **manual** `harness telemetry sync` still work, but pushes that happen *without you asking* — the `checks` auto-push, and the flow tooling's loop-close / `ship` flushes — are suppressed (`checks` falls back to a passive nudge). |

```bash
export HARNESS_NO_TELEMETRY=1            # this shell captures and pushes nothing
export HARNESS_NO_TELEMETRY_AUTOSYNC=1   # still captures; no unprompted pushes (checks/loop/ship) — sync manually
```

## Plan links

A segment records the plan it relates to when either holds:

- `HARNESS_PLAN_ID` is set in the environment (it wins), or
- the current working directory is inside `docs/plans/<id>/` — the
  `<ordinal>-<slug>` directory name is derived automatically.

Multiple distinct plans seen across a session's segments are flushed as a
**deduped set**.

## Fleets — joining a flow-pair run (`harness telemetry get-fleet`)

A flow-pair run is a **fleet**: an orchestrator pij session that spawns child
pij sessions (a coder, a reviewer, …). `pij spawn` stamps each child's env with
`PIJ_SESSION_ID` (its own id), `PIJ_PARENT_ID` (the spawner), and `PIJ_HARNESS`
(`claude` | `copilot` | `codex` | `pi`); telemetry captures all three into
`captured_env`, so the whole fleet can be re-joined from history alone — nothing
extra is captured.

```sh
# env-tree: every child whose captured_env.PIJ_PARENT_ID == the root
harness telemetry get-fleet <root-pij-id> --json

# roster-scoped: reconcile the env tree against a flow-pair run.json roster
harness telemetry get-fleet <root-pij-id> --roster .flow-pair/runs/<run>/run.json --json
```

The result is a **`FleetEvidence`** (closed, counts-only shape in
`fleet-export.schema.json`) — one lane per child, each embedding the same
per-session evidence `harness telemetry get` returns, plus fleet totals. Every lane
carries a **`source`** (`live` | `ref` | `ledger`) and, when recovered from a vendor
side-channel, a **`billing`** block (`nano_aiu` and/or `token_buckets`):

- **Cost** — resolved per lane in precedence order **live → ref → ledger**: the
  local temp buffer first; then, for a rostered member whose buffer was already
  flushed, its synced `refs/harness-telemetry/*` rollup (`source: ref`); then its
  vendor **ledger** (`source: ledger`) — the copilot `session.shutdown` billing
  record or the codex rollout `token_count` total, joined through the pij registry.
  `totals.cost.grand_total` sums `tokens.grand_total` over lanes with
  `cost_measured: true`; a lane that resolves to a tier but whose cost can't be read
  — a live copilot-null lane, or a **present-but-malformed** ledger/rollup — stays
  `cost_measured: false`, **excluded from the sum** (never zero-filled) and counted
  in `unmeasured_lanes`, so a broken side-channel **degrades** the lane rather than
  making the member vanish. A rostered member with **no resolvable source at all** is
  instead an `orphan` (below), not a zero-filled lane. Fleet cost is still an honest
  **lower bound**.
- **Time** — `totals.time.wall_clock_s` is the **union** of the lanes' event-time
  spans; `active_s` is their **sum**; `active/wall` is the parallelism ratio. Both
  come from `event_stream[].t` timestamps (the segment `window` is an event index,
  not wall-clock), and are `null` only when no lane had a measurable span. Ledger
  lanes carry no event stream, so they add cost but not time.
- **Membership** — without a roster the `scope` is `env-tree` (a superset: a
  parent pij id is stable across the orchestrator's whole life, so it can conflate
  several runs). With `--roster`, `scope` is `roster` and two diffs surface the
  discrepancy as a first-class signal: `orphans` (rostered ids that resolved to no
  source at all) and `unrostered` (env-tree children absent from the roster).

Depth-1 by contract (grandchildren are reserved, not walked). Read-only and
fail-safe — an unknown root or an empty buffer resolves to an honest error /
`null`, never a throw. See `docs/plans/051-pij-fleet-session-eval/` for the design
(workshop D1–D3) and `docs/plans/052-fleet-telemetry-lane-sources/` for the lane
sources below.

### Lane sources — where each harness's cost + semantics live

The knowledge that used to be tribal (which side-channel holds which harness's
cost, when it materializes, and the key that joins it) is the matrix below. Every
cell is a **deterministic reader** inside `get-fleet` — no hand archaeology.

| harness | cost source | **materializes** | join key | semantics | never available |
|---|---|---|---|---|---|
| **claude** (orchestrator) | live temp segments → synced `ref` rollup | per-command (live), then on `checks`/sync flush | `captured_env.PIJ_SESSION_ID` (live) · ref last path segment (ref) | full artifact/flow/skill events | — |
| **copilot** (worker) | `~/.copilot/session-state/<id>/events.jsonl` → `session.shutdown` (`totalNanoAiu` = AIC×1e9, `tokenDetails`, `codeChanges`) | **shutdown-only** — written once, at graceful session end | pij registry `harnessSessionId` → the session dir | `artifact` events (F-07 fix: `create`/`edit` paths now captured) | live per-command tokens (always null mid-session — F-01) |
| **codex** (worker) | `~/.codex/sessions/<Y/M/D>/rollout-*.jsonl` → last `token_count` (`total_token_usage`) | per-turn, running total | pij registry `transcriptPath` (else session-id in the rollout filename) | none captured | AIC (codex bills in raw tokens) |
| **pi** (worker) | — (no harness telemetry, no side-channel ledger yet) | — | pij registry | none | cost + semantics (documented gap) |

The load-bearing caveat is **materialization timing**: a copilot lane's billing
exists **only after** the session shuts down gracefully — a `get-fleet` run while a
copilot worker is still live reads its ledger as unmeasured. Read-only peers (a
reviewer that never commits) leave **no** harness telemetry at all; the shutdown
ledger is their only trace (dossier F-05).

### Run-end sweep — and the teardown-order trap

Two facts collide at teardown, and getting the order wrong **silently** degrades
every worker lane to `cost_measured: false` — it never errors, the fleet just comes
back unmeasured:

1. A copilot lane's cost lives **only** in its `session.shutdown` ledger, written
   **only when the peer exits** — a still-live peer reads as unmeasured (F-01). You
   have to end the peer to get its cost.
2. The ledger's **join key** is the pij registry descriptor (`~/.pij/<id>.json` →
   `harnessSessionId` → the session dir), and **`pij close` deletes that
   descriptor**. Ending the peer destroys the join.

So the one action that *writes* a copilot ledger is the same action that *breaks the
join to it* — you cannot hold both through the descriptor alone. The way out is the
run's `run.json` roster: `pij spawn` records each member's `harnessSessionId` there
at spawn (before use, P9), so the join **survives teardown through the roster**
instead of the deleted descriptor. `get-fleet` reads that fallback — when a rostered
member has no `~/.pij` descriptor (closed) but its `run.json` entry carries a
`harnessSessionId`, the vendor ledger still resolves. So the sweep works even after
teardown:

```sh
# 1. flush every still-live lane's buffer into its ref rollup
harness telemetry sync
# 2. close each spawned copilot/codex peer so it writes its shutdown/rollout ledger
#    (this ALSO deletes its ~/.pij descriptor — expected; the run.json roster is the join now)
pij close <peer-id>            # for each peer you spawned
# 3. snapshot the joined fleet — the roster supplies harnessSessionId, so the ledgers
#    under ~/.copilot/session-state/<id>/ + ~/.codex/sessions/ still resolve
harness telemetry get-fleet <root-pij-id> --roster <run.json> --json > fleet.json
```

> **The descriptor still wins when present** — the roster fallback fires only for a
> member the pij registry no longer has, so a *live* fleet joins exactly as before
> (byte-inert pre-teardown). The join key is `run.json`'s `harnessSessionId`, so an
> old `run.json` that predates it (pijId-only) can't recover a closed lane — regenerate
> the roster or snapshot before close. A cleaner live path (consume `pij sessions
> --json` instead of globbing `~/.pij`) is an optional follow-on, not required for
> correctness.

### Billing conventions (F-10)

Report **billing units, never raw token grand totals**. Copilot bills in **AIC**
(`nano_aiu / 1e9`, ≈ \$0.01/credit); codex and others are indicative USD via a
pricing table (an analysis-layer concern — the CLI emits raw units only, never a USD
conversion). `totalPremiumRequests` is a **legacy** (pre-2026-06) field — carried for
provenance, **never** surfaced as cost. Cache reads dominate modern token totals (a
long orchestrator lane can be ~98% cache reads, billed at ~1/10 the input rate), so
the raw `grand_total` overstates spend — the per-lane `billing` block is the
authoritative unit.

### Fleet semantics — the process shape, not just the price

Cost and time say what a run *consumed*; the **semantic rollup** says what the
process *did*. Every lane carries a `semantics` block, and the fleet a top-level
one, aggregated from the lane's `artifact`/`flow` events (the [artifact
semantics](#the-event-stream-v20) above) — **counts/enums only**, no prose:

- **review** `findings` by severity, the ordered `verdicts` path, and `fix_cycles`
  (`FIX_REQUIRED → APPROVE` transitions);
- **plan** `plan_phases` + `plan_cs`; **workshop** `workshop_decisions`;
- **flight-plan** `nodes` / `nodes_done` / `chores_done` / `chores_todo`;
- per-stage `flow_stage_time_s`.

The load-bearing rule is the honesty flag **`semantics_measured`**: a lane with no
artifact capture is `semantics_measured: false` and **omits every dimension — never
a `0`**. So a blind lane is distinguishable from one that measured *zero* findings
(that lane is `semantics_measured: true` with `findings: {critical: 0, …}`). Each
dimension is emitted only when its artifact type was captured, so a lane that saw a
plan but not the review reports `plan_phases` and **no** `findings` — the review
ran elsewhere, and the rollup says so by omission.

Read the fleet-level **`measured_lanes` / `blind_lanes`** counts *first*: they are
the coverage truth. A telemetry-only report can claim the process shape of the
**instrumented** lanes; it **cannot** claim what happened in blind ones. In a
flow-pair run that means the orchestrator's planning artifacts surface, but a
read-only reviewer's findings (no harness telemetry — F-05) and a worker that
emitted 0 artifact events (F-07) are absent — reported as blind, not as zero. A
read-only reviewer can **opt out of blindness** by emitting a `mark` (see
[Marks](#marks--peer-self-attestation-harness-telemetry-mark) below): its verdict
then lands on its own lane's `semantics.mark` and the lane reads
`semantics_measured: true`. See
`docs/plans/052-fleet-telemetry-lane-sources/evidence/fleet-051-semantics-note.md`
for a worked reconcile of a real fleet against a hand-made quality table, with
every discrepancy (blind lane vs extractor precision vs capture-time drift)
enumerated. Ledger- and ref-resolved lanes recover **cost** but not the event
stream, so they are semantically blind until worker-lane artifact capture lands.

## Marks — peer self-attestation (`harness telemetry mark`)

Every semantic event above is **auto-derived** during passive capture — a review
`artifact` only appears because a reviewer *wrote a review file*. A **read-only
reviewer** runs no harness command and may write no file, so its verdict never
reaches its lane: the lane is blind (F-05). `harness telemetry mark` closes that
hole. It is the one **agent-invoked** semantic emit — a peer stamps a counts-only
marker onto **its own** session lane with a single call:

```bash
harness telemetry mark --kind review --verdict fix-required --findings-critical 1
```

- **Shape-guarded, no free text.** `--kind` and `--verdict` are identifier slugs
  (`^[a-z][a-z0-9-]{0,31}$`); the finding buckets (`--findings-critical` /
  `-high` / `-med` / `-low`, plus a total `--findings`) are non-negative integers.
  There is **no prose field by construction** — a bad slug (uppercase, whitespace,
  over-long) is rejected with an `unconfigured` outcome (exit 2) naming the shape,
  and **no marker is written** (telemetry is best-effort — it never blocks work).
- **Cost-excluded, attribution-visible.** The marker is its own segment carrying
  `tokens: null` and a single `mark` event; it contributes **zero** to
  rollup gap/time/token math (like `artifact`/`flow_log`, it rides a capture-time
  `t`) and zero to fleet cost. It surfaces on the emitting lane's
  `semantics.mark` (`marks`, `kinds`, deduped `verdicts`, summed `findings`), and
  a **mark-only lane is no longer blind** (`semantics_measured: true`).
- **Generic — the vocabulary is prose, not a second binary.** The verb carries no
  flow-stage vocabulary. The flow/skill layer decides *which* `kind`/`verdict` to
  emit and formats the call as prose the agent renders — the Node CLI stays the one
  cross-platform surface; there is no skill-side executable to install.

**Where a mark shows up (F3 nuance).** A mark surfaces through
`harness telemetry get-fleet` (read from the **live buffer** `<seq>.json`), **not**
through `harness telemetry report` or the committed OTLP shards — the marker
deliberately writes **no** OTLP sidecar, so it is fleet-attribution evidence, not
part of the reconstruction-critical `harness.*` transport. Emit a mark, then read
it back on your lane:

```bash
harness telemetry mark --kind review --verdict approve
harness telemetry get-fleet <root-pij-id> --json    # → sessions[].semantics.mark
```

## Summarizing the local buffer — `harness telemetry summary`

Use the read-only summary when you need a quick view of the telemetry currently
retained under `.harness/temp/telemetry`:

```bash
harness telemetry summary
harness telemetry summary --json
```

The command scans every numeric `<seq>.json` segment in every local session
directory. It reports the total recognized event count, counts in the closed
`EVENT_KINDS` order, and one ascending `YYYY-MM-DD` entry per **UTC** calendar
day with its total and per-kind counts. Timestamp offsets are converted to their
UTC instant before grouping.

This is a summary of the **whole retained local buffer**, not only telemetry
that is pending sync. It never writes a cursor or watermark, prunes a segment,
reads or writes a git ref, or triggers `telemetry sync`. The capture preamble
explicitly excludes this command, so invoking the summary does not create a
segment of its own. An absent buffer is a successful zero summary.

Malformed segment JSON and unrecognized event kinds are skipped without hiding
the omission: the result includes scanned-session, counted/skipped-segment,
counted/skipped-event, and undated-event diagnostics. A recognized event with
an invalid timestamp still contributes to its global kind count, but not to a
day bucket.

Human mode prints deterministic `by kind` and `by UTC day` sections. JSON mode
returns the same data in the standard successful `telemetry` envelope:

```json
{
  "data": {
    "source": ".harness/temp/telemetry",
    "sessions_scanned": 2,
    "segments_counted": 5,
    "segments_skipped": 0,
    "events_counted": 42,
    "events_skipped": 0,
    "undated_events": 0,
    "by_kind": { "prompt": 4, "turn": 8 },
    "by_day": [
      {
        "day": "2026-08-03",
        "total": 42,
        "by_kind": { "prompt": 4, "turn": 8 }
      }
    ]
  }
}
```

## Syncing — `harness telemetry sync`

Capture is decoupled from push. Run sync explicitly (e.g. at the end of a session,
from a `ship` step, or on a schedule):

```bash
harness telemetry sync
```

It rolls every buffered segment up into **one ref per session, keyed at the
session's start date** — `refs/harness-telemetry/<start-YYYY>/<MM>/<DD>/<session>`
— rebuilt from the whole local buffer on each sync, and force-pushes that single
refspec using your **ambient git credentials** (the CLI handles no tokens). The
ref's commit tree carries the entire session: `session.logs.jsonl` +
`session.metrics.jsonl` (every seq's OTLP record, concatenated seq-ordered) + a
`manifest.json` (format marker, start date, max published seq). The start date is
taken from the session's first segment and pinned in a `<session>.startdate`
sidecar, so a session that crosses midnight — or spans several days — stays at
**one** ref at its start date rather than trailing a ref-per-day. Each sync
rewrites the ref with a fresh orphan commit (a full rewrite, so the tip tree is
always the whole session), which is why the push is **forced** (`+ref:ref`);
re-syncing with nothing new re-pushes the same content without a duplicate commit.

### Automatic sync on `checks`

You rarely need to run sync by hand. The two **well-known** commands carry
telemetry housekeeping, surfaced as an additive `housekeeping[]` field on their
JSON envelope (and one stderr line each in human mode) — they never change the
command's own status or exit code:

| Command | Behaviour |
|---|---|
| `checks` | **Auto-pushes** buffered telemetry (best-effort), unless disabled. `checks` is the wrap-up gate, so it is the natural flush point. |
| `boot` · `doctor` | **Nudge only** — if telemetry is unpushed they warn you to run `harness telemetry sync`; they never push. |

Because the capture preamble runs **before** every command's body, by the time
`checks` reaches its auto-push the segment for that run is already buffered —
**capture strictly precedes push**. The auto-push is the same `harness telemetry
sync` flush, just invoked for you.

It is **defensive by contract**: any failure (offline, no auth, a hung push —
bounded by a timeout) is *reported*, never thrown, and never fails `checks`:

```json
// checks succeeded; telemetry flushed alongside it
"housekeeping": [{ "kind": "telemetry-synced", "message": "auto-pushed 4 telemetry segment(s)",
                   "details": { "count": 4, "sessions": 1 } }]

// checks ran; the auto-push could not land — reported, checks unaffected
"housekeeping": [{ "kind": "telemetry-autosync-failed", "message": "telemetry auto-sync failed: …",
                   "command": "harness telemetry sync" }]

// boot/doctor (or checks with autosync disabled) with a backlog
"housekeeping": [{ "kind": "telemetry-unpushed", "message": "4 telemetry segment(s) not yet pushed",
                   "command": "harness telemetry sync", "details": { "count": 4, "sessions": 1 } }]
```

To keep the auto-push but silence it, or to turn it off, see
[Disabling telemetry](#disabling-telemetry).

### Team scale — many engineers, one repo

A single shared, mutable `refs/harness-telemetry` does **not** work for a team:
many engineers pushing from independent clones is a distributed write-contention
problem — every pusher after the first gets a non-fast-forward rejection, and
their telemetry never drains. **One ref per session solves this structurally:**
no two writers ever target the same ref (a session's buffer lives in exactly one
clone), so each writer owns its ref outright and force-pushes its own rewrite —
no fetch, no merge, no cross-writer retry. This is the canonical git pattern for
"many writers append out-of-tree metadata" (cf. Gerrit `refs/changes/*`, GitHub
`refs/pull/*`). Because a session is written by a single clone, the append stays
**fetch-free**: the rewrite reads the local buffer + a local ref-tree peel, never
the remote.

The ref key is the **session** (an opaque per-session id — the contributor
identity rides on the commit, not the ref name; [§ Attribution](#attribution--contributor-commit-team-grain-use)),
so keying per session introduces no new identity exposure beyond what the commit
already carries.

**Collecting it upstream is one fetch, not many.** A globbed refspec is a single
network round-trip — the server advertises every matching ref at once:

```bash
git fetch origin '+refs/harness-telemetry/*:refs/harness-telemetry/*'   # all sessions, one fetch
```

Ref count stays cheap (a ref is just a name + a SHA; problems only begin in the
tens-of-thousands), and the **start-date** prefix is the **retention/prune key** —
a scraper drops a day after ingesting it:

```bash
git push origin --delete 'refs/harness-telemetry/2026/03/23/<session>'   # prune after ingest (by start date)
```

Treat the refs as an **ingestion buffer, not the system of record**: long-term
storage lives in the downstream telemetry system; `git gc` reclaims the objects
once a pruned ref is unreachable.

**Keeping it out of day-to-day git.** The namespace is already invisible to
branch/PR operations. To also hide it from ordinary clones/fetches, set
server-side:

```
git config uploadpack.hideRefs refs/harness-telemetry/   # (or transfer.hideRefs / receive.hideRefs)
```

The scraper simply doesn't apply the filter.

### Offline-safe

A failed shard push (offline, no auth) is **not** an error for the host and
**does not lose data**: that shard's buffer is left intact (the per-session
`<session>.flushed` watermark is not advanced past it) and its local ref is rolled
back, so the next `harness telemetry sync` retries the same segments cleanly.
Shards are pushed in capture order and the watermark advances only across the
ones that landed, so a mid-flush failure never strands or double-flushes a
segment. The explicit verb reports a non-zero exit so a CI/cron caller can see a
push didn't land; the buffer is preserved either way.

## Attribution — contributor commit, team-grain use

Every telemetry commit's author **and** committer are the **contributor's own
configured git identity** (the 2026-06-25 decision), so each
`refs/harness-telemetry/*` shard is traceable to **who pushed it** — the same
attribution `git log` gives any commit. The generic `harness-telemetry
<noreply@…>` identity is used **only** as a fallback when the repo has no
configured `user.name`/`user.email`, so an unconfigured environment never fails
the commit. Shard refs are keyed by **session** (an opaque per-session id), not by
engineer — sharding is for write-isolation; the contributor identity lives on the
commit.

**Usage norm (P12):** attribution makes a push *traceable*, but the counts remain
intended for **team/repo-grain** measurement — not a per-person productivity
scoreboard (see the do-not-use-for-individuals list in
[Harness value measures § Team-level only](./harness-value-measures.md#team-level-only--never-individual-attribution)).
The optional `agent` provenance field follows the house pattern (nullable, `null`
when unset).

## Best-effort, not billing-grade

Capture is best-effort. The window after the *last* command of a session is a
trailing tail — captured by **session-end flush**: because the capture preamble
runs before *every* command (including `harness telemetry sync`), wiring a host
**SessionEnd hook to `harness telemetry sync`** records that tail segment (the
cursor delta) and flushes it in one step — no extra command. the-flow's `ship`
already runs `telemetry sync`, so a shipped session flushes its tail for free; a
session that ends without the hook (or is killed) loses only its final tail, never
an interior segment (the `window` bounds make any gap visible, not hidden). Token
sources are read from each harness's authoritative artifacts; when a source is
absent the field is `null`, never estimated.

### Known limitations

- **Subagent token attribution.** On real Claude transcripts, `subagents[].tokens`
  is frequently `null` — the per-subagent cost is not reliably correlatable from
  the live transcript shape today (subagent *identity* and lifecycle are still
  captured). This is a known gap pending a follow-up probe of the live `usage`
  shape; it is not estimated in the meantime.
- **Out-of-repo path fidelity.** As above, files written outside the repo are
  recorded as basenames only — intentional (no leak) but lossy for correlation.
- **Ledger-join after teardown needs a fresh `run.json`.** The copilot/codex ledger
  join runs through the pij descriptor (`~/.pij/<id>.json`), which `pij close` deletes.
  `get-fleet` covers this with a **descriptor-independent fallback** (SUGG-001,
  shipped): a rostered member with no live descriptor but a `harnessSessionId` in
  `run.json` still resolves its ledger — so the [run-end sweep](#run-end-sweep--and-the-teardown-order-trap)
  works after close. The residual limit is roster freshness: a `run.json` written
  before this fix (pijId-only, no `harnessSessionId`) can't recover a torn-down lane —
  regenerate the roster or snapshot before close.
- **Read-only-peer semantics recovery is unproven.** A reviewer that runs no harness
  command emits no segment (F-05); its verdict survives only in the review *file* it
  writes, which enters telemetry only if the committing lane's capture observes that
  write. That the verdict then lands on the committer's lane (the orchestrator, in
  flow-pair) is the design intent but is **not yet proven live** — treat read-only
  peers as semantically blind until a measured fleet demonstrates otherwise.

## See also

- [Harness value measures](./harness-value-measures.md) — how the `segment`
  contract feeds the team/repo-grain eng-thrive measures.
- `harness/cli/src/services/telemetry/segment.schema.json` — the machine schema.
