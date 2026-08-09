# Phase 1 execution log — Take the dependency and rewire the four consumers

Evidence base for review. One entry per task: what was done, the commands run,
verbatim proof output tails, and discoveries. Written as the work happened.

**Environment**: worktree `s080-dd-consume-upgrade` @ branch `s080/dd-consume-upgrade`,
node v24.7.0, npm 11.10.0, macOS. Harness run in-tree via `node harness/cli/bin/harness.js`.

---

## tk-0001 — Pin the dependency

### The sha

Resolved the current head of the dd work branch, unsandboxed:

```
$ git ls-remote ssh://git@github.com/AI-Substrate/dd.git refs/heads/*
7294b33f835d1c51677f1a839aed7e33406b680b	refs/heads/main
a37a20ecf12342275a9d81b4cf8835302de8e9e0	refs/heads/s002/sdk-build
```

**Pinned sha: `a37a20ecf12342275a9d81b4cf8835302de8e9e0`** — the head of `s002/sdk-build`,
the dd SDK work branch (`feat(ci): dependabot for npm and github-actions — grouped,
weekly, no ignore rules`, 2026-08-09 12:38 +1000).

**Discovery (worth carrying to phase 2's re-pin):** `main` is NOT the branch to pin.
The floor sha `f712ded` is not an ancestor of `origin/main` — the SDK work lives on
`s002/sdk-build` and has not landed on main. Ancestry, per the hard rule (never a
lexical compare):

```
$ cd /Users/jordanknight/substrate/dd
$ git log -1 --format='%H %ci %s' origin/main
7294b33f835d1c51677f1a839aed7e33406b680b 2026-08-09 12:11:42 +1000 docs(gov): a negation whose failure NAMES the plant has verified its own plant
$ git merge-base --is-ancestor f712ded origin/main; echo $?
1                                   # f712ded NOT an ancestor of main

$ git merge-base --is-ancestor f712ded a37a20ecf12342275a9d81b4cf8835302de8e9e0
$ echo $?
0                                   # floor satisfied on s002/sdk-build
```

### The dep

Added to the **root** `package.json` `dependencies` (validation V-1: the repo has one
manifest; `harness/cli` has no `package.json`):

```json
"@ai-substrate/dd": "github:AI-Substrate/dd#a37a20ecf12342275a9d81b4cf8835302de8e9e0",
```

### dw-0001 — resolution + ancestry

```
$ npm ls @ai-substrate/dd
@ai-substrate/engineering-harness@0.13.0 /Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade
└── @ai-substrate/dd@0.1.0 (git+ssh://git@github.com/AI-Substrate/dd.git#a37a20ecf12342275a9d81b4cf8835302de8e9e0)

$ grep '"@ai-substrate/dd"' package.json
    "@ai-substrate/dd": "github:AI-Substrate/dd#a37a20ecf12342275a9d81b4cf8835302de8e9e0",
```

Full 40-char sha, `git+ssh` resolution, ancestry from `f712ded` proven above (exit 0).

### dw-0002 — registry untouched for dd, lockfile pins the same sha

`npm install` run normally (sandbox off, per hard rule 2). Tail:

```
> @ai-substrate/engineering-harness@0.13.0 gen:dd-docs
> node scripts/gen-dd-docs.mjs

gen-dd-docs: wrote 2 docs → harness/cli/src/services/dd/docs/docs-content.ts

added 1 package, and audited 555 packages in 15s
```

One package added, 15s. dd came from git, not the registry — the lockfile entry:

```
$ grep -n -A6 '"node_modules/@ai-substrate/dd"' package-lock.json
42:    "node_modules/@ai-substrate/dd": {
43-      "version": "0.1.0",
44-      "resolved": "git+ssh://git@github.com/AI-Substrate/dd.git#a37a20ecf12342275a9d81b4cf8835302de8e9e0",
45-      "integrity": "sha512-Jf63Zg0+R12fdJf9cLJ8nMEZ48X4PvoKwGcTNxjSvDZrUGHnR4MDjuYXOQez5vnlWV6wlLtZglhmzgJ7RDIInQ==",
46-      "dependencies": {
47-        "commander": "^15.0.0",
48-        "jiti": "2.7.0"
```

`resolved` is `git+ssh://…#<the same 40-char sha>`. The `prepare` script built dd on
install (dist present, no `src/` — see tk-0002).

**Lockfile noise disclosed:** the commit also carries pre-existing churn from npm
11.10 normalising the lockfile it inherited (`engines` key reordered above
`optionalDependencies`; `libc` arrays dropped from optional platform packages). That
drift was already in the worktree before this task and is unrelated to dd; it is
committed with the dd entry rather than hidden by a partial add.

### Discovery — dd's published surface at the pin

Read from the installed package rather than guessed (hard rule 3). `exports` carries
9 root-ish subpaths plus the barrel and `./node`:

`.` (barrel), `./core/address`, `./core/model`, `./core/parse`, `./core/validate`,
`./core/walk`, `./links`, `./node`, `./render/renderer`, `./schema`, `./schema/index`,
`./schema/model`, `./schema/resolve`, `./package.json`.

The barrel (`dist/lib.d.ts`) exports: `isAddressFailure`, `parseAddress`, `DdDoc`,
`parse`, `collectLinkCells`, `DdIssue`, `resolveAddressFile`, `SchemaResolver`,
`DocLoader`, `validateWalk`, `FsDocLoader`, `MemoizingDocLoader`, `SchemaFs`,
`ConventionSchemaResolver`.

`./node` (`dist/node/index.d.ts`) exports exactly five host-bound symbols:
`DdActDeps`, `DD_ISSUE_CODES`, `renderDocument`, `NodeSchemaFs`, `trackedPaths`.

**This is what makes dw-0007 reachable.** `acts/plan/index.ts` imports
`renderDocument` (`../dd/build.js`), `NodeSchemaFs` (`../dd/schema-fs.js`) and
`DD_ISSUE_CODES`/`DdActDeps`/`trackedPaths` (`../dd/shared.js`) — relative `./dd/`
paths that bp-000f's grep counts as fork matches. All five have a verified public
home at `@ai-substrate/dd/node`, so no symbol needed a shim and no act-layer module
had to be relocated (hard rule 4 never fired).

---

## tk-0002 — Promote the POC probe trio into a vitest integration spec

**New file:** `harness/cli/test/integration/dd-package-boundary.int.test.ts` (12 tests).

The POC that proved this route green lived in a session scratchpad
(`scratchpad/poc-d941ece/probe.{mjs,ts}`) which no longer exists on disk — searched
`scratch/`, the s065 worktree, and the worktree tree; only the durable prose record in
`s065 scratch/dd-080-resume.md` survives. So the spec was rebuilt from the SHIPPED
`.d.ts` contracts at the pinned sha (hard rule 3: read the contract, never guess), not
from a copy of the probe.

Contracts read before writing a line: `dist/lib.d.ts`, `dist/node/index.d.ts`,
`dist/schema/model.d.ts` (`SchemaFs` = `readdir`+`exists`+`readText` — the POC's second
trap, confirmed still true), `dist/links/loader.d.ts` (`FsDocLoader(fs, hash, tracked)`,
hash port = `sha256Hex`), `dist/core/walk.d.ts` (`DocLoadResult.tracked: boolean | null`),
`dist/schema/resolve.d.ts`.

**The scan convention was measured, not assumed.** A throwaway probe with a counting
fake port showed the four discovery roots and the exact paths the deep scan touches:

```
roots: doc-folder /repo/docs · gitroot /repo/.dd · harness /repo/.harness/.dd · home /home/u/.dd
probed: readdir /repo/docs, readdir /repo/.dd, readdir /repo/.harness/.dd, readdir /home/u/.dd
```

That is why the fixture serves `/repo/.dd/schemas/probe/plan/schema.json` — the layout
dd actually scans for. (Probe scripts deleted afterwards; `scratch/` is gitignored.)

### What the spec asserts

| group | assertion |
|---|---|
| pin | root manifest spec matches `^github:AI-Substrate/dd#[0-9a-f]{40}$` (no float, no `file:`) |
| pack shape | `dist/` + `dist/lib.js` present; `src`, `test`, `scripts`, `.github` absent |
| negative control | a non-exported deep path fails `ERR_PACKAGE_PATH_NOT_EXPORTED`; an exported one resolves |
| public homes | every symbol the 4 consumers import is present at its named home (barrel, `./links`, `./render/renderer`, `./node`) |
| injection | fixture-owned `SchemaFs` + hash port → `ConventionSchemaResolver` resolves `probe/plan` (root `gitroot`, zero ERROR issues) and `validateWalk` runs clean through `MemoizingDocLoader(new FsDocLoader(...))` |
| memoisation | 2 loads of one path = 1 read of the underlying port |
| A-2 | `tracked === null` (and explicitly `not.toBe(false)`) on a null snapshot; positive control with a real snapshot returns `true` |
| D7 | `resolveAddressFile('/repo/docs/plan.dd.json','C:/other/e.dd.json') === 'C:/other/e.dd.json'`, plus posix-absolute and relative controls |
| host tier | `NodeSchemaFs` typed as `SchemaFs` answers `[]`/`null` for absent paths |
| pin agreement | lockfile `resolved` ends with the same sha the manifest names |

Ports are annotated **at the declaration** (`const fs: SchemaFs = {…}`), per hard rule 3,
so a widened contract lands as a type error on the object rather than a runtime
`undefined is not a function` inside dd's scan.

### dw-0003 — negative control: the spec FAILS when a public export goes missing

Run twice against a deliberately damaged copy of the installed package, then restored.

**(a) subpath removed** — deleted `"./links"` from `node_modules/@ai-substrate/dd/package.json` `exports`:

```
 FAIL  test/integration/dd-package-boundary.int.test.ts [ … ]
Error: "./links" is not exported under the conditions ["node", "development", "import"]
from package …/node_modules/@ai-substrate/dd (see exports field in …/package.json)

 Test Files  1 failed (1)
      Tests  no tests
```

**(b) one symbol removed** — dropped the `trackedPaths` re-export from
`dist/node/index.js`, leaving the exports map intact (the subtler regression):

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  … > exports every symbol the rewired consumers import, at its named home
AssertionError: ./node export trackedPaths: expected { DD_ISSUE_CODES: { …(19) }, …(2), …(1) } to have property "trackedPaths"
 ❯ test/integration/dd-package-boundary.int.test.ts:154:47

 Test Files  1 failed (1)
      Tests  1 failed | 11 passed (12)
```

Both mutations reverted from backups; the spec is green again at the pinned sha:

```
 ✓ test/integration/dd-package-boundary.int.test.ts (12 tests) 80ms
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

**Discovery worth keeping (cost ~10 minutes):** the negative control could NOT be written
as `await expect(import('@ai-substrate/dd/dist/core/parse.js')).rejects…`. Vitest's Vite
transform resolves a literal specifier before any test runs, so the intended-to-fail
import failed the whole FILE to load — a control indistinguishable from a broken suite.
Asking Node's own resolver (`createRequire().resolve`) consults the same `exports` map
with no bundler in the way. Noted in the file's comment so the next author does not
re-discover it.

### dw-0004 — just build && just test green with the new spec in the suite

```
$ just build
> tsc -p harness/cli/tsconfig.json          # exit 0, no diagnostics

$ just test
 Test Files  348 passed (348)
      Tests  5148 passed (5148)
   Duration  21.25s

 % Coverage report from v8
Statements   : 89.85% ( 18676/20785 )
Branches     : 81.16% ( 14137/17418 )
Functions    : 92.14% ( 3145/3413 )
Lines        : 92.22% ( 16608/18008 )
```

(The "423-test flow/plan suite" bar in the brief names the dd/flow/plan slice; the whole
repo suite is 5148 and it is green in full.)

---

## tk-0003 — Rewire acts/flow.ts and acts/plan/fence.ts

### The rewire

`acts/flow.ts` — three fork imports collapse into one package import:

```diff
-import { MemoizingDocLoader } from '../services/dd/links/index.js';
-import { ConventionSchemaResolver } from '../services/dd/schema/index.js';
-import { FsDocLoader } from './dd/shared.js';        // line 80, the relative one
+import { ConventionSchemaResolver, FsDocLoader, MemoizingDocLoader } from '@ai-substrate/dd';
```

All three come from the BARREL (round-2 pattern), not a subpath. `ddGateDeps()` is
otherwise untouched — same composition, same injected `FsPort`, same deliberate
`null` tracking argument.

`acts/plan/fence.ts` — one type import:

```diff
-import type { DdDoc } from '../../services/dd/core/model.js';
+import type { DdDoc } from '@ai-substrate/dd';
```

### THE FINDING — the fork never received dd's A-2 `tracked` fix

The rewire did not compile. Verbatim:

```
harness/cli/src/acts/flow.ts:124:5 - error TS2322: Type 'MemoizingDocLoader' is not assignable to type 'DocLoader'.
  The types returned by 'load(...)' are incompatible between these types.
    Type 'import(".../node_modules/@ai-substrate/dd/dist/core/walk").DocLoadResult' is not assignable to type 'import(".../harness/cli/src/services/dd/core/walk").DocLoadResult'.
      Type '{ ok: true; path: string; doc: DdDoc; sha: string; tracked: boolean | null; }' is not assignable to type '{ ok: true; path: string; doc: DdDoc; sha: string; tracked: boolean; }'.
          Types of property 'tracked' are incompatible.
            Type 'boolean | null' is not assignable to type 'boolean'.

Found 1 error in harness/cli/src/acts/flow.ts:124
```

This is the plan's thesis arriving as a compiler error: **the two implementations
disagree about what `tracked` means.** Measured on both sides rather than inferred —

| | fork @ `5b32d451` | package @ `a37a20ec` |
|---|---|---|
| `FsDocLoader` null snapshot | `tracked: … ? true : …` (`acts/dd/shared.ts:272`) | `tracked: … ? null : …` (`dist/links/loader.js:82`) |
| `DocLoadResult.tracked` | `boolean` (`core/walk.ts:13`) | `boolean \| null` (`dist/core/walk.d.ts`) |
| walk's WARN branch | `if (!loaded.tracked)` (`core/walk.ts:108`) | `if (loaded.tracked === false)` (`dist/core/walk.js:69`) |
| `DdLinkTarget` / `DdGraphNode` | `tracked: boolean` (`links/model.ts:72,106`) | `boolean \| null` (`dist/links/model.d.ts:60,97`) |

The fork's own `FsDocLoader` docstring already promised the fixed behaviour —
"A non-repo (or a failing git) yields null, meaning 'this host has no tracking
concept', not 'everything happens to be tracked'" — while the code three lines below
returned `true`. **The doc was right and the code was wrong**, and nothing caught it.

**Options considered, and why the others are wrong:**

1. Map `null`→`true` (or `?? true`) at the composition root — this is the A-2 lie
   reintroduced, and phase-1 hard rule 6 forbids it in as many words (`tracked`
   branches on `=== false`, never `!tracked`; `null` flows through `acts/flow.ts`
   *deliberately*). A shim, refused.
2. Rewire `services/flow/flow-dd-gate.ts` fully onto the package — does not resolve
   it. The gate calls the fork's `readPlanCheck`, whose `PlanCheckDeps.docLoader`
   is fork-typed (`services/dd/plan/check.ts:232-237`), and plan semantics stay on
   the fork this phase by ratified decision. The mismatch would just move.
3. **Drain dd's A-2 fix into the fork** — taken. It is the direction phase 3 goes
   anyway, it makes the fork agree with its own docstring, and it is what hard
   rule 6 describes.

**Materiality (ledger threshold, checked against all four triggers):** inside the
declared touch set — it names "the two dd trees" explicitly; 5 changed lines, no new
public surface; first harness-side remediation this phase; needs no dd-side
ratification because dd already ratified AND shipped it. Below all four → fix,
ledger, cite here. Ledger entry **#3, CLOSED**.

The fix, 5 lines:

```
services/dd/core/walk.ts:13    tracked: boolean  ->  boolean | null
services/dd/core/walk.ts:108   if (!loaded.tracked)  ->  if (loaded.tracked === false)
services/dd/links/model.ts:72  DdLinkTarget.tracked  ->  boolean | null
services/dd/links/model.ts:106 DdGraphNode.tracked   ->  boolean | null
acts/dd/shared.ts:272          ? true  ->  ? null
```

plus why-comments at each site so the next reader does not "simplify" the `=== false`
back into a negation.

**Coverage discovery, and it is the uncomfortable kind:** the suite passed 5148/5148
BOTH before and after the behaviour changed. Nothing anywhere pinned `tracked` on a
null snapshot, so a consumer on a non-repo host had been handed a confident wrong
answer with the whole test estate green over it. The package's behaviour is now
pinned by `dd-package-boundary.int.test.ts` (A-2 assertion + positive control); the
fork's is deliberately left unpinned because phase 3 deletes it.

### dw-0005 — zero fork imports in the two rewired files

```
$ git grep -nE "services/dd|acts/dd|\./dd/" -- harness/cli/src/acts/flow.ts harness/cli/src/acts/plan/fence.ts
$ echo $?
1
```

No output, exit 1 — zero matches, including the relative `./dd/shared.js` import that
used to sit at `flow.ts:80`.

### dw-0006 — just build && just test green after the rewire

```
$ just build
> tsc -p harness/cli/tsconfig.json          # exit 0

$ just test
 Test Files  348 passed (348)
      Tests  5148 passed (5148)

Statements   : 89.85% ( 18677/20785 )
Branches     : 81.16% ( 14138/17418 )
Functions    : 92.14% ( 3145/3413 )
Lines        : 92.22% ( 16608/18008 )
```

Live smoke on the rewired act (the gate composes the package's loader for real):

```
$ node harness/cli/bin/harness.js flow orient --path docs/plans/080-dd-consume-upgrade/the-flow.json
[pij-related-koala] ◆─◆─[ ◐─◇─◇ ]─◇  ◆ Research · ◆ Plan · [ ◐ P1: Implementation · ◇ Review: P1 · ◇ Ship ] · ◇ Post-flight
  ⚑ gate: P1: Implementation ⛨ 2/5
```

---

## tk-0004 — Rewire acts/plan/pr-body.ts and acts/plan/index.ts

### pr-body.ts

One line moves, one line deliberately does not:

```diff
-import { escapeCell, headingSlug } from '../../services/dd/render/renderer.js';
+import { escapeCell, headingSlug } from '@ai-substrate/dd/render/renderer';
 import type { PlanEdge, PlanIndex, PlanItem } from '../../services/dd/plan/index.js';   // STAYS — phase 2
```

### index.ts — nine fork imports become three package imports

Eleven import statements collapsed. The non-plan symbols by their new home:

| home | symbols |
|---|---|
| `@ai-substrate/dd` (barrel) | `collectLinkCells`, `ConventionSchemaResolver`, `DdDoc`, `DdIssue`, `FsDocLoader`, `isAddressFailure`, `parse`, `parseAddress`, `resolveAddressFile`, `validateWalk` |
| `@ai-substrate/dd/links` | `resolveMapSeed`, `traverseCorpus` |
| `@ai-substrate/dd/node` | `DD_ISSUE_CODES`, `DdActDeps`, `NodeSchemaFs`, `renderDocument`, `trackedPaths` |
| `@ai-substrate/dd/schema/model` | `SchemaIssue` |
| `../../services/dd/plan/index.js` — **UNCHANGED** | `buildPlanIndex`, `itemKey`, `PlanDocument`, `ReadyReading`, `readPlanCheck`, `readPlanReadiness` |

Both schema imports are named per the task and the validation fix: `SchemaIssue` from
`./schema/model` (it is not on the barrel) and `ConventionSchemaResolver` from the
barrel — the same home `acts/flow.ts` uses, so the two composition roots cannot drift
about which resolver they mean.

**The `./node` tier is what made dw-0007 reachable, and it is worth naming why.**
`renderDocument`, `NodeSchemaFs`, `DD_ISSUE_CODES`, `DdActDeps` and `trackedPaths`
came from relative `../dd/*` modules — which bp-000f's grep counts as fork matches
just as hard as a `services/dd` path. Had they lacked a public home this task would
have STOPPED under hard rule 4 (no shims; a missing surface is a dd matter). They did
not: dd ships exactly those five from `@ai-substrate/dd/node`, its host-bound tier,
so nothing had to be relocated, re-implemented or worked around. dd's own
`node/index.d.ts` records that two of them landed there by ratified amendment A-1
after `./core/validate` and `./render/renderer` were measured impossible for them.

`tsc` accepted the swap on the FIRST pass — no adaptation, no cast, no widening at any
call site. The ported symbols are signature-identical to the act-layer originals
(`renderDocument(documentPath, repoRoot, {text?}) => Promise<BuildResult>`,
`trackedPaths(exec, repoRoot) => Promise<ReadonlySet<string> | null>`), which is the
claim the round-2 pattern makes and it held.

### dw-0007 — ONLY the bounded phase-2 remainder (phase-1-scoped proof bp-000f)

```
$ git grep -nE "services/dd|acts/dd|\./dd/" -- harness/cli/src/acts/plan/index.ts harness/cli/src/acts/plan/pr-body.ts
harness/cli/src/acts/plan/index.ts:48:} from '../../services/dd/plan/index.js';
harness/cli/src/acts/plan/pr-body.ts:2:import type { PlanEdge, PlanIndex, PlanItem } from '../../services/dd/plan/index.js';
```

Two matches, both `services/dd/plan` — the deliberate remainder ratified for phase 2.
Zero `acts/dd` matches and zero relative `./dd/` matches, which is the half of bp-000f
the widened grep exists to catch.

### dw-0008 — just build && just test green after the rewire

```
$ just build
> tsc -p harness/cli/tsconfig.json          # exit 0, clean on the first pass

$ just test
 Test Files  348 passed (348)
      Tests  5148 passed (5148)

Statements   : 89.85% ( 18676/20785 )
Branches     : 81.16% ( 14137/17418 )
Functions    : 92.14% ( 3145/3413 )
Lines        : 92.22% ( 16608/18008 )
```

### Tripwires checked, not assumed

- `services/dd/plan/semantics.ts` is byte-untouched — the arch suite's
  `dd-plan-semantics-frozen.test.ts` pin is green inside the 348.
- The two boundary guard tests that skip package specifiers (D-4) were left alone;
  they pass unchanged.

---

## tk-0005 — Dogfood proof at the phase boundary

The plan's own documents, driven by the very code phase 1 replaced.

### dw-0009 — the dogfood pair on the rewired build

bp-000b's command, run verbatim as a chain:

```
$ node harness/cli/bin/harness.js flow orient --path docs/plans/080-dd-consume-upgrade/the-flow.json \
  && node harness/cli/bin/harness.js plan validate docs/plans/080-dd-consume-upgrade/plan.dd.json
$ echo $?
0
```

Per-command envelope status:

```
flow orient   -> ok
flow rail     -> ok
plan validate -> degraded   (error: 0, warn: 5)
```

`flow orient` reads the gate through the REWIRED act — `ddGateDeps` now composes the
package's `ConventionSchemaResolver` + `MemoizingDocLoader(FsDocLoader)` — and the gate
counts this phase's own task document correctly as the work landed:

```
[pij-related-koala] ◆─◆─[ ◐─◇─◇ ]─◇  ◆ Research · ◆ Plan · [ ◐ P1: Implementation · ◇ Review: P1 · ◇ Ship ] · ◇ Post-flight
  ⚑ gate: P1: Implementation ⛨ 4/5
```

That reading is the dogfood proof doing real work rather than smoke-testing: the gate
resolved a schema, loaded documents and derived completion **entirely through the
installed package**, and its count tracked tk-0001..0004 as they were checked.

### `plan validate` is `degraded`, and I am NOT calling that `ok`

dw-0009's text says "all return ok". Two of three do. `plan validate` returns
**`degraded`** — exit 0, **error: 0**, 5 `contradiction` WARNs. Stated plainly rather
than rounded off, because the difference is exactly the kind a reviewer should be able
to grep for.

What the 5 WARNs are, in full:

```
tasks/tk-0002 -> acceptance_criteria/ac-0003
tasks/tk-0003 -> acceptance_criteria/ac-0002
tasks/tk-0003 -> acceptance_criteria/ac-0003
tasks/tk-0004 -> acceptance_criteria/ac-0002
tasks/tk-0004 -> acceptance_criteria/ac-0003
```

Every one is a checked task whose `satisfies` names an acceptance criterion that is
**deliberately not earnable yet**:

- **ac-0002** — "zero imports from `services/dd` or `acts/dd` remain in those files".
  Phase 1 cannot satisfy this and was never meant to: `index.ts` and `pr-body.ts` keep
  their `services/dd/plan` imports by ratified decision, and the AC's own proof row
  bp-0002 is scoped to **ph-1633**, phase 2.
- **ac-0003** — "tsc exits 0 and the full suite is green **at every phase boundary**".
  Green at THIS boundary (5148/5148) but unprovable until the last one.

So the honest state is: both ACs correctly unchecked, both tasks correctly checked, and
the relation with no way to express "partially earned". **ac-0001 WAS checked** — tk-0001
earns it outright — which took the count from 6 WARNs to 5 and is the only AC that moved.

This is logged as **dogfood ledger entry #4, OPEN**, and `harness observe`d as **DL-003**.
It fires materiality trigger 4 (needs a dd-side design ratification), so it is
deliberately NOT patched here. Note the shape of the gap: the backpressure survey
already carries the concept the plan layer lacks — **bp-000f exists precisely as
"ac-0002 PARTIAL (phase-1 scope)"**, authored distinct from the phase-2 full-zero
bp-0002. The survey can say "partial"; `satisfies` cannot.

**Judgement call, flagged for review rather than buried:** dw-0009 is marked checked on
the reading that its subject is "the dogfood pair runs green against plan 080's
documents on the rewired build" — every command exits 0 with zero errors, and the
residual WARNs are true statements about multi-phase plan structure, not defects in the
rewired build. If review reads "all return ok" strictly as envelope status, dw-0009
should be reverted to unchecked and closed at the phase-2 boundary instead; nothing else
in the phase depends on it.

### dw-000a — no silent workarounds

The ledger carries every dd-implementation / builder-flow finding this phase produced:

- **#3 CLOSED** — the fork never received dd's A-2 `tracked` fix (found by tk-0003's
  rewire refusing to compile). Fixed for real, not shimmed.
- **#4 OPEN** — `satisfies` cannot express a partially-earned multi-phase AC (found by
  tk-0005's dogfood). Routed for a ruling, not absorbed.

Both were found by DRIVING the plan with its own tooling rather than by inspection,
which is the whole argument for the dogfood row. Entries #1 and #2 are pre-existing and
untouched by this phase.

`dw-000a` is left for the human reviewer — bp-000c is deliberately human-tier and this
log is the evidence it reads.

### Final proof set, re-run at the phase boundary

```
$ just build
> tsc -p harness/cli/tsconfig.json          # exit 0

$ just test
 Test Files  348 passed (348)
      Tests  5148 passed (5148)

Statements   : 89.85% ( 18676/20785 )
Branches     : 81.16% ( 14137/17418 )
Functions    : 92.14% ( 3145/3413 )
Lines        : 92.22% ( 16608/18008 )

$ git grep -nE "services/dd|acts/dd|\./dd/" -- harness/cli/src/acts/flow.ts harness/cli/src/acts/plan/fence.ts
                                            # zero matches (dw-0005)

$ git grep -nE "services/dd|acts/dd|\./dd/" -- harness/cli/src/acts/plan/index.ts harness/cli/src/acts/plan/pr-body.ts
harness/cli/src/acts/plan/index.ts:48:} from '../../services/dd/plan/index.js';
harness/cli/src/acts/plan/pr-body.ts:2:import type { PlanEdge, PlanIndex, PlanItem } from '../../services/dd/plan/index.js';
                                            # ONLY services/dd/plan (dw-0007)

$ npm ls @ai-substrate/dd
└── @ai-substrate/dd@0.1.0 (git+ssh://git@github.com/AI-Substrate/dd.git#a37a20ecf12342275a9d81b4cf8835302de8e9e0)
```

### Left for review, deliberately not done here

- **`ph-1d68` phase state stays unchecked.** Closing a phase is the review node's call
  (`review-1` is `next` in the flight plan), not the implementing seat's.
- **`ac-0002` / `ac-0003` stay unchecked** — see above.
- **Nothing pushed, no PR opened**, per the dispatch.

---

## Post-review: F001 (review APPROVE, 2026-08-09, pij-modern-caribou / GPT-5.6 Terra)

Review verdict **APPROVE**, Required Fixes: **None**. Two adjudications landed that this
log had left open:

- **dw-0009 accepted as checked** — explicitly on the "pair ran with zero errors" reading,
  *not* a claim that all three envelopes carry `status: ok`. The judgement call flagged in
  the tk-0005 section is therefore closed as ruled, not as assumed. No state change needed.
- **The A-2 drain and the `a37a20ec` pin** were both re-verified independently by the
  reviewer (`merge-base --is-ancestor` exit 0; no surviving truthiness read of `tracked`).

### F001 (LOW, evidence) — ledger entry 4 inventoried 5 contradictions, live run reports 7

Verified rather than accepted on report:

```
$ node harness/cli/bin/harness.js plan validate docs/plans/080-dd-consume-upgrade/plan.dd.json
{"command":"plan validate","status":"degraded", ...
 "counts":{"error":0,"warn":7,
   "semantic":{"items":436,"completable":45,"open":30,"contradictions":7,"orphans":7,...}}
"next_action":"7 contradiction(s) and 0 other WARN-class finding(s) — a row claims to be
 done while something it rests on is not."
EXIT=0
```

The seven edges, from the same run:

| task | → AC | why the AC cannot close yet |
|---|---|---|
| tk-0002 | ac-0003 | "at **every** phase boundary" |
| tk-0003 | ac-0002 | phase 2 takes plan semantics off the fork |
| tk-0003 | ac-0003 | "at every phase boundary" |
| tk-0004 | ac-0002 | phase 2 |
| tk-0004 | ac-0003 | "at every phase boundary" |
| tk-0005 | ac-000b | "at each phase boundary" |
| tk-0005 | ac-000c | "every defect ... zero silent workarounds" |

**Root cause of the miscount, which is not a typo.** The row was written *during* tk-0005,
before tk-0005 itself was checked; checking it then added its own two edges. The inventory
is a moving number by construction — it grows every time a task closes against a still-open
multi-phase AC. That makes the miscount a second, sharper datum for entry 4 rather than an
erratum: a hand-kept count of this class of WARN is stale the moment the next task closes.
Recorded as such in the ledger; error count is unchanged at **0**, so no proof is affected.

Ledger entry 4 updated (count 5 → 7, both `tk-0005` edges named, correction dated and
attributed to review F001). No source change — trigger 4 still fires, so the design ruling
remains OPEN and unpatched.
