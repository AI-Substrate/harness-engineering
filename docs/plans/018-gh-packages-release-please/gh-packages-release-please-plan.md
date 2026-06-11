# Publish the harness CLI to GitHub Packages (release-please) — Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-11
**Spec**: [gh-packages-release-please-spec.md](./gh-packages-release-please-spec.md)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` markers remain; both Open Questions resolved (Round 2). |
| G2 | Constitution | PASS | Reverses the descriptive "no npm publish" delivery note (Const. §4 / Arch. §4) — covered by the **Deviation Ledger** below + governance-doc update task T15. No numbered MUST-principle is violated. |
| G3 | Architecture | PASS | No layer-boundary/dependency-rule change (packaging + CI + docs only; CLI source architecture untouched). Arch §4 "Packaging & Install Topology" is descriptive — updated by T15. |
| G4 | ADR Compliance | N/A | `docs/adr/` holds no ADRs. |
| G5 | Structure | PASS | All required sections present and populated. |
| G6 | Testing Alignment | PASS | Lightweight + CI smoke; every claim has a deterministic sensor (grep gate, scope check, tarball smoke, dry-run, canary). Acceptance criteria measurable. |
| G7 | Domain Completeness | PASS | All 4 informal source clusters present; Domain Manifest covers every file/glob referenced in tasks; no NEW domains. |

## Summary

The advertised git-URL install is broken (`ERR_MODULE_NOT_FOUND: commander` / `TS2688`); the fix is to route every consumer through the **registry** path by publishing the CLI to **GitHub Packages**, automated by **release-please** on merge to `main`. This single Simple-mode PR does three things: (1) renames the package to the org scope `@ai-substrate/engineering-harness` and ripples the contract-import specifier through **every** site (driven by grep, not a hand-list); (2) adds a publish job to `release.yml` gated on release-please actually cutting a release, plus a branch-dispatchable **canary** job that proves the full publish+authed-install path end-to-end *before* merge; (3) rewrites install docs, reverses the AC-15 "no npm publish" copy everywhere it lives, and updates the governance docs that still describe the old model. Expected outcome: a working, versioned, pinnable `harness` install from a real registry, with the publish wiring proven on the PR branch.

## Target Domains

> No formal `docs/domains/` registry exists; these are informal source clusters named for traceability only (no files moved/refactored).

| Domain | Status | Relationship | Role |
|--------|--------|--------------|------|
| packaging/release (`package.json`, `release.yml`, release-please config) | existing | **modify** | Scoped name + `publishConfig` + `repository`; publish job gated on release-please; canary job |
| ci/smoke (`ci.yml`, `package-smoke`, fixtures) | existing | **modify** | Fixture import rename; tarball smoke; publish dry-run; grep gate; scope==owner assert |
| docs (`README`, `docs-content.ts` + `.md` sources, `examples/`) | existing | **modify** | Install-instruction rewrite; contract-import rename; AC-15 reversal |
| extension-contract (`exports["./contract"]`, `harness new` scaffold) | existing | **modify** | New import specifier `@ai-substrate/engineering-harness/contract` |

No new domains.

## Domain Manifest

| File / glob | Domain | Classification | Rationale |
|-------------|--------|----------------|-----------|
| `package.json` (root) | packaging/release | **contract** | The published manifest — name, `publishConfig`, `repository`, `bin`, `exports`. |
| `.github/workflows/release.yml` | packaging/release | internal | Add `id` to release-please step; publish job + canary job. |
| `.github/workflows/ci.yml` | ci/smoke | internal | `package-smoke` fixture rename; tarball smoke; dry-run; grep gate; scope==owner assert. |
| `harness/cli/src/services/scaffold/templates.ts` | extension-contract | **contract** | What `harness new` emits — the import string future authors get. |
| `harness/cli/test/services/scaffold/templates.test.ts` | ci/smoke | internal | Assertion strings must track the scaffold. |
| `harness/cli/src/services/extensions/contract.ts` | extension-contract | **contract** | **JSDoc `@example` import (line 4) — NOT in spec's hand-list; caught by grep.** |
| `harness/cli/src/services/record/contract.ts` | extension-contract | **contract** | **JSDoc `@example` import (line 5) — NOT in spec's hand-list; caught by grep.** |
| `harness/cli/examples/extensions/{hello,build}/extension.ts` | docs | internal | Example authors copy these. |
| `harness/cli/test/integration/fixtures/**/.harness/extensions/**` | ci/smoke | internal | `repo/` + `repo-conflict/` fixtures (incl. `.js` JSDoc, `flat-legacy.ts`). |
| `.harness/extensions/{arch-check,validate-harness-flow,validate-harnessability,skills-check}/**` | extension-contract | cross-domain | Repo's own dogfood extensions; self-reference the package — must still load post-rename. |
| `docs/how/extend-the-harness.md`, `docs/how/record-and-record-types.md` | docs | internal | `.md` SOURCES → regenerate `docs-content.ts`. |
| `harness/cli/docs/authoring-verbs.md` | docs | internal | `.md` source (3 hits). |
| `harness/cli/src/services/docs/docs-content.ts` | docs | internal | **GENERATED — never hand-edit; regenerated by `gen:docs`; `check:docs` enforces parity.** |
| `harness/cli/README.md` + root `README.md` install section | docs | internal | Registry-install + `.npmrc`/token (AC-10); AC-15 reversal (AC-9). |
| `docs/plans/004-harness-core/harness-core-spec.md` | docs | internal | "Reversed in plan 018" note on AC-15 (AC-9). |
| `docs/project-rules/constitution.md` (§4) , `docs/project-rules/architecture.md` (§1/§4) | governance | internal | Update old "no npm publish / npx-from-repo-URL" copy (Deviation Ledger / T15). |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | **Critical** | The spec's hand-enumerated AC-6 list **misses 2 source files** — `src/services/extensions/contract.ts:4` and `src/services/record/contract.ts:5` (JSDoc `@example` imports). The real worklist is **24 files / 37 occurrences**. | **Drive the rename by `grep`, not the hand-list.** AC-6's `grep -rn "harness-engineering/contract" == 0` (excl. `docs/plans/**`, `.git`) is the authoritative completeness gate — make it a CI check (T7) so a missed site fails the build. |
| 02 | **Critical** | The current `release-please-action@v4` step (`release.yml:22-27`) has **no `id:`** AND the `release-please` job declares no `outputs:`. A cross-job gate `needs.release-please.outputs.release_created` therefore resolves to **nothing** → a silent no-op → the publish job would run on **every** push. | (a) Add `id: release` to the step. (b) Add a **job-level `outputs:` block** mapping `release_created: ${{ steps.release.outputs.release_created }}` — this is load-bearing. (c) Gate the publish job: `needs: [release-please]` + `if: needs.release-please.outputs.release_created == 'true'` (string compare — Actions outputs are strings). Use the **singular** `release_created` (`releases_created` plural is a v3→v4 trap that defaults truthy). The published **version** is whatever release-please already committed to `package.json` on `main`; `npm publish` uses that — no tag output needed. |
| 03 | High | Constitution §4 ("Versioning … no npm publish required for this slice") **and** architecture.md §1/§4 (npx-from-repo-URL topology) still assert the OLD model. AC-9's reversal list **omits both governance docs**. | Deviation Ledger entry (below) + T15 updates Const. §4 + Arch. §1/§4 so governance doesn't contradict the shipped reality. Extends AC-9's grep-checkable reversal to these files. |
| 04 | High | GitHub Packages requires `registry-url`, `scope`, `permissions: packages: write`, and `NODE_AUTH_TOKEN` wired **identically** in the publish job and the canary job; scope `@ai-substrate` **must** equal owner `AI-Substrate`. | Author the auth block once; reuse in both jobs (T9/T11). Add the trivial scope==owner CI assert (T8) to catch misconfig before the first publish. |
| 05 | Med | `docs-content.ts` is **generated** from `docs-manifest.json` + `.md` sources by `scripts/gen-docs.mjs`; its 3 contract-import hits come from the source `.md` files. | Edit the `.md` sources, then `npm run gen:docs`; never hand-edit `docs-content.ts`. `check:docs` (`git diff --exit-code`) already guards drift. |
| 06 | Med | Real-world **infra preconditions** (org allows `GITHUB_TOKEN` to publish packages; `@ai-substrate` scope usable + package links to repo; first-publish visibility) can't be proven on paper and will fail the first publish if unmet. | Verify in **T1** (before wiring). The **canary (T11)** is the keystone that converts these from "assumed" to "proven" on the PR branch. |

### Deviation Ledger (Gate G2)

| Principle Violated | Why Needed | Simpler Alternative Rejected | Risk Mitigation |
|--------------------|------------|------------------------------|-----------------|
| Const. §4 Delivery Practices — "Install is `npx`-from-repo-URL; no npm publish required for this slice" (descriptive delivery note, not a numbered MUST) | The npx-from-repo-URL model is **empirically broken** (`research-dossier.md` §3 reproductions). A registry is the proven path. | Hardening the git-URL install (vendor `jiti`, commit `dist`) — rejected: `jiti` can't be bundled and the registry path already works. | The note is updated in-place (T15); the reversal is grep-checkable (AC-9); nothing is published yet, so no consumers break. |

## Implementation

**Objective**: In one PR, publish `@ai-substrate/engineering-harness` to GitHub Packages via release-please, prove the path with a pre-merge canary, and reverse the old "no publish" model everywhere it's asserted.
**Testing Approach**: Lightweight + CI smoke (real tarballs, real install, real publish dry-run, real canary publish). No mocks. Sensors are sequenced **early** (grep gate, scope assert, dry-run, then canary) per `backpressure-coverage.md` so the publish path is provable before the real release is trusted.

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T000 | **Harness pre-flight** — `/eng-harness-flow --event pre-implement --phase "Implementation" --plan-dir docs/plans/018-gh-packages-release-please` | — | — | Router envelope handled; boot verdict narrated verbatim before code | _Harness seam (router installed). Advisory, never a gate._ |
| [x] | T1 | **Verify infra preconditions** (checklist — a **human gate, not CI; blocks merge if unmet**): (1) org Settings → Actions allow `GITHUB_TOKEN` to publish packages; (2) `@ai-substrate` scope is usable for this repo + the package links via the `repository` field; (3) first-publish **visibility** (public/internal) chosen + set. Record all 3 outcomes in the PR description. | packaging/release | org/Actions settings (out of repo) | All 3 checklist items confirmed-in-PR, or the blocker is surfaced (PR marked NOT-READY) before wiring | Finding 06. Human-judgement sensor (ABSENT in backpressure). T12 canary later proves these for real. |
| [x] | T2 | **Scope the rename by grep** — capture the authoritative worklist: `grep -rn "harness-engineering/contract" --include='*.ts' --include='*.js' --include='*.md' --include='*.yml' . \| grep -v docs/plans/ \| grep -v /.git/` (baseline = 24 files / 37 hits, incl. the 2 JSDoc source files in Finding 01). | extension-contract | (whole repo) | Worklist printed; the 2 undocumented `contract.ts` JSDoc sites (Finding 01) are in it | **Rename by this list, not the spec's hand-list.** |
| [x] | T3 | **Rename package + add publish metadata** in root `package.json`: `name` → `@ai-substrate/engineering-harness`; add `publishConfig.registry = https://npm.pkg.github.com`; add `repository` (`type: git`, `url` → `AI-Substrate/harness-engineering`). Leave `bin.harness`, `exports`, `files`, `dependencies` unchanged. | packaging/release | `package.json` | `package.json` has scoped name + `publishConfig.registry` + `repository`; `bin`/`exports` shape unchanged | AC-1, AC-2. The bare name flips too (`harness-engineering` → `engineering-harness`). |
| [x] | T4 | **Rename every contract-import site** (predecessor: T2 worklist + T3 name) from `harness-engineering/contract` → `@ai-substrate/engineering-harness/contract`: scaffold `templates.ts` + its test; both `src/services/{extensions,record}/contract.ts` JSDoc examples; `examples/extensions/{hello,build}`; all `test/integration/fixtures/**/.harness/extensions/**` (incl. `.js` JSDoc, `flat-legacy.ts`); the repo's own `.harness/extensions/{arch-check,validate-harness-flow,validate-harnessability,skills-check}/**`. **Edit `.md` SOURCES** (`docs/how/extend-the-harness.md`, `docs/how/record-and-record-types.md`, `harness/cli/docs/authoring-verbs.md`) **then `npm run gen:docs`** — never hand-edit `docs-content.ts`. | extension-contract / docs | T2 worklist | Every code/test/scaffold/fixture/docs-source site uses the new specifier; `docs-content.ts` regenerated | AC-6. Findings 01, 05. The `.harness/extensions/*` dogfood sites are **dev-only** (not in `files`; not shipped) — renamed for internal consistency. |
| [x] | T5 | **Confirm the repo's own dogfood extensions still load** post-rename: run `node harness/cli/bin/harness.js doctor` — all `.harness/extensions/*` load (no `E140`). | extension-contract | `.harness/extensions/**` | `harness doctor` enumerates all dogfood extensions as loaded; no load errors | AC-6 self-reference caveat: `.harness/extensions/*` are co-located with the renamed **root** `package.json`, so Node resolves the `@ai-substrate/engineering-harness/contract` self-reference via its `exports` map (dev-only; not shipped). Boot-time proof (Const. P7). An `E140` here means T4 missed a rename site (T7 catches it at build). |
| [x] | T6 | **Update the `package-smoke` fixture import** in `ci.yml` (heredoc ~lines 150/163) to the scoped specifier; keep the pack → `npm install --omit=dev <tgz>` → run shape. | ci/smoke | `.github/workflows/ci.yml` | `package-smoke` fixture uses the new import; tarball install + `harness help`/`doctor`/`hello`/`boom` assertions intact | AC-7. The load-bearing install proof stays green. |
| [x] | T7 | **Add the stale-specifier grep gate to CI** — an **early step** in the build-test job (after checkout, before install/build, so a missed rename fails fast) that runs the T2 grep and exits non-zero if the count ≠ 0 (excl. `docs/plans/**`, `.git`). | ci/smoke | `.github/workflows/ci.yml` | CI fails fast on any residual `harness-engineering/contract`; passes at 0 | AC-6 completeness gate. Finding 01. **Build early** (backpressure). |
| [x] | T8 | **Add scope==owner CI assertion** — a trivial step asserting `package.json` name scope (`@ai-substrate`) equals the repo owner (`AI-Substrate`, case-insensitive). | ci/smoke | `.github/workflows/ci.yml` | CI fails if the scope ever drifts from the owner | AC-10. Finding 04. Cheap sensor, build early. |
| [x] | T9 | **Add `npm publish --dry-run` smoke** configured against the GH Packages registry; assert the scoped package name + that `bin` and `dist` are in the packed file list. | ci/smoke | `.github/workflows/ci.yml` | Dry-run prints the scoped tarball with `bin` + `dist` included; CI asserts both | AC-8. Proves *packaging* (registry acceptance proven by T11). |
| [x] | T10 | **Add the publish job to `release.yml`** (predecessor: T3/T4 landed). On the `release-please` job: add `id: release` to the step **and** a job-level `outputs:` block (`release_created: ${{ steps.release.outputs.release_created }}`). Add a **separate** `publish` job: `needs: [release-please]`, `if: needs.release-please.outputs.release_created == 'true'`, `permissions: { packages: write, contents: read }`, `actions/setup-node` (`registry-url: https://npm.pkg.github.com`, `scope: '@ai-substrate'` — must match the package scope), `npm ci` + `npm run build`, then `npm publish` (**no `--tag`** → `latest`) with `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. Publishes the version release-please already committed to `package.json`. | packaging/release | `.github/workflows/release.yml` | On a release-please release the publish job runs and pushes the matching version; skipped (`release_created != 'true'`) otherwise | AC-3, AC-4. Findings 02, 04. Singular `release_created`; the job-level `outputs:` block is load-bearing. |
| [x] | T11 | **Add the branch-dispatch canary job** (`on: workflow_dispatch`, predecessor: T3/T4; reuses T10's setup-node auth block). Steps: **set an ephemeral version at runtime** — `npm version --no-git-tag-version "<base>-canary.${{ github.run_number }}"` where `<base>` = current `package.json` version (e.g. `0.1.0`); `run_number` guarantees uniqueness vs immutable GH Packages versions; **never committed**. Then `npm ci` + `npm run build` + **`npm publish --tag canary`** (the `--tag` is load-bearing — without it npm publishes to `latest`). **No `needs:` on release-please**, no manifest commit, no git tag. | packaging/release | `.github/workflows/release.yml` (or sibling `canary.yml`) | Dispatching from this PR branch publishes `…@canary` under the **canary** dist-tag; an authed `npm install @ai-substrate/engineering-harness@canary` + `harness help` returns `status:"ok"`; `npm dist-tag ls` shows `latest` untouched | **AC-11 — the keystone.** Flips the publish path from BUILDABLE→EXISTS pre-merge; closes AC-8's registry-acceptance gap. |
| [x] | T12 | **Dispatch the canary once** (predecessor: T11) from the PR branch; capture evidence in the PR. ✅ **DONE** — pushed `canary/018-test`; Release run **27322157506** published `@ai-substrate/engineering-harness@0.1.0-canary.1`, the verify step installed it back (3 pkgs incl. commander+jiti), ran the bin (`status:"ok"`), `latest` untouched. Trigger branch deleted. | packaging/release | (CI run) | All of: canary job exits 0; `npm info @ai-substrate/engineering-harness@canary` resolves; authed `npm install …@canary` + `harness help` return `status:"ok"`; `latest` unchanged. **If any step fails the PR is blocked** until the cause (auth/scope/visibility — see T1) is fixed and the canary re-dispatched. Evidence linked in PR. | AC-11 proof. Validates T1's preconditions for real. |
| [x] | T13 | **Rewrite install docs** — root `README` + `harness/cli/README.md` install sections: registry install + the consumer `.npmrc` (`@ai-substrate:registry=https://npm.pkg.github.com`) + `read:packages` token requirement; remove the `npx github:` install-as-primary copy. Run `npm run gen:docs` if a bundled doc source changed. | docs | `README.md`, `harness/cli/README.md` (+ `.md` sources) | Install docs describe registry+`.npmrc`+token; no stale `npx github:` *primary* install copy | AC-10. (Token requirement is the accepted non-goal.) |
| [x] | T14 | **Reverse AC-15 "no npm publish" copy** at its sites: the `release.yml` header comment (currently *"There is intentionally NO npm publish step…"*); a `Reversed in plan 018` note on AC-15 in `docs/plans/004-harness-core/harness-core-spec.md`; README/bundled-docs release copy. | docs | `release.yml`, `docs/plans/004-harness-core/harness-core-spec.md`, `README*` | `grep` finds no remaining "no npm publish"/"intentionally NO npm publish" claims in active docs/workflows | AC-9. Grep-checkable. |
| [x] | T15 | **Update governance docs** (Deviation Ledger follow-through): Const. §4 "Versioning" line + Arch. §1/§4 packaging-topology copy to describe the GitHub Packages registry model (note plan 018). | governance | `docs/project-rules/constitution.md`, `docs/project-rules/architecture.md` | Neither governance doc still asserts "no npm publish required" / npx-from-repo-URL as the model | Finding 03. Extends AC-9 beyond the spec's enumerated list. |
| [x] | T16 | **Green the full local + CI loop**: `just fft` (fix → format → test+coverage), `npm run check:docs`, `npm run build`, `node harness/cli/bin/harness.js arch-check`; confirm `grep -rn "harness-engineering/contract"` (excl. `docs/plans/**`) == 0. | ci/smoke | (repo) | All pass; grep == 0; CI green on the PR | AC-6/AC-7. Final gate before review. |
| [x] | T0zz | **Harness phase-end** — `/eng-harness-flow --event phase-end --plan-dir docs/plans/018-gh-packages-release-please` | — | — | Router envelope handled at phase end (retro drain if buffer non-empty) | _Harness seam (router installed). Advisory, never a gate._ |

### Acceptance Criteria

- [x] Package name is `@ai-substrate/engineering-harness`; `bin.harness` and `exports["./contract"]` shape unchanged. (AC-1 — T3)
- [x] `package.json` declares `publishConfig.registry = https://npm.pkg.github.com` + a `repository` field. (AC-2 — T3)
- [ ] On merge to `main`, release-please cuts the release **and** the publish job pushes the matching version to GitHub Packages, no manual step. (AC-3 — T10)
- [x] Publish is a separate job gated on `needs.release-please.outputs.release_created == 'true'` (singular), with `packages: write`, registry-url/scope setup-node, and `NODE_AUTH_TOKEN: GITHUB_TOKEN`. (AC-4 — T10)
- [x] The published tarball bakes in `dist` (publish-time `prepare`) and declares `commander`+`jiti` as deps; `--omit=dev` install resolves them and `harness help` returns `status:"ok"`. (AC-5 — **proven by green `package-smoke` on CI run 27321676624**)
- [x] Exhaustive contract-import rename; `grep "harness-engineering/contract"` (excl. `docs/plans/**`) == 0; `check:docs` green. (AC-6 — T2/T4/T5/T7/T16)
- [x] `package-smoke` passes with the renamed scoped import + tarball install. (AC-7 — **green on CI run 27321676624**)
- [x] `npm publish --dry-run` asserts the scoped name + `bin`/`dist` included. (AC-8 — T9)
- [x] No copy still claims "no npm publish" at the enumerated sites (+ governance docs). (AC-9 — T14/T15)
- [x] Install docs state the consumer `.npmrc` + `read:packages` token; scope==owner asserted in CI. (AC-10 — T13/T8)
- [x] Branch-dispatched canary publishes a unique `-canary.<run>` prerelease under the `canary` dist-tag, and an authed `…@canary` install + `harness help` succeed — `latest` untouched. (AC-11 — **proven: run 27322157506 published `0.1.0-canary.1`, installed back + ran `status:"ok"`, latest untouched**)

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Org disallows `GITHUB_TOKEN` package publish, or scope/repo link missing | Med | High (first publish fails) | T1 verifies preconditions; **T11 canary proves it on the PR branch** before any real release. |
| A contract-import site is missed (e.g. the 2 JSDoc source files) | Med | Med (author copies a broken import) | Rename **by grep** (T2/T4); CI grep gate (T7) fails the build on any residual. |
| `releases_created` (plural) used, OR the release-please job omits the `outputs:` re-export → gate resolves empty → publish fires on every push | Med | High (junk publishes) | T10 uses **singular** `release_created` **and** a job-level `outputs:` block; reviewed explicitly (Finding 02). |
| Canary `npm publish` missing `--tag canary` → overwrites the `latest` dist-tag | Med | High (breaks consumers) | T11 pins `npm publish --tag canary`; T12 asserts `latest` unchanged. |
| Dogfood `.harness/extensions/*` fail to resolve the self-reference post-rename | Low | Med (repo's own harness breaks) | T5 runs `harness doctor` to prove all load before merge. |
| GH Packages version immutability collides on canary re-dispatch | Low | Low (publish 409) | T11 uses `github.run_number` for a unique version each dispatch. |
| Governance docs left asserting the old model | Med | Low (doc drift) | T15 updates Const. §4 + Arch. §1/§4; Deviation Ledger records the supersession. |

## Harness Seams

- **Entry point**: `/eng-harness-flow --event <seam> [--phase <id>] [--plan-dir <p>] --json` — the single door to the engineering harness; child skills are private and never named here.
- **Backpressure** (post-spec seam): already ran — see [`backpressure-coverage.md`](./backpressure-coverage.md) (**Certainty: Partial**). Its Recommended Phase 0 is **folded into the task ordering** (sensors T7/T8/T9/T11 sequenced early), not a separate phase.
- **Pre-implement** (`--event pre-implement`): fired by `/plan-6` at Implementation start (row T000); boot verdict narrated verbatim (`healthy / SLOW / UNHEALTHY / UNAVAILABLE`). `UNAVAILABLE` falls back to standard testing — not an error.
- **Phase end** (`--event phase-end`): fired by `/plan-6` at the close (row T0zz); `--event plan-complete` fires at merge (`/plan-8`).
- **Best-effort**: every harness item is advisory and never blocks; the router decides what (if anything) the harness does at each seam.

---

## Validation Record (2026-06-11)

### Validation Thesis

**Raison d'être**: Turn the READY spec into a correctly-sequenced, implementation-ready single-PR plan that fixes the broken `harness` install (reproduced `ERR_MODULE_NOT_FOUND` / `TS2688`) by publishing `@ai-substrate/engineering-harness` to GitHub Packages via release-please, with the publish path proven by a pre-merge canary and the scoped rename rippled completely.

**Value claim**: The implementer can build the whole distribution change in one PR with minimal clarification; every claim has a deterministic sensor; the publish wiring is correct (proven by the canary before merge); no contract-import site is missed.

**Artifact promise**: A downstream implementer (Simple mode → `/plan-6`) can execute the 16 tasks; the publish wiring is exact; the rename worklist is grep-authoritative.

**Intended beneficiaries**: implementer, reviewers, extension authors, maintainers.

**Proof target**: Contract/Implementation.

**Evidence standard**: testable ACs mapped to tasks + CI sensors, grounded in real repo anchors (`package.json`, `release.yml`, `ci.yml`) + `research-dossier.md` reproductions.

**Thesis source**: `gh-packages-release-please-spec.md` + `research-dossier.md` (§3, §5.2c) + `backpressure-coverage.md`.

**Thesis verdict**: **Advanced** (at the target Contract/Implementation proof level after fixes).

**Main thesis risk**: registry-only via GitHub Packages constrains the audience to GitHub-authed consumers — a conscious, documented non-goal.

| Agent | Lenses Covered | Thesis Axes | Issues | Verdict |
|-------|----------------|-------------|--------|---------|
| Coherence + Completeness + CS | Coherence, Completeness, Edge Cases, CS-challenge | Implementation Readiness | 1 CRITICAL, 1 HIGH, 5 MED, 5 LOW — fixed/absorbed | ⚠️→✅ |
| Publish-wiring Ops + Security | Deployment & Ops, Technical Constraints, Security, Hidden Assumptions | Operational Reliability | 1 CRITICAL, 4 HIGH, 6 MED — fixed | ⚠️→✅ |
| Rename-Ripple Forward-Compat | Forward-Compatibility, Integration & Ripple, Domain Boundaries, Concept Docs, Contract Integrity | Downstream Usefulness, Contract Integrity | 0 blocking (3 LOW/info, all absorbed); worklist verified complete vs live grep (24 files/37 hits) | ✅ |
| Thesis Alignment | Thesis Alignment, Evidence Sufficiency, Proof-Level Fit | Thesis Alignment | 0 blocking (2 MED + 3 LOW task-clarity, fixed) | ✅ |

**Lens coverage**: 12/15 (Thesis + Forward-Compatibility both engaged; not STANDALONE).

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| Implementation PR (T2–T7) | Exhaustive grep-driven worklist; no missed rename site | contract drift | ✅ | Rename by grep (T2/T4); 2 JSDoc source sites (Finding 01) confirmed in-list; T7 CI gate locks count at 0. |
| Extension authors (external) | New import specifier; `exports["./contract"]` shape unchanged | shape mismatch | ✅ | AC-1 preserves the `exports` subpath; T4 updates every site incl. scaffold + its test. |
| Repo's own `.harness/extensions/*` | Self-reference resolves post-name-flip; all load (no `E140`) | encapsulation lockout | ✅ | Co-located with renamed root `package.json` → Node resolves via `exports`; T5 `harness doctor` proves it; dev-only (not shipped). |
| `harness new` scaffold consumers | Scaffold + its test renamed together | test boundary | ✅ | T4 updates `templates.ts` + `templates.test.ts` together; `check:docs`/T16 enforce parity. |

**Thesis alignment**: Value claim advanced (Yes) at the Contract/Implementation proof level; the publish path is proven by the T11/T12 canary before merge; main risk is the conscious registry-only audience trade-off.

**Outcome alignment**: *"Consumers install a working `harness` from a real registry — deps resolve, no install-time build, no git-clone fragility."* — the plan advances this: the grep-exhaustive rename + preserved `exports` shape + the release-please publish job + the pre-merge canary deliver a working, versioned registry install while keeping extension authors and the repo's own dogfood harness working.

**Standalone?**: No — `/plan-6` (implement) and the implementation PR are concrete downstream consumers.

### Fixes applied this run (CRITICAL/HIGH, mechanical + source-grounded)

- **CRITICAL** (Finding 02, T10): the cross-job gate `needs.release-please.outputs.release_created` was a silent no-op — the `release-please` job declared no `outputs:`. Fixed: T10 now requires `id: release` **and** a job-level `outputs:` block; publish gated with string compare `== 'true'`; clarified the published version comes from `package.json` (no tag output needed).
- **HIGH** (T11): canary missing `npm publish --tag canary` → would clobber `latest`. Fixed: `--tag canary` pinned; T12 asserts `latest` unchanged; new Risks row.
- **HIGH** (T11): canary version mechanism unspecified. Fixed: ephemeral runtime `npm version --no-git-tag-version "<base>-canary.${run_number}"` (never committed); `<base>` = current `package.json` version.
- **HIGH** (T1): preconditions were a vague note. Fixed: explicit 3-item checklist + "human gate, blocks merge if unmet" + record-in-PR.
- **MED (converged)**: T7 grep gate runs early (fail-fast); T10 setup-node scope-match + `contents: read`; predecessor notation (T4/T10/T11/T12); T12 explicit success criteria + block-on-failure; dogfood extensions noted dev-only (T4/T5); AC-5 clarified as the existing unchanged sensor.

**Remaining (LOW / accepted)**: CS-3 judged defensible (escalate to CS-4 only if GH Packages auth proves finicky — the canary surfaces that early); consumer token-type guidance (PAT with `read:packages`) is a T13 doc detail. No open CRITICAL/HIGH.

Overall: ⚠️ **VALIDATED WITH FIXES**
