# Dogfood-findings ledger — plan 080

Jordan's scope ruling (2026-08-09, verbatim in plan clarifications): defects found in the
harness dd implementation or builder flow while driving this plan are 080's to remediate
to a working solution. **This ledger closes to zero silent workarounds (AC-000c).**

Every entry: what bit, basis sha, where the fix lands, current state. An entry is CLOSED
only by a working fix (harness-side, or dd-side consumed via re-pin) or Jordan's explicit
ruling — never by a workaround alone.

| # | Finding | Basis | Fix site | State |
|---|---------|-------|----------|-------|
| 1 | **E450 section-create gap**: `dd set`/`add` cannot create a schema-declared section absent from the document; `plan new` seeds 6/22 declared sections; sharpened by dd (crab, repro at `41ed739`): `dd rm` of an optional section is a **one-way door** — the sanctioned interface can remove but never restore; root cause `locate.ts:33/36` conflates two states under one reason code | harness fork + dd `7e570bc`..`41ed739` | dd: implicit-create or section verb (o-prime ratification pending) + reason-code split (I weighted: split unblocks tooling regardless); harness fallback: `plan new` seeds ALL declared sections (= fr-0002's harness half, moved into 080 per prime) | **OPEN** — plan 080 authored via seed-then-validate workaround, reported same-breath. **Progress 2026-08-09**: dd shipped the reason-code split at `012b6bd` (`section-absent` = declared-but-uncreated/seedable vs `section-unknown` = undeclared; next_action no longer circles to `dd schema show`); implicit-create is **RATIFIED, not shipped** (dd o-prime schedules) — ratification probe: dd already implicit-creates at FIELD level, so section-level create removes an inconsistency, not a widening. Harness side stays open until implicit-create lands (close via re-pin) or the `plan new` seed-all fix ships |
| 2 | **fr-0007 ordinal gap**: `plan new` has no `--ordinal` while the folder contract is `<ordinal>-<slug>` — a bare slug silently creates a second folder and stamps `meta.slug` from it | harness @ `ee8f37fb` | harness: `plan new --ordinal` (or ordinal-aware slug resolution reusing an existing `NNN-slug` folder) — same verb as entry 1's fallback, bundle the fix | **OPEN** — accepted INTO 080 (2026-08-09, prime's flag, koala's call under Jordan's ruling). **Best evidence is the live workaround** (prime's point, adopted): 080 itself passed the ordinal-embedded slug `080-dd-consume-upgrade`, so this very plan's `meta.slug` carries the prefix — the fix's acceptance test is that a bare `plan new dd-consume-upgrade --ordinal 80` reproduces this folder with a clean slug |
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

| 4 | **`satisfies` is binary, so a multi-phase AC reads as a contradiction**: `plan validate` reports every checked phase-1 task whose `satisfies` names a deliberately multi-phase acceptance criterion as a `contradiction` WARN. **Seven** of them at the closed phase-1 boundary — tk-0003/tk-0004 → ac-0002 (which only completes when phase 2 takes plan semantics off the fork), tk-0002/tk-0003/tk-0004 → ac-0003 (whose text claims "at **every** phase boundary", so it is unprovable until the last one), and tk-0005 → ac-000b/ac-000c (both "at each phase boundary"/"every defect" ACs that likewise cannot close until the last phase). All four ACs are correctly left unchecked; the tasks are correctly checked; the relation has no way to say "partially earned". *(Count corrected 2026-08-09 after review F001: this row was first written at 5, mid-tk-0005, and checking tk-0005 then added its own two edges — the miscount is itself evidence of the gap, since the inventory moves every time a task closes against a still-open multi-phase AC.)* **The backpressure survey already carries the concept the plan layer lacks** — bp-000f exists precisely as "ac-0002 PARTIAL (phase-1 scope)", distinct from the phase-2 full-zero bp-0002. Effect: `plan validate` sits at `degraded` for the whole middle of a multi-phase plan, which erodes the signal exactly where a phase boundary wants a clean read | harness @ `df13d4f7`; `harness observe` DL-003 | Not yet sited — plausibly dd plan-semantics (a partial/phase-scoped `satisfies`, or reading the AC's own phase), plausibly a plan-authoring convention (phase-scoped AC rows). **Routes to a design ruling, not a patch** | **OPEN (builtin ruling) — noise CLEARED via convention** (2026-08-09). Warn count at the boundary was **7** (counted by koala; the coder's 5 predated tk-0005's rows — both honest at their basis). dd's PM measured the unblock with a control arm: the relation namespace is **open by design** and the contradiction engine fires only on `CLAIMING_RELS` — so a non-builtin **`satisfies-toward`** edge behaves as `ref`: contradiction gone, `open-completable` on the AC **survives**. Adopted harness-side: `builder/plan` schema gains an optional `tasks[].satisfies_toward` field; phase-1's five cross-phase edges moved to it (`tk-0001→ac-0001` stays `satisfies`, fully earned); `plan validate` now **ok 0/0**. Cost stated plainly: to dd the edge is a plain reference — partial-ness is *recorded* in `bp-000f`, not *meant* by the edge. Forward-compatible: if dd later blesses a builtin partial relation, these documents keep working and gain meaning. Entry stays OPEN on that builtin ruling (routed to dd o-prime); schema edit grew the touch set → material trigger 1 → prime notified at this boundary. **Coder's control-armed cost line (2026-08-09, adopted): the convention MOVES the noise, it does not remove it** — contradictions 7→0 but orphans 7→11; the four multi-phase ACs (ac-0002/0003/000b/000c) now read as *claimed by nothing* until the phase that completes each one adds its genuine `satisfies` edge (phase-2/3 task authoring MUST do so — that is the resolution path, recorded here so it is checked, not assumed). Also sharpened: a hand-kept count of a live WARN class is stale the moment the next task closes — cite the command, not the number |

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
