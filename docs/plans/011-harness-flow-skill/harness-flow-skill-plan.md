# eng-harness-flow + Governance Refactor — Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-09
**Spec**: [harness-flow-skill-spec.md](./harness-flow-skill-spec.md)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` markers remain in spec; confidence 0.80 |
| G2 | Constitution | PASS | `constitution.md` governs the **CLI Core** (`harness/cli/`); this plan touches **no CLI source** (`harness init` deferred). Principle 12 (publication boundary) honoured — all content public-safe |
| G3 | Architecture | PASS | `architecture.md` governs CLI ports/adapters/acts/services; no file under `harness/cli/src/` is touched — skill/reference markdown + `.minih.json` only. No layer boundary crossed |
| G4 | ADR Compliance | N/A | No `docs/adr/` |
| G5 | Structure | PASS | All required Simple-mode sections present |
| G6 | Testing Alignment | PASS | Spec testing = Lightweight; validation tasks (T013–T015) present |
| G7 | Domain Completeness | PASS | Every spec domain mapped; no NEW formal domain (repo has no domain registry — constitution §5); Domain Manifest covers all referenced files |

## Summary

Add **`eng-harness-flow`** — a stateless harness-loop router skill that, on each invocation, re-derives where the work sits on the loop (from deterministic repo signals + conversation + an optional parent hint) and routes to the single correct harness skill, owning no artifacts. Bundle the **no-new-CLI** governance refactor (G1–G5): relocate the governance doc to `.harness/engineering-harness.md` with a canonical-first read order across all four readers, ship two canonical reference docs (`governance-doc.md`, `maturity-assessment.md`), move the L0–L4 ladder out of the boot skill, make boot read-only, and document `.harness/history.md` changelog semantics + governance write conditions. The *writer* (governance inception via `harness init`) is **deferred to the next plan**; until then the router/boot degrade gracefully to `UNAVAILABLE` when no governance doc exists.

## Target Domains

> Informal — this repo has no `docs/domains/registry.md` (constitution §5: domain system not yet initialized). Rows are the harness **skill families / artifact areas** touched, for traceability only.

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| `eng-harness-loop` | existing | **create + modify** | New `eng-harness-flow/` skill lives here; edit `eng-harness-1-boot` (G2 ladder move, G4 read-only), `eng-harness-2-backpressure` + `eng-harness-4-retro` (G1 read order) |
| `eng-harness-setup` | existing | **modify** | G1 path update in `eng-harness-0-harnessability-assessment` SKILL.md + template; router *delegates* to `eng-harness-0-setup` (no behavioural change to setup in this plan) |
| `.harness/` (tracked artifacts) | existing | **modify** | New canonical home for `engineering-harness.md` (G1); `history.md` changelog semantics documented (G3) — file itself stamped later by deferred `harness init` |
| `.minih.json` (config) | existing | **modify** | Add `eng-harness-flow` to `include` (source path `skills/eng-harness-loop` already present) |

No NEW formal domain is established.

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `skills/eng-harness-loop/eng-harness-flow/SKILL.md` | eng-harness-loop | contract | New public skill (the router) |
| `skills/eng-harness-loop/eng-harness-flow/references/governance-doc.md` | eng-harness-loop | contract | Canonical reference: governance doc contents + write conditions (G3/G5) |
| `skills/eng-harness-loop/eng-harness-flow/references/maturity-assessment.md` | eng-harness-loop | contract | Canonical reference: L0–L4 ladder + how to assess (G2) |
| `skills/eng-harness-loop/eng-harness-1-boot/SKILL.md` | eng-harness-loop | internal | G1 read order; G2 remove inline ladder → link; G4 read-only |
| `skills/eng-harness-loop/eng-harness-2-backpressure/SKILL.md` | eng-harness-loop | internal | G1 read order (corroboration-only role unchanged) |
| `skills/eng-harness-loop/eng-harness-4-retro/SKILL.md` | eng-harness-loop | internal | G1 read order (line ~414) |
| `skills/eng-harness-setup/eng-harness-0-harnessability-assessment/SKILL.md` | eng-harness-setup | cross-domain | G1 read order (lines ~735–737) |
| `skills/eng-harness-setup/eng-harness-0-harnessability-assessment/templates/assessment-latest.md` | eng-harness-setup | cross-domain | G1 read order (lines ~57, 68) |
| `.minih.json` | config | internal | Add `eng-harness-flow` to `include` |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | High | **Boot is currently a *writer*, not just a reader.** `eng-harness-1-boot/SKILL.md` Step 5 (lines ~111–117) updates `## Maturity Assessment`, the `**Maturity Level**` header, **and** appends to `## History`; the "Measure compounding value" section (~145–147) narrates that History trajectory. | G4: make Step 5 **report-only** — remove all three writes; reword the compounding-value section to point at the `.harness/history.md` changelog instead of claiming boot appends. |
| 02 | High | **The L0–L4 ladder lives inside boot** (`eng-harness-1-boot/SKILL.md` lines ~151–161), with a *separate* unnumbered "capability axis" at ~163+. | G2: move **only the L0–L4 ladder** into `references/maturity-assessment.md`; boot links to it. Leave the capability axis in boot (it is not the maturity ladder) or relocate alongside — decide during T011; default keep in boot. |
| 03 | Medium | **The governance path is referenced widely**, most heavily in boot (frontmatter `description`, Step 0 read order lines ~35–37, and inline at ~3, 11, 56, 68, 75, 82, 94, 113, 141, 171). Retro references it once (~414); harnessability at ~735–737 + template ~57, 68. Backpressure references it only as **corroboration-only / often-absent** (~56, 66, 101, 188) — it never preconditions on it. | G1: prepend `.harness/engineering-harness.md` as canonical #1 across boot/retro/harnessability(+template); update boot's Step 0 chain to four entries. For backpressure, update the read-order mention only; keep its corroboration-only stance. |
| 04 | Medium | **`.minih.json`** lists `path:skills/eng-harness-loop` as a source but its `include` array enumerates explicit slugs and omits the new skill. | G2/D2: add `eng-harness-flow` to `include`; no new source path needed. |
| 05 | Medium | **The router SKILL.md is the bulk of the effort** — it must faithfully encode signals A–J, the 5-step setup gate (boot-last), the Diagram-2 routing, the conflict matrix, the parameter contract + `--json` envelope, and the two-zone per-turn UX. | T001–T003: author directly from the authoritative workshop `001-harness-flow-entry-points.md`; do not contradict it. |
| 06 | Low | **`.harness/history.md` is not created by this plan.** The *writer* (`harness init`) is deferred; this plan only **documents** the changelog semantics in `governance-doc.md`. | G3: document, do not stamp the file. Avoid creating an empty `history.md` (that is inception/`harness init`'s job). |
| 07 | **High** | **Retro is a downstream *consumer* of boot's `## History`.** `eng-harness-4-retro/SKILL.md` (~line 414, with the JSON example at ~400–402) parses the governance doc's `## Maturity Assessment` + `## History` to emit `harness: { maturity, last_validation, boot_ms, verdict }`. G4 stops boot writing `## History` and G3 moves trajectory to `.harness/history.md`, so retro's parse goes **stale** — a path-only fix (the old T010) is insufficient. | G3/G4: reconcile retro **semantics** (new T015): read current maturity snapshot from `.harness/engineering-harness.md`; treat `.harness/history.md` as the sparse changelog if present; `null` any field with no live source; update the example JSON. |
| 08 | Medium | **`eng-harness-0-setup` explicitly generates no governance doc** (SKILL.md lines 9, 176) — `harness init` is the (deferred) provisioner with a graceful fallback (lines 67, 70, 88). So the router must **not** claim setup "provisions" S2 governance; it can only route to setup / attempt `npx harness init`, then report `UNAVAILABLE`. | Tighten router wording (T001) + add T016 to keep the deferred-writer boundary honest and add the `governance-doc.md` links boot/setup owe (AC11). |
| 09 | Low | **A non-reader fixture carries the old canonical path**: `…/harnessability-assessment/templates/assessment-latest.json` (lines ~33, 161) hard-codes `docs/project-rules/engineering-harness.md`. | G1: include the `.json` template in the sweep (T010) + validation (T012), or it reintroduces drift / fails a broad grep. |

## Implementation

**Objective**: Ship the stateless `eng-harness-flow` router skill and the no-new-CLI governance refactor (G1–G5), grounded in the authoritative workshop, without touching CLI source.
**Testing Approach**: **Lightweight** — structure validation + grep consistency checks + keep the existing `harness/cli` vitest suite green. No mocks (markdown authoring).

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | Author the router **SKILL.md** core: stateless contract (writes nothing, re-derives every call, never gates/scores/blocks, never runs `minih`/`/compact`, never invents a health verdict — defers to `harness doctor`); detection **signals A–J**; the **setup gate** S0 install → S1 scout → S2 governance → S3 inject → **S4 build+run boot last**; the **⚙️ engineering dispatch** (boot → backpressure → observe → retro-drain → retro-harvest → improve); the rule that the gate never crosses into engineering until S0+S2+S4 hold and routes the first missing required rung with a one-line *why*. **Honesty re deferred writer**: for S2 governance / S3 inject, the router says the rung is **owed** and routes to setup / an attempted `npx harness init` — it must **not** claim setup unconditionally "provisions" governance (the writer is deferred); if unsupported, report `UNAVAILABLE` | eng-harness-loop | `skills/eng-harness-loop/eng-harness-flow/SKILL.md` | SKILL.md exists, well-formed front-matter, and contains the stateless-contract statement + signals A–J + setup gate (boot-last) + engineering dispatch + the owed-not-provisioned wording for S2/S3, mirroring the workshop | AC 1,3,4,5,15 · Findings 05,08 |
| [x] | T002 | Add the **parameter contract** (`at=` / `--event` / `--plan-dir` / `--spec` / `--phase` / `--prompt-optional` / `--repo` reserved-v2 / `--json`), the **conflict matrix** (`route`/`redirect`/`noop`/`ambiguous` — incl. `at=boot` w/o governance → redirect+`missing_rung`; `at=retro-harvest` w/ non-empty buffer → redirect drain-first; `>1` plan, no `--plan-dir` → ambiguous+ask), **slug resolution** (friendly→exact slug, never guess a version suffix), and the **`--json` envelope** with the AC-8 fields | eng-harness-loop | `…/eng-harness-flow/SKILL.md` | All four documented; `--json` envelope lists `requested_stage, actual_stage, decision, command, why, produces, preconditions_met, missing_rung, next_suggested, rail, now, next, flags, insight` | AC 6,7,8 |
| [x] | T003 | Add the **per-turn UX**: two-zone host **rail** (setup fill-bar `🧰 ●─●─◐─○─○` + engineering loop `⚙️ … ↺`, recomputed from substrate each call), **Orient → Flag → Insight → Suggest → Invite**, the **Flag beat** (lift-not-derive, capped, silent-when-clean, never a gate), **print-then-offer** one-step-per-turn / nothing irreversible without go-ahead | eng-harness-loop | `…/eng-harness-flow/SKILL.md` | UX section present and matches the workshop's §User experience | AC 9 |
| [x] | T004 | Create **`references/governance-doc.md`**: what the governance doc contains (boot cmd / health / interact / observe / signal inventory / evidence paths / back-pressure gaps / current maturity snapshot); **G3** `.harness/history.md` = sparse changelog (one row per *encoded improvement*, not per session/boot); **G5** write conditions (inception once; body + maturity snapshot change only at the Improve beat; doc holds only the current snapshot) | eng-harness-loop | `…/eng-harness-flow/references/governance-doc.md` | File exists and documents contents + history-changelog semantics + write conditions | AC 11,12,14 · Finding 06 |
| [x] | T005 | Create **`references/maturity-assessment.md`**: the canonical **L0–L4** ladder (moved verbatim from boot) + how to assess (which signals map to which rung) | eng-harness-loop | `…/eng-harness-flow/references/maturity-assessment.md` | File exists; contains the single canonical L0–L4 ladder | AC 11 · Finding 02 |
| [x] | T006 | Add `eng-harness-flow` to **`.minih.json`** `include`; confirm discovery | config | `.minih.json` | `include` contains `eng-harness-flow`; `harness skills` (or minih resolution) lists it; no new source path added | AC 2 · Finding 04 |
| [x] | T007 | **Boot G1**: update frontmatter `description`, Step 0 read-order (→ 4-entry canonical-first chain), and every inline path mention to canonical-first `.harness/engineering-harness.md` → `docs/project-rules/engineering-harness.md` → `agent-harness.md` → `harness.md` | eng-harness-loop | `…/eng-harness-1-boot/SKILL.md` | Grep shows boot reads canonical-first; no mention claims `docs/project-rules/...` is the *sole* canonical path | AC 10 · Finding 03 |
| [x] | T008 | **Boot G2**: remove the inline L0–L4 ladder (lines ~151–161); replace with a one-line link to `references/maturity-assessment.md`. Keep the capability axis in place | eng-harness-loop | `…/eng-harness-1-boot/SKILL.md` | Boot no longer embeds the L0–L4 table; links to the reference; ladder now exists in exactly one place | AC 11 · Finding 02 |
| [x] | T009 | **Boot G4**: make Step 5 **report-only** — remove the `## Maturity Assessment` write, the `**Maturity Level**` header write, and the `## History` append; rename Step 5 "Update Maturity & Report" → "Report". Reword "Measure compounding value" (~145–147) so the trajectory reads from `.harness/history.md` (changelog) rather than a boot-appended `## History` | eng-harness-loop | `…/eng-harness-1-boot/SKILL.md` | Grep confirms boot performs no governance/history write; Step 5 only reports; compounding-value section references `.harness/history.md` | AC 13 · Finding 01 |
| [x] | T010 | **G1 across the other readers + the json fixture**: retro (~414) and harnessability SKILL.md (~735–737) + the two templates (`assessment-latest.md` ~57, 68 **and** `assessment-latest.json` ~33, 161) read/list canonical-first; backpressure (~56, 101, 188) updates its read-order mention to canonical-first while **keeping its corroboration-only / often-absent stance** | eng-harness-loop, eng-harness-setup | `…/eng-harness-4-retro/SKILL.md`, `…/eng-harness-0-harnessability-assessment/SKILL.md` (+`templates/assessment-latest.md`, `templates/assessment-latest.json`), `…/eng-harness-2-backpressure/SKILL.md` | Grep: all readers + both templates list `.harness/engineering-harness.md` first; backpressure still treats the doc as corroboration only | AC 10 · Findings 03,09 |
| [x] | T015 | **Retro semantics reconciliation (G3/G4)**: update retro's `--harvest --json` `harness` field — read the **current maturity snapshot** from `.harness/engineering-harness.md` (canonical-first), treat `.harness/history.md` as the sparse encoded-improvement changelog **if present**, and `null` any of `last_validation`/`boot_ms`/`verdict` that has no live source (boot no longer appends `## History`). Update the example JSON (~400–402) + field-semantics prose (~414). Reconcile any boot `STATUS`-mode "last validation date" wording (~141) the same way | eng-harness-loop | `…/eng-harness-4-retro/SKILL.md`, `…/eng-harness-1-boot/SKILL.md` | Retro no longer relies on a boot-appended `## History`; fields without a live source are `null`; example JSON + prose consistent with G3/G4 | AC 12,13 · Finding 07 |
| [x] | T016 | **Deferred-writer honesty + reference links (AC11)**: ensure `eng-harness-0-setup` wording stays "owed, not provisioned" for S2/S3 (it already disclaims governance generation — keep it consistent and cross-reference the router's owed-rung language); add the `governance-doc.md` link from boot (and setup where it mentions the contract) so the contract is **linked, not restated** | eng-harness-loop, eng-harness-setup | `…/eng-harness-1-boot/SKILL.md`, `…/eng-harness-0-setup/SKILL.md` | Boot/setup link to `governance-doc.md` (+ boot to `maturity-assessment.md`); no skill claims setup provisions governance; deferred boundary reads consistently across router/setup | AC 11,15 · Finding 08 |
| [x] | T011 | **Validation — structure**: the new skill folder is well-formed (SKILL.md + the two `references/*.md`); L0–L4 appears in exactly one place; boot links to it | eng-harness-loop | (read-only checks) | `grep -rn "L0:\|L4: Self-improving" skills/` returns only `maturity-assessment.md`; skill folder layout correct | AC 1,11 |
| [x] | T012 | **Validation — read-order consistency (G1)**: grep all edited readers + both templates for the canonical-first order; confirm no reader points only at the legacy path, and that retro's `harness` field no longer depends on a boot-appended `## History` | eng-harness-loop, eng-harness-setup | (read-only checks) | Consistency grep clean across boot/retro/backpressure/harnessability(+`assessment-latest.md`/`.json`); retro semantics match G3/G4 | AC 10,12 |
| [x] | T013 | **Validation — regression**: run the existing CLI test suite; update `harness/cli/test/services/docs/docs-content.test.ts` only if it asserts the governance path | config | `harness/cli/` | `cd harness/cli && npm test` (or `just fft`) green; any path assertion updated to canonical-first | AC 16 |
| [x] | T014 | **Validation — graceful degradation (read-through)**: confirm the router SKILL.md + existing `eng-harness-0-setup` fallback document that with no governance doc the router routes to the 🧰 setup track and boot reports `UNAVAILABLE` (no error) | eng-harness-loop | (read-only checks) | The documented behaviour states UNAVAILABLE/setup-track degradation; nothing errors | AC 15 |

### Acceptance Criteria

- [x] AC1 — `skills/eng-harness-loop/eng-harness-flow/SKILL.md` exists with `references/governance-doc.md` + `references/maturity-assessment.md` alongside (T001, T004, T005)
- [x] AC2 — `.minih.json` `include` contains `eng-harness-flow`; skill discoverable; no new source path (T006)
- [x] AC3 — SKILL.md states the stateless contract explicitly (T001)
- [x] AC4 — SKILL.md documents signals A–J applied in decision order (hint → setup gate → engineering dispatch) (T001)
- [x] AC5 — setup gate never crosses into engineering until S0+S2+S4 hold; first missing required rung routed with a *why*; S1/S3 offered not blocking (T001)
- [x] AC6 — parameter contract + conflict matrix documented (route/redirect/noop/ambiguous) (T002)
- [x] AC7 — slug-resolution rule documented (no guessed version suffix) (T002)
- [x] AC8 — `--json` routing envelope specifies the required fields incl. rail/now/next/flags/insight (T002)
- [x] AC9 — per-turn UX (two-zone rail + Orient→Flag→Insight→Suggest→Invite + Flag beat) documented (T003)
- [x] AC10 — canonical governance path is `.harness/engineering-harness.md`; every reader uses canonical-first order; grep shows none legacy-only (T007, T010, T012)
- [x] AC11 — L0–L4 ladder lives only in `references/maturity-assessment.md`; boot links to it; `governance-doc.md` describes the doc and is linked, not restated (T004, T005, T008, T011, T016)
- [x] AC12 — `.harness/history.md` defined as a per-encoded-improvement changelog, not per-session; retro consumes it as such (T004, T015)
- [x] AC13 — boot writes no governance/history; Step 5 report-only; prior History append removed; retro no longer parses a boot-`## History` (T009, T015)
- [x] AC14 — governance write conditions documented (inception once; body+snapshot only at Improve beat) (T004)
- [x] AC15 — with no governance doc, router routes to setup track + boot UNAVAILABLE (no error); setup wording stays "owed, not provisioned" (T014, T016)
- [x] AC16 — existing `harness/cli` vitest suite passes; touched path assertions updated (T013)

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Router/writer mismatch (readers expect `.harness/engineering-harness.md`, writer `harness init` deferred) | High | Low | Explicit `UNAVAILABLE`/setup-track degradation (AC15); workshop's Deferred block carries the writer design for the next plan |
| Read-order drift across 4 separate skill bodies | Medium | Medium | Single source-of-truth order in `governance-doc.md` + a grep consistency gate (T012) |
| L0–L4 ladder re-pasted into a skill later | Low | Medium | Single-source rule + link-don't-restate convention documented in `maturity-assessment.md`/G2 (T005, T011) |
| Boot read-only change leaves a stale "appends History" narrative | Medium | Low | T009 rewords the compounding-value section; **T015 reconciles retro** (the downstream consumer of that History) so it reads the current snapshot + `.harness/history.md` instead |
| Router implies the deferred `harness init` writer exists ("setup provisions governance") | Medium | Medium | T001 + T016 keep S2/S3 wording "owed, not provisioned"; router routes/attempts then reports `UNAVAILABLE` |
| Router SKILL.md drifts from the workshop design | Medium | Medium | Author directly from `001-harness-flow-entry-points.md` (authoritative); do not contradict it |

## Notes

- **No `## Agent Harness Strategy` / `## Harness Loop` sections** and **no per-phase boot/observe/retro task rows** are emitted: this repo has no governance doc (`.harness/engineering-harness.md` / legacy absent) and no `docs/harness/.disabled` — the harness sentinel omits all harness scaffolding (consistent with the flight plan's no-harness rendering). Standard Lightweight testing applies.
- **Deferred to the next plan** (do not implement here): D9 governance inception via a deterministic `harness init` CLI command; D9b the advisory inject step in `eng-harness-0-setup`. The workshop's "Deferred — next plan" block carries the worked design.
