# Workshop: Semantic telemetry elements — sources & capture points

**Type**: Data Model + Integration Pattern
**Plan**: 050-semantic-artifact-telemetry
**Spec**: (pre-plan workshop — feeds the plan)
**Created**: 2026-07-04
**Status**: Draft

**Value Thesis**: The flow already writes rich, deterministic artifacts (plans, reviews, workshops, dossiers, the-flow.json). Their process signals — fixes per review, phases per plan, workshop depth — sit unread. Extracting them as counts at telemetry-capture time turns process quality into measurable, time-seriesed data with **zero added burden** on the agent doing the work.
**Target Proof Level**: Contract Ready
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Knowability**: process behaviour (review loops, plan churn, workshop depth) becomes visible in eng-thrive/insights rather than tribal memory.
- **Implementation Readiness**: the element inventory + extractor contract below is buildable directly — registry, parsers, emission point are all named.
- **Cost / Attention Reduction**: extraction is a parse of committed files, not an inference; nobody fills in a form, the sensor rides the existing capture window.
- **Safety to Change**: counts-only + defensive-parse contract keeps the privacy posture and never breaks capture when an artifact format drifts.

**Related Documents**:
- `harness/cli/src/services/telemetry/segment.schema.json` — the segment contract this extends
- `harness/cli/src/services/telemetry/flow-log.ts` — the existing exemplar (flight-plan events → telemetry, plan 035): offset-windowed, privacy-scoped, defensive
- `docs/plans/048-cohort-telemetry-insights/workshops/001-cohort-measures-and-insights-layer.md` — the insights layer that consumes these rows (WS001 D6/D7)

---

## Purpose

Inventory **every semantic element** worth emitting from flow/SDD artifacts, and pin **where and how** each is captured: at save time — i.e. inside the existing per-command telemetry capture window, triggered by the file appearing in that window's changed set. Files change over time; each change re-emits an updated snapshot, so telemetry carries the artifact's semantic **time series**, not just its final state.

## Fresh Entrant Outcome

A fresh human or agent should be able to use this workshop to reach **Contract Ready** with no additional context. They should be able to:

- Name every source file type and the exact counts extracted from it
- Point at the code seam where extraction runs (capture-service, post file-list)
- Write one extractor against the registry contract and its event shape

## Key Questions Addressed

- Which files carry semantics worth counting, and what exactly do we count? (§ Element inventory)
- Where in the pipeline do we capture — and what does "at save time" mean concretely? (§ Capture mechanic)
- How do repeated edits work — "files change over time with updated telem attached"? (§ Time-series semantics)
- What's the privacy boundary? (§ Privacy contract)

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Contract Ready | Element inventory + event schema + emission seam is enough for the plan to phase the build |
| Primary Value Axis | Knowability | Process signals move from unread files into queryable telemetry |
| Supporting Value Axes | Implementation Readiness, Cost Reduction, Safety to Change | Registry contract is buildable; zero agent burden; defensive parse |
| Downstream Loop Improved | Insights / eng-thrive analysis | "How many review fix-loops did this plan take?" becomes a query, not an archaeology dig |

## Capture mechanic — "at save time" made concrete

There is no file-watcher and none is needed. Telemetry capture already runs **around every harness command** (plan 034): it correlates the harness transcript for the window and computes `files.written` / `files.edited`. That is the save-time hook the ask names — *"if the harness is importing telem as it does, it will grab that info then, when the file is changed"*:

```text
harness <any command>
  └─ capture window opens (since: last-command)
       ├─ transcript correlation → tokens, tools, skills, files.written/edited   (existing)
       ├─ flow snapshot + flow_log replay from the-flow.json events[]            (existing, plan 035)
       └─ NEW: artifact-semantics pass
            for each path in (files.written ∪ files.edited):
              extractor = registry.match(path)        # glob → extractor, first match
              if extractor: parse file → counts-only snapshot → emit `artifact` event
```

Decisions this shape locks in:

1. **Change-triggered, not sweep-triggered.** An extractor fires only when its file is in the window's changed set. An artifact edited outside any harness session (raw editor, no harness command after) is missed until the next command's window touches it — accepted; same gap the whole tail-capture model already has (memory: copilot-vscode tail-capture).
2. **Parse the file on disk at capture time**, not the transcript diff. The committed artifact is the source of truth; the transcript only tells us *which* files to look at.
3. **The flight plan is already covered** by the `flow` snapshot + `flow_log` replay — this pass adds the *markdown artifacts* around it, plus a small derived-rollup element from the-flow.json (below) that the event replay doesn't precompute.

## Element inventory — what we extract, from where

All values are **counts, enum verdicts, or ids** — never text (§ Privacy contract). `∎` marks the elements the ask named explicitly.

| # | Source file (glob) | Element | How extracted | Example value |
|---|---|---|---|---|
| 1 | `docs/plans/*/reviews/*.md` | ∎ **fixes count** | count `**Fix**:` / `**Fix (…)**:` markers | `3` |
| 2 | ″ | findings by severity | count `F<N> · <SEV>` tokens → `{critical, high, med}` | `{high:1, med:2}` |
| 3 | ″ | verdict | first `**Verdict**:` line → enum `APPROVE \| APPROVE_WITH_NOTES \| FIX_REQUIRED \| NEEDS_ATTENTION \| other` | `APPROVE` |
| 4 | ″ | fix-loop depth | count `re-review` occurrences in the verdict line | `1` |
| 5 | `docs/plans/*/*-plan.md` | ∎ **phase count** | count `#### Phase \d+` under Phase Index (Full) else 1 (Simple) | `4` |
| 6 | ″ | mode + CS | `**Mode**:` enum, `CS-<n>` integer | `Full, 3` |
| 7 | ″ | plan status | `**Status**:` → `READY \| DRAFT` | `READY` |
| 8 | ″ | gate matrix | count PASS / FAIL / N/A rows in Gate Matrix | `{pass:6, fail:1}` |
| 9 | ″ | workshop opportunities | count rows in Workshop Opportunities table | `2` |
| 10 | ″ | unresolved gaps | count `⚠️ GAP:` markers + Unresolved Gaps rows | `0` |
| 11 | `docs/plans/*/workshops/*.md` | ∎ **workshop length** | lines + bytes + `##` section count | `{lines:310, sections:9}` |
| 12 | ″ | proof levels | `**Target Proof Level**:` / `**Current Proof Level**:` enums | `Contract Ready` |
| 13 | ″ | decisions settled | count `Selected` cells in Decision Space tables | `3` |
| 14 | ″ | open questions | count `**OPEN**` vs `**RESOLVED**` markers | `{open:1, resolved:2}` |
| 15 | `docs/plans/*/research-dossier.md` | ∎ **research length** | lines + bytes + `##` section count | `{lines:520}` |
| 16 | ″ | findings / risks | count finding-table rows; count Critical/High risk rows | `{findings:12, risks:2}` |
| 17 | `docs/plans/*/tasks/*/tasks.md` | task counts by status | count table rows by status token (`[ ]`/`[x]`/`[!]`/`[~]`) | `{done:8, blocked:0}` |
| 18 | `docs/plans/*/tasks/*/execution.log.md` | log entries + deviations | count entry headers; count `Deviation`/`Deferred` rows | `{entries:14, deferred:1}` |
| 19 | `docs/plans/*/backpressure-coverage.md` | sensor coverage | count EXISTS / BUILDABLE / ABSENT; `Certainty:` enum | `{exists:5, absent:2}` |
| 20 | `docs/plans/*/validations/*.md` | validation verdict + findings | `VALIDATED \| VALIDATED WITH FIXES \| NEEDS ATTENTION`; severity counts | `VALIDATED` |
| 21 | `docs/plans/*/ship/**/ship-report.md` | ship outcome | checks green count, PR opened bool | `{checks_green:9}` |
| 22 | `docs/plans/*/the-flow.json` | ∎ flight-plan rollup | derived: nodes by type/status, chores done/skipped/todo, phases, workshops, comment count | `{phases:4, chores_done:3}` |

Row 22 complements — not duplicates — the existing `flow_log` replay: the replay is the *transition history* (already emitted per plan 035); the rollup is the *current shape*, cheap to query without replaying events. The "probably other?" from the ask resolves to rows 17–21: tasks, execution logs, backpressure coverage, validations, ship reports — all deterministic, all already written by the flow.

## Event shape — the `artifact` event kind

One new `event_stream` kind, sitting beside `flow` / `flow_log` / `skill`:

```typescript
interface ArtifactEvent {
  kind: 'artifact';
  t: number;                    // capture time (the "save time" stamp)
  path: string;                 // repo-relative, e.g. docs/plans/046-flow-eval-loop/reviews/p1-review.md
  artifact_type: 'review' | 'plan' | 'workshop' | 'dossier' | 'tasks' | 'execution-log'
               | 'backpressure' | 'validation' | 'ship-report' | 'flight-plan';
  plan_id: string | null;       // "046-flow-eval-loop" — lifted from the path
  change: 'written' | 'edited'; // which set the path came from
  counts: Record<string, number>;        // the numeric elements from the table above
  enums: Record<string, string>;         // verdict / status / mode / proof-level — allowlisted vocab only
  size: { lines: number; bytes: number };
}
```

- `counts` + `enums` keys are **fixed per artifact_type** (schema-enumerated, `additionalProperties: false`) — an extractor cannot invent a channel that leaks text.
- Rolls into `plans_touched` naturally (plan_id already lifted), closing the known "plans_touched empty" gap from the Phase-3 smoke findings.

## Extractor registry contract

Mirror the adapter pattern already in `services/telemetry/adapters/`:

```typescript
interface ArtifactExtractor {
  type: ArtifactEvent['artifact_type'];
  match: (repoRelPath: string) => boolean;     // pure glob/regex on path
  extract: (content: string) => { counts: Record<string, number>; enums: Record<string, string> };
}
```

Rules (all inherited from the flow-log exemplar):

1. **Pure + defensive**: `extract` never throws — unparseable content returns empty counts; a malformed artifact silently yields a thin event, never a capture failure.
2. **Path-first dispatch**: first matching extractor wins; unmatched changed files emit nothing (no default extractor).
3. **Regex on structural markers only** (`**Verdict**:`, `F\d+ · (CRITICAL|HIGH|MED)`, `#### Phase \d+`, status tokens) — these are the flow verbs' own output grammar, stable because the stage modules author them.
4. **No file reads outside the changed set** — the pass adds at most |changed files| reads per capture, bounded and local.

## Time-series semantics — files change, telem updates

Each capture emits a **snapshot keyed by (path, t)**. No mutation, no dedup at emit time:

| Moment | What lands in telemetry |
|---|---|
| Review written, verdict `FIX_REQUIRED`, 2 findings | `artifact{review, fixes:0, findings:{high:1,med:1}, verdict:FIX_REQUIRED}` |
| Fixes applied, review updated in a later command window | `artifact{review, fixes:2, verdict:APPROVE, change:edited}` |
| Insights layer | diffs the two snapshots → "1 fix-loop, 2 fixes, FIX_REQUIRED→APPROVE" — a computed row, not an LLM inference |

Latest-snapshot-wins for "current state" queries; the full sequence is the process trace. This is the same posture as the segment stream itself (append-only, windowed) — nothing new to invent.

## Privacy contract

Unchanged from the locked telemetry decisions (counts-only payload):

- **Never emitted**: finding text, fix descriptions, question text, decision prose, headings, any quoted artifact content.
- **Emitted**: integers, fixed-vocabulary enums (verdicts, statuses, proof levels, modes), repo-relative paths, plan ids.
- Enum fields are **schema-enumerated with a fallback `other`** — a novel verdict string maps to `other`, never travels verbatim.
- The path is repo-relative (existing segment rule); out-of-repo artifacts are skipped, not path-mangled.

## Decision Space

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| A: change-triggered in capture window | Extract only files in `files.written/edited`, inside existing capture | Zero new triggers; "save time" exactly as asked; bounded cost | Misses edits made with no subsequent harness command | **Selected** |
| B: full sweep at `telemetry sync` | Re-scan all plan artifacts at flush | Catches out-of-band edits | Unbounded reads; re-emits unchanged files or needs mtime state | Rejected (could be added later as a backstop) |
| C: git-hook extraction at commit | Extract in the post-commit telemetry hook | Commit-aligned | Duplicates capture plumbing; misses uncommitted evolution | Rejected |
| — event shape: new `artifact` event kind vs top-level segment field | Event kind rides `event_stream` beside `flow_log` | Windowing, ordering, rollup exclusion all inherited | Slightly deeper nesting for insights queries | **Selected: event kind** |

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|-------------|-----------------|----------------|
| Insights authoring | "How many fixes did reviews collect?" required reading every review by hand | A generator sums `artifact.counts.fixes` rows |
| Plan retrospectives | Phase/workshop/gate history reconstructed from git archaeology | Time-seriesed snapshots per plan_id |
| Implementation (of this plan) | Which files, which counts, which seam — all open | Inventory (22 elements), registry contract, event schema, emission point pinned |

## Open Questions

### Q1: Should the flight-plan rollup (row 22) fire on every the-flow.json change?
**RESOLVED**: Yes — the-flow.json changes via CLI writes that happen inside harness commands, so it's naturally in the changed set; the rollup extractor is cheap (one JSON parse).

### Q2: Do retro/observe records need an extractor?
**RESOLVED**: No — they are already first-class harness records with structured frontmatter (`entries[].kind/severity`); counting them is an insights-layer query over records, not a markdown parse. Adding an extractor would double-count.

### Q3: Version drift — what happens when a stage module changes its output grammar?
**OPEN**: extractors regex the flow verbs' output markers; a skill rewrite could silently zero a count. Options: (a) accept + monitor via insights n-drop; (b) a fixture-backed drift test per extractor (a committed sample artifact must extract to known counts) — leaning (b), decide at plan time.

## Validation / Acceptance

This workshop reaches Contract Ready when:

- Every element the ask named (fixes, phases, workshop length, research length) has a row with source glob + extraction method — ✅ rows 1, 5, 11, 15
- The capture seam is pinned to existing code (capture-service, post file-list, beside the flow_log pass) — ✅ § Capture mechanic
- The event shape + privacy boundary is specified tightly enough to schema-validate — ✅ § Event shape, § Privacy contract
