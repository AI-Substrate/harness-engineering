# Publish the harness CLI to GitHub Packages (release-please)

**Mode**: Simple
**Status**: READY — Round 1 + Round 2 resolved (no open markers)
📚 Specification incorporates findings from `research-dossier.md`.

## Research Context

From `research-dossier.md` (this conversation's reproductions):

- The advertised git-URL install (`npm install -g github:…`) is broken two ways: **(A)** `dist` is gitignored, so a git/npx install must rebuild via `prepare` inside npm's transient clone — fragile (reproduced `TS2688`) and slow; **(B)** `npm i -g git+…` doesn't materialize runtime deps (`commander`/`jiti`) for this package shape → `ERR_MODULE_NOT_FOUND`.
- **`jiti` cannot be bundled** (it lazy-`require`s its own transpiler), so "just bundle the deps" is not viable.
- The **tarball / registry install path is proven to work** (deps delivered, `harness help` returns a valid envelope) — it's what `harness skills install` and the `package-smoke` CI job already use.
- **Nothing has shipped yet**: 0 git tags, no `CHANGELOG.md`, seed version `0.1.0`; release-please is configured but has never run (the CLI + workflows aren't on `main` yet). This is the cheapest possible moment to change the distribution model.

**Decision**: route every consumer through the registry path by **publishing to GitHub Packages**, automated by **release-please** on merge to `main`. This reverses harness-core spec **AC-15** ("no npm publish").

## Summary

Add an automated publish of the `harness` CLI to **GitHub Packages** (the npm registry at `npm.pkg.github.com`), triggered by **release-please** when it cuts a release on merge to `main`. Rename the package to the GitHub-org scope so it is publishable there. The published tarball bakes in a built `dist` (publish-time `prepare`) and declares `commander`+`jiti` as normal registry dependencies, so a registry install just works — fixing the broken git-URL install and giving a real, versioned, pinnable distribution.

## Goals

- Consumers install a **working** `harness` from a real registry — deps resolve, no install-time build, no git-clone fragility.
- release-please **cuts the semver release AND publishes** to GitHub Packages on merge to `main`, with zero manual steps.
- **Test the real publish + install end-to-end from a PR branch** — a manually-dispatched **canary pre-release** — *without* merging to `main` or cutting a real release (so the publish wiring is proven before it's trusted, in one PR, not several).
- The published package is **self-sufficient**: built `dist` baked in; `commander`/`jiti` delivered as registry deps.
- **Reverse AC-15 cleanly** — no doc/workflow copy left claiming "no npm publish".
- The scoped rename **ripples consistently** through every contract-import site so extension authoring keeps working.

## Non-Goals

- Publishing to the **public npm registry** (npmjs.com) — this is GitHub Packages only.
- Solving **anonymous / no-token public install** — GitHub Packages requires an auth token even for public packages; that limitation is accepted, not solved here.
- **Bundling or vendoring `jiti`** — unnecessary once the registry path is the install channel.
- Changing CLI behavior, commands, or the extension **contract shape** — only the import *specifier string* changes.
- **Keeping a no-auth `npx github:` fallback** — this is **registry-only** (Round 2). `dist` stays gitignored (the publish builds it); the git-URL install path is retired, not hardened.

## Target Domains

> No formal `docs/domains/` registry exists; the rows below are informal source clusters named for traceability only (no files moved/refactored).

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|--------------|----------------------|
| packaging/release (`package.json`, `release.yml`, release-please config) | existing | **modify** | Scoped name + `publishConfig` + `repository`; add the publish job gated on release-please |
| ci/smoke (`.github/workflows/ci.yml`, `package-smoke`) | existing | **modify** | Update fixture import; add publish dry-run + registry-style install smoke |
| docs (`README.md`, `docs-content.ts`, `docs/how/`, `examples/`) | existing | **modify** | Rewrite install instructions; rename the contract import; AC-15 reversal |
| extension-contract (`exports["./contract"]`, `harness new` scaffold) | existing | **modify** | New import specifier `@ai-substrate/engineering-harness/contract` |

No new domains.

## Testing Strategy

- **Approach**: Lightweight + CI smoke. **Mocks**: none — real tarballs, real installs, real publish dry-run.
- **Focus areas**:
  - Extend `package-smoke`: pack → install (`--omit=dev`) → run, with the renamed scoped contract import in the fixture.
  - Add `npm publish --dry-run` against the GitHub Packages registry config; assert scoped package name + that `bin`/`dist` are included.
  - Assert the contract-import rename is complete (no stale `harness-engineering/contract` remains anywhere); `npm run check:docs` stays green.
  - **Branch-dispatched canary publish (AC-11)**: the real end-to-end proof — `workflow_dispatch` from the PR branch publishes a `-canary.<run>` prerelease to GitHub Packages, then an authed `npm install …@canary` + `harness help` confirms publish + auth + registry acceptance **before** merge.
  - First real publish re-confirms the path on the first release-please release.
- **Excluded**: unit tests (little unit-testable logic); mocks.

## Documentation Strategy

**Hybrid** — README install section (the new registry install + `.npmrc`/token requirement), `docs/how/extend-the-harness.md` + `docs-content.ts` (bundled `harness docs`) for the new `@ai-substrate/engineering-harness/contract` import, and the **AC-15 reversal** noted in the harness-core spec, README, and the `release.yml` comment.

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=2, I=2, D=0, N=1, F=1, T=1 → total 7 → CS-3
- **Confidence**: 0.80
- **Assumptions**: scope `@ai-substrate` (owner `AI-Substrate`); `GITHUB_TOKEN` can publish to the org's GitHub Packages once the package is linked to the repo.
- **Dependencies**: release-please-action (already wired); `actions/setup-node` registry-url support; GitHub Packages availability for the org.
- **Risks**: see Risks & Assumptions.
- **Phases** — **Simple mode = one PR / single implementation wave** (no `phase-N/` folders). The three concerns it bundles: (1) scoped rename + `publishConfig`/`repository` + the exhaustive contract-import ripple (AC-6); (2) publish job in `release.yml` (gated on release-please, `packages: write`, `NODE_AUTH_TOKEN`); (3) CI smoke + install-doc rewrite + AC-15 reversal.

## Acceptance Criteria

1. Package name is **`@ai-substrate/engineering-harness`**; `bin.harness` unchanged; `exports["./contract"]` unchanged in shape.
2. `package.json` declares `publishConfig.registry = https://npm.pkg.github.com` and a `repository` field linking the GitHub repo.
3. On merge to `main`, release-please opens/refreshes a Release PR; merging it tags a release **and** a publish job pushes `@ai-substrate/engineering-harness@<version>` *(per AC-1)* to GitHub Packages — **no manual step**.
4. The publish runs as a **separate job in `release.yml`**, **gated on a release actually being created** — `if: ${{ steps.<release-please-step-id>.outputs.release_created }}` (the singular `release_created`; **not** `releases_created`, which is a v3→v4 trap that defaults truthy). The job declares `permissions: packages: write`; `actions/setup-node` with `registry-url: https://npm.pkg.github.com` + `scope: '@ai-substrate'` writes the auth `.npmrc`; `npm publish` runs with `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` and succeeds.
5. The published tarball contains a built `dist` (publish-time `prepare`/`prepack` — the existing `prepare: npm run build` already does this, and the `files` allowlist includes `harness/cli/dist`, so the gitignored `dist` **is** packed; **empirically verified** in `research-dossier.md` §3.3, where a packed tarball installed and ran `harness help`). It declares `commander`+`jiti` as `dependencies`; a registry-style `--omit=dev` install resolves them and `harness help` returns a valid `status:"ok"` envelope.
6. **Exhaustive** contract-import rename — every site uses `@ai-substrate/engineering-harness/contract` and **no `harness-engineering/contract` remains in code, tests, scaffolds, fixtures, or bundled docs**. Sites (validated against the repo — see Validation Record):
   - **Source/docs (edit the `.md` SOURCES, then `npm run gen:docs` to regenerate `docs-content.ts` — never hand-edit the generated file)**: `docs/how/extend-the-harness.md`, `docs/how/record-and-record-types.md`, `harness/cli/docs/authoring-verbs.md`, `harness/cli/README.md`.
   - **Scaffold + its tests**: `harness/cli/src/services/scaffold/templates.ts` (what `harness new` emits) **and** `harness/cli/test/services/scaffold/templates.test.ts` (the assertion strings).
   - **Examples**: `harness/cli/examples/extensions/{hello,build}/extension.ts`.
   - **Integration test fixtures**: `harness/cli/test/integration/fixtures/**/.harness/extensions/**` (`repo/` + `repo-conflict/`, incl. the `.js` JSDoc + `flat-legacy.ts`).
   - **The repo's own dogfood extensions**: `.harness/extensions/{arch-check,validate-harness-flow,validate-harnessability,skills-check}/**` (these self-reference the package name; Node resolves `@ai-substrate/engineering-harness/contract` from within the same package via the `exports` self-reference — implementer must confirm jiti loads them post-rename).
   - **CI fixture**: the `package-smoke` heredoc in `.github/workflows/ci.yml` (lines ~150/163).
   - **Do NOT rename** repo-URL references `AI-Substrate/harness-engineering` / `github:AI-Substrate/…` (the *repo* name is unchanged) or historical `docs/plans/**` artifacts.
   - **Completeness test**: `grep -rn "harness-engineering/contract"` over code + active docs (excluding `docs/plans/**` history and `.git`) returns **0**. `npm run check:docs` stays green.
7. `package-smoke` passes with the renamed scoped import in its fixture and asserts a successful **tarball** install (`npm install --omit=dev <tgz>`) + run (this is the registry-shaped install path, proven in §3.3).
8. A `npm publish --dry-run` (configured against the GitHub Packages registry) runs in CI and asserts the scoped package name and that `bin` + `dist` are included. **Proof boundary (be honest):** the dry-run + tarball smoke prove *packaging*; **registry auth/acceptance/visibility is proven by the branch-dispatched canary publish (AC-11)** before merge, and confirmed again by the first real release.
9. AC-15 reversal is reflected at these specific sites — **no copy still claims "no npm publish"** (grep-checkable): the `release.yml` header comment (currently *"There is intentionally NO npm publish step…"*); a `Reversed in plan 018` note on AC-15 in `docs/plans/004-harness-core/harness-core-spec.md`; and the install/release sections of `harness/cli/README.md` + the bundled docs (via their `.md` sources → `gen:docs`).
10. Install docs state the consumer `.npmrc` (`@ai-substrate:registry=https://npm.pkg.github.com` + a `read:packages` token) and the auth requirement (this consumer-facing instruction is distinct from AC-9's prose reversal). The scope `@ai-substrate` must match the repo owner `AI-Substrate`; a trivial CI assertion (`package.json` name scope == owner) is recommended to catch misconfiguration before the first publish.

11. **Branch-testable pre-release publish (test in ONE PR, no merge to `main`).** A manually-dispatchable (`workflow_dispatch`) job publishes a **unique pre-release** version — e.g. `<base-version>-canary.<github.run_number>` (run-number/short-SHA guarantees uniqueness, since GitHub Packages versions are immutable) — to GitHub Packages under the **`canary` dist-tag**, running from the **dispatched branch** and **independent of release-please** (no manifest bump, no git tag, no merge). It reuses the real publish job's auth + `permissions: packages: write`. Dispatching it from this PR branch proves the full publish **and authed-install** path end-to-end: `npm install @ai-substrate/engineering-harness@canary` (with a `read:packages` token) resolves the prerelease and `harness help` runs — while the `latest` dist-tag and real releases stay untouched. This is what lets the wiring be validated without repeated merges, and closes AC-8's registry-acceptance gap *before* trusting the real release path.

> *(The earlier conditional AC-11 — an `npx github:` no-auth fallback — was dropped in Round 2: this is registry-only. The AC-11 number is reused above for the branch-test capability.)*

## Risks & Assumptions

- **GitHub Packages requires a token even for public install** (no anonymous access) — documented and accepted.
- **The rename is breaking** for any extension author using the old `harness-engineering/contract` import — and note the **bare name also flips** (`harness-engineering` → `engineering-harness`), so the new specifier is `@ai-substrate/engineering-harness/contract`. **Nothing is published yet**, so there are no released consumers to break (cheapest time to rename).
- The **npm package name (`engineering-harness`) deliberately differs from the repo name (`harness-engineering`)** — that's fine for GitHub Packages (only the *scope* must match the owner); the `repository` field links the package to the repo.
- `GITHUB_TOKEN` publishing assumes the package is **linked to the repo** (via `repository` in `package.json` and/or org package settings).
- Confirmed name: **`@ai-substrate/engineering-harness`** (scope `@ai-substrate` = owner `AI-Substrate`).
- **Audience (conscious trade-off):** registry-only via GitHub Packages serves **GitHub-authed (org/internal) consumers**; anonymous/no-token public install is **not** supported (out of scope, per Non-Goals). If a zero-auth public one-liner ever becomes a requirement, this needs re-evaluation (public npm, or the vendor-jiti option in `research-dossier.md` §5).
- **First-release version:** the first publish will carry whatever version **release-please computes from the conventional commits** since the seed `0.1.0` (config: `bump-minor-pre-major: true`) — likely `v0.1.0` (no breaking commits) or a minor bump. The publish job fires **only after** release-please creates the tag and publishes the **matching** version; AC-3's `<version>` resolves to that tag.

### Preconditions to verify early (gate for the architect/implementer)

These are real-world infra preconditions that this spec **assumes** but cannot prove on paper — verify them in (or before) Phase 1 so the first release doesn't fail at publish:
1. The org permits `GITHUB_TOKEN` (GitHub Actions) to **publish packages** (org Packages settings / Actions permissions).
2. The `@ai-substrate` scope is usable for this repo's package, and the package will **link to the repo** via the `repository` field.
3. Default package **visibility** on first publish is acceptable (set/confirm public vs internal).

## Open Questions

- ✅ **Q-1 (resolved, Round 2)** — Package name = **`@ai-substrate/engineering-harness`** (the bare name flips to `engineering-harness`; scope matches the owner `AI-Substrate` as GH Packages requires; bin stays `harness`; contract import = `@ai-substrate/engineering-harness/contract`).
- ✅ **Q-2 (resolved, Round 2)** — **Registry-only** via GitHub Packages; no `npx github:` fallback; `dist` stays gitignored.

*(No open markers remain.)*

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| release → publish wiring | Integration Pattern | Get the release-please→publish gate, token, and permissions exactly right on the first try | Gate on the action's `release_created` output? Is `GITHUB_TOKEN` + `packages: write` sufficient? How is the package linked to the repo? |

*(Likely skippable — this is a well-trodden pattern; folded into Phase 2 unless the gate/permission details warrant a short workshop.)*

## Clarifications

### Session 2026-06-11

**Round 1 (front-loaded):**
- **Workflow Mode** → **Simple** (single cohesive distribution PR; breaking-rename ripple covered by ACs + CI smoke).
- **Testing Strategy** → **Lightweight + CI smoke** (real install behavior is the proof; little unit logic).
- **Mock Usage** → **No mocks** — real artifacts (tarballs, installs, dry-run).
- **Documentation Strategy** → **Hybrid** (README + `docs/how/` + bundled `docs-content.ts`).

**Round 2 (sketch-dependent):**
- **Q-1 Package name** → **`@ai-substrate/engineering-harness`** (user chose this over the proposed `@ai-substrate/harness-engineering` — the bare name flips to `engineering-harness`, aligning with the `@scope/engineering-harness` convention; scope still matches the owner). bin stays `harness`; contract import → `@ai-substrate/engineering-harness/contract`.
- **Q-2 Install surface** → **Registry-only** via GitHub Packages. No `npx github:` no-auth fallback; `dist` stays gitignored (publish-time build); the git-URL install path is retired. (Conditional AC-11 dropped.)

**Post-validation addition (user request):** branch-testable **canary pre-release publish** added as the new AC-11 — lets the publish wiring be proven from this PR branch (no merge), which also closes AC-8's registry-acceptance proof gap.

---

## Validation Record (2026-06-11)

### Validation Thesis
**Raison d'être**: The advertised install path is broken (reproduced `ERR_MODULE_NOT_FOUND` / `TS2688`); this spec defines a distribution model that yields a working, versioned install via GitHub Packages + release-please.
**Value claim**: Installing `harness` becomes reliable, versioned, and pinnable — deps resolve, no install-time build, no git-clone fragility.
**Artifact promise**: `/plan-3` can architect the publish wiring + scoped rename from this spec with minimal clarification; ACs are testable.
**Intended beneficiaries**: CLI consumers, extension authors (contract import), the architect/implementer, maintainers.
**Proof target**: Contract/Decision.
**Evidence standard**: testable ACs via CI smoke (pack/install/run, dry-run, canary), grounded in `research-dossier.md` reproductions.
**Thesis source**: `research-dossier.md` (§3, §5.2c) + `docs/plans/004-harness-core/harness-core-spec.md` AC-15 + session reproductions.
**Thesis verdict**: **Advanced** (at target proof level).
**Main thesis risk**: registry-only constrains the audience to GitHub-authed consumers — a conscious, documented non-goal.

| Agent | Lenses Covered | Issues | Verdict |
|-------|----------------|--------|---------|
| Feasibility/Ops (publish wiring) | Deployment & Ops, Technical Constraints, Security, Hidden Assumptions | 1 false-CRITICAL (dist-in-tarball — empirically disproven), 3 HIGH, 3 MED/LOW — fixed in AC-4/5/8 | ⚠️→✅ |
| Rename-Ripple (completeness) | Contract Integrity, Integration & Ripple, Domain Boundaries, Concept Docs | 1 HIGH — **AC-6 not exhaustive (17 missed sites)** — fixed (AC-6 rewritten + grep test) | ⚠️→✅ |
| Clarity / AC-Testability | Clarity, Evidence Sufficiency, Proof-Level Fit, Edge Cases | 8 MED — version/gating/proof-boundary/doc-paths — fixed in AC-4/8/9/10 + Risks | ⚠️→✅ |
| Thesis + Forward-Compatibility | Thesis Alignment, Forward-Compatibility | 2 LOW (audience framing, Simple-phases phrasing) — fixed | ✅ |

**Lens coverage**: 10/15 (Thesis + Forward-Compatibility both engaged; not STANDALONE).

### Forward-Compatibility Matrix (echoed from the Thesis/FC agent)

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `/plan-3` (architect) | Testable ACs + decision rationale + domain rows + testing approach | contract drift | ✅ (caveat now addressed) | ACs numbered/testable; preconditions now flagged for an early verification task |
| implementation (publish job + rename) | Exact wiring (token/perms/gate/registry) + exhaustive rename list | encapsulation lockout / shape mismatch | ✅ | AC-2/4 wiring; AC-6 now exhaustive with grep test |
| extension authors (external) | New import specifier; contract *shape* unchanged | contract drift | ✅ | AC-1 keeps `exports["./contract"]` shape; AC-6 updates every site |

**Thesis alignment**: Value claim advanced (Yes) at the target Contract/Decision proof level; main risk is the conscious registry-only audience trade-off.

**Outcome alignment**: *"Consumers install a working `harness` from a real registry — deps resolve, no install-time build, no git-clone fragility."* — Yes, the spec advances this outcome: GitHub Packages publish + registry install eliminates the install-time build and git-clone fragility and guarantees dep resolution; the contract-import rename keeps extension authors working.

**Standalone?**: No — `/plan-3` and the implementation are concrete downstream consumers.

**Overall: ⚠️ VALIDATED WITH FIXES** — all CRITICAL/HIGH issues were either disproven (dist-in-tarball) or fixed mechanically (AC-4 gating/perms, AC-6 exhaustive rename + grep test, AC-8 proof boundary, AC-9 reversal paths, Risks preconditions). Remaining open items are real-world infra **preconditions** flagged for early verification, not spec defects.
