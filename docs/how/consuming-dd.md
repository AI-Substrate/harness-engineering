# Consuming `dd` as a package

`dd` (deterministic documents) is **not vendored into this repo**. It is an installed
dependency pinned by full git sha, and it is operated through **its own CLI**. This page
is the whole route: how the pin works, how to move it, what to re-verify when you do, and
the traps that have already cost this repo time.

Plan 080 removed the vendored fork (`services/dd`, `acts/dd`) and the entire
`harness dd *` verb family. If you are looking for `harness dd validate`, that is why it
is gone — see [the CLI section](#the-cli-there-is-no-harness-dd) below.

---

## 1. The pin: a full 40-character sha, and why not a branch

The root `package.json` — the repo's **only** manifest — carries:

```json
"@ai-substrate/dd": "github:AI-Substrate/dd#a37a20ecf12342275a9d81b4cf8835302de8e9e0"
```

Three properties are deliberate:

- **Full 40 hex characters.** A short sha is ambiguous and a tag is mutable. The
  package-boundary test asserts the spec matches `^github:AI-Substrate/dd#[0-9a-f]{40}$`,
  so a float or a `file:` path fails a test rather than shipping.
- **A WORK BRANCH, not `main`.** `origin/main` is **not pinnable** — dd's shipping line
  is its work branch (`s002/sdk-build` at the time of writing). Resolve the head with
  `git ls-remote ssh://git@github.com/AI-Substrate/dd.git refs/heads/*` and take the
  branch head.
- **The lockfile agrees.** A separate assertion checks the lockfile's `resolved` ends
  with the same sha the manifest names. A manifest and a lockfile disagreeing about the
  pin is the failure this catches.

Prove a claimed pin by **ancestry, never by string comparison**:

```bash
git merge-base --is-ancestor <known-good-sha> <claimed-sha>
```

A lexical compare of two shas is meaningless — they are hashes, not versions.

## 2. Re-pinning

The loop, when dd fixes something we need:

1. **Report it to dd** with the exact call site. Do not shim it here — a local
   workaround is invisible to dd and outlives the reason for it.
2. dd fixes it on the work branch and pushes.
3. Resolve the new head (`git ls-remote …`), update the sha in the **root**
   `package.json`, and reinstall.
4. Re-run [the re-verify trio](#4-what-to-re-verify-after-a-re-pin).
5. Diff the [copied mechanisms](#6-the-mechanism-copies-drift-triggers-and-sunset).

The reinstall is about **12 seconds**. Budget the review, not the install.

## 3. The npm-git sandbox caveat

**Run installs in a normal shell.** `npm install` of a git dependency **fails under a
sandboxed shell**: git cannot write `~/.npm`'s cache, and npm's retry then reports the
failure as `destination already exists` — which sends you hunting a stale directory that
is not the problem. The message names a symptom of the retry, not the cause.

If you see `destination already exists` on a git dep, suspect the sandbox first.

## 4. What to re-verify after a re-pin

Three checks, all mechanised in
`harness/cli/test/integration/dd-package-boundary.int.test.ts` — run that file, but know
what it is asking:

| check | what it proves | why it exists |
|---|---|---|
| **pack shape** | `dist/` and `dist/lib.js` present; `src`, `test`, `scripts`, `.github` **absent** | a package that ships its own test tree is a package whose internals we will start importing |
| **foreign-port injection** | a fixture-owned `SchemaFs` + hash port drives `ConventionSchemaResolver` and `validateWalk` end to end | dd must accept OUR adapters. If it only works with its own, it is not a library |
| **A-2 `tracked === null`** | a null snapshot yields `tracked === null` — asserted explicitly `not.toBe(false)` | the honesty fix: `null` means "not measured", `false` means "measured, not tracked". Collapsing them is a lie a consumer cannot detect |

The A-2 row is the one to keep. It is asserted as `=== null` **and** `not.toBe(false)`
because those fail differently: a regression that maps unknown→false passes an
`!== true` test and would sail through a laxer assertion.

Also worth a negative control on any re-pin: a non-exported deep path must still fail
with `ERR_PACKAGE_PATH_NOT_EXPORTED`. A dd release that accidentally widens its exports
map is not visibly different until something reaches through it.

## 5. The CJS caveat: the barrel has no `require`

dd's `"."` export declares only `types` and `import` — **no `require` condition**. So:

```js
require('@ai-substrate/dd')   // ✗ "No exports main defined"
import … from '@ai-substrate/dd'  // ✓
```

This bites in test helpers, where reaching for `createRequire()` to probe a module is a
natural move. Use a static ESM import. (If you need *absence* to be a controllable
runtime failure rather than a load-time crash, use a variable specifier with
`/* @vite-ignore */` — a literal `import()` of a missing module is resolved by Vite at
TRANSFORM time and fails the whole file.)

## 6. The mechanism copies: drift triggers and sunset

`services/plan-semantics/dd-mechanisms/` holds **four** deliberate copies of dd internals
that have no published home — `constants`, `derive`, `rel`, `value`. They are enumerated
with provenance at each declaration and in the directory README, and an architecture test
re-measures that each origin is genuinely unreachable through the exports map.

They are a known drift surface with an owner and three triggers:

1. **Every re-pin** diffs the copies against dd's sources at the new sha. Divergence is a
   finding to adjudicate (theirs-fixed / ours-fixed / both) — **never auto-applied**.
2. **The seat's `dd-fork-divergence` chore** watches the same four files.
3. **Reciprocity with dd**: our copies are enumerated to them, so a mechanism fix on
   their side names which of our copies it obsoletes.

**Sunset**: dd's mechanism-vocabulary seam (`6aaef35`, scoped/unscheduled) shipping
injection points deletes the copies. Descoping that sunset re-argues this arrangement,
not just the copies.

> The count is **four**, not five. `shared/posix-path` is harness's own module, imported
> rather than copied — a phantom fifth diff target would show permanent, meaningless
> divergence.

## The CLI: there is no `harness dd`

`harness dd *` was removed. `harness plan` and `harness flow` still work — they consume
the package directly — but `validate`, `build`, `set`, `doctor`, and `link` now come from
dd's own CLI.

**Invoke it as `node_modules/.bin/ddocs <verb>`.** Four spellings, and only one is both
correct and runnable today:

| spelling | what actually runs |
|---|---|
| `node_modules/.bin/ddocs` | **ours — use this** |
| `dd` | coreutils' disk-dump utility (`/bin/dd`). Fails loudly on our verbs — harmless, but not ours |
| `npx dd` | **an unrelated package that really exists on npm** (`npm view dd version` → `0.26.0`). In a repo without ours installed, this **fetches and executes remote code** |
| `npx @ai-substrate/dd` | ours, and the right spelling **after publication** — but `npm view @ai-substrate/dd version` returns **E404** today, and there is registry/proxy lag after any release |

Internalise the third row. `npx dd` is dangerous **precisely because it looks like the
careful fix** for bare `dd`: someone told "stop using bare `dd`" reaches for `npx` as the
obvious hardening, and trades a loud harmless failure for a silent supply-chain one. So a
rule must **name the safe spelling**, never merely forbid the unsafe one.

And the fourth row is why the safe spelling has to be *runnable at the moment it is
read*: a prescription that 404s is exactly how a reader talks themselves back into
`npx dd`.

`harness doctor` carries a `dd-cli` row reporting whether the CLI is reachable —
non-fatally, and only in a repo that actually has `.dd.json` documents.

## Known accepted degradations

Two ship knowingly with plan 080, both recorded in the plan's dogfood ledger rather than
left for a reader to discover:

- **FX014** — harness's improved untracked-target diagnostic (`… not tracked BY GIT …
  track it with git add …`) did not go upstream: dd refused it on ontology grounds
  (`git` is adapter vocabulary; `core` cannot name it). The package emits the shorter
  string. Ledger row #5.
- **The render banner** — dd stamps every generated `.dd.md` with ``GENERATED by `dd
  build` ``, a command that resolves to coreutils. It is the package's spelling, so no
  docs convention can reach it; the fix is upstream and closes on a re-pin. Ledger row #6.
