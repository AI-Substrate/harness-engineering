# Fix FX001: Consumer-mode `harness doctor` falsely reports `cli-build` degraded

**Created**: 2026-06-10
**Status**: Proposed
**Plan**: [013-dogfood-harness-flow](../dogfood-harness-flow-plan.md)
**Source**: Plan 013 dogfood finding FIND-2 (hit by ALL worker repos — chalk, express, click, cobra; see `runs/ROLLUP.md` and `scratch/handover-013-surfaced-findings.md`)
**Domain(s)**: harness-cli (internal change, no contract impact)

---

## Problem

`doctor` checks for `harness/cli/dist/index.js` relative to cwd (`doctor-service.ts:44`). That path only exists in this repo — the harness's home. In an installed consumer clone there is no `harness/cli/`, so the very first diagnostic a consumer runs reports `cli-build` not-ok and the whole envelope goes `degraded`, with a useless `next_action` ("Run `npm run build`"). Every plan-013 worker hit this; it erodes trust in the extension system's own health check.

## Proposed Fix

Teach `checkCliBuild` to distinguish the two modes via the existing `FsPort`, gating on the **file marker** `harness/cli/tsconfig.json` (the CLI's build root — present only in the harness's home repo; note there is no `harness/cli/package.json`, the CLI builds from the root package):

- **Dev mode** (`harness/cli/tsconfig.json` exists): behaviour unchanged. `dist/index.js` present → ok; absent → not-ok with the `npm run build` next_action.
- **Consumer mode** (marker absent): the dev build check does not apply — report the layer **ok** with an honest detail containing the word `consumer` (e.g. `consumer install — dev build check n/a (no harness/cli/)`). Keep the layer in the report (stable layer list, transparent reasoning) rather than hiding it.

**Decision record** (handover FIND-2 offered two options): chose **skip-the-check-honestly** over **resolve the installed bin path** — npx/installed consumers expose no stable bin path the doctor can cheaply verify, and an ok-with-detail layer preserves transparency without inventing a new check.

**Why a file marker, not the directory**: `FakeFs.exists` only returns true for exact seeded file paths or `mkdirp`-created dirs (`fake-fs.ts:21-24`; the constructor `dirs` map feeds `readdir` only). A `fs.exists('harness/cli')` directory gate would be untestable as specced and would silently flip the existing dev-mode tests (seeded with only `harness/cli/dist/index.js`) into consumer mode.

Explicit scope guards:
- ✗ Do NOT omit the `cli-build` layer from the report in consumer mode — always report it, `ok: true` + detail.
- ✗ Do NOT implement installed-bin-path resolution — separate product question, out of scope.

Known heuristic edge: a consumer repo that coincidentally contains `harness/cli/tsconfig.json` would be treated as dev mode — acceptable; it then gets the truthful "dist not built" signal.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| harness-cli | owner | `checkCliBuild` gains mode detection; doctor layer semantics for consumers corrected. No `Envelope`/contract change, no new ports. |

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | FX001-1 | Add consumer-mode detection to `checkCliBuild`: `fs.exists('harness/cli/tsconfig.json')` (file marker, NOT the directory) gates dev vs consumer; consumer → `ok: true` + detail containing `consumer`; dev behaviour byte-identical | harness-cli | /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/doctor/doctor-service.ts | Consumer cwd no longer yields a degraded envelope from `cli-build`; dev repo unchanged | DONE: `CLI_DEV_MARKER` gate added (doctor-service.ts:44-52,60-75); line-43 comment rewritten to describe both modes |
| [x] | FX001-2 | Unit tests for all three modes via exact-path `FakeFs` seeding: dev+built `{tsconfig.json, dist/index.js}` → ok; dev+unbuilt `{tsconfig.json}` → not-ok + `npm run build` next_action; consumer `{}` (empty) → ok + detail matches `/consumer/` | harness-cli | /Users/jordanknight/substrate/harness-engineering/harness/cli/test/services/doctor/doctor-service.test.ts | Three mode cases asserted; existing `BUILT_CLI` seed gains the tsconfig marker so the current ok-case test stays a dev-mode test; full suite green | DONE: `BUILT_CLI` seed gained marker; 2 new mode tests added. Also surfaced+fixed a latent over-assertion in `test/acts/doctor.test.ts:52` (assumed doctor always degraded in the `harness/cli` cwd — the very bug); now conditional on `status==degraded` |
| [x] | FX001-3 | Build + full suite + commit | harness-cli | — | `npm run build` exit 0; vitest all pass; conventional commit `fix(doctor): …` referencing FIND-2 | DONE: build exit 0; 277/277 (was 275, +2 mode tests) |

## Workshops Consumed

None.

## Acceptance

- [x] In a tree without `harness/cli/tsconfig.json`, `buildDoctorReport` yields `cli-build.ok === true`, the detail mentions `consumer`, and the envelope is not degraded by that layer.
- [x] In the dev repo (marker present) with `dist/index.js` missing, `cli-build` still reports not-ok with the `npm run build` next_action.
- [x] The existing `BUILT_CLI`-seeded ok-case test remains a dev-mode test (seed updated with the marker).
- [x] All existing + new tests pass; no contract/Envelope shape change.

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|

---

## Validation Record (2026-06-10)

### Validation Thesis

**Raison d'être**: Turn plan-013 dogfood finding FIND-2 (consumer-mode `doctor` falsely reports `cli-build` degraded) into a scoped, approvable, implementable brief for plan-6, honoring the surfaced-not-auto-implemented guardrail.

**Value claim**: The fix becomes cheap and safe to implement — plan-6 executes with minimal clarification; dev-repo build check intact; consumers' first diagnostic stops lying.

**Artifact promise**: Every factual claim (paths, line numbers, test-collision claim, FakeFs semantics) matches source; tasks unambiguous; acceptance objectively testable; no Envelope/contract change.

**Intended beneficiaries**: plan-6 implementing agent (primary), human approver, consumer-repo `doctor` users, plan-8 merge traceability.

**Proof target**: Implementation

**Evidence standard**: source-code match (doctor-service.ts, fs adapters, full test tree), verified no test collisions, repo conventions.

**Thesis source**: `scratch/handover-013-surfaced-findings.md` §Finding 2 + user go-ahead ("fix task for 2 please").

**Thesis verdict**: Advanced (after fixes — pre-fix: Partially, due to untestable gate spec)

**Main thesis risk**: plan-6 implementing a gate whose semantics diverge between the real fs and FakeFs — eliminated by switching to the `harness/cli/tsconfig.json` file-marker gate.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| Source Truth | Evidence Sufficiency, Technical Constraints, Hidden Assumptions, Edge Cases | Evidence Sufficiency, Implementation Readiness | 1 CRITICAL fixed, 1 HIGH fixed, 1 MEDIUM fixed | ⚠️ → ✅ |
| Cross-Reference & Completeness | Integration & Ripple, System Behavior, Domain Boundaries, Concept Documentation, Deployment & Ops | Downstream Usefulness, Safety to Change | 1 LOW fixed | ✅ |
| Thesis + Forward-Compatibility | Thesis Alignment, Forward-Compatibility, Proof-Level Fit, User Experience, Hidden Assumptions | Thesis Alignment, Proof-Level Fit, Implementation Readiness, Downstream Usefulness | 2 CRITICAL (dup of Source Truth root cause) fixed, 2 MEDIUM fixed | ⚠️ → ✅ |

**Deduped issues**: 1 CRITICAL (directory gate untestable with `FakeFs` exact-path semantics → replaced with `harness/cli/tsconfig.json` file marker; validator-proposed `package.json` marker rejected — that file does not exist, CLI builds from root package), 1 HIGH (no-collision claim verified across full test tree; `cli-commands.test.ts:72-78` bracket tolerant), 3 MEDIUM (comment-rewrite note, consumer detail-string assertion, explicit scope guards), 1 LOW (decision record for skip-vs-resolve-bin-path). All fixed in this dossier.

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| plan-6 implementer (`--fix FX001`) | Unambiguous executable tasks | shape mismatch | ✅ (post-fix) | Gate is now an exact file marker with per-case seeds spelled out in FX001-2 |
| `doctor-service.test.ts` + `cli-commands.test.ts` | No collisions; cases representable in FakeFs | test boundary | ✅ | `fake-fs.ts:21-24` exact-path semantics; integration bracket `['degraded','ok']` tolerant (cli-commands.test.ts:76) |
| plan 013 `## Fixes` registry + plan-8 merge | Accurate registration | contract drift | ✅ | Registry row links resolve; status Proposed |
| Consumer users + `eng-harness-0-setup` skill | Fix aligns with documented guidance | contract drift | ✅ | SKILL.md:79 documents the wart as expected-not-failure; fix makes that guidance honest |

**Thesis alignment**: Value claim advanced at Implementation proof level (post-fix); main residual risk is the acceptable heuristic edge (a consumer coincidentally containing `harness/cli/tsconfig.json` gets dev-mode treatment).

**Outcome alignment** (echoed from the Forward-Compatibility agent): The Outcome — "A real product wart — the very first diagnostic a consumer runs lies to them. Erodes trust in `doctor`, which is the extension system's own check." — this dossier puts the work on a correct trajectory to fix that lie: a consumer tree will report `cli-build.ok === true` instead of false, preventing the falsely degraded envelope. The agent's three requested clarifications (gate semantics, test scope, detail-string specificity) were applied to this dossier post-validation.

**Standalone?**: No — downstream consumers enumerated above.

Overall: ⚠️ VALIDATED WITH FIXES
