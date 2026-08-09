# Fork-drain checklist — `services/dd` + `acts/dd` (tk-000c, gates tk-000d)

**Status**: complete, committed BEFORE the deletion commit (git order is the proof — dw-0017).
**Measured at**: branch `s080/dd-consume-upgrade`, head `d7daf94c`, pin
`@ai-substrate/dd@a37a20ecf12342275a9d81b4cf8835302de8e9e0` (dd branch `s002/sdk-build`).
**Fork trees**: 58 `.ts` files across `harness/cli/src/services/dd/**` +
`harness/cli/src/acts/dd/**`.

Every claim below names the command that produced it. Numbers restated from an earlier
run without re-measuring are how this plan already shipped three stale-fact findings
(ledger entry 4, review F001, my own `just checks` line — DL-006); each row here was
re-measured at the head above.

---

## Inventory (a) — harness-main commits touching the fork since the fork point

Fork point = `d537ad33` (the commit that CREATED `services/dd`; verified with
`git log --diff-filter=A -- harness/cli/src/services/dd/core/model.ts`). Six commits
touched the fork after birth:

```
git log --format='%h %ad %s' --date=short -- harness/cli/src/services/dd harness/cli/src/acts/dd
```

| # | sha | what it changed in the fork | adjudication |
|---|-----|------------------------------|--------------|
| 1 | `d537ad33` | fork birth (plan 065, #87) | **fork point** — nothing to drain |
| 2 | `13679dee` | dd-native builder (plan 071, #95): `core/{bucket,constants,model,rel,validate}`, `acts/dd/*` | **covered elsewhere** — the mechanism halves (`constants`, `rel`) are two of the four enumerated `dd-mechanisms` copies already under the ledger drift surface; the `acts/dd` halves **die with the verbs** |
| 3 | `1aef9d9c` | `harness plan ready`: `plan/{index,ready}.ts` (+235) | **PORTED** into `services/plan-semantics/ready.ts` at tk-0008; fork copy dies |
| 4 | `4902fef7` | #105 one-address-per-fact: `core/walk.ts` (FX014 message), `acts/dd/{shared,validate}.ts` | **SPLIT — see F-1 below.** `acts/dd` halves die with the verbs; the `core/walk.ts` message fix is a harness-main fix **dd never took** |
| 5 | `cfa501a6` | #116 Windows `--path`: `links/map.ts`, `plan/index-plan.ts`, `acts/dd/{doctor,graph}.ts` | **PORTED both ways** — `links/map.ts`'s `toPosix` is present in the package (`dist/links/map.js:226`); `plan/index-plan.ts`'s `itemKey` `toPosix` is present in the promoted module (`plan-semantics/index-plan.ts:42`). See F-2 for dd's own copy |
| 6 | `3d1e4692` | #133 D7 drive-rooted address absolute: `core/validate.ts` | **PORTED and SUPERSEDED upstream** — see F-3 |
| 7 | `2169808e` | 080/tk-0003 A-2 drain: `core/walk.ts`, `links/model.ts`, `acts/dd/shared.ts` | **dd→fork direction** — this commit drained *dd's* fix INTO the fork, so dd is by construction not behind on it |

### F-1 (MATERIAL) — FX014 diagnostic: a harness-main fix dd never took, **already regressed**

`4902fef7` improved the untracked-target message in `core/walk.ts`:

```
- message: `address target is not tracked: ${targetPath}`,
+ message: `address target is not tracked by git: ${targetPath} — track it with `git add ${targetPath}``,
```

The package at the pin still carries the OLD text:

```
$ grep -n "not tracked" node_modules/@ai-substrate/dd/dist/core/walk.js
74:  message: `address target is not tracked: ${targetPath}`,
```

**This is not a future risk of the deletion — it already regressed.** `acts/plan/index.ts`
imports `validateWalk` from `@ai-substrate/dd` (the root barrel, line 1–12) and
`services/plan-semantics/check.ts:9` imports it from `@ai-substrate/dd/core/walk`, so
`harness plan validate` has been emitting the weaker message since the phase-1/2 rewire.
The only place the good message still exists is `acts/dd/validate.ts` — a dying verb.

Adjudication: **report upstream (reciprocity), dies-with-fork here.** No harness-side
remediation: re-adding the string locally would be a shim, and the whole point of the
plan is that dd owns this mechanism. The loss is a diagnostic-quality regression, not a
behavioural one — the finding still fires with the same code and address, it just stops
naming its mechanism, which is precisely the defect class the FX014 comment was written
to prevent ("a diagnostic that omits its mechanism does not produce confusion; it
produces a confident wrong model"). Recorded here so the regression is *chosen* rather
than discovered later.

### F-2 (LOW) — `itemKey` POSIX collapse absent from dd's unexported plan copy

`cfa501a6` added `toPosix` to `itemKey`. Present in the promoted module
(`plan-semantics/index-plan.ts:42`). dd's shipped-but-unexported copy still has the
un-collapsed form:

```
$ grep -n "function itemKey" -A2 node_modules/@ai-substrate/dd/dist/plan/index-plan.js
19: export function itemKey(path, interior) {
20:     return `${path}#${interior.join('/')}`;
```

Adjudication: **no action.** Per Jordan's ontology ruling (`d8950eb`) dd's `plan/**` is
not consumed and will not be exported; harness owns the corrected copy. Recorded only so
a future reader does not "discover" this as fresh drift.

### F-3 — D7 drive-rooted: ported, then improved upstream (a NON-finding, deliberately recorded)

The two spellings differ, which looks like divergence:

```
fork    core/validate.ts:103   const ROOT_ANCHORED     = /^([A-Za-z]:)?[\\/]/;
package dist/core/validate.js:28 const ABSOLUTE_FILE_PATH = /^([A-Za-z]:)?\//;
```

They are **behaviourally equivalent**: both normalise `\` → `/` *before* testing (fork
`validate.ts:106`, package `isRootAnchored` at `:29-31`), so the fork's `[\\/]`
alternative is unreachable belt. dd went further and unified the two hand-rolled
absoluteness tests behind one `isRootAnchored`, which is what the fork's own comment
asked for. Recorded because a regex diff is exactly the shape that gets mis-filed as
drift by a reader comparing text instead of behaviour.

---

## Inventory (b) — dd-side fixes the fork never took

| dd fix | state upstream | fork status | adjudication |
|--------|----------------|-------------|--------------|
| `shouldExcludeFromSweep` E436 reorder (unparseable fixtures escape sweep exclusion) | in flight (crab) | fork carries the **same bug**, byte-for-byte: `services/dd/core/walk.ts:38-39` and `dist/core/walk.js:8-9` are identical, and the exclusion is consulted at the walk site (`:77`) after the parse that the unparseable fixture already failed | **dies-with-fork** on the fork copy; **verify-at-re-pin** on the package side (`core/walk` is public and `doctor-service.ts:12` consumes `shouldExcludeFromSweep` directly) |
| Unstaged-rollback fix — stage to `<path>.rollback.tmp` + rename, distinct from the forward `.tmp`, read-back kept with a control arm (dd PR #5, sequenced first by dd o-prime) | fixed upstream, sha on merge | **not applicable to the fork's own mutate layer** — `grep -rln rollback services/dd acts/dd` matches only `acts/dd/build.ts` (a dying verb); `services/dd/mutate/*` carries no rollback staging | **dies-with-fork**; **verify-at-re-pin** on the package side |
| A-2 `tracked === null` honesty | already drained INTO the fork at `2169808e` | present both sides | closed — and the goldens pin the post-fix behaviour (ordering fact recorded in `plan-semantics-goldens.gen.test.ts`) |

Both in-flight rows reach us by **re-pin**, not by porting: `walk` is package-consumed
today, and the mutate layer is not consumed from the fork at all.

---

## Inventory (c) — live consumers, each with a conversion adjudication

### (c1) Production imports — SIX files, all convertible with ZERO gaps

First measured with a path-shaped grep (`services/dd/|acts/dd/`) which found only
`app.ts` — **wrong**, because every one of these imports is *relative* (`../dd/…`).
Re-measured:

```
grep -rn "from '\.\./dd/|from '\./dd/" harness/cli/src --include=*.ts | grep -v '^harness/cli/src/(services|acts)/dd/'
```

| file | fork symbols | destination | verified |
|------|--------------|-------------|----------|
| `services/doctor/doctor-service.ts` | `parse`, `shouldExcludeFromSweep`, `DD_SUFFIX`, `scanCorpus` | `@ai-substrate/dd/core/parse`, `/core/walk`, `/links` | ✅ |
| `services/flow/flow-dd-gate.ts` | `DocLoader`, `resolveLink`, `SchemaResolver`, `verifyBasis`; `DdSchemaItem`, `DdSection`, `deriveSchemaItems`, `deriveSchemaState`, `SchemaRecord`, `SchemaResolution`; `isPlanCheckKind`, `PlanCheckReading`, `PlanCheckResult`, `readPlanCheck`, `resolvePlanAddress` | `@ai-substrate/dd/links`, `@ai-substrate/dd/schema`, `services/plan-semantics` | ✅ |
| `services/flow/chores-read.ts` | `SurveyDimension`, `SurveyReason` | `services/plan-semantics` | ✅ |
| `services/flow/flow-events.ts` | `isPlanCheckKind` | `services/plan-semantics` | ✅ |
| `services/flow/flow-mutations.ts` | `PLAN_CHECK_KINDS` | `services/plan-semantics` | ✅ |
| `services/flow/flow-renderer.ts` | `isPlanCheckKind`, `PlanCheckKind` | `services/plan-semantics` | ✅ |
| `app.ts:3,400` | `registerDdAct` | **removed** (verb registration) | n/a |

"Verified" means the symbol was **imported at runtime**, not read out of a `.d.ts`:

```
$ node --input-type=module -e "for (const s of ['@ai-substrate/dd/core/parse', \
   '@ai-substrate/dd/core/walk','@ai-substrate/dd/links','@ai-substrate/dd/schema']) \
   { const m = await import(s); … }"
@ai-substrate/dd/core/parse   OK  parse:Y
@ai-substrate/dd/core/walk    OK  sweep:Y
@ai-substrate/dd/links        OK  scanCorpus:Y DD_SUFFIX:Y resolveLink:Y verifyBasis:Y
@ai-substrate/dd/schema       OK  derItems:Y derState:Y
```

Note on the three schema TYPES (`DdSchemaItem`, `SchemaRecord`, `SchemaResolution`): a
name-grep of `schema/index.d.ts` returns 0 for each, which reads as a gap. It is not —
they arrive through `export * from './model.js'` (`dist/schema/index.d.ts:16`). A
wildcard re-export is invisible to a name grep; that near-miss is why this row cites the
barrel line rather than a grep count.

**No D-3 STOP is required for the conversion.** Every symbol the six consumers need has
a public home at the current pin.

### (c2) Test files — 57 referencing the fork, adjudicated by class

```
grep -rln "services/dd/|acts/dd/|'\.\./dd/" harness/cli/test --include=*.ts   → 57
```

| class | count | files | adjudication |
|-------|-------|-------|--------------|
| Fork-owned unit tests | 38 | `test/services/dd/**` | **die with the tree** — they test the deleted implementation |
| Fork-owned verb tests | 15 | `test/acts/dd*.test.ts` | **die with the verbs** (incl. `test/acts/dd.test.ts`, named in dw-0023) |
| Consumer-contract | 4 | `test/services/flow/{flight-plan-gates,flow-dd-check-gate,flow-dd-sdk-seam}.test.ts`, `test/services/flow/gate-fixtures/index.ts` | **CONVERT** — they pin the flow spine's contract, not the fork's internals |
| Consumer-contract | 2 | `test/acts/{plan-fence,plan-pr-body}.test.ts` | **CONVERT** |
| Architecture / contract | 2 | `test/architecture/dd-core-isolation.test.ts`, `test/contract/envelope-fact-address.test.ts` | **retire or re-aim** — `dd-core-isolation` polices a tree that will not exist (a rule guarding nothing is silence, not health) |
| Goldens machinery | 3 | `test/integration/plan-semantics-{corpora,falsifiers,goldens.gen}` | **per dw-0019**: gen test + FROZEN pin retire IN the deletion commit; live-corpus → structural invariants; falsifiers stay green against LITERALS |

No test is deleted merely for naming the fork (dw-0022's explicit bar).

### (c3) Build / check / sensor / architecture surfaces

| surface | site | adjudication |
|---------|------|--------------|
| `gen:dd-docs` | `package.json:40`, wired into `build` at `:46`; `scripts/gen-dd-docs.mjs` | **retire with the tree** — it generates `services/dd/docs/docs-content.ts`, i.e. it writes INSIDE the deleted fence (hard rule 5: this generator is why a dirty fence pre-deletion is the generator, not tampering) |
| `check:dd-docs` | `package.json:45`; `scripts/check-dd-docs.mjs` | **retire with the tree** |
| `test/acts/dd.test.ts` | verb surface test | **dies with the verbs** |
| `dd-doctor` **sensor** | `.harness/extensions/repo-sensors/extension.ts:419` — `run: harnessVerbMeasurement('dd doctor')`, guidance string prescribes `harness.js dd doctor --json` | **RE-AIM or RETIRE** — the verb it measures is deleted, so it would go from measuring to erroring. This is dw-0023's row (koala's ruling confirms dw-001a was aimed at the wrong name) |
| dependency-cruiser fork rules | `.dependency-cruiser.cjs` — 17 `dd-*-never-imports-*` rules (`:68`–`:187`) plus `flow-consumes-dd-sdk-only` (`:194`) | **retire the 17 fork-internal rules** (they police deleted directories); `flow-consumes-dd-sdk-only` is **re-aimed or retired** per tk-0010 (D-4: the guard goes blind, comment it, build no replacement) |
| `dd-fork-divergence` detector | **NOT IN THIS REPO** | **NOT-PROBEABLE in-repo** — see below |

### (c4) `dd-fork-divergence` — the not-probeable row (dw-001a, koala's ruling)

Two independent in-repo measurements at head `d7daf94c`:

```
$ grep -rln "fork-divergence|fork_divergence" . --exclude-dir=node_modules --exclude-dir=.git
docs/plans/080-dd-consume-upgrade/assets/tasks/phase-3/{tasks.dd.md,tasks.dd.json,context.md}
docs/plans/080-dd-consume-upgrade/assets/{dogfood-ledger.md,research-dossier.md}
docs/plans/080-dd-consume-upgrade/assets/tasks/phase-2/reviews/_computed.diff
```

Six hits, **all plan prose, zero code**; and `.harness/extensions/repo-sensors/extension.ts`
declares no such sensor. **Ruled** (koala, `b4e352d9`): the detector exists but is a pij
chore on the PM's seat, which is why the in-repo greps correctly find nothing; the
research dossier's present-tense H-03 ("the `dd-fork-divergence` chore watches ongoing
drift") turned an aspiration into a repo-task premise. koala's half — re-aiming the seat
chore at dd movement beyond pin `a37a20ec` across the four copied mechanism files, with a
NOT-PROBEABLE arm, first run empty-diff as clean baseline — is **done**. Building an
in-repo detector was explicitly **rejected**: it was never repo code, so there is no new
surface and no materiality trip.

This row is the in-repo half: the absence is **reported, not silently passed**.

---

## Deletion gate

All three inventories are complete and every live consumer above carries an explicit
adjudication. Nothing reaches the deletion commit unadjudicated (dw-0017).

**Two items leave the repo as accepted losses, both deliberate and both reported
upstream rather than shimmed**: the FX014 diagnostic (F-1, already regressed) and the
fork's local `itemKey` correction in dd's unexported copy (F-2, no consumer).
