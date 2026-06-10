# Windows Cross-Platform Fixes

**Mode**: Simple
**Created**: 2026-06-10
**Status**: VALIDATED WITH FIXES (validate pass 2026-06-10, 3 agents — see § Validation)
**Original ask**: [original-ask.md](./original-ask.md)
**Research**: [`scratch/cross-system-failure.md`](../../../scratch/cross-system-failure.md) (external dossier, produced on the Windows side)

## Research Context

📚 This spec consumes a pre-supplied root-cause dossier instead of a `/plan-1a` pass: `scratch/cross-system-failure.md` was written during the Windows port session against a snapshot of this repo. Its headline: **the harness CLI builds and runs correctly on Windows** (`help`/`doctor`/`docs`/`new` all return valid envelopes), but `npm test` reports **40 failed / 237 passed**, every failure tracing to path-separator or Unix-shell assumptions — **none are logic defects**. Five categories:

| Cat | Nature | Where (verified on current branch 2026-06-10) |
|-----|--------|----------------------------------------------|
| A | **Real** — production builds *logical* paths with `node:path.join`, emitting `\` into envelopes + missing POSIX-keyed fixtures (~33 of 40 failures) | `discovery.ts:1,56,65,87,97,113` + `isWithin` `:121-124` + `dedupeByAbsolutePath` `:127-138`; `record-service.ts:1,95,141,149,153,154` (`relPath` in message `:179`, envelope `:184`); `scaffold-service.ts:1,93-97` (`relPath`/`relInstructions` surfaced `:124`). **Validation extended the scope**: `entryPath` flows downstream into `doctor-service.ts:121-128,291` (native `dirname`/`relative`/`join` + a `===` folder comparison) and `instructions-service.ts:36` (native `join(dirname(entryPath))` used as an `fs.exists` key) — same root cause, missed by the dossier |
| B | Test infra — `FakeFs` splits on `'/'` only | `fake-fs.ts:51-53` (`mkdirp`) **and** `:41` (`readdir` child-name extraction — current branch has a second site the dossier predates) |
| C | Test infra — assertions re-split absolute paths with `'/'` | `integration/extensions.test.ts:91` (`split('/').slice(-2)` — needs the two-segment `folder/file` form, not plain `basename`), `:235` (`split('/').pop()` on `c.folder`) |
| D | Test env — Unix-shell-only EPIPE test | `integration/docs.test.ts:43-53` hard-codes `bash` + `head`; **also** `:24` `execFileSync('npm', …)` in the build guard (`npm` is `npm.cmd` on Windows — same class, found while re-verifying) |
| E | **Real** — `gen-docs.mjs` runs the extensionless `node_modules/.bin/biome` via `execFileSync` (ENOENT on Windows post-CVE-2024-27980) | `scripts/gen-docs.mjs:69-71` |

**Folded in at flow start (new evidence, 2026-06-10)**: the `package-smoke` CI job is red on **all** recent runs of `feat/harness-cli-core` — `gen-docs.mjs:76` logs `gen-docs: wrote …` to **stdout**; `npm pack` triggers `prepare: npm run build` (package.json:28), and npm forwards lifecycle stdout even under `--silent`, so the log line contaminates `TARBALL="$(npm pack --silent)"` (`ci.yml:125`). **Validation found a second latent break in the same job**: the script greps `doctor.json` for `E143` / `unsupported flat layout` (`ci.yml:169-170`) but never creates the flat fixture file that would trigger them — fixing TARBALL alone leaves the job red at the grep. This is a **Linux** failure visible today, not just a Windows concern.

Dossier line references drifted slightly (the port snapshot predates the extension folder layout); all claims re-verified against the current branch and updated above.

## Summary

Make the harness CLI genuinely cross-platform by fixing the five dossier categories upstream — adopt the convention that **the harness's logical paths are POSIX on every OS** (Node's `fs` accepts `/` on Windows, so one convention serves display, comparison, and real I/O) — and make the `package-smoke` job green (deterministic TARBALL capture + the missing flat fixture). Validate with deterministic backpressure per the original ask, **without any Windows CI executor** (ruled out by user decision 2026-06-10): the proof is *by construction* — pure POSIX path helpers plus unit tests that feed **Windows-shaped inputs** (backslash cwd `C:\repo`, mixed separators, drive-letter case, UNC) through the fake layer on the existing ubuntu legs, where any native-`join` regression leaks a backslash and fails deterministically. A green `package-smoke` proves the pack pipeline; the one-off on-Windows confirmation happens manually at the next re-port.

## Goals

- All paths the CLI **surfaces or compares** (envelope `path`/`relPath` fields, messages, discovery keys, doctor/instructions folder math) are forward-slash on every OS.
- `npm test` green on Windows at the next re-port (the dossier's 40 failures resolved) **and** still green on Linux.
- `package-smoke` green: deterministic tarball-name capture + a fixture that actually exercises the E143 assertions.
- The fix is **encoded, not remembered**: a shared POSIX-path helper, separator-tolerant test doubles, and ubuntu-runnable unit sensors (Windows-shaped inputs) that catch path-convention regressions on every PR — no Windows executor required.

## Non-Goals

- **A Windows CI executor** (`windows-latest` leg or any Windows runner) — ruled out by user decision 2026-06-10 (*"we will not have a windows server in ci... remove anyting that needs that"*). On-Windows confirmation is the manual re-port flow (`verify-port.ps1` on the user's machine); CI-side proof is by construction + Windows-shaped-input unit tests on ubuntu.
- `doctor` toolchain probing `node_modules/.bin` (dossier side-observation; `status: degraded` when biome isn't on PATH) — orthogonal, follow-up candidate.
- **Extensionless-bin spawning via `NodeExec` (`shell:false`)** — two known Windows-runtime breaks of the same class as Cat E: the `skills` act's `npx` invocation (`acts/skills.ts:136`) and the `arch-check` extension's `./node_modules/.bin/depcruise` (`extension.ts:57`, fails into a graceful error envelope). Neither is test-visible (FakeExec masks them); the right fix is platform-aware bin resolution in `NodeExec` itself — explicit follow-up candidate, out of scope here.
- Running `package-smoke` itself on Windows (its script is bash; the Windows sensor is the test-suite leg).
- Any envelope content changes beyond separator normalization; no new verbs, no contract changes.
- Re-porting / verifying the Windows fork itself (`verify-port.ps1` flow) — this plan fixes upstream so a future re-port converges.

## Target Domains

*(No `docs/domains/` registry in this repo; areas named by path.)*

| Area | Status | Relationship | Role in This Feature |
|------|--------|-------------|---------------------|
| `harness/cli` (services + adapters + tests) | existing | **modify** | POSIX logical paths in discovery/record/scaffold **+ doctor/instructions** (downstream `entryPath` consumers); separator-tolerant FakeFs; path-safe test assertions; shell-free EPIPE test |
| `scripts/gen-docs.mjs` | existing | **modify** | stderr logging; cross-platform biome format invocation |
| `.github/workflows/ci.yml` | existing | **modify** | fix package-smoke TARBALL capture + restore the flat-layout fixture (no new jobs — no Windows executor, user decision) |
| `.gitattributes` | **NEW** | **create** | `eol=lf` normalization — protects Windows *checkouts* (the manual re-port flow) from autocrlf; cheap hygiene, no CI dependency |

## Testing Strategy

- **Approach**: Hybrid.
- **Rationale**: The work *is* mostly test-visible path plumbing — the existing suite (380 tests) is the regression net and must stay green on Linux throughout. New unit tests pin the helper itself. **There is no Windows executor anywhere** (user decision) — so the deterministic proof is *by construction*: the path logic is pure string-space code, and unit tests feed it Windows-shaped inputs on ubuntu, where any native-`join` regression leaks a backslash and fails.
- **Focus areas**: unit tests for the POSIX path helper (`toPosix` incl. **drive-letter case normalization**, posix-join construction, `isWithin` in POSIX space with the literal `'../'` check — tested against `C:/` vs `c:/` mixed-case, UNC, and traversal-escape inputs); dedupe keys in POSIX space; **Windows-shaped cwd fixtures** — a dedicated test set seeds `FakeProcess.cwd()` with `C:\repo`-style backslash paths and asserts envelopes come out as clean POSIX (this is the ubuntu-runnable sensor that catches native-vs-POSIX join regressions); envelope-shape assertions (`.harness/records/...`, `.harness/extensions/...` literal forward-slash); the rewritten shell-free EPIPE test.
- **Excluded**: anything requiring a Windows executor. Real-fs integration behaviour on Windows (jiti loading from drive-letter paths, `npm.cmd` spawning, biome bin invocation) is **not CI-provable by decision** — it is confirmed manually at the next re-port and recorded in the execution log.
- **Mock usage**: targeted — existing `FakeFs`-style test doubles only; no new mock surface.

## Documentation Strategy

No new standalone guide. Encode the convention where contributors will meet it:
- `docs/project-rules/idioms.md`: a short **"Logical paths are POSIX"** idiom (what counts as a logical path vs a physical FS call; logs go to stderr, stdout is data).
- Docstring on the shared path helper (the enforcement point).

## Complexity

- **Score**: CS-2 (small)
- **Breakdown**: S=1 (a handful of files, one package + CI), I=1 (npm pack lifecycle × CI interplay), D=0, N=0 (dossier prescribes the fix pattern), F=1 (cross-platform is the non-functional point), T=1 (new CI leg + test-infra changes)
- **Confidence**: 0.85
- **Assumptions**: Node `fs` and `jiti` accept forward-slash paths on Windows (Win32 API does; the backslash form is runtime-proven; the forward-slash form is proven by AC-8 before merge).
- **Dependencies**: none new. The shared path helper lives in `harness/cli/src/services/shared/` (precedent: `services/shared/temp.ts`) — verified against all 7 dependency-cruiser rules: services may import services, so `arch-check` stays `ok`. (The arch-check *extension's own* Windows bin issue is Non-Goaled above.)
- **Risks**: see § Risks & Assumptions.
- **Phases**: 1 (Simple).

## Acceptance Criteria

1. **POSIX envelopes**: every path the CLI surfaces (e.g. `new` → `data.path`, `record` → `data.path`/messages, doctor `next_action` folder hints) contains no `\` on any OS; unit tests assert the literal forward-slash shapes `.harness/extensions/...` and `.harness/records/<type>/<date>/...`.
2. **One construction pattern**: discovery, record-service, scaffold-service, **doctor-service, and instructions-service** build/derive logical paths via a shared POSIX helper (`posix.join`/`posix.dirname` + `toPosix()` normalization of `proc.cwd()` and `entryPath` at the boundary). Verified by reading the code paths that reach envelopes/comparisons — no native `join`/`dirname`/`relative` invocation on surfaced or compared paths remains in those five files (import-grep alone is insufficient).
3. **Traversal guard + dedupe correct in POSIX space**: `isWithin` computes with `posix.relative` and the literal `'../'` check, `toPosix` normalizes drive-letter case, and `dedupeByAbsolutePath` keys are POSIX-normalized (case-folded on win32 only) — unit-tested with mixed-separator, mixed-case (`C:/` vs `c:/`), UNC, and `../`-escape inputs.
4. **FakeFs separator-tolerant**: `mkdirp` (`fake-fs.ts:51-53`) **and** `readdir`'s child-name extraction (`:41`) handle `\` and `/` inputs equivalently — each site unit-tested.
5. **Path-safe assertions**: `integration/extensions.test.ts:91` derives the two-segment `folder/file` form via `node:path` parts (e.g. `posix.join(basename(dirname(p)), basename(p))`), and `:235` uses `basename(c.folder)` — no raw `split('/')` on absolute paths anywhere in the test suite.
6. **Shell-free EPIPE test**: `integration/docs.test.ts` proves the early-closing-reader contract with Node primitives (spawn, read a line, `stdout.destroy()`, assert no EPIPE) — no `bash`/`head`. The `npm` build-guard at `:24` is replaced with a Windows-safe invocation (e.g. platform-suffixed `npm.cmd` or via `process.execPath`) — **not** skipped on Windows.
7. **gen-docs hygiene**: all `gen-docs.mjs` progress output goes to **stderr** (stdout is for data); the biome format pass is cross-platform (no `execFileSync` of an extensionless bin, no `shell:true` deprecation) and guarded so a missing/failing biome never breaks the build.
8. **Windows-shape proof on ubuntu (replaces the CI leg — no Windows executor, user decision)**: a dedicated unit-test set seeds **Windows-shaped inputs** through the fake layer — `FakeProcess.cwd()` returning `C:\repo`-style backslash paths, mixed-separator and mixed-case path arguments — and asserts every surfaced envelope path comes out as clean POSIX (`.harness/...`, no `\`). These run on the existing ubuntu legs and fail deterministically if anyone reintroduces native `join` on a logical path. The residual on-Windows confirmation (real fs + jiti + shells) is a **one-off manual re-verification** of the dossier's 9-file inventory on the user's Windows machine at the next re-port, recorded in the execution log — explicitly human-tier, explicitly accepted.
9. **package-smoke green** on the PR, which requires both: (a) deterministic tarball capture — `npm pack --json` parsed for the filename as the primary mechanism (immune to lifecycle stdout), with the stderr move in AC-7 as defense-in-depth; mechanical check: the captured value matches `*.tgz` exactly; and (b) the **flat-layout fixture restored** — create a flat `.harness/extensions/legacy.ts` in the smoke dir so the `E143` / `unsupported flat layout` greps (`ci.yml:169-170`) and the `harness legacy` unknown-command check actually exercise what they claim.
10. **No Linux regression**: full suite green on ubuntu legs (Node 22/24); `harness arch-check` still `ok`.

## Risks & Assumptions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Drive-letter case mismatch (`c:/` vs `C:/`) makes POSIX-space `isWithin`/dedupe silently drop or duplicate entries | Medium | High | `toPosix` upper-cases the drive letter; dedupe keys case-folded on win32; mixed-case unit tests (AC-3) |
| **No Windows executor → a Windows-only regression can ship silently again** | Medium | Medium | Accepted by decision. Narrowed by construction: the POSIX convention makes path behaviour platform-invariant, and AC-8's Windows-shaped-input tests catch convention regressions on ubuntu. Backstop: manual re-port verification |
| `jiti` loading `.ts` from forward-slash drive-letter absolute paths on Windows (jiti 2.7.0 path handling) | Low | High | **Not CI-provable by decision** — confirmed at the manual re-port; fallback is `pathToFileURL().href` into jiti |
| `npm pack` lifecycle stdout leaks from another source later | Low | Medium | AC-9 uses `npm pack --json` (structurally immune), not a cleaner `--silent` capture |
| autocrlf (CRLF checkout) poisons the user's Windows checkouts at re-port | Medium | Low | `.gitattributes` with `eol=lf` (no CI dependency) |
| POSIX-ifying changes a path some **physical** FS call depends on | Low | Medium | Convention scopes to *logical* paths; Win32 accepts `/`; full suite + smoke on ubuntu, manual re-port on Windows |

**Assumptions**: the dossier's failing-test inventory (9 files / 40 tests) is the complete Windows *test* failure surface as of its snapshot — the manual re-port reveals any drift; `test/architecture/no-direct-node-io.test.ts` is separator-consistent as written (native `join` on both sides) and needs no change.

## Open Questions

- ~~CI matrix shape~~ — **resolved by user decision 2026-06-10: no Windows CI executor at all.** CI-side proof is by construction + Windows-shaped-input unit tests on ubuntu; on-Windows confirmation is the manual re-port.

## Workshop Opportunities

None — the dossier prescribes the fix pattern (its "Recommended upstream fix (A)" option 1), and the design space is settled by the existing codebase conventions.

## Validation

**validate-v2 pass, 2026-06-10 (3 agents: evidence-grounding / contract-testability / adversarial-risk): VALIDATED WITH FIXES.** Material findings, all applied above:

> **Amendment (same day, post-validation)**: the user ruled out any Windows CI executor (*"we will not have a windows server in ci... remove anyting that needs that"*). The validation findings about Windows-leg design (minimal job, `check:docs` exclusion, `ci-required` update) are therefore superseded — AC-8 was rewritten from a `windows-latest` leg to **Windows-shaped-input unit tests on ubuntu** plus a manual re-port confirmation. `.gitattributes` survives as checkout hygiene; the CRLF findings now apply to the user's Windows checkouts rather than a CI runner.

- **Scope gap (HIGH)**: `doctor-service.ts` + `instructions-service.ts` do native path math on `entryPath` downstream of discovery — added to Cat A and AC-2 (the dossier missed them because their unit tests use POSIX-keyed fakes).
- **package-smoke double-break (HIGH)**: stderr-only fix is insufficient (`--silent` doesn't suppress lifecycle stdout) → `npm pack --json` is the primary capture; AND the job's `E143` greps are unsatisfiable today because no flat fixture file is ever created → fixture restored (AC-9).
- **POSIX-space edge cases (CRITICAL)**: drive-letter case mismatch + literal `'../'` check + dedupe keying — pinned in AC-3 with mandated unit tests.
- **Windows-leg design (HIGH)**: must be minimal (no `check:docs` — autocrlf), needs `.gitattributes`, and `ci-required` must list the new job — pinned in AC-8.
- **Fix-form precision (HIGH)**: `extensions.test.ts:91` needs the two-segment form (plain `basename` would be wrong); `:235`, `fake-fs.ts:41`, and the `npm` build-guard "no skip" rule made explicit (AC-4/5/6).
- **Evidence corrections (LOW)**: `record-service.ts` relPath sites are `:179`/`:184` (not `:163`); `fake-fs.ts` readdir split is `:41`. Helper home verified: `services/shared/` passes all 7 depcruise rules.

Deferred by validation (recorded in Non-Goals): `NodeExec` extensionless-bin resolution (`skills` npx, arch-check depcruise) — runtime-only, same fix class, follow-up.

## Clarifications

### Session 2026-06-10

Round 1 adopted on recommended defaults — the user requested a run-through (`run it` → `then validate`); each is overridable on review:

- **Workflow Mode** → **Simple** (CS-2, single area, one phase; fix work from a prescriptive dossier).
- **Testing Strategy** → **Hybrid** (unit tests for the new path helper + guard; existing 380-test suite as the net; Windows proof via CI leg — see § Testing Strategy).
- **Mock Usage** → **Targeted** (existing FakeFs doubles only; no new mocks).
- **Documentation Strategy** → **No new guide; encode the convention** in `docs/project-rules/idioms.md` + helper docstring (see § Documentation Strategy).

Round 2 skipped: no NEW domains beyond a one-file `.gitattributes`, agent harness exists and is healthy (`3 loaded`), no critical `[NEEDS CLARIFICATION]` markers. The one open item (CI matrix shape) was resolved to its recommended default by the validation pass.

User's verbatim backpressure mandate (drives AC-8/AC-9): *"we shoud use our harness loop to validate them using determinitic back pressure when done."*

**Amendment 2026-06-10** — *"we will not have a windows server in ci... remove anyting that needs that..."* → no Windows CI executor. AC-8 rewritten (Windows-shaped-input unit tests on ubuntu + manual re-port confirmation); ci.yml scope reduced to the package-smoke repair; `.gitattributes` retained as checkout hygiene; risk "Windows-only regression can ship silently" explicitly accepted with by-construction narrowing.
