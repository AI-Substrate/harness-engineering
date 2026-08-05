# Workshop: Report Model — rollups, filtering & the HTML render

**Type**: Storage Design / Data Model
**Plan**: 047-session-telemetry-dashboard
**Spec**: [session-telemetry-dashboard-plan.md](../session-telemetry-dashboard-plan.md) *(to be authored)*
**Grounds in**: [001-session-data-structure.md](./001-session-data-structure.md) (the per-session input) + a read of `scratch/old/session-view/{gen.py,session.json}` (the proven rollup dimensions)
**Created**: 2026-07-01
**Status**: Approved

**Value Thesis**: Lock the **shape of a telemetry report** — the JSON we produce by rolling up **one-or-many** saved sessions — so the headline numbers (total tokens, total time), the per-dimension breakdowns (flow-stage / skill / tool / bash-command / **harness-command**), the filter facets, the comparison contract, and the provenance footer are **one stable, validatable, renderable artifact**. The HTML is a thin pre-written template pointed at this JSON; nothing about the numbers lives in the view. Decided before any code so generation, the HTML, and the dashboard all read the same shape.
**Target Proof Level**: **Contract Ready** (report JSON schema + rollup dimensions + attribution model + filter + comparison + provenance — buildable as core CLI)
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Knowability** — "where did 1M tokens go?" becomes a single sorted table, not a forensic dig.
- **Implementation Readiness** — TS + JSON Schema + the attribution model + the exact rollup dimensions, grounded in the real telemetry fields.
- **Migration Safety** — additive `schema_version`; new rollup dimensions are new keys, never breaking changes.
- **Cross-Domain Coordination** — one shape the generator emits, the HTML renders, and the dashboard pivots over.

**Related Documents**:
- [001 — session data structure](./001-session-data-structure.md) — the combined-OTel **input** a report rolls up (one report sweeps N of these).
- 046 [flow-eval-loop](../../046-flow-eval-loop/flow-eval-loop-plan.md) — the eval can **embed** a report's rollups in its scored outputs; a report is telemetry insight, not a scored verdict.

---

## Purpose

Decide the data structure for a **telemetry report**: the rollup we generate across a **range** of saved sessions (one file, a folder, a tree — recursive), with totals, per-dimension breakdowns, filter facets, a multi-report comparison contract, and a provenance footer — all in JSON, with a **pre-written HTML template** that renders it (and compares several) with zero number-crunching in the view.

## Boundary — what this is NOT (read first)

> **A report is a derived rollup OVER sessions; it is not itself a session, and not an eval RunRecord.** Input = N `SessionExport` files (001). Output = one aggregated `TelemetryReport`. The report answers *"across these sessions, where did the time and tokens go?"* — it does **not** score quality (that's 046's `RunRecord`). The eval may *quote* report rollups; the two stores stay separate.

## Fresh Entrant Outcome

A fresh human or agent reaches **Contract Ready**: from the `TelemetryReport` schema + the rollup-dimension table + the attribution model + the filter/comparison/provenance contracts below, they can build `harness telemetry report` (CLI surface is workshop [003](./003-report-cli-surface.md)) with no further design.

---

## The rollup dimensions (grounded in real telemetry)

Every dimension is the **same row shape** — a `{ key, count, time_s, tokens }` entry — so the HTML renders them all with one component. The dimensions and their source of truth:

| Dimension | Example row | Source of truth (grounded) | Why it earns a column |
|---|---|---|---|
| **flow_stage** | `plan → 1.3 days, 200M tok` · `implement → 41% time, 612k tok` | the-flow stage skill markers in the timeline (`gen.py` `skill` events, MAJOR set) → window between markers | "which stage is expensive" — the loop-engineering question (the user's literal ask: time **and** tokens per stage across the whole report range) |
| **skill** | `the-flow ×12, 28m, 1.2M tok` · `grill-me → 4.2h, 380k tok` | skill invocations (`<command-name>` + Skill tool_use, `gen.py` L47–55) | which skills dominate (e.g. "how long/expensive is grill-me across this range") |
| **tool** | `Read ×340, 90k tok` | tool_use events (`gen.py` L52–59 / `all_tools`) | tool-mix shape |
| **bash_command** | `rg ×54, 28m, **1M tok**` | Bash tool_use, keyed by the **first argv token** of the command (parsed from `input.command`), **excluding `harness …`** | the user's literal ask — "am I spending 1M tokens on rg?" |
| **harness_command** ⭐ | `harness nav ×210`, `harness flow ×88`, `harness observe ×17` | the telemetry segment **`command` field** (`gen.py` `commands` counter, L72/90) — the **authoritative** harness-invocation count, *not* the transcript | **the special location** — the loop machinery's own cost, surfaced prominently and separately from generic bash |

> **Why `harness_command` is its own prominent rollup, not a bash row.** Two reasons. (1) **Authority**: every `harness …` CLI run spools its own telemetry segment, so the segment `command` counter is the *exact* count (`harness nav` called X times), whereas the transcript only sees the ones issued via Bash. (2) **Meaning**: harness commands are the *engineering-harness's own surface* — knowing `harness nav` ran 210 times for 0 productive tokens is a loop-health signal, not file-wrangling noise. It gets a **dedicated, prominent block** in both JSON (`rollups.harness_command`) and HTML (its own panel, not folded into `bash_command`). The `bash_command` rollup **excludes** `harness …` invocations so the two never double-count.

## Single-vs-many semantics (the user's rule)

- **N = 1** → the report is that one session's rollups (`scope.single = true`). The HTML shows one session's totals + breakdowns.
- **N > 1** → the **same dimensions**, aggregated across all sessions (`scope.single = false`): `rg` rows from every session sum into one `rg ×54, 28m, 1M tok`. The shape is **identical** either way — only `scope.session_count` and the magnitudes change — so the HTML template has one code path.

## The attribution model (the honest data-science note)

Counts are **exact** (event counts). **Time and token attribution to a dimension is an estimate**, and the report says so:

- **Tokens** are emitted per assistant turn (transcript correlation — see repo memory `telemetry-claude-transcript-correlation`). A turn is attributed to the **dimension active in its window**: tokens for a turn that issued `rg` are attributed to `bash_command: rg`; tokens during the `implement` stage window to `flow_stage: implement`. A turn touching several tools splits by **even share** (v1) — flagged, not pretended exact.
- **Time** is wall-clock between consecutive timeline events bracketing the dimension's activity.
- The report carries `attribution: { tokens: 'turn-window-even-split', time: 'timeline-bracket', exact: ['count'] }` so a reader never mistakes an estimate for a ledger. Refining the split (Open Q1) is a later pass; the **count** columns are always trustworthy.
- **Reuse the production rollup engine, not gen.py.** Time/idle math comes from `computeRollup` (`rollup.ts:135`, `IDLE_CAP_S=300` / `BURST_N_S=30`) — the same engine that already produces the per-session rollup — **not** a re-implementation of `gen.py` (reference-only; it reads the transcript and uses a divergent `1200s` idle cap). Cross-session reports **re-aggregate from OTLP Logs** (the lossless substrate), never by summing per-session cumulative metrics (those have per-session lifetime). The `harness_command` rollup reads the segment `command` field / `fold`'s `harness_verbs`; the `bash_command` rollup parses Bash tool events from `event_stream` (the flat `bash_commands`/`harness_commands` arrays were dropped in v2 segments).

## The data structure (Contract Ready)

### TypeScript

```typescript
type ReportSchema = 'harness.telemetry-report/v1';

/** One row — identical across every dimension so the HTML renders them uniformly. */
interface RollupEntry {
  key: string;                        // 'rg' | 'harness nav' | 'the-flow' | 'Read' | 'implement'
  count: number;                      // EXACT (event/segment count)
  time_s: number;                     // estimate (timeline-bracket)
  tokens: { output: number; total: number };  // estimate (turn-window split)
}

interface Rollup {
  dimension: 'flow_stage' | 'skill' | 'tool' | 'bash_command' | 'harness_command';
  entries: RollupEntry[];             // sorted desc (default tokens.total; --sort overrides)
  total: { count: number; time_s: number; tokens: { output: number; total: number } };
  truncated?: number;                 // rows dropped past a top-N cap (never silent — surfaced)
}

interface TelemetryReport {
  schema_version: ReportSchema;       // additive-only

  scope: {
    session_count: number;
    single: boolean;                  // true ⇒ one-session report
    session_ids: string[];            // harness_session_ids rolled up (capped list ⇒ see provenance.session_count)
  };

  /** What narrowed this report. Empty/absent field = that facet unfiltered. */
  filter: {
    harness?: string[];               // ['copilot-cli'] — the coding agent
    model?: string[];                 // ['claude-opus-4-8']
    branch?: string[];
    repo?: string[];
    date_from?: string; date_to?: string;
  };

  /** The headline numbers. */
  totals: { time_s: number; tokens: { output: number; total: number }; sessions: number };

  /** Every dimension, same row shape. */
  rollups: {
    flow_stage: Rollup;
    skill: Rollup;
    tool: Rollup;
    bash_command: Rollup;             // EXCLUDES harness … invocations
    harness_command: Rollup;          // ⭐ the special, prominent dimension
  };

  attribution: { tokens: string; time: string; exact: string[] };

  /** Rendered at the BOTTOM of the HTML — what this report is made of. */
  provenance: {
    date_range: { from: string; to: string };
    repos: string[];
    branches: string[];
    harnesses: string[];              // distinct coding agents present
    models: string[];                 // distinct models present
    session_count: number;            // authoritative N (scope.session_ids may be capped)
    source_paths: string[];           // the files/folders swept to build this
    generated_at: string;
  };
}
```

### JSON Schema (envelope core — additive)

```typescript
export const TELEMETRY_REPORT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['schema_version', 'scope', 'filter', 'totals', 'rollups', 'attribution', 'provenance'],
  additionalProperties: true,         // ← additive: a new dimension/facet never rejects an old reader
  properties: {
    schema_version: { const: 'harness.telemetry-report/v1' },
    rollups: {
      type: 'object',
      // each dimension is the same Rollup sub-schema; new dimensions are new optional keys
      additionalProperties: { $ref: '#/$defs/rollup' },
    },
    // … scope / filter / totals / attribution / provenance per the TS above
  },
  $defs: {
    rollup: {
      type: 'object', required: ['dimension', 'entries', 'total'],
      properties: {
        entries: { type: 'array', items: { $ref: '#/$defs/rollupEntry' } },
      },
    },
    rollupEntry: {
      type: 'object', required: ['key', 'count', 'time_s', 'tokens'],
    },
  },
} as const;
```

## Filtering (two places, one facet vocabulary)

The **same facet set** (`harness`, `model`, `branch`, `repo`, date range) filters in two ways:

1. **At generation** — `harness telemetry report <paths> --filter-model claude-opus-4-8` sweeps the range but **only includes** matching sessions; the chosen facets are echoed into `report.filter` so the artifact is self-describing. Produce one pre-filtered report per arm you want to compare (e.g. one `--filter-model claude-opus-4-8`, one `--filter-model gpt-5.5`).
2. **In the HTML** — the comparison template (below) reads each report's `report.filter` to **label its column** ("Opus 4.8" vs "gpt-5.5"). The HTML does not re-filter raw sessions; it composes already-filtered reports.

## The HTML render (self-contained static template, renders the report(s) in its own folder)

- **One self-contained static HTML file** — authored once (using the `frontend-design` skill), shipped with the CLI. **No server, no build, no toolchain**: open it from the filesystem and it works. Every number is read straight from `TelemetryReport`; the template **computes nothing** (same "view-not-store" rule as 001's session HTML). All durations render human-friendly (`1.3 days`, `4.2h`, `28m`) from `time_s`.
- **It renders whatever report JSON sits in its own folder** (the user's rule). Co-location is the binding: drop the static HTML beside one or more `*.report.json` files and it loads and renders **them** — no path argument, no rebuild. Re-point = copy it into a different folder. (Mirrors 001: `session.html` sits beside `session.json`; here the report HTML sits beside `*.report.json`.)
  - **One report in the folder** → one column: totals up top, the five rollup panels (with `harness_command` ⭐ in its own prominent block), provenance footer.
  - **Multiple reports in the folder → side-by-side columns.** Each `*.report.json` becomes a **column**, headed by its `report.filter` label (e.g. `Opus 4.8 | gpt-5.5`). Rows align by dimension key so `rg` lines up across columns — that's the comparison ("Opus vs gpt-5.5: total tokens, tokens on rg, time in plan, side by side"). To compare two arms you generate two pre-filtered reports (§Filtering) into the same folder; the HTML does the rest.
- **Loading mechanism = inline-embed at render, NOT runtime fetch** (grounded in the proven reference). A static page opened via `file://` **cannot `fetch` a sibling JSON** (browser CORS blocks `file://`), so the render step **inlines** the report JSON(s) into a copy of the template — exactly the proven pattern in `scratch/old/session-view/`: `gen.py` writes `<script type="application/json" id="session-data">…</script>` into the HTML (`gen.py:489`, `session-overview.html:890`), and there is **no `fetch`** anywhere (`file://` "just works"). So `report-render <folder>` reads the folder's `*.report.json`, embeds each as an inline `<script type="application/json">` block (one per comparison column), and writes a self-contained `index.html`. The **contract** is still "the HTML shows the reports in its folder, self-contained" — the *mechanism* is embed-at-render, not a runtime manifest/fetch.
- **Provenance footer, always.** Bottom of every render: date range · repos · branches · harnesses · models · "based on **N** sessions". So any reader sees *exactly* what data backs the numbers.
- Style reference: `scratch/old/session-view/session-overview.html` (the proven single-session overview); the report template generalises it to the multi-column comparison.

## The pipeline (the user's summary — end to end)

```
1. EXPORT  sessions (many telemetry files)  ──save──▶  one SessionExport per session   (workshop 001)
2. REPORT  sweep a range of SessionExports  ──roll up──▶  one+ TelemetryReport JSON     (this workshop; CLI = 003)
3. RENDER  drop the self-contained static HTML beside the report JSON(s) in a folder
           ──open──▶  it renders whatever report(s) are in that folder (1 = one column, N = compare columns)
```

Stages are decoupled: a report is reproducible from saved sessions; the HTML is reproducible from a report. Nothing downstream is the store.

## Downstream use (OUT OF SCOPE here — noted)

> **Future: telemetry-derived engineering metrics, in conjunction with DORA.** These report rollups are the raw material for later **metrics** correlated against DORA-style signals — e.g. *"when we spend more in `plan`, do we accrue fewer new bugs on the backlog?"* (process investment vs. defect/lead-time outcomes). **Out of scope for plan 047** — this plan produces the export → report → render substrate. Noted so the report shape stays **metrics-friendly** (stable dimension keys, declared attribution, machine-readable totals) for that consumer. The eval loop (046) is the nearer consumer; DORA correlation is the further one.

## Decision Space (resolved)

| Decision | Options | Resolution |
|---|---|---|
| **Report = own artifact vs. folded into session** | extend SessionExport / **separate TelemetryReport** | **Separate.** A report is a derived rollup over 1..N sessions; conflating it with one session breaks the many-sessions case. |
| **Harness commands: own dimension vs. bash rows** | fold into bash_command / **dedicated `harness_command`** | **Dedicated, prominent** — authoritative segment-`command` source + loop-health meaning; `bash_command` excludes `harness …` to avoid double-count. |
| **Single vs. many shape** | two shapes / **one shape, `scope.single` flag** | **One shape** — identical rollups; N=1 is just the degenerate case. One HTML path. |
| **Token/time attribution** | claim exact / **estimate + declared method** | **Estimate, declared** (`attribution` block); counts exact. Honest > falsely precise. |
| **Comparison engine** | CLI joins reports / **HTML composes N report JSONs into columns** | **HTML composes** — pre-written template takes multiple report files; columns labelled by each `report.filter`. CLI just produces (optionally pre-filtered) reports. |
| **Truncation** | silent top-N / **`truncated` count surfaced** | **Surfaced** — a rollup that caps rows records how many it dropped (no silent "covered everything"). |

## Boundary, placement & constraints

- **Core harness CLI** — generation + the template ship in `harness/cli` (workshop 003 owns the verbs), sibling to `telemetry session save` (001). Not a `.harness/` extension.
- **Report ≠ session ≠ eval record** — report rolls up sessions (001); eval (046) may quote a report. Three distinct stores.
- **Branch / git** — all work on `feat/041-flow-conformance-eval` (current PR); reports read session files / git-ref **read-only**; never modify git.

## Forward-compatibility rules (additive contract)

1. **`schema_version` pinned in every report**; readers ignore unknown keys (`additionalProperties: true`).
2. **A new rollup dimension is a new key under `rollups`** — old HTML ignores it; new HTML renders a new panel. Never a breaking change.
3. **New filter facets are optional** — an old report without `filter.repo` stays valid.
4. **Attribution method is versioned in-band** (`attribution.tokens`) so a refined split (Q1) is distinguishable from v1's even-split.

## Open Questions

### Q1: Token attribution split for multi-tool turns. **OPEN (refinement).** v1 = even split across the turn's tools/dimensions. Better: weight by output bytes or by tool latency. Non-blocking — the `attribution` block makes v1 honest; refine later without breaking the schema.
### Q2: Flow-stage windowing across session boundaries. **Note.** In a multi-session report, stage windows are per-session then summed; a stage spanning a compaction is bracketed by its markers within each session. Acceptable for v1.
### Q3: Per-bash-command token attribution fidelity. **Note.** "1M tokens on rg" attributes the *issuing turn's* tokens to rg — an upper-ish bound (the turn did more than rg). Stated via `attribution`; good enough for the "where did it go" question.

## Validation / Acceptance

Contract Ready when:
- The `TelemetryReport` envelope (TS + JSON Schema) with all five rollups incl. `harness_command` ⭐ is specified — ✅.
- The rollup-dimension source-of-truth table is grounded in real telemetry fields — ✅.
- The attribution model is declared (counts exact; time/tokens estimated + method) — ✅.
- Single-vs-many, filtering (two places), comparison (HTML composes N), and the provenance footer are unambiguous — ✅.
- The boundary (report ≠ session ≠ eval record) + core-CLI placement + git constraint are explicit — ✅.

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| Real rollup dimensions (commands/tools/skills/tokens/timeline) | `gen.py` + `session.json` keys | the dimension table | Ready (reference-grounded) |
| Segment `command` field = authoritative harness count | `gen.py` `commands` counter L72/90 | the ⭐ harness_command dimension | Ready |
| `TelemetryReport` TS + JSON Schema | §The data structure | the report shape | Ready (Contract) |
| Attribution model | §The attribution model | honest time/token columns | Ready |
| Comparison-by-columns contract | §The HTML render | Opus-vs-gpt-5.5 side-by-side | Ready |
