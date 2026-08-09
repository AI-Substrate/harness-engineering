# Phase 3 execution log — fork drain, deletion, surface cleanup

Coder seat `pij-grotesque-diziet`. Worktree `s080-dd-consume-upgrade`, branch
`s080/dd-consume-upgrade`. Every claim below names the command that produced it and the
sha it was measured at (DL-006: this plan has already shipped three stale-fact findings).

## tk-000c — bidirectional fork-drain checklist AND conversion inventory

**Artifact**: `fork-drain-checklist.md`, committed `8e9d1ecf` — BEFORE any deletion
commit, which is dw-0017's proof (git order, not prose).

Measured at head `d7daf94c`, pin `a37a20ecf12342275a9d81b4cf8835302de8e9e0`.

### A recon correction worth recording, not hiding

My first pass at the production-consumer inventory used a path-shaped grep:

```
$ grep -rn "services/dd/\|acts/dd/" harness/cli/src --include=*.ts -l | grep -v '^…/dd/'
harness/cli/src/app.ts
```

**One file** — against a dispatch that named six. The dispatch was right and my grep was
wrong: every one of the six imports the fork *relatively* (`from '../dd/plan/index.js'`),
which a path-shaped pattern cannot see. Re-measured:

```
$ grep -rn "from '\.\./dd/\|from '\./dd/" harness/cli/src --include=*.ts | grep -v '^…/dd/'
services/doctor/doctor-service.ts:11,12,13
services/flow/chores-read.ts:2
services/flow/flow-dd-gate.ts:6,13,21
services/flow/flow-events.ts:2
services/flow/flow-mutations.ts:3
services/flow/flow-renderer.ts:1
```

Had I trusted the first grep I would have declared a full-zero that was an artefact of
the pattern. koala classes this with his own `:42-44` window-too-narrow miss the same
day; it is the same defect as phase 2's vacuity traps — **an empty result is a claim
about the instrument until you prove the instrument can see a positive.**

### Conversion gaps: NONE

All six convert with zero missing surfaces. Verified by RUNTIME import, never by reading
a `.d.ts`:

```
$ node --input-type=module -e "…await import(s)…"
@ai-substrate/dd/core/parse   OK  parse:Y
@ai-substrate/dd/core/walk    OK  sweep:Y
@ai-substrate/dd/links        OK  scanCorpus:Y DD_SUFFIX:Y resolveLink:Y verifyBasis:Y
@ai-substrate/dd/schema       OK  derItems:Y derState:Y
```

One near-miss recorded in the checklist: `DdSchemaItem`/`SchemaRecord`/`SchemaResolution`
return **0** from a name-grep of `schema/index.d.ts` and look like a gap. They arrive via
`export * from './model.js'`. A wildcard re-export is invisible to a name grep — the same
instrument-blindness as above, caught this time before it became a false D-3 STOP.

### Findings (detail in the checklist)

- **F-1 MATERIAL** — FX014's diagnostic (`4902fef7`) is a harness-main fix dd never took,
  and it has **already regressed**: `acts/plan/index.ts` and `plan-semantics/check.ts`
  both source `validateWalk` from the package, so `harness plan validate` has emitted the
  weaker "not tracked" string since the phase-1/2 rewire. Deletion removes the last copy
  of the good message rather than causing the loss. Report-upstream / dies-with-fork; a
  local re-add would be a shim.
- **F-2 LOW** — `itemKey`'s POSIX collapse is in the promoted module, absent from dd's
  unexported `plan/index-plan.js`. No action (dd's `plan/**` is not consumed, `d8950eb`).
- **F-3 NON-finding** — the D7 regex differs by TEXT (`[\\/]` vs `\/`) but not by
  BEHAVIOUR: both normalise backslashes before testing, so the fork's alternative is
  unreachable belt, and dd went further by unifying two hand-rolled absoluteness tests.
  Recorded precisely because a regex text-diff is the shape most likely to be mis-filed
  as drift by a reader comparing strings instead of semantics.

### dw-001a — `dd-fork-divergence` NOT-PROBEABLE in-repo (my half of koala's ruling)

Two independent measurements at `d7daf94c`:

```
$ grep -rln "fork-divergence\|fork_divergence" . --exclude-dir=node_modules --exclude-dir=.git
docs/plans/080-dd-consume-upgrade/assets/tasks/phase-3/{tasks.dd.md,tasks.dd.json,context.md}
docs/plans/080-dd-consume-upgrade/assets/{dogfood-ledger.md,research-dossier.md}
docs/plans/080-dd-consume-upgrade/assets/tasks/phase-2/reviews/_computed.diff
```

Six hits, all plan prose, **zero code**; `.harness/extensions/repo-sensors/extension.ts`
declares no such sensor. Ruled by koala at `b4e352d9`: the detector is real but lives as
a pij chore on the PM seat, so the in-repo greps are correctly empty; the dossier's
present-tense H-03 turned an aspiration into a repo-task premise. His half (re-aim at dd
movement beyond `a37a20ec` across the four copied mechanisms, NOT-PROBEABLE arm, empty-diff
baseline) is done. Option (a) — build one in-repo — was **rejected**: never repo code, so
no new surface and no materiality trip. The absence is reported here, never silently
passed.

### Pre-deletion controls (dw-0018 temporal binding, half one)

Captured at `8e9d1ecf`, BEFORE the deletion commit. Exit codes taken from the command
itself, not from a pipeline (`$?` after a pipe reads the LAST stage — `head` — and would
have reported 0 no matter what the verb did):

```
$ node harness/cli/bin/harness.js dd validate docs/plans/080-dd-consume-upgrade/plan.dd.json
dd validate exit=0
{"command":"dd validate","status":"ok",…,"counts":{"error":0,"warn":0},"issues":[]…}

$ node harness/cli/bin/harness.js dd doctor --json
dd doctor exit=0
{"command":"dd doctor","status":"ok",…,"discovered":125,"swept…
```

`dd doctor` is captured deliberately as well as `dd validate`: it is the verb the
`dd-doctor` SENSOR measures (`repo-sensors/extension.ts:419`), so this is also the
before-half for that surface's adjudication.

**STOPPED here for koala's GO before the deletion commit**, per the dispatch.
