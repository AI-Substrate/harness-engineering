# Harness telemetry — reports, rollups & the central store

How an archived or explicitly captured session becomes a **report** and a **rendered view** — the
`session save → report → report-render` pipeline (plan 047) — and how those leaves
lay out **centrally**, at fleet scale, so an org/repo/day rollup is just a recursive
sweep. This sits on top of the [OTLP stored shape](./telemetry-otlp.md): the git
refs hold the counts-only OTLP spool; this page is about reading it back into a
`SessionExport`, rolling many of those into a `TelemetryReport`, and rendering.

> **Counts-only, estimate-honest.** Every number here is either an **exact count**
> (events, tool calls, commands) or a **declared estimate** (per-dimension time and
> token attribution). Reports never invent a ledger — the `attribution` block on
> every report says, in-band, exactly how each number was derived. Nothing reads a
> person's identity: the read path issues only `for-each-ref` + `cat-file`, never
> `git config user.email`.

> **The corpus is frozen, the reader is live.** Harness capture is off by
> default under plan 073, but published refs and saved exports remain readable.
> New default-install sessions do not appear here; use
> [git-ai](./gitai-collector.md) for current collection.

---

## The pipeline in one minute

```
buffered segments / committed shards
        │  telemetry session save <id>
        ▼
  <id>.session.json      one SessionExport  (+ <id>.session.html co-produced view)
        │  telemetry report <paths…>
        ▼
  <name>.report.json     one TelemetryReport (+ index.html co-produced view)
        │  telemetry report-render <folder>
        ▼
  index.html             N reports → N labelled columns (no data regen)
```

- **`session save`** combines ONE session's segments into a single `SessionExport`.
- **`report`** rolls up 1..N saved `*.session.json` into ONE `TelemetryReport` — a
  recursive sweep, filterable, with a co-produced self-contained HTML.
- **`report-render`** renders every `*.report.json` in a folder into ONE HTML with
  one labelled column per report (the comparison view) — pure render, no re-aggregation.

Each data verb **co-produces** its own self-contained HTML view (suppress with
`--no-html`); the render verb only composes already-computed reports.

---

## The five verbs

This page details the three core report verbs below. Two additional shipped
read verbs operate above them:

- `telemetry sweep` reads a month of committed telemetry and caches per-session
  exports.
- `telemetry insights` joins saved reports into cohort analytics; see
  [Cohort telemetry insights](./cohort-telemetry-insights.md).

### `harness telemetry session save <session-id>`

Combine a session's buffered segments into one schema-valid `SessionExport`.

| Flag | Default | Meaning |
|---|---|---|
| `--source <temp\|git-ref\|auto>` | `auto` | Where to read: `temp` (local buffer), `git-ref` (committed shards read read-only from `refs/harness-telemetry/*`), or `auto` (git-ref shadows temp for the same `<seq>`) |
| `--out <path>` | `<session-id>.session.json` | Output path for the `.session.json` |
| `--no-html` | HTML on | Suppress the co-produced self-contained HTML view |

`--source git-ref` reads committed telemetry **without touching the working tree**
(`git status --porcelain` is byte-identical before and after) — a `for-each-ref`
enumeration + a `cat-file` tree walk, never a write/fetch/checkout. Because the
committed shard is the OTLP pair (`<seq>.logs.jsonl` + `<seq>.metrics.jsonl`) with
**no** `<seq>.json` (the segment json stays local — see [telemetry-otlp](./telemetry-otlp.md)),
the git-ref combine reconstructs the segment + identity **from the OTLP Logs blob
directly** (`harness.*` resource attributes for identity), yielding the same
`SessionExport` shape as `--source temp`.

### `harness telemetry report <paths…>`

Roll up 1..N saved `*.session.json` into one `TelemetryReport` (+ a self-contained
HTML) — a recursive sweep, filterable.

| Flag | Default | Meaning |
|---|---|---|
| `--out <dir-or-file>` | `./telemetry-report` | Output folder (`json` + `index.html`), or a `*.json` file for data-only |
| `--name <label>` | derived from filter | Report file stem + HTML column label |
| `--filter-harness <a,b>` | — | Only sessions from these harnesses (`claude-code`, `copilot-cli`, `cursor`, …) |
| `--filter-model <m,…>` | — | Only sessions using these models |
| `--filter-branch <b,…>` | — | Only sessions on these branches |
| `--filter-repo <r,…>` | — | **Echoed only** — repo is not a v1 session facet, so it is recorded in `filter.repo` but **not applied** (the central tree partitions by repo path instead) |
| `--from <iso>` / `--to <iso>` | — | Activity-window bounds |
| `--sort <tokens\|time\|count>` | `tokens` | Rollup row ordering |
| `--top <n>` | — | Cap rows per rollup (records `rollup.truncated`; never silent) |
| `--no-html` | HTML on | Data-only: skip the co-produced render |

The `<paths…>` may be `*.session.json` files, folders (swept **recursively**), or a
mix. **Sweep level = rollup granularity**: point it at one file for a single-session
report, a repo dir for a repo rollup, or the central root for an org rollup.

### `harness telemetry report-render <folder>`

Render the `*.report.json` in a folder into one self-contained `index.html` — N
reports become N labelled columns, no data regeneration. This is the **comparison**
surface: produce one `report … --no-html --name <arm>` per arm into a shared folder,
then `report-render` that folder to get e.g. Opus-vs-gpt-5.5 columns side by side.

---

## The two JSON shapes

### `SessionExport` (`harness.session-export/v1`)

One session, combined. Additive schema (pinned `schema_version`).

| Field | What it holds |
|---|---|
| `identity` | `harness_session_id`, `harness`, `harness_version`, `pij_session_id`, `branch`, `models[]` — **identity lives in the file, never in a path** |
| `source` | `{ kind: 'temp' \| 'git-ref', root, segment_count }` — where the bytes came from + how many segments combined |
| `summary` | `segment_schema_versions` histogram, `first_timecode`/`last_timecode`, `tokens` (buckets + honest `'unknown'` for un-derivable subagent totals), `degraded[]` (fields absent/unknown, surfaced honestly) |
| `signals` | `logs` (OTLP Logs — the event stream) + `metrics` (OTLP Metrics — the derived rollup) |

### `TelemetryReport` (`harness.telemetry-report/v1`)

Many sessions, rolled up. Re-aggregated **from the Logs**, never by summing
cumulative metrics.

| Field | What it holds |
|---|---|
| `scope` | `session_count`, `single` (true ⇒ one-session report), `session_ids[]` |
| `filter` | The facets that narrowed the report (`harness`/`model`/`branch`/`date`; `repo` echoed only) |
| `totals` | `time_s`, `tokens`, `sessions` |
| `rollups` | The **five dimensions** below — each a sorted, optionally-truncated table |
| `attribution` | How to read the numbers — `tokens`/`time` method, the `exact[]` counts, declared `notes[]` |
| `provenance` | Rendered at the bottom of the HTML: date range, repos, branches, harnesses, models, authoritative `session_count`, `source_paths`, `generated_at` |

### Reading token coverage

Token state is carried independently from the headline value. The public session,
fleet, report, sweep, and HTML surfaces use `measured`, `partial`, or `unavailable`
plus a closed reason. `partial` can contain real measured fields: a durable ref can
retain token values after the live buffer is pruned while honestly reporting that
another shard lacked usage. Consumers must render those present fields and their
per-field sources; they must not replace the whole lane with zero or label it fully
measured. When primary token coverage is unavailable but a billing field such as
`nano_aiu` is measured, the command remains degraded and reports the gap rather than
claiming a complete token total. Report JSON and HTML expose the coverage/reason
distribution so a zero-coverage cohort is visible, not mistaken for no activity.

#### The five rollup dimensions

| Dimension | Lens |
|---|---|
| `flow_stage` | Time/tokens by flow stage |
| `skill` | By skill invoked |
| `tool` | By tool call |
| `bash_command` | By shell command — **excludes** `harness …` invocations (no double-count) |
| `harness_command` | ⭐ the dedicated, prominent dimension — `harness …` invocations |

**Counts are exact; time and tokens are estimates.** Time is a `timeline-bracket`
(the gap after each event); tokens are a `turn-window-even-split`. The `attribution`
block declares this in-band so a reader never mistakes an estimate for a ledger.

---

## The archived central storage layout

The frozen v1 archive uses a single central root keyed by **repo then date** so
every rollup level remains a recursive sweep. No default v1 producer adds new
leaves; v2 may re-enter this contract:

```
<central-root>/
  <org__repo>/                             # e.g. acme-org__web-app  (org__repo, FS-safe)
    <YYYY-MM-DD>/                          # UTC collection date — the retention + incremental unit
      sessions/                            # format = saved SessionExport leaves
        <harness_session_id>.session.json  # leaf; identity (user/branch/models) is INSIDE the file
        <harness_session_id>.session.html  # co-produced view (optional)
      reports/                             # format = TelemetryReport leaves (e.g. a daily repo rollup)
        daily.report.json
        index.html                         # self-contained render of this folder's report(s)
```

- **Path scheme**: `<root>/<repo>/<YYYY-MM-DD>/<format>/<leaf>`, `<format> ∈ { sessions, reports }`.
- **Repo first** — an org rollup is a sweep of `<root>/`, a repo rollup a sweep of
  `<root>/<repo>/`, a day one level deeper.
- **Date second (UTC)** — the incremental-collection unit (a daily job writes only
  today's partition) **and** the retention unit (`rm -rf <repo>/<old-date>`).
- **Format third** — sibling `sessions/` vs `reports/` so a session sweep
  (`*.session.json`) never accidentally ingests a report.
- **Identity is in the file, not the path** — `harness_session_id` is globally
  unique, so the leaf name needs nothing else; user/branch/model are content filters,
  not partition keys. Only **repo + date** partition (the collection + retention keys).

### Sweep level = rollup granularity

| Want | Point `report` at | Result |
|---|---|---|
| one session | `…/<repo>/<date>/sessions/<id>.session.json` | single-session report |
| one repo, a day | `…/<repo>/<date>/sessions/` | repo-day rollup |
| one repo, all time | `…/<repo>/` (recursive) | repo rollup |
| the whole org | `<root>/` (recursive) | org rollup |
| compare two models, org-wide | two `report <root>/ --filter-model … --no-html` into one folder + `report-render` | side-by-side columns |

There is no special "org mode" — the layout is designed **around** the recursion, so
where you point IS the granularity.

> **Not defined here.** *Where* `<central-root>` lives (object store, shared FS, a
> collector repo) and *how* shards ship to it (a push/pull collection job) is an
> operations decision — this page fixes the **filesystem contract**, not the mover.

---

## Privacy — the publication boundary

The counts-only floor extends to every **tracked** artifact this pipeline emits:

- **No identity read.** The git-ref read path issues only `for-each-ref` +
  `cat-file`. No export/report/render code reads `user.email`.
- **No leaked paths/ids/names.** Committed samples, goldens, docs, and rendered HTML
  carry no `/Users/…` path, real `harness_session_id`, `pij_session_id`, or person
  name — use synthetic ids (`<harness_session_id>`) and neutral repo slugs
  (`acme-org__web-app`) in anything committed.
- **Dodge the `*.log` trap.** The repo's `.gitignore` ignores `*.log`; a report or
  spool artifact must never be named `*.log` or it would silently fail to commit.
  This page's filename (`telemetry-reports.md`) is chosen to dodge it.

---

## See also

- [The git-ai collector handover](./gitai-collector.md) — why new default-install
  sessions no longer enter this archive.
- [Harness telemetry](./telemetry.md) — the frozen segment contract, read path,
  and explicit legacy-capture escape hatch.
- [Harness telemetry — the OTLP/OTEL stored shape](./telemetry-otlp.md) — how the
  segment is stored/published as OTLP and the keep-and-harden git refs the read path
  walks.
- [Harness value measures](./harness-value-measures.md) — what the downstream
  program engineers from the committed telemetry.
