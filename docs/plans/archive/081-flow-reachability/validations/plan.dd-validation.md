# Validation — plan.dd.json (081-flow-reachability)

**Validated**: 2026-08-09 · **Mode**: adaptive (lead + 1 critic) · **Verdict**: VALIDATED WITH FIXES

## Contract
- **Purpose**: encode Jordan's pre-amble rulings into a buildable plan for the workteam-facing
  reachability verb (bundled flight-plan type + two-clause `flow check` + ermine handoff).
- **Promise**: an implementor executes phases 1–3 without re-deriving decisions; pij receives a
  callable, ratifiable contract.
- **Proof target**: Decision/Contract. **Upstream**: assets/research-dossier.md,
  assets/design-constraints.md (rulings, highest authority), #140 / AI-Substrate/pij#227.
- **Consumers**: tasks/implement stages; ermine (contract); koala s080 (parity constraint).

## Deterministic proof (fresh, this worktree's CLI)
- `dd build --check` — no render drift · `dd validate` / `plan validate --complete` — 0 errors;
  only `address-target-untracked` warns (clear at first commit).
- Cross-ref integrity (scripted): 8/8 ACs covered, all coverage phase-ids valid, gate matrix
  G1–G7 consistent (G4/G7 N/A verified: no docs/adr, domains off).

## Critic findings → applied fixes (all verified against source before repair)
| Sev | Finding | Fix applied |
|---|---|---|
| HIGH | E300/E306 flow verdict unassigned (only E301/E308 ruled) | ph-1bca brief + ac-0005: all four unusable-flow classes warn (degraded/0) with distinct reasons; only plan-document failures error |
| HIGH | ac-0006 "byte-compatible" unfalsifiable (envelopes embed timestamps) | reworded: field-equal excluding timestamp + equal exit codes |
| MED | DELTA convergence contradicted "no pij-repo edits" non-goal | non-goal carve-out naming the grant (prime+ermine convergence rule, stand-up.md on docs/fleet-live-findings only) |
| MED | 099-shaped fixture built but never exercised by any AC | ac-0002 extended to both 098- and 099-shaped fixtures |
| MED | verb input contract unspecified | working invocation pinned in ph-1bca: `harness flow check --plan-dir <dir> [--flow <path>]`, default `<dir>/the-flow.json` |

Re-verification after repair: `dd build` ok, `plan validate --complete` 0 errors (same 3
untracked warns). **Thesis**: advanced — rulings faithfully encoded, ACs falsifiable.
**Consumers**: 4/4 named consumers addressed (tasks stage has phase briefs + fixtures; ermine
has an invocation-level contract to ratify; koala's frozen surfaces guarded in guardrails + ac-0006).
