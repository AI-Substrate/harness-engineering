# Eng-Harness Skill Consolidation — one progressive-disclosure router skill

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-17
**Status**: READY
**Spec source**: unified (this file)

> 📚 No `research-dossier.md` file — research context below is drawn from the in-conversation assessment (2026-06-17): the flow-architecture ruleset (`~/github/tools/docs/skills-pipeline/flow-architecture.md`), the 030 worked example (`~/github/tools/docs/plans/030-flow-skill-consolidation`), a precise Explore-agent map of all six current child skills (line counts, cross-skill leakage, CLI verbs, artifacts), and a full read of the current `eng-harness-flow` router.

---

## Business Specification

### Research Context

- **The router is already half this pattern.** `eng-harness-flow` is a stateless dispatcher that already declares *"one front door — never call the children directly,"* and already carries the equivalents of a **Registry** (the slug-resolution table), a **Graph** (the adoption gate S0–S4 + the engineering dispatch table), a **Command grammar** (`--hook` / `--event` / `at=`), and an **inline coach** (the "Per-turn UX" section: rail, Orient→Flag→Insight→Suggest→Invite, the why-table, the Flag beat). Yet it still *ships* the six children as separate public skills. This consolidation finishes a half-done job — exactly what 030 did for `the-flow`.
- **The ruleset is `flow-architecture.md`, not the older migration paste.** flow-architecture **supersedes** the v1 progressive-disclosure guide on the one point that matters here: its old step-module template ended with a *"Next routing instruction"* section, which is precisely the flow-knowledge leak. The law the user named — *"sub-skills cannot know about each other or the outer flow"* — is flow-architecture **R1** (one graph, one owner) + **R8** (ids are a flow property, verbs are a sub-skill property), enforced by lint **L1** (sub-skill leakage: grep for flow-command strings, stage-position refs, sibling paths, Next-routing/Next-step markers).
- **Current surface (Explore-mapped):** 7 public skills. The router (`eng-harness-flow`) + six children totalling ~2,253 lines of `SKILL.md`: `eng-harness-0-adopt` (222), `eng-harness-0-harnessability-assessment` (1,102 + 8 templates), `eng-harness-0-add-extension` (122), `eng-harness-1-boot` (172), `eng-harness-2-backpressure` (194), `eng-harness-4-retro` (441 + `retro.schema.json`).
- **Cross-skill leakage to scrub (measured):** `backpressure` names its SDD position ("AFTER plan-1b/2c BEFORE plan-3", "informs plan-3", alias `/plan-2d`); `boot` references `eng-harness-4-retro --harvest`; `retro` references boot / the Improve-ledger cross-talk; `adopt` names `assess` + `add-extension` + the `--hook` seams + the S0→S4 order. The kept-public `assessment` peer references the retired `eng-harness-0-adopt` slug (sentinel + "§ Relationship to adoption").
- **The public contract is consumed downstream.** `the-flow`'s `references/harness-seams.md` mirrors this router's `--hook` / `--event` / `--hooks` / `--json` surface as a *versioned upstream seam contract* with a resync procedure. Any reshape of that surface breaks the mirror — so the consolidation must preserve it byte-for-byte.

### Summary

Collapse the engineering-harness skill family — currently **7 public skills** — into **2**: the `eng-harness-flow` router (a small dispatch `SKILL.md` + lazily-loaded reference modules) and the standalone `eng-harness-0-harnessability-assessment` peer (kept public for its independent "assess my repo" value). Five children fold into `eng-harness-flow` as **harness-blind verb modules** under `references/stages/` (`boot`, `backpressure`, `retro`, `adopt`, `add-extension`); the routing engine and the coach voice extract into `references/00-routing.md` and `references/coach.md`. The reorg preserves the `--hook` / `--event` / `--hooks` / `--json` public contract byte-for-byte and is reversible via a pre-cutover git tag.

### Goals

- **One front door, made real.** Public surface drops 7 → 2. The file layout finally matches the "one door, never call children directly" architecture the router already declares.
- **Sub-skills become harness-blind verbs** (flow-architecture R1/R8, lint L1): each module knows only its own domain work (calling `harness` CLI verbs, reading `.harness/`, writing artifacts — artifacts are the sanctioned wire protocol) and **nothing** about siblings, lifecycle-hook names, SDD-flow position, or "what's next."
- **The coach is preserved and elevated.** The guided/human-mode voice (rail, narration beats, why-table, Flag beat, unified rail, tone) extracts into one place (`coach.md`); because the verbs go blind, there is no competing narration scattered across modules — the guide gets *stronger*.
- **The public hook contract is byte-stable.** `--hook` (five lifecycle hooks) / `--event` (six-seam alias) / `--hooks` (discovery manifest) / `--json` (routing envelope) are unchanged, so `the-flow`'s upstream mirror needs no resync.
- **Reversible cutover.** A pre-consolidation git tag restores the 7-skill surface end-to-end (source + deploy).

### Non-Goals

- **`eng-harness-0-harnessability-assessment` stays public** as a peer skill (not folded). Its 1,102-line body and templates are unchanged except de-staling its cross-references to the retired `eng-harness-0-adopt` slug.
- **No behaviour redesign.** This is a re-housing + de-leak + dedupe, not a rewrite of what boot/backpressure/retro/adopt/add-extension *do*. The router's detection signals, adoption gate, engineering dispatch, and conflict matrix are preserved (relocated, not re-logiced).
- **No change to the `--hook`/`--event`/`--hooks`/`--json` contract.** Preservation, not evolution.
- **No new runtime tooling in this plan.** Adding a `harness validate-flow-architecture` extension to *deterministically* enforce L1 is surfaced as the dogfood "encode the fix" follow-up — noted, not built here (building it would touch CLI/extension code under Constitution P2/P3/P10 and belongs in its own plan).
- **The harness CLI (`harness/cli/`) is untouched** — markdown skills + catalog docs only.
- **`docs/plans/**` history untouched** — old slugs in past plans remain point-in-time records.

### Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| eng-harness-skills | **NEW** (concept-only) | **modify** | The `skills/eng-harness-*` tree — 7 skills consolidated to 2 (router + assessment peer) |

#### New Domain Sketches

##### eng-harness-skills [NEW — concept-only]
- **Purpose**: The engineering-harness skill surface this repo publishes via `npx skills` (`skills/eng-harness-*`), the front door to the harness loop.
- **Boundary Owns**: the router dispatch + grammar, the routing engine, the coach voice, the stage modules (verbs), the bundled references (getting-started, governance-doc, maturity-assessment, retro.schema.json), and the kept-public assessment peer.
- **Boundary Excludes**: the harness CLI (`harness/cli/`, governed by the Constitution's hexagonal rules), the `.harness/extensions/` dogfood verbs, the external `the-flow` family, installer infra.
- **Note**: this repo maintains no `docs/domains/` registry — this is a documentation mapping only, no `domain.md` machinery (same decision as 030's `sdd-pipeline-skills`).

### Testing Strategy

- **Approach**: **Lightweight** — skill content is markdown; verification is structural checks + a behavioural drive of the new surface.
- **Rationale**: there is no runtime code in scope. The load-bearing properties (no flow-leak in modules; byte-stable public contract; one-module-per-route loading) are provable by grep + a host-call drive.
- **Focus Areas**:
  - **L1 de-leak grep** — zero sibling-skill names, flow-position phrases, lifecycle-hook self-references, or `Next routing`/`Next step` markers inside any `references/stages/*.md`.
  - **Contract byte-parity** — diff the `--hook`/`--event`/`--hooks`/`--json` surface (the five hooks, the seam→hook alias map, the `--hooks` manifest shape, the `--json` envelope field set) against the pre-consolidation router; must be identical in meaning.
  - **Behavioural drive** — a host call (`/eng-harness-flow --hook pre-flight`, `--hooks --json`) returns the identical contract; each route loads only its intended module; the guided coach path renders the rail + narration beats.
  - **Deploy + orphan tidy** — `harness skills update` (or `just install-skills-*`) succeeds; the 5 retired slugs are pruned from deploy targets.
- **Excluded**: a committed eval suite; CI automation; the `validate-flow-architecture` extension (follow-up).
- **Mock Usage**: **none** — real files, real deploy targets, real `npx skills` / `harness skills` runs.

### Documentation Strategy

- **Location**: **Update existing only** — `INSTALL.md`, `skills/README.md`, `AGENTS_README.md`, `.harness/engineering-harness.md` (injection map), and any catalog mention in `CLAUDE.md` / `justfile`. The consolidated skill's own `references/getting-started.md` is the how-to.
- **Rationale**: the skill's bundled references are the documentation; new doc files would be ceremony (same call as 030).

### Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=2, I=2, D=0, N=1, F=1, T=1 (P=7)
- **Confidence**: 0.80
- **Assumptions**: stage bodies move largely verbatim minus the deduped flow-leak; the established 030 pattern transfers; the public hook contract can be relocated without reshaping.
- **Dependencies**: `npx skills` flatten/deploy behaviour; `harness skills update` (prune); the `~/github/tools` flow-architecture ruleset as the authoring reference.
- **Risks**: see Risks & Assumptions.
- **Phases**: single phase (Simple) — ordered task groups: pre-flight → rollback anchor → extract engine + coach → de-leak modules → rewrite dispatch (contract-preserving) → cutover (delete + sweep) → proof → deploy + tidy.

### Acceptance Criteria

1. `skills/` publishes **exactly two** eng-harness skills: `eng-harness-flow` (consolidated) and `eng-harness-0-harnessability-assessment` (kept peer); the 5 absorbed source folders no longer exist, and the now-meaningless `eng-harness-loop/` / `eng-harness-setup/` grouping folders are gone.
2. The dispatch `SKILL.md` is a thin layer (~150 lines) with its **frontmatter (`name` + the activation `description`) preserved verbatim** (the skill keeps triggering): Registry (hook↔verb↔module), Command grammar (`--hook`/`--event`/`at=`), the stateless-contract invariants, the progressive-disclosure rule, and `--help`.
3. `references/stages/` holds **5 harness-blind modules** (`boot`, `backpressure`, `retro`, `adopt`, `add-extension`), each stamped from the sub-skill template (Verb / Purpose / Consumes / Flags / Produces / Side effects + entry / procedure / output contract / exit), carrying no flow knowledge.
4. **Contract byte-parity**: the `--hook` (five lifecycle hooks), `--event` (six-seam alias map), `--hooks` (manifest `{ manifest_version, hooks[5] }` shape + the nine per-hook fields incl. `coding`'s silent `harness observe` invoke), and `--json` (routing-envelope field set incl. the additive `hook` field) surfaces are preserved against the pre-consolidation router — verified by **both** a section diff (relocated, not reshaped) **and** a behavioural drive returning identical `--hooks --json` / `--hook --json` output.
5. **L1 de-leak**: grep across `references/stages/*.md` returns zero sibling-skill names, flow-position phrases ("after plan-1b", "before plan-3", "/plan-2d"), lifecycle-hook self-references, or `Next routing`/`Next step` markers.
6. `adopt.md` uses **declared delegation** (`**Delegates**: assess; add-extension`, resolved via the Registry) for its sibling calls; `boot.md` cites `maturity-assessment.md` only via the **shared-conventions** lazy-pull (exception 1); the **S0→S4 adoption-gate order** lives in `references/00-routing.md` (the Graph), not in `adopt.md`.
7. `coding`/observe has **no module** — it is a Registry row pointing at the silent `harness observe` CLI verb.
8. The **coach voice** is fully extracted to `references/coach.md` (rail, Orient→Flag→Insight→Suggest→Invite, why-table, Flag beat, unified rail, tone); the guided/human-mode UX is preserved (a drive renders the rail + narration).
9. **Rollback**: tag `pre-eng-harness-consolidation` exists on the pre-cutover commit; the restore one-liner (`git checkout <tag> -- skills && <reinstall>`) is documented in the execution log.
10. **Catalog sweep**: `INSTALL.md`, `skills/README.md`, `AGENTS_README.md`, `.harness/engineering-harness.md`, and any `CLAUDE.md`/`justfile` catalog mention reflect the 2-skill surface; grep for the 5 retired slugs across live surfaces (excluding `docs/plans/**` and the dispatch's own slug-resolution note) returns zero hits, and the kept `assessment` peer's cross-references to `eng-harness-0-adopt` are de-staled to the router.
11. **Deploy**: `harness skills update` / `just install-skills-*` succeeds; the 5 retired slugs are pruned from all deploy targets; no deploy target resolves a retired slug.
12. **Behavioural drive**: a host call (`/eng-harness-flow --hook pre-flight`, `--hooks --json`) returns the identical contract; each route loads only its intended module; the guided coach path renders the rail + narration. Recorded in the execution log.

### Risks & Assumptions

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Public hook contract drifts** (breaks `the-flow`'s upstream mirror) | Medium | High | T006 done-when requires byte-parity; AC4 diff vs the pre-cutover tag; the five hooks / alias map / `--hooks` manifest / `--json` envelope are relocated, never reshaped |
| De-leak drops load-bearing **domain** content while scrubbing **flow** content | Medium | High | Per-module diff against its source skill (T004/T005); keep all `harness` CLI invocations + artifact paths verbatim; L1 grep is scrubbing flow-knowledge only |
| adopt's orchestration is lost in the delegation rewrite | Low | High | T005 done-when names the split explicitly: sibling calls → `**Delegates**`; S0→S4 order → 00-routing.md Graph; install/inject procedure stays in adopt.md |
| Dispatch `SKILL.md` balloons into a hidden monolith | Medium | Medium | AC2 caps ~150 lines; engine → 00-routing.md and voice → coach.md extracted **first** (T002/T003) so the rewrite has somewhere to put detail |
| Stale deployed child slugs shadow the new layout (`npx skills` never prunes) | High (without tidy) | Medium | T011 explicit `harness skills update` prune + verify |
| Kept `assessment` peer left with dangling `eng-harness-0-adopt` refs | Medium | Low | T009 sweep includes the peer's own cross-refs → router |
| Self-reference: the router being consolidated is the one the in-repo harness uses | Low | Low | Deploy is last (T011); the running session keeps loaded context; T012 is the post-cutover drive |

### Open Questions

None — the two design forks (keep assessment public; Simple/Lightweight/no-mocks/update-existing) were resolved with the user before drafting.

### Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Dispatch + engine split (which sections of today's router go to SKILL.md vs 00-routing.md vs coach.md) | CLI Flow | The destination map IS the contract-preservation proof | What stays in the thin dispatch; what is engine; what is voice; how the `--hooks`/`--json` contract is kept whole |

*(Likely skippable — the target tree and the destination split are already settled in this plan's Implementation section; the executor can fold it in. Recorded as evidence, not a gate.)*

### Risks & Assumptions — note on the harness's own seams

This repo **has** an adopted harness (`.harness/engineering-harness.md`, boot = `just test`), so the seam tasks below (`T000` pre-flight, `T013` phase-end) actually fire rather than no-op. They are advisory only and prove the **CLI**, not the markdown skills — the real proof for this plan is the L1 grep + contract diff + behavioural drive.

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: one (dispatch/engine/coach split) — likely skippable, the split is specified in the task table.
- Backpressure coverage: not captured (markdown-only consolidation; deterministic sensors here are grep + diff, named in the Testing Strategy).

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | n | findings folded in from the in-conversation assessment |
| workshops/*.md | n | none |
| backpressure-coverage.md | n | n/a — proof is grep/diff/drive, declared in Testing Strategy |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` markers; the two design forks + Round 1 resolved with the user |
| G2 | Constitution | PASS | Markdown skills + catalog docs only — no CLI-code principle (P2/P3/P10) engaged; Principle 12 (publication boundary) honoured (reorganising existing public content) |
| G3 | Architecture | N/A | No `harness/cli/` layer touched |
| G4 | ADR Compliance | N/A | `docs/adr/` holds no Accepted ADRs |
| G5 | Structure | PASS | All required sections present; cross-refs resolve |
| G6 | Testing Alignment | PASS | Lightweight per spec — structural grep + contract diff + behavioural drive; criteria measurable |
| G7 | Domain Completeness | PASS | Single concept-only domain (no `docs/domains/` registry — same decision as 030); manifest covers every touched file |

### Summary

The 7-skill eng-harness family becomes 2 public skills. `eng-harness-flow` keeps its public hook contract and gains `references/00-routing.md` (engine) + `references/coach.md` (voice) + `references/stages/{boot,backpressure,retro,adopt,add-extension}.md` (harness-blind verbs); the dispatch `SKILL.md` slims to a Registry + Command grammar + invariants. `eng-harness-0-harnessability-assessment` stays public as a peer (cross-refs de-staled). The cut is atomic behind a rollback tag: extract engine + voice, de-leak the modules, rewrite the contract-preserving dispatch, delete the 5 absorbed folders, sweep catalogs, deploy, tidy orphans. Proof is L1 de-leak grep + `--hook`/`--event`/`--hooks`/`--json` byte-parity + a host-call behavioural drive.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `skills/eng-harness-flow/SKILL.md` | eng-harness-skills | contract | The public dispatch surface — rewritten thin; preserves the hook contract |
| `skills/eng-harness-flow/references/00-routing.md` | eng-harness-skills | internal | NEW — routing engine: signals A–J, adoption gate (S0→S4 = the Graph), engineering dispatch, `--json` envelope, `--hooks` manifest, slug resolution, shared conventions |
| `skills/eng-harness-flow/references/coach.md` | eng-harness-skills | internal | NEW — the voice: rail, Orient→Flag→Insight→Suggest→Invite, why-table, Flag beat, unified rail, tone |
| `skills/eng-harness-flow/references/stages/boot.md` | eng-harness-skills | internal | NEW — from `eng-harness-1-boot`, de-leaked |
| `skills/eng-harness-flow/references/stages/backpressure.md` | eng-harness-skills | internal | NEW — from `eng-harness-2-backpressure`, de-leaked |
| `skills/eng-harness-flow/references/stages/retro.md` | eng-harness-skills | internal | NEW — from `eng-harness-4-retro` (drain + harvest + capture guidance), de-leaked |
| `skills/eng-harness-flow/references/stages/adopt.md` | eng-harness-skills | internal | NEW — from `eng-harness-0-adopt`, delegating verb (gate order moves to 00-routing.md) |
| `skills/eng-harness-flow/references/stages/add-extension.md` | eng-harness-skills | internal | NEW — from `eng-harness-0-add-extension` (cleanest) |
| `skills/eng-harness-flow/references/retro.schema.json` | eng-harness-skills | internal | Moved from `eng-harness-4-retro/references/` |
| `skills/eng-harness-flow/references/{getting-started,governance-doc,maturity-assessment}.md` | eng-harness-skills | internal | Kept; getting-started updated to module paths; maturity-assessment is boot's shared-conventions pull target |
| `skills/eng-harness-0-harnessability-assessment/**` | eng-harness-skills | contract | Kept public peer; only cross-refs to retired `eng-harness-0-adopt` de-staled |
| `skills/eng-harness-loop/{eng-harness-1-boot,eng-harness-2-backpressure,eng-harness-4-retro}/` | eng-harness-skills | internal | DELETE (after modules verified) |
| `skills/eng-harness-setup/{eng-harness-0-adopt,eng-harness-0-add-extension}/` | eng-harness-skills | internal | DELETE (after modules verified) |
| `INSTALL.md`, `skills/README.md`, `AGENTS_README.md`, `.harness/engineering-harness.md` | eng-harness-skills | internal | Catalog/docs sweep to the 2-skill surface |
| `CLAUDE.md`, `justfile` | eng-harness-skills | internal | Catalog mention / install-recipe sweep (if present) |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | **Public hook contract is mirrored downstream.** `the-flow`'s `harness-seams.md` carries a versioned mirror of `--hook`/`--event`/`--hooks`/`--json` with a resync procedure. | Preserve byte-for-byte (T006); AC4 diffs against the pre-cutover tag. Relocate the contract text into the engine, never reshape it. |
| 02 | Critical | **Measured flow-leak in 4 of 5 modules.** backpressure (SDD position + `/plan-2d`), boot (`eng-harness-4-retro --harvest`), retro (boot/Improve cross-talk), adopt (names assess + add-extension + `--hook` seams + S0→S4 order). | De-leak per L1 (T004/T005): scrub sibling names, flow-position, hook self-refs, Next-routing; adopt → declared delegation; gate order → Graph. |
| 03 | High | **adopt is itself a mini-flow** (orchestrates assess + add-extension; embodies S0→S4). flow-architecture handles this two ways: declared delegation (exception 2) for sibling protocols; Graph edges for ordering. | adopt.md keeps the install + inject-map-recording procedure and `**Delegates**: assess; add-extension`; the S0→S4 ordering becomes Graph rows in 00-routing.md. |
| 04 | High | **Deploy targets never prune** (`npx skills add` only adds). After source deletion the 5 retired slugs persist in `~/.agents/skills/` + per-CLI views. | T011 — `harness skills update` (prune) + verify no target resolves a retired slug. |
| 05 | High | **Kept-public `assessment` references the retired `eng-harness-0-adopt`** (load-bearing sentinel note + "§ Relationship to adoption"). | T009 sweep de-stales those refs to the `/eng-harness-flow` router (the peer is not a sub-skill, so L1 does not apply — but stale slugs must go). |
| 06 | Medium | **Dispatch SKILL.md is large today (479 lines)** because engine + coach are inline. | Extract engine (T002) + coach (T003) **before** the rewrite (T006) so the thin dispatch has destinations; AC2 caps ~150 lines. |
| 07 | Medium | **The de-leak is not deterministically enforced here** — grep is the L1 minimum; `flow-architecture.sh` lives in the tools repo. | Surface a `harness validate-flow-architecture` extension as the dogfood "encode the fix" follow-up (Non-Goal — own plan). |

### Implementation

**Objective**: Replace the 7-skill eng-harness family with a 2-skill surface (consolidated `eng-harness-flow` + kept `assessment` peer), atomically, behind a tagged rollback anchor, preserving the public hook contract.
**Testing Approach**: Lightweight — structural grep (L1 de-leak), contract byte-parity diff, behavioural drive; no mocks (real files + real deploy).

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T000 | **Harness pre-flight** — `/eng-harness-flow --event pre-implement --plan-dir docs/plans/022-eng-harness-skill-consolidation` | — | — | Router envelope handled; verdict narrated verbatim | _Harness seam — router installed; this repo has an adopted harness so it fires (boot = `just test`), advisory, proves the CLI not the skills_ |
| [ ] | T001 | **Rollback anchor**: `git tag pre-eng-harness-consolidation` on the pre-cutover commit; record the restore one-liner in the execution log — `git checkout pre-eng-harness-consolidation -- skills INSTALL.md skills/README.md AGENTS_README.md .harness/engineering-harness.md CLAUDE.md justfile && just install-skills-global` (restores **both** the skill tree **and** the swept catalog docs, then redeploys) | eng-harness-skills | (repo root) | `git tag -l` shows the tag; restore one-liner (incl. catalog files) logged | User-authorised git write; local tag (no push needed pre-merge) |
| [ ] | T002 | **Establish the new home, then extract the routing engine.** FIRST `git mv skills/eng-harness-loop/eng-harness-flow skills/eng-harness-flow` (the router's new flat home — carries today's `SKILL.md` + the kept `references/`); all subsequent edits write to this final location so no later "move" step is needed. THEN extract into `references/00-routing.md`: detection signals A–J, the adoption gate **S0→S4 as the Graph**, the engineering dispatch table, the precondition/conflict matrix, the `--json` routing envelope, the `--hooks` discovery manifest, slug resolution, and a `## Shared conventions` block (maturity vocabulary, no-time-estimates). Emit a **destination map** in the execution log. | eng-harness-skills | `skills/eng-harness-flow/`, `…/references/00-routing.md` | Skill now lives at `skills/eng-harness-flow/`; `00-routing.md` exists; **destination map recorded in the execution log as a table — one row per `##`/`###` heading of today's SKILL.md, columns `heading → destination (SKILL.md / 00-routing.md / coach.md / DROPPED) → reason`; every heading appears, no DROP without a reason**; `--hooks` manifest + `--json` envelope reproduced **verbatim** (the contract lives here now) | Highest-risk extraction — the destination map is the parity proof (mirrors 030 T002); audited in T010(e) before the irreversible deletion |
| [ ] | T003 | **Extract the coach voice** → `skills/eng-harness-flow/references/coach.md`: the host rail (glyphs, engineering-zone + mid-adoption + unified-with-the-flow forms), the Orient→Flag→Insight→Suggest→Invite contract, the why-table, the Flag beat, the tone rules. | eng-harness-skills | `skills/eng-harness-flow/references/coach.md` | File exists; every Per-turn-UX heading of today's SKILL.md maps to coach.md (or DROPPED-with-reason) in T002's destination map; **the rewritten SKILL.md (T006) carries zero narration/rail/why-table prose — grep-verified** (the voice lives only in coach.md, the dispatch only points to it) | The user's emphasised concern — coaching preserved + centralised, not duplicated back into the dispatch |
| [ ] | T004 | **Stage modules batch 1 (loop)**: `boot.md` (from `eng-harness-1-boot`), `backpressure.md` (from `-2-backpressure`), `retro.md` (from `-4-retro`; carries drain + harvest + in-flight-capture guidance). Stamp each from the sub-skill template; **de-leak** per L1. Move `retro.schema.json` alongside. | eng-harness-skills | `skills/eng-harness-flow/references/stages/`, `…/references/retro.schema.json` | Each module has the contract block + entry/procedure/output/exit; body parity with source minus flow-leak; all `harness` CLI invocations + artifact paths verbatim; boot cites maturity-assessment via shared-conventions pull only | Scrub: backpressure SDD-position + `/plan-2d`; boot's retro ref; retro's boot/Improve cross-talk |
| [ ] | T005 | **Stage modules batch 2 (setup)**: `adopt.md` (from `eng-harness-0-adopt`) and `add-extension.md` (from `-0-add-extension`). adopt becomes a **delegating verb**: keep the install + inject-map-recording procedure; replace sibling calls with `**Delegates**: assess — harnessability survey; add-extension — boot authoring; resolved via the Registry`; the **S0→S4 order moves to 00-routing.md** (not in adopt.md). De-leak both per L1. | eng-harness-skills | `skills/eng-harness-flow/references/stages/{adopt,add-extension}.md` | Same done-when as T004; adopt names no sibling slug and no S0→S4 sequence; delegation declared; add-extension carries no flow knowledge; **per-module elision audit recorded** — diff each module's Entry/Procedure/Output against its source skill and mark every removed block as `(graph-owned → 00-routing.md)`, `(coach-owned → coach.md)`, or `(removed — flow-leak, no equivalent)`, proving orchestration survived the split rather than vanished | The load-bearing de-leak — adopt is a mini-flow; not a mechanical find-replace |
| [ ] | T006 | **Rewrite the dispatch `SKILL.md`** (thin): frontmatter (preserve the activation `description` triggers), `## Registry` (hook↔verb↔module, incl. the `coding`→`harness observe` CLI row), `## Command grammar` (`--hook`/`--event`/`at=`), the stateless-contract invariants, the progressive-disclosure rule, and `--help`. **Preserve the `--hook`/`--event`/`--hooks`/`--json` contract byte-for-byte** (detail lives in 00-routing.md; SKILL.md points to it). | eng-harness-skills | `skills/eng-harness-flow/SKILL.md` | ≤ ~150 lines (`wc -l`); **frontmatter (`name` + the activation `description`) preserved verbatim** (the skill must keep triggering — a dropped/reshaped description makes it invisible to skill discovery); Registry maps boot/backpressure/retro/adopt/add-extension by verb → module + the `coding` CLI row; contract surface unchanged vs tag | **Blocks on T002–T005** (engine/voice/modules already at the flat home from T002) |
| [ ] | T007 | **Update bundled references** (the flat home was established in T002): update `getting-started.md` (the 5 retired slugs → the new module/router surface); confirm `governance-doc.md` + `maturity-assessment.md` carried over intact. | eng-harness-skills | `skills/eng-harness-flow/references/` | `getting-started.md` carries zero references to the 5 retired slugs (outside any history footnote) — every routed step names a module/verb or the router; governance-doc + maturity-assessment present and link-valid post-move | maturity-assessment stays the shared-conventions pull target for boot |
| [ ] | T008 | **Atomic deletion + peer relocation**: FIRST `git mv skills/eng-harness-setup/eng-harness-0-harnessability-assessment skills/eng-harness-0-harnessability-assessment` (relocate the kept peer to its flat home, with its `templates/`); THEN remove the 5 absorbed source folders and the now-empty `eng-harness-loop/` / `eng-harness-setup/` grouping folders. | eng-harness-skills | `skills/eng-harness-loop/*`, `skills/eng-harness-setup/*` | `skills/` shows exactly `eng-harness-flow/` + `eng-harness-0-harnessability-assessment/`; the 5 retired folders gone; loop/setup grouping folders gone; peer's `templates/` intact at the new path | Tag from T001 is the restore path. **Blocks on T004–T007**; T009 sweep runs after this (peer already at final path) |
| [ ] | T009 | **Catalog sweep** (runs after T008 — peer at final path). FIRST a **pre-audit inventory**: `grep -rn` the 5 retired slugs + sibling-name patterns across the whole tree (excluding `docs/plans/**`) and record which file names which slug + why, so the sweep scope is known, not discovered mid-edit (030 learned this — narrative chapters + util cross-refs leaked). THEN rewrite to the 2-skill surface: `INSTALL.md`, `skills/README.md`, `AGENTS_README.md`, `.harness/engineering-harness.md` (injection map), `CLAUDE.md`/`justfile` (if they list skills); de-stale the kept `assessment` peer's `eng-harness-0-adopt` refs (its SKILL.md ~L104 sentinel, ~L152, ~L869 "Relationship to adoption") → the `/eng-harness-flow` router. | eng-harness-skills | (listed files) | Pre-audit inventory logged; post-sweep grep for the 5 retired slugs across live surfaces (excluding `docs/plans/**` + the dispatch slug-resolution note) returns zero; counts accurate; assessment peer carries no retired-slug ref | Per findings 04/05 |
| [ ] | T010 | **Structural proof** (before the irreversible deletion where possible): (a) **L1 de-leak grep** across `references/stages/*.md` — explicit patterns: the 5 sibling slugs `eng-harness-(0-adopt\|0-harnessability-assessment\|0-add-extension\|1-boot\|2-backpressure\|4-retro)`, flow-position (`plan-1b`, `plan-2c`, `plan-3`, `plan-2d`), lifecycle-hook self-refs (`--hook`, `pre-flight`, `post-coding`…), and `^#+ *Next (routing\|step)` / `\*\*Next` markers → **all return zero**; (b) **contract parity** — `git diff pre-eng-harness-consolidation -- ` the relocated contract sections shows them moved to `00-routing.md` unchanged in meaning (hook names, seam→hook alias map, `--hooks` nine-field shape + `manifest_version`, `--json` envelope field set), AND a behavioural drive (`/eng-harness-flow --hooks --json` and `--hook pre-flight --json`) returns output identical to the pre-tag router; (c) `wc -l SKILL.md` ≤ ~150; (d) **per-module structure review** — each of the 5 modules carries the contract block (Verb/Purpose/Consumes/Flags/Produces/Side effects), entry/procedure/output/exit, and the byte-exact constant Exit line; (e) **destination-map completeness** — every `##`/`###` heading of the pre-tag SKILL.md appears in T002's map with a destination (no silent drop). | eng-harness-skills | (repo-wide) | All five checks pass; output captured in the execution log | AC2, AC3, AC4, AC5 |
| [ ] | T011 | **Deploy + tidy**: `just install-skills-global` (or `harness skills update --target … --global`, which prunes — plain `npx skills add` never does) → prune the 5 retired slugs from all deploy targets → verify no target resolves a retired slug. | eng-harness-skills | (deploy targets) | Deploy succeeds; before/after orphan listing captured; canonical store carries the 2-skill surface. **Failure = the 5 retired slugs persist after tidy OR the 2-skill surface isn't deployed → roll back via the T001 tag**; pre-existing unrelated deploy noise (network/permissions/other-family drift) is acceptable, not a blocker | Per finding 04; AC11 |
| [ ] | T012 | **Behavioural drive**: (a) `/eng-harness-flow --hook pre-flight --json` and `--hooks --json` return the identical contract (diff vs the pre-tag output); (b) **each route loads only its intended module** — verified by driving a route, confirming the routed module's unique marker text appears in the response, AND that no *other* module's marker appears (the progressive-disclosure proof: one module per route, never all five); (c) the guided coach path renders the rail + the Orient→Flag→Insight→Suggest→Invite beats from coach.md. Record outputs + the module-load grep evidence in the execution log. | eng-harness-skills | (deployed skill) | All three observations recorded with concrete evidence (not assertion) | AC4, AC8, AC12 |
| [ ] | T013 | **Harness phase-end** — `/eng-harness-flow --event phase-end --plan-dir docs/plans/022-eng-harness-skill-consolidation` | — | — | Router envelope handled at phase end | _Harness seam — advisory; fires against this repo's adopted harness_ |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 (2-skill surface; folders gone) | T008 | `ls skills/` |
| AC-02 (thin dispatch ≤~150 lines) | T006 | T010(c) `wc -l` |
| AC-03 (5 harness-blind modules, template-stamped) | T004, T005 | T010(a) L1 grep + T010(d) per-module structure review |
| AC-04 (contract byte-parity) | T002, T006 | T010(b) diff, T012(a) drive |
| AC-05 (L1 de-leak clean) | T004, T005 | T010(a) grep |
| AC-06 (delegation + gate-order split + shared-conventions pull) | T002, T005 | per-module review |
| AC-07 (coding = CLI row, no module) | T006 | Registry inspection |
| AC-08 (coach extracted; UX preserved) | T003 | T012(c) drive |
| AC-09 (rollback tag + restore line) | T001 | `git tag -l`; execution log |
| AC-10 (catalog sweep; peer de-staled) | T009 | grep for retired slugs |
| AC-11 (deploy + prune) | T011 | orphan listing |
| AC-12 (behavioural drive) | T012 | execution log |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Public hook contract drifts | Medium | High | T006 byte-parity; AC4 diff vs tag; relocate-not-reshape |
| **Activation `description` frontmatter dropped/reshaped in the rewrite → skill goes invisible to discovery** | Medium | High | T006 done-when + AC2: frontmatter (`name` + `description`) preserved verbatim |
| De-leak drops domain content | Medium | High | Per-module diff vs source; CLI verbs + artifact paths kept verbatim |
| adopt orchestration lost | Low | High | T005 names the delegation + gate-order split explicitly |
| Dispatch balloons | Medium | Medium | AC2 cap; engine + coach extracted first |
| Stale deployed slugs shadow new layout | High (without T011) | Medium | T011 prune + verify |
| Self-reference (consolidating the router this repo's harness uses) | Low | Low | Deploy last; T012 post-cutover drive |

### Harness Seams

- **Entry point**: `/eng-harness-flow --event <seam> [--phase <id>] [--plan-dir <p>] --json` — the single door; child skills never named.
- **Pre-implement** (`--event pre-implement`): T000; fires against this repo's adopted harness (boot = `just test`). Verdict vocabulary `healthy / SLOW / UNHEALTHY / UNAVAILABLE`; advisory.
- **Phase end** (`--event phase-end`): T013; `--event plan-complete` fires at merge.
- **Best-effort**: all advisory, never blocks. Note the recursion — the plan consolidates the very router this repo's harness routes through; the seams prove the CLI suite, not the markdown skills (those are proven by T010/T012).

---

## Validation Record (2026-06-17)

### Validation Thesis

**Raison d'être**: Guide a reversible, contract-preserving consolidation of the 7-skill eng-harness family into a 2-skill surface (consolidated `eng-harness-flow` router + kept-public `eng-harness-0-harnessability-assessment` peer), per the flow-architecture pattern, so the file layout matches the "one door" architecture the router already declares.

**Value claim**: Cheaper skill maintenance (one dispatch + lazy modules vs 7 skills), clearer public surface (2 vs 7), stronger centralised coaching — without breaking the downstream `the-flow` mirror of the hook contract.

**Artifact promise**: An implementer can execute the consolidation step-by-step with measurable done-whens, preserving the `--hook`/`--event`/`--hooks`/`--json` contract, with a tagged rollback.

**Intended beneficiaries**: the implementer agent; future skill maintainers; harness consumers (one door); `the-flow` (whose `harness-seams.md` mirror must not break).

**Proof target**: Implementation.

**Evidence standard**: testable done-whens; L1 de-leak grep; contract section-diff + behavioural output-parity drive; rollback path; catalog sweep coverage; per-module de-leak parity.

**Thesis source**: User request (this session) + the plan's Goals/Summary + the 030 worked example + `flow-architecture.md` (the upstream ruleset).

**Thesis verdict**: Partially advanced → **advanced** after fixes (proof-level gaps closed in the done-whens).

**Main thesis risk**: Public hook-contract drift breaking `the-flow`'s mirror, or an incomplete engine extraction masked by a surface-only parity check — both now mitigated by the strengthened T010(b)/(e) + the T006 frontmatter clause.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| Coherence & Completeness | Coherence, Completeness, Proof-Level Fit, Evidence Sufficiency, Hidden Assumptions, Edge Cases, Concept Documentation | Implementation Readiness, Evidence Sufficiency | 2 CRITICAL, 2 HIGH, 7 MEDIUM, 1 LOW — all fixed/addressed | ⚠️ → ✅ |
| Thesis Alignment | Thesis Alignment, Evidence Sufficiency, Proof-Level Fit, User/Product Value Preservation | Thesis Alignment, Proof-Level Fit, Value Preservation | 2 HIGH, 4 MEDIUM, 2 LOW — addressed (done-whens tightened; coach done-when strengthened) | ⚠️ → ✅ |
| Forward-Compatibility & Risk | Forward-Compatibility, Integration & Ripple, Deployment & Ops, Technical Constraints, Risk | Downstream Usefulness, Contract Integrity | 1 HIGH (frontmatter), 2 MEDIUM — all fixed; **all de-leak claims verified real** | ⚠️ → ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `the-flow` `references/harness-seams.md` | Hook contract byte-stable (5 hooks, `--event` map, `--hooks` shape, `--json` fields) | contract drift | ✅ MITIGATED | T002 verbatim relocation + T006 byte-parity + T010(b) section-diff & behavioural drive; `harness-seams.md` declares `harness_seam_contract: v1` + resync |
| `the-flow` `5 tasks` / `6 implement` | Executable Simple-mode task table + rollback | shape mismatch | ✅ MITIGATED | 14-row task table, all with done-whens; T001 tagged rollback (restore incl. catalog files) |
| Future skill maintainers | De-leak rules + layout encoded; L1 enforceable | test boundary | ⚠️ PARTIAL | L1 grep patterns named in T010(a) + documented in `00-routing.md` § Shared conventions; deterministic `validate-flow-architecture` extension deferred (Non-Goal 07) |
| Deploy targets (`~/.agents/skills/`) | 5 retired slugs pruned, no shadowing | encapsulation lockout | ✅ MITIGATED | T011 `harness skills update` prunes (`npx skills add` never does); AC11 verify |
| `assessment` peer | Stale `eng-harness-0-adopt` refs de-staled | contract drift | ✅ MITIGATED | T008 relocates peer first; T009 de-stales ~L104/152/869 → router |

**Thesis alignment**: The plan advances its value claim (7→2 surface, harness-blind verbs, centralised coach) at the Implementation proof level once the de-leak grep + contract section-diff + behavioural parity drive are executed; the main residual risk — contract drift — is closed by relocate-not-reshape + a behavioural parity check.

**Outcome alignment**: The plan, as written, advances the VPO Outcome ("take it all of skills/ both loop and setup into one router skill") by consolidating 7 public skills into 2 and preserving the `--hook`/`--event`/`--hooks`/`--json` contract byte-for-byte through explicit extraction, relocation, and diff-proofing tasks — provided T002/T006/T010 deliver the destination map and contract parity evidence, and T009/T011 complete the de-staling and deploy-prune without the promised CI enforcement (which remains deferred).

**Standalone?**: No — downstream consumers exist (`the-flow`'s implement verb + its `harness-seams.md` contract mirror).

Overall: ⚠️ **VALIDATED WITH FIXES**
