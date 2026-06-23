# Harness telemetry

How the harness captures a **counts-only**, per-session telemetry `segment` on
every command, buffers it out of your working tree, and flushes it to a single
out-of-tree git ref for the eng-thrive measurement program — and the kill-switch,
privacy guarantees, offline behaviour, and known limitations you should know.

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
segments into one **orphan git ref**, `refs/harness-telemetry`, via plumbing
(never touching your index or working tree), and pushes that single ref.

```
harness <verb>   ──preamble──▶  .harness/temp/telemetry/<session>/<seq>.json   (gitignored buffer)
harness telemetry sync          ──plumbing──▶  refs/harness-telemetry  ──push──▶  central scraper
```

Two properties make this safe to run on **every** command:

- **Zero host impact.** Capture is wrapped so it can never change the host
  command's stdout, stderr, or exit code. Any error inside it is swallowed.
- **PR-invisible.** The buffer lives under `.harness/temp/`, which self-ignores
  (a nested `.gitignore` of `*`), and the durable write is an orphan ref via
  plumbing — so `git status --porcelain` is byte-identical across a capture and a
  flush. Telemetry never appears in a feature branch or a PR diff.

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
  `{written:[],edited:[]}`, `plans_touched` `[]`, and `events`
  `{compactions:[],api_errors:0,local_commands:0}`.

Either way the field is present (a stable shape for the scraper); only its value
reflects availability.

### Path semantics

File paths are recorded **repo-relative**. A path **outside** the repo is reduced
to its **basename only** — the directory is dropped (no information about your
home directory or machine layout leaks). For example, a write to
`/Users/alex/.claude/projects/abc/memory/note.md` is recorded as `note.md`,
while a write to `harness/cli/src/app.ts` keeps its full repo-relative path.

## The kill-switch

Set `HARNESS_NO_TELEMETRY=1` to disable capture **and** sync entirely — zero side
effects, no buffer writes, no ref writes. Capture is on by default (unset).

```bash
export HARNESS_NO_TELEMETRY=1   # this shell captures nothing
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

It flushes every buffered segment past each session's watermark into one commit
on `refs/harness-telemetry` and pushes that single refspec
(`refs/harness-telemetry:refs/harness-telemetry`) using your **ambient git
credentials** — the CLI handles no tokens. The orphan ref accumulates an
append-only history (one commit per flush; segments live under
`<session>/<seq>.json` in the commit tree), so a central scraper fetches **one
ref per repo** to collect everything.

### Offline-safe

A failed push (offline, no auth, non-fast-forward) is **not** an error for the
host and **does not lose data**: the buffer is left intact (its per-session
`<session>.flushed` watermark is not advanced) and the local ref is rolled back,
so the next `harness telemetry sync` retries the same segments cleanly. The
explicit verb reports a non-zero exit so a CI/cron caller can see the push didn't
land; the buffer is preserved either way.

## Attribution — team/repo only

Telemetry is **team/repo-grained, never per-individual** (Constitution P12). The
orphan-ref commit author **and** committer are a fixed non-individual identity
(`harness-telemetry <noreply@…>`); your `git config user.email` is never read or
stored. The optional `agent` provenance field follows the house pattern (nullable,
`null` when unset) and is never reported per person. See
[Harness value measures § Team-level only](./harness-value-measures.md#d-anti-goodhart-team-level-and-the-under-reporting-defense).

## Best-effort, not billing-grade

Capture is best-effort. The window after the *last* command of a session is a
trailing tail that may go uncaptured until the next command (or a sync) — the
segment emits its `window` bounds so any gap is visible, not hidden. Token sources
are read from each harness's authoritative artifacts; when a source is absent the
field is `null`, never estimated.

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
