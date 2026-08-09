# Round-3 trial report — the OQ-2 verdict

**Ruled by**: `pij-related-koala` (PM, plan 080 — the verdict is mine; evidence supplied
by the phase-2 coder and independently verified) · **Dated**: 2026-08-09
**Basis**: pin `a37a20ecf12342275a9d81b4cf8835302de8e9e0` (dd branch `s002/sdk-build`);
prediction `51558dbc` (committed before any trial work); falsifiers RED `45928d24`;
goldens `5f8cfa44`; promotion + rewire `964640f8`; evidence table `609516e0`.
**Companion**: [prediction.md](./prediction.md) — read it first; this report is scored
against it, not the other way around.

## The verdict, per primitive (rule 3: sufficient requires a falsifier that RAN)

Every falsifier below was authored and run RED at `45928d24` — before any implementation
— against the absent subject, with a wrong-stub control proving all 13 fail on BEHAVIOUR
(not absence) and three vacuity traps caught and pinned during authoring. Proof commands:
`npx vitest run test/integration/plan-semantics-falsifiers.int.test.ts` (15 passed),
`test/architecture/plan-semantics-boundary.test.ts` (5 passed).

| # | primitive | verdict | falsifier + RAN evidence |
|---|---|---|---|
| 1 | `itemKey` | **SUFFICIENT** on public surface | #1 ×2: native/POSIX collapse + agreement with public `indexDocument` addressing and golden keys · RED `45928d24` → PASS |
| 2 | `PlanDocument` | **SUFFICIENT** (runtime; type half enforced in `src/`, see note 3) | #2–#5: every field filled from public loader/resolver outputs · RED `45928d24` → PASS |
| 3 | `PlanItem` | **SUFFICIENT** | #2–#5: 14 fields value-compared against goldens · RED `45928d24` → PASS |
| 4 | `PlanEdge` | **SUFFICIENT** | #2–#5 + #8b: shape, resolved target, relation · RED `45928d24` → PASS |
| 5 | `PlanIndex` | **SUFFICIENT** | #2–#5: items, edges, `byKey` · RED `45928d24` → PASS |
| 6 | `ReadyReading` | **SUFFICIENT** | #6/#7 ×3 distinct verdicts · RED `45928d24` → PASS |
| 7 | `readPlanReadiness` | **SUFFICIENT** | #6/#7: ready / not-ready / cant-tell · RED `45928d24` → PASS |
| 8 | `buildPlanIndex` | **INSUFFICIENT on public surface** — exact gap: `core/derive`, `core/rel`, `core/constants`, all `ERR_PACKAGE_PATH_NOT_EXPORTED` at the pin | #8a rollup + #8b non-builtin relation PASS **only with the four copied mechanisms** |
| 9 | `readPlanCheck` | **INSUFFICIENT on public surface** — inherits #8 plus `effectiveRel` for `readPlanSemantics` | #9 ×4 synthetic corpora + the live 541-item corpus (promoted == fork, identical findings sets and counts) PASS **only with the copied mechanisms** |

No primitive is UNPROVEN. Reading rows 8–9 as sufficient is the one misreading this
table exists to prevent: their PASS proves the promoted module reproduces the fork
exactly, not that the public surface sufficed.

## The prediction, scored loudly (rule 4: contradictions stated, never reworded)

- **The per-primitive split (#1–#7 sufficient, #8–#9 insufficient) is exactly what the
  prediction called, before the trial ran.** Its non-public claim was confirmed by
  measurement from both sides (install-side resolver refusals; dd's own pack listing).
- **The prediction's FRAMING was wrong in a way its own scoring rules could not catch**:
  it asked whether the layer could be REBUILT from primitives and never considered that
  dd already shipped the finished compiled layer, unexported — 18 files, 71KB, 7.1% of
  every install. Recon found this in the first ten minutes of implementation.
- **The framing fault has a SHARED cause, with asymmetric weight** (dd's own framing,
  adopted): dd's reachability record said *"plan/ does not ship; harness re-implements
  on primitives"* — false; it ships, it is not exported. My prediction consumed that
  record without questioning it. Per crab: a consumer who re-verifies every maintainer
  claim never finishes — verifying the CODE and trusting the DESCRIPTION is the correct
  division of labour, so the durable lesson is **fix the record** (done, dd `e96f089`),
  not **trust nothing**. Both sides named; weight on the record.

## Resolution (supersedes ratified D-3's export premise)

Jordan ruled the ontology question neither the prediction nor D-3 asked: **semantic
ontology leaves dd** (dd government `d8950eb`) — dd keeps MECHANISMS (claiming-vs-
referencing, typed relations, minted ids, state machinery), consumers bring VOCABULARY.
Under that ruling harness is the owner of the plan layer (it originated here; dd's copy
was the port), so the resolution is **keep-and-promote**, ratified by Jordan for this
plan:

- The fork's plan layer was promoted BY COPY to `services/plan-semantics/` (`964640f8`);
  the fork stays byte-frozen until phase-3 deletion; consumers rewired (full-zero import
  proof over all four survivors).
- The gap in rows 8–9 is closed by **four enumerated mechanism copies**
  (`core/constants`, `core/derive`, `core/rel`, `core/value` — `shared/posix-path` is
  harness's own module, imported), each carrying the seam pointer (dd `6aaef35`) and
  builder-owned-per-ruling comments. Vocabulary copying is sanctioned by the ruling;
  no copied symbol has a public home (enforced by a boundary test, not a one-off grep).
- **The drift surface is owned at birth** (ledger § mechanism-copy drift surface): owner
  = the dd-consumption seat; triggers = re-pin diff / detector re-aim / dd reciprocity;
  sunset = dd's mechanism-vocabulary seam shipping injection points (scoped, unscheduled).

## Notes a future consumer needs

1. **Behavioural pin**: goldens (`5f8cfa44`) capture post-A-2-fix behaviour (`2169808e`
   is an ancestor — verified by prime via `merge-base --is-ancestor`) and survive the
   fork's deletion; the live-corpus test converts to structural invariants at that point.
2. **CJS caveat**: dd's `.` export declares `types` + `import` only — no `require`; a
   CJS require of the barrel dies with "No exports main defined". Goes in
   `docs/how/consuming-dd.md` (phase 3, ac-0009).
3. **Type-half enforcement**: no test file in this repo is typechecked (`tsconfig`
   includes `src/` only) — the #2–#5 strict-tsc halves are enforced by the promoted
   module living in `src/`; the gap itself shipped a HIGH finding this phase (review
   F002) and is recorded for the drain (DL-003, sharpened).
