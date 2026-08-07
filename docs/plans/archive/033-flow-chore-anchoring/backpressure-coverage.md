# Backpressure Coverage — flow-chore-anchoring (plan 033)

**Spec**: [flow-chore-anchoring-plan.md](./flow-chore-anchoring-plan.md) § Business Specification
(the-flow ships a unified plan doc — no separate `<slug>-spec.md`; surveyed against its
`## Acceptance Criteria`, `## Target Domains`, `## Risks & Assumptions`)
**Generated**: 2026-06-23
**Certainty**: Partial

> Advisory only. Never blocks, never gates, no scores. (Advisory backpressure survey.)

## Existing Sensors (inventory)

Probed root + `harness/cli/` (the only workspace). Discovered on disk (not from docs):

| Sensor | Command | Dimension | Found in |
|--------|---------|-----------|----------|
| CLI unit tests (vitest) | `just test` / `cd harness/cli && npx vitest run --coverage` | behaviour | `harness/cli/` (37+ test files) |
| Type check | `npm run build` (`tsc -p harness/cli/tsconfig.json`) | maintainability + behaviour | root |
| Lint | `npm run lint` (`biome check harness/cli`) | maintainability | root |
| **Flow schema/fixture drift** | `npm run check:flows` (`gen:flows` + `git diff` + `flow-fixtures --check`) | behaviour (contract) | root |
| Flow render drift | `harness flow render --check` | behaviour (contract) | CLI verb |
| Docs-sync drift | `npm run check:docs` (`gen:docs` + `git diff docs-content.ts`) | maintainability | root |
| Markdown lint (warn-launch) | `just lint-md` (`harness markdown-lint`) | maintainability (docs) | CLI verb |
| Windows-compat lint (warn-launch) | `just windows-check` | architecture-fitness | CLI verb |
| the-flow eval harness (minih + scorer) | `minih run` + `scripts/score-flow-eval.sh` | behaviour | cross-repo (the-flow, plan 027) |

Signature probe trail: globbed `**/vitest.*.config.*` (hit: `harness/cli`), `**/*.test.ts` (hit),
`justfile`/`package.json` scripts (hit), `**/*.schema.json` + `gen-flows`/`flow-fixtures` (hit:
`check:flows`). No `**/playwright.config.*` / `**/cypress.config.*` / `connectOverCDP` (this is a CLI,
no browser tier — correctly absent).

## Coverage Matrix

| Criterion / failure mode | Deterministic sensor | Status | Tier | Probe trail (req. if ABSENT) |
|--------------------------|----------------------|--------|------|------------------------------|
| AC-01 anchored injection (non-null `anchor` + connected render) | fixture: `harness flow chores`→anchor≠null + `render` shows dotted edge | BUILDABLE | computational | — (planned task 2.4) |
| AC-02 `chores --at <node>` filters by anchor | vitest unit on the filter | BUILDABLE | computational | — (planned task 1.3) |
| AC-03 `nav show` `due_chores` ChoreRow shape | vitest unit asserting the row shape | BUILDABLE | computational | — (planned task 1.3) |
| AC-04 injection idempotent (byte-identical) + R-1 | fixture: re-run byte-compare; set-node no-op (FT-001) | BUILDABLE | computational | — (set-node no-op already EXISTS; add/insert path is new) |
| AC-05 hook→anchor map total + fallback | fixture: assert each hook's anchor == map (incl. phase-absent fallback) | BUILDABLE | computational | — (planned task 2.4) |
| AC-06 eng-harness-flow wording stays flow-agnostic | (no deterministic sensor for semantic "no context-wide prohibition") | ABSENT | inferential | globbed `markdown-lint` rules + biome — no semantic-wording sensor; reviewed by hand |
| AC-07 the-flow surfaces `due_chores` each turn | the-flow eval harness (minih + scorer gate) | BUILDABLE | computational | — (planned task 3.3; cross-repo) |
| Failure mode: CLI change breaks bundled flow schema/fixtures | `npm run check:flows` | EXISTS | computational | — |
| Failure mode: render output drifts | `harness flow render --check` | EXISTS | computational | — |
| Failure mode: type/lint regressions | `tsc` + `biome check` | EXISTS | computational | — |

## Certainty: Partial

5 of 6 behaviour/contract criteria (AC-01..05) are **BUILDABLE** — no sensor exists yet, but each is
specifiable, and the plan **already specifies the exact test/fixture tasks** (1.3, 2.4, 3.3). The
repo has strong EXISTS scaffolding to host them (vitest harness, `check:flows`, `render --check`,
`tsc`, `biome`). AC-06 (flow-agnostic wording) is legitimately **inferential** and does not drag the
rating. Hence Partial, trending Strong the moment the planned tests land.

## Recommended Phase 0: Establish Backpressure

The plan is **self-covering** — its own Phase 1/2 test tasks ARE the backpressure to build. No
separate Phase 0 is needed; this table just makes the mapping explicit.

| Sensor to build | Proves | Suggested form |
|-----------------|--------|----------------|
| Injection fixture (`chores`→anchor≠null + `render` dotted edge) | AC-01, AC-05 | golden/fixture test in `harness/cli` or a `scripts/` check on a sample the-flow.json |
| `chores --at` + `nav show due_chores` unit tests | AC-02, AC-03 | vitest unit (flow-mutations + act) |
| Idempotency byte-compare | AC-04 | fixture: inject twice, `diff` the JSON |
| the-flow eval gate "due hook surfaced at its node" | AC-07 | extend `scripts/score-flow-eval.sh` (cross-repo) |

## Suggested "done when" lines (advisory)

| For criterion | Suggested line | Backed by |
|---------------|----------------|-----------|
| AC-01 | done when the injection fixture reports non-null `anchor` for all four hooks AND `harness flow render` shows a dotted edge (no floating box) | BUILDABLE |
| AC-02 | done when `harness flow chores --at <node>` unit asserts only that node's chores | BUILDABLE |
| AC-04 | done when a second injection produces a byte-identical `the-flow.json` | BUILDABLE |
| AC-06 | (thin — inferential) reviewed by hand for context-wide prohibitions; no deterministic sensor | thin — needs review |

## Note — survey vs gate

This is the **computational** tier pulled to design time: *can plan 033's work be proven by sensors,
and if not, build the sensor first?* It does not replace after-the-fact review (AC-06's wording check
stays human/AI). The headline: 033's behaviour is highly provable and the plan already front-loads its
own proof — strong backpressure posture for a CLI/skill change.
