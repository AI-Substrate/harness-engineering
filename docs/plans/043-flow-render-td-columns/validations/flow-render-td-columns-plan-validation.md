# Validation — flow-render-td-columns-plan

**Verdict**: ✅ VALIDATED — no material issues; one limitation noted.
**Target**: `docs/plans/043-flow-render-td-columns/flow-render-td-columns-plan.md` (Simple, CS-3, READY)
**Validated**: 2026-06-30 · `/validate-v2` (adaptive — lead + deterministic proof; CS-3, no critic warranted)

## Proof (fresh reads by the lead)

| Claim | Evidence read this pass | Result |
|---|---|---|
| Current layout = sections (replace target) | `flow-renderer.ts:18,337,369,408` (`### ⋯`, per-node fences + `↓`) | ✅ |
| Text extras already badges | `nodeLabel` :277-305 (`💬📄📝`) | ✅ — AC-04 is a *keep* |
| AC-05 premise: renderer emits 🗣 bubble + agent nodes | `:421-424` (user_input `]:::said`), `:429-433` (agents per-fence) | ✅ real targets |
| AC-05 proof surface | only `flight-plan-024.json` + `kitchen-sink.json` carry agents/user_input | ✅ — the regen diff there IS the AC-05 review |
| 5 goldens + hard gate | fixtures dir + `package.json:40` `check:flows` | ✅ |

## Thesis & consumers

- **Thesis** — advanced, with an honest bet. The change **reverses** the renderer's own stated
  rationale (`:18-24`: *"a single-hub diagram cannot skew … a monolithic graph skews"* → sections).
  The plan bets that **combining chores + folding side-content to badges/gutter** cuts side-nodes
  enough that one TD diagram stays straight. The prototype held on `flow-skew`; the plan correctly
  carries this as the top risk (re-skew, H) and enumerates every side-content kind in AC-05.
- **Consumers** — `flow-renderer.ts` is consumed by `harness flow render` + the rail; signature
  unchanged, schema untouched. Pure-function change; no downstream contract shift.

## Limitation (noted, non-blocking)

**"Skew is beaten" is an INFERENTIAL proof, not deterministic.** A string test can assert the
*structure* (one `flowchart TD`, combined boxes, `~~~`/`-.-`, badges) but **cannot prove the rendered
diagram isn't diagonal** — that's a visual property of dagre's output. So AC-07's real skew-check is
**eyeballing the regenerated `kitchen-sink` + `flight-plan-024` `.md`** (the complex, side-content-
heavy fixtures), not a passing assertion. The plan's "alignment is best-effort, verify on fixtures"
stance is the right call; T005's reviewed-diff step is where that visual judgement lands. Recommend
the implementer explicitly **renders + views kitchen-sink** before declaring AC-07, not just diffs it.

## Residual

- None blocking. The side-content mapping (badges / agents-gutter / drop-🗣) is locked in AC-05;
  the visual skew-proof is correctly scoped to the fixture review.
