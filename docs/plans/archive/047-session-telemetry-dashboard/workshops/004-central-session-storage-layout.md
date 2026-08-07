# Workshop: Central Session Storage Layout — fleet-scale session + report tree

**Type**: Storage Design / Filesystem Layout
**Plan**: 047-session-telemetry-dashboard
**Spec**: [session-telemetry-dashboard-plan.md](../session-telemetry-dashboard-plan.md) *(to be authored)*
**Grounds in**: [001-session-data-structure.md](./001-session-data-structure.md) (the session leaf) + [002](./002-report-model-rollups-and-html.md)/[003](./003-report-cli-surface.md) (the sweep that consumes this tree)
**Created**: 2026-07-01
**Status**: Approved

**Value Thesis**: Lock the **directory layout** for storing saved sessions (and the reports rolled from them) **centrally**, at fleet scale — many repos × many users × many days — so that a recursive report sweep at any level (one session / one repo / the whole org) yields exactly the rollup you want, daily collection is incremental, and retention is a `rm` of a date partition. Decided before any collection job so the tree, the report CLI's recursion, and later repo/org roll-ups all agree.
**Target Proof Level**: **Contract Ready** (the path scheme + leaf naming + partition rationale + how it maps to the report sweep)
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Cross-Domain Coordination** — the same tree serves single-session view, repo rollup, and org rollup via sweep level.
- **Knowability** — a path tells you repo + date + kind at a glance; "what ran in repo X on day Y" is `ls`.
- **Migration Safety** — additive partitions (new repos/days/formats are new dirs); never a reshuffle.

**Related Documents**:
- [001 — session data structure](./001-session-data-structure.md) — the `*.session.json` leaf stored here.
- [003 — report CLI surface](./003-report-cli-surface.md) — sweeps this tree; **sweep level = rollup granularity**.

---

## Purpose

Decide how saved sessions are laid out when collected to a **central rollup location** across many repos and users — the user's scenario: **~200 repos, ~10 users/repo/day**. The leaf is a 001 `SessionExport`; the tree must make repo, day, and kind explicit so reports (002/003) roll up cleanly at any level.

## Boundary

> This is the **central collection tree** (a fleet aggregator), distinct from each repo's local `.harness/temp/telemetry/` spool and its `refs/harness-telemetry/*` git ref (001's two **sources**). Collection **extracts** sessions from those read-only sources and **deposits** them here. This tree is the report substrate, not the live spool.

## Fresh Entrant Outcome

Contract Ready: from the path scheme + leaf naming + partition rationale below, a collection job + the report sweep (003) can be built with no further layout design.

---

## The scenario (grounding the scale)

- **~200 repos**, **~10 users per repo per day** → ~2,000 sessions/day, ~730k/year.
- Collected **daily** from each repo (each repo's committed `refs/harness-telemetry/*` is the durable source — 001).
- Reports wanted at three granularities: **one session**, **one repo** (all users, a date range), **the org** (all repos).
- Retention by age (drop old days) must be cheap.

## The layout (Contract Ready)

```
<central-root>/
  <repo>/                                  # e.g. ai-substrate__harness-engineering  (org__repo, FS-safe)
    <YYYY-MM-DD>/                          # UTC collection date — the retention + incremental unit
      sessions/                            # format = saved SessionExport leaves (001)
        <harness_session_id>.session.json  # leaf; identity (user/branch/models) is INSIDE the file
        <harness_session_id>.session.html  # co-produced view (001 rule); optional
      reports/                             # format = TelemetryReport leaves (002), e.g. a daily repo rollup
        daily.report.json
        index.html                         # self-contained render of this folder's report(s) (002/003)
```

- **Path scheme**: `<root>/<repo>/<YYYY-MM-DD>/<format>/<leaf>`, where `<format> ∈ { sessions, reports }`.
- **Repo first** — so an **org rollup** = sweep `<root>/` (all repos), a **repo rollup** = sweep `<root>/<repo>/`, a **day** = one more level. The report CLI's recursion (003) makes each level "just work."
- **Date second (UTC)** — the **incremental-collection** unit (a daily job writes only today's partition) **and** the **retention** unit (`rm -rf <repo>/<old-date>`). Date before format so a day is self-contained (its sessions + its rollup together).
- **Format third** — `sessions/` (the raw 001 leaves) vs `reports/` (002 rollups). Keeping them in sibling dirs means a session sweep (`**/sessions/*.session.json`) never accidentally ingests a report, and a report render folder (`reports/`) already satisfies 002's "render whatever report JSON is in this folder."

## Why identity lives in the file, not the path

The user noted *"sessions contain branches and who etc."* — so **user and branch are NOT path segments**. They're inside each `SessionExport.identity` (001). Rationale:

- **No collision risk** — `harness_session_id` is globally unique; the leaf name needs nothing else.
- **Filter, don't partition, by user/branch** — reports filter on `harness`/`model`/`branch`/`repo` (002 facets) by reading file contents; baking user/branch into the path would multiply tiny partitions (10 users × many branches) and fight the date/retention scheme.
- **Repo + date are the only partition keys** because they're the only ones used for **collection** (per-repo daily) and **retention** (by age). Everything else is a content filter.

## Mapping to the report sweep (the payoff)

| Want | Sweep (003) | Yields |
|---|---|---|
| one session | `report <root>/<repo>/<date>/sessions/<id>.session.json` | single-session report |
| one repo, a day | `report <root>/<repo>/<date>/sessions/` | repo-day rollup |
| one repo, all time | `report <root>/<repo>/` (recursive) | repo rollup |
| the whole org | `report <root>/` (recursive) | org rollup |
| compare two models, org-wide | two `report <root>/ --filter-model …` into one folder + render | Opus-vs-gpt-5.5 columns |

The layout is designed **around** the recursion: **sweep level = rollup granularity** (003). No special "org mode" — just where you point.

## Decision Space (resolved)

| Decision | Options | Resolution |
|---|---|---|
| **Partition order** | date-first / **repo-first → date → format** | **Repo-first** — org/repo rollups are subtree sweeps; date second for incremental + retention. |
| **User/branch in path** | path segments / **inside the file** | **Inside** (`identity`) — unique leaf, filter-not-partition, avoids partition blow-up (user's "sessions contain who/branch"). |
| **sessions vs reports** | one dir / **sibling `sessions/` + `reports/`** | **Sibling** — clean session sweeps; `reports/` is already a 002 render folder. |
| **Date basis** | local / **UTC** | **UTC** — stable partition across a global fleet. |
| **Repo dir name** | `repo` / **`org__repo` FS-safe** | **`org__repo`** — disambiguates same-named repos across orgs; reversible to the real slug. |

## Constraints

- **Sources are read-only** — collection reads each repo's `refs/harness-telemetry/*` (or temp) per 001 and **never modifies git**; depositing into `<central-root>` is an ordinary file write outside any repo.
- **Additive growth** — new repos/days/formats are new dirs; no existing path moves (mirrors 001/002 additive forward-compat).
- **Branch / PR** — design + any build land on `feat/041-flow-conformance-eval` (current PR).

## Open Questions

### Q1: Central root location & transport. **OPEN (ops).** Where `<central-root>` lives (object store, shared FS, a collector repo) and how repos ship to it (push vs. pull job) is an operations decision beyond this plan's CLI. Lean: filesystem contract now (the layout); transport later.
### Q2: Org/repo daily rollup automation. **Note.** A scheduled job runs `report <repo>/<date>/sessions/ → reports/daily.report.json` per repo-day, then an org sweep. Job orchestration is OOS; the CLI primitives (003) + this layout make it a thin wrapper.
### Q3: `identity.repo` reliability. **Depends on 001 Q1.** Org rollups filtering by repo lean on `identity.repo`; 001 records best-effort repo now so the facet exists. The *path* `<repo>` segment is the authoritative partition regardless.

## Validation / Acceptance

Contract Ready when:
- The path scheme `<root>/<repo>/<date>/<format>/<leaf>` + leaf naming is specified — ✅.
- The partition rationale (repo-first for rollups, date for incremental+retention, identity-in-file) is explicit — ✅.
- The sweep-level → rollup-granularity mapping (003) is tabulated — ✅.
- Read-only sources + additive growth + git/branch constraint are stated — ✅.

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| Session leaf shape | [001](./001-session-data-structure.md) | the stored `*.session.json` | Ready |
| Report sweep recursion | [003](./003-report-cli-surface.md) | sweep level = rollup granularity | Ready |
| Fleet scale (200 repos × 10 users/day) | §The scenario | partition + retention design | Ready (user-stated) |
| git-ref source (read-only) | [001](./001-session-data-structure.md) §Extraction | collection without git mutation | Ready |
