# Cross-model review — Plan 055 (vendor `builder`, baked skills, version-safe update)

- **Reviewer model**: `claude-opus-4-8` (canary)
- **Coder model**: gpt-5.5 (flow-pair delegation)
- **Diff**: `.flow-pair/runs/2026-07-06T20-24-55Z-github.com-AI-Substr/diffs/diff-0001.patch` + working tree
- **Verdict**: **APPROVE_WITH_NOTES**
- **Green baseline**: full suite `2229 passed (2229)`, 175 files — reproduced locally. GREEN confirmed; DIM-0 below proves it is not vacuous.

---

## DIM-0 — test non-vacuity (mutation testing, MANDATORY)

No `just flow-pair-mutate` here, so I mutated the SOURCE by hand on the two most load-bearing assertions, ran the specific vitest file, confirmed RED, and reverted. Both mutations reverted; `grep MUTATION` clean; both files restored to green (`55 passed`).

| # | Assertion under test | Source mutation | Result |
|---|---|---|---|
| 1 | Re-exec branch — after a binary upgrade, bare update spawns the FRESH `harness skills update` child, not an in-process reconcile (`update.test.ts:351`) | `update.ts:549` → `const binaryUpgraded = false` | **RED** — 1 failed: "after a binary upgrade … re-execs the fresh harness skills update child" (expected `[VIEW, INSTALL(latest), 'harness skills update --target codex']`, got the in-process `npx …add/remove` argv) |
| 2 | Absolute-path argv — the packaged source is staged to an ABSOLUTE temp dir before `npx skills add` (`skills.test.ts:288-293`, `291`) | `skills.ts:139` → return `source: PACKAGED_SKILLS_SOURCE` (the non-absolute `'packaged'` sentinel) instead of the absolute `tempDir` | **RED** — 5 failed, each asserting the argv contains `/tmp/harness-skills-0` (absolute) |

Both target tests are **non-vacuous**: they fail under a targeted break of exactly the behaviour they claim to guard. The plan's central risk (non-absolute path → vercel treats it as a git source; stale in-process reconcile after upgrade) is genuinely fenced by the suite.

---

## Focus-area findings

### 1. `acts/update.ts` — version-safe reconcile ✅ (with one LOW note)

- **Correct.** On `binaryUpgraded` the code takes the `binaryUpgraded` branch (`update.ts:360-409`) which spawns `deps.exec.run('harness', planCommandArgs(plan), …)` — i.e. `harness skills update --target …`. This branch **never** calls `resolvePackagedSkillsDir()` / `stageSkillsSource()` in-process, so it structurally **cannot** stage stale skills from the old process. Staging + `resolvePackagedSkillsDir` are confined to `reconcilePlanInProcess` (`:148-170`), reached only when NOT upgraded (already-latest).
- **Upgrade detection** (`:549`): `before !== after` where `after = result.latest`. Already-latest sets `installed_after === installed_before` → in-process (correct, current process IS latest). Real upgrade sets `after = latest` (≠ before) → re-exec (correct).
- The re-exec child inherits `cwd`, passes `--global`/`--source` only when they diverge from the packaged default (`planCommandArgs :91-96`), and the child writes its own lock — provenance stays consistent. Multi-scope locks (project + global) each re-exec. All sound.

**FINDING U-1 (LOW / robustness — non-blocking).** Upgrade detection misses the case where the post-install version is *unknown*. When the registry lookup returns `latest === null` (`:496` guard fails) but `npm i -g @latest` nonetheless succeeds and upgrades, `installedAfter` is `null` (`:510`) → `after` is not a string → `binaryUpgraded === false` → **in-process** reconcile instead of re-exec. This is the exact AC-09 guarantee narrowed. Practical impact is limited (an in-process `resolvePackagedSkillsDir()` reads `skills/` *fresh from disk* at the same global path npm just overwrote, so the content is usually the new one), and the co-occurrence "view fails / install succeeds" is rare on a public package — hence LOW, not blocking.
  - *Smallest fix*: derive the flag from "an install actually ran" rather than a version delta, e.g. `const binaryUpgraded = binary.data.already_latest !== true && typeof before === 'string';` (bare update only skips install when `already_latest`). Strictly safer, closes the null-version hole, and the existing tests still pass (already-latest → false; known upgrade → true).

### 2. `acts/skills.ts` + `services/skills/skills-service.ts` — local-path install ✅

- **Absolute path is guaranteed.** `prepareSkillsSource` (`skills.ts:131-139`) stages via `deps.fs.mkdtemp('harness-skills-')` → returns `source: tempDir`. `NodeFs.mkdtemp` = `mkdtempSync(join(tmpdir(), prefix))` (`node-fs.ts:110-112`) → always absolute. `resolvePackagedSkillsDir` uses `fileURLToPath(new URL(…))` → absolute. The non-absolute sentinel `'packaged'` never reaches the argv (it is only the *lockSource* label). Verified: the raw source passed to `npx skills add` is the absolute temp dir.
- **Runtime depth verified.** `resolvePackagedSkillsDir` = `../../../../../skills` from `dist/services/skills/skills-service.js`. I resolved it against the real built dist: → `<repo>/skills`, exists, contains `builder/SKILL.md`. Holds in-repo and under `node_modules/<pkg>/…` (both `harness/cli/dist` and `skills` ship under package root). No silent-break.
- copy-to-temp → `npx skills add <abs>` flow is exactly `copyDir(packaged)→mkdtemp→npx skills add <path>` as specified. Failure to stage yields `E170`/`E108` envelopes (never a crash).

### 3. `services/skills/skills-lock.ts` — scope / merge / fallback ✅

- Scope selection correct: project → `<cwd>/.harness/skills.lock.json`; global → `<home>/.harness/…`, `null` when `home()` is null → `writeMergedSkillsLock` returns `false` (no throw), reads return `emptySkillsLock()`.
- Merge dedupes targets keyed by `(scope, source)`, preserves first-seen order, keeps project/global separate (unit-proven). `readSkillsLock` treats `null` / non-JSON / wrong `lockfile_version` / bad `installs` all as empty → **unreadable → report-only fallback** holds (AC-03/AC-04). Minor: distinct `source` values in one scope create two entries and both reconcile on bare update — additive, not incorrect (follows every recorded method).

### 4. `adapters/fs` `copyDir` — dest-root, never throws ✅

- `FsPort.copyDir` contract: "dest is the destination ROOT; the source basename is not added." Proven by the real-`NodeFs` test (`fake-fs.test.ts:365-384`): `readText(join(dest,'SKILL.md'))` — not `dest/src/SKILL.md`. `NodeFs.copyDir` wraps `cpSync(src,dest,{recursive:true})` in try/catch → returns `false`, **never throws** (`node-fs.ts:63-70`). Fake mirrors dest-root semantics and the false-on-missing-source path.

---

## Additional verification (beyond the four focus areas)

- **AC-01 packaging**: `npm pack --dry-run` includes all five baked trees — `skills/builder/SKILL.md`, `skills/validate-v2`, `skills/plan-0-v2-constitution`, `skills/plan-v2-extract-domain`, `skills/the-flow/SKILL.md` (490 files total). Offline-install guarantee ships.
- **Vendored content**: `skills/builder` present, `name: builder`, **zero** residual `/the-flow ` command strings (T001 rewrite complete); `the-flow` redirect present with `name: the-flow`; 3 dep slugs present with original names (T002).
- **Full suite**: `2229 passed (2229)` reproduced.

---

## Verdict rationale

Every load-bearing behaviour is correct and non-vacuously tested; the packaging + offline-install guarantee is real; the version-safe re-exec structurally excludes stale in-process staging. The single note (U-1) is a narrow robustness gap on the AC-09 detection predicate with limited practical impact and a one-line safer fix — it does not block. **APPROVE_WITH_NOTES.**
