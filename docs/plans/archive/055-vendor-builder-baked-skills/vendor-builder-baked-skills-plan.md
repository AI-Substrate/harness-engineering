# Vendor the SDD flow as `builder`, bake skills into the build, self-reconcile on update
**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-07-07
**Status**: READY
**Spec source**: unified (this file)

ℹ️ Research was done inline against the live code (no separate `research-dossier.md`); the Key Findings below are grounded in `harness/cli/src/**` and the installed `skills@1.5.14` source.

## Business Specification

### Summary
The SDD pipeline skill (`the-flow`) lives outside this repo in `~/github/tools/skills/SDD` and is installed by `harness skills install` via a **GitHub `owner/repo/subdir` source** (`npx skills add AI-Substrate/harness-engineering/skills …`), which needs network + GitHub access at install time. We will (1) **vendor** `the-flow` into this repo as the **`builder`** skill plus the three sibling skills it actually invokes, add a thin `the-flow` redirect; (2) **bake the skills into the npm build** so install runs from a packaged local directory (`type:"local"`, no git, no network); and (3) record the **last install method** (targets + scope) in a harness-owned lock so bare `harness update` re-applies skills the same way.

### Goals
- `builder` (and its deps) live in this repo's `skills/`; SDD is annotated as moved.
- `harness skills install` works with **zero GitHub/network access** — from baked-in files.
- `/the-flow` still works (redirect → `builder`); `/builder` is the canonical front door.
- `harness update` (no `--target`) re-applies skills by the **last-recorded** targets + scope; falls back to today's report-only when no lock exists.
- Behaviour is correct across the many consumer machines/configs this published CLI reaches (claude-code, codex, cursor, github-copilot, …).

### Non-Goals
- **Merging `builder` with `eng-harness-flow`** — explicitly a *later* step; they coexist now, and the existing `harness-seams.md → /eng-harness-flow` seam is left intact as the future join point.
- Vendoring the standalone SDD utilities (`thesis`, `htmlify-v2`, `deepresearch-v2`, `didyouknow-v2`, `plan-2b-v2-prep-issue`, `util-0-v2-handover`).
- Renaming the vendored dep slugs into a `harness-*` namespace (kept byte-close to source to ease future diffs).
- Removing the GitHub `--source` override entirely — the *default* becomes local; an explicit `--source owner/repo` still works.

### Target Domains
This repo has no `docs/domains/` registry; domains are informal conceptual areas of the CLI.

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|----------------------|
| skills (CLI act + service) | existing | **modify** | Default source → baked local dir; copy-to-temp; write the install lock |
| update (reconcile path) | existing | **modify** | Bare `update` reads the lock and reconciles by last method |
| fs adapter (ports) | existing | **modify** | Add recursive `copyDir` (current `copy` is single-file) |
| packaging (npm build) | existing | **modify** | Ship `skills/**` in the tarball (`package.json#files`) |
| skills-content (`skills/`) | existing | **create** (add dirs) | Vendored `builder` + deps + `the-flow` redirect |

### Testing Strategy
- **Approach**: Full TDD for the new pure logic (packaged-dir resolver, `copyDir` via fake-fs, skills-lock merge/read/serialize, argv carrying an absolute local path). Lightweight validation for the vendored-content rewrite + the offline-install E2E.
- **Rationale**: Matches the repo's port/adapter + `vitest --coverage` style; the risky pieces are pure and cheaply unit-tested.
- **Focus areas**: source resolution, lock scope selection (project vs global), update-follows-lock reconcile.
- **Excluded**: re-testing the vercel `skills` tool itself (wrapped, not rebuilt).
- **Mock usage**: Targeted — reuse the existing fake ports (`fake-fs`, fake `exec`/`proc`) for fs/npx boundaries; real logic otherwise. No new mocking framework.

### Documentation Strategy
Hybrid: update `INSTALL.md`/`README.md` skills section for the offline (baked) install, and add a `docs/how/` note on the lock-driven `harness update`.

### Complexity
- **Score**: CS-3 (medium)
- **Breakdown**: S=2, I=1, D=1, N=1, F=1, T=1 (sum 7)
- **Confidence**: 0.8
- **Assumptions**: vercel `skills@latest` keeps accepting an absolute local path as `type:"local"` (verified in 1.5.14). The published package can carry `skills/**` (small, ~0.6 MB).
- **Dependencies**: `skills@latest` on npx at install time (already required today).
- **Risks**: see Risks table. **Phases**: 1 (Simple).

### Acceptance Criteria
- **AC-01**: `npm pack --dry-run` lists `skills/builder/**`, `skills/validate-v2/**`, `skills/plan-0-v2-constitution/**`, `skills/plan-v2-extract-domain/**`, and `skills/the-flow/SKILL.md` in the tarball.
- **AC-02**: With GitHub unreachable, `harness skills install --target claude-code` installs all five skills into the target's skills dir (from baked files, no clone).
- **AC-03**: A successful `skills install` / `skills update` writes/merges a lock recording `{targets, global, source:"local"}` at the correct scope (project `.harness/` for local, `~/.harness/` for `--global`).
- **AC-04**: Bare `harness update` (no `--target`) reads the lock and reconciles the recorded targets (refresh + prune); with **no** lock it stays report-only (today's behaviour, unchanged).
- **AC-09**: `harness update` that performs a **binary upgrade** reconciles skills from the **newly-installed** package, not the pre-update one — verified by re-invoking the freshly-installed `harness skills update` as a child process (never reconciling baked skills in the still-running old process).
- **AC-10**: CI fails the build if any baked skill (`builder`, the 3 deps, or the `the-flow` redirect) is absent from `npm pack` output — a durable regression sensor guarding the offline-install guarantee. (Release packaging itself is automatic: release-please + `npm publish` build the tarball from `package.json#files`, so no workflow change is needed to *ship* skills — only this guard to *prove* they keep shipping.)
- **AC-05**: `/the-flow` loads the redirect and forwards to `builder`; `/builder <id> <verb>` grammar resolves; `builder`'s printed commands read `/builder …`.
- **AC-06**: Inside `builder`, the auto-run `/validate-v2` and the `/constitution` + `/extract-domain` references resolve to the vendored sibling skills (present in `skills/`).
- **AC-07**: New pure unit tests pass: packaged-dir resolver, `copyDir` (fake-fs), lock merge/read/serialize, install argv containing an **absolute** local path (+ `-y`).
- **AC-08**: Existing skills/update tests stay green; `npm run lint`, `lint:md`, `check:docs`, `check:flows` all pass.

### Risks & Assumptions
- Passing a **non-absolute** local path would make the vercel tool treat it as a git source — mitigated because `fs.mkdtemp` yields an absolute path and the resolver returns absolute paths.
- Global-scope lock at `~/.harness/` is new state on consumer machines — keep it tiny, versioned, and non-fatal if unreadable (fall back to report-only).
- Markdownlint / `doctrine-parity` may flag the large vendored `builder` tree — may need ignore-scoping.

### Open Questions
- None blocking. (Global-lock location `~/.harness/skills.lock.json` chosen for symmetry with the project `.harness/`; revisit if a per-CLI-config location is later wanted.)
- **Resolved (peer review)** — authoritative skill source for `harness update` *after* a binary upgrade: the **newly-installed package**, reached by re-invoking `harness skills update` as a fresh child process (not the old running process, not a remote source). Keeps offline install intact while guaranteeing the new skills ship. (KF-08 / AC-09.)

### Workshop Opportunities
_None — the one feasibility unknown (local-path install without git) was settled by reading `skills@1.5.14` source; no design fork remains._

### Clarifications
#### Session 2026-07-07
- **Mode** → Simple (user override; CS is mid-range but the work is cohesive enough for one well-grouped phase).
- **Testing** → Full TDD for pure logic. **Mocks** → Targeted (existing fake ports). **Docs** → Hybrid (README/INSTALL + docs/how).
- **Vendor scope** → `the-flow`→`builder` + `validate-v2`, `plan-0-v2-constitution`, `plan-v2-extract-domain`. **vs eng-harness-flow** → coexist (future merge). **Install source** → local only (default).

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — all resolved.

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | n | research done inline against live code |
| workshops/*.md | n | — |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | Round-1 answered; no `[NEEDS CLARIFICATION]` left |
| G2 | Constitution | PASS | P2 (copyDir a port method; services pure; acts compose) ✓; P3 (existing fakes, no `vi.mock`) ✓; P4/P8 (envelopes kept; still wraps `npx skills`) ✓; P10 (no new runtime dep) ✓; P12 (T018 checks vendored tree is public-safe) ✓ |
| G3 | Architecture | PASS* | Dependency rule Entrypoint→Acts→Services→Ports respected. *Deviation (recorded): §4 says `files` is "limited to built output"; this ships `skills/` runtime assets too — deliberate (baked offline install), analogous to shipped templates. See Deviation Ledger. |
| G4 | ADR Compliance | N/A | no Accepted ADRs touching skills/update |
| G5 | Structure | PASS | all required sections present |
| G6 | Testing Alignment | PASS | TDD: test tasks precede impl for pure logic |
| G7 | Domain Completeness | PASS | informal domains; every task file listed in Manifest |

### Deviation Ledger

| Principle Violated | Why Needed | Simpler Alternative Rejected | Risk Mitigation |
|-------------------|------------|------------------------------|-----------------|
| Architecture §4 — "`files` limited to built output" | Offline install needs the skill markdown in the tarball; there is no "build" step that emits them | Keep skills remote (GitHub) — rejected: defeats the whole GitHub-free goal | `skills/**` is inert static content (no code execution risk); T018 confirms it is public-safe (P12) |

### Summary
Vendor `builder` + 3 deps + a `the-flow` redirect into `skills/`; ship `skills/**` in the npm tarball; make `harness skills install/update` resolve the baked skills dir, copy it to an absolute temp dir, and run `npx skills add <tempdir>` (local, git-free); record the install (targets+scope) in a lock and have bare `harness update` reconcile from it. **Update ordering is version-safe:** after a successful binary upgrade, reconcile by re-invoking the *freshly-installed* `harness skills update` as a child process (new binary → new baked skills), never in the old running process. TDD for the pure pieces; offline-install E2E for the whole.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `skills/builder/**`, `skills/validate-v2/**`, `skills/plan-0-v2-constitution/**`, `skills/plan-v2-extract-domain/**`, `skills/the-flow/SKILL.md` | skills-content | internal | vendored skill files + redirect |
| `package.json` | packaging | contract | add `skills` to `files` |
| `harness/cli/src/services/skills/contract.ts` | skills | contract | default source becomes local; keep targets/legacy slugs |
| `harness/cli/src/services/skills/skills-service.ts` | skills | internal | resolve packaged dir; local-path argv |
| `harness/cli/src/services/skills/skills-lock.ts` (new) | skills | internal | pure lock merge/read/serialize |
| `harness/cli/src/acts/skills.ts` | skills | internal | copy-to-temp, install from local, write lock |
| `harness/cli/src/acts/update.ts` | update | internal | bare update reads lock + reconciles |
| `harness/cli/src/adapters/fs/{fs-port,node-fs,fake-fs}.ts` | fs adapter | contract | add recursive `copyDir` |
| `INSTALL.md`, `README.md`, `docs/how/*` | docs | internal | offline install + lock-driven update |
| `.github/workflows/ci.yml` | packaging/CI | contract | assert baked skills stay in the tarball (orchestrator-owned; outside coder scope) |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | `skills@1.5.14` `parseSource`: `isLocalPath(input)` (absolute / `./` / `../` / drive) → `{type:"local", localPath: resolve(input)}`; **no git, no network**. Its own timeout error even says "clone manually and pass the local path to 'skills add'". | Pass an **absolute** temp path to `npx skills add`; no `git init` needed. |
| 02 | High | `skills/` is **not** in `package.json#files` today (`bin`, `dist`, `LICENSE` only) — so it never ships in the tarball; the GitHub source clones it at install. | Add `"skills"` to `files`. |
| 03 | High | `DEFAULT_SKILLS_SOURCE = 'AI-Substrate/harness-engineering/skills'` (`contract.ts:15`) is imported as a const by both `acts/skills.ts` and `acts/update.ts`. | Replace const usage with a runtime resolver returning the absolute packaged/temp dir; keep `--source` override. |
| 04 | High | `FsPort.copy` is **single-file** (`copyFileSync`, `node-fs.ts:70`); `mkdtemp` already exists (`fs-port.ts:88`). | Add recursive `copyDir(src,dest)` (`cpSync {recursive}`) to port + node + fake. |
| 05 | Medium | Version resolution already walks to repo root via `new URL('../../../package.json', import.meta.url)` (`version.ts:16`). | Mirror it for `resolvePackagedSkillsDir()` → `<root>/skills`. |
| 06 | Medium | The vercel installer keeps **no provenance**; `harness update` only reconciles skills when `--target` is passed (`update.ts:170`). | Harness-owned lock is the only way to "follow last method". |
| 07 | Medium | `builder`/the-flow prints `/the-flow <id> <verb>` grammar throughout its tree and auto-runs `/validate-v2`, `/constitution`, `/extract-domain`. | Rewrite `/the-flow `→`/builder ` + `name:`; vendor the 3 dep slugs so refs resolve. |
| 08 | Critical | **In-process staleness trap** (peer-review HIGH): `harness update` runs `npm i -g @latest` then calls `skillsOutcome` **in the same running process** (`update.ts:350` → `:358`). Once the default source is the baked local dir, resolving `<root>/skills` from that still-old process points at the **pre-update** package — reconcile would install stale skills, breaking AC-04 on the primary path. | After a successful binary **upgrade**, do NOT reconcile in-process: re-invoke the freshly-installed `harness skills update --target … [-g]` as a child via ExecPort (new binary → new baked skills). Reconcile in-process only when already-latest (running == installed). |

### Implementation

**Objective**: Ship `builder` + deps as baked-in skills installable offline, with lock-driven self-reconcile on update, `/the-flow` preserved as a redirect.
**Testing Approach**: Full TDD for the pure logic (resolver, `copyDir`, lock, argv); lightweight validation for vendored content + offline E2E; targeted fakes only.

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T001 | Vendor `the-flow`→`skills/builder/` (whole tree); set `name: builder`; rewrite `/the-flow `→`/builder ` across SKILL.md + `references/**` | skills-content | `skills/builder/**` | builder tree present; no `/the-flow ` command strings remain; `name: builder` | copy, no zip |
| [ ] | T002 | Vendor deps `validate-v2`, `plan-0-v2-constitution`, `plan-v2-extract-domain` (slugs unchanged) | skills-content | `skills/validate-v2/**` etc. | dirs present with original `name:` | `/constitution`,`/extract-domain`,`/validate-v2` now resolve |
| [ ] | T003 | Add thin `skills/the-flow/SKILL.md` redirect (`name: the-flow`, description preserves trigger, body: load & follow `builder` with same args); update `skills/README.md` | skills-content | `skills/the-flow/SKILL.md`, `skills/README.md` | `/the-flow` forwards to builder | AC-05 |
| [ ] | T004 | Annotate SDD source as moved | (external) | `~/github/tools/skills/SDD/MOVED.md` | note names `AI-Substrate/harness-engineering` `skills/builder` | outside repo — confirm before writing |
| [ ] | T005 | **Test**: `copyDir` recursive copy over fake-fs (nested dirs/files) | fs adapter | `harness/cli/src/adapters/fs/*.test.ts` | red test exists | TDD |
| [ ] | T006 | Add `copyDir(src,dest)` to `FsPort` + `node-fs` (`cpSync {recursive:true}`) + `fake-fs` | fs adapter | `harness/cli/src/adapters/fs/{fs-port,node-fs,fake-fs}.ts` | T005 green | KF-04 |
| [ ] | T007 | **Test**: `resolvePackagedSkillsDir()` returns `<root>/skills` from a dist-relative URL | skills | `.../skills/*.test.ts` | red test exists | mirror `version.ts` |
| [ ] | T008 | Implement `resolvePackagedSkillsDir()`; make default source local (replace const use in both acts); keep `--source` override + `resolveSkillsSource` passthrough | skills | `services/skills/{contract,skills-service}.ts` | T007 green; local absolute path flows to argv | KF-03/05 |
| [ ] | T009 | **Test**: install argv builder + source resolution yield `npx skills@latest add <ABS tmp> -a <t> … -y` (absolute path) | skills | `.../skills-service.test.ts` | red test exists | AC-07 |
| [ ] | T010 | Wire `acts/skills.ts` install+update: `copyDir` packaged→`mkdtemp` temp, run `npx skills add <tmp>`; announce local command | skills | `harness/cli/src/acts/skills.ts` | T009 green; offline install works | AC-02 |
| [ ] | T011 | **Test**: skills-lock merge/read/serialize (add targets, dedupe, per-scope entries; unreadable→empty) | skills | `.../skills/skills-lock.test.ts` | red test exists | AC-03 |
| [ ] | T012 | Implement `skills-lock.ts` (pure) + lock I/O; write/merge on install+update at project `.harness/` or `~/.harness/` (global) | skills | `services/skills/skills-lock.ts`, `acts/skills.ts` | T011 green; lock written w/ targets+scope+source | KF-06 |
| [ ] | T013 | **Test**: bare `update` reconcile chooses lock targets; no lock → report-only | update | `harness/cli/src/acts/update.test.ts` | red test exists | AC-04 |
| [ ] | T013b | **Test**: after a binary **upgrade** (`installed_after != installed_before`), reconcile re-execs the installed `harness skills update` (fresh child via fake exec) rather than the in-process path; already-latest → in-process reconcile | update | `harness/cli/src/acts/update.test.ts` | red test exists; asserts child `harness skills update` invocation on upgrade | AC-09, KF-08 |
| [ ] | T014 | Bare `harness update` reads lock(s) → resolves targets/scope; **on binary upgrade** re-invoke the freshly-installed `harness skills update` as a child (ExecPort); **already-latest** → reconcile in-process (existing refresh+prune); `--target` overrides + updates lock; no lock & no target → report-only | update | `harness/cli/src/acts/update.ts` | T013 + T013b green | AC-04, AC-09, KF-08 |
| [ ] | T015 | Add `"skills"` to `package.json#files`; `npm pack --dry-run` shows the trees | packaging | `package.json` | AC-01 passes | KF-02 |
| [ ] | T016 | Docs: INSTALL.md/README offline-install note + `docs/how` lock-driven + version-safe update; fix any markdownlint/doctrine-parity on vendored tree | docs | `INSTALL.md`, `README.md`, `docs/how/*`, lint config | `lint:md`,`check:docs` green | AC-08 |
| [ ] | T017 | Full verify: `npm run build`; `vitest run --coverage`; `npm pack --dry-run`; offline `harness skills install --target claude-code`; bare `harness update`; `/the-flow`→builder | (all) | — | AC-01..09 all pass | Verification section |
| [ ] | T018 | Public-safe check (P12): scan vendored `skills/builder/**` + deps for private identifiers/customer details before commit | skills-content | `skills/**` | no private data; `git status` clean of `scratch/` | G2/P12 |
| [ ] | T019 | **CI packaging guard (orchestrator — outside coder scope)**: extend the existing `npm pack --dry-run` jq assertions to also require `skills/builder/SKILL.md` + each vendored dep + `skills/the-flow/SKILL.md` in the tarball, so skills can never silently drop out of the published package | packaging/CI | `.github/workflows/ci.yml` | CI fails if any baked skill is missing from `npm pack` | AC-10; regression sensor for AC-01/AC-02 |
| [ ] | T020 | Confirm CI's existing `skills` sensor + markdownlint pass on the vendored tree (aggregated check, `ci.yml:80`); scope any lint ignores | CI | `.github/workflows/ci.yml` deps, lint config | CI `skills`/markdown lanes green | overlaps T016 |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T015 | `npm pack --dry-run` |
| AC-02 | T008, T010 | offline install E2E (T017) |
| AC-03 | T012 | T011 unit + E2E |
| AC-04 | T013, T014 | T013 unit + E2E |
| AC-09 | T013b, T014 | T013b unit (upgrade re-exec) |
| AC-10 | T019 | CI `npm pack` skills assertion |
| AC-05 | T001, T003 | manual `/the-flow`,`/builder` (T017) |
| AC-06 | T001, T002 | ref resolution check |
| AC-07 | T005, T007, T009, T011 | vitest |
| AC-08 | T016, T017 | lint + full suite |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Non-absolute local path treated as git source | Low | High | Resolver + `mkdtemp` always absolute; unit-assert absolute in argv (T009) |
| Update reconciles STALE baked skills from the old in-process package after a binary upgrade | Med (design default) | High | Re-exec freshly-installed `harness skills update` on upgrade; in-process only when already-latest (T013b/T014, AC-09, KF-08) |
| Global `~/.harness/skills.lock.json` unreadable on a consumer machine | Low | Med | Treat unreadable lock as empty → report-only fallback (T011/T014) |
| Vendored `builder` tree trips markdownlint/doctrine-parity | Med | Low | Scope ignores; run `lint:md`/`check:docs` in T016 |
| `skills/**` bloats tarball | Low | Low | ~0.6 MB; acceptable, verified in T015 |
