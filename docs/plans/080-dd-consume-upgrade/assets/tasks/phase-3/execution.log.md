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

## tk-000d — fork deleted, consumers rewired

**Commits**: `237ab2e1` (rewires, conversions, surface retirements, 22 banner regens),
`430f1511` (10 schema catch-up), `27d90a02` (dd-CLI spelling hazard comment).
**Final proof**: `just build` exit 0; **294 files / 4482 tests, all passing**; a sweep of
every tracked `.dd.json` with `dd build --check` reports **0 drifted**.

### The deletion is NOT in my commit — commit-provenance defect

```
$ git log --oneline --diff-filter=D -- harness/cli/src/services/dd/core/model.ts
7d112d26 plan(080): ledger #5 — FX014 message regression …

deletions per commit:  7d112d26 = 261   2b5a07af = 2   78bbf1c5 = 0   237ab2e1 = 0 (mine)
```

My `git rm` staged 261 deletions into the SHARED worktree index; koala's ledger commits
swept them before mine ran. Cause, owned by koala at `e3a92fbc`: those commits used
`git add <file> && git commit` — **pathspec-disciplined on the add, unlimited on the
commit**. Ruled **ACCEPT, no history rewrite** (rebuilding seven commits under an active
coder risks more than it fixes, and squash-merge collapses the distinction anyway); the
mapping is the record. Authoritative text: dogfood-ledger, *Commit-provenance defect*.

**What survives**: dw-0017's ordering proof is intact —
`git merge-base --is-ancestor 8e9d1ecf 7d112d26` → YES, so the checklist still precedes
the deletion. **What does not**: a reader running `git log` to find the deletion lands in
a ledger commit, and my commit message describes a diff it does not contain.

I refused to flip task states while the commit story was silently wrong, and flipped them
once it was *recorded* wrong-but-known. That distinction is the whole anti-fake rule: a
state that points at a false story is a lie; one that points at a documented defect is
evidence.

**Practice adopted (binding on both seats)**: in a shared worktree, pathspec the COMMIT
too — `git commit -- <paths>`. Third instance of this class in this plan (DL-001), and the
largest by two orders of magnitude.

### The task deleted its own tooling — discovered by using it

Immediately after the deletion, flipping the very states this task earns:

```
$ node harness/cli/bin/harness.js dd set …#done_when/tk-000d/dw-0018/state checked
E108 "too many arguments. Expected 0 arguments but got 4: dd, set, …"
```

`harness dd set` is how every task state in this plan has been mutated, and tk-000d
deletes it. This is not a defect — it is the migration working — but it is worth logging
because it landed on the operator inside the same minute. The replacement is the
standalone CLI, and the states above were flipped with it:

```
$ ./node_modules/.bin/dd set …#tasks/tk-000d/state checked
{"command":"dd set","status":"ok",…,"value":"checked"}
```

That is also the AFTER half of dw-0018's temporal binding, arrived at by accident rather
than by ceremony: the verb-removal proof and the operator's first migrated workflow are
the same event.

### The dd-CLI spelling hazard (ledger #6, corrected `757a18ed`)

Three programs answer to `dd` and only one is ours:

| spelling | what runs |
|---|---|
| `dd` | coreutils disk-dump (`/bin/dd`) — loud, harmless here |
| `npx dd` | an **unscoped npm package that really exists** (v0.26.0, a stranger's tool) — **fetches and runs remote code** |
| `npx @ai-substrate/dd` | ours — the only safe PATH-independent spelling |

**The unsafe recommendation was mine.** My code was safe throughout (`runDd` resolves
`node_modules/.bin/dd` directly, because an executable path has to actually run), but the
prose I wrote *about* it said "`npx dd` or node_modules/.bin/dd", and that half reached
the ledger before dajeil self-reported the squat. The forcing function existed for the
code and not for the sentence describing it.

`27d90a02` encodes the three-way enumeration at `run-cli.ts`, the closest in-code
statement of the rule, because the middle spelling is dangerous **precisely for looking
like the careful fix for the first**: anyone told to stop using bare `dd` reaches for
`npx` as the obvious hardening. A rule that only forbids the bare form steers people into
the worse one. tk-000f/tk-0013 must carry the enumeration, not a bare prohibition.

### Conversions (dw-0022 / dw-0023)

Six production consumers rewired; 53 fork-owned test files died with the tree; 6
consumer-contract files converted (none deleted merely for naming the fork); **3 guards
retired as blind rather than re-aimed** — `flow-dd-sdk-seam` (policed fork barrels),
`dd-core-isolation` (policed a deleted directory), `envelope-fact-address` (consumed a
deleted verb). D-4 forbids package-aware replacements, so a blind guard is removed, not
rebuilt.

Where tests *used* the verbs as tools rather than testing them, the need outlived the
verb — hence `runDd`, rather than deleting assertions that were still earning their keep.

Surfaces: `gen:dd-docs` + `check:dd-docs` retired with their scripts and build wiring (the
generator wrote INSIDE the deleted fence); `dd-doctor` sensor removed; **18**
dependency-cruiser rules removed (17 dd-internal + `flow-consumes-dd-sdk-only`);
`root-invocation-smoke` re-aimed off the deleted `test/acts/dd.test.ts` onto
`plan-fence`, with a comment saying to re-aim rather than drop it — the subject under
test is the root invocation, not the file.

Goldens (dw-0019): gen test + FROZEN_DIGEST pin retired IN this commit; live-corpus test
converted to structural invariants; `fork*` identifiers renamed `ref*` because they now
resolve to the promoted module — keeping the name would have described a thing that no
longer exists. The suite's teeth now come from dd's public `indexDocument` plus the
frozen literals, and the file says so rather than implying an oracle it no longer has.

### The 22/10 split, and a claim I corrected before it committed

The regeneration was **not** banner-only, contrary to what I first reported:

```
32 files changed, 158 added / 158 deleted
  22 of 32 -> banner-only
  10 of 32 -> banner + a new satisfies_toward COLUMN (up to 38 lines in one file)
```

Cause of the 10: `57d8bd1f` (phase 1) added `satisfies_toward` to
`.dd/schemas/builder/plan/schema.json` and regenerated exactly ONE sibling — the file its
author was working in. Every other document rendered against that schema went stale that
moment and stayed stale for the rest of the plan with every gate green. They would have
drifted under the FORK's renderer too; the deletion **exposed** it rather than causing it.

I had generalised a 32-file claim from a 1-file sample. Corrected before committing, which
is why the split exists at all — a GO granted on a wrong fact does not survive the fact.
Prime named the class for the drain: **a schema change has a regeneration blast radius**,
and regenerating only the file in front of you leaves every other consumer silently stale
with nobody wrong at any single moment — the same shape as a fork that never took
upstream's fix. Encodable fix filed: a corpus-wide render-drift sweep shaped like the
dd-docs guard, aimed at `*.dd.md`. Nothing asserts "every `.dd.md` still matches the render
of its `.dd.json`" today; `dd build --check` is per-file and only runs when invoked.

**Publish-gate correction (prime's third round, ledger `81d7250f`)**: the scoped spelling
is not runnable *today* either. Verified rather than accepted:

```
$ npm view @ai-substrate/dd version   → npm error code E404 … not found in feed 'npm-public'
$ npm view dd version                 → 0.26.0          (the squat, confirmed live)
```

So the table above has a time axis: **`node_modules/.bin/dd` is the only prescription that
runs right now**; the scoped form is the post-release route and must be written as such.
This matters more than it looks — a prescription that 404s is exactly how a reader talks
themselves back into `npx dd`. The safe rule has to be runnable *at the moment it is
read*, or it launders into the unsafe one. `27d90a02`'s comment carries the publish gate.

## tk-000e — doctor `dd-cli` warning + AGENTS.md (D-2 rider)

### The probe deliberately does NOT use `which`

The obvious implementation is `proc.which('dd')`, which is what every other toolchain
row in this file uses. It would be **wrong here**, and wrong in the worst way: on every
POSIX host `which('dd')` finds `/bin/dd` — coreutils' disk-dump — so the layer would
report our CLI PRESENT on machines that do not have it at all. A false green, everywhere,
permanently. The probe looks for `node_modules/.bin/dd` instead, and a test pins the
decision so a later "simplification" back to `which` fails loudly.

### Proportionality — a correction I made to my own first version

My first version warned whenever the CLI was missing. It degraded **8 existing doctor
tests**, and that was the design telling me something rather than a test problem: dd's
CLI is OPTIONAL, so warning a repo with no `.dd.json` documents is nagging about a tool
that cannot bite there — precisely the posture the neighbouring `dd-documents` row
refuses ("don't pester a repo the feature doesn't apply to"). The layer now warns only
when the repo actually uses dd. The 8 tests went green by being *right*, not by being
updated.

### Both control arms (dw-001b)

```
PRESENT (this repo):
  dd-cli | ok=True | standalone dd CLI available at node_modules/.bin/dd
  → no next_action

ABSENT (fresh temp repo, cwd outside this tree):
  envelope status: degraded          ← non-fatal, exit 0
  dd-cli | ok=False
    detail:      standalone dd CLI not found — `harness dd *` was removed in plan 080 …
    next_action: Install the dd package in this repo, then invoke it as
                 `node_modules/.bin/dd <verb>`. Do NOT run bare `dd` (that is coreutils
                 disk-dump) or `npx dd` (an unrelated package of that name exists on npm
                 and would be fetched and executed).
```

The `next_action` names **both** wrong programs by design, and a test asserts it does. A
warning that said only "install dd" would send the reader to coreutils or, worse, to the
npm squat — the failure mode being that a *helpful* message becomes the delivery vehicle
for the hazard it was written to prevent.

### Stale prescriptions migrated in the same pass

`checkDd`'s three `next_action`/detail strings and one doc comment still told operators to
run `harness dd doctor` / `harness dd build` — verbs deleted one task earlier. Migrated to
`node_modules/.bin/dd`, and the two doctor tests that ASSERTED the old strings were
updated with them: those tests were pinning a prescription for a command that no longer
exists, which is worse than no assertion.

AGENTS.md gains a `dd` CLI section with the four-spelling table and the publish gate.

**Green**: `just build` exit 0; **294 files / 4487 tests** (+5: four new `dd-cli` cases and
the layer-list contract row). `test/acts/doctor.test.ts` caught the new layer via its
layer-name list — a contract test doing exactly its job.

## tk-0010 — D-4: the retired flow→dd boundary, named where it was enforced

The boundary had **two** enforcers and both are gone:

| enforcer | what it did | why it could not survive |
|---|---|---|
| `test/services/flow/flow-dd-sdk-seam.test.ts` | required every flow→dd import to name a fork barrel; **skipped package specifiers by construction** (`if (!spec.startsWith('.')) continue; // a package, not a path into this tree`) | it imported the fork barrels themselves — it could not even load once the tree was deleted |
| `flow-consumes-dd-sdk-only` (dependency-cruiser) | same rule, path-based, `^harness/cli/src/services/dd` | addresses a path that no longer exists |

Both were **removed**, which is dw-001d's second arm ("or the blind guard is removed").
The first arm was not available for the seam test: a comment cannot rescue a file whose
imports are gone.

**No replacement was built, and that is the ruling rather than an omission.** The
substantive point, now recorded at both sites: the boundary did not weaken — its
ENFORCER changed owner. dd's `exports` map refuses an unpublished subpath at **runtime**
with `ERR_PACKAGE_PATH_NOT_EXPORTED`, which is strictly stronger than a lint rule someone
can demote, waive, or quietly stop running. What was actually lost is the **naming**: the
config and the test suite no longer *tell* a reader the boundary exists. That is what
D-4's comments restore, and it is the whole of what was missing.

Recorded at both retired sites rather than centrally, so the reader asking "why is there
no dd rule here?" finds the answer where they are already standing:

- `.dependency-cruiser.cjs` — at the exact position the 18 rules occupied.
- `test/architecture/plan-semantics-boundary.test.ts` — the last guard near the seam,
  told explicitly what it is NOT, with a stop instruction if someone starts growing it
  into a package-aware successor.

### dw-001d proof

```
$ grep -c "D-4" .dependency-cruiser.cjs test/architecture/plan-semantics-boundary.test.ts
.dependency-cruiser.cjs:2
…/plan-semantics-boundary.test.ts:2

$ git diff --name-status d7daf94c HEAD -- test/architecture .dependency-cruiser.cjs
M  .dependency-cruiser.cjs
D  harness/cli/test/architecture/dd-core-isolation.test.ts
D  harness/cli/test/architecture/dd-plan-semantics-frozen.test.ts        ← no ADDED file

$ dependency-cruiser rule count   before d7daf94c: 25    now: 7   (18 removed, 0 added)
```

Zero architecture files added across the whole phase, so "no new guard" is proven by the
diff rather than asserted. `arch-check` still reports its two pre-existing
`services-ports-type-only` warnings — unchanged, not mine. Architecture suite 5 files /
12 tests green.
