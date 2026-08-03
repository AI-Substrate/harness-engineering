# Backpressure Coverage — Deterministic Documents (dd)

**Plan**: [deterministic-documents-plan.md](./deterministic-documents-plan.md)
**Basis (plan SHA-256)**: e1318b51944ac6f51fd2a5ac49cbbd05b5d2f047cde07f5d925277b356f98c0a (v1.1.1 — task 6.6 added)
**Generated**: 2026-08-03 (re-selected against plan v1.1.0 — post-Opus-validation; graph now P1→P2→(P3∥P4)→P5→P6)
**Certainty**: Partial

> Advisory only. Never blocks, never gates, no scores. (Advisory backpressure survey.)
> Selection, not enforcement: nothing here executes at phase end — the proof lines
> below are what the plan's owner folds into each criterion's "done when".

## Existing Sensors (inventory)

| Sensor | Paved command | Dimension | Found in |
|--------|---------------|-----------|----------|
| full unit/arch suite + coverage (vitest, 227 files) | `just test` | behaviour + architecture | root recipe → `harness/cli` |
| targeted suite slice (per-fence proof) | `npx vitest run <dir>` (from `harness/cli/`) | behaviour | `harness/cli/vitest.config.ts` |
| architecture conformance tests (no-direct-exit, no-direct-node-io, …) | inside `just test` (`test/architecture/*`) | architecture-fitness | `harness/cli/test/architecture/` |
| dependency-cruiser rules (baseline 2) | `harness arch-check` | architecture-fitness | `.dependency-cruiser.cjs` |
| composed quality gate (biome, drift checks, md-lint 199 baseline, arch) | `harness checks` / `just checks` | all | `.harness/extensions/checks/` |
| generated-content drift guards | `npm run check:docs` · `npm run check:flows` | maintainability | root `package.json` scripts |
| layer health | `harness doctor --json` | maintainability | core CLI |
| CI PR gate (biome + suite) | `.github/workflows/*` | all | root |

## Coverage Matrix

| Criterion / failure mode | Phase | Selected proof | Status | Tier | Probe trail |
|--------------------------|-------|----------------|--------|------|-------------|
| AC-01 validate: every issue class catches its known-bad fixture | 1 | EXTEND→RUN: add `test/services/dd/{core,validate}` suites over the 1.1 corpus; then `npx vitest run test/services/dd` → `just test` | EXTEND | computational | — |
| AC-02 schema resolution precedence + clash/shadow diagnostics | 2 | EXTEND→RUN: `test/services/dd/schema` suites (fake-fs multi-root fixtures); then `npx vitest run test/services/dd/schema` | EXTEND | computational | — |
| AC-03 render sibling regen + `--check` drift E-code | 3 | EXTEND→RUN: `test/services/dd/render` golden-file + drift suites; then `npx vitest run test/services/dd/render` | EXTEND | computational | — |
| AC-04 adapter fallback + loud build warnings | 3 | EXTEND→RUN: throwing/missing-adapter fixtures asserting envelope warnings; same slice command | EXTEND | computational | — |
| AC-05 address generate/validate/resolve round-trip | 1+4 | EXTEND→RUN: property tests `parse(format(x))≡x` + resolver failure classes; `npx vitest run test/services/dd/{core,links}` | EXTEND | computational | — |
| AC-06 ledger live/pinned + verify-basis fresh→stale flip | 4 | EXTEND→RUN: sha-mutation fixtures; `npx vitest run test/services/dd/links` | EXTEND | computational | — |
| AC-07 doctor sweep terminates on cyclic fixture; checks picks dd up OOTB | 4+5 | EXTEND→RUN: cyclic-graph fixture suite; then extend checks extension (5.3) and prove with `harness checks` end-to-end | EXTEND | computational | — |
| AC-08 dd docs list/get + baked-content drift | 2 | EXTEND→RUN: `check:dd-docs` script (mirrors `check:docs` wiring) + acts suite; `npm run check:dd-docs` | EXTEND | computational | — |
| AC-09 exemplar corpus validates/renders/jq-queryable | 5 | EXTEND→RUN: e2e vitest case running `dd validate`+`build --check`+a real `jq` query over `exemplar/**` via exec port; `npx vitest run test/acts/dd` | EXTEND | computational | — |
| AC-10 gate refusal matrix (refuse/`--force`/skip/na/blocked) | 6 | EXTEND→RUN: gate suite in `test/services/flow` + `test/acts/flow`; `npx vitest run test/services/flow` | EXTEND | computational | — |
| AC-11 orient/rail/render gate surfacing + basis-drift warning | 6 | EXTEND→RUN: orient/rail snapshot cases in the same flow suites | EXTEND | computational | — |
| AC-12 dd-core isolation (no output/acts/node-* imports) | 1 | EXTEND→RUN: new depcruise rules + `test/architecture/dd-core-isolation.test.ts`; `harness arch-check` + `just test` | EXTEND | computational | — |
| Failure mode: parallel-phase cross-fence coupling (P3/P4 secretly interdependent — the v1.0.0 four-way graph already fell to this once, Opus F1) | 3–4 | EXTEND→RUN: each fence's slice must go green **in isolation** — `npx vitest run test/services/dd/<fence-dir>` with only that phase's files present; join proof at P5 is full `just test` + `harness checks` | EXTEND | computational | — |
| AC-13 derived state + cross-file rollup correct | 1 | EXTEND→RUN: `test/services/dd/core` derive + cross-file fixtures; `npx vitest run test/services/dd` | EXTEND | computational | — |
| AC-14 links/graph family (inbound scan, mermaid emit) | 4 | EXTEND→RUN: fixture-corpus cases in `test/services/dd/links`; same slice command | EXTEND | computational | — |
| AC-15 checks green with known-bad fixture corpus present (exclusion contract) | 1+4+5 | EXTEND→RUN: sweep-mode exclusion cases + the P5 recorded `harness checks` run over the real repo | EXTEND | computational | — |
| Failure mode: global-CLI skew (worktree can't rebuild root dist) | all | RUN: in-worktree `npx tsc -p harness/cli/tsconfig.json && node harness/cli/bin/harness.js dd --help` (never `npm link`); final global proof deferred to convergence (prime's PR flow) | EXISTS | computational | — |
| Exemplar uses primitives *cleverly* and renders well for humans | 5 | — (review by Jordan/PM against workshop-002 shapes) | ABSENT | human-judgement | judgement row by design — no glob applies; the mechanical half (shape conformance) rides AC-09 |
| Docs plain-first quality (outsider-readable) | 2+5 | — (human read; md-lint covers mechanics only) | ABSENT | human-judgement | judgement row by design |

## Proof Plan (selected)

**The parallel-fence rule (Jordan's ask, answered):** every fanned-out coder proves *done* inside its own fence with a slice command that needs nothing from sibling phases; the joins re-prove the whole. Concretely:

### Phase 1 (join root)
| Proves | Mode | Proof line |
|--------|------|------------|
| AC-01, AC-05(parse), AC-12 | EXTEND→RUN | write `test/services/dd/{core,validate}` + arch test; then `npx vitest run test/services/dd && harness arch-check` |

### Phase 2 (sequential — the second foundation)
| Proves | Mode | Proof line |
|--------|------|------------|
| AC-02, AC-08(list/get) | EXTEND→RUN | `npx vitest run test/services/dd/schema test/services/dd/docs && npm run check:dd-docs` — green with P3/P4 absent |

### Phase 3 ∥ (fence: render+adapters)
| Proves | Mode | Proof line |
|--------|------|------------|
| AC-03, AC-04 | EXTEND→RUN | `npx vitest run test/services/dd/render` — green with P2/P4 absent |

### Phase 4 ∥ (fence: links+doctor)
| Proves | Mode | Proof line |
|--------|------|------------|
| AC-05(resolve), AC-06, AC-07(doctor) | EXTEND→RUN | `npx vitest run test/services/dd/links test/services/dd/doctor` — green with P2/P3 absent |

### Phase 5 (fan-in)
| Proves | Mode | Proof line |
|--------|------|------------|
| AC-09, AC-07(checks) + integration of 2+3+4 | EXTEND→RUN | full `just test` + `harness checks` + recorded exemplar run (`dd validate && dd build --check && dd doctor` + jq demo) |

### Phase 6 (terminal)
| Proves | Mode | Proof line |
|--------|------|------------|
| AC-10, AC-11 | EXTEND→RUN | `npx vitest run test/services/flow test/acts/flow` then full `just test` |
| 6.6 dog-food (deterministic lens) | EXTEND→RUN | temp-dir e2e suite (scaffold→link→refuse→`--force`→drift→verify-basis→orient/rail) inside `just test` |
| 6.6 dog-food (inference lens) | — | human-judgement row by design: agent-operated walkthrough; findings note in execution.log.md (≥1 observation or defended "none") |

## Certainty: Partial

Counts (behaviour/architecture rows): 1 RUN · 16 EXTEND · 0 BUILD · 0 ABSENT
Recommended next move (per-task lookup, advisory): any-EXTEND → propose the extensions first — **and every extension is already a named plan task** (1.1, 1.6, 2.5, 3.5, 4.5, 5.5, 6.5), so the plan as written IS the extension proposal.

Rationale: no behaviour/architecture criterion lacks a sensor *class* — everything rides the existing vitest/arch-check/checks wiring via test tasks the plan already front-loads (Hybrid TDD); nothing needs a Phase-0 build.

## Recommended Phase 0: Establish Backpressure (build or extend)

Routing trigger fires (EXTEND rows exist) but **no Phase 0 is recommended**: every extension is already embedded in the plan as that phase's test task, landing in proven homes (`just test`, `harness arch-check`, `harness checks`, `check:*` scripts). Building a separate Phase 0 would duplicate the plan's own TDD structure.

## Closing Verdict

How will we know this work is actually done? Almost entirely by commands, and the plan was built that way on purpose. Every promise in the plan — validation catching bad documents, schema lookup picking the right file and shouting about shadowed ones, rendered markdown never drifting from its source, adapters failing loudly instead of silently, addresses round-tripping, staleness detection flipping when an upstream doc changes, the doctor never looping forever, and the flow refusing to move past unfinished work unless someone explicitly forces it — each has a test suite named as a task in its own phase, riding commands this repo already runs every day. When those pass, those promises are kept — no judgement calls.

One thing I already did, automatically: wrote the per-phase proof commands into this coverage artifact — including the rule your parallel work needs: **each fanned-out coder's fence has its own slice command that must go green with the sibling phases absent**, and the two join phases re-prove the whole with the full suite and the composed checks gate. Whoever picks up a phase sees exactly what green means for *their* fence, even after this conversation is gone.

Two things no command can judge, named honestly: whether the exemplar plan uses the document primitives *cleverly* (your standing constraint) and whether the docs read well to an outsider. Those stay with human eyes — the mechanical halves (shape conformance, lint) are covered, the taste halves are yours.

And the standing rule if we ever disagree with a green run: if the checks pass but a human says it's not done, the checks are wrong — we fix the checks first, then the code, so that gap can never slip through again.

In summary: the commands will prove every machine-checkable promise, phase by phase and fence by fence; human judgement remains only on exemplar elegance and doc readability; the recommended next move is simply to build in the plan's own order since the proof tasks are already embedded — no separate approval needed beyond the plan itself.
