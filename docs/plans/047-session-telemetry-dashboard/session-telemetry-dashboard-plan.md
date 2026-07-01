# Session Telemetry — Export, Report & Render

**Mode**: Full
**Plan Version**: 1.0.0
**Created**: 2026-07-01
**Status**: READY
**Spec source**: unified (this file)

📚 Incorporates findings from research-dossier.md (10 findings · 8 historical) and authoritative workshops 001–004.

## Business Specification

### Research Context

The telemetry capture/OTLP layer (plans 034/038) is frozen and lossless; the **export → report → render** layer is **greenfield** (research-dossier.md §Answer). Inputs ride under `harness.*` attributes pinned by our `schema_url`; **Logs are the lossless substrate, metrics are derived** (no inverse). Two seams don't exist yet — a committed-shard **git read** path and any **HTML render**. The production rollup engine (`computeRollup`, `IDLE_CAP_S=300`) is reused, not re-implemented from `gen.py`.

### Summary

Turn a coding session's scattered telemetry into **one portable artifact**, roll many sessions up into **reports**, and **render** those reports as self-contained HTML — all as core `harness telemetry` verbs. A saved session is a thin validatable envelope wrapping combined OTel (workshop 001). A report is a derived rollup across 1..N sessions with five dimensions including a dedicated **harness-command** block (002). The HTML is a self-contained, `file://`-safe view that compares reports side-by-side (002). At fleet scale, a repo/date/format tree makes org/repo roll-ups a recursive sweep (004).

### Goals

- One command turns a session's many telemetry files into one schema-valid `SessionExport` (still OTel), from the live temp buffer **or** the committed git ref (read-only).
- One command rolls a **range** of sessions (file / folder / tree, recursive) into a `TelemetryReport` with totals + five rollups (flow-stage, skill, tool, bash-command, **harness-command**), filterable and self-describing.
- A self-contained static HTML renders a report — and compares several side-by-side — with zero server, zero build, opening under `file://`.
- A documented central storage layout so org/repo roll-ups are just a sweep level.
- Honest data: exact counts, declared-estimate time/tokens, known-degraded cells surfaced not faked.

### Non-Goals

- **No scoring / quality verdicts** — that is plan 046's `RunRecord` (which merely *references* a session export). Telemetry insight ≠ eval scoring.
- **No DORA correlation / derived engineering metrics** — noted as a downstream consumer (002); out of scope here.
- **No interactive/server dashboard** — v1 is static HTML comparison columns; a data-driven pivot UI is a later plan.
- **No collection-job orchestration / transport** — the central layout is a filesystem contract; how shards ship to `<central-root>` is ops (004 Q1).
- **No new telemetry capture** — read-only over the existing spool/refs; never widen the counts-only payload.

### Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| telemetry (`services/telemetry/*`) | existing | **modify** | Add export/report/render services + a git-read adapter; reuse `computeRollup`, the OTLP transforms, `session-evidence` |
| _output kernel (`output/*`) | existing | **consume** | Emit the stable `Envelope` (+ `evidence[]` paths) from the three new verbs (no changes) |
| _adapters (`adapters/{fs,git}/*`) | existing | **modify** | Add a read-only `GitReadPort` method + adapter + fake for committed shards (Phase 3) |

> No `docs/domains/` registry exists in this repo — domains are identified inline here; the telemetry service area is the home for all new code. No NEW formal domain is created.

### Testing Strategy

- **Approach**: **Hybrid** — TDD for the load-bearing transforms (combine, rollups, the git-read parser): a test exists before impl and includes a **mutated-fixture / round-trip** non-vacuity case (flip pass→fail under mutation). Lightweight validation for CLI wiring + HTML render (one real-output assertion per verb).
- **Rationale**: the combine + cross-session rollup math is where correctness lives and where a silent regression hides; the glue is low-risk.
- **Focus areas**: combine forward-regeneration + 3-shape tolerance; rollup counts exact + attribution; cross-session re-aggregation from Logs; git-read read-only invariant.
- **Excluded**: visual HTML styling (asserted only for presence of inline data + columns).
- **Mock Usage**: **Avoid — real fixtures only.** Test against the committed real corpus (`harness/cli/test/services/telemetry/fixtures/real/<surface>/<instance>/`) + 038 OTLP goldens; inject **fakes** (`FakeFs`, a `FakeGitRead`) per constitution Principle 3 (`MUST NOT` use `vi.mock`/`vi.spyOn`).

### Documentation Strategy

- **Location**: **docs/how only** — `docs/how/telemetry-reports.md` covering the export→report→render pipeline, the three verbs, the JSON shapes, and the central layout. (The "how we evaluate this system" README section + the story doc are plan 046's, not 047's.)

### Complexity

- **Score**: CS-4 (large)
- **Breakdown**: S=2, I=2, D=1, N=2, F=1, T=1 (Σ=9)
- **Confidence**: 0.80
- **Assumptions**: the frozen OTLP contract + `computeRollup` are reusable as-is (F-06, H-01); the real fixture corpus is a sufficient test oracle (H-08).
- **Dependencies**: `otlp/logs.ts`, `otlp/metrics.ts`, `rollup.ts`, `session-evidence.ts`, the spool enumeration in `sync-service.ts`, the `git-write-port` ref naming.
- **Risks**: the net-new git-read path (effort/risk — could slip to a follow-on); HTML render mechanism mis-design (mitigated by the inline-embed correction).
- **Phases**: 3.

### Acceptance Criteria

1. **AC-01** — `harness telemetry session save <id> --source temp` writes **one** schema-valid `SessionExport` combining all the session's segments, regenerating OTLP **forward** when a `.logs.jsonl`/`.metrics.jsonl` companion is absent.
2. **AC-02** — The combine tolerates the **three on-disk shapes** (pair / logs-only-partial / legacy `<seq>.json`) and both v2 (`event_stream`) and **v1 (no `event_stream`)** segments **without crashing** — a v1 segment is either normalized to a minimal `event_stream`/`rollup` from its flat `skills`/`tools`/tokens view or recorded as degraded; either way `summary.segment_schema_versions` records what went in.
3. **AC-03** — `harness telemetry report <paths…>` over 1 session yields a single-session report; over N yields **aggregated** rollups of identical shape; all five rollups present, with `harness_command` as its own dedicated block (not folded into bash).
4. **AC-04** — Rollup **counts are exact**; the report carries an `attribution` block. **Flow-stage wall-time + session-total tokens come from `computeRollup` (`IDLE_CAP_S=300`)**; the **per-dimension** (skill / tool / bash-command / harness-command) `time_s` + token figures come from the **net-new attribution algorithm** (workshop 002 §attribution: turn-window even-split + timeline-bracket) — *not* from `computeRollup`, which exposes no per-dimension time/token. Cross-session figures **re-aggregate from Logs** (never sum per-session cumulative metrics).
5. **AC-05** — `report --filter-model <m>` includes only matching sessions and echoes the facet into `report.filter`; the provenance footer lists date-range · repos · branches · models · session count.
6. **AC-06** — `report-render <folder>` writes a self-contained `index.html` with the folder's report JSON(s) **inline-embedded** (no `fetch`), rendering N reports as comparison columns labelled by each `report.filter`; it opens correctly under `file://`.
7. **AC-07** — `session save` and `report` **co-produce** an HTML view beside the data file by default; `--no-html` suppresses it; the verb's `evidence[]` reports both written paths. **`session save`'s co-produced HTML is the single-session (`N=1`) `TelemetryReport` render** — one template, no second renderer; workshop 001's richer `gen.py`-style session-overview timeline view is **deferred** to a follow-on (see Non-Goals).
8. **AC-08** — `session save --source git-ref <id>` reads the committed shard **read-only** — `git status --porcelain` is byte-identical before/after — and yields the **same** `SessionExport` shape as `--source temp`.
9. **AC-09** — The central layout `<root>/<repo>/<YYYY-MM-DD>/<format>/<leaf>` is documented and a recursive sweep at session / repo / org level yields the right rollup granularity.
10. **AC-10** — Degraded cells render honestly: subagent tokens show **"unknown" not 0**, empty `plans_touched` is tolerated, out-of-repo paths show as basenames.
11. **AC-11** — No per-individual identity surfaces; no `user.email` is read; any committed test artifact is scrubbed (counts/shape only) and **not** caught by the `*.log` gitignore rule.
12. **AC-12** — `docs/how/telemetry-reports.md` documents the three verbs, the JSON shapes, and the central layout.

### Risks & Assumptions

- The **git-ref read** is genuinely net-new (no reader exists — F-03); if it overruns, it is the designated deferral (Phase 3, `--source git-ref` + the central-collection story) without blocking export/report/render.
- `gen.py` is **reference-only**; re-implementing it would diverge (idle cap 1200≠300). Risk mitigated by reusing `computeRollup`.
- Real-data gaps (H-03) are permanent, not bugs to fix here — the report must render them honestly.

### Open Questions

- Comparison-column composition detail (how `report-render` orders/labels >2 reports) — resolved at implementation; default = `report.filter` label, file order.
- Whether `report` should ever sweep a git-ref directly (`--from-git-ref`) — deferred (003 Q2); v1 sweeps saved `*.session.json`.

### Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| _(none open)_ | — | Workshops 001–004 cover the design; the two dossier corrections were folded back into 001/002 | — |

### Clarifications

#### Session 2026-07-01
- **Workflow Mode** → Full, **capped at 3 phases** (user).
- **Testing Strategy** → Hybrid (TDD for transforms/combine/rollups with mutated-fixture non-vacuity; lightweight for CLI/HTML).
- **Mock Usage** → Avoid — real fixtures only (inject fakes; no `vi.mock`).
- **Documentation** → docs/how only.

## Planning Seam

_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — all resolved (001–004; dossier corrections folded into 001/002).

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings (KF-01..09); pins every seam to file:line |
| workshops/*.md | y (001–004) | authoritative design decisions — the envelope, report, CLI, and storage shapes |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | Round-1 answers recorded; no `[NEEDS CLARIFICATION]` survives |
| G2 | Constitution | PASS (1 deviation recorded) | P2 (git-read via a new **port**, not raw exec), P3 (fakes + real fixtures, no `vi.mock`), P4 (stable Envelope), P9 (evidence paths), P12 (scrub committed artifacts) all honoured. **Deviation (P10)**: adding 3 fixed `telemetry` subcommands extends the existing **core-act** set (`telemetry`/`flow`/`record`/`observe` — `acts/telemetry.ts:24-26`), which `architecture.md:112` lists only `doctor`/`help` for — a pre-existing, text-unlisted class, not a *new dynamic verb*. Low-impact (telemetry is core plumbing, not a repo-mapped verb); recorded per G2 rather than asserted clean |
| G3 | Architecture | PASS | New `GitReadPort` method + `ExecGitRead` adapter + fake; services take ports; acts compose adapters; output kernel owns exit |
| G4 | ADR Compliance | N/A | `docs/adr/` is empty |
| G5 | Structure | PASS | All required sections present + populated |
| G6 | Testing Alignment | PASS | Hybrid: transform/combine/rollup tasks place a test (with mutation/round-trip) before impl; each phase has ≥1 validation task; ACs are measurable |
| G7 | Domain Completeness | PASS | No registry (domains inline); Domain Manifest covers every file in the task tables; telemetry = existing/modify |

### Summary

Build the export→report→render pipeline in three cohesive phases: **P1** locks the `SessionExport` envelope + combine (temp source); **P2** adds the `TelemetryReport` rollups + the `report`/`report-render` verbs + the self-contained inline-embed HTML; **P3** adds the read-only git-ref source, the central storage layout, and the docs/how page. Each phase reuses the frozen OTLP transforms + `computeRollup` and tests against the real fixture corpus. Expected outcome: three new core `harness telemetry` verbs that need no new capture and never touch git's working tree.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/telemetry/session-export.ts` | telemetry | internal | Combine algorithm + `SessionExport` builder |
| `harness/cli/src/services/telemetry/session-export.schema.json` | telemetry | contract | The validatable envelope schema |
| `harness/cli/src/services/telemetry/report.ts` | telemetry | internal | Rollups + `TelemetryReport` builder (reuses `computeRollup`) |
| `harness/cli/src/services/telemetry/report.schema.json` | telemetry | contract | The report schema |
| `harness/cli/src/services/telemetry/render/report-html.ts` | telemetry | internal | Inline-embed render: report JSON(s) → self-contained HTML |
| `harness/cli/src/services/telemetry/render/template.html` | telemetry | internal | The pre-authored static template (frontend-design) |
| `harness/cli/src/adapters/git/git-read-port.ts` | _adapters | contract | Read-only port for committed telemetry shards |
| `harness/cli/src/adapters/git/exec-git-read.ts` | _adapters | internal | `git cat-file`/`for-each-ref` impl (read-only) |
| `harness/cli/src/adapters/git/fake-git-read.ts` | _adapters | internal | Recording fake for tests |
| `harness/cli/src/acts/telemetry.ts` | telemetry | cross-domain | Register `session save` / `report` / `report-render` (modify) |
| `docs/how/telemetry-reports.md` | telemetry | internal | Pipeline + verbs + central layout docs |
| `harness/cli/test/services/telemetry/{session-export,report,report-html}.test.ts` | telemetry | internal | Hybrid tests vs real fixtures + goldens |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| KF-01 | Critical | No committed-shard git **read** path exists; only local `rev-parse` peels (F-03) | P3 adds a read-only `GitReadPort` (`for-each-ref` glob + `cat-file` tree walk) + adapter + fake |
| KF-02 | High | `rollupToOtlpMetrics` has **no inverse**; logs are the lossless substrate (F-05) | Combine regenerates both signals **forward** from `<seq>.json`; never inverts metrics |
| KF-03 | High | Reuse `computeRollup` (`IDLE_CAP_S=300`), not `gen.py` (1200s); re-aggregate cross-session **from Logs** (H-02, F-06) | P2 rollups build on `computeRollup` + `fold`; never sum cumulative metrics |
| KF-04 | High | HTML must **inline-embed** (`file://` CORS blocks `fetch`) (F-09) | `report-render` embeds report JSON(s) as `<script type="application/json">` |
| KF-05 | High | Three on-disk shapes per seq; tolerate all (F-04, H-04) | P1 combine handles pair / logs-only / legacy `<seq>.json` |
| KF-06 | High | Git read-only invariant — working tree byte-identical; orphan refs only; no per-person identity (H-05) | `GitReadPort` is read-only; AC-08/AC-11 are deterministic tests |
| KF-07 | High | Privacy counts-only floor on **tracked** artifacts; `*.log` gitignore trap (H-06/H-07, P12) | Scrub any committed HTML/report/golden; byte-scan; dodge `*.log` |
| KF-08 | High | Real-data degraded cells: subagent tokens null, `plans_touched` empty, out-of-repo basenames (H-03) | Render "unknown"/empty/basename honestly (AC-10) |
| KF-09 | Medium | v2 dropped flat `bash_commands`/`harness_commands` arrays (F-07) | `harness_command` from segment `command`/`fold` `harness_verbs`; `bash_command` from `event_stream` Bash events |

### Phases

#### Phase Index

| Phase | Title | Primary Domain | Objective (1 line) | Depends On |
|-------|-------|---------------|-------------------|------------|
| 1 | Session Export Foundation | telemetry | One schema-valid `SessionExport` combining a session's segments from the temp buffer | None |
| 2 | Reports, Rollups & Render | telemetry | `TelemetryReport` + the five rollups + `report`/`report-render` verbs + self-contained HTML | Phase 1 |
| 3 | Fleet Scale & Docs | telemetry / _adapters | Read-only git-ref source + central storage layout + docs/how | Phase 2 |

#### Phase 1: Session Export Foundation

**Objective**: Combine a session's many telemetry segments (temp source) into one schema-valid `SessionExport`.
**Domain**: telemetry
**Delivers**: `session-export.ts` (combine + builder), `session-export.schema.json`, `harness telemetry session save <id> --source temp [--out] [--no-html]`, round-trip + schema tests.
**Depends on**: None
**Key risks**: Mis-handling the three on-disk shapes — mitigated by a fixture per shape.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 1.1 | Define `SessionExport` TS type + `session-export.schema.json` (additive: `additionalProperties:true` + pinned `schema_version`) | telemetry | Schema validates a hand-built example; `npm run` typecheck passes | Workshop 001 |
| 1.2 | **Test-first**: combine spec — enumerate the temp spool (reuse `sync-service.ts:189/204-209` filters), assert merged one-`ResourceLogs` + `logRecords` ordered by `harness.event.t`, identity/summary lifted | telemetry | A failing test exists over a real fixture session before 1.3 | TDD (KF-05) |
| 1.3 | Implement `combineSession()`: prefer OTLP companions, else **regenerate forward** (`segmentToOtlpLogs`/`rollupToOtlpMetrics`); tolerate pair/partial/legacy + v1/v2 | telemetry | 1.2 passes; **mutation** (drop a companion) still combines via forward regen; never inverts metrics | KF-02/KF-05 |
| 1.4 | Round-trip non-vacuity test vs 038 goldens: reconstructed logs `toEqual` and `computeRollup(reconstruction)` equals stored rollup | telemetry | Test flips to FAIL under a deliberate field mutation | H-08, F-05 |
| 1.5 | Add `session save` subcommand to `acts/telemetry.ts` (copy the `get` arg+flag+async pattern); `--source temp`; write `.session.json`; Envelope + `evidence[]` path | telemetry | `harness telemetry session save <id> --source temp --out p.json` writes a schema-valid file; JSON-mode Envelope ok | F-01, AC-01 |
| 1.6 | Identity/degraded honesty: lift `harness_session_id`/`harness`/`models`/`captured_env.PIJ_SESSION_ID`; subagent tokens "unknown" not 0 | telemetry | A fixture with null subagent tokens serialises "unknown"; `plans_touched` empty tolerated | KF-08, F-08 |
| 1.7 | **v1-segment handling** (a v1 `<seq>.json` has **no `event_stream`** → `segmentToOtlpLogs` would throw): normalize a minimal `event_stream`/`rollup` from the flat `skills`/`tools`/tokens view, **or** skip-with-degraded; record the version in `segment_schema_versions` | telemetry | A v1 (1.0/1.1) fixture combines without throwing; `segment_schema_versions` lists it; a v2-only assumption test flips to FAIL on the v1 input | F-02 critic finding; Workshop 001 L63; `segment.ts:196-197` |

#### Phase 2: Reports, Rollups & Render

**Objective**: Roll up 1..N sessions into a `TelemetryReport` and render it (and comparisons) as self-contained HTML.
**Domain**: telemetry
**Delivers**: `report.ts` (+ schema), `harness telemetry report <paths…>`, the inline-embed HTML template + `report-html.ts`, `harness telemetry report-render <folder>`, co-produced HTML wired into `session save`+`report`, tests.
**Depends on**: Phase 1
**Key risks**: Cross-session math; HTML mechanism — both pinned by KF-03/KF-04.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 2.1 | Define `TelemetryReport` TS + `report.schema.json` (five rollups, `attribution`, `provenance`, `filter`, `scope.single`) | telemetry | Schema validates a hand-built example | Workshop 002 |
| 2.2 | **Test-first**: rollup spec — counts exact across the 5 dimensions; `harness_command` from segment `command`/`fold`; `bash_command` from `event_stream` (excludes `harness …`) | telemetry | Failing test over a real multi-segment fixture before 2.3 | TDD, KF-09 |
| 2.3 | Implement rollup **counts** + the **flow-stage wall-time + session totals** from `computeRollup` (`IDLE_CAP_S=300`); single-vs-many one shape; cross-session **re-aggregate from Logs** | telemetry | 2.2 passes; an N>1 fixture sums `rg` rows into one; mutation flips a count | KF-03, AC-03/04 |
| 2.8 | **Test-first**: the **per-dimension time/token attribution algorithm** (workshop 002 §attribution — turn-window even-split + timeline-bracket) for skill/tool/bash/harness dimensions — `computeRollup` does **not** provide this | telemetry | A failing test exists before impl; a **mutated-fixture** case flips a `time_s`/`tokens` value (not just a count), proving the attribution math is non-vacuous | F-01 critic finding; AC-04 |
| 2.4 | `report` subcommand: recursive `<paths…>` sweep of `*.session.json`, `--filter-*`/`--from`/`--to`/`--sort`/`--top`/`--no-html`; echo facets into `report.filter`; provenance footer | telemetry | `report ./sessions --filter-model X` writes a report with only matching sessions; `truncated` surfaced | AC-05, 003 |
| 2.5 | Author the static `template.html` (frontend-design skill) + `report-html.ts`: **inline-embed** report JSON(s) as `<script type="application/json">`; N reports → columns labelled by `report.filter` | telemetry | Generated `index.html` opens under `file://`, shows columns, no `fetch` | KF-04, AC-06 |
| 2.6 | `report-render <folder>` + wire co-produced HTML into `session save`+`report` (default-on, `--no-html`); **`session save`'s view = the `N=1` report render (same template, no second renderer)**; both paths in `evidence[]` | telemetry | `report-render ./compare` renders the folder's reports; `session save` writes a 1-column HTML; `--no-html` suppresses | AC-07, F-03 |
| 2.7 | Human-friendly durations in the view (`1.3 days`/`4.2h`/`28m` from `time_s`); validation test asserts inline data + column count | telemetry | Lightweight test: render of a 2-report folder has 2 columns + embedded data | Hybrid-light |

#### Phase 3: Fleet Scale & Docs

**Objective**: Read committed sessions read-only, lay out the central tree, and document the pipeline.
**Domain**: telemetry / _adapters
**Delivers**: `GitReadPort` + `ExecGitRead` + `FakeGitRead`, `session save --source git-ref`, the central-layout convention + a sweep-granularity test, `docs/how/telemetry-reports.md`.
**Depends on**: Phase 2
**Key risks**: Git-read is net-new (KF-01) — the designated deferral if it overruns. **Only 3.1–3.3 (git-ref) are deferrable; 3.4 (layout/AC-09), 3.5 (docs/AC-12), and 3.6 (P12 privacy scrub/AC-11 — a Constitution hard rail) ship regardless** and do not depend on 3.1–3.3. Run 3.1–3.3 **last** within the phase so a deferral never drops the privacy gate.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 3.1 | Define `GitReadPort` (read-only): `listTelemetryRefs(glob)` + `readShardTree(ref)` returning the flat OTLP blobs; add `FakeGitRead` recording fake | _adapters | Port interface + fake compile; fake records calls | G3, KF-06 |
| 3.2 | Implement `ExecGitRead` via `for-each-ref` (`TELEMETRY_REF_GLOB`) + `cat-file` tree walk; match `telemetryRefFor` naming; **never** write/fetch-mutate | _adapters | Reads a committed fixture ref; **`git status --porcelain` byte-identical** before/after (test) | KF-06, AC-08 |
| 3.3 | Wire `session save --source git-ref|auto`: combine from the shard tree (same `combineSession`), dedup `<seq>` (auto prefers git-ref then temp) | telemetry | `--source git-ref <id>` yields the **same** `SessionExport` shape as `--source temp` over the same data | AC-08, 001 |
| 3.4 | Document the central layout `<root>/<repo>/<YYYY-MM-DD>/<format>/<leaf>` + a test that sweeps a fixture tree at session/repo/org levels | telemetry | Sweep at each level yields the expected aggregation granularity | AC-09, 004 |
| 3.5 | `docs/how/telemetry-reports.md`: the three verbs, the JSON shapes, the central layout, the export→report→render pipeline | telemetry | Page exists; filenames dodge `*.log`; no real paths/ids/names (scrubbed) | AC-12, KF-07, P12 |
| 3.6 | Publication-boundary sweep: any committed sample/golden scrubbed (counts/shape only); `git check-ignore` confirms no `*.log` trap; no `user.email` read | telemetry | A scan test asserts no `/Users/`, session-id, or person-name leak in tracked 047 artifacts | AC-11, H-06/H-07 |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | 1.1, 1.3, 1.5 | schema-valid `SessionExport` from `--source temp` |
| AC-02 | 1.2, 1.3, 1.7 | three-shape + v1(no-`event_stream`)/v2 tolerance test; `segment_schema_versions` |
| AC-03 | 2.1, 2.3 | 1-vs-N identical shape; 5 rollups incl. `harness_command` |
| AC-04 | 2.2, 2.3, 2.8 | counts exact (2.3); flow-stage+totals via `computeRollup` (2.3); per-dimension attribution algorithm + non-vacuity (2.8); Logs re-aggregation |
| AC-05 | 2.4 | `--filter-model` inclusion + `report.filter` echo + provenance |
| AC-06 | 2.5 | inline-embed `index.html`, columns, `file://` |
| AC-07 | 2.6 | co-produced HTML default-on, `--no-html`, `evidence[]` |
| AC-08 | 3.2, 3.3 | git-ref read; `git status --porcelain` byte-identical; same shape |
| AC-09 | 3.4 | central layout + sweep-granularity test |
| AC-10 | 1.6 | "unknown" subagent tokens, empty `plans_touched`, basenames |
| AC-11 | 3.6 | no per-person identity, no `user.email`, scrubbed + `*.log`-safe |
| AC-12 | 3.5 | `docs/how/telemetry-reports.md` |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Git-ref read overruns (net-new port) | Medium | Medium | It's last (P3) + isolated behind `GitReadPort`; deferrable to a follow-on without blocking export/report/render (export/report work from temp + saved files) |
| HTML render mis-mechanism (fetch vs embed) | Low | Medium | KF-04 locks inline-embed (the proven `file://` pattern); AC-06 asserts `file://` open |
| Cross-session metric double-count | Low | High | KF-03: re-aggregate from Logs, never sum cumulative metrics; test over an N>1 fixture |
| **Per-dimension time/token attribution is net-new** (not `computeRollup`) and error-prone (even-split semantics) | **Medium** | **High** | Dedicated test-first task 2.8 with a mutated-fixture non-vacuity case on `time_s`/`tokens` (not just counts); `attribution` block declares the method so estimates are never read as a ledger |
| v1 (no-`event_stream`) segment crashes `segmentToOtlpLogs` | Medium | Medium | Task 1.7 normalizes-or-degrades v1 before forward-regen; AC-02 scoped to "without crashing" |
| Privacy leak in a committed sample | Low | High | P12 + KF-07: scrub + byte-scan + `git check-ignore`; AC-11 scan test |
| `computeRollup` semantics insufficient for stage windowing | Low | Medium | Reuse `fold`/`computeRollup`; stage windows per-session then summed (002 Q2) |

## Fixes

| ID | Created | Summary | Domain(s) | Status | Source |
|----|---------|---------|-----------|--------|--------|
| [FX001](./fixes/FX001-capture-bash-command-signature.md) | 2026-07-01 | Keep the already-computed non-harness command signatures in the event stream so `bash_command` keys by `rg`/`git` (argv granularity), not just tool name | telemetry / _adapters | Proposed | Phase-2 discovery (observe MW-001) + principal directive |
