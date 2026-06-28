# Flight-Plan Pre-Bake + Transactional Generic Node Ops (Route A)

**Mode**: Full
**Plan Version**: 3.0.0
**Created**: 2026-06-28
**Status**: READY (v3.0.0 — scope expanded to both repos; awaiting peer plan-review per T018)
**Spec source**: unified (this file)

📚 Incorporates findings from research-dossier.md (incl. the 2026-06-28 Route A Direction Update + verb survey) **and the 2026-06-28 scratch prototype** (`scratch/039-starter-template/` — a hand-cranked starter seed instantiated + rendered through the real CLI, which proved the shape and surfaced the renderer/observe/drain-harvest findings below).

> **Supersedes** the v1.x design in this folder (reconcile-on-read CLI hook) and the-flow `f9a86f1` (prose cadence step). The *problem* (the whole journey isn't pre-populated; prose triggers get skipped) is unchanged; the *mechanism* is replaced — no spawn-on-read, no `provenance.reconcile_hook`, no watch-set/watermark/reentrancy guard.
>
> **v3.0.0 scope change (Jordan, 2026-06-28):** 039 now **encompasses both sides and we implement all of it** — the harness-engineering work (CLI primitives + renderer) **and** the the-flow work (schema + templates + plan-complete expander + `harness-seams.md`). The the-flow agent (peer `pij-vigz1i`) flips from co-implementer to **reviewer**. Split **Full / 2 phases by repo boundary**: **Phase 1** = all harness-engineering (CLI primitives + renderer chore-awareness + eng-harness-flow doctrine — the canonical wording); **Phase 2** = all the-flow (schema `observe` + real templates + expander + `harness-seams.md` mirroring Phase 1's wording verbatim). Peer reviews after.

## Business Specification

### Research Context

The flow shape is a near-constant program — research → plan → validate → **[phase block]** → ship, with reviews and harness chores at known positions — and the only thing unknown until the plan is written is the **phase count** (dossier Direction Update). The CLI already supports BYO templates (`create --template <path>`, F-09) and has no `flight-plan` seed today (F-10), so "pre-bake the flow" is a the-flow-repo change. The one real gap is mutation expressiveness: there is **no `remove-node` and `set-node` cannot re-parent** (F-11), and multi-node edits are N fragile ordered calls with a build-order wart (F-12/F-13). This plan closes that gap with a small set of **generic, roster-blind** primitives so an agent can *compute the shape and apply it once*.

### Summary

Deliver Route A end-to-end across both repos. **harness side (Phase 1):** give `harness flow` a complete, transactional, idempotent set of **generic node-mutation primitives** — a batch `apply` (one DAG-check, one write, forward-refs resolve at end), `upsert` semantics (dedup on key; never resurrect a terminal node), and the missing `remove-node` / `mv-node` — plus a **renderer that surfaces chores** (derive `:::chore` from the chore *flag* not the node type, and surface due chores in the one-line rail). **the-flow side (Phase 2):** author the real **harness-agnostic flight-plan template** (Simple 1-phase complete at `create`), the **plan-complete additive expander** (one purely-additive `apply` batch — each new phase brings its own boot+observe+drain chores, nothing relocates, no `mv`), the **`observe` seam** (new schema nodeType + per-phase additive chore model + drain/harvest retro labels), and the `harness-seams.md` doctrine. The CLI stays roster-blind — the SDD-aware agent computes the ops; the CLI applies a list of dumb node mutations. The the-flow agent reviews; we implement both phases.

### Goals

- An agent can express any flight-plan change as **one transactional `apply`** instead of orchestrating ordered single mutations — atomic, idempotent, build-order-free.
- The flight plan can be **instantiated near-complete from a real template** (whole journey visible at create) and **expanded additively** when the phase count is known — both authored in this plan.
- The mutation surface is **complete**: add, edit, status, **remove**, **re-parent (mv)**, **upsert** — so neither the template nor reconcile is forced into additive-only contortions.
- **Chores are visible**: the renderer distinguishes a chore-flagged node from a plain one (flag-driven, not type-driven) and surfaces what's due at the cursor — so the anti-skip mechanism is legible, not just data-layer.
- **`observe` becomes a tracked seam**: a per-phase observe chore (fills the buffer) paired with the phase-end **drain** retro (empties it) and a single ship **harvest** — closing the "agents don't record observations" gap by giving it a structural anchor.
- Every new verb is **generic + roster-blind** (no SDD parsing); the CLI remains the single writer; existing verbs/output are unaffected.

### Non-Goals

- **No SDD-aware verbs** in the CLI — no "expand phases" or phase-counting logic; the agent computes ops (hard line). (The expander logic is the-flow's, authored in Phase 2; the CLI stays roster-blind.)
- **No spawn-on-read** / `provenance.reconcile_hook` / watch-set / reentrancy guard (the dropped v1 mechanism).
- Not removing or changing the existing single-op verbs (`add-node`/`insert-node`/`set-node`/`status`).
- **No `expand` nodeType** — expansion is triggered structurally by the `plan` node completing (the plan-complete seam); the schema is *not* extended for it. (`observe` **is** added — it is a real recurring activity, not a one-shot trigger.)
- We do **not** rewrite the peer's review judgement — the peer reviews the finished work; this plan implements it.

### Target Domains

> No `docs/domains/` registry exists; domains declared inline (G7 scoped accordingly).

| Domain | Status | Relationship | Phase | Role in This Feature |
|--------|--------|--------------|-------|----------------------|
| harness flow CLI (primitives) | existing | **modify** | P1 | Add `apply` (batch/transactional), `remove-node`, `mv-node`, and `upsert` semantics; all generic + roster-blind |
| harness flow CLI (renderer) | existing | **modify** | P1 | Derive `:::chore` from the chore *flag* (not node type); surface due chores in the one-line rail at the cursor |
| eng-harness-flow doctrine (this repo) | existing | **modify** | P1 | SKILL.md: R-1 create/lifecycle split for the template/expander model; D5; **observe-gets-a-chore** + drain/harvest — the **canonical wording** Phase 2 mirrors |
| the-flow schema (peer repo, we author) | external | **modify** | P2 | `flight-plan.schema.json`: add `observe` to `nodeTypes` |
| the-flow template + expander (peer repo, we author) | external | **modify** | P2 | Real harness-agnostic `flight-plan.template.json` (Simple complete-at-create) + purely-additive plan-complete expander (`apply` batch, per-phase chores, no `mv`) + per-phase observe chore + drain/harvest labels + every-entry idempotent invocation |
| the-flow `harness-seams.md` (peer repo, we author) | external | **modify** | P2 | Three-part-creation + observe + drain/harvest doctrine, **verbatim-identical** to Phase 1's SKILL.md |

### Testing Strategy

- **Approach**: Full TDD. Transactional atomicity, idempotency, the D5 terminal guard, and DAG-rewire correctness are written test-first.
- **Rationale**: these are graph-mutation invariants where a wrong edge or a non-atomic partial write is silently corrupting.
- **Focus Areas**: apply atomicity (all-or-nothing), forward-ref resolution, upsert idempotency/no-op, D5 (no terminal resurrection), remove/mv rewire + DAG-recheck, back-compat of existing verbs, **renderer chore-class derivation (flag- not type-driven) + rail due-chore surfacing**.
- **Phase 2 (the-flow)**: the schema/template/expander are markdown+JSON artifacts authored to the contract Phase 1's primitives + the scratch prototype already proved; verified by `harness flow create … --template … --schema …` + `render` round-trips (as the prototype did) and the peer's review — not a separate unit-test suite.
- **Mock Usage**: Avoid mocks — fakes only (`FakeFs`/`FakeClock`/…); reuse the existing `flow-mutations` test harness.

### Documentation Strategy

- **Location**: No new docs. The verb help text + the eng-harness-flow SKILL.md / harness-seams.md (peer) doctrine edits are the documentation.

### Complexity

- **Score**: CS-3 (moderate — two repos, two phases, a renderer change, and authored doctrine, though each part is individually small and proven by the prototype)
- **Breakdown**: S=2 (two repos/skills), I=1, D=1 (graph mutation), N=1, F=0, T=1 (sum 6)
- **Confidence**: 0.74
- **Assumptions**: `insertNode`/`setNode`/`dagIssue` logic is reusable inside `apply`; the tolerant schema round-trips an unchanged node shape; the renderer's node-class step is the single place to make chore-awareness flag-driven; the scratch prototype's template/schema shapes carry to the real artifacts.
- **Dependencies**: the-flow source tree at `~/github/tools` is editable here (Phase 2); the prototype in `scratch/039-starter-template/` is the reference shape.
- **Risks**: transactional-write correctness; D5 across all op kinds; cross-repo doctrine drift between SKILL.md (P1) and harness-seams.md (P2); renderer back-compat.
- **Phases**: 2 (Full) — P1 harness-engineering, P2 the-flow.

### Acceptance Criteria

- **AC-01** (atomic batch) — `apply` takes a list of ops (`add`/`insert`/`set`/`remove`/`mv`/`upsert`) from `--ops <file>` **or stdin (`--ops -`)**, validates the **final** DAG once, and writes **once**; if any op is invalid or the final graph has a cycle/orphan, **nothing** is written (all-or-nothing, `E309`-class). A **fully-no-op batch writes nothing and is byte-identical** (no `modified_at` bump, no event) — see AC-03.
- **AC-02** (forward-refs, two-phase apply) — within one `apply` batch an op may reference a node **created later in the same batch**. Resolution is **two-phase**: (1) materialize all node creates/`upsert`s into the working graph, (2) apply edge-positioning ops (`insert` placements, `mv` re-parents) against that complete node set, (3) validate the final DAG **once**. So ordering within a batch is irrelevant and the build-order wart is gone; a reference to a node that exists in *neither* the base graph nor the batch's creates is the only ref error.
- **AC-03** (idempotency, byte-stable) — an `upsert` op: inserts if absent, **shallow-merges** if present, and is a **no-op if identical** (no event, no `modified_at` restamp); dedup on node `id` (or a declared key). **Byte-stability extends to the whole apply**: (a) phase-2 edge-wiring is a **no-op when the edge already matches** (no duplicate edge, no event); (b) a batch whose every op is a no-op leaves the file **byte-identical** (no top-level `modified_at` bump). *(This is what lets an idempotent expander be re-invoked safely — P1/P3 — without thrashing edges or churning the file.)*
- **AC-04** (D5 terminal guard, batch-wide) — **no** op (`upsert`/`set`/`mv`/`remove`) silently flips a `done`/`skipped` node's status back to `todo`; `remove`/`mv` of a terminal node requires explicit intent (a flag) or is refused with an honest diagnostic. **The guard is batch-wide, not per-op**: a terminal node's id cannot be *laundered* by `remove`-then-re-`add`/`upsert` of the same id within one batch — the apply tracks terminal ids across the whole batch and either preserves the terminal status on re-add or refuses the batch. (Without this, the remove+re-add pair resurrects a `done` node — the exact failure D5 exists to stop.)
- **AC-05** (remove-node) — `remove-node` deletes a node and **rewires predecessors→successors** so no orphan/dangling edge remains; DAG-rechecked; a removal that would break the graph is refused (`E309`-class), nothing written.
- **AC-06** (mv-node) — `mv-node` re-parents a node (`--after`/`--before`/`--branch-of`) + rewires; DAG-rechecked; **cannot create a cycle** (refused if it would).
- **AC-07** (roster-blind) — every new verb operates only on **generic node ops the caller supplies**; none read or parse SDD markdown (Phase Index / workshops).
- **AC-08** (back-compat) — existing verbs (`add-node`/`insert-node`/`set-node`/`status`) are **unchanged**; the new verbs are additive; no `schema_version` bump (node shape unchanged). *(Renderer output changes only in the chore-aware way AC-11 specifies — a node with no chore flag renders byte-identically to today.)*
- **AC-11** (renderer chore-awareness — Phase 1) — `render` derives a node's `:::chore` class from the presence of the **chore flag**, not from the node `type`: a chore-flagged `harness-retro`/`harness-boot`/`backpressure`/`observe` node renders `:::chore`, an un-flagged one of the same type renders as today (`:::harness` etc.). The one-line **rail** surfaces the chores **due at the cursor** (the `due_chores` read) so "what's due here" is visible without opening the diagram. A node carrying no chore flag is byte-identical to today's render (AC-08). *(Closes the prototype finding: today `harness-retro-2` (a chore) and `harness-retro-1` (plain) render identically.)*
- **AC-12** (observe seam + per-phase chore model — Phase 2) — the-flow's `flight-plan.schema.json` gains **`observe`** in `nodeTypes`. The harness chores follow a **per-phase additive** model (Jordan, 2026-06-28): **each phase** carries its own three chores — **boot** (`harness-boot`, pre-flight), **observe** (`observe`, `kind: command`, `importance: recommended`, command `harness observe "<what>" --kind <kind>`), and **drain** (`harness-retro` `(drain)`, post-coding) — plus **two global** chores: **backpressure** (`pre-coding`, off `plan`) and **ship harvest** (`harness-retro` `(harvest)`, post-flight, off `ship`). The observe chore surfaces in `due_chores` the whole time `nav.now` sits on its phase; its lifecycle terminal is that phase's **drain**. `(drain)` vs `(harvest)` is one `harness-retro` type disambiguated by hook (no new retro type). *(Per-phase additive means **every** phase's hooks are tracked — the most faithful anti-skip — and expansion is purely additive, so **no `mv` at expansion**. Closes the "agents don't record observations" gap; proven in `scratch/039-starter-template/`.)*
- **AC-13** (real template + expander, purely additive — Phase 2) — author the real, pre-authored, **harness-agnostic** **`flight-plan.template.json`** (a fresh Simple flow `research → plan → phase-1 → ship` **complete at `create`**; **no harness chores baked in**) and the **plan-complete additive expander**: for N>1 phases, ONE `apply` batch splices `phase-2..N` after `phase-1`, **each new phase carrying its own boot+observe+drain chores** — **purely additive, nothing relocates, no `mv`**. Harness chores (per-phase trio + the two globals) are laid by a **create-time conditional apply gated on router-installed-AND-provisioned** (AC-09 part 2; T020), so a no-harness repo gets none. The expander is **byte-stable idempotent** (AC-03) so the every-entry invocation (AC-10) no-ops on a complete spine. Verified by `create … --template … --schema …` + `render` round-trips (as the prototype did).
- **AC-14** (chore/seam execution discipline — both skills + the-flow engine refs) — a runnable harness chore/seam is **satisfied only by actually invoking the `/eng-harness-flow` skill** through the host's skill mechanism (the **Skill tool** in Claude Code; the equivalent slash-command invocation elsewhere) with the node's exact `--hook` — **never** by narrating it, reimplementing the check inline, or flipping the node to `done` without a real invocation. The router envelope is narrated **verbatim from that real call** (invariant #5 — never fabricate). Declining is allowed and means marking the chore **`skipped`** (honest), **never** a fake `done`. For `observe`, the equivalent is actually running `harness observe "<what>" …` (a real capture), not narrating one. This is stated **identically** in eng-harness-flow `SKILL.md` (T012) and the the-flow engine refs `00-routing.md`/`coach.md`/`harness-seams.md` (T017/T019). *(Closes the gap: today the refs say "fire / print-then-offer the literal `/eng-harness-flow --hook …` command" but never pin "actually invoke the skill via the Skill tool, don't narrate" — so an agent can drift into faking the seam. This is the doctrine that turns "agent guesses" into "run the exact command, or honestly skip.")*
- **AC-10** (every-entry guarantee, ruled KEEP — Phase 2; resolves Open Question P1) — the off-path entries (adopt-from-existing, plan-edited-after-pass, direct-jump-built) keep the "reconcile without a prompt" guarantee: the **byte-stable idempotent expander** (AC-03) is invoked at the structural entry points — **plan-complete + adopt + resume (phase-count/title mismatch check) + manual sync** — a cheap diff that no-ops on a complete spine; no spawn-on-read, no new state. *(the-flow entry routine — **Phase 2 (we author)**; load-bearing on AC-03 byte-stability. Honest scope: an entry-routine step — more robust than the superseded `f9a86f1` prose beat because it's baked into the adopt/resume code-path and is one deterministic command, but best-effort, not CLI-mechanical.)*
- **AC-09** (template path, cross-repo — three-part creation, harness-gated) — creation is **three** parts, not "template incl. chores + expander": (1) a **pre-authored, static, harness-agnostic** template skeleton + the structural "expand" step — a fixed JSON seed shipped *with the the-flow skill* (e.g. `references/flight-plan.template.json`, BYO via `create --template`), authored + versioned by the peer, never generated; the CLI instantiates it verbatim and stamps root identity, (2) a **create-time CONDITIONAL chore apply** that lays the harness chores **only when the two-layer gate holds** (router INSTALLED *and* repo PROVISIONED) — a no-harness repo gets **no** harness chores, and (3) the plan-complete **additive** expander. A **Simple 1-phase flow is complete at `create`**; multiphase expansion is a **single additive `apply`** triggered structurally by the `plan` node completing (no remembered prose trigger, no `expand` nodeType). This three-part split is worded **identically** in `eng-harness-flow/SKILL.md` (Phase 1 — the canonical wording) and `harness-seams.md` (Phase 2 — mirrors it verbatim). *(We author both sides; AC-13 is the concrete template + expander that realizes part (1)+(3); the prototype in `scratch/039-starter-template/` is the reference.)*

### Risks & Assumptions

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Non-atomic partial write on a failing batch | Low | High | TDD AC-01: build the next doc in memory, DAG-check the final graph, write once or not at all |
| D5 missed on one op kind | Medium | High | AC-04 covers all four ops in one test matrix; terminal status is never an implicit transition |
| remove/mv orphan or cycle | Medium | High | Reuse `dagIssue()` re-check (the `insertNode` `E309` path) on the post-op graph |
| Doctrine drift between SKILL.md (P1) and harness-seams.md (P2) | Medium | Medium | P1 establishes the **canonical** wording; T017 mirrors it verbatim (`diff` must be empty); peer reviews parity in T018 |
| Renderer back-compat — chore-awareness changes existing output | Low | High | AC-08/AC-11: a node with **no** chore flag renders byte-identically to today; TDD T007 pins both the new chore class and the unchanged plain-node path |
| Chore-model conflict (exactly-4 vs no-`mv`) | — | — | RESOLVED per-phase additive (Q1) — expansion only adds, no `mv`, no peer ruling superseded |
| Over-building — primitives Route A doesn't need | Low | Medium | Scope is exactly the four (apply/upsert/remove/mv); additive expansion already works via `insert-node` (F-12), so these are ergonomics + completeness, kept minimal |

### Open Questions

- **Q1 — RESOLVED (Jordan, 2026-06-28): per-phase additive, the peer's "no `mv` at expansion" ruling stands.** The earlier "exactly 4 representative chores" framing conflicted with "no `mv`" for multiphase (a single *last-phase* retro chore would have to relocate as phases grow). Resolved by going **per-phase additive** (AC-12): every phase brings its own boot/observe/drain chores, so expansion only *adds* and **nothing relocates — no `mv` at expansion**. `remove`/`mv` remain built (AC-05/AC-06) but are load-bearing **only for the `sync` drift path** (deleted phase → `remove`; reordered/relocated node → `mv`), where batch-wide D5 refuses to launder a `done` node. No peer ruling is superseded.
- **Q2 — RESOLVED (peer)**: support **both** `--ops <file>` and stdin (`--ops -`); the expander uses stdin.
- **P5 note (peer-owned)**: workshop coverage is **not** the expander's job — the workshop verb emits its own excursion node at creation. The CLI primitives are workshop-agnostic.
- **P1 — RESOLVED (Jordan): KEEP** the every-entry guarantee via the byte-stable idempotent entry-invocation (AC-10). Phase 2 (we author — the-flow entry routine + CLAUDE.md).
- **the-flow SCHEMA — RESOLVED (Jordan/prototype, 2026-06-28)**: (a) **no `expand` nodeType** — expansion is triggered structurally by the `plan` node completing, so the descriptor is *not* extended for it; (b) **add `observe`** to `nodeTypes` — it is a real recurring activity (the `coding`/mid-phase capture seam) modelled as a per-phase chore, not a one-shot trigger, so it earns a first-class type (and already exists in the harness-*loop* overlay — consistent). Proven against a scratch schema copy with `observe` added (AC-12). Authored in Phase 2.
- **observe-as-chore — RESOLVED (Jordan, 2026-06-28)**: the `coding` seam, previously "gets no chore," now rides as a **per-phase observe chore** so it has a structural anchor (`due_chores`) instead of evaporating as remembered prose. The eng-harness-flow doctrine line "coding/observe gets no chore" inverts (Phase 1 SKILL.md); `improve` still gets none.

### Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| _none_ | — | The verb surface is grounded by the survey; Q1/Q2 settle in the peer review + implementation | — |

### Clarifications

#### Session 2026-06-28 (regeneration)
- **Direction** → Route A (pre-baked template + transactional generic primitives); v1 reconcile-on-read superseded (Jordan).
- **Workflow Mode** → Simple (Jordan; single phase). *(Superseded by the v3.0.0 re-plan below.)*
- **Testing / Mock / Docs** → carried forward unchanged: Full TDD · fakes only · no new docs.

#### Session 2026-06-28 (v3.0.0 re-plan — prototype-driven scope expansion)
- **Prototype** → hand-cranked a Simple starter seed + a Full expanded seed in `scratch/039-starter-template/`, instantiated + rendered through the real CLI (harness 0.6.0). Calibrated against a real fully-stacked plan (`SecondCrack/004-reality-owns-gravity`). Confirmed: BYO `--template`/`--schema` seam works; `assumed`+chore validates; `chores`/`due_chores` reads work.
- **Findings folded as ACs** → renderer keys chore-class on *type* not *flag* (AC-11); observe needs a structural anchor + a schema type (AC-12); the real harness-agnostic template + purely-additive expander (AC-13); chore-execution discipline / invoke-via-Skill-tool (AC-14).
- **Scope (Jordan)** → 039 **encompasses both repos and we implement all of it**; the the-flow agent (`pij-vigz1i`) becomes **reviewer**. **Mode → Full, 2 phases by repo boundary** (P1 harness-engineering = canonical doctrine wording; P2 the-flow mirrors it).
- **observe seam (Jordan)** → `observe` is a per-phase chore; per-phase retro = **drain**, ship retro = **harvest**.
- **Testing / Mock / Docs** → Full TDD (Phase 1) · fakes only · no new docs (verb help + skill doctrine are the docs).

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none.

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md (+ Direction Update + verb survey) | y | informs the whole Route A design + Key Findings |
| workshops/*.md | n | — |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No critical markers; Q1/Q2 are non-blocking (peer review + impl detail) |
| G2 | Constitution | PASS | P2 (Ports & Adapters), P3 (fakes), P4 (CLI is the API — verbs + stable output), P5/P7 (honest refusals on invalid ops) |
| G3 | Architecture | PASS | Reuses `flow-mutations` + `dagIssue`; no SDD parsing in CLI (roster-blind); single writer |
| G4 | ADR Compliance | N/A | No `docs/adr/` |
| G5 | Structure | PASS | All required Full-mode sections present; 2 phases by repo boundary |
| G6 | Testing Alignment | PASS | TDD (Phase 1): test tasks T001–T007 precede impl T008–T012; ACs measurable; Phase 2 verified by create+render round-trip + peer review |
| G7 | Domain Completeness | PASS (scoped) | No registry; domains inline; Domain Manifest covers every file in the task table |

### Summary

**Phase 1 (harness-engineering):** add a complete, transactional, idempotent set of **generic node primitives** to `harness flow` — a batch `apply` (final-DAG-validate-once, atomic write, forward-refs resolve at end), `upsert` (dedup on key; never resurrect a terminal node — D5), and the missing `remove-node` / `mv-node` (rewire + DAG-recheck) — plus a **chore-aware renderer** (flag-driven `:::chore` + rail due-chore surfacing). Restate the eng-harness-flow R-1 doctrine (incl. observe-gets-a-chore + drain/harvest) as the canonical wording. **Phase 2 (the-flow):** author the real template + plan-complete expander, the `observe` schema/seam, and `harness-seams.md` mirroring Phase 1's wording. The CLI stays roster-blind and the single writer throughout; the peer reviews.

### Domain Manifest

| File | Domain | Phase | Classification | Rationale |
|------|--------|-------|----------------|-----------|
| `harness/cli/src/acts/flow.ts` | harness flow CLI | P1 | contract | Register `apply`, `remove-node`, `mv-node` commands |
| `harness/cli/src/services/flow/flow-mutations.ts` | harness flow CLI | P1 | internal | `applyBatch`, `removeNode`, `mvNode`, `upsert` semantics; reuse `insertNode`/`setNode`/`dagIssue` |
| `harness/cli/src/services/flow/*render*.ts` | harness flow CLI | P1 | internal | Chore-class derived from the chore flag (not type); rail surfaces `due_chores` at the cursor (AC-11) |
| `harness/cli/test/services/flow/*` | harness flow CLI | P1 | internal | TDD specs: atomicity, forward-ref, upsert idempotency, D5, remove/mv rewire, back-compat, renderer chore-awareness |
| `~/.claude/skills/eng-harness-flow/SKILL.md` (+ `~/github/tools` deploy source) | eng-harness-flow doctrine | P1 | contract | R-1 create/lifecycle split; D5; observe-gets-a-chore + drain/harvest — **canonical wording** |
| `~/github/tools/.../the-flow/references/flight-plan.schema.json` | the-flow schema | P2 | contract | Add `observe` to `nodeTypes` (AC-12) |
| `~/github/tools/.../the-flow/references/flight-plan.template.json` | the-flow template | P2 | contract | Real pre-authored Simple starter; per-phase observe chore; drain/harvest labels (AC-13) |
| `~/github/tools/.../the-flow/references/*expander* + 00-routing.md` | the-flow expander/entry | P2 | internal | Plan-complete purely-additive `apply` batch (per-phase chores, no `mv`); every-entry idempotent invocation (AC-10/AC-13) |
| `~/github/tools/.../the-flow/references/harness-seams.md` | the-flow doctrine | P2 | contract | Three-part creation + observe + drain/harvest, **verbatim-identical** to Phase 1 SKILL.md |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | `--template <path>` BYO create-seed already exists; no `flight-plan` seed today (F-09/F-10) | The template is a the-flow-repo JSON artifact (no CLI code) — but **we author it in Phase 2** (T014), proven by the scratch prototype's create+render round-trip; the CLI adds the mutation primitives + renderer (Phase 1) |
| 02 | High | No `remove-node`; `set-node` can't re-parent (F-11) | Add `remove-node` + `mv-node` so mutation is complete (the one real gap) |
| 03 | High | `insertNode`/`setNode`/`dagIssue` + the `E309` re-check already exist (F-06/F-12) | `apply`/`remove`/`mv` **reuse** them — no new graph engine |
| 04 | High | Build-order wart: `--next` targets must pre-exist (F-13) | `apply` validates the **final** graph once → forward refs resolve, ordering stops mattering (AC-02) |
| 05 | High | D5 (never resurrect a `done` node) binds every mutation, not just reconcile | One terminal-guard rule applied across `upsert`/`set`/`mv`/`remove` (AC-04) |

### Implementation

**Objective (Phase 1)**: Add the four generic, roster-blind node primitives (`apply` batch, `upsert`, `remove-node`, `mv-node`) + the chore-aware renderer (AC-11), plus the eng-harness-flow R-1 doctrine restatement (the canonical wording). **Objective (Phase 2)**: author the real template, the plan-complete additive expander, the `observe` schema/seam, the every-entry idempotent invocation, and `harness-seams.md` (verbatim-mirror of Phase 1's SKILL.md) — all in the the-flow source at `~/github/tools`. We implement both phases; the the-flow agent reviews (T018).

**Testing Approach**: Full TDD, fakes only; reuse the `flow-mutations` test harness. Test tasks precede impl.

#### Tasks

**Phase 1 — harness-engineering (CLI primitives + renderer + canonical doctrine). Full TDD; test tasks precede impl.**

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T001 | TEST: `apply` atomicity — a batch with any invalid op / cycle / orphan writes **nothing**; a valid batch applies all ops in **one** write | harness flow CLI | `test/services/flow/` | Failing test pins AC-01 | Finding 03 |
| [ ] | T002 | TEST: `apply` forward-ref — an op references a node created later in the same batch → resolves against the final graph | harness flow CLI | `test/services/flow/` | Failing test pins AC-02 | Finding 04 |
| [ ] | T003 | TEST: idempotency byte-stable — `upsert` absent→insert / present→merge / identical→no-op; **phase-2 edge-wiring no-ops on a matching edge**; **a fully-no-op batch leaves the file byte-identical** (no `modified_at` bump) | harness flow CLI | `test/services/flow/` | Failing test pins AC-03 (incl. edge no-op + byte-stable batch) | Finding 03; P3 |
| [ ] | T004 | TEST: D5 terminal guard (batch-wide) — `upsert`/`set`/`mv`/`remove` never flip a `done`/`skipped` node to `todo`; remove/mv of a terminal refused without an explicit flag; **`remove`-then-re-`add` of the same terminal id in one batch cannot resurrect it** | harness flow CLI | `test/services/flow/` | Failing test pins AC-04 incl. the batch-laundering case | Finding 05; F2 |
| [ ] | T005 | TEST: `remove-node` rewire — predecessors→successors rejoined, no orphan; graph-breaking removal refused (`E309`-class) | harness flow CLI | `test/services/flow/` | Failing test pins AC-05 | Finding 02 |
| [ ] | T006 | TEST: `mv-node` re-parent — new `--after`/`--before`/`--branch-of` + rewire; cycle refused | harness flow CLI | `test/services/flow/` | Failing test pins AC-06 | Finding 02 |
| [ ] | T007 | TEST: renderer chore-awareness — a **chore-flagged** `harness-retro`/`observe`/etc. renders `:::chore`; the same type **without** a flag renders as today (byte-identical, AC-08); the **rail surfaces `due_chores` at the cursor** | harness flow CLI | `test/services/flow/` | Failing test pins AC-11 (incl. the chore vs plain `harness-retro` pair from the prototype) | AC-11; prototype finding |
| [ ] | T008 | IMPL: `applyBatch` — parse an ops list (`--ops <file>`/stdin), apply in-memory **two-phase** (materialize node creates/upserts → wire edge positions → validate final DAG once), atomic single write; op kinds add/insert/set/remove/mv/upsert; reuse pure `insertNode`/`setNode`/`dagIssue` | harness flow CLI | `flow-mutations.ts`, `acts/flow.ts` | T001/T002 green; one write or none | Findings 03/04; F1 |
| [ ] | T009 | IMPL: `removeNode` + `mvNode` (standalone verbs + as `apply` op kinds); rewire + `dagIssue` re-check | harness flow CLI | `flow-mutations.ts`, `acts/flow.ts` | T005/T006 green; existing verbs unchanged (AC-08) | Finding 02 |
| [ ] | T010 | IMPL: `upsert` semantics + the D5 terminal guard applied across all mutating ops | harness flow CLI | `flow-mutations.ts` | T003/T004 green | Finding 05 |
| [ ] | T011 | IMPL: renderer chore-awareness — node-class step derives `:::chore` from the chore flag (not type); rail renders due chores at the cursor; a no-chore node is byte-identical to today | harness flow CLI | `*render*.ts`, `acts/flow.ts` | T007 green; AC-08 back-compat holds | AC-11 |
| [ ] | T012 | IMPL(doctrine, **canonical**): eng-harness-flow `SKILL.md` — R-1 create/lifecycle for the template/expander model: creation = **three parts** (harness-agnostic skeleton · harness-gated create-time chore apply [installed AND provisioned] · plan-complete additive expander, triggered structurally by plan-complete, no `expand` type); lifecycle = eng-harness-flow; D5; **observe-gets-a-chore** (the "coding gets no chore" line inverts) + **drain/harvest** retro labels; **AC-14 chore-execution discipline** (invoke `/eng-harness-flow` via the Skill tool — never narrate/fake; decline = `skipped`); supersede v1 reconcile-on-read + `f9a86f1` | eng-harness-flow doctrine | `SKILL.md` (+ `~/github/tools` source) | This is the **canonical wording** Phase 2 mirrors | AC-04/AC-09/AC-12/AC-14; P2/P5 |

**Phase 2 — the-flow (we author; the-flow agent reviews). Verified by `create … --template … --schema …` + `render` round-trips (as the prototype) + peer review.**

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T013 | IMPL: the-flow `flight-plan.schema.json` — add **`observe`** to `nodeTypes`; descriptor note explains the per-phase observe chore + drain/harvest | the-flow schema | `~/github/tools/.../flight-plan.schema.json` | `create` validates a template carrying `observe` (AC-12) | Schema RESOLVED |
| [ ] | T014 | IMPL: the-flow real **harness-agnostic** `flight-plan.template.json` — fresh Simple flow `research → plan → phase-1 → ship` **complete at create**, **no harness chores baked in**; port + finalize the spine shape from `scratch/039-starter-template/` | the-flow template | `~/github/tools/.../flight-plan.template.json` | `create` + `render` round-trip matches the prototype spine | AC-13; AC-09(1) |
| [ ] | T015 | IMPL: the-flow **plan-complete expander** — emits ONE **purely additive** `apply` batch (stdin) splicing `phase-2..N` after `phase-1`, **each new phase carrying its own boot+observe+drain chores**; **nothing relocates, no `mv`**; **byte-stable idempotent** (no-ops on a complete spine) | the-flow expander | `~/github/tools/.../` (expander routine) | Expanding a 2-phase plan reproduces the `the-flow.expanded` shape; re-run is a byte-stable no-op | AC-13; AC-12; AC-03 |
| [ ] | T016 | IMPL: the-flow **every-entry idempotent invocation** (AC-10) — the byte-stable expander fires at plan-complete + adopt + resume (phase-count/title mismatch) + manual sync; keep the CLAUDE.md every-entry requirement | the-flow entry routine | `~/github/tools/.../00-routing.md`, CLAUDE.md | Off-path entry reconciles without a prompt; no-ops on a complete spine | AC-10; P1 |
| [ ] | T017 | IMPL: the-flow `harness-seams.md` — three-part creation + observe-gets-a-chore + drain/harvest + **AC-14 chore-execution discipline**, **verbatim-identical** to Phase 1's SKILL.md (T012) | the-flow doctrine | `~/github/tools/.../harness-seams.md` | `diff` of the shared doctrine block vs SKILL.md is empty | AC-09; AC-14; T012 |
| [ ] | T019 | IMPL: harden the-flow engine refs (`00-routing.md`, `coach.md`) for **AC-14** — a runnable harness chore/seam is satisfied by **actually invoking the `/eng-harness-flow` skill via the Skill tool** (not narrating / not reimplementing); envelope narrated verbatim from the real call; decline = `skipped`, never fake `done` | the-flow engine refs | `~/github/tools/.../00-routing.md`, `coach.md` | The "fire the router call" beats explicitly say *invoke the skill*, not *print the command* | AC-14 |
| [ ] | T020 | IMPL: the-flow **create-time conditional chore apply** — lays the per-phase boot+observe+drain chores + the two globals via an `apply` batch **only when the gate holds (router installed AND repo provisioned)**; a no-harness repo gets none (the template stays harness-agnostic) | the-flow create routine | `~/github/tools/.../harness-seams.md`, create routine | No-harness repo: zero harness chores; harnessed repo: full per-phase trio + globals | AC-09(2); AC-12 |
| [ ] | T018 | REVIEW(hand-off, **plan-now**): the-flow agent (`pij-vigz1i`) reviews the **v3.0.0 plan** before build — scope expansion, per-phase additive chore model, AC-11/12/13/14, doctrine parity, the harness-agnostic-template + conditional-apply split | external | peer repo + this plan | Peer review returned + findings addressed before implementation begins | Cross-repo review of the plan, not co-impl |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T001, T008 | apply atomicity test |
| AC-02 | T002, T008 | forward-ref test |
| AC-03 | T003, T010, T015 | upsert idempotency + expander byte-stability |
| AC-04 | T004, T010 | D5 terminal-guard matrix |
| AC-05 | T005, T009 | remove-node rewire test (load-bearing for `sync` drift, not expansion) |
| AC-06 | T006, T009 | mv-node re-parent test (load-bearing for `sync` drift, not expansion) |
| AC-07 | T008–T011 | (roster-blind: ops are generic; no SDD read in any test path) |
| AC-08 | T009, T011 | existing-verb + renderer back-compat (no-chore node byte-identical) |
| AC-09 | T012, T014, T017, T020 | harness-agnostic template + conditional apply + doctrine parity |
| AC-10 | T016, T018 | every-entry idempotent invocation + peer review |
| AC-11 | T007, T011 | renderer chore-awareness (flag-driven `:::chore` + rail due-chores) |
| AC-12 | T013, T014, T015, T020 | `observe` schema type + per-phase additive chore model round-trip |
| AC-13 | T014, T015, T018 | harness-agnostic template + additive expander create/render round-trips |
| AC-14 | T012, T017, T019 | chore-execution discipline (invoke-via-Skill-tool, doctrine parity P1↔P2) |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Non-atomic partial write | Low | High | In-memory build + final DAG-check + single write (AC-01) |
| D5 missed on one op | Medium | High | One guard, tested across all four ops (AC-04) |
| remove/mv orphan or cycle | Medium | High | Reuse `dagIssue()` `E309` re-check (AC-05/06) |
| Renderer breaks existing output | Low | High | No-chore node byte-identical (AC-08/AC-11, T007) |
| Doctrine drift P1↔P2 | Medium | Medium | Canonical SKILL.md (T012) mirrored verbatim by harness-seams.md (T017); peer review (T018) |
| Over-building | Low | Medium | Scope fixed at the four primitives + renderer; additive expansion already works via `insert-node` |
