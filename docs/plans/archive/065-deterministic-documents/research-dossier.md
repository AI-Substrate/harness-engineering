# Research Dossier: Deterministic Documents (dd) — where it lands in this codebase

**Generated**: 2026-08-03T15:58+10:00
**Query**: "start new flow, get flow spine in please, then proceed to explore phase. then we go to workshops — Deterministic Documents (dd) per initial-brief.md"
**Effort**: Standard
**Tools**: Standard
**Evidence**: 14 current sources · 5 historical sources

## The Ask

Jordan is introducing **Deterministic Documents (dd)**: documents stored as validated data (`.dd.json`, schema by reference per D14) rendered to sibling `.dd.md`, with typed sections and typed cross-document links, plans as the exemplar doc type, and flow-spine navigation gated by completable-section state. The concept phase is complete — rulings D1–D16 and per-workshop dispositions are recorded in `workshop-notes.md`. This dossier answers the live-code question the plan needs: **how does this codebase structure verbs, libs, validation, rendering, gating, and checks — and exactly where does dd integrate?** It feeds the `plan` verb and the pre-plan workshops (W9 first).

## Answer

1. `dd` must be a **core act** (extensions cap at one subverb level; `dd schema list` needs two) — wired as `acts/dd.ts` + `services/dd/` + one registration line, with `dd` added to `RESERVED_NAMES`.
2. **dd-core as a harness-free lib is a new pattern for this repo** — no service today is fully free of `output/` imports; the faithful shape is services returning structured failure objects (like `FlowFailure`), acts mapping to E-codes, boundary machine-enforced via dep-cruiser rules.
3. **No JSON-Schema library exists, deliberately** — dd schema validation is either hand-rolled (house style: validators return `string[]` issues, never throw) or an explicit new-dependency decision.
4. The **render pipeline dd needs already exists as a pattern**: pure `render(doc): string`, sibling `.json → .md`, auto-render-on-mutation (best-effort), `--check` byte-drift guard with its own E-code.
5. **`dd_link` on a flow node round-trips today with zero CLI change** (tolerant index signature; `flow apply --ops` is field-blind) — the schema entry is documentary, not enabling.
6. **No mechanical nav gate exists anywhere**: `setNow` checks only node existence; the chore discipline is skill-prose, and "chores never gate" is a recorded ruling (ws004 C3). dd gating is therefore either the repo's **first mechanical gate** (needs an explicit ruling) or a **warning via the existing housekeeping-notice channel**. The refusal shape to copy if ruled: `d5Refuse` (refuse + honest diagnostic + `--force` escape + nothing written).
7. `checks`/doctor composition is **explicit, not discovered**: one `runVerbGate('dd', …)` line in the checks extension (launch `warn` per house convention) and optionally one doctor-layer function.

## Evidence

| ID | Finding | Evidence | Planning implication | Confidence |
|----|---------|----------|----------------------|------------|
| F-01 | Extensions allow exactly one subverb level ("Nested `sub` intentionally absent"); core verbs are reserved names | `harness/cli/src/services/extensions/contract.ts:202-219` · `services/extensions/registry.ts:78-90` | dd is a core act; add `dd` to RESERVED_NAMES | High |
| F-02 | Single composition root registers every act; layout is act → service → injected ports (`FlowServiceDeps {fs, clock, git, env}`) | `harness/cli/src/app.ts:311-349` · `services/flow/flow-service.ts:47` · `acts/flow.ts:151` | `registerDdAct(...)` one line; `DdCoreDeps` mirrors the flow bundle | High |
| F-03 | No JSON-Schema validator library — hand-rolled by design, dep-light (deps: commander, jiti, picomatch); validators return `string[]`, never throw | `services/flow/flow-schema.ts:5-12,220` · `package.json:50-54` | dd schema validation: hand-roll in house style, or an explicit dep ruling | High |
| F-04 | `harness docs` is `docs [id]` (list-envelope / raw-body dump), content baked at build time from a manifest, drift CI-gated | `acts/docs.ts:36-85` · `services/docs/docs-manifest.json` · `scripts/gen-docs.mjs` · `package.json:38` | D15's `dd docs list/get` diverges from the existing shape — settle mirror-vs-diverge; reuse bake+drift-guard recipe | High |
| F-05 | Render precedent: pure `renderFlow(doc): string`, sibling `.json→.md`, auto-render best-effort after every mutation, `--check` drift guard (E310) | `services/flow/flow-renderer.ts:359` · `acts/flow.ts:113-124,942-971` | `.dd.json → .dd.md` copies this wholesale, incl. generated-file banner | High |
| F-06 | No service is fully harness-free today (flow-service imports ErrorCodes); no workspaces/packages; dep-cruiser enforces ports discipline at `warn` | `services/flow/flow-service.ts:5` · `.dependency-cruiser.cjs:38-56` | dd-core = services returning structured failures + new depcruise rules; standalone package = new pattern, defer per D7 | High |
| F-07 | `checks` gates are hard-coded lines (`runCmdGate`/`runVerbGate`), two severities (hard/warn); doctor layers are a hard-coded array of pure functions | `.harness/extensions/checks/extension.ts:56-229` · `services/doctor/doctor-service.ts:590-601` | `dd doctor` composes into checks via one runVerbGate line, launch `warn`; optional doctor layer `checkDd(...)` | High |
| F-08 | `WatcherPort` exists (content-hash events, picomatch globs via SensorScheduler, heartbeat state doctor-readable, detached spawn port) | `adapters/watcher/watcher-port.ts:2-26` · `services/sensors/scheduler.ts:86` · `doctor-service.ts:430-462` | D9 auto-regen watcher reuses this infrastructure verbatim | High |
| F-09 | `FlowNode` has a tolerant index signature; `flow apply --ops` writes arbitrary fields today; `instructions[]` proves off-schema fields round-trip; schema optional[] entry is cosmetic (+ `gen:flows` regen) | `services/flow/flow-events.ts:82-141` · `flow-mutations.ts:957-961` · `flow-schema.ts:216-218` | `dd_link` lands with zero CLI change; `--dd-link` flag is a convenience, not a prerequisite | High |
| F-10 | No mechanical gate exists: `setNow` checks only E305 node-existence; chore discipline is prose in three skill files; "importance never gates" is a recorded ruling (ws004 C3) | `flow-mutations.ts:62-71` · `builder/SKILL.md:100` · `flow-schema.ts:292-294` | dd gate = first mechanical gate (needs ruling) or warn-only; decide agent-vs-human posture explicitly | High |
| F-11 | Refusal-with-override shape exists: `d5Refuse` — refuse, honest diagnostic, `--force` escape, "Nothing was written"; envelope has non-fatal `housekeeping[]` channel | `flow-mutations.ts:679-689` · `output/envelope.ts:38-65` | The two candidate gate mechanics are both already idiomatic | High |
| F-12 | orient shows ALL chores with per-item pips (not just due); rail appends `⚑ due:` callout; renderer is pure — cannot read `.dd.json` itself | `acts/flow.ts:1186,1146-1150` · `flow-renderer.ts:687,359` | dd gate surfacing: 4-line orient block + rail callout; gate state must be stored/precomputed, never renderer-fetched | High |
| F-13 | E300–E310 flow block is full; codes live in one const map with reserved ranges | `output/error-codes.ts:94-116` | dd claims a fresh contiguous block (e.g. E4xx) up front | High |
| F-14 | All mutations flow through one pipeline (`runMutation`: read → mutate → validate → atomic write → auto-render); `validateMutatedDoc` silently skips when overlay can't re-resolve | `acts/flow.ts:1267-1295,1242-1265` | Gate check belongs in `runMutation`/`setNow`, NOT inside schema validation (inherits the silent-skip hole) | High |

## Historical Evidence

| ID | Prior friction / decision | Source | Applicability now | Implication |
|----|---------------------------|--------|-------------------|-------------|
| H-01 | R-elegance + D1–D16 are the authoritative concept rulings (write posture, signpost ACs, states-not-booleans, links source-only, D14 schema packages, D15 dd docs, D16 link resolve) | `workshop-notes.md#decisions-so-far` | Direct | The plan implements these; it never re-litigates them |
| H-02 | Every W-item carries a Jordan disposition: W9 full workshop (one question at a time), W2+W10 direction-ruled/leaning, W1/W3 direction-ruled, W7 deferred to first render, W8 closed (depth 3–4; loop breakers are the real requirement) | `workshop-notes.md#open-items-to-workshop` | Direct | Plan must not silently settle open W-items; W9 precedes any grammar lock |
| H-03 | Plans are the first exemplar doc type; schema sketch = content of package `builder/plan`; W10 (done_when granularity) changes required addressing depth | `exemplar-plans-as-dd.md` | Direct | Phase-one target; W10 ruling feeds W9 |
| H-04 | Thinker addressing grammar (`path#section-id/kind:element-id`, basis pins, doctor check table) is explicitly [proposed], not ruled | `research/thinker-linking-composition.md` (frozen) | Partial | W9's input floor, never citable as decided |
| H-05 | Measured corpus: 11 backpressure surveys, exactly one basis pin recorded and it is already stale unnoticed; survey rows unaddressable | `research/thinker-linking-composition.md#part-4` (frozen) | Direct | The drift-warning tier (doctor check 6) has a proven real-world case in this very repo |

## Risks and Unknowns

| Item | Evidence | Why it matters | Resolution / next evidence |
|------|----------|----------------|----------------------------|
| Gate posture contradiction: brief says "nav should wail/refuse"; recorded ruling says chores never gate; no mechanical gate exists anywhere | F-10, F-11; `initial-brief.md` (frozen) | Decides dd's single most visible behaviour and departs from a recorded ruling | Explicit Jordan ruling in W2 workshop (state vocabulary + gate posture are one conversation); both mechanics are idiomatic (F-11) |
| W9 addressing grammar unresolved | H-02, H-04 | Every link column, dd_link, rename transaction, and validate walk consumes it | W9 workshop first, one question at a time |
| Dependency decision for schema validation | F-03 | Breaks the deliberate dep-light posture if assumed | One-line ruling at W9/plan seam: hand-roll (recommended, house style) vs ajv |
| `dd docs` shape vs existing `docs [id]` | F-04 | D15 says "just like harness docs" but names `list`/`get` subverbs that don't match the existing surface | One-line ruling; either is cheap |
| E-code block allocation | F-13 | E3xx is full; dd needs its own range before implementation | Plan names the block (e.g. E400–E429) |

## Domain Impact

| Domain / boundary | Relationship | Contract or constraint | Evidence |
|-------------------|--------------|------------------------|----------|
| harness-cli (core) | dd lands here: new act + services + ports | envelope contract, exitWithEnvelope chokepoint, ports-only I/O (arch tests) | F-02, F-14 |
| flow spine | dd_link field + gate check + orient/rail surfacing | renderer purity (state stored/precomputed); event kinds reused, never minted | F-09, F-12 |
| checks / doctor | dd doctor composes in as a warn-launch gate + optional layer | explicit registration, two-severity model | F-07 |
| skills (builder) | flight-plan schema lives skill-side; dd_link vocabulary note | overlay can't declare node fields; core schema + gen:flows owns shape | F-09; `flow-schema.ts:49-55,192-209` |

## Planning Handoff

- **Preserve**: envelope + single exit chokepoint; ports/adapters discipline (arch-tested); dep-light posture; pure-renderer contract; D5 terminal semantics; tolerant field round-trip; R-elegance as the measure of every design choice.
- **Change carefully**: `runMutation` pipeline (gate insertion point); `error-codes.ts` (new block, JSDoc discipline); `.harness/extensions/checks/extension.ts` (gate line); `flow.schema.json` + `gen:flows` (documentary dd_link entry); `.dependency-cruiser.cjs` (dd-core boundary rules).
- **Likely files/symbols**: new `acts/dd.ts`, `services/dd/**` (core: parse/validate/address/link-resolve/render/doctor), `app.ts:311-349`, `registry.ts` RESERVED_NAMES, `flow-events.ts` (dd_link type), `acts/flow.ts` (`orientView`/`renderOrient`/`runMutation`), `flow-renderer.ts` (`nodeLabel` badge + rail callout), `adapters/watcher/*` (reuse), `test/acts/dd.test.ts` + `test/services/dd/**` + architecture guards.
- **Decisions still required**: W9 addressing grammar (workshop next); gate posture ruling (fold into W2); W10 done_when nesting (with W2); `dd docs` surface shape; schema-validation dependency; E-code block; dd-core failure-object boundary form.

## External Research

_None material — every open question is a design ruling or an in-repo fact already evidenced._
