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
