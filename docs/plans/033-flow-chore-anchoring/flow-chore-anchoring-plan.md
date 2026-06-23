# Flow Chore Anchoring — Deterministic Loop-as-Chores

**Plan ID**: 033-flow-chore-anchoring
**Created**: 2026-06-23 · **By**: /the-flow (1b plan)
**Mode**: Simple · **Complexity**: CS-2 (small) · **Status**: READY (validated + condensed to 1 phase 2026-06-23)

---

## Business Specification

### Research Context

Per `research-dossier.md`: when the `eng-harness-flow` ⚙️ loop runs alongside an active
`the-flow.json`, it injects four fire-hooks as chore nodes. In the observed run those chores
were **orphans** (`anchor: null`, no `branch_of`, no incoming edge), so they float disconnected
from the spine — no deterministic point to run them, and nothing the engine reads each turn
surfaces a due hook. Root cause is the skill's AC-07 "add" path (`flight-plan-ops.md:131-133`),
which leads with edge-less `add-node`. The engine already supports anchored chores via
`branch_of`; the missing piece is a position-aware "due" read.

### Summary

Make injected loop-as-chores **anchored** to the spine node they belong to, and make them
**deterministic checks** by giving the engine a position-aware read ("what chores are due at the
current node?"). Two surfaces: the `harness flow` CLI (a due-chore read) and the
`eng-harness-flow` skill recipe (anchored injection with an explicit hook→anchor map).

### Goals

- Injected fire-hook chores are **connected** to the spine (populated `anchor`; dotted edge in the
  render) — never orphans.
- The guided engine can deterministically answer "which chores are due at `nav.now`?" so a hook is
  surfaced at the right moment and is not silently missed under context loss.
- The **the-flow guided engine consumes** that read each turn (Phase 3) — so determinism is
  *delivered* end-to-end, not merely *enabled* (validation HIGH: the consumer side must be owned).
- Injection stays **idempotent** and the existing seam-node reconciliation (R-1) is preserved.

### Non-Goals

- Making chores hard **gates** that block flow advancement (chores are advisory by design —
  `flow-schema.ts:292-312`; constitution P-non-gating). No thresholds, no blocking.
- Splicing chores **on-spine** (Option B) — rejected; it clutters the rail and breaks the
  off-spine chore model.
- Changing the standalone `.harness/loop.flow.json` shape (already wired in sequence) or the
  five-hook/`--json` envelope contract (frozen).
- Schema/`chore` shape changes — `{kind, importance}` is unchanged.

### Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| flow (CLI flow engine) | existing | **modify** | Add a position-aware due-chore read (`chores --at`, `nav show` due_chores) |
| eng-harness-flow (skill) | existing | **modify** | Fix the AC-07 injection recipe to anchor chores; add the hook→anchor map |
| the-flow (guided engine; **separate skill, cross-repo**) | existing | **modify** | Consume `nav show` due_chores each turn so an anchored chore is surfaced to the agent at `nav.now` |

No new domains; no `docs/domains/` registry in this repo (domains are informal — CLI services +
skills). The the-flow guided-engine edit is **cross-repo** — its source lives outside this repo
(`~/github/tools/skills/SDD/the-flow/`, as migrated in plan 027); tasks T08–T10 own that change
explicitly rather than assuming an unowned consumer adopts the new field.

### Testing Strategy

- **Approach**: unit tests (vitest) for the CLI read; a fixture assertion for the skill recipe.
- **Focus**: anchor population on the "add" path; `chores --at` filter correctness; `nav show`
  due_chores; idempotency (re-run → byte-identical).
- **Excluded**: end-to-end minih eval is optional (the deterministic CLI assertions are the proof).
- **Mock usage**: none beyond the existing injected ports (fs/clock) the flow tests already use.

### Documentation Strategy

- **Location**: `docs/how/harness-flow.md` (CLI verb reference — the `chores`/`nav show` additions)
  and the two `eng-harness-flow` reference files (`flight-plan-ops.md`, `references/00-routing.md`).
- **Rationale**: these are the authoritative surfaces consumers read; keep them in sync (the repo
  has a `check:docs` guard).

### Complexity

- **Score**: CS-2 (small)
- **Breakdown**: S=1, I=1, D=1, N=1, F=0, T=1
- **Confidence**: 0.80
- **Assumptions**: `insert-node --branch-of` render + `listChores` anchor work as read in source.
- **Dependencies**: tasks T08–T10 edit the the-flow guided engine in its **separate** source repo
  (`~/github/tools/skills/SDD/the-flow/`) — coordinate deploy order (in-repo CLI first, then the-flow).
- **Risks**: see Risks table.
- **Phases**: 1 (Simple mode — one task table).

### Acceptance Criteria

- **AC-01** — Injecting a fire-hook when **no** seam node carries it produces a chore whose
  `anchor` is its spine node (not `null`); `harness flow render` draws a connected dotted edge
  (no floating box).
- **AC-02** — `harness flow chores --at <node>` returns **only** chores anchored at `<node>`,
  exit 0, with a stable JSON shape; unknown/empty node → empty list, not an error.
- **AC-03** — `harness flow nav show` output includes a `due_chores` array of the **ChoreRow** shape
  `{ id, label, status, kind, importance, command, anchor, runnable }` (the existing `listChores`
  row), filtered to chores whose `anchor === nav.now` and whose status ∉ {`done`, `skipped`}, in
  document order. Empty array when none (never absent/null).
- **AC-04** — Re-running injection is **idempotent** (byte-identical node set; dedup on the
  `--hook <X>` token), and the R-1 "flag an existing seam node in place" path is unchanged.
- **AC-05** — The four hooks anchor per the map: `pre-flight`→ flow entry / first phase;
  `pre-coding`→ `plan`; `post-coding`→ the implement phase; `post-flight`→ `ship`.
- **AC-06** — `eng-harness-flow` module edits stay **flow-agnostic** — they state what the verb
  does and how it anchors; they introduce **no** context-wide prohibitions (shared-context rule).
- **AC-07** — The the-flow guided engine, on each guided turn, reads `harness flow nav show` and
  **surfaces** any `due_chores` at `nav.now` to the agent (e.g. in the rail/narration as a "due here:
  `<hook>`" line). Surfacing is **advisory** (a presented due item, never a hard gate — chores do not
  block advancement); the determinism is that the agent is *shown* the right hook at the right node.

### Risks & Assumptions

- Assumes the hook→anchor map degrades gracefully when an anchor node (e.g. a phase) does not yet
  exist — the recipe must fall back to the nearest existing spine node (e.g. `plan`) deterministically.
- Assumes adding `due_chores` to `nav show` is additive (tolerant consumers — `validateFlowDoc` is
  not `additionalProperties:false`).

### Open Questions

- Spelling of the filter flag: `--at <node>` (position) vs `--due` (implicit `nav.now`). Plan picks
  `--at <node>` as the primitive and treats `nav show` due_chores as the `nav.now` convenience.
  (Non-blocking — resolved in Phase 1.)

### Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Hook→anchor map + missing-anchor fallback | State Machine | Determinism hinges on a total, well-defined map | What anchor when the phase node isn't revealed yet? |

(Advisory — CS-2 does not require a workshop; listed for completeness.)

### Clarifications

#### Session 2026-06-23
- Q: Gate chores or keep advisory? → A: keep advisory (constitution: never gate); determinism comes
  from anchoring + a due read, not blocking.
- Q: On-spine or excursion? → A: excursion (`branch_of`) — connected but off-rail.

---

## Planning Seam

- Research reused: `research-dossier.md` (this plan dir) — 7 findings, evidence-cited to CLI source
  + both skills.
- No ADRs in `docs/adr/`. Constitution + architecture read for gates.
- Decision: Option **A + C** (anchor as excursion + position-aware due read); Option B rejected.

---

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No open critical [NEEDS CLARIFICATION]; approach resolved in dossier |
| G2 | Constitution | PASS | P8 (real gap — no position-aware chore read exists); P2 hexagonal kept; P11 served |
| G3 | Architecture | PASS | Pure logic in `flow-mutations`/service; act only wires (matches flow layering) |
| G4 | ADR Compliance | N/A | No `docs/adr/*.md` |
| G5 | Structure | PASS | All required sections present |
| G6 | Testing Alignment | PASS | Implementation tasks ship vitest/fixture assertions (T03, T07, T10) |
| G7 | Domain Completeness | PASS | All three touched domains mapped; no new domain |

### Summary

One cohesive change, **a single task table** (Simple mode). The engine-side determinism primitive
(`chores --at <node>` + a `due_chores` array in `nav show`) and the skill fix (anchored injection via
`insert-node --branch-of`, with a total hook→anchor map) both ship from this repo and land together;
the the-flow guided engine then consumes the read each turn (cross-repo, tasks T08–T10) — the consumer
side that turns an anchored chore into a hook the agent is actually shown at the right node. Net:
anchored chores, surfaced deterministically — real checks, not floating decorations.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/flow/flow-mutations.ts` | flow | internal | `listChores` filter + due derivation |
| `harness/cli/src/acts/flow.ts` | flow | contract | `chores --at` flag; `nav show` due_chores wiring |
| `harness/cli/src/services/flow/*.test.ts` (+ act tests) | flow | internal | AC-01/02/03/04 coverage |
| `docs/how/harness-flow.md` | flow | contract | document the read additions |
| `skills/eng-harness-flow/references/flight-plan-ops.md` | eng-harness-flow | contract | anchored "add" path + hook→anchor map |
| `skills/eng-harness-flow/references/00-routing.md` | eng-harness-flow | internal | keep routing-level injection guidance in sync |
| the-flow `references/00-routing.md` (**cross-repo**) | the-flow | contract | consume `nav show` due_chores each turn (T08–T10) |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | Injected chores are orphans (`anchor:null`) — DEF-01/RC-01 | anchor via `branch_of` (T04) |
| 02 | High | No position-aware "due" read — ENG-02 | `chores --at` + `nav show` due_chores (T01–T02) |
| 03 | High | Engine already renders/anchors `branch_of` — ENG-01 | Reuse; no schema change |
| 04 | Medium | the-flow seam map already defines anchors — SEAM-01/02 | encode hook→anchor map (T05) |

### Implementation

**Single phase, one task table** (Simple mode — condensed from the original 3-phase split; the work
is small and the only real boundary is in-repo vs the cross-repo the-flow change). Tasks **T08–T10**
touch the-flow's **separate** source (`~/github/tools/skills/SDD/the-flow/`, plan 027) and depend on
the CLI read (T01–T02): land + ship the in-repo CLI change first, then the cross-repo consumer.

**Hook → anchor map (total; deterministic fallback by spine order research < plan < phase(s) < review < ship):**

| Hook | Preferred anchor | Fallback order if absent |
|------|------------------|--------------------------|
| `pre-flight` | first `phase` node | → `plan` → `research` |
| `pre-coding` | `plan` | → first `phase` → `research` |
| `post-coding` | last `phase` node | → `plan` |
| `post-flight` | `ship` | → `review` → last `phase` → `plan` |

The anchor is always an **existing** spine node at injection time (orphans impossible); when the
preferred node is not yet revealed, take the first hit walking the fallback list.

| Task | Description | Done-When | AC |
|------|-------------|-----------|----|
| T01 | Add an `--at <node>` filter to `harness flow chores` (filters `listChores` rows to `anchor === node`). | `chores --at <n>` returns only rows anchored at `<n>`; empty for none; exit 0. | AC-02 |
| T02 | Add a `due_chores` array to `nav show` output: the **ChoreRow** shape `{id,label,status,kind,importance,command,anchor,runnable}`, filtered to `anchor === nav.now` and status ∉ {done, skipped}, document order; `[]` when none (never absent). | `nav show --json` carries `due_chores` with the full ChoreRow shape; `[]` when none. | AC-03 |
| T03 | Vitest for T01/T02 incl. unknown-node (empty, no error), a done chore excluded from due, and the full row shape asserted. | `cd harness/cli && npx vitest run` green; new cases assert filter + due shape. | AC-02, AC-03 |
| T04 | Rewrite eng-harness-flow `flight-plan-ops.md` AC-07 step 3 ("Not found → add") to lead with `harness flow insert-node --branch-of <anchor>` (not bare `add-node`), citing the hook→anchor map + fallback above. | The recipe's primary "add" form is `insert-node --branch-of`; map + fallback documented. | AC-01, AC-05 |
| T05 | Encode the total hook→anchor map + fallback in the recipe; keep dedup on `--hook <X>` and the R-1 "flag in place" (`set-node`) path unchanged (`set-node` can't re-parent, so R-1 only flags an already-placed node). | Map + idempotency + reconciliation present and consistent. | AC-04, AC-05 |
| T06 | Sync eng-harness-flow `references/00-routing.md` injection guidance; keep wording flow-agnostic (no context-wide prohibitions). | Routing doc matches; no "never write…" prohibitions introduced. | AC-06 |
| T07 | Fixture: inject the four hooks into a sample the-flow.json (no seam nodes), then (a) `chores --json` shows all four with non-null `anchor`; (b) `render` shows a connected dotted edge per chore (no floating box); (c) re-run is byte-identical. | All three hold; orphan count = 0; idempotent. | AC-01, AC-04 |
| T08 | **(cross-repo)** In the-flow's `references/00-routing.md` per-turn cadence, read `harness flow nav show` and, if `due_chores` is non-empty, surface them (coach rail/narration "due here: `<hook>`"). | Cadence names the `nav show` read + the surface step. | AC-07 |
| T09 | **(cross-repo)** Keep surfacing **advisory** — a presented due item, never a gate (the-flow invariant "never gate/score/block"). | Wording is advisory; no gating introduced. | AC-07 |
| T10 | **(cross-repo)** Behavioral check via the-flow's eval harness (minih + scorer): with anchored chores present, the run surfaces the due hook at its node. | Eval shows the due hook surfaced at the anchored node. | AC-07 |
| T11 | Update `docs/how/harness-flow.md` (chores/nav additions) + pass `npm run check:docs`. | Doc reflects new flag/field; docs-sync guard green. | — |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T04, T07 | fixture: non-null anchor + connected render (dotted edge, no orphan box) |
| AC-02 | T01, T03 | vitest: `chores --at` filter |
| AC-03 | T02, T03 | vitest: `nav show` due_chores full ChoreRow shape |
| AC-04 | T05, T07 | fixture: byte-identical re-run; R-1 path |
| AC-05 | T04, T05 | recipe review: hook→anchor map total + fallback table |
| AC-06 | T06 | doc review: flow-agnostic wording |
| AC-07 | T08, T09, T10 | eval harness: due hook surfaced at its node, advisory |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Anchor node not yet revealed (phase not inserted) | Medium | Low | Total hook→anchor map + deterministic fallback table (T04–T05); anchor is always an existing node |
| Determinism left un-owned (consumer never reads due_chores) | Medium | High | T08–T10 own the the-flow engine change explicitly (validation HIGH) — not assumed |
| `nav show` consumers break on new field | Low | Low | Additive only; validator is tolerant of extra fields |
| Skill wording bleeds prohibitions into shared context | Low | Medium | AC-06 review gate; state-what-it-does phrasing only |
| Cross-repo deploy skew (the-flow reads due_chores before CLI ships it) | Low | Medium | Deploy order: in-repo CLI read (T01–T02) first, then the-flow (T08–T10); `due_chores` absent → engine no-ops |

---

## Validation Record (2026-06-23)

> **Condense note (2026-06-23, post-validation):** plan condensed Full→**Simple** (3 phases → one
> `### Implementation` task table, T01–T11). All validation findings below are preserved as tasks —
> the phase labels in this record (P1/P2/P3) map to T01–T03 (CLI read), T04–T07 (skill recipe), and
> T08–T10 (the-flow consumer) respectively.

### Validation Thesis

**Raison d'être**: `eng-harness-flow` injects four fire-hooks as chore nodes into an active
`the-flow.json`, but they land as orphan nodes (`anchor:null`) floating off the spine — no
deterministic point to run them; under context loss the agent forgets them.

**Value claim**: An agent — even after a `/compact` context loss — can deterministically know which
hook to run at the current flow position, and the chores render connected.

**Artifact promise**: Downstream `tasks`/`implement` phases can build the fix with no further product
decisions.

**Intended beneficiaries**: the agent driving a the-flow guided session (incl. post-context-loss);
secondarily reviewers reading the rendered flow.

**Proof target**: Implementation.

**Evidence standard**: cited source matches; testable ACs; a total hook→anchor map; idempotency
preserved.

**Thesis source**: `original-ask.md` (verbatim problem) + `research-dossier.md` (Option A+C decision).

**Thesis verdict**: Partially advanced → **advanced after fixes** (Phase 3 now owns the consumer side).

**Main thesis risk**: determinism depended on an unowned consumer change (the-flow guided engine) —
**resolved** by adding Phase 3.

---

| Agent | Lenses Covered | Thesis Axes | Issues | Verdict |
|-------|---------------|-------------|--------|---------|
| Coherence + Source-Truth | System Behavior, Edge Cases, Hidden Assumptions, Domain Boundaries, Evidence Sufficiency | Implementation Readiness | 2 HIGH, 1 MED — fixed | ⚠️→✅ |
| Thesis Alignment | Thesis Alignment, Proof-Level Fit | Thesis, Evidence Sufficiency | 1 HIGH, 1 MED, 1 LOW — fixed | ⚠️→✅ |
| Forward-Compatibility | Forward-Compatibility, Integration & Ripple, Deployment & Ops | Downstream Usefulness, Contract Integrity | 2 HIGH, 1 MED — fixed | ⚠️→✅ |

Lens coverage: 11/15 (Thesis Alignment ✓ mandatory; Forward-Compatibility ✓ mandatory).

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| Phase 1 impl | exact `chores --at` + `due_chores` ChoreRow shape | Shape mismatch | ✅ (fixed) | AC-03 + task 1.2 now pin `{id,label,status,kind,importance,command,anchor,runnable}` |
| Phase 2 impl | total hook→anchor map + fallback + `insert-node --branch-of` + idempotency/R-1 | Contract drift | ✅ | Phase 2 map+fallback table; aligns `flight-plan-ops.md` |
| eng-harness-flow consumers | flow-agnostic wording; frozen 5-hook/`--json` envelope | Contract drift | ✅ | AC-06; no envelope change |
| the-flow guided engine | actually call the due read each turn | Lifecycle ownership | ✅ (fixed) | Phase 3 owns the cross-repo consumer change (was unowned) |

**Thesis alignment**: value claim now advanced at the Implementation proof level — anchored chores
plus an owned consumer (Phase 3); main risk (unowned determinism) closed.

**Outcome alignment**: "no deterministic way to know when to run them thus they are not really set up
as checks, lter the agent might forget…" — the plan now advances this end-to-end, because Phase 3
owns the engine adoption that surfaces the due hook at its node (previously only partially advanced).

**Standalone?**: No — mid-chain plan; downstream `tasks`/`implement` consumers exist.

Overall: ⚠️ **VALIDATED WITH FIXES** — 5 HIGH + 3 MED/LOW found across 3 agents; all applied to the plan.
