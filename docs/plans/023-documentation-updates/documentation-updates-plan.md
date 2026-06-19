# First-Class Onboarding Flow System

**Mode**: Full
**Plan Version**: 1.0.0
**Created**: 2026-06-18
**Status**: READY
**Spec source**: unified (this file)

> Folder slug is `documentation-updates` (so this file is `documentation-updates-plan.md`, the name the flow discovers); the **substance** is the directive *"build a first-class flow system"* — give the harness **adoption journey** the same first-class, durable, coached experience `the-flow` gives the SDD pipeline, but **self-contained** and without making the router stateful. The documentation sweep is one workstream within it.

> 📚 Incorporates findings from `research-dossier.md` (6-lens fan-out) and `workshops/001-onboarding-flow-state.md` (authoritative design decisions).
> ⚠️ **Authored by a worker fork** — the interactive Round-1/Round-2 clarification and the mandated `/validate-v2` deep pass were **not** run (a fork cannot spawn subagents). Round-1 answers were applied as grounded, reversible defaults (recorded in `### Clarifications`); a guided `/the-flow` re-run can re-confirm and auto-run validate-v2.

---

## Business Specification

### Research Context
The dossier confirms: (1) the design is the architecture's **own prescribed move** — the router's "stateless by design" thesis ships an escape hatch (*"state that must persist lives in deterministic substrate a child verb owns"*), which authorises an adopt-verb-owned, self-cleaning `.harness/temp/adopt-flow.json`; (2) the coach port is **voice-only** — the `--json` envelope already emits every field the Seam Digest renders; (3) the **cold-start breadcrumb gap** is real and precisely located (the only traveling artifact's breadcrumb assumes the CLI exists); (4) onboarding/adopt/coach behaviour has **essentially zero deterministic sensors** — the byte-stable contract's only guard is a one-time byte-diff + an external, un-CI'd mirror.

### Summary
Today onboarding re-derives its position from **markdown/substrate presence-checks** every call — correct for the cyclic engineering loop, lossy for the **linear adoption journey** whose transient decisions (declined optionals, half-done multi-file weaves, a boot-shape chosen before it's built, the narration thread) aren't yet in substrate. This plan brings `the-flow`-grade resilience to onboarding via a small, ephemeral, cursor-bearing state file the **adopt verb owns**; ports `the-flow`'s coach devices (Seam Digest, `recap`, mirror-as-todos) into the already-90%-aligned `eng-harness-flow` coach; closes the CLI cold-start discoverability gap so the journey can even begin on a fresh machine; and adds the one deterministic sensor that stops the byte-stable contract from silently drifting.

### Goals
- A repo mid-adoption **survives `/compact`** — re-invoking the flow resumes at the cursor, never re-asks a declined optional, and picks up a half-done weave where it stopped.
- Onboarding **feels** first-class — rail + Seam Digest + print-then-offer + `recap`, matching `the-flow`.
- A teammate cloning an adopted repo on a fresh machine has a **traveling, runnable** cold-start install pointer.
- The byte-stable `--hook`/`--event`/`--hooks`/`--json` contract gains its **first deterministic guard**.
- All onboarding/install documentation surfaces are **reconciled** (one breadcrumb spelling; no stale distribution clauses; no retired slugs).

### Non-Goals
- **Not** making the router stateful — it stays a pure dispatcher that only *reads* the new file as one signal.
- **Not** a flight-plan/DAG analogue for the harness (the one-file `adopt-flow.json` deliberately collapses `the-flow`'s two-file model).
- **Not** reshaping any public contract field (additive-only if anything).
- **Not** porting `the-flow`'s SDD "adoption contract" (late-join an SDD plan — a terminology collision, not the same concept).
- **Not** a full minih/dogfood-extension rebuild (the `.minih.json` realignment is scoped as a single decision, AC-14).

### Target Domains
No `docs/domains/registry.md` exists (Constitution §5 — domain system not initialized). Per the constitution, surfaces are tracked as **conceptual domains for traceability only**; the enforced rules are `architecture.md`. No NEW formal domains are created.

| Domain (conceptual) | Status | Relationship | Role in This Feature |
|---|---|---|---|
| harness-cli (`harness/cli/`) | existing | **modify** | cold-start breadcrumb in `init`/governance-template; the Phase-0 contract-snapshot test; honors ports/adapters + envelope |
| eng-harness-flow · adopt verb | existing | **modify** | owns the `adopt-flow.json` create/update/resume/archive lifecycle (harness-blind) |
| eng-harness-flow · router engine (`00-routing.md`) | existing | **modify** | one read-only "adoption-in-flight" signal + resume precheck; no envelope reshape |
| eng-harness-flow · coach (`coach.md`) | existing | **modify** | port Seam Digest + `recap` + mirror-as-todos (voice-only) |
| repo docs / governance substrate | existing | **modify** | reconcile install/onboarding doc surfaces; fix stale distribution clauses |

### Testing Strategy
- **Approach**: **Hybrid** (Constitution §3 — the repo is Hybrid). Test-first for logic with real branching: the Phase-0 contract-snapshot test, the `adopt-flow.json` lifecycle/resume rules, any CLI breadcrumb logic. Lightweight verification (inspection + grep) for skill-`.md` prose edits and the docs sweep.
- **Focus areas**: contract byte-stability; resume-across-`/compact`; cursor-vs-substrate authority; L1 de-leak; CI-trap green (gen:docs/build/biome/check:docs/skills-check).
- **Excluded**: networked/`minih` onboarding probe (`validate-harness-flow`) — non-deterministic, not a regression gate.
- **Mock usage**: **targeted fakes only** — Constitution P3 / architecture §7 forbid `vi.mock`; inject `FsPort`/`FakeFs` etc.

### Documentation Strategy
- **Location**: **Hybrid (README + docs/how/)** — this plan *is* substantially a documentation reconciliation. Bundled docs (any `docs-manifest.json` `sourcePath`) require `npm run gen:docs` + build.
- **Rationale**: the cold-start fix must be encoded **product-side** (README → skills/README → adopt install step → a how-to), never in a prompt/memory (PL-17).

### Complexity
- **Score**: CS-5 (epic)
- **Breakdown**: S=2 (adopt.md, 00-routing.md, coach.md, CLI init/template, many docs), I=2 (byte-stable contract + external the-flow mirror + CLI↔skill boundary), D=2 (new JSON state file + lifecycle + resume semantics), N=1 (new for the harness, but modeled on the-flow), F=2 (statelessness invariant, L1 de-leak, /compact resilience, publication boundary), T=2 (no existing sensors; new fixture + CI traps). **Sum = 11 → CS-5.**
- **Confidence**: 0.80 (design is workshop-settled + dossier-grounded; main residual is the cursor-vs-substrate authority detail, CD-01).
- **Assumptions**: see Risks & Assumptions.
- **Dependencies**: none external; the-flow source available for parity reference (`~/github/tools/skills/SDD/the-flow/`).
- **Phases**: 6 (Phase 0 backpressure sensor + Phases 1–5 owner-scoped workstreams).

### Acceptance Criteria
- **AC-01**: A fresh-machine clone of an adopted repo contains a traveling, copy-pasteable cold-start install command; the first breadcrumb a cold agent reads does **not** require the CLI to already exist.
- **AC-02**: One breadcrumb spelling across `governance-template.ts`, `governance-doc.md`, and `.harness/engineering-harness.md`; **no `npx harness …` bare-invocation breadcrumb** remains (it violates the family's "never bare npx harness" rule).
- **AC-03**: `harness init` `next_action` names **no retired slug** (`eng-harness-0-adopt` removed; points at `/eng-harness-flow`).
- **AC-04**: Onboarding survives `/compact` — with `.harness/temp/adopt-flow.json` (`status:in-progress`) present, re-invoking the flow **resumes at `cursor`**, does **not** re-offer a `declined` optional, and resumes a half-done weave at the first `pending` file.
- **AC-05**: Required rungs (S0/S2/S4) are **re-confirmed against substrate** on resume even when the cursor says done; a stale / already-adopted file **archives + no-ops** rather than resuming (CD-01 + the conflict-matrix guard).
- **AC-06**: `adopt-flow.json` self-deletes (or archives to `.harness/temp/`) at completion and is never committed (covered by the `.harness/temp/` `*` gitignore).
- **AC-07**: The router gains **exactly one read-only** "adoption-in-flight" signal and **writes no state**; `--hook`/`--event`/`--hooks`/`--json` are unchanged byte-for-byte (additions, if any, additive-only).
- **AC-08**: `eng-harness-flow` `coach.md` renders a **Seam Digest** (Just did / Next up / Watch-outs / Optional), supports **`recap`**, and carries the **mirror-as-todos** instruction — with **no `00-routing.md` envelope change**.
- **AC-09**: The shared visual vocabulary (glyph set, legend rule, fenced-block rule, `└─` anchor math) stays **byte-aligned across both `coach.md` files**.
- **AC-10**: A deterministic **contract-snapshot test fails** when the `--hooks`/`--event`/`--json` contract blocks in `00-routing.md` change without updating the snapshot fixture.
- **AC-11**: `adopt.md` and `coach.md` additions are **L1-clean** — no sibling slugs, no lifecycle-hook strings, no flow-position, no "Next" markers in the verb module (the cursor/rung *ordering* vocabulary stays in `00-routing.md`).
- **AC-12**: Every edited bundled doc is regenerated (`gen:docs`) + built; `check:docs`, `docs.test.ts`, Biome, `skills-check`, and `ci-required` all green.
- **AC-13**: Stale distribution clauses (`constitution.md` §4 Delivery, `architecture.md` §4 Packaging — both still say GitHub Packages) are updated to the public-npm reality; `docs/how/extend-the-harness.md` "installed via npx" is corrected.
- **AC-14**: The `.minih.json` realignment is **either** landed (every `.minih.json` skill source path + requested slug resolves; optional `doctor` check) **or** explicitly deferred with the `--no-skills` workaround documented.

### Risks & Assumptions
- **Assumption**: the `--json` envelope already carries `rail.cursor/now/next/flags/insight` (verified, IA-03/PS-11) → the coach port needs no contract change.
- **Assumption**: `.harness/temp/`'s self-healed `*` gitignore already covers `adopt-flow.json` (verified, PL-03) → no gitignore work.
- **Risk**: byte-stable contract drift breaks the external the-flow mirror (mitigate: AC-10 sensor + additive-only + a manual-resync note in the contract region).
- **Risk**: L1 re-leak in `adopt.md`/`coach.md` (mitigate: AC-11 grep + the 022 T005-style elision audit).
- **Risk**: silent CI red on a "one-liner" doc edit (mitigate: AC-12 + run the full local CI recipe, not just `just test`).
- **Risk**: cursor/substrate confusion reintroducing the "provisioning gaps look like engineering entry" failure (mitigate: AC-05).

### Open Questions
- Schema ownership — resolved to **skill-first / verb-loose** by default (PL-08: no named non-agent consumer yet); revisit only if CI/MCP needs byte-stable `adopt-flow.json`.
- Archive-vs-delete at completion — resolved to **archive to `.harness/temp/adopt-flow.done.json`** (cheap debugging breadcrumb, still gitignored); never promoted to `.harness/records/`.
- Cold-start breadcrumb home — **lean: fold into the governance `AGENTS START HERE` block** (cheapest, travels free); `.harness/INSTALL.md` is the fallback if it grows past ~3 lines (decided in Phase 1).

### Workshop Opportunities
| Topic | Type | Why Workshop | Key Questions |
|---|---|---|---|
| `adopt-flow.json` schema | Data Model | already settled in `workshops/001` (§4 draft schema) | — (covered) |
| Onboarding state machine | State Machine | already settled in `workshops/001` (§3 mermaid of every stop) | — (covered) |
| Contract-snapshot sensor shape | Storage Design | how to deterministically assert a markdown-defined contract | parse the fenced JSON blocks from `00-routing.md` vs a frozen fixture? scope to in-repo side only? |

### Clarifications
#### Session 2026-06-18 (fork-applied defaults — not interactively confirmed)
- **Workflow Mode** → **Full** (CS-5; multi-owner, contract-sensitive, 6 phases).
- **Testing Strategy** → **Hybrid** (matches Constitution §3).
- **Mock Usage** → **targeted fakes only** (Constitution P3 / architecture §7 forbid `vi.mock`).
- **Documentation Strategy** → **Hybrid (README + docs/how/)** (this is a docs-reconciliation plan).
- Design open-questions resolved via `workshops/001` leanings + dossier (schema skill-first; archive not delete; breadcrumb in governance block). A guided re-run may revisit any of these.

---

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: the contract-snapshot sensor shape (Phase 0) could use a short design pass; the schema + state machine are already workshopped (`workshops/001`).

| Artifact | Present? | Effect on the plan |
|---|---|---|
| research-dossier.md | y | informs Key Findings 01–10 (the CDs + PLs) |
| workshops/001-onboarding-flow-state.md | y | **authoritative** — the adopt-flow.json design, schema draft, and every-stop mermaid |

---

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | Round-1 answers applied as grounded fork-defaults; no critical `[NEEDS CLARIFICATION]` remain. (Interactive clarify + validate-v2 not run — fork constraint; a guided re-run re-confirms.) |
| G2 | Constitution | PASS | Honors P2/P3/P4/P5/P7/P8/P12; no HIGH-impact violation. Flags stale §4 distribution clause as a docs-sweep target (AC-13), not a deviation. |
| G3 | Architecture | PASS | CLI changes stay within Entrypoint→Acts→Services→Ports (no `node:fs` in services; deterministic, no LLM in CLI). Skill/coach/router edits are markdown surfaces outside the CLI hexagon. Flags stale §4 packaging clause (AC-13). |
| G4 | ADR Compliance | N/A | No `docs/adr/`. |
| G5 | Structure | PASS | All Output-Contract sections present. |
| G6 | Testing Alignment | PASS | Hybrid; test-first for Phase-0 sensor + lifecycle/CLI logic; lightweight for `.md` prose; ACs measurable. |
| G7 | Domain Completeness | PASS | No registry; conceptual Target Domains all existing/modify; no NEW domains → no `domain.md` required; Domain Manifest covers referenced files. |

### Summary
Six phases, owner-scoped so the contract between them is **data, not prose** (the architecture's own seam): Phase 0 freezes the byte-stable contract with the first deterministic sensor; Phase 1 makes the cold-start install pointer travel (CLI); Phase 2 builds the `adopt-flow.json` durable-state core (adopt verb); Phase 3 adds the router's one read-only resume signal; Phase 4 ports the coach voice devices; Phase 5 sweeps and reconciles every documentation surface. Each phase has a distinct owner and a distinct proof.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|----------------|-----------|
| `harness/cli/src/services/init/governance-template.ts` | harness-cli | internal | stamps the traveling cold-start breadcrumb (Phase 1) |
| `harness/cli/src/acts/init.ts` | harness-cli | internal | fix retired-slug `next_action` (Phase 1) |
| `harness/cli/test/**/contract-snapshot.test.ts` (new) | harness-cli | internal | Phase-0 deterministic contract guard |
| `skills/eng-harness-flow/references/stages/adopt.md` | eng-harness-flow (adopt) | contract | `adopt-flow.json` lifecycle, harness-blind (Phase 2) |
| `skills/eng-harness-flow/references/00-routing.md` | eng-harness-flow (engine) | contract | adoption-in-flight signal + resume precheck; statelessness-limits update; :84 fix (Phase 3) |
| `skills/eng-harness-flow/references/coach.md` | eng-harness-flow (coach) | contract | Seam Digest + recap + mirror-as-todos (Phase 4) |
| `skills/eng-harness-flow/references/governance-doc.md` | eng-harness-flow | contract | breadcrumb spelling + G5 write-conditions (Phase 5) |
| `.harness/engineering-harness.md` | repo substrate | internal | breadcrumb spelling alignment (Phase 5) |
| `docs/project-rules/{constitution,architecture}.md` | repo substrate | internal | stale distribution clauses → public npm (Phase 5) |
| `docs/how/extend-the-harness.md`, `README.md`, `AGENTS_README.md`, `harness/cli/README.md`, `INSTALL.md`, `skills/README.md`, `docs/how/keeping-the-harness-up-to-date.md` | repo docs | internal/cross-domain | cold-start reconciliation; bundled → `gen:docs` (Phase 5) |
| `.minih.json`, `agents/**`, `.harness/extensions/validate-*` | repo substrate | internal | AC-14 realignment decision (Phase 5) |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | Cursor-vs-substrate authority: `harness init` seeds governance empty, so `S2=done` (presence) ≠ usable; required rungs must stay substrate-authoritative even when the cursor disagrees (IA-05e). | Phase 2/3: persisted file owns transient/declined state only; re-confirm S0/S2/S4 vs substrate on resume; staleness guard (AC-05). |
| 02 | Critical | Zero deterministic sensors for the router/adopt/coach contract; byte-stability guarded only by a one-time byte-diff + an external un-CI'd mirror (QT-13). | Phase 0: contract-snapshot test (AC-10). |
| 03 | Critical | Cold-start breadcrumb doesn't travel; the one that does (`npx harness instructions`) is a footgun violating "never bare npx harness" (DE-01/IC-01). | Phase 1: stamp a traveling install pointer; one safe spelling (AC-01/02). |
| 04 | High | `--hook/--event/--hooks/--json` is byte-mirrored by the-flow's `harness-seams.md`; reshape breaks the mirror (PL-06). | Additive-only; AC-07 byte-diff; manual-resync note. |
| 05 | High | L1 de-leak: verb modules stay harness-blind (no sibling slugs / hook strings / flow-position / "Next") (PL-13). | AC-11 grep + T005 elision audit on `adopt.md`/`coach.md`. |
| 06 | High | CI traps: bundled-doc edit needs `gen:docs`+build; `just test` runs neither Biome nor `check:docs`; sweeps must derive from `docs-manifest.json` (PL-09/10/15). | AC-12 + full local CI recipe; never hand-edit `docs-content.ts`. |
| 07 | High | `.minih.json` drift → live E211 (needs `--no-skills`); 022 retro deferred it here (PL-12). | Phase 5 decision (AC-14). |
| 08 | Medium | `constitution.md` §4 + `architecture.md` §4 still say GitHub Packages; plan 019 moved to public npm (read during G2/G3). | Phase 5 fix (AC-13). |
| 09 | Medium | Coach port is voice-only — envelope already emits the digest's fields (PS-11). | Phase 4: no `00-routing.md` change. |
| 10 | Medium | Schema ownership should default skill-first (no named non-agent consumer) (PL-08). | Phase 2: verb-loose schema, documented in `adopt.md`. |

### Phases

#### Phase Index

| Phase | Title | Primary Domain | Objective (1 line) | Depends On |
|-------|-------|----------------|--------------------|------------|
| 0 | Freeze the contract (backpressure sensor) | harness-cli | first deterministic guard over the byte-stable hook/envelope contract | None |
| 1 | Cold-start breadcrumb (CLI) | harness-cli | make a runnable install pointer travel into consumer repos; kill the footgun + retired slug | Phase 0 |
| 2 | `adopt-flow.json` durable-state core | eng-harness-flow (adopt) | adopt verb owns create/update/resume/archive; cursor-vs-substrate authority | Phase 1 |
| 3 | Router resume signal | eng-harness-flow (engine) | one read-only "adoption-in-flight" signal + resume precheck; no envelope reshape | Phase 2 |
| 4 | Coach voice port | eng-harness-flow (coach) | Seam Digest + recap + mirror-as-todos (voice-only) | Phases 2, 3 |
| 5 | Docs sweep + reconcile | repo docs | one breadcrumb spelling; stale-distribution fix; `.minih.json` decision | Phases 1–4 |

---

#### Phase 0: Freeze the contract (backpressure sensor)
**Objective**: Add the first deterministic guard so a later edit can't silently drift the byte-stable contract from the-flow's mirror.
**Domain**: harness-cli
**Delivers**: a committed snapshot fixture of the `--hooks` manifest shape + the `--event`→`--hook` alias table + the `--json` routing envelope field-set (parsed from the fenced JSON in `00-routing.md`); a vitest that fails on drift with a "consciously update the snapshot AND resync `harness-seams.md`" message.
**Depends on**: None.
**Key risks**: the contract lives in markdown, not code — the test must parse `00-routing.md`'s fenced blocks, not call a router (QT-01).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 0.1 | Test-first: write `contract-snapshot.test.ts` that parses the `--hooks`/`--event`/`--json` blocks from `00-routing.md` and asserts hook tokens (5), alias rows (6), and envelope field-set against a committed fixture | harness-cli | test red before fixture, green after | per finding 02 |
| 0.2 | Commit the frozen fixture (hook tokens, alias map, envelope field-set) | harness-cli | fixture matches current contract byte-for-byte | |
| 0.3 | Document the resync obligation inline in `00-routing.md`'s contract region (edit snapshot + resync external mirror together) | eng-harness-flow | a one-line note present; L1-clean | not a sibling-slug ref |

#### Phase 1: Cold-start breadcrumb (CLI)
**Objective**: A fresh-machine cloner (or their cold agent) finds a runnable install pointer that travels into the consumer repo.
**Domain**: harness-cli
**Delivers**: `harness init` stamps a cold-start install line into the governance `AGENTS START HERE` block (the traveling artifact); one breadcrumb spelling chosen (bare `harness instructions`, no `npx`); `init.ts` `next_action` retired-slug fix.
**Depends on**: Phase 0.
**Key risks**: must stay in Services/ports (no `node:fs` in the service); honesty (P5) + `next_action` (P7).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 1.1 | Test-first: fake-fs test that `harness init` output includes the cold-start install one-liner + safe breadcrumb spelling | harness-cli | test green; uses `FakeFs`, no `vi.mock` | P3 |
| 1.2 | Stamp the cold-start line into `governance-template.ts` `AGENTS START HERE` block | harness-cli | stamped doc (the traveling artifact) carries `npm install -g @ai-substrate/engineering-harness` + bare `harness instructions` | AC-01/02, finding 03 |
| 1.3 | Fix `init.ts` `next_action` ×2 → `/eng-harness-flow` (drop retired `eng-harness-0-adopt`) | harness-cli | grep finds no retired slug | AC-03, finding 03/DB-12 |
| 1.4 | Decide breadcrumb home (governance block vs `.harness/INSTALL.md`) + record the decision | harness-cli | one spelling across all 3 sites (verified in Phase 5) | open question resolved |

#### Phase 2: `adopt-flow.json` durable-state core
**Objective**: The adopt verb stands up, follows, and self-cleans an ephemeral cursor-bearing onboarding state file.
**Domain**: eng-harness-flow (adopt verb)
**Delivers**: the create/update/resume/archive lifecycle in `adopt.md` (harness-blind); the verb-loose schema documented inline; CD-01 authority rule; staleness/already-adopted guard; `ensureTemp` at S0.
**Depends on**: Phase 1.
**Key risks**: L1 de-leak — the cursor/rung *ordering* vocabulary (S0→S4, hook names) must stay in `00-routing.md`, not the module.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 2.1 | Define `adopt-flow.json` shape (verb-loose) per `workshops/001` §4; document it in `adopt.md` | eng-harness-flow | schema fields present: cursor, rungs(+declined), per-file decision[], decisions.boot_shape, narration_thread, status | finding 10 |
| 2.2 | Add create/update/archive lifecycle to `adopt.md` (write at each stop; self-archive at completion) | eng-harness-flow | lifecycle described; L1-clean | AC-06/11 |
| 2.3 | Add resume rules: cursor authoritative for transient/declined only; required rungs re-confirmed vs substrate; staleness + already-adopted guard | eng-harness-flow | rules present + unambiguous | AC-04/05, finding 01 |
| 2.4 | Specify `ensureTemp` at S0 so the gitignore self-heal protects the file before first write | eng-harness-flow | noted; relies on existing `*` glob | PL-03 |
| 2.5 | L1 grep + T005 elision audit on `adopt.md` | eng-harness-flow | zero L1 hits | AC-11, finding 05 |

#### Phase 3: Router resume signal
**Objective**: The router resumes onboarding from the file as one read-only signal, without becoming stateful.
**Domain**: eng-harness-flow (router engine, `00-routing.md`)
**Delivers**: a new "adoption-in-flight" detection signal + a decision-order precheck (resume-beats-re-derive for transient state only); update the existing "Where statelessness has limits" section; fix the dangling :84 cross-ref + the S1 path-inconsistency.
**Depends on**: Phase 2.
**Key risks**: must not reshape the envelope; must not let the router write.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 3.1 | Add the "adoption-in-flight" signal (read `.harness/temp/adopt-flow.json`) to the signal catalog | eng-harness-flow | signal documented; router reads only | AC-07, DB-02 |
| 3.2 | Add the decision-order precheck (resume transient state; re-confirm required rungs vs substrate) | eng-harness-flow | precheck ordered before the substrate gate; honors CD-01 | AC-05 |
| 3.3 | Update the existing "Where statelessness has limits" section to point at the new signal (don't add a competing one) | eng-harness-flow | single coherent section | PL-02 |
| 3.4 | Fix the dangling ":84 see 'limits'" cross-ref + S1 path-inconsistency | eng-harness-flow | refs resolve | IA-05d |
| 3.5 | Byte-diff `--hook`/`--event`/`--hooks`/`--json` vs pre-change | eng-harness-flow | unchanged (or additive-only); Phase-0 test green | AC-07/10, finding 04 |

#### Phase 4: Coach voice port
**Objective**: Onboarding *feels* first-class — the Seam Digest, `recap`, and mirror-as-todos, wired to the new file.
**Domain**: eng-harness-flow (coach.md)
**Delivers**: the Seam Digest section (Just did / Next up / Watch-outs / Optional) + the `recap` summon + the mirror-as-todos instruction + the `/compact` resume-handshake copy, all voice-only; the shared visual vocabulary kept byte-aligned across both coaches.
**Depends on**: Phases 2, 3.
**Key risks**: must not duplicate voice into a module; must not change the envelope; must keep both coaches' shared rail/digest vocabulary aligned.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 4.1 | Port the Seam Digest section into `coach.md` (facets + drop-when-empty + lift-never-invent + rail-first) | eng-harness-flow | digest renders from existing envelope fields | AC-08, finding 09 |
| 4.2 | Add the `recap` summon (reprint digest from `adopt-flow.json` without advancing) | eng-harness-flow | `recap` documented | AC-08 |
| 4.3 | Add the mirror-as-todos instruction (rungs ↔ todos) + the `/compact` resume-handshake copy | eng-harness-flow | both present | AC-08 |
| 4.4 | Keep the shared glyph/legend/fenced-block/anchor rules byte-aligned with the-flow's `coach.md`; add the digest shape to the shared vocabulary | eng-harness-flow | a diff of the shared rules matches | AC-09, PS-13 |
| 4.5 | L1 grep on `coach.md` additions; confirm no `00-routing.md` envelope change | eng-harness-flow | zero L1 hits; envelope byte-identical | AC-11, Phase-0 test green |

#### Phase 5: Docs sweep + reconcile
**Objective**: Every onboarding/install surface tells one coherent, current story.
**Domain**: repo docs / governance substrate
**Delivers**: one breadcrumb spelling across all sites; stale distribution clauses fixed; `extend-the-harness` "installed via npx" corrected; bundled docs regenerated; the workshop hygiene items corrected; the `.minih.json` decision.
**Depends on**: Phases 1–4.
**Key risks**: bundled-doc edits need `gen:docs`+build or CI reds; sweep must derive its file-set from `docs-manifest.json` (PL-15).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 5.1 | Derive the sweep file-set from `docs-manifest.json` `sourcePath`s + grep prose/count patterns | repo docs | file-set is manifest-derived, not hand-listed | PL-15 |
| 5.2 | Align breadcrumb spelling in `governance-doc.md`, `.harness/engineering-harness.md`, and the stamped template | repo docs | one spelling; no bare-`npx harness` breadcrumb | AC-02 |
| 5.3 | Fix stale distribution clauses (`constitution.md` §4, `architecture.md` §4 → public npm) + `extend-the-harness.md` "installed via npx" | repo docs | clauses match plan-019 reality | AC-13, finding 08 |
| 5.4 | Add cold-machine pre-step to `skills/README.md` + `INSTALL.md`; reconcile `README.md`/`AGENTS_README.md`/`harness/cli/README.md`/`keeping-the-harness-up-to-date.md` | repo docs | surfaces consistent; self-install framed as not-cold-start | DE table |
| 5.5 | Correct `workshops/001` hygiene items (the "verbatim" misquote; "coach already renders the digest" overstatement) | repo docs | items corrected | IA-05a/b |
| 5.6 | `.minih.json` decision: land the realignment (every source path + slug resolves; optional doctor check) OR defer with `--no-skills` documented | repo substrate | decision recorded + executed | AC-14, finding 07 |
| 5.7 | Run the full local CI recipe (`gen:docs` + build + `check:docs` + lint + `tsc --noEmit` + `just test` + `skills-check`) | repo substrate | all green | AC-12, finding 06 |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | 1.2 | stamped governance doc inspection |
| AC-02 | 1.4, 5.2 | grep across the 3 sites |
| AC-03 | 1.3 | grep `init.ts` |
| AC-04 | 2.2, 2.3, 3.1, 3.2 | `/compact`-resume drive |
| AC-05 | 2.3, 3.2 | resume drive (stale/already-adopted) |
| AC-06 | 2.2, 2.4 | gitignore check + completion archive |
| AC-07 | 3.1, 3.5 | byte-diff + Phase-0 test |
| AC-08 | 4.1, 4.2, 4.3 | coach.md inspection |
| AC-09 | 4.4 | diff of shared rules across both coaches |
| AC-10 | 0.1, 0.2 | vitest contract-snapshot |
| AC-11 | 2.5, 4.5 | L1 grep |
| AC-12 | 5.7 | full local CI recipe + CI |
| AC-13 | 5.3 | grep distribution clauses |
| AC-14 | 5.6 | `.minih.json` resolve check |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Byte-stable contract drift breaks the-flow mirror | Medium | High | Phase 0 sensor (AC-10) + additive-only + manual-resync note |
| L1 re-leak into adopt.md/coach.md | Medium | High | AC-11 grep + T005 elision audit |
| Silent CI red on a bundled-doc edit | High | Medium | AC-12 + full local CI recipe; never hand-edit `docs-content.ts` |
| Cursor/substrate confusion reintroduces "provisioning gaps look like entry" | Low | High | AC-05 (required rungs stay substrate-authoritative) |
| `.minih.json` scope creep | Medium | Medium | AC-14 explicit in/out decision |
| Router accidentally made stateful | Low | High | AC-07 (read-only signal; router never writes) |
