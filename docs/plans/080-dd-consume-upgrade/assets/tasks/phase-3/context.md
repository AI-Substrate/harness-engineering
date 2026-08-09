# Phase 3 context brief — Fork drain, deletion, and surface cleanup

**Tasks**: [tasks.dd.json](./tasks.dd.json) (`tk-000c..tk-0012`; rendered `tasks.dd.md` — never edit either by hand, `harness dd` verbs only)
**Plan**: [../../../plan.dd.json](../../../plan.dd.json) · **Phase-2 trial report**: [../phase-2/trial-report.md](../phase-2/trial-report.md) · **Ledger (drift-surface section is load-bearing here)**: [../../dogfood-ledger.md](../../dogfood-ledger.md)

## Executive briefing

Phase 2 promoted the plan layer to `services/plan-semantics/` (harness-owned per Jordan's
ontology ruling) and rewired all four survivors — the fork trees are now DEAD CODE with
two remaining consumers: the goldens gen test (fork-as-oracle) and the `harness dd *`
verbs. This phase drains the fork bidirectionally, deletes both trees, removes the
verbs, and lands the riders (doctor warn, AGENTS.md, consuming-dd doc, D-4 comments,
plan-new bundle). **Order is load-bearing**: checklist (tk-000c) BEFORE deletion
(tk-000d); goldens-machinery conversion IN the deletion commit, never before.

## Hard rules (violations are review REJECTs)

1. **Deletion is pre-licensed; everything else in `services/dd/**`/`acts/dd/**` is
   notify-first through koala.** Send prime the advance notice with ancestry proof
   before the deletion commit (courtesy, ruled).
2. **The checklist gates the deletion** — tk-000c's artifact committed first, both
   directions enumerated (harness-main fixes the fork never took AND dd fixes the fork
   never took), each row adjudicated. Commit order is the proof.
3. **Goldens discipline at deletion**: gen test + FROZEN_DIGEST pin retire in the SAME
   commit as the fork; live-corpus test converts to structural invariants; the
   falsifier suite must stay green against the golden LITERALS throughout.
4. **tk-0011 is sequencing-gated**: `acts/plan/scaffold.ts` was ruled BEHIND #119, and
   #119 has NOT landed (verified at phase-3 open, origin/main `7853f460`). Prime
   re-rules before the first scaffold.ts commit; the ruling goes in the execution log.
   Every other task is unblocked — do not serialize the phase behind this gate.
5. **`just build` regenerates `services/dd/docs/docs-content.ts`** (gen-dd-docs writes
   inside the fence) — a dirty fence pre-deletion is the GENERATOR, not tampering;
   rule it out before attributing. After deletion, verify the generator target moved
   or retired with the tree.
6. Harness commands in-tree; cwd resets per command; explicit pathspecs, never
   `git add -A`; absolute paths for destructive cleanup (`rm` on a wrong relative path
   no-ops silently — bit us in phase 2, DL-004).
7. No push, no PR — ship is a separate stage behind Jordan's confirms.

## Known tripwires

- The two boundary guard tests that skip package specifiers get D-4 comments
  (tk-0010) — they are documented-blind, not broken; build no replacement guard.
- dd's walk.ts E436 fix (unparseable fixtures escape sweep exclusion) is in-flight
  upstream — it reaches us via re-pin (walk is PACKAGE-consumed), goes in the
  checklist as a dies-with-fork row for the fork's copy, and gets verified at the next
  re-pin.
- `harness checks` has three pre-existing warn-launch degraded legs (arch-check
  services-ports-type-only ×2, markdown-lint 211, windows-check 6) — not yours, not
  this phase's; the blocking legs must stay green.
- The s081 overlay-revalidation tripwire (phase-2 brief) still applies to any flow
  mutation.
- Deleting the dd verbs changes `harness dd` from working-verb to unknown-command —
  capture the control run BEFORE deletion so dw-0018's proof has both sides.

## Files touched

| Area | Change |
|------|--------|
| `services/dd/**`, `acts/dd/**` | DELETED (after checklist + notice) |
| dd verb registration (CLI index) | removed |
| goldens gen test / FROZEN pin / live-corpus test | retired / retired / converted, same commit as deletion |
| seat detector `dd-fork-divergence` | re-aimed at the 4 `dd-mechanisms` copies |
| `harness doctor` | non-fatal dd-CLI-absent warning |
| `AGENTS.md` | dd CLI install docs |
| `docs/how/consuming-dd.md` | new |
| guard sites (2 tests) | D-4 comments |
| `acts/plan/scaffold.ts` | plan-new bundle — GATED on prime's #119 ruling |
