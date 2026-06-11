# Dossier: the fix for `npm install -g github:…` → `ERR_MODULE_NOT_FOUND: commander`

**Repo:** `AI-Substrate/harness-engineering` (this upstream repo)
**Branch reproduced on:** `feat/harness-cli-core`
**Date:** 2026-06-11
**Status:** Research-only (read-only). No code changed. Empirical reproductions below.
**Companion input:** the downstream dossier from `myob-lab/engineering-harness` (`harness-nucleus`).

---

## 0. TL;DR

The downstream dossier's headline fix — *"bundle `commander` and `jiti` into `dist/app.js`"* — **cannot be done for `jiti`** (proven below: jiti lazy-`require`s its own transpiler and breaks when flattened into a bundle). And the downstream dossier was written about a repo that **commits `dist`**; **this upstream repo gitignores `dist`**, so it has an *additional, earlier* failure the downstream never saw.

There are **two independent failure modes** on the git‑URL install path here, and `npm install -g github:…` trips both:

| | Failure mode | Root cause | Reproduced |
|---|---|---|---|
| **A** | Install dies during `prepare` | `harness/cli/dist` is **gitignored** → the clone has no `dist` → `prepare: npm run build` is **mandatory** and depends on the full devDep toolchain (`tsc` + `@types/node` + `biome`) succeeding inside npm's transient clone | ✅ `TS2688: Cannot find type definition file for 'node'` |
| **B** | Install "succeeds" but runtime deps are missing | `npm i -g git+…` does **not materialize** the package's runtime `dependencies` (`commander`, `jiti`) for this package shape (scoped/plain name + `files` allowlist + `bin` + `prepare`) | ✅ empty `node_modules`; in my repro `bin`/`dist` files were also dropped via a `TAR_ENTRY_ERROR` |

The **proven‑working** channel is the **tarball / registry‑style** install (`npm pack` → `npm i -g ./pkg.tgz`, and by extension `harness skills install` / `npx skills add`). I re‑confirmed it on this repo: deps delivered, `harness help` returns a valid envelope.

**Recommended fix (decision-ready, layered):**
- **Tier 1 (do regardless):** commit `dist` + guard `prepare` (no build at install time) + add a CI `check:dist` drift gate, and **extend `package-smoke` to also test a git‑URL install** so this never regresses silently.
- **Tier 2 (choose one):**
  - **(recommended, matches the project's stated model)** Treat `npm i -g github:…` as **unsupported**; bless `npx github:…#<tag>` and `harness skills install` (both deliver deps). Optionally bundle `commander` (works) into the committed dist as hardening.
  - **(only if bare `npm i -g github:` must work)** Ship a **fully self‑contained committed artifact**: bundle `commander` + **vendor `jiti`** into `files`. This is the realistic version of the downstream's "bundle" idea, since jiti can't be bundled.

---

## 1. What the reporter hit (recap)

`npm install -g "github:…"` then `harness help` →

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'commander' imported from
  …/.npm/_cacache/tmp/git-clone…/harness/cli/dist/app.js
```

Two tells: (1) `commander` (a declared runtime dep) isn't resolvable; (2) the bin is executing **from npm's git‑clone temp dir**, not a materialised global install. Both are symptoms of mode B.

---

## 2. The correction the downstream dossier needs

The downstream dossier states (about `harness-nucleus`):

> `prepare` is a no-op on a fresh clone here because **`dist` is committed (186 tracked files)** …

That is **not true of this upstream repo.** Here:

```
$ git ls-files harness/cli/dist | wc -l       →  0      (nothing tracked)
$ git check-ignore harness/cli/dist/index.js  →  harness/cli/dist/index.js   (IGNORED)
$ grep -n dist .gitignore                      →  83:dist
$ git archive HEAD harness/cli/dist | tar -t | wc -l  →  0   (absent from any git export)
```

So the upstream's `prepare` is **`npm run build` (unconditional)** and it is **load-bearing** — a git clone has no `dist` and *must* rebuild. The downstream forked and **committed `dist`** + **guarded `prepare`**, which is why it skipped straight past mode A to mode B. We have to fix **both**.

---

## 3. Evidence (all reproduced locally on `feat/harness-cli-core`)

Isolated npm prefixes; `git+file://` to avoid network/GitHub variance. Node v24.7.0, npm v11.10.0.

### 3.1 Mode A — `prepare` rebuild fails on a real git install
`npm i -g "git+file://<repo>#feat/harness-cli-core"` (dist gitignored, so clone has none):
```
npm error command sh -c npm run build
npm error error TS2688: Cannot find type definition file for 'node'.
npm error gen-docs: biome not found …
npm error git dep preparation failed
```
The install **never completes** — the toolchain inside npm's transient clone is incomplete, and the build is mandatory because there's no committed `dist`. (Even when the toolchain *is* complete, this is a full `tsc` + `gen:docs` on every install — slow and one more thing that can break.)

### 3.2 Mode B — commit dist + guard prepare ⇒ build is skipped, but deps still missing
I made a throwaway clone *exactly like the downstream* (copied the real built `dist`, `git add -f`'d it → 186 files, guarded `prepare`), then git‑installed:
```
added 3 packages in 4s                      ← fast: no build (guard worked)
$ ls <prefix>/lib/node_modules/harness-engineering/node_modules   → (empty)
$ find <prefix> -type d -name commander -o -name jiti              → NONE
npm warn tar TAR_ENTRY_ERROR ENOENT … harness/cli/dist/adapters/clock
```
`commander`/`jiti` are **nowhere in the prefix** — this is the downstream's mode B, **reproduced on upstream**. (The `TAR_ENTRY_ERROR` also dropped `bin`/`dist` files in my run — same "npm mishandles this package's git install" story.) "added 3 packages" is npm's optimistic count; nothing usable landed on disk.

### 3.3 The working channel — tarball / registry-style
```
$ npm pack            → harness-engineering-0.1.0.tgz   (prepare builds dist in the full repo)
$ npm i -g ./harness-engineering-0.1.0.tgz
  added 3 packages in 243ms
$ ls …/node_modules   → commander  jiti                 ← deps delivered ✅
$ harness help        → {"command":"help","status":"ok",…}   ← runs ✅
```
This is the path `harness skills install` (→ `npx skills add`) and the repo's own `package-smoke` CI job use. It works because npm installs a real package tarball **with its `dependencies`**, never touching the lossy git‑clone path.

### 3.4 Why "just bundle jiti" (downstream option 1) is impossible
Bundling the CLI's actual imports with esbuild (`--bundle --platform=node --format=esm`, `createRequire` banner so the CJS `commander` works):
```
✅ commander  — bundles & runs (404 KB output) once the createRequire banner is added
❌ jiti       — runtime crash:  Error: Cannot find module '../dist/babel.cjs'
```
`jiti` lazily `require()`s its **own** transpiler (`../dist/babel.cjs`) at first `.ts` load. Flattened into a bundle, that relative path resolves next to the *bundle*, not next to jiti → it can never find its engine. **jiti is fundamentally un-bundleable here.** `commander` (pure JS, CJS) bundles fine. So the downstream's option 1 only half-exists; the jiti half must be **vendored**, not bundled.

> Note: jiti is needed at runtime even though we ship **no** extensions — consumers author `.ts` extensions in their *own* `.harness/extensions/`, and jiti is what transpiles them on load (`commander` for the CLI itself, `jiti` for `.ts` extensions). `.harness/extensions/` in this repo is dogfooding only and is never packed.

---

## 4. The distribution model this repo actually declares

From `README.md` + bundled `docs-content.ts` + the release section:
- **Blessed:** `npx github:AI-Substrate/harness-engineering <cmd>` and `harness skills install` (wraps `npx skills add`, registry-style).
- **Explicit:** *"There is **no** npm publish — install pins a tag: `npx github:…#vX.Y.Z`."*

`npm install -g github:…` (what the reporter used) is **not** a documented path. That matters for the recommendation: the cheapest honest fix is to make the blessed paths bulletproof and route users to them — not to bend `npm i -g github:` into shape (which, per §3.4 + §3.2, is the expensive option).

⚠️ Caveat worth verifying: `npx github:…` uses the *same* npm git‑install machinery, so it *may* be exposed to the same mode‑B dep‑drop. The only thing guaranteed immune to npm's git‑install quirks is a **self‑contained committed artifact** (§5, Tier‑2 vendor option) or the **registry/tarball** channel (§3.3, already proven). If "bulletproof `npx github:`" is required, prefer the self-contained artifact.

---

## 5. Recommended fix

### Tier 1 — do regardless (cheap, kills the dominant failure)

1. **Commit `harness/cli/dist`.** Remove the `dist` line's effect for this path (e.g. un-ignore `harness/cli/dist`, or `git add -f`). The clone then already has the artifact → no build needed.
2. **Guard `prepare`** so it builds only when the artifact is absent:
   ```jsonc
   "prepare": "node -e \"try{require('fs').accessSync('harness/cli/dist/index.js')}catch{require('child_process').execSync('npm run build',{stdio:'inherit'})}\""
   ```
   (This is exactly what the downstream did — adopt it here.)
3. **CI `check:dist` drift gate** — rebuild and fail on diff, so the committed artifact can never drift from `src`:
   ```jsonc
   "check:dist": "npm run build && git diff --exit-code harness/cli/dist"
   ```
4. **Extend `package-smoke` to also exercise a git‑URL install** (`npm i -g \"git+file://$PWD#<branch>\"` → assert `harness help` runs). Today it only covers the tarball path — which is precisely why this regression shipped. This is the single most important durable change: it makes the failure *visible in CI* whatever fix is chosen.

> Tier 1 alone makes the blessed `npx github:` path **fast and free of the TS2688 class of failure** (no rebuild). It does **not** by itself fix mode B for `npm i -g github:` (see §3.2).

### Tier 2 — choose based on one product decision

**Q: Must `npm install -g github:…` work on a clean machine, or is `npx github:…` / `harness skills install` an acceptable supported install?**

- **2a — `npx`/`skills` is acceptable (RECOMMENDED).** Document `npm i -g github:` as unsupported; point onboarding at `npx github:…#<tag>` and `harness skills install` (both deliver deps; tarball path proven in §3.3). Optionally **bundle `commander`** into the committed dist (esbuild + `createRequire` banner — proven to work) as hardening so one of the two runtime deps stops mattering at all. Lowest friction; matches the repo's stated "no npm publish" model.

- **2b — bare `npm i -g github:` is a hard requirement.** Ship a **fully self-contained committed artifact**:
  - bundle `commander` into `dist` (works), **and**
  - **vendor `jiti`** into the shipped tree (`harness/cli/dist/vendor/jiti/**` added to `files`; point `jiti-loader.ts`'s import at the vendored copy — vendoring preserves jiti's package layout so its internal `require('../dist/babel.cjs')` still resolves, unlike bundling).
  - Then runtime needs **zero** dependency resolution and npm's git‑install dep‑drop is irrelevant. Cost: a few hundred KB committed + a re-vendor step gated on jiti bumps. This is the *realistic* form of the downstream's "option 1/2".

- **2c — publish to a registry (revisit AC-15 "no publish").** Routes every consumer through the **proven registry/tarball path** (§3.3): `npm publish` builds once in CI (full devDeps → kills mode A) and bakes `dist` into the tarball; a registry install delivers `commander`+`jiti` normally (kills mode B). No git-clone machinery at all. **Which registry matters:**
  - **GitHub Packages** (`@ai-substrate/harness-engineering` on `npm.pkg.github.com`) — **requires an auth token (`read:packages` PAT + `.npmrc`) to install, even for *public* packages** (verified against current GitHub docs; no anonymous install, unlike public npm/GitLab). ✅ Excellent for an **internal/org audience** already GitHub-authed — notably the **downstream MYOB** consumers. ⚠️ For the **public OSS upstream**, it's a *downgrade* from `npx github:` (which needs no token).
  - **Public npm** (`npmjs.com`) — the *only* channel that gives a true **zero-auth one-liner** (`npx @ai-substrate/harness-engineering`, `npm i -g …`). This is what "hand someone one command" actually needs. The spec deliberately avoided it (AC-15); revisiting that is the real decision, not GitHub-Packages-vs-git-URL.
  - **Costs (either registry):** rename to scoped `@ai-substrate/harness-engineering` → **breaks the contract import** `harness-engineering/contract` → `@ai-substrate/harness-engineering/contract` (docs + every extension author); reverse AC-15 in `004-harness-core-spec` + README + `docs-content.ts`; add a publish step to `release.yml` (`registry-url` + `NODE_AUTH_TOKEN`). Publishing makes Tier‑1 "commit dist" largely moot for the registry path (publish CI builds it) — keep committed-dist + guarded-prepare only if you want `npx github:` as a no-auth fallback.

  **Audience decides 2c:** internal/org → **GitHub Packages** is a clean win; anonymous public → **public npm** (GitHub Packages would re-introduce friction).

### My single recommendation
The choice collapses to **one question: who installs this, and do they need a zero-auth one-liner?**

- **Public OSS upstream, must stay zero-auth → Tier 1 + 2a.** Commit dist, guard prepare, add the dist-drift gate, smoke the git path in CI, bless `npx github:…#<tag>` + `harness skills install`, mark `npm i -g github:` unsupported. Fixes the dominant reproduced failure (mode A), keeps the no-token install, no rename. Escalate to **2b (vendor jiti)** only if the literal `npm i -g github:` must also succeed.
- **Internal/org audience (e.g. downstream MYOB) → 2c via GitHub Packages.** A real internal feed is strictly better than git-URL installs and immune to every npm git quirk; the auth requirement is a non-issue when consumers are already org-authed. Pair with Tier 1 only if you want `npx github:` as a fallback.
- **Want a true public registry one-liner → 2c via public npm**, not GitHub Packages (GitHub Packages can't do anonymous install). This is the cleanest end-state for "hand anyone one command," at the cost of revisiting AC-15 and the scoped rename.

The wrong move is GitHub Packages *for an anonymous public audience* — it reverses AC-15 **and** still leaves a per-user token step, getting the costs of publishing without the "one-liner" benefit.

---

## 6. What changed vs. the downstream dossier

| Downstream dossier said | Reality here (upstream) |
|---|---|
| `dist` is committed (186 files); `prepare` is a no-op | `dist` is **gitignored / untracked**; `prepare` is **mandatory** → extra failure mode A |
| Root cause: git install drops runtime deps (mode B) | **Confirmed** here too — but it's the *second* of two failures, not the only one |
| Fix option 1: bundle `commander` **and `jiti`** | **`jiti` can't be bundled** (proven §3.4); only `commander` can. The jiti half must be **vendored** |
| Tarball path works | **Confirmed** independently on upstream (§3.3) |

---

## 7. Reproduction recipe (clean, isolated)

```bash
REPO=/path/to/harness-engineering; BR=feat/harness-cli-core
# Mode A — real git install (dist gitignored → must build → fails):
P=$(mktemp -d); npm_config_prefix="$P" npm i -g "git+file://$REPO#$BR"     # TS2688 / build fails

# Working path — tarball:
T=$(mktemp -d); (cd "$REPO" && npm pack --pack-destination "$T")
P2=$(mktemp -d); npm_config_prefix="$P2" npm i -g "$T"/*.tgz
"$P2/bin/harness" help          # → {"command":"help","status":"ok",…}   deps delivered

# jiti-can't-bundle spike:
npx esbuild@0.28.0 entry.mjs --bundle --platform=node --format=esm \
  --banner:js="import{createRequire as c}from'node:module';const require=c(import.meta.url);" \
  --outfile=b.mjs && node b.mjs ext.ts     # → Cannot find module '../dist/babel.cjs'
```

---

## 8. Suggested next step

This is research only — no files changed beyond this dossier. To turn the recommendation into work:
- `/plan-1b-specify` to spec the packaging fix (commit-dist + guard-prepare + dist-drift gate + git-URL smoke; with the Tier‑2 decision captured as a clarification), **or**
- `/plan-2c-workshop` if you want to design the self-contained-artifact option (2b: bundle commander + vendor jiti) in depth before committing to it.

Open decision to resolve first (drives everything else): **who installs this, and must it be a zero-auth one-liner?**
- internal/org consumers → **2c GitHub Packages** (clean; auth is free for them).
- anonymous public, one-liner required → **2c public npm** (revisits AC-15) or **2b vendor jiti** (keeps git-URL).
- anonymous public, `npx`/`skills` acceptable → **Tier 1 + 2a** (no rename, no publish, fixes the dominant failure).

Note: §4's AC-15 risk note *predicted* mode A ("`prepare` build failures surface only at install time") but its mitigation ("the CI build job") runs in the full repo, not npm's git-clone — so it never caught this. Any chosen fix should add the **git-URL smoke** (Tier 1.4) so the prediction is actually covered next time.
