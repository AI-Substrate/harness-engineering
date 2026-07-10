# Research Dossier: environment-first posture (don't apologise — fix) across builder + eng-harness-flow

**Generated**: 2026-07-09T11:05:00+10:00
**Query**: "Encode the environment-first posture (don't apologise — fix) across builder + eng-harness-flow: 4-layer directives, narrowed harness-blind rule, recommendation-led retro drain with dispositions (CLI schema + fingerprint), letter-code purge, excursion-node mid-flow fixes, flow-eval planted-friction scenario, telemetry sufficiency for tripwires"
**Effort**: Standard (lead-only — the change surface is this repo's own skills + CLI, largely held in session context)
**Tools**: Standard
**Evidence**: 13 current sources · 3 historical sources

## Answer

1. All four directive layers have concrete, verified anchor points; the per-turn channel (template `instructions[]` → `harness flow orient`) is proven live CLI machinery, and new-flows-only is mechanical (the template is read once, at `create`).
2. The harness-blind rule is stated in ~4 places, one of which sits **inside the byte-mirrored doctrine-parity block** guarded by real code (`doctrine-parity.ts` + test) — narrowing the rule requires updating both mirror copies in lockstep or the suite fails.
3. Dispositions have a natural home: the retro record template **already carries** a `system.compound.status` convention (`open|suggested|encoded|wontfix|stale|dismissed`); the drain-time disposition set extends this existing seam rather than inventing one, but the canonical `retro.schema.json` and a pinning unit test must move together.
4. Telemetry today can measure observe *volume* (`harness` verb events) and friction *proxies* (`command_exit` non-zero exits) but **cannot see dispositions, observation kinds, or recurrence** — the closed-vocab artifact pipeline (`ArtifactType` + `ArtifactCountKey`) is the designed extension point (additive enum entries + a retro extractor), keeping the "counts + enums only, no free text" privacy contract.
5. The retro presentation rewrite lands in one file (`retro.md` § Step 2) plus a posture line in eng-harness-flow's `coach.md`; the four letter-code leaks are all in builder references.
6. Source of truth for every skill edit is the repo's `skills/` tree (plan 055: vendored, baked into the npm build); the installed `~/.claude-alt/skills/` copies are deployment artifacts — deploy order stays CLI-first-then-skills.

## Evidence

| ID | Finding | Evidence | Planning implication | Confidence |
|----|---------|----------|----------------------|------------|
| F-01 | The template seeds 10 nodes each carrying 3 authored `instructions[]`; phase (`phase-1`) and observe (`observe-1`) nodes are the posture-line targets | `skills/builder/references/flight-plan.template.json` | Layer 2 = edit 2–3 nodes' instructions + the expander inherits for phases 2..N (same doctrine) | High |
| F-02 | `harness flow orient` prints the `nav.now` node's `instructions[]` every turn — the compaction-proof per-turn channel already exists (CLI 0.10.0) | `harness flow orient` live run; `skills/builder/SKILL.md` invariant #12 | No new machinery needed for the mid-work reminder; only template text | High |
| F-03 | The doctrine-parity guard is code: it diffs the `doctrine-parity:039` block between `skills/eng-harness-flow/SKILL.md` and the-flow's `harness-seams.md` (candidate-path list, standalone-tolerant) | `harness/cli/src/services/doctrine-parity/doctrine-parity.ts:7,49` + `test/services/doctrine-parity/` | The anti-fake rule inside the mirrored block names `observe`; any wording change must land in both copies byte-identically or `just test` fails | High |
| F-04 | The harness-blind rule is stated in ≥4 places: builder SKILL.md invariant #9, `00-routing.md` § Harness router posture, `harness-seams.md` inversion ¶ (line 5), eng-harness-flow § Progressive disclosure | `skills/builder/SKILL.md:97`; `skills/builder/references/00-routing.md:292`; `skills/builder/references/harness-seams.md:5`; `skills/eng-harness-flow/SKILL.md` | The narrowing (orchestration-blind, `harness observe` allowed) must touch all statements consistently — one canonical statement + citations | High |
| F-05 | Letter-code leaks are 4 builder files (the eng-harness-flow mentions are the *ban*, keep those) | `skills/builder/references/coach.md:291`, `harness-seams.md:104`, `getting-started.md:182`, `flight-plan.example.json:100` | Small mechanical purge; example.json is data not doctrine — reword its `note` | High |
| F-06 | The drain presentation is one section: two stacked option menus (save: yes/pick/skip → fixes: tasks/plan/diffs/command) | `skills/eng-harness-flow/references/stages/retro.md:147-189` | Rewrite target for the recommendation-led numbered format; Decision-2 routes map 1:1 onto the disposition vocabulary | High |
| F-07 | Observe buffer entries have no disposition or fingerprint: `{id, kind, description, target?, severity?, workaround?, suggested_encoding?, first_seen_at}` | `harness/cli/src/services/observe/buffer-codec.ts:30` | Fingerprint (recurrence key) is a new field or derived hash; buffer codec + tests change | High |
| F-08 | The retro record template (v1.1) already carries a per-entry `system.compound.status` convention: `open \| suggested \| encoded \| wontfix \| stale \| dismissed` | `harness/cli/src/services/record/core-types/retro.ts:40-44` | Dispositions extend an existing seam; the canonical schema is `skills/eng-harness-flow/references/retro.schema.json` (the retro.ts header comment points at a retired `eng-harness-loop` path — fix in passing) and `retro-template.test.ts` pins template⊆schema | High |
| F-09 | Telemetry events are a closed set; `HarnessEvent` carries **verb only** (observe calls countable, kinds invisible); `ArtifactType` has **no `retro`**; counts/enums are closed unions mirrored in `segment.schema.json` (`additionalProperties: false`) | `harness/cli/src/services/telemetry/events.ts:52,77-160,265` | Disposition telemetry = additive vocab (`retro` artifact type + disposition count keys) + a retro-record extractor in `artifact-semantics.ts` + schema mirror updates — privacy contract preserved by construction | High |
| F-10 | `command_exit {verb, exit}` events exist — non-zero exits are a deterministic friction proxy for the friction→observe conversion tripwire | `harness/cli/src/services/telemetry/events.ts:278` | The tripwire is computable as ratio(observe `harness` events : non-zero `command_exit`) without new capture plumbing | Medium |
| F-11 | flow-eval has a full scenario/scorer stack (two-axis process/capability, weighted assertions, fixtures dir, judged-not-scored fields) | `.harness/extensions/flow-eval/scorer.ts:6-17`, `scenario.ts`, `fixtures/` | The planted-friction scenario is an additive fixture + assertions; no scorer redesign | High |
| F-12 | Skills are vendored & baked into the npm build (plan 055); repo `skills/` is the single editable source; `the-flow` skill is a thin redirect to builder | `docs/plans/055-vendor-builder-baked-skills/vendor-builder-baked-skills-plan.md`; `skills/README.md` | All edits land in repo `skills/`; ship via the existing package path; deploy CLI before skills (SKILL.md § Prerequisite) | High |
| F-13 | The telemetry field reference (both committed files' full vocabularies) shipped 2026-07-07 as a single HTML page | `docs/how/telemetry-field-reference.html` (commit `6a3ddada`) | The telemetry-sufficiency task has its baseline doc; extend it when vocab grows | High |

## Historical Evidence

| ID | Prior friction / decision | Source | Applicability now | Implication |
|----|---------------------------|--------|-------------------|-------------|
| H-01 | Plan 044 already fought the arcane-retro battle: it produced the current two-decision plain-language closeout and the coach ban on letter codes — yet the builder-side references still leak the codes | `docs/plans/044-eng-harness-flow-mission-first/` | Direct | The rewrite supersedes 044's Step-2 format; purge the leaks 044 missed; don't reintroduce menu-speak |
| H-02 | Plan 040 (D1) established the template-as-single-seed + per-node `instructions[]` + orient channel, and deleted skill-side chore copies to kill drift | `docs/plans/040-flow-template-orient-instructions/` (+ workshop 001 chore-shape) | Direct | Posture lines follow the same doctrine: author once in the template, expander propagates; never fork the chore shape |
| H-03 | Plan 055 vendored the builder skill family into this repo with a skills lock + baked npm packaging | `docs/plans/055-vendor-builder-baked-skills/` | Direct | Confirms edit-here-ship-everywhere; installed copies are never edited directly |

## Risks and Unknowns

| Item | Evidence | Why it matters | Resolution / next evidence |
|------|----------|----------------|----------------------------|
| Parity-block edit risk | F-03 | A one-sided edit to the mirrored 039 block breaks `just test` (or silently forks doctrine if the guard's coverage is narrower than assumed) | Read `doctrine-parity.ts` fully at plan time; make the narrowed-rule wording land outside the block if possible, else update both copies in one commit |
| Retro schema is a pinned contract | F-08 | `retro-template.test.ts` pins template⊆schema; schema_version bump semantics (1.1→1.2?) undefined | Decide at plan time: additive optional field (no bump) vs version bump; update schema + template + test together |
| Disposition telemetry crosses the privacy allowlist | F-09 | Every new count/enum key must stay counts-only; disposition *reasons* (prose) must never travel | Design the vocab as closed enums; reuse the AC-05 extractor gate pattern |
| Observation fingerprint design is open | F-07 | Recurrence-matching needs a stable key (kind+target+normalized description?) — too loose = false matches, too tight = no matches | Workshop/plan decision; start simple (kind+target hash), validate against real buffers |
| Telemetry can't see drain *presentation* quality | F-09, F-10 | The "drains become conversations" tripwire isn't telemetry-measurable | Accept: that tripwire is flow-eval's (F-11) + human judgement; don't force it into counts |

## Planning Handoff

- **Preserve**: the frozen router contract (5 hooks, `--event`, `--json`, `--hooks`); never-gate posture; template/doctrine single-source (no skill-side chore copies); telemetry privacy-by-construction (closed vocabs, no free text); print-then-offer; CLI-first deploy order.
- **Change carefully**: the doctrine-parity mirrored block (both copies, one commit); `retro.schema.json` + `RETRO_TEMPLATE` + pinning test as a trio; `events.ts` unions + `segment.schema.json` mirrors as a pair.
- **Likely files/symbols**: `skills/builder/SKILL.md` (new invariant), `skills/builder/references/flight-plan.template.json` (phase/observe instructions), `skills/builder/references/{harness-seams.md, coach.md, getting-started.md, flight-plan.example.json, 00-routing.md}`, `skills/builder/references/stages/{60-implement.md, 50-phase-tasks.md}`, `skills/eng-harness-flow/{SKILL.md, references/coach.md, references/stages/retro.md, references/retro.schema.json}`, `harness/cli/src/services/observe/buffer-codec.ts`, `harness/cli/src/services/record/core-types/retro.ts`, `harness/cli/src/services/telemetry/{events.ts, artifact-semantics.ts, segment.schema.json}`, `.harness/extensions/flow-eval/` (scenario fixture + assertions).
- **Decisions still required**: fingerprint algorithm; schema-version bump vs additive field; whether the narrowed harness-blind wording can live outside the parity block; disposition enum final set; whether observe-kind telemetry (beyond verb counts) is in scope now or rides the workshop's telemetry-enhancement outcomes.
