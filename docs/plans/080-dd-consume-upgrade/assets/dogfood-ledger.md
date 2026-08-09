# Dogfood-findings ledger — plan 080

Jordan's scope ruling (2026-08-09, verbatim in plan clarifications): defects found in the
harness dd implementation or builder flow while driving this plan are 080's to remediate
to a working solution. **This ledger closes to zero silent workarounds (AC-000c).**

Every entry: what bit, basis sha, where the fix lands, current state. An entry is CLOSED
only by a working fix (harness-side, or dd-side consumed via re-pin) or Jordan's explicit
ruling — never by a workaround alone.

| # | Finding | Basis | Fix site | State |
|---|---------|-------|----------|-------|
| 1 | **E450 section-create gap**: `dd set`/`add` cannot create a schema-declared section absent from the document; `plan new` seeds 6/22 declared sections; sharpened by dd (crab, repro at `41ed739`): `dd rm` of an optional section is a **one-way door** — the sanctioned interface can remove but never restore; root cause `locate.ts:33/36` conflates two states under one reason code | harness fork + dd `7e570bc`..`41ed739` | dd: implicit-create or section verb (o-prime ratification pending) + reason-code split (I weighted: split unblocks tooling regardless); harness fallback: `plan new` seeds ALL declared sections (= fr-0002's harness half, moved into 080 per prime) | **CLOSED (harness half) 2026-08-09 by tk-0011**: `plan new` now seeds ALL 22 declared sections (22/22, verified against the resolved schema) — the seed-then-validate workaround is retired by a working fix. dd's implicit-create remains dd-side (ratified, unshipped) and no longer gates this ledger: it arrives as an upstream improvement via any future re-pin. Earlier progress: reason-code split shipped at dd `012b6bd` |
| 2 | **fr-0007 ordinal gap**: `plan new` has no `--ordinal` while the folder contract is `<ordinal>-<slug>` — a bare slug silently creates a second folder and stamps `meta.slug` from it | harness @ `ee8f37fb` | harness: `plan new --ordinal` (or ordinal-aware slug resolution reusing an existing `NNN-slug` folder) — same verb as entry 1's fallback, bundle the fix | **CLOSED 2026-08-09 by tk-0011**: `plan new --ordinal` shipped and **the pre-agreed acceptance test passed verbatim** — a bare `plan new dd-consume-upgrade --ordinal 80` reproduces this folder shape with a CLEAN `meta.slug` (the test was written into this row at entry time, before any fix existed, so it could not be bent to fit) |
| 3 | **Fork never received dd's A-2 `tracked` fix**: the fork's `FsDocLoader` returned `tracked: true` for a null tracking snapshot (`acts/dd/shared.ts:272`) — one boolean carrying both "tracked" and "unknowable" — while its OWN docstring promised `null`; `DocLoadResult.tracked` was typed `boolean` (`services/dd/core/walk.ts:13`), the walk branched `!loaded.tracked` (`:108`), and `DdLinkTarget`/`DdGraphNode.tracked` were `boolean` (`links/model.ts:72,106`). Surfaced as a hard `TS2322` the moment `acts/flow.ts` composed the PACKAGE's loader (`boolean \| null`) into the fork-typed `DdGateDeps` — the two implementations disagreed about what `tracked` means, which is the drift this plan exists to end | harness fork @ `5b32d451`; dd @ `a37a20ec` (A-2 fixed there: `dist/links/loader.js:82`, `dist/core/walk.js:69` branches `=== false`) | harness fork — drained dd's A-2 into `services/dd/core/walk.ts`, `services/dd/links/model.ts`, `acts/dd/shared.ts` (phase 3 deletes all three) | **CLOSED** by working fix, plan 080 phase 1 tk-0003. 5 changed lines + comments; `tsc` exit 0; 348 files / 5148 tests green. Below all four materiality triggers (inside the declared touch set — "the two dd trees"; <150 lines; 1st harness-side fix this phase; no dd-side ratification needed, dd had already ratified and shipped it). **Not a workaround**: the alternative was mapping `null`→`true` at the composition root, which is the A-2 lie reintroduced and is forbidden by phase-1 hard rule 6. **Coverage note**: the defect was invisible to the suite — nothing pinned `tracked` on a null snapshot, and all 5148 tests passed both before and after the behaviour changed. The package's behaviour is now pinned by `test/integration/dd-package-boundary.int.test.ts`; the fork's is deliberately left unpinned because phase 3 deletes it |

### Entry 3 stated dependency (prime's ruling, 2026-08-09 — not an assumption)

Entry 3 leaves the FORK's behaviour deliberately unpinned **because phase 3 deletes it**.
That is a dependency, not a fact: **if phase 3 slips or is descoped, an unpinned lie-fix
sits in the tree with nothing asserting it** — any descope of phase 3 must first either
pin the fork's `tracked` behaviour or re-argue this entry. (Expiry-ownership: this line
is the owner.)

### Fork-drain checklists are BIDIRECTIONAL (prime, 2026-08-09 — binds phase 3's ac-0006)

Entry 3 is the second deferred-fix-fork sighting in two days, mirrored: earlier, a port
covered what upstream *changed* but not what it *deferred*; here, the fork never received
a fix upstream *shipped*. Both directions share one property — **the fork looks fine on
its own; only composition with its origin reveals the gap**. The phase-3 drain checklist
must therefore ask BOTH: what did harness-main fix that the fork never took, AND what did
the fork (or dd) fix that the other never took.

| 4 | **`satisfies` is binary, so a multi-phase AC reads as a contradiction**: `plan validate` reports every checked phase-1 task whose `satisfies` names a deliberately multi-phase acceptance criterion as a `contradiction` WARN. **Seven** of them at the closed phase-1 boundary — tk-0003/tk-0004 → ac-0002 (which only completes when phase 2 takes plan semantics off the fork), tk-0002/tk-0003/tk-0004 → ac-0003 (whose text claims "at **every** phase boundary", so it is unprovable until the last one), and tk-0005 → ac-000b/ac-000c (both "at each phase boundary"/"every defect" ACs that likewise cannot close until the last phase). All four ACs are correctly left unchecked; the tasks are correctly checked; the relation has no way to say "partially earned". *(Count corrected 2026-08-09 after review F001: this row was first written at 5, mid-tk-0005, and checking tk-0005 then added its own two edges — the miscount is itself evidence of the gap, since the inventory moves every time a task closes against a still-open multi-phase AC.)* **The backpressure survey already carries the concept the plan layer lacks** — bp-000f exists precisely as "ac-0002 PARTIAL (phase-1 scope)", distinct from the phase-2 full-zero bp-0002. Effect: `plan validate` sits at `degraded` for the whole middle of a multi-phase plan, which erodes the signal exactly where a phase boundary wants a clean read | harness @ `df13d4f7`; `harness observe` DL-003 | Not yet sited — plausibly dd plan-semantics (a partial/phase-scoped `satisfies`, or reading the AC's own phase), plausibly a plan-authoring convention (phase-scoped AC rows). **Routes to a design ruling, not a patch** | **CLOSED BY RULING 2026-08-09 — the routed design question was answered at a higher level than it was asked**: Jordan's ontology ruling (dd government `d8950eb`, semantic ontology leaves dd; the `BUILTIN_RELS` closed-set constraint is scheduled to gain an injection point via dd's seam work) supersedes the narrower builtin-partial-relation ruling this row waited on. `satisfies-toward` stands as the correct convention — and post-promotion the vocabulary it extends is builder-owned by right. Original resolution narrative kept below for the audit trail. Warn count at the boundary was **7** (counted by koala; the coder's 5 predated tk-0005's rows — both honest at their basis). dd's PM measured the unblock with a control arm: the relation namespace is **open by design** and the contradiction engine fires only on `CLAIMING_RELS` — so a non-builtin **`satisfies-toward`** edge behaves as `ref`: contradiction gone, `open-completable` on the AC **survives**. Adopted harness-side: `builder/plan` schema gains an optional `tasks[].satisfies_toward` field; phase-1's five cross-phase edges moved to it (`tk-0001→ac-0001` stays `satisfies`, fully earned); `plan validate` now **ok 0/0**. Cost stated plainly: to dd the edge is a plain reference — partial-ness is *recorded* in `bp-000f`, not *meant* by the edge. Forward-compatible: if dd later blesses a builtin partial relation, these documents keep working and gain meaning. Entry stays OPEN on that builtin ruling (routed to dd o-prime); schema edit grew the touch set → material trigger 1 → prime notified at this boundary. **Coder's control-armed cost line (2026-08-09, adopted): the convention MOVES the noise, it does not remove it** — contradictions 7→0 but orphans 7→11; the four multi-phase ACs (ac-0002/0003/000b/000c) now read as *claimed by nothing* until the phase that completes each one adds its genuine `satisfies` edge (phase-2/3 task authoring MUST do so — that is the resolution path, recorded here so it is checked, not assumed). Also sharpened: a hand-kept count of a live WARN class is stale the moment the next task closes — cite the command, not the number. **Crab's mode-split refinement (2026-08-09, adopted)**: the orphan trade is `--complete`-ONLY — mid-flight (`complete:false`) `satisfies-toward` produces NOTHING where `satisfies` produced a contradiction (orphan-claim is gated on completeness at `semantics.ts:166`, whose comment names unclaimed-mid-flight as normal and unclaimed-at-finish as fatal). So the phase-boundary read is cleanly fixed and the trade appears only where an orphan is the wanted signal. **Path-scope caution (wl-0019 @ `85021aa`)**: our no-per-edge-spelling exemption holds for DECLARED fields only; a `links` BUCKET carries `{rel, ref}` per edge with zero diagnostics for near-misses — if 080 or any consumer ever reaches for a bucket, that exposure is live. The both-paths remedy is REGISTER, now materialized harness-side: dw-0154's guard carries an INTENTIONAL_NON_BUILTIN register, so an unregistered or misspelled rel reds the suite |

| 5 | **FX014 message regression via the package path**: harness `4902fef7` improved the untracked-target diagnostic to name its mechanism and remedy — fork `services/dd/core/walk.ts:125` says `` address target is not tracked by git: <path> — track it with `git add <path>` `` (plus the acts-layer remedy-mapper entry in `acts/dd/shared.ts`) — but the package at the pin still emits the weaker `address target is not tracked: <path>` (`dist/core/walk.js:74`). Since the phase-1/2 rewire, `plan validate` consumes the package path, so **the regression already shipped silently on this branch**; phase-3's deletion only removes the last (dying-verb) copy of the good string. Caught by the fork-drain checklist — an already-regressed deferred-fix, the exact class it exists for | fork `3da4b18c` walk.ts:125 vs package `a37a20ec` dist/core/walk.js:74 | **Two-layer split per crab's refusal (2026-08-09) + Jordan's ontology ruling**: `git` is adapter vocabulary and CANNOT go in dd core (`tracked: null` exists for hosts with no tracking concept) — dd files a seam-scoping row for core's mechanism wording ("not in the repository's tracked set"); the REMEDY belongs to the layer that knows the tool = **harness's act layer** (post-080 follow-up: an `address-target-untracked` remedy in plan-validate's next_action channel, where 4902fef7's mapper half architecturally lives) | **OPEN — ruled by prime (2026-08-09): ships with 080, named in the PR BODY as a known accepted degradation (before/after strings + dd seam row + the two closers), never silently; does NOT block merge. No local shim (re-creates the fork on close day). Crab's widened reciprocal rule adopted both ways: "what do your users now see", not just "which call sites move". **PR-BODY FRAMING (prime's ruling, use as the LEAD, not a consolation): the outcome is BETTER than restoring our fix — 4902fef7 put git vocabulary INTO DD CORE, a layering misplacement the fork accepted invisibly (a private copy accepts any layering; nothing objects until you give it back). Consuming the package did not cause the regression so much as REVEAL the misplacement. The agreed shape splits the fix along the seam it should always have had — dd owns the mechanism wording, harness owns the remedy — Jordan's ontology ruling arriving from the opposite direction.** Instrument note for the measurement record: the string pair was obtained by `git show` at named shas after two searches returned clean-empty on the same claim — when a search returns empty, prefer an instrument that can ERROR over one that can SHRUG |

| 6 | **The package's render banner prescribes a command that resolves to a DIFFERENT PROGRAM**: `dist/render/renderer.js:18` stamps every generated `.dd.md` with `GENERATED by \`dd build\`` — and bare `dd` is coreutils' disk-dump on every POSIX system (`/bin/dd`, verified by prime: no `--version`, `dd: unknown operand build` if followed). The fork's banner (`harness dd build`) was namespaced and runnable; the phase-3 regeneration writes the package's non-runnable spelling into 32 tracked files. **A docs convention cannot reach it** — the banner is emitted by the package, so every future regeneration re-writes the broken form; the npx-dd prose rule (adjudications section) fixes our docs, not this | package `a37a20ec` dist/render/renderer.js:18; prime's verification 2026-08-09 | **dd's defect, routed to dajeil by prime (2026-08-09)**: the renderer's banner must be runnable as written — **and after THREE remedy rounds the ruling is: NO CHANGE TODAY, the status quo is the safest of the three candidates** (prime, 2026-08-09, each scored for the reader who meets the banner: `dd build` → coreutils, loud/harmless/confusing; `npx dd build` → downloads a STRANGER'S package, v0.26.0 squats the unscoped name — UNSAFE, rejected; `npx @ai-substrate/dd build` → **E404, never published** — safe but does not work; verified against the proxy WITH a positive control, `@ai-substrate/engineering-harness` 0.13.0 resolving on the same registry+scope, and corroborated by dajeil). **PENDING CHANGE, TRIGGER NAMED: `npx @ai-substrate/dd build` becomes correct the moment Jordan publishes — it belongs IN THE RELEASE COMMIT, never before.** Caveat pinned to the check so it is not re-run and misread: our registry is a lagging Microsoft proxy — a 404 AFTER a release means proxy lag, not non-publication; today the two agree only because dajeil independently confirms it was never published. In-repo invocations are unaffected (`node_modules/.bin/dd`, which is what the test helper uses). Harness closer = re-pin + one-line re-regeneration when dd ships a runnable banner post-publish | **OPEN — ships with 080 as the SECOND named degradation in the PR body (prime's ruling, same shape as ledger #5/FX014): banner not runnable as written, package's spelling, fix upstream, closer re-pin. Never silent — two known-and-accepted degradations in one PR is honest; two undocumented ones is how a reviewer approves something nobody described** |

## Mechanism-copy drift surface — OWNED AT BIRTH (prime's ask, 2026-08-09)

Keep-and-promote (Jordan's ontology ruling) creates a **permanent second copy of dd's
mechanisms**: after phase 3 deletes the fork, the promoted module's copied internals
(**FOUR files — `core/constants`, `core/derive`, `core/rel`, `core/value`; corrected at
tk-0008 completion, coder's catch: `shared/posix-path` is harness's OWN module outside
the fence, imported not copied — a phantom 5th diff target would show permanent
meaningless divergence**) and
dd's originals diverge from the same ancestor with nobody structurally forced to
notice — the byte-identical-fork class arriving **by design**, both directions of which
bit this plan in its first two days. So the copy is born with an owner and a trigger:

- **Owner**: the seat holding harness's dd consumption (today `pij-related-koala`/s065;
  the role transfers with the seat, and this row is the record a successor reads).
- **Triggers** (weak by intent, per prime — a tripwire, not a sync mechanism):
  1. **Every re-pin of `@ai-substrate/dd`** re-runs a diff of the promoted module's
     copied mechanism files against dd's corresponding sources at the new pin sha —
     divergence is a finding to adjudicate (theirs-fixed / ours-fixed / both), never
     auto-applied.
  2. The seat detector **`dd-fork-divergence` re-aims at the promoted module** when
     phase 3 deletes its current subject (phase-3 rider; a dead detector watching a
     deleted tree is silence, not health).
  3. **Reciprocity with dd stands** (dw-0013): harness's copies are enumerated to dd,
     and dd's standing rule — name which consumer call sites a change moves — now
     covers "which enumerated copies a mechanism fix obsoletes".
- **Sunset**: dd's mechanism-vocabulary seam (`6aaef35`, scoped/unscheduled) shipping
  injection points deletes the copies; until then this row is the drift surface's
  standing record. Descoping the sunset re-argues this row, not just the copies.

## Materiality threshold (defined 2026-08-09, before any contest — prime's ask)

Remediation growth is **MATERIAL** — triggering a re-plan at the next phase boundary
instead of riding as a ledgered diff — when ANY of:

1. a remediation touches a file **outside** the declared touch set (the 4 survivors, the
   two dd trees, package.json/lockfile, AGENTS.md, docs/how/consuming-dd.md, doctor,
   retired guard tests, `acts/plan/scaffold.ts` for the plan-new fixes);
2. a single remediation diff exceeds **150 changed lines** or adds a **new public
   surface** (new verb, flag, or export);
3. a phase accumulates **more than 3** harness-side remediation fixes;
4. a fix needs a **dd-side design ratification** (it routes to dd and this plan re-pins —
   never designed here).

Below all four: fix, ledger, cite in the phase execution log. The threshold does not have
to be right; it has to be written (prime, 2026-08-09).

### Commit-provenance defect — the fork deletion rides the WRONG commits (owned: koala)

**2026-08-09, DL-001 third instance, largest of the plan.** The coder's `git rm` staged
261 fork deletions into the SHARED index; koala's ledger commits then ran
`git add <file> && git commit` — pathspec-disciplined on the ADD, **unlimited on the
COMMIT** — and swept them: the fork's deletion physically lives in **`7d112d26`**
("ledger #5 — FX014", 261 deletions) and **`2b5a07af`** (2 generator scripts), while
**`237ab2e1`** (the logical deletion commit) describes a deletion its diff no longer
contains. **Ruled: ACCEPT, do not rewrite** — nothing is pushed, but rebuilding seven
commits under an active coder risks the evidence chain for a provenance nicety that
squash-merge collapses anyway. What survives intact: dw-0017's ordering proof
(`merge-base --is-ancestor 8e9d1ecf 7d112d26` = YES — checklist still precedes the
deletion). **This mapping is the record**: cited in the execution log and carried into
the PR body so `git log` archaeology lands here, not in confusion. **Practice adopted
from this instance: in a shared worktree, commit with a pathspec too —
`git commit -- <paths>` — staging discipline alone does not protect the commit.**

### Materiality adjudications (trigger fired → ruled, not smuggled)

- **2026-08-09, trigger 1 (32 files outside the touch set), phase-3 deletion**: every
  tracked `.dd.md` carried the fork renderer's banner (`GENERATED by \`harness dd
  build\``); the sole surviving renderer (the package) emits `dd build`, so deletion
  made all 32 drifted — caught by `plan-review.test.ts`'s no-drift gate, working as
  designed. Coder escalated instead of smuggling (correct); koala RULED: regenerate all
  32 IN the deletion commit. **CORRECTED before commit (coder's own re-measure, and the
  correction discipline is the record here): the "one identical line per file" claim
  came from a 1-file exemplar generalised to 32 — the full regeneration shows 22/32
  banner-only, but 10/32 ALSO gain a `satisfies_toward` column their tables have owed
  since phase-1's schema change (`57d8bd1f` regenerated only its own file; the other 10
  have been stale against their own schema ever since — they would drift under the
  FORK's renderer too; the deletion exposed this, it did not cause it). RE-RULED as a
  SPLIT: the 22 banner-only files ride the deletion commit; the 10 schema-catch-up
  files land as their OWN commit citing 57d8bd1f — different causes, different owners,
  and the deletion commit stays honest about what deletion did.** The alternative
  (leave them) still converts the corpus one file at a time as unexplained churn inside
  unrelated future commits. Prime notified same-breath. Companion catch, binding on
  tk-000f/tk-0013 docs: bare `dd` resolves to coreutils' disk-dump (`/bin/dd`) — every
  prescription of the standalone CLI: **in-repo, `node_modules/.bin/dd` (safe,
  unambiguous, what the tests use); global/portable prescriptions WAIT FOR JORDAN'S
  PUBLISH** — never bare `dd` (coreutils), never unscoped `npx dd` (a stranger's
  package squats the name — silent remote-code path), and not `npx @ai-substrate/dd`
  YET either (E404 — never published; correct only from the release commit onward).
  Three remedy rounds on a one-word change, each nearly converting a loud harmless
  confusion into a real hazard; the status quo was correct the whole time. A remedy
  is a claim and needs the same verification as the defect — with a positive control.
