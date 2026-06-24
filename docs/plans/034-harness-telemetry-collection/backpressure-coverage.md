# Backpressure Coverage — Harness Telemetry Collection

**Spec**: [harness-telemetry-collection-plan.md](./harness-telemetry-collection-plan.md) (unified spec+plan)
**Generated**: 2026-06-23
**Certainty**: Partial

> Advisory only. Never blocks, never gates, no scores. (Advisory backpressure survey — `pre-coding` seam.)

## Existing Sensors (inventory)

Discovered by filesystem probe across the single workspace root (`package.json`) + the `harness/cli` package. This is a TypeScript CLI with a hexagonal-architecture test discipline — the sensor surface is rich.

| Sensor | Command | Dimension | Found in |
|--------|---------|-----------|----------|
| Unit/component + golden-fixture tests | `npm test` (`cd harness/cli && vitest run --coverage`) | behaviour | `harness/cli` (`test/**`, `fixtures/`, `__snapshots__/`) |
| **No-direct-node-io arch test** | `vitest` → `test/architecture/no-direct-node-io.test.ts` | architecture-fitness | `harness/cli/test/architecture` |
| **No-direct-exit arch test** | `vitest` → `test/architecture/no-direct-exit.test.ts` | architecture-fitness | `harness/cli/test/architecture` |
| dependency-cruiser rules | `depcruise` via `.dependency-cruiser.cjs` (CI, warn sev) | architecture-fitness | root — `no-fakes-in-prod`, `services-only-adapter-ports`, `services-ports-type-only`, `adapters-stay-leaf`, `output-stays-leaf`, `no-circular` |
| Typecheck | `npx tsc --noEmit -p harness/cli/tsconfig.json` | maintainability | root |
| Lint/format | `npx biome check harness/cli` | maintainability | root |
| Generated-content drift gates | `npm run check:docs`, `npm run check:flows` | maintainability | root (`scripts/gen-*.mjs`) |
| `.harness/temp/` gitignore | `git status --porcelain` (already ignored) | behaviour (PR-invisibility) | `.gitignore:159` |
| CI PR gate | `.github/workflows/ci.yml` (runs all above) | behaviour + arch + maint | root |

## Coverage Matrix

One row per acceptance criterion / derived failure mode. Status is honest about *today*: `EXISTS` = a current sensor already proves it; `BUILDABLE` = no sensor yet, but specifiable within plan scope (the framework is present); `ABSENT` = cannot be proven deterministically.

| Criterion / failure mode | Deterministic sensor | Status | Tier | Probe trail (required if ABSENT) |
|--------------------------|----------------------|--------|------|----------------------------------|
| **AC-04** payload is counts-only, no content, repo-relative paths | serialization test asserting no message/file/arg fields + no absolute paths | BUILDABLE | computational | — (framework: vitest, already task 1.1) |
| **AC-06a** buffer never pollutes working tree / PR | `git status --porcelain` unchanged across capture | **EXISTS** (gitignore half) + BUILDABLE (porcelain test) | computational | — (`.harness/temp/` already ignored, `.gitignore:159`) |
| **AC-06b** orphan-ref write doesn't touch index | `FakeGitWrite` + porcelain-unchanged across flush | BUILDABLE | computational | — |
| **AC-01a** host stdout + exit byte-identical with/without telemetry | golden/snapshot output diff on `doctor`/`flow`/`record` | BUILDABLE | computational | — (snapshot precedent: `__snapshots__/`) |
| **AC-09** throwing adapter never changes host exit code | fail-safety test w/ injected throwing adapter | BUILDABLE | computational | — (corroborated by `no-direct-exit.test.ts`) |
| **service is ports-only, no `node:*`** (task 1.5) | `no-direct-node-io.test.ts` + dep-cruiser `services-only-adapter-ports` | **EXISTS** | computational | — |
| **FakeGitWrite stays out of prod** (task 4.1) | dep-cruiser `no-fakes-in-prod` | **EXISTS** | computational | — |
| **AC-02/03** adapter token math == golden fixture (dedupe + 4 buckets) | golden-fixture adapter tests | BUILDABLE | computational | — (fixtures dir precedent) |
| **AC-05** kill-switch → zero side effects | `FakeFs` test asserting no writes when `HARNESS_NO_TELEMETRY=1` | BUILDABLE | computational | — |
| **AC-07/13** orphan-ref author is non-individual; no per-individual field in segment | `FakeGitWrite` author assert + schema/serialization grep | BUILDABLE | computational | — (the §T1 governance sensor) |
| **AC-08** plan-link dedupe | sync-service unit test | BUILDABLE | computational | — |
| **AC-12** new adapter w/o schema change; null-fill | stub "future-harness" adapter test | BUILDABLE | computational | — |
| **AC-14** offline-safe: failed push leaves buffer | `FakeGitWrite` simulating push failure | BUILDABLE | computational | — |
| **AC perf** capture latency delta < 10ms (task 3.4) | wall-clock assertion in test | BUILDABLE ⚠️ *fragile* | computational | — (see Phase 0 — timing assertions are flaky) |
| **AC-03 (drift)** Copilot process-log format changes upstream | — (cannot sense a future external format) | **ABSENT** (mitigated) | inferential | globbed `~/.copilot` log shape via `scratch/telem` probe; external format is unsensable — mitigation is null-on-absence + golden fixture pinning *today's* shape |
| **AC-10/11** docs reach team/repo-grain quality (not just present) | doc-presence is computational; *quality* is human review | BUILDABLE (presence) / ABSENT (quality) | inferential | doc presence: `remark`/`check:docs`; semantic "no per-individual surface" is partly human-judged |
| telemetry is *useful* to eng-thrive (correlation/value) | — (downstream, explicit non-goal) | ABSENT | human-judgement | out of scope — PL-01/19; downstream eng-thrive owns it |

## Certainty: Partial

Architecture criteria are **EXISTS** (the `no-direct-node-io` + `no-direct-exit` tests and dep-cruiser rules already prove the plan's "ports-only / fakes-out-of-prod / exit-discipline" invariants). The behaviour criteria are overwhelmingly **BUILDABLE** with the framework already in place (vitest + golden fixtures + `Fake*` ports) — and the plan already front-loads them as test-first tasks. Two genuine soft spots keep this at Partial rather than Strong: the perf sensor is timing-fragile, and external Copilot-log drift is unsensable (mitigated, not proven).

## Recommended Phase 0: Establish Backpressure

> ⚠️ **Most of this is already in the plan.** Phase 1–4 are TDD with tests ordered before implementation, so the BUILDABLE sensors below are *already* the first task of each phase (cited). The survey's net-new value is the **two reshapes** marked ★ — pull them in now rather than discovering them mid-build.

| Sensor to build | Proves | Suggested form |
|-----------------|--------|----------------|
| ★ **Structural perf sensor** (replace/augment the <10ms wall-clock) | capture path does no full-transcript read — cursor-incremental only | a test asserting the adapter reads ≤ the windowed byte-range via `FakeFs` call inspection — deterministic, not timing-dependent (wall-clock assertions flake in CI) |
| ★ **PII/counts-only fixture guard** | real captured fixtures themselves carry no secrets/content | a check that golden fixtures match the counts-only schema (so a sloppy future fixture can't smuggle content past AC-04) — extends task 1.1 to the fixtures, not just the serializer |
| Counts-only serialization test | AC-04 (no content, repo-relative) | already task 1.1 — keep it first |
| Porcelain-unchanged test | AC-06 (PR-invisibility) | already task 1.7 — gitignore half already EXISTS |
| Exit-code fail-safety test | AC-01/AC-09 | already tasks 3.1/3.2 — consider pulling the exit-unchanged assertion earlier (the `no-direct-exit` arch test already guards the discipline) |
| Non-individual-author + no-identity-field test | AC-07/13 (§T1 governance) | already task 4.2/4.13 — this is the deterministic backstop for the §T1 decision |

## Suggested "done when" lines (advisory)

Paste-ready for whoever owns the plan's Done-When / DoD. Offered, not applied.

| For criterion | Suggested line | Backed by |
|---------------|----------------|-----------|
| AC-04 (privacy) | done when the counts-only serialization test **and** the fixture-guard are green | BUILDABLE (task 1.1 + ★) |
| service architecture (task 1.5) | done when `no-direct-node-io.test.ts` + dep-cruiser pass with the new `services/telemetry/` tree | **EXISTS** |
| AC-06 (PR-invisibility) | done when `git status --porcelain` is unchanged across a capture+flush test | EXISTS (gitignore) + BUILDABLE |
| AC perf (task 3.4) | done when the **structural** no-full-read sensor is green (prefer over a wall-clock threshold) | BUILDABLE ★ |
| AC-07/13 (§T1) | done when `FakeGitWrite` asserts a non-individual author and the segment schema test finds no per-individual field | BUILDABLE |

---

### Note — how this differs from a testing-alignment gate

This survey didn't check that test *tasks exist* (they do — the plan is TDD). It asked whether a deterministic **sensor covers each experienced failure mode** *before* building. The headline: the plan's riskiest invariants (privacy, PR-invisibility, exit-safety, architecture) are all sensor-backed — architecture already **EXISTS**, the rest are **BUILDABLE and front-loaded**. The only inferential residue (Copilot drift, doc quality, eng-thrive value) is legitimately inferential and either mitigated or out of scope.
