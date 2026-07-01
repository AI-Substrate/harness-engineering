# Workshop: Report CLI Surface — produce reports & render them

**Type**: CLI / Interface Design
**Plan**: 047-session-telemetry-dashboard
**Spec**: [session-telemetry-dashboard-plan.md](../session-telemetry-dashboard-plan.md) *(to be authored)*
**Grounds in**: [002-report-model-rollups-and-html.md](./002-report-model-rollups-and-html.md) (the report shape) + [001-session-data-structure.md](./001-session-data-structure.md) (the input) + the existing `harness telemetry` verb family
**Created**: 2026-07-01
**Status**: Approved

**Value Thesis**: Lock the **command surface** that turns a range of saved sessions into report JSON + a rendered HTML — recursive over files/folders, filterable by the 002 facets, producing self-contained renders that compare side-by-side. One coherent verb family so a human (or the eval loop) generates an org-wide or single-session report the same way, with the recursion + folder layout doing the aggregation work.
**Target Proof Level**: **Contract Ready** (verbs + flags + IO contract + recursion semantics + how comparison is produced)
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Implementation Readiness** — exact verbs, flags, inputs, outputs; sibling to existing `telemetry` commands.
- **Knowability** — "report on this folder" is one command; the recursion does the rollup.
- **Cross-Domain Coordination** — the same sweep yields a single-session, a repo, or an org report depending only on where you point it (pairs with workshop 004's layout).

**Related Documents**:
- [002 — report model](./002-report-model-rollups-and-html.md) — the JSON this CLI emits + the HTML it renders.
- [004 — central session storage layout](./004-central-session-storage-layout.md) — the directory tree this CLI sweeps (sweep level = rollup granularity).

---

## Purpose

Decide the **CLI verbs + flags** to (1) generate a `TelemetryReport` (002) from a **range** of saved sessions — one file, a folder, a whole tree, recursively — with optional filtering, and (2) render report JSON(s) to the self-contained static HTML. Core harness CLI, sibling to `telemetry session save` (001) and `telemetry sync`.

## Boundary

> This workshop owns the **interface**; 002 owns the **data shape** and 004 owns the **directory layout**. The CLI is the seam: it reads `SessionExport` files, writes `TelemetryReport` JSON, and drops the static HTML beside them.

## Fresh Entrant Outcome

Contract Ready: from the verb table + flag semantics + IO contract below, build `harness telemetry report` (+ the render verb) with no further interface design.

---

## The verbs (Contract Ready)

```
harness telemetry report <paths...> [flags]      # sweep sessions → report JSON (+ HTML)
harness telemetry report-render <folder>         # (re)render the report JSON(s) in a folder → HTML
```

### `report` — sweep a range → a report

```
harness telemetry report <paths...>
    [--out <dir-or-file>]            # default: ./telemetry-report/  (a folder, per 002's co-location render)
    [--name <label>]                # report file stem + the HTML column label (default: derived from filter)
    [--filter-harness <a,b>]        # claude-code | copilot-cli | cursor | …
    [--filter-model <m,…>]          # claude-opus-4-8 | gpt-5.5 | …
    [--filter-branch <b,…>]
    [--filter-repo <r,…>]
    [--from <ISO>] [--to <ISO>]     # date-range facet
    [--sort tokens|time|count]      # rollup row ordering (default tokens)
    [--top <N>]                     # cap rows per rollup (records rollup.truncated; never silent)
    [--no-html]                     # data-only (skip the co-produced render)
```

- **`<paths...>`** — one or more of: a single `*.session.json`, a folder (swept **recursively** for `*.session.json`), or a glob. **N matched sessions = the report range.** N=1 → single-session report; N>1 → aggregated (002 single-vs-many). Mixed inputs are unioned then deduped by `harness_session_id`.
- **Recursion = rollup granularity** — point it at one session → that session; at a repo's tree → a repo rollup; at the org root → an org rollup (pairs with 004's `repo/date/format` layout). The verb doesn't know "org" vs "repo"; the **sweep level** decides.
- **Output is a folder by default** (per 002's "HTML renders the reports in its folder"): writes `<out>/<name>.report.json` and, unless `--no-html`, the self-contained `<out>/index.html`. `--out file.json` forces data-only single-file.

### Producing a comparison (Opus vs gpt-5.5)

Comparison is **N pre-filtered reports in one folder** (002: the HTML composes whatever reports share its folder):

```
# Two arms into the SAME folder, then one render:
harness telemetry report ./sessions --filter-model claude-opus-4-8 --name "Opus 4.8" --out ./compare --no-html
harness telemetry report ./sessions --filter-model gpt-5.5         --name "gpt-5.5"  --out ./compare --no-html
harness telemetry report-render ./compare
  → ./compare/Opus 4.8.report.json
  → ./compare/gpt-5.5.report.json
  → ./compare/index.html        # two columns, labelled by each report's filter
```

Convenience sugar (optional, same result): `--compare-by model` fans the range into one report **per distinct facet value** in the same folder + renders once. Sugar over the primitive above; the primitive is the contract.

### `report-render` — (re)render a folder

```
harness telemetry report-render <folder>
  # copies the shipped self-contained HTML into <folder> as index.html;
  # it renders whatever *.report.json already live there. No regeneration of data.
```

Decouples render from generation: hand-place report JSONs, render on demand; re-render after the template improves without recomputing rollups.

## Decision Space (resolved)

| Decision | Options | Resolution |
|---|---|---|
| **Range input** | explicit list only / **paths + recursive folder sweep** | **Paths + recursive sweep** — "report on this tree" is the org/repo-rollup primitive (pairs with 004). |
| **Output unit** | single file / **a folder (json + co-located HTML)** | **Folder** — matches 002's "HTML renders the reports in its folder"; `--out file.json` for data-only. |
| **Comparison** | a `--compare` join verb / **N reports in one folder + render** | **N-in-a-folder** — the HTML is the comparison engine (002); CLI just produces arms. `--compare-by` is sugar. |
| **Filter location** | post-hoc HTML only / **at generation, echoed into `report.filter`** | **At generation** — self-describing reports; the HTML reads `report.filter` for column labels. |
| **Render coupling** | always regenerate / **separable `report-render`** | **Separable** — re-render after template changes without recomputing; hand-placed reports still render. |
| **Placement** | extension / **core `harness telemetry` verb** | **Core CLI** — sibling to `session save` / `sync`. |

## Constraints

- **Read-only inputs** — sweeps `*.session.json` and (when a path is a git-ref spec) reads via `cat-file`; **never modifies git**; all work on `feat/041-flow-conformance-eval`.
- **Self-contained HTML** — `report-render` only *copies* the shipped static template + ensures the report JSON(s) are co-located; it embeds no server and needs no build (002).
- **Truncation is surfaced** — `--top N` records `rollup.truncated`; the HTML shows "+N more" (no silent caps).

## Open Questions

### Q1: Default sort + top-N. **Lean**: default `--sort tokens`, no cap unless `--top`. The "1M tokens on rg" question wants tokens-desc, uncapped.
### Q2: Reading sessions straight from a git-ref vs. only from saved `*.session.json`. **Note**: v1 = sweep saved files (001 already extracts from temp/git-ref). A future `--from-git-ref <repo>` could sweep refs directly; not needed for v1.
### Q3: Incremental/append reports for daily central rollups. **Note (004 dependency)**: a daily job re-sweeps a day's folder; idempotent regeneration is fine at current scale. Revisit if org-wide re-sweep gets expensive.

## Validation / Acceptance

Contract Ready when:
- `report` + `report-render` verbs, flags, and IO contract are specified — ✅.
- Recursion = rollup granularity (single/repo/org by sweep level) is explicit — ✅.
- Comparison-via-N-reports-in-a-folder is a worked example — ✅.
- Filter-at-generation (echoed to `report.filter`) + self-contained render + surfaced truncation + core-CLI placement + git constraint are stated — ✅.

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| Existing `harness telemetry` verb family | repo CLI (`telemetry get`/`sync`) | sibling placement | Ready |
| Report shape this emits | [002](./002-report-model-rollups-and-html.md) | `report` output | Ready |
| Layout this sweeps | [004](./004-central-session-storage-layout.md) | recursion = rollup granularity | Ready |
