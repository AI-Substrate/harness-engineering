# Phase-2 (OQ-2 trial) — DATED PREDICTION, committed before any trial work

**Author**: `pij-related-koala` (PM, plan 080) · **Dated**: 2026-08-09
**Basis**: the INSTALLED package at pin `a37a20ecf12342275a9d81b4cf8835302de8e9e0`
(`github:AI-Substrate/dd#a37a20ec…`, dd branch `s002/sdk-build`) — measured this morning
by reading `node_modules/@ai-substrate/dd/package.json` (exports map) and the shipped
`dist/**/*.d.ts`, plus the fork's `services/dd/plan/*` imports at `47dcb89c`. Not from
memory, not from dd's working tree.

## Why this file exists (the falsifiability design — binding)

This plan was written before its trial, and my sizing already leaned "insufficient looks
likely" — a plan that knows its answer shapes what its trial looks for. So, per the
acceptance bar (`scratch/dd-trial-acceptance-bar.md`, encoded into dd plan 002):

1. This prediction is **written and committed BEFORE the trial runs** (this commit).
2. **Sufficiency is an OUTCOME of the phase, never a `done_when`** — no task may read
   "confirm insufficiency".
3. For every primitive reported **sufficient**, the report must name the plan-semantics
   case that would have proved it insufficient **and state that it RAN**. No runnable
   falsifier ⇒ the honest word is **UNPROVEN**.
4. If the trial contradicts this framing, the verdict says so loudly — the framing is
   never reworded to fit.

## The question

**OQ-2** (Jordan: "held please", closes on my verdict): are dd's PUBLIC primitives at the
pin sufficient to re-implement harness's plan semantics — the 9 symbols that
`acts/plan/index.ts` and `acts/plan/pr-body.ts` still import from the fork's
`services/dd/plan` — or what, exactly, is the gap.

## Correction to the prior sizing (measured, supersedes the dossier's lean)

The dossier said 7 internal modules, "6 not publicly reachable". **At this pin that is
stale: `links/map` and `links/model` ARE public through `./links`** (`indexDocument`,
`addressableAt`, `anchorForLocation`, `DdDocumentIndex`, `DdAddressableKind`, and
`export * from './model.js'` → `DdLinkEdge` et al). The truly non-public set is now
**five**: `core/constants`, `core/derive`, `core/rel`, `core/value`, `shared/posix-path`
— of which `core/value` (`isRecord`) and `shared/posix-path` are trivial algorithms, and
the load-bearing three are `core/derive` (state derivation + rollup), `core/rel`
(effective-rel resolution), `core/constants` (the rel/state vocabularies).

## Scoring rules I commit to NOW (so they cannot bend after the trial)

- **Duplicating a dd-owned VOCABULARY value counts as INSUFFICIENT surface.** Re-declaring
  `BUILTIN_RELS`, `CLAIMING_RELS`, `DEFAULT_GATE_TERMINAL_STATES`, or `COMPLETION_STATES`
  harness-side is the two-vocabularies hazard this plan exists to end — dd can change them
  under us and nothing types. That gap is reported to crab (D-3: dd exports, we re-pin),
  never absorbed.
- **Re-implementing a trivial algorithm over PUBLIC types is fine** (`toPosix`,
  `isRecord`-class helpers): POSIX path grammar is not dd-owned vocabulary. The line:
  values dd could legitimately change = vocabulary (insufficient to duplicate);
  mathematics that cannot drift = algorithm (fair game).
- **A behavioural mismatch with the fork on the same input refutes a SUFFICIENT call**,
  even if everything compiles.

## Per-primitive predictions (each with the falsifier that would refute it)

| # | Symbol (site) | Prediction | Falsifier case (must RUN, or the call is UNPROVEN) |
|---|---|---|---|
| 1 | `itemKey` (index.ts) | **SUFFICIENT** — pure `toPosix(path)#interior.join('/')`; algorithm-class | Feed the SAME document as a native-separator walk path and as a parsed dd address; both must collapse to one key, and that key must agree with the addressing the public `indexDocument`/`addressableAt` produce for the same node. Disagreement = two address grammars = refuted. |
| 2 | `PlanDocument` (index.ts) | **SUFFICIENT** — type over public `DdDoc` (root) + `ResolvedDdSchema` (`./schema/model`) | Strict `tsc` of the re-declared type against package types, AND a value built entirely from public loader/resolver outputs populating every field. An unfillable field refutes. |
| 3 | `PlanItem`, `PlanEdge`, `PlanIndex` (pr-body.ts) | **SUFFICIENT** — types; deps `DdSeverity` (`./core/validate`) + `DdAddressableKind` (`./links`) are public | Same two-part test as #2: strict compile + every field fillable from public data on a real plan document. A field only obtainable from `core/derive` internals refutes (and converts this row into #5's gap). |
| 4 | `ReadyReading` + `readPlanReadiness` (index.ts) | **SUFFICIENT** — pure function over `PlanCheckResult` + survey dimension; no dd internals beyond types | Re-implemented readiness must reproduce the fork's verdict on three fixtures: ready, not-ready (unclaimed criterion), cant-tell (check failure). Any verdict flip refutes. |
| 5 | `buildPlanIndex` (index.ts) | **AT RISK, leaning INSUFFICIENT without new exports** — needs `deriveItems` (state derivation + rollup), `collectDeclaredRels`/`effectiveRel`, and `DEFAULT_GATE_TERMINAL_STATES`; none public. Public `DdLinkCell.rel` carries the DECLARED rel (resolved via `relOf`), not the effective-builtin mapping | (a) A document with parent state derived from children (rollup): if no public primitive reproduces `deriveRollup`'s answer, insufficient — confirmed. (b) A schema declaring a non-builtin rel (we have one live: `satisfies-toward`): reproducing effective-rel behaviour without re-declaring `BUILTIN_RELS` — if impossible, insufficient per the vocabulary rule. If BOTH turn out reproducible from public surface, my lean is refuted and the call flips to SUFFICIENT. |
| 6 | `readPlanCheck` (index.ts) | **AT RISK** — its I/O machinery is fully public (`validateWalk`, `traverseCorpus`, `resolveMapSeed`, `parseAddress`, loaders); the risk is inherited from #5 plus re-implementing `readPlanSemantics` (`CLAIMING_RELS` + `effectiveRel` — vocabulary again; fork `semantics.ts` is FROZEN and must not be edited) | Drive THIS plan's own `plan.dd.json` (and the phase-1 tasks doc) through the re-implemented check off the installed package; the findings set must equal the fork's on the same input — including one constructed contradiction case and one `--complete` orphan-claim case. Any finding-set diff or unimplementable branch refutes SUFFICIENT. |

## The overall predicted verdict (mine, dated, refutable)

**Split.** Types + `itemKey` + readiness (#1–#4): sufficient. The semantic core (#5–#6):
**insufficient at this pin** — I predict the gap report names `core/derive` (or an
equivalent derived-state output), `core/rel`'s `effectiveRel`/`collectDeclaredRels`, and
the `core/constants` vocabularies as the missing public surface. Predicted resolution is
the ratified D-3 path: **dd exports, we re-pin** (fast loop with crab is standing for all
of 080) — never a harness-side shim, never a re-declared vocabulary.

If the trial instead shows the public `./links` index + `DdLinkCell` outputs carry enough
derived state to rebuild #5/#6 without those exports, this prediction is WRONG and the
verdict will say so in those words.
