# Harness telemetry

How the harness captures a **counts-only**, per-session telemetry `segment` on
every command, buffers it out of your working tree, and flushes it to
per-session, date-sharded out-of-tree git refs for the eng-thrive measurement
program — plus how it is pushed (manually, or automatically on `checks`), how to
disable it, the structure it takes, and the privacy / offline guarantees.

> **This is the sensor, not the analyst.** Telemetry **emits + commits** faithful
> counts. It builds no scanner, no dashboard, no correlation. Downstream
> eng-thrive tooling reads the committed ref and engineers the measures — see
> [Harness value measures](./harness-value-measures.md).

---

## The model in one minute

Every `harness <verb>` runs a tiny, fail-safe **capture preamble** before the
command does its work. It detects the innermost agent harness (Claude Code,
Copilot CLI; Cursor later), reads everything that happened *since the last
command* via a per-session cursor, and writes one normalized `segment` — tokens,
skills, tools, subagents, files, plan links, model/branch/timecode — to a
**gitignored buffer**. Nothing is pushed on the hot path.

A separate, explicit step — `harness telemetry sync` — flushes the buffered
segments into **per-(capture-date, session) shard refs** under
`refs/harness-telemetry/`, via plumbing (never touching your index or working
tree), and pushes each shard. Sharding the ref namespace — rather than funnelling
a whole team into one shared ref — is what makes concurrent writers safe (see
[Team scale](#team-scale--many-engineers-one-repo)).

```
harness <verb>   ──preamble──▶  .harness/temp/telemetry/<session>/<seq>.json          (gitignored buffer)
harness telemetry sync          ──plumbing──▶  refs/harness-telemetry/<YYYY>/<MM>/<DD>/<session>  ──push──▶  central scraper
```

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
| `flow` | flight-plan `flow`/`stage`/`status` | `the-flow.json` nav (not args) |
| `harness` | sub-command verb (sans params) | `harness …` calls |
| `checks` / `command_exit` | gate verdicts / exit codes | a harness command's result |
| `subagent` · `compaction` · `model` · `api_error` | identity / presence / class | transcript signals |

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

**Per-harness ceilings (honest).** Claude and Copilot emit an *exact*-timed
stream (Copilot turns even carry per-interaction tokens). **Cursor** has no
transcript timestamps, so its events are **anchored** to the IDE-store bubble
times (`t_precision: "anchored"`) and carry **no tokens** (server-side only,
never estimated); a headless Cursor session with no bubbles emits a `null` stream
rather than a fabricated one. Outcome events follow each harness's result-capture
ability: Claude has the full result envelope (`checks` + `command_exit`), Copilot
reports only success (`command_exit`), Cursor neither.

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

## Syncing — `harness telemetry sync`

Capture is decoupled from push. Run sync explicitly (e.g. at the end of a session,
from a `ship` step, or on a schedule):

```bash
harness telemetry sync
```

It flushes every buffered segment past each session's watermark into
**per-(capture-date, session) shard refs** —
`refs/harness-telemetry/<YYYY>/<MM>/<DD>/<session>` — one commit per shard, and
pushes each shard's refspec using your **ambient git credentials** (the CLI
handles no tokens). Each shard's commit tree is a flat `<seq>.json` set; the
date+session hierarchy lives in the ref name, and the date is taken from each
segment's own capture timecode (so a session that crosses midnight splits cleanly
into one shard per day). Each shard ref is append-only, so re-syncing the same
session/date extends its history.

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
their telemetry never drains. **Sharding the ref namespace by (date, session)
solves this structurally:** no two writers ever target the same ref, so every
push is a clean create-or-fast-forward — no fetch, no merge, no retry. This is the
canonical git pattern for "many writers append out-of-tree metadata" (cf. Gerrit
`refs/changes/*`, GitHub `refs/pull/*`).

The shard key is the **session** (an opaque per-session id, never a person —
[§ Attribution](#attribution--teamrepo-only)), so sharding introduces no new
identity exposure beyond what the buffer paths already carry.

**Collecting it upstream is one fetch, not many.** A globbed refspec is a single
network round-trip — the server advertises every matching ref at once:

```bash
git fetch origin '+refs/harness-telemetry/*:refs/harness-telemetry/*'   # all sessions, one fetch
```

Ref count stays cheap (a ref is just a name + a SHA; problems only begin in the
tens-of-thousands), and the date prefix is the **retention/prune key** — a scraper
drops a day after ingesting it:

```bash
git push origin --delete 'refs/harness-telemetry/2026/03/23/<session>'   # prune after ingest
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

## Attribution — team/repo only

Telemetry is **team/repo-grained, never per-individual** (Constitution P12). Every
telemetry commit's author **and** committer are a fixed non-individual identity
(`harness-telemetry <noreply@…>`); your `git config user.email` is never read or
stored. The shard refs are keyed by **session** (an opaque per-session id), never
by engineer — sharding is for write-isolation, not attribution. The optional `agent` provenance field follows the house pattern (nullable,
`null` when unset) and is never reported per person. See
[Harness value measures § Team-level only](./harness-value-measures.md#d-anti-goodhart-team-level-and-the-under-reporting-defense).

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

## See also

- [Harness value measures](./harness-value-measures.md) — how the `segment`
  contract feeds the team/repo-grain eng-thrive measures.
- `harness/cli/src/services/telemetry/segment.schema.json` — the machine schema.
