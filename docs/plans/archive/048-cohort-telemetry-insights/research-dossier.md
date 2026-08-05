# Research Dossier: Cohort telemetry measures & insights layer

**Generated**: 2026-07-02T07:05:00Z
**Query**: "month-scoped repo/org sweeps over refs/harness-telemetry → measures report(scope,window) → insights layer, per workshop 001 D1–D7 — what exists, what's missing, what the collector actually needs"
**Effort**: Standard (lead-only — this session verified most surfaces at source same-day; targeted reads filled the rest)
**Tools**: Mixed (FlowSpace + standard)
**Evidence**: 10 current sources · 5 historical sources

## Answer

- The shard→report pipeline **already exists end-to-end for one repo**: `harness telemetry session save --source git-ref|auto` reads committed shards read-only, and `harness telemetry report <paths…>` sweeps 1..N exports with harness/model/branch/date filters. The "collector" is mostly a **composition verb** (enumerate month refs → save each session → report), not new machinery.
- Month scoping is free: refs are sharded `refs/harness-telemetry/YYYY/MM/DD/<session-id>`.
- The report's `flow_stage` lens is currently **digit-bracket based** while the authoritative nav-derived `FlowEvent`/`flow_stage_time_s` machinery exists one layer down and is unused by the lens — the file header even promises the nav behavior. Promoting it (WS001 D3) is the headline lens change.
- **Plan identity capture already exists in code** (`plans_touched`, capture-service.ts:388) but came up empty in live smoke — this is a confirm/fix, likely much cheaper than the "add plan identity" build the workshop assumed.
- **Individual identity is architecturally absent by design** (segment session id is "an opaque correlation handle — NOT an individual identity", AC-11/13; shard commits are authored `harness-telemetry`) — WS001's no-people-analytics anti-goal (D6) is already structural, and "all users in a repo" formally means "all sessions in a repo".
- Org scope (N repos) has **no substrate yet**: `--filter-repo` is echoed-not-applied by design, and 047 WS004's central storage is layout, not a sweep. Multi-repo is per-repo reports + layer-3 composition until a repo facet exists.

## Evidence

| ID | Finding | Evidence | Planning implication | Confidence |
|----|---------|----------|----------------------|------------|
| F-01 | Ref-sourced session export exists: `session save --source temp\|git-ref\|auto` (git-ref shadows temp under `auto`), read-only via git plumbing | `harness/cli/src/acts/telemetry.ts:35,70,115-116,473-503` | The collector composes existing verbs; no new read path needed for single-repo month sweeps | High |
| F-02 | `report <paths…>` already takes 1..N exports, recursive folder sweep, with `--filter-harness/model/branch`, `--from/--to`, `--sort`, `--top` | `report --help` (live), `acts/telemetry.ts` | `report(scope, window)` exists for the time window + facets; only the ref-enumeration driver is missing | High |
| F-03 | Refs sharded per day+session: `refs/harness-telemetry/YYYY/MM/DD/<session>` | live `git ls-remote origin 'refs/harness-telemetry/*'` (2026-06-23 → 2026-07-02 shards observed) | Month scope = one ref glob; incremental sweeps keyed by date path | High |
| F-04 | flow_stage lens is digit-bracket based (`/the-flow` skill calls + `arg`, else `unlabeled`) while the header promises nav-derived `computeRollup.flow_stage_time_s` — a real doc-vs-impl drift | `report.ts:13-14` vs `report.ts:468-482` | The D3 lens promotion is a bounded, test-covered change in one file; digit becomes fallback | High |
| F-05 | Nav-derived stage machinery exists and works per segment: `FlowEvent {flow, stage=nav.now}` emitted from `the-flow.json` nav ("never from args"), gap-time attributed → `flow_stage_time_s` | `flow-nav.ts:1-40`, `rollup.ts:204-263`, `events.ts:133-138` | Semantic stage mapping (node-id → research/plan/implement/review/ship) layers on real data; guided mode covered | High |
| F-06 | `plans_touched` capture EXISTS (`planId → [planId]`) and syncs; session-evidence marks it a named gap only when empty | `capture-service.ts:388`, `sync-service.ts:230`, `session-evidence.ts:250-256` | Plan identity = root-cause the live emptiness (phase-3 finding), not a greenfield build; branch proxy interim (WS001 D5) | Medium |
| F-07 | No individual identity anywhere in the capture chain — session id documented as an opaque correlation handle, NOT individual identity (AC-11/13); shard commits authored `harness-telemetry` | `segment.ts:127`, live `git cat-file` of a shard commit | D6 anti-goal is structural; per-person cuts are impossible without a capture change — the plan must NOT add one | High |
| F-08 | Shards span schema eras: v2.0 segments thin (`tokens: null`, empty `event_stream`), v2.2 OTLP-shaped (metrics: working/human/idle/wall seconds, tool.calls; logs: full event stream incl. `tool.signature`, `tool.result_tokens`, `turn.dur_s`) | live peeks of `2026/06/24` (v2.0) and `2026/07/02` (v2.2) shards | Sweeps must be version-tolerant; pre-v2.2 months yield time-only measures — declare, don't backfill | High |
| F-09 | `--filter-repo` echoed-not-applied by design (no repo facet in a v1 SessionExport) | `report.ts` ReportFilter comment (~L100-110) | Org scope = per-repo report runs composed at layer 3, until a repo facet lands (P12-reviewed) | High |
| F-10 | Report epistemics are load-bearing and reusable: counts EXACT, time/tokens declared ESTIMATES, cache never per-dimension, re-derive from logs never sum metrics (KF-02/03) | `report.ts:1-28` | The insights layer inherits this contract (WS001); sent/received (D2) is already FX002's non-cache semantics — render-only change | High |

## Historical Evidence

| ID | Prior friction / decision | Source | Applicability now | Implication |
|----|---------------------------|--------|-------------------|-------------|
| H-01 | WS001 D1–D7: four layers, sent/received vocabulary, FlowEvent-primary stages, work-unit grain, no-people anti-goal, LLM narrator/smith roles; v1 = 7 sections + committed ritual-marker panel | `docs/plans/048-cohort-telemetry-insights/workshops/001-cohort-measures-and-insights-layer.md` | Direct (authoritative) | The spec implements D1–D7; re-deciding them is out of bounds |
| H-02 | 047 built the substrate this plan stands on: SessionExport (P1), report+HTML (P2), git-ref source + central storage layout (P3) — 047 sits at Ship | `docs/plans/047-session-telemetry-dashboard/` plan + flight plan (all phases ◆) | Direct | Ship 046/047's branch before or alongside 048 P1; do not fork the substrate pre-merge |
| H-03 | Phase-3 live smoke: subagent tokens null, `plans_touched` empty, out-of-repo path fidelity — real-data gaps named | memory: telemetry phase-3 findings (plan 034 records) | Direct | F-06's confirm/fix task + v1's honest-unmeasured subagent row trace here |
| H-04 | Dogfood drain: DL-002 (live skill-digit unconfirmed → digit lens reads `unlabeled` on live guided sessions); DL-001 codex correlation absent (deferred, own plan) | `.harness/records/retro/2026-07-02/002-046-dogfood-run1-drain.md` | Direct | Digit stays fallback-only until one flushed live confirmation; codex sessions invisible to cohort sweeps — declare in reports |
| H-05 | copilot tail-capture: mid-turn harness bursts are empty-windowed; work surfaces on the NEXT command (correct behavior, not a bug) | memory: copilot-vscode tail-capture (plan 034 P6) | Partial | Per-command time attribution blurs on copilot; document as a known skew in report provenance, don't "fix" |

## Risks and Unknowns

| Item | Evidence | Why it matters | Resolution / next evidence |
|------|----------|----------------|----------------------------|
| Ref-sourced exports' token fidelity unverified end-to-end | F-01 exists but no observed `--source git-ref` run producing token totals | If token events don't survive the shard round-trip, sent/received columns are empty for swept months | **First implementation task: run one `session save --source git-ref` on a real shard and diff against its temp-sourced export** |
| `plans_touched` live emptiness root cause unknown | F-06 vs H-03 | Work-unit grain (D5) depends on it; branch proxy has convention risk | One instrumented live session in a plan-bearing repo; read the captured segment |
| Multi-repo sweep mechanics undecided | F-09, WS004 layout-only | Org/month scope is the stated ambition | Workshop (below) — per-repo compose vs repo facet |
| Insight template schema unspecified | WS001 Q3 | The mandatory-epistemics rule needs a concrete shape before the first generator | Workshop (below) |
| Principal's scenario list pending | WS001 Q1 | May add measures (never reopen D1–D7) | Slot in at plan time; spec should leave a measures-extension seam |

## Planning Handoff

- **Preserve**: the four-layer split and D1–D7 (WS001); the epistemic contract (F-10) verbatim into every new surface; append-only refs; the no-individual-identity design (F-07) — the plan must not add identity; KF-02/03 re-derivation discipline.
- **Change carefully**: `report.ts` flow_stage lens promotion (keep digit fallback + the existing 132+ test surface green; the header comment finally becomes true); any synced-payload addition (session token totals) is a P12-reviewed capture-domain change, named as such.
- **Likely files/symbols**: `harness/cli/src/services/telemetry/report.ts` (lens promotion, semantic stage map, sent/received render), `acts/telemetry.ts` (sweep/collector verb composing F-01+F-02), `flow-nav.ts`/`rollup.ts` (reuse, not rewrite), `capture-service.ts:388` (plans_touched confirm), a new insights layer home (likely `.harness/extensions/` or a `telemetry insights` verb — decision below), HTML render.
- **Decisions still required**: collector surface (`telemetry sweep --month 2026-06`? extension verb?); insights layer home (core verb vs extension); insight template schema; multi-repo composition mechanics; LLM-edge integration point (where narrator/smith packets attach).

## External Research

_None material — repo evidence answers the architecture questions; DORA definitions are standard and belong to the layer-3 workshop when GitHub-source work begins._
