# Fix FX001: publish to the public npm registry (zero user auth)

**Created**: 2026-06-15
**Status**: 🟩 **Repo work complete** (2026-06-15) — FX001-1…5 all applied; **611 tests green**, `npm run build` clean, biome clean, docs regenerated (no `.npmrc`/`read:packages` copy anywhere in src/test/docs). `NPM_TOKEN` repo secret added. **Remaining (publisher-side, not code)**: H1 (npm org `ai-substrate`) + H2 (`npm login`) → first publish (H4 `npm publish --access public`, or next release-please cut) → verify anonymous install (H5). Not yet committed.
**Plan**: [019-harness-update](../harness-update-plan.md)
**Source**: User requirement — *"this needs to work without any special auth from users."* Plan 018 chose **GitHub Packages** as the distribution channel; empirically that channel cannot serve anonymous installs.
**Domain(s)**: harness-cli (distribution config + error copy + docs — **no Envelope/port/act contract change**)

---

## Problem

`harness update` / `self-install` shell `npm i -g @ai-substrate/engineering-harness`, and the once-a-day check shells `npm view … version`. Both resolve against whatever registry npm is pointed at. Plan 018 publishes the package to **GitHub Packages** (`publishConfig.registry = https://npm.pkg.github.com`), and **GitHub Packages' npm registry requires a token for every read — even of public packages.** Proven empirically on 2026-06-15:

```
npm view … --registry=https://npm.pkg.github.com   → 401 "authentication token not provided"
curl  https://npm.pkg.github.com/@ai-substrate%2f…  → HTTP 401
npm view … --registry=https://registry.npmjs.org    → 404 (never published there)
```

GitHub Packages returns `401` *before* it will say whether a package exists — there is no anonymous read path. "Public" there means *"any authenticated GitHub user,"* not *"anyone."* (This is the npm registry specifically; GHCR/containers allow anonymous public pulls — npm never has.) Consequence: every user would have to mint a GitHub PAT with `read:packages` and hand-write a `~/.npmrc`, which directly violates the requirement.

This is **not a bug in the 019 update code** — that code is registry-agnostic and works against any registry. It is the **018 channel choice** that's incompatible with zero-auth install.

## Proposed Fix

**Publish to the public npm registry (npmjs.org) with `--access public`.** Then `npm i -g @ai-substrate/engineering-harness`, `harness update`, `self-install`, and `--check` all work **anonymously, zero config**. The publisher does a one-time org + token setup; **users do nothing**.

Keep the scope `@ai-substrate/engineering-harness` (create/own the npm org `ai-substrate`, free for public packages) so `constants.ts:PACKAGE_NAME` and every reference stay unchanged. 019's `npm view` / `npm i -g` calls work as-is.

The only repo changes are the **publish target** (manifest + CI) and the **GitHub-Packages-specific copy** that 018/019 baked into error messages, code comments, and docs (it would mislead users on npmjs.org). The `E201` *code* stays (genuine registry/transient failures still happen) but its `next_action` stops telling users to configure `.npmrc`/a PAT.

**Rejected alternatives**: `npm i -g github:AI-Substrate/harness-engineering` (anonymous, but builds-from-source on install and the version-check would need a GitHub-tags adapter instead of `npm view`); release-asset tarballs (same extra moving parts). npmjs.org is the standard CLI path and leaves 019's lookup mechanism intact.

### Human / external actions (publisher-side, NOT in the repo — done by you)

| # | Action | Notes |
|---|--------|-------|
| H1 | **Own the `@ai-substrate` scope on npmjs** — create the npm org `ai-substrate` (npmjs.com → *Add Organization* → Free) if you don't already own it | Free plan = unlimited **public** packages. One-time. |
| H2 | **`npm login` in the terminal** | Browser login to npmjs.com ≠ CLI auth. `npm whoami` currently fails (ENEEDAUTH) on this machine. Needed for a local `npm publish`. |
| H3 | **Create an npm Automation token + add repo secret `NPM_TOKEN`** | For the CI publish job (FX001-1). Granular/automation token, *publish* scope. This is **CI** auth, never user-side. |
| H4 | **First publish** — `npm publish --access public` from repo root (after FX001-1 lands), or CI does it on the next release | Publisher-side 2FA OTP if enabled. Sets the `latest` dist-tag automatically — this also resolves the 018 residual where `--check` found no version. |
| H5 | **Verify anonymous install** in a clean shell with no `.npmrc` | `npm view @ai-substrate/engineering-harness version` and `npx @ai-substrate/engineering-harness@latest --version` must work with **no token**. |

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| harness-cli | owner | `publishConfig` re-pointed; `release.yml` publish + canary jobs re-pointed (registry-url, `--access public`, `NODE_AUTH_TOKEN` → `NPM_TOKEN`); `E201` `next_action` copy (`install.ts`) + doc comment (`error-codes.ts`); GH-Packages comments in `node-version-lookup.ts` / `version-lookup-port.ts` / `acts/update.ts`; consumer docs (`README.md`, `keeping-the-harness-up-to-date.md`) + regenerated `docs-content.ts`. **No** change to the `Envelope`/ports/acts, no new error code, `PACKAGE_NAME` unchanged. |

## Tasks

| Status | ID | Task | Path(s) | Done When |
|--------|-----|------|---------|-----------|
| [x] | FX001-1 | **Re-point the publish target** — `publishConfig` → `{ "registry": "https://registry.npmjs.org", "access": "public" }`. In `release.yml`: both the `publish` and `canary` jobs → `registry-url: https://registry.npmjs.org`, `npm publish --access public`, `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`; drop the GH-Packages `.npmrc` write in the canary install-proof step (replace with a no-`.npmrc` anonymous install). | `package.json` · `.github/workflows/release.yml` | `npm publish` resolves to npmjs.org; CI uses `NPM_TOKEN`; canary proves an **anonymous** (no-`.npmrc`) install. |
| [x] | FX001-2 | **Rewrite install-failure copy** — `classifyInstallFailure` E201 `next_action` (`install.ts:79-82`): drop the `.npmrc`/`read:packages` instruction; reword to a public-registry reality (package public; a 401/403/404 now means the registry is down or the version isn't published yet — *"retry, or check the package is published"*). Update the `E201` doc comment (`error-codes.ts:48`) to match. Keep the code path + code. | `harness/cli/src/services/update/install.ts` · `harness/cli/src/output/error-codes.ts` | No E201 surface tells a user to configure `.npmrc`/a PAT; message accurate for npmjs.org. |
| [x] | FX001-3 | **Scrub GH-Packages code comments** — `node-version-lookup.ts:7-8`, `version-lookup-port.ts:3`, `acts/update.ts:412-413` (all cite "GitHub Packages" / `.npmrc` / `read:packages`). Reword to "the public npm registry." | listed files | `grep -riE "github packages|read:packages|\.npmrc" harness/cli/src` returns nothing (excluding tests/historical plan docs). |
| [x] | FX001-4 | **Rewrite consumer docs** — `README.md` *Install / run* (lines 9-23: replace the scope-route + token steps with plain `npm i -g @ai-substrate/engineering-harness`), the `E200`–`E204` row (156), the *Releases* paragraph (186, → npmjs.org); `keeping-the-harness-up-to-date.md` (lines 7, 12 prerequisite, 34 E201 row). Then `npm run gen:docs` and confirm `npm run check:docs` passes. | `harness/cli/README.md` · `docs/how/keeping-the-harness-up-to-date.md` · `harness/cli/src/services/docs/docs-content.ts` (regenerated) | Docs describe zero-auth install; `check:docs` drift-guard green. |
| [x] | FX001-5 | **Tests + build green** — update `install.test.ts` E201 assertions to the new copy; re-check `update.test.ts` / `app.test.ts` / `index.test.ts` for any GH-Packages copy assertions; `just fft`; full `vitest run` green; `npm run build` exit 0. | `harness/cli/test/**` | Full suite green; build clean; biome clean. |

## Acceptance

- [ ] After publish (H4), a user with **no `.npmrc` and no token** runs `npm i -g @ai-substrate/engineering-harness` and `harness --version` succeeds.
- [ ] `harness update --check` against npmjs.org returns the **real** `latest` (not `null`), anonymously — and the `update_available` banner fires when a newer version exists.
- [ ] No source comment, error `next_action`, or consumer doc names `read:packages`, an `.npmrc` token, or "GitHub Packages requires authentication" as a **user prerequisite** (grep-clean over `harness/cli/src` + `docs/how` + `README.md`).
- [ ] `release.yml` publishes to npmjs.org with `--access public` via `secrets.NPM_TOKEN`; the canary job proves an anonymous install.
- [ ] `E201` still exists for genuine registry/transient failures, but its message/`next_action` is accurate for a public registry.
- [ ] Full vitest suite green; `npm run build` clean; `npm run check:docs` passes.

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
