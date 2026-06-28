# Research Dossier: CLI-triggered spine-reconcile + R-1 creation/lifecycle split (chore pre-population)

**Generated**: 2026-06-28T00:00:00Z
**Query**: "Sync/chore-prepopulation fix: the four eng-harness-flow hook chores are not pre-populated up front; the cheap prose cadence-step trigger (the-flow f9a86f1) is empirically dead (3 live skips); the chore-prepopulation gap is structural. Design: ONE CLI provenance field + ONE nav-run hook slot (roster-blind), R-1 split (creation→bundled reconcile executable, lifecycle→eng-harness-flow)."
**Effort**: Standard
**Tools**: Standard
**Evidence**: 8 current sources · 1 reported-runtime source

## Answer

1. **The trigger is the failure, not the computation.** The shipped fix (the-flow `f9a86f1`) made spine-reconcile a Tier-1 "run-now" cadence *step described in skill prose*. Prose steps are LLM-driven and skip under load or when a user "report/compact" instruction preempts the next guided entry — observed **3× live** (pij-5lztp8, pij-65z136 ×2). A durable fix must move the **trigger** onto a call the engine cannot skip; the SDD-aware **computation** can stay where it is (in the skill) as long as it is made deterministic.

2. **The chore-prepopulation gap is structural, owned by R-1.** Today `eng-harness-flow` is the single creator of the chore flag (harness-seams.md:96; flight-plan-ops.md:135), but it only runs *at the seam edge it is currently firing*. It can flag the node at the current edge — it can never lay the **whole 4-hook roster ahead**. So even a perfect node-level sync leaves the chores un-created until each edge is reached. That is exactly the "I keep having to tell agents to sync" symptom.

3. **The CLI can own the trigger without learning SDD.** `harness flow nav` is the unavoidable read every guided turn makes (acts/flow.ts:248; navShow flow-mutations.ts:167). A registered-hook execution slot on that read — running a configured command path recorded in `provenance.reconcile_hook` — gives a mechanical, unskippable trigger while the CLI stays **roster-blind** (it executes an opaque command; it never parses Phase Index / workshops).

4. **`navShow` is a pure read function — the hook slot belongs in the act layer, not the pure core.** navShow (flow-mutations.ts:167–178) does no IO. The execution slot, reentrancy guard, and mtime-cache must live in the act wrapper (acts/flow.ts:248–262), which already does IO (reads the doc, emits). The `ExecPort` subprocess pattern already exists (adapters/exec/node-exec.ts) but is **not yet wired into flow** — it would be injected into the flow act.

5. **The CLI work is genuinely "one field + one slot".** Provenance is a flat 7-key record (provenance.ts:18–33) constructed at create (flow-service.ts:280–292); adding `reconcile_hook` is one field. The flight-plan schema is tolerant (no `additionalProperties:false`; provenance isn't even schema-enumerated) so the field round-trips with **no schema break** — only the TS type + the create-stamp change.

6. **R-1 splits cleanly along create-vs-lifecycle.** Chore *creation* (the 4 hooks exist, `todo`, at their 4 fixed anchors, dedup on the `--hook` token) is structural + deterministic and moves to the bundled reconcile executable. Chore *lifecycle* (`todo→done/skipped` + the routing decision to fire the action) stays with `eng-harness-flow`. The two never corrupt each other: create is idempotent (dedup key; set-node no-ops when matching — flight-plan-ops.md:125–131), both go through the single-writer CLI, and they touch different fields at different times.

7. **The reconcile executable is the peer's (tools repo) to build; this plan owns the CLI seam + my doctrine.** The deterministic script (parse Phase Index + workshops → canonical shape = full spine + 4 hook chores → diff `the-flow.json` → backfill via `harness flow`) ships *with the the-flow skill*. This plan captures it as a **cross-repo dependency with explicit ownership**, plus the matched doctrine edits that must agree across both repos.

## Direction Update (2026-06-28) — Route A supersedes reconcile-on-read

> The Answer above diagnoses the problem correctly but its *mechanism* (a reconcile **hook spawned on every `nav` read**: `provenance.reconcile_hook`/`reconcile_watch`, the nav-read execution slot, the watch-set/watermark pre-gate, the reentrancy guard) is **superseded**. A verb-surface survey found a simpler answer that needs **no spawn-on-read** at all. The plan is regenerated around it.

**Route A — pre-bake the flow as a near-complete template, then expand it transactionally.** The flow shape is a near-constant program — research → plan → validate → **[phase block]** → ship, with every review and harness chore already placed — and the *only* unknown until the plan is written is the **phase count**. So:

1. **the-flow BYOs a near-complete flight-plan *template*** (it already BYOs the schema) and instantiates it at `create` via the existing `--template <path>` flag. The Simple (1-phase) case is then **complete at create** — nothing further runs.
2. **At plan-complete, one transactional `apply`** expands the single phase-placeholder into N phases and adds each phase's review + post-coding chore (purely **additive**). The expansion is computed by the SDD-aware agent and handed to the CLI as a **list of generic node ops** — the CLI stays roster-blind.
3. **The expand step is itself a structural node on the rail** (a due item after `validate`), so the trigger is *visible/structural*, not remembered prose.
4. Ad-hoc mid-flow drift (a workshop added at a random moment) is caught by the **existing on-demand `/the-flow sync` verb** — not by a continuous on-read engine.

**What survives from the original design** (mechanism-independent invariants): the **diagnosis** (prose trigger is dead; chores must be pre-populated); the **roster-blind CLI hard line**; the **R-1 create/lifecycle split** (creation = reconcile/expander, lifecycle = `eng-harness-flow`); **D5** (never resurrect a `done` node — now binds `apply`/`upsert`/`mv`); the cross-repo doctrine coordination.

**What is dropped** (existed only to serve spawn-on-read): `provenance.reconcile_hook`/`reconcile_watch`, the nav-read execution slot, the D1 watch-set/watermark pre-gate, the D6 reentrancy guard, and findings C1/C3/F3/F4 (all watch/spawn-specific).

**New CLI work Route A wants** (small, generic, roster-blind primitives — not SDD-aware verbs): `remove-node`, `mv-node` (re-parent), a **transactional `apply`** (list of ops, one DAG-check, one write — also kills the build-order wart), and **idempotent `upsert`** semantics (dedup on a stable key; never resurrect `done`). The agent computes ops; the CLI applies them.

## Evidence

| ID | Finding | Evidence | Planning implication | Confidence |
|----|---------|----------|----------------------|------------|
| F-01 | `provenance` is a flat record built at create — 7 keys, no reconcile field | `harness/cli/src/services/record/provenance.ts:18-33`; `harness/cli/src/services/flow/flow-service.ts:280-292` | Add `reconcile_hook?: string \| null` to the type + stamp it in `createFlow`; one localized change | High |
| F-02 | Flight-plan schema is hand-rolled + tolerant; provenance not enumerated, no `additionalProperties:false` | `harness/cli/src/services/flow/schemas/flow.schema.json`; validator `flow-schema.ts:220-345` | New provenance field round-trips with **no schema change**; optional: document it for clarity | High |
| F-03 | `harness flow nav show` act reads doc → `navShow` → emits; this is the unavoidable per-turn read | `harness/cli/src/acts/flow.ts:248-262` | The act is where the registered-hook slot goes (it already does IO) | High |
| F-04 | `navShow` is a **pure** function (no IO, no clock, no mutation) | `harness/cli/src/services/flow/flow-mutations.ts:167-178` | Keep navShow pure; the hook/guard/cache live in the act, not the core — clean seam | High |
| F-05 | A subprocess port (`ExecPort` via `spawn`) exists but is **not** wired into the flow service | `harness/cli/src/adapters/exec/node-exec.ts:1-47` (used by skills.ts/verb.ts) | Inject existing `ExecPort` into the flow act to run the registered hook — no new adapter | High |
| F-06 | Chore model: create via `insert-node`/`add-node --chore-kind --importance --command`; flag-in-place via `set-node` (added plan 032); dedup on `--hook` token; `set-node` no-ops when fields already match | `flow-mutations.ts:210-244` (listChores/dueChores), `:445-482` (setNode idempotent no-op), `:590-698` (insertNode DAG re-check `E309`); flight-plan-ops.md:88-89,125-131 | Reconcile creates/flags via these existing verbs; idempotency is already guaranteed by the CLI — reconcile inherits byte-stable re-runs | High |
| F-07 | Canonical chore shape is fixed + total: 4 hooks at 4 anchors via a deterministic hook→anchor fallback map | `eng-harness-flow/references/flight-plan-ops.md:101-160` | Reconcile's target shape is fully specified already — the spec exists, it just isn't enforced by a mechanism | High |
| F-08 | R-1 today: `eng-harness-flow` is the **single owner of the chore flag**; reconcile "emits seam nodes only … never sets a chore flag" | `the-flow/references/harness-seams.md:96-112` | This is the exact line the create/lifecycle split rewrites; doctrine edit must land in both repos and agree | High |
| F-09 | **`create <type> --template <path>` already supports a BYO create-seed override** ("may be out-of-repo"); `--bare` = root-only | `harness/cli/src/acts/flow.ts:151-152` | **Route A linchpin**: the-flow ships a near-complete seed and passes `--template` — pre-bake is a the-flow-repo change, **zero CLI work** | High |
| F-10 | **No `flight-plan` create-seed exists in the CLI today** (only `harness-adopt`/`harness-loop`); the-flow grows the plan node-by-node | `harness/cli/src/services/flow/schemas-content.ts:67,124` (no flight-plan seed) | "Pre-bake the flow" = the-flow *starts* shipping a `--template` seed; nothing to delete CLI-side | High |
| F-11 | **No `remove-node`; `set-node` cannot re-parent** — mutations are add (`add-node`/`insert-node`) + field-edit (`set-node`) + status only | `harness/cli/src/acts/flow.ts` (no remove verb; set-node lacks `--next`/`--branch-of`); flight-plan-ops.md:88 | Route A's expansion must be **purely additive** unless we add `remove-node`/`mv-node` — the one real gap (shared by any mechanism) | High |
| F-12 | `insert-node --after/--before/--branch-of --rejoin` splices a node + rewires edges, DAG-rechecked (`E309`) | `harness/cli/src/acts/flow.ts:553-566`; flight-plan-ops.md:87 | Phase injection at plan-complete is expressible today; a **batch `apply`** would make N-phase expansion atomic + kill the build-order wart | High |
| F-13 | Build-order wart: `add-node --next` targets must pre-exist → author last-node-first | `eng-harness-flow/references/flight-plan-ops.md:94-97` | A transactional `apply` (validate final DAG once) lets forward refs resolve at end — big agent-ergonomics win | Medium |

## Historical Evidence

| ID | Prior friction / decision | Source | Applicability now | Implication |
|----|---------------------------|--------|-------------------|-------------|
| H-01 | The cheap cadence-step prose fix shipped (Tier-1 "run-now" sibling to render) — chosen over a recurring-chore/CLI primitive on a frugality pass | the-flow commit `f9a86f1` (peer-reported; not in this repo) | **Superseded** — this plan replaces it (prose trigger → CLI-run trigger) | Call it out explicitly as the thing being replaced; the *render-class/advisory-when-clean* framing it introduced is retained, only the trigger mechanism changes |
| H-02 | 3 live skips of the prose reconcile in the wild | reported runtime: pij-5lztp8, pij-65z136 ×2 (per fugu-ultra review) | **Direct** — the motivating evidence | Justifies the reversal of the earlier "no CLI work / go cheap" call; the cheap lane is now empirically exhausted |

## Risks and Unknowns

| Item | Evidence | Why it matters | Resolution / next evidence |
|------|----------|----------------|----------------------------|
| **Where the mtime watermark lives** — "no new persisted state beyond the flight plan" vs needing a debounce | constraint (peer packet) + F-04 (navShow pure) | A naive cache file violates the no-new-state constraint; stamping a watermark on `nav show` turns a *read* into a *write* | **Recommend**: the watermark is owned + written by the **reconcile executable** (which already writes via `harness flow`), recorded inside the flight plan (CLI-owned state, honoring the constraint); the CLI's nav slot only *reads* plan-md mtime vs that watermark to decide whether to spawn — keeping `nav show` a read. Decision to confirm in plan. |
| **Reentrancy** — the hook runs a command that itself calls `harness flow` | F-03/F-05 | If the reconcile hook (or its `harness flow` calls) re-enters `nav show`, infinite spawn | Env-flag guard (e.g. `HARNESS_FLOW_RECONCILE=1`) set when spawning the hook, checked at nav-act entry → skip the slot. Reconcile's own `insert-node`/`set-node` calls are different acts and don't re-trigger; only a nested `nav` would |
| **Hook latency on a hot read** — `nav show` runs every turn | F-03 | Spawning a subprocess on every nav read adds latency even when the spine is complete | mtime-debounce (above) makes the common case a fast no-op (compare two mtimes, skip spawn); the empty-diff path inside reconcile is also cheap |
| **Totality of the hook** — a broken/missing reconcile script must not derail `nav` | constraint (reconcile must be TOTAL, exit clean/0) | If the slot treats a non-zero hook exit as a nav failure, the whole guided turn breaks — violating best-effort/advisory | The CLI slot must be **fire-and-forget / swallow-and-continue**: a missing `reconcile_hook`, a non-executable path, or a non-zero exit is logged-at-most and **never** fails the `nav show`. Advisory by construction |
| **Cross-repo doctrine drift** — edits land in two repos | F-08 | If harness-seams.md (peer) and eng-harness-flow SKILL.md (mine) disagree on who creates vs owns the flag, the split corrupts | Capture as a coordinated cross-repo task with a single agreed wording; the peer's independent validation is the cross-check |
| **Schema/version pinning** — does adding a provenance field need a `schema_version` bump? | F-02 | Tolerant schema means silent round-trip; but a contract change unannounced can surprise downstream readers | Decision: field is additive + optional → no bump strictly required; confirm against the flow schema-version policy in plan |

## Domain Impact

| Domain / boundary | Relationship | Contract or constraint | Evidence |
|-------------------|--------------|------------------------|----------|
| `harness flow` CLI (this repo) | gains `provenance.reconcile_hook` + a nav-read execution slot | Must stay **roster-blind** (never parse SDD markdown); remain the **single writer**; keep `navShow` pure | F-01–F-05 |
| the-flow skill (peer/tools repo) | ships the deterministic reconcile executable + registers its path at create | SDD-aware computation lives here, not in the CLI; reconcile must be **TOTAL** | F-07, peer packet |
| R-1 chore-flag ownership doctrine (both repos) | split into create (reconcile) vs lifecycle (eng-harness-flow) | harness-seams.md + eng-harness-flow SKILL.md must **agree** | F-08 |

## Planning Handoff

- **Preserve**: the roster-blind CLI hard line; CLI single-writer; `navShow` purity; chore idempotency (dedup on `--hook` token, set-node no-op); the fixed 4-hook→4-anchor canonical shape (flight-plan-ops.md); best-effort/advisory throughout (never gate/score/block); the render-class "advisory-when-clean" framing from f9a86f1.
- **Change carefully**: the nav-read act (adding a side-effecting subprocess to a hot, currently-pure read path) — guard for reentrancy, debounce by mtime, and make totality absolute (never fail the nav on a bad hook); the R-1 doctrine lines in **both** repos (must land together and agree).
- **Likely files/symbols (this repo's CLI work only)**: `record/provenance.ts` (type), `flow/flow-service.ts:280-292` (create stamp), `acts/flow.ts:248-262` (nav-read hook slot + guard + mtime check), `adapters/exec/node-exec.ts` (inject existing ExecPort), tests for the slot's totality/reentrancy/no-op-debounce; doctrine: `eng-harness-flow/.../SKILL.md` + `references/harness-seams.md` (the latter is the peer's file — coordinate).
- **Decisions still required**: (a) exact home of the mtime watermark (recommend: reconcile-owned, inside the flight plan); (b) whether `nav show` may ever write, or stays strictly read with the watermark written only by the reconcile subprocess (recommend: strictly read); (c) schema_version bump policy for the additive provenance field (recommend: no bump, additive+optional); (d) the precise division of which doctrine sentences live in which repo.

## External Research
_None material — the design is fully grounded in the existing CLI surface, the frozen chore shape, and reported runtime evidence._
