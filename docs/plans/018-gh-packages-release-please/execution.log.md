# Execution Log — 018 GH Packages via release-please (Simple mode)

**Plan**: [gh-packages-release-please-plan.md](./gh-packages-release-please-plan.md)
**Branch**: `feat/harness-cli-core` (281 commits ahead of `main`; **PR #1 → main**, open). Plan 018 lands on this branch — it *is* the real PR to main.
**Started**: 2026-06-11

---

## T000 — Harness pre-flight (pre-implement seam)

Router installed (`~/.claude/skills/eng-harness-flow`). Boot health via the fast proxy `harness doctor`
(this repo's boot = the vitest suite; the full suite runs at T16 — proxy now, full at the end, not twice).

- **Verdict**: `degraded` (exit 0) — **4 dogfood extensions loaded, 0 failed** (`validate-harness-flow`,
  `arch-check`, `validate-harnessability`, `skills-check`). `degraded` is a convention warning
  (instructions.md / temp-dir), not a load failure → **proceed** (also pre-stages T5).

## T1 — Infra preconditions (human gate; recorded here, surfaced in PR)

Verified what's machine-checkable; the rest is human-judgement / runtime-proven:
1. **Org allows `GITHUB_TOKEN` to publish packages** — not readable via `gh` (org Actions setting).
   Default is allowed when the job grants `permissions: packages: write`; **proven for real by the first
   publish / canary**. → surface in PR; do not block wiring.
2. **`@ai-substrate` scope usable + package↔repo link** — owner is `AI-Substrate` (PUBLIC repo), so scope
   `@ai-substrate` == owner (case-insensitive) ✅; the `repository` field (T3) links the package to the repo. **Satisfied by T3.**
3. **First-publish visibility** — chosen at/after first publish in the package settings. Note: GitHub Packages
   **npm always requires auth** (no anonymous install) regardless of visibility — documented in install docs (T13).

→ T1 recorded; (2) satisfied in-plan; (1)/(3) are human-confirm + canary/first-publish proof.

## ⚠️ Discovery D1 — `workflow_dispatch` not triggerable pre-merge

`gh workflow list` shows **only CI** registered — the Release workflow isn't on `main` yet. GitHub only
registers `workflow_dispatch` for workflows **present on the default branch**. So a canary that exists *only*
on this branch **cannot be hand-dispatched pre-merge** — which defeats AC-11's "prove from the branch without
merging." **Adaptation (T11):** the canary also accepts `push:` on a `canary/**` branch pattern (push triggers
run from the pushed branch's copy, no default-branch dependency), so it *can* be exercised pre-merge by pushing
`canary/<x>`; `workflow_dispatch` is kept too for the post-merge ergonomic path. Logged; faithful to AC-11's intent.

## ⚠️ Discovery D2 — bare-name doc-drift beyond the plan's hand-list

The plan's AC-6 grep gate is scoped to `harness-engineering/contract` (the import specifier). Renaming the
**package** also makes a few *bare-name* references stale that AC-6 does not check:
- `package.json` / `package-lock.json` `name` — handled by T3 + lock regen (in plan).
- `AGENTS_README.md` — the home-repo **detection probe** (`"name": "harness-engineering"`) and the
  vendor-from-source **tarball patterns** (`harness-engineering-*.tgz` → scoped `ai-substrate-engineering-harness-*.tgz`).
  Stale = an agent mis-detects this repo. **Updated** as an in-spirit extension (mirrors how Finding 01 grew the list).
- **Left intentionally**: `harness-foundations/**` (the *discipline*/article name + martinfowler URL),
  `docs/retros/**` + `.harness/records/**` (`runDir:` filesystem paths + historical records — never rewrite history),
  `.harness/engineering-harness.md` title + the eng-harness skill detection prose (the **repo** name stays `harness-engineering`).

---

## Rename cluster (T2 → T7) — DONE

- **T2/T4** — Scoped the rename **by grep** (not the hand-list): 24 files / 37 hits. Swept 23 non-generated
  files with `perl s{harness-engineering/contract}{@ai-substrate/engineering-harness/contract}g`; the 3
  generated `docs-content.ts` hits came from `gen:docs`. Residual (non-generated) = **0**. Both Finding-01
  JSDoc source sites (`extensions/contract.ts:4`, `record/contract.ts:5`) were in the worklist and renamed.
- **T3** — `package.json`: name → `@ai-substrate/engineering-harness`; added `publishConfig.registry`
  (GitHub Packages) + `repository`. Lockfile name propagated (`npm install --package-lock-only`).
- **T5** — `harness doctor`: **4 dogfood extensions load, 0 E140** post-rename. Self-reference resolves via
  the renamed package's own `exports` map (dev-only; not shipped).
- **T6** — `package-smoke` fixture import updated by the sweep (`ci.yml`); pack→install→run shape unchanged.
- **T7** — Stale-specifier grep gate added to `ci.yml` (early, fail-fast). **Caught a self-match bug**: the
  gate's own pattern string tripped it → assembled the needle from a shell `OLD` var + reworded messages so
  the workflow can't match its own gate. Re-verified residual = 0.

## CI sensors + publish wiring (T8 → T11) — DONE

- **T8** `ci.yml` scope==owner assert (`@ai-substrate` == `AI-Substrate`, case-insensitive) ✅.
- **T9** `ci.yml` `npm publish --dry-run` smoke — verified locally it exits 0 without auth and targets
  `npm.pkg.github.com`; asserts scoped name + `bin` + `dist` via `npm pack --dry-run --json`.
- **T10** `release.yml` publish job — `id: release` + **job-level `outputs:` re-export** of `release_created`;
  `publish` job `needs: [release-please]` + `if: …release_created == 'true'` (singular), `packages: write`,
  setup-node `registry-url`/`scope: '@ai-substrate'`, `NODE_AUTH_TOKEN: GITHUB_TOKEN`. YAML-validated; gate
  shape readback confirmed.
- **T11** `release.yml` canary job — ephemeral `npm version --no-git-tag-version <base>-canary.<run>` (never
  committed) + `npm publish --tag canary`. **D1 adaptation**: triggers on `workflow_dispatch` **or**
  `push` to `canary/**` (the latter works pre-merge; `workflow_dispatch` only registers once on `main`).

## Docs + governance (T13 → T15) — DONE

- **T13** `harness/cli/README.md` Install/run → registry install + consumer `.npmrc` + `read:packages` token.
  (Root `README.md` install is *skills* install — unaffected; CLI install lives in the CLI README.)
- **T14** Reversed "no npm publish": `release.yml` header (rewritten), `harness/cli/README.md` release copy,
  `using-harness-docs.md` example, AC-15 forward-note in `harness-core-spec.md`.
- **T15** Governance: `constitution.md` §1 + §4 and `architecture.md` §1 + §4 now describe the GitHub Packages
  registry model (Deviation Ledger follow-through). **D2** AGENTS_README: row-0 detection probe + vendor
  tarball patterns (`ai-substrate-engineering-harness-*.tgz`) + the "signs a repo has a harness" line.
- Regenerated `docs-content.ts` from all bundled `.md` sources; **idempotent** (gen×2 = identical) → CI
  `check:docs` will pass.

## T16 — Green loop ✅ (after the T7 self-match fix)

`build` ✅ · `tsc --noEmit` ✅ · `check:docs` ✅ · `biome` ✅ · **vitest 52 files / 505 tests ✅** ·
`arch-check` ✅ · `skills-check` ✅ · **grep gate residual = 0** ✅ · both workflow YAMLs parse ✅.

## T12 — HELD (awaiting go-ahead)

Dispatching a canary **publishes a real, immutable version** to GitHub Packages (outward-facing) and needs
the T1 org preconditions. Held for explicit user confirmation; trigger = push a `canary/**` branch.

## T0zz — Phase-end seam

Observe buffer empty this run (discoveries D1–D3 recorded **in this log** rather than the buffer) → retro
drain is a no-op. Phase-end seam: nothing to drain/harvest.

## ⚠️ Discovery D3 — install-METHOD migration is broader than the plan scoped

The plan's T13 scoped the install rewrite to the two READMEs. But the operational CLI-install path still says
`npm install github:` / `npx github:` in: **AGENTS_README Stage 1**, **`eng-harness-0-setup` SKILL.md/README**,
and **INSTALL.md**. These are the agent-facing onboarding flows — leaving them on the git-URL path means the
fix isn't delivered to the primary consumer surface. The registry install also requires a consumer `.npmrc` +
`read:packages` token (a heavier story). **Recommended follow-up** (out of this plan's validated scope):
migrate those flows to the registry install. Surfaced for an explicit scope decision rather than silently 3×-ing the plan.

## AC status at phase end

Verified locally: **AC-1, AC-2, AC-4, AC-6, AC-8, AC-9, AC-10** ✅. Awaiting CI/merge/dispatch:
**AC-5/AC-7** (package-smoke tarball install — CI proves on push), **AC-3** (publish on real release — post-merge),
**AC-11** (canary — T12 dispatch held).
