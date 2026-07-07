# File-Write Telemetry — AI Authorship Measurement

**Mode**: Simple
**Plan Version**: 1.1.0
**Created**: 2026-07-07
**Status**: READY
**Spec source**: unified (this file)
**Validation**: `/validate-v2` run in an Opus 4.8 subagent (source-level) → NEEDS ATTENTION, 4 MEDIUM findings folded in (v1.1.0): `file` `t`=capture-time + rollup exclusion; Copilot create/edit body reads; `<external>` confinement is net-new (not `relativizePath`); AC-06 made measurable.

## Business Specification

### Research Context
📚 Incorporates findings from `research-dossier.md` (9 findings, 1 historical — plan 050 precedent) and the user's locked decisions D1–D5 recorded there.

Key grounding: `ArtifactEvent` (plan 050) already emits `path`+`size`+`change` with a complete OTLP mapping, but is **gated to the 10 SDD artifact types** (`artifact-semantics.ts:492` skips unmatched files). This feature generalizes that idea to *every* agent-written file — but computes **change-deltas from tool payloads** rather than reading file content.

### Summary
Record every file an agent writes or edits as a lightweight telemetry event carrying the **repo-relative path** and the **change-delta** (lines/bytes added and removed). The purpose is **AI-authorship measurement**: downstream analysis reads the collected paths + deltas to answer "what share of this repo's code did AI write?", later split by kind (tests vs. source vs. config) via semantic classification **on the path, done downstream** — not at capture.

### Goals
- Emit a `file` telemetry event for each agent Write/Edit, carrying `path` + `change` + a `delta` of lines/bytes added/removed.
- Compute deltas **from the tool payload already parsed** (Claude `Edit` old/new, Claude `Write` content, Copilot `apply_patch` +/- lines) — no file stat, no file-content read.
- Keep the privacy contract intact: allowlist-by-construction serialization; out-of-repo writes collapse to an `<external>` sentinel.
- Surface "which files did agents write (and how much)" in the telemetry report/insights.

### Non-Goals
- **No capture-time classification** (D3) — the "is this a test/source/config?" rubric runs downstream on the path, never on the wire. No `file_kind` field.
- **No total-file-size measure** (D4) — edits report bytes/lines *changed*, never whole-file size.
- No capture for clients that don't expose per-file paths (**copilot-vscode**, **cursor**) — honest null, never estimated (D from F-01).
- No capture of files written outside the Write/Edit/apply_patch tools (e.g. `Bash` `>` redirects, MCP writers) — documented boundary.
- No semantic diffing/LCS beyond a line-level added/removed count.

### Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| telemetry | existing | **modify** | New `file` event kind + adapter emission + OTLP mapping + report surface |

No domain registry exists (`docs/domains/` absent) — `telemetry` is the single existing logical domain (the `harness/cli/src/services/telemetry/` tree). No new domain is created.

### Testing Strategy
- **Approach**: Hybrid — Full TDD for the pure logic (delta computation, serializer/OTLP mapping, path confinement); lightweight validation for adapter wiring (fixture-driven).
- **Rationale**: The delta + serialize + OTLP surfaces are pure functions with existing golden-fixture drift guards — cheap and high-value to test-first. Adapter wiring is validated against transcript/ledger fixtures.
- **Focus Areas**: delta correctness (written vs. edited); privacy (out-of-repo → `<external>`, no stray fields); OTLP round-trip + freeze test; `computeRollup` reconstruction.
- **Excluded**: exhaustive diff-algorithm testing (line-level add/remove count is the contract, not an LCS).
- **Mock Usage**: Avoid mocks — real fixtures + existing fake ports (`fake-fs`, fake adapters).

### Documentation Strategy
- **Location**: `docs/how/` — extend the telemetry field reference with the new `file` event + `harness.file.*` attributes.
- **Rationale**: Keeps the field dictionary from drifting; the report view is documented where the other telemetry docs live.

### Complexity
- **Score**: CS-3 (medium)
- **Breakdown**: S=2 (5 mirrored wire surfaces + report + fixtures), I=1 (two adapters), D=0 (stateless events), N=1 (delta-from-payload is new but has 050 precedent), F=1 (privacy contract), T=1 (fixtures + freeze test)
- **Confidence**: 0.80
- **Assumptions**: Claude `Edit`/`Write` and Copilot `apply_patch` payloads are available at the point the adapters already parse them (confirmed F-05/F-08).
- **Dependencies**: none external.
- **Risks**: see Risks table.
- **Phases**: 1 (Simple).

### Acceptance Criteria
1. **AC-01** — An agent `Write` of a new in-repo file emits exactly one `file` event with `change: "written"` and `delta.bytes_added`/`delta.lines_added` equal to the new content's byte/line count (removed = 0).
2. **AC-02** — An agent `Edit` emits a `file` event with `change: "edited"` and `delta` reflecting lines/bytes **added and removed** derived from the old→new strings — never the total file size.
3. **AC-03** — A write resolving **outside** the repo emits a `file` event whose `path` is the literal `<external>` sentinel, carrying delta only (no real path).
4. **AC-04** — The serialized `file` event carries only `t`, `t_precision?`, `kind`, `path`, `change`, `delta` — no free text — enforced by the allowlist-by-construction serializer (privacy, P12/AC-15).
5. **AC-05** — The event round-trips through OTLP logs via `harness.file.*` attributes and the OTLP contract **freeze test passes** (schema key-set updated in lockstep).
6. **AC-06** — `file` events are **excluded from `rollup.activity` gap/wall/stage math** (mirroring `flow_log`/`artifact`/`mark`): a unit test asserts that adding `file` events to a stream leaves `rollup.activity` byte-identical. (The regenerated `check:telemetry-fixtures` guard alone does not prove this — it passes by construction after regen — so the exclusion is asserted directly.)
7. **AC-07** — A `copilot-vscode` or `cursor` session emits **zero** `file` events (no fabricated paths/sizes).
8. **AC-08** — The telemetry report/insights surfaces the set of agent-written files with their per-file deltas ("which files did agents write, and how much").

### Risks & Assumptions

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Edit delta over-counts (line-level add/remove, not true diff) | Med | Low | Contract is explicitly line-level add/remove; documented, sufficient for authorship share |
| Volume: a large refactor emits many `file` events | Med | Med | Per-file events (one per changed path per window); dedup per path per window (mirror `artifact-semantics` `seen` set) |
| A `Write` over an existing file counts full content as "added" | Med | Low | Documented boundary (no prior content available at capture); acceptable for authorship measurement |
| OTLP freeze test trips if schema not updated with the mapping | High | Low | Task pairs semconv + `harness-otlp.schema.json` in one step (the freeze test is the guard, not the risk) |

### Open Questions
_None blocking — D1–D5 resolved the design forks; D6 (dedicated `file` event kind) is decided in this plan (see Key Findings 03)._

### Workshop Opportunities
_None open — WS-1..WS-4 from the dossier were resolved by locked decisions D1–D5 and the record-shape call below._

### Clarifications
#### Session 2026-07-07
- **Workflow Mode**: Simple.
- **Testing Strategy**: Hybrid (TDD for pure logic, lightweight for wiring).
- **Mock Usage**: Avoid mocks — real fixtures + fake ports.
- **Documentation**: `docs/how/`.
- **Pre-plan decisions D1–D5** (from `research-dossier.md` § Locked Decisions): full repo paths; out-of-repo → `<external>`; no capture-time classification; deltas not total size; deltas from tool payload (no file read).

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — all resolved via D1–D5 + the record-shape call.

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings + carries locked decisions D1–D5 |
| workshops/*.md | n | none |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | Round 1 answered; no critical [NEEDS CLARIFICATION] remain |
| G2 | Constitution | PASS | Privacy P12 honored — path + integer deltas only, allowlist-by-construction; ports-only (P2) preserved (adapters read via injected ports) |
| G3 | Architecture | PASS | No new layers; change stays within the telemetry service; adapter seam unchanged |
| G4 | ADR Compliance | N/A | No `docs/adr/*.md` present |
| G5 | Structure | PASS | All required sections present |
| G6 | Testing Alignment | PASS | Hybrid: TDD tasks precede impl for pure logic; validation task per wiring area; ACs measurable |
| G7 | Domain Completeness | PASS | Single existing `telemetry` domain; Domain Manifest covers every referenced file |

### Summary
Add a first-class `file` event kind to the telemetry event stream, emitted by the path-carrying adapters (`claude`, `copilot`) at tool-parse time, computing a line/byte add/remove **delta from the tool payload**. Thread it through the five mirrored wire surfaces (types → serializer+schema → OTLP semconv+logs+frozen schema → rollup) with the path confined (repo-relative, out-of-repo → `<external>`) at serialize time, and surface the collected files + deltas in the telemetry report. The expected outcome: a per-session record of which files each agent wrote and how much, ready for downstream test-vs-code authorship analysis.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/telemetry/events.ts` | telemetry | contract | Add `FileEvent` + `'file'` to `EventKind`/`EVENT_KINDS` |
| `harness/cli/src/services/telemetry/file-delta.ts` (new) | telemetry | internal | Pure delta computation (old/new strings, full-content case) |
| `harness/cli/src/services/telemetry/segment.ts` | telemetry | contract | Serializer `case 'file'` + path confinement (`<external>`) |
| `harness/cli/src/services/telemetry/segment.schema.json` | telemetry | contract | Schema mirror of the `file` event |
| `harness/cli/src/services/telemetry/otlp/semconv.ts` | telemetry | contract | `harness.file.*` attribute names |
| `harness/cli/src/services/telemetry/otlp/logs.ts` | telemetry | internal | `case 'file'` log-record mapping |
| `harness/cli/src/services/telemetry/otlp/harness-otlp.schema.json` | telemetry | contract | Frozen attribute key-set (freeze test) |
| `harness/cli/src/services/telemetry/adapters/claude-adapter.ts` | telemetry | internal | Emit `file` events from Write/Edit |
| `harness/cli/src/services/telemetry/adapters/copilot-adapter.ts` | telemetry | internal | Emit `file` events from apply_patch/create/edit |
| `harness/cli/src/services/telemetry/rollup.ts` | telemetry | internal | Optional `authorship` aggregate (derived) |
| `harness/cli/src/services/telemetry/report.ts` + `insights.ts` | telemetry | internal | "Files written" AI-authorship surface |
| `docs/how/telemetry-field-reference.html` | telemetry | internal | Document the new event + attributes |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | `ArtifactEvent` path+size+change + OTLP mapping is the exact precedent, gated to 10 SDD types (`artifact-semantics.ts:492`) | Mirror its shape/guards; drop the extractor gate; compute deltas instead of reading size |
| 02 | High | Deltas are **more available than total size** — Claude `Edit` old/new, `Write` content, Copilot `apply_patch` +/- lines are already parsed by the adapters | Emit `file` events at adapter parse time; no stat, no content read (better privacy + cheaper) |
| 03 | High | A new event kind is cross-cutting: `events` + `segment`+schema + `otlp` semconv/logs/frozen-schema + `rollup` + golden fixtures must move together (F-06) | Sequence tasks so the wire contract lands before adapters emit; regen fixtures at the end |
| 04 | High | Path privacy: full source paths now travel (D1); out-of-repo must not (D2). **`relativizePath` is NOT the model** — it collapses out-of-repo to *basename* (leaks the filename), not `<external>` (`segment.ts:252-261`) | Write a **new** confinement branch that emits the literal `<external>` for out-of-repo; do not reuse `relativizePath` |
| 05 | Med | No report/insights "files written" surface exists today (F-07) | Add a lightweight per-file delta view — the actual user-facing goal |
| 06 | High | `file` is a **capture-time** snapshot (like `artifact`), so its `t` must not re-sort into activity math — `rollup.ts:190` excludes `flow_log`/`artifact`/`mark` and must also exclude `file`, or gap/wall/stage timing corrupts | Set `t`=capture-time; add `'file'` to the `rollup.ts` exclusion filter; assert activity is unchanged (AC-06) |
| 07 | Med | Copilot deltas: only `apply_patch` retains a diffable body today; `create`/`edit`/`str_replace` deliberately skip `file_text`/`old_str`/`new_str` (`copilot-adapter.ts:304-308`) | Read those `arguments` fields **to compute counts only** (privacy-safe — counts, never stored text); or scope copilot deltas to `apply_patch` + path-only create/edit (documented) |
| 08 | Low | `otlp/logs.ts` needs **two** cases — encode (`:148`) and decode (`:322`); `otlp/metrics.ts` is intentionally **untouched** (no new metric attribute; its golden is regenerated by T009) | T004 covers encode+decode; note metrics.ts is deliberately out of scope |

### Implementation

**Objective**: Ship a `file` telemetry event capturing per-file path + change-delta from tool payloads, end-to-end from adapter emission through OTLP to the report.
**Testing Approach**: Hybrid — TDD for `file-delta`, the serializer/schema, and OTLP mapping (pure, fixture-guarded); fixture-driven validation for adapter emission; regen goldens last.

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T001 | Define `FileEvent` (`kind:'file'`, `t`=**capture-time** snapshot, `path`, `change:'written'|'edited'`, `delta:{lines_added,lines_removed,bytes_added,bytes_removed}`); add `'file'` to `EventKind` + `EVENT_KINDS`; add to the `Event` union | telemetry | `events.ts` | Type compiles; `EVENT_KINDS` includes `'file'`; unit asserts the closed set; doc-comment states `t`=capture-time (excluded from rollup math, like `artifact`) | Contract first (findings 03, 06) |
| [ ] | T002 | **TDD**: pure `computeFileDelta(oldText, newText)` + `writtenDelta(content)` helper — line/byte add+remove counts (Write: all added; Edit: line-level add/remove of old→new) | telemetry | `file-delta.ts` (new) + test | Tests: new-file=full added/0 removed; edit adds+removes lines/bytes; empty→empty | Line-level add/remove, not LCS (risk row) |
| [ ] | T003 | **TDD**: serializer `case 'file'` in `serializeEvent` + `segment.schema.json` mirror; **new** confinement branch — repo-relative path, else the literal `<external>` (do NOT reuse `relativizePath`, which leaks basename — `segment.ts:252-261`); allowlist-by-construction (no spread) | telemetry | `segment.ts`, `segment.schema.json` + test | AC-03: out-of-repo→`<external>` (not basename); AC-04: only allowlisted fields; schema validates a `file` event | Finding 04 — net-new confinement |
| [ ] | T004 | **TDD**: OTLP — add `harness.file.path/change/lines_added/lines_removed/bytes_added/bytes_removed` to `semconv.ts`; add **both** encode (`otlp/logs.ts:148` neighborhood) **and** decode (`:322`) `case 'file'`; update `harness-otlp.schema.json` frozen key-set in lockstep. `otlp/metrics.ts` intentionally untouched (no new metric attr) | telemetry | `otlp/semconv.ts`, `otlp/logs.ts`, `otlp/harness-otlp.schema.json` + test | AC-05: log encode→decode round-trip test + freeze test both green | Findings 08; freeze test is the guard |
| [ ] | T005 | Emit `file` events from the **claude** adapter: `Write`→written (full `content`), `Edit`→edited (`old_string`/`new_string` delta), at the existing parse site; dedup per path per window | telemetry | `adapters/claude-adapter.ts` + fixture test | Transcript fixture yields expected `file` events (AC-01, AC-02); `tInput.content`/`old_string`/`new_string` read at `:309-312` | Payload confirmed in scope (validator) |
| [ ] | T006 | Emit `file` events from the **copilot** adapter: `apply_patch` +/- lines → delta (`patchByCall`); for `create`/`edit`/`str_replace` read `arguments.file_text`/`old_str`/`new_str` **to compute counts only** (privacy-safe — counts, never stored text); same dedup | telemetry | `adapters/copilot-adapter.ts` + fixture test | Ledger fixture yields expected `file` events for apply_patch AND create/edit; copilot-vscode/cursor emit none (AC-07) | Finding 07 — body fields currently skipped (`:304-308`), read for counts |
| [ ] | T007 | Exclude `'file'` from `rollup.ts` activity/gap/stage math (add to the `:190` filter beside `flow_log`/`artifact`/`mark`); add derived `authorship` aggregate (`files`, `lines_added`, `bytes_added`) as a pure function of `event_stream` | telemetry | `rollup.ts` + test | AC-06: a stream with `file` events yields **byte-identical `rollup.activity`**; aggregate derives from stream | Finding 06 — the exclusion is the load-bearing part |
| [ ] | T008 | Report/insights: surface the per-file written set + deltas (the "which files did agents write" view); lightweight | telemetry | `report.ts`, `insights.ts`, `report.schema.json` | AC-08: report includes files + deltas; schema validates | Finding 05 |
| [ ] | T009 | Regenerate telemetry golden fixtures (`npm run gen:telemetry-fixtures`) and confirm `npm run check:telemetry-fixtures` is green | telemetry | telemetry fixture corpus | `check:telemetry-fixtures` passes with the new event present | Run after T001–T008 |
| [ ] | T010 | Document the `file` event + `harness.file.*` attributes in the telemetry field reference | telemetry | `docs/how/telemetry-field-reference.html` | Field reference lists the new event + attributes | docs/how per strategy |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T001, T002, T005 | claude Write fixture test |
| AC-02 | T002, T005 | claude Edit fixture test |
| AC-03 | T003 | serializer out-of-repo→`<external>` test |
| AC-04 | T001, T003 | serializer allowlist test |
| AC-05 | T004 | OTLP round-trip + freeze test |
| AC-06 | T007 | rollup-activity-unchanged assertion (file events excluded) |
| AC-07 | T006 | copilot-vscode/cursor emit-nothing test |
| AC-08 | T008 | report content + `report.schema.json` |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Cross-cutting wire change misses a mirror surface | Med | Med | Task sequence pairs each surface with its schema/freeze guard; T009 regen catches drift |
| Adapter payload shape differs from assumption | Low | Med | Fixture-driven tests (T005/T006) use real transcript/ledger shapes |
| Report view scope-creeps | Low | Low | Kept lightweight (T008): raw per-file deltas, classification stays downstream (D3) |
