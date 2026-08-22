# Workshop: Consume shape — the four open decisions

**Type**: Other (decision workshop)
**Plan**: 080-dd-consume-upgrade
**Spec**: none yet — this workshop precedes the plan pass by design (its decisions feed it)
**Created**: 2026-08-09T01:45:00Z
**Status**: Approved — all four decisions ratified by Jordan 2026-08-09 (verbatim rulings in the Ratification record)

**Value Thesis**: The plan pass designs phases; each of these four decisions changes what
the phases *are* (what gets deleted, what stays user-facing, what happens on a bad trial
outcome, what the test estate must enforce). Deciding them first means the plan is written
once instead of re-planned after each ruling — and decision 3 in particular must exist
*before* the trial so the trial cannot decide it by momentum.
**Target Proof Level**: Preferred Direction
**Current Proof Level**: Preferred Direction (per-decision recommendations with rationale; ratification pending)

**Selected Value Axes**:
- **Migration Safety**: D-1 and D-3 govern the irreversible half (deletion) and the fallback path.
- **Safety to Change**: D-4 decides whether the flow→dd boundary stays defended or is knowingly retired.
- **Agent Readiness**: a ratified decision table lets the plan verb and every later phase act without re-asking.
- **Cost / Attention Reduction**: four rulings in one document, one plan pass instead of several.

**Related Documents**:
- `../research-dossier.md` — evidence base (F-02 consumers, F-05/F-06 the plan gap, F-07 boundary, F-08 fork size, H-03 fork-drain)
- `../../original-ask.md` — the pre-amble context and Jordan's sourcing rulings

---

## Purpose

Resolve the four structural decisions the pre-amble surfaced, so the plan pass can lock
phases against a ratified record instead of four open questions.

## Key Questions Addressed

1. Does 080 delete `acts/dd`, or only rewire onto the package?
2. What happens to the `harness dd *` CLI verbs?
3. What is the pre-decided answer if the round-3 trial finds dd's public primitives insufficient?
4. What happens to the flow→dd architecture boundary once dd is a package?

---

## D-1 — `acts/dd`: rewire only, or delete?

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| A | Rewire the 4 survivors; keep `acts/dd` + `services/dd` indefinitely | Zero deletion risk | Two implementations of dd in one binary — the drift hazard is the whole reason for 080 | Rejected |
| B | Rewire and delete in one phase | One pass | Puts the irreversible half in the same commit/review as the reversible half; a rewire defect forces a full revert | Rejected |
| **C** | **Staged: rewire → prove (full suite + dogfood) → delete, separate phases, separate review gates** | Deletion rides on proven ground; revert surface stays small; the fork-drain checklist (dossier H-03) gets its own gate | One more phase | **Recommended** |

**Why C**: deletion of 45 files / 8,173 lines (F-08) is the irreversible half and must not
ride in the rewire's commit. The fork-drain (confirm every harness-main fix since the dd
fork is present in dd, shas cited) is a deletion-phase precondition, not a rewire concern.

## D-2 — the `harness dd *` verbs

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **A** | **Remove them; AGENTS.md and docs point at the standalone `dd` CLI** | One implementation, one doc surface; the standalone CLI is the product | A user typing `harness dd validate` gets command-not-found | **Recommended** |
| B | Keep as thin wrappers shelling to/importing the SDK | Familiar surface survives | A third thing to keep in sync; contradicts the extraction's point | Rejected |
| C | Stub verbs that error with a pointer to `dd` | Gentle migration | Dead code with a UX veneer; still ships and still rots | Open (cheap middle if A feels abrupt) |

**Note that de-risks A**: the builder flow's gates run through `harness plan *` and
`harness flow *` (acts/plan, acts/flow) — **not** `harness dd *` — so removing the dd
verbs does not touch the dogfood loop driving this very plan. **User-facing: Jordan's call.**

## D-3 — the pre-decided answer if primitives are INSUFFICIENT (must precede the trial)

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **A** | **dd exports the missing primitives; 080 waits on dd's cycle for that slice** | One vocabulary for the most load-bearing document type; the direct crab channel + branch-sourcing makes dd's cycle fast (measured: report→fix→re-pin in under a day) | 080's plan-semantics phase blocks on another repo | **Recommended** |
| B | Harness keeps `src/plan`-equivalent locally (~1,091 lines, F-06) | No external dependency for the slice | Permanent two-vocabularies hazard; the drift 080 exists to kill, re-instituted at the semantic core | Rejected |
| C | Harness re-implements the 7 non-public modules locally as private copies | Unblocks without dd | Same as B with more steps | Rejected |

**Why this must be ratified before the trial runs**: an insufficiency finding with no
pre-decided answer gets decided by whoever is most impatient at that moment. Ratifying A
now means an insufficient verdict produces a *defect-report-shaped* output (exact missing
primitives, named falsifiers) straight into the standing crab channel.

## D-4 — the flow→dd boundary once dd is a package

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **A** | **Accept it as unenforced and write that down** (in the plan + a comment at each retired guard) | Honest; zero new machinery; the boundary's *substance* moves to dd's own package boundary (exports map refuses deep paths — POC-verified) | In-repo, nothing stops a future `import '@ai-substrate/dd/…'` from a forbidden layer | **Recommended** |
| B | Build a package-aware arch guard (assert which modules may import `@ai-substrate/dd`) | Boundary stays defended | Real work; named explicitly as a plan phase-task if wanted — never smuggled in | Open (Jordan may opt in) |

**Why A as default**: the package's own exports map now does the heavy lifting
(`ERR_PACKAGE_PATH_NOT_EXPORTED` on every unlisted subpath — dossier F-01), which is a
*stronger* control than the retired relative-path guards for everything except
"who inside harness may import dd at all". That residual is small and documentable; B is
a legitimate opt-in if Jordan wants it enforced.

---

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|-------------|-----------------|----------------|
| Plan pass | Four structural unknowns; phases designed on guesses | Phases lock against ratified rulings; one pass |
| Round-3 trial | Insufficiency outcome politically undecided | Outcome routes mechanically: sufficient ⇒ re-implement; insufficient ⇒ defect report to dd, phase blocks openly |
| Deletion review | "Is deleting safe?" re-argued ad hoc | D-1's staging + H-03 drain checklist are the citable bar |
| Doc updates | Verb fate unknown | D-2 names the doc surface changes |

## Validation / Acceptance

This workshop reaches its target proof level when:

- Each decision carries a ratified Selected row (Jordan's word recorded verbatim below);
- The plan pass cites this workshop as authoritative for all four;
- No phase in the resulting plan contradicts a Selected row.

## Ratification record

| # | Decision | Ruling (verbatim) | Date |
|---|----------|-------------------|------|
| D-1 | staged rewire→prove→delete (3 phases: rewire · trial+semantics · drain+delete) — Option C | "yep agree" | 2026-08-09 |
| D-2 | verbs REMOVED (Option A) + two riders: AGENTS.md documents how to install the `dd` CLI when missing, and `harness doctor` warns when the `dd` CLI is not installed | "yes, make sure agents also knows how to install the dd cli if its mising (harness doctor shold warn its not installed)." | 2026-08-09 |
| D-3 | insufficiency ⇒ dd exports the missing primitives, 080 waits (Option A) — with the framing that the trial's gaps are the *product feedback*: dd becomes what consumers need, via fast iteration on the crab channel | "yes iterate quickly qith crab please... this is dogfooding and we will make sure dd is what it needs to be for folks to use it welll" | 2026-08-09 |
| D-4 | boundary accepted as unenforced, documented in the plan + a comment at each retired guard; NO package-aware guard (Option A) | "no gurads needed" | 2026-08-09 |
