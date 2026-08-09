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
