# Phase 1 Execution Log — dd-core foundations

## Task evidence

### T001 — Fixture corpus

- Added 23 real `.dd.json` fixtures plus a fixture schema and corpus README.
- Paired every ERROR class with a documented good twin; added all five
  workshop-001 WARN path classes.
- Added 3-hop and cyclic graphs for depth, stale-basis, ownership, and loop-breaker
  tests.
- Proof: `cd harness/cli && npx vitest run test/services/dd/fixture-corpus.test.ts`
  — 1 file / 2 tests passed.
- Domain: `harness-cli`; new test-only fixture corpus, no public contract change.

### T009 — Leaf rulings

- Froze id prefixes as `ph-`, `tk-`, `ac-`, `bp-`, `lg-`, and `dw-`; minted
  ids are `<prefix><4 lowercase hex>`, born once, and unique in a file.
- Selected the top-level ledger field name `references`.
- Rationale: the prefix/4-hex form is the approved compact address vocabulary;
  `references` is the shortest jq-friendly name and matches the workshop's
  "references ledger" language without encoding implementation detail.
- Proof: `cd harness/cli && npx vitest run test/services/dd/core/constants.test.ts`
  — 1 file / 2 tests passed.
- Domain: `harness-cli`; new dd-core public constants, consumed by parser,
  validator, and derived-state code in this phase.

### T002 — Document model and parser

- Added the generic flat-section model (`DdDoc`, section/value, instances,
  references, recursive schema shapes) used by every later phase.
- Added `parse(input) -> DdDoc | DdFailure[]`; JSON and envelope failures carry a
  stable class, JSON location, and message, while validator-invalid documents
  remain parseable.
- Proof: `cd harness/cli && npx vitest run test/services/dd/core/parse.test.ts test/services/dd/core/constants.test.ts`
  — 2 files / 6 tests passed.
- Domain: `harness-cli`; new dd-core contracts with no output, act, adapter, or
  Node imports.

### T003 — Address grammar

- Added parse/format/normalize for the locked `#` boundary and alternating
  schema-name/instance-id descent.
- Bare-`#` same-doc and explicit semantic ids round-trip; numeric positional ids
  and reserved `@` forms fail structurally.
- Proof: `cd harness/cli && npx vitest run test/services/dd/core/address.test.ts test/services/dd/core/parse.test.ts test/services/dd/core/constants.test.ts`
  — 3 files / 19 tests passed, including 250 generated canonical addresses and
  every workshop-001/addenda example.
- Domain: `harness-cli`; new pure dd-core address contract.

### T004 — Validation classes

- Added the injected `SchemaResolver` contract and hand-rolled depth-zero
  validation for section shapes, one-file id uniqueness, minted-id form, link
  grammar/type paths, built-in/custom enums, and per-state notes/receipts.
- Findings are structured `{class,severity,location,message,owner}` values and
  never envelopes or thrown exceptions.
- Proof: `cd harness/cli && npx vitest run test/services/dd/core/validate.test.ts test/services/dd/core/address.test.ts test/services/dd/core/parse.test.ts test/services/dd/core/constants.test.ts`
  — 4 files / 35 tests passed; all T001 ERROR fixtures report their exact class,
  all good twins have no ERROR findings, and the first three path classes remain
  WARN-only.
- Domain: `harness-cli`; new dd-core validation contract. P2 owns the real
  resolver and CLI activation.

### T005 — Depth walk and exclusions

- Added the injected `DocLoader` seam and breadth-first `validateWalk` with
  remaining-depth transitions, radius-infinity support, and visited document
  dedupe.
- Each visited document receives its own depth-zero validation; edge findings
  remain owned by the source that must fix its link/ledger, while a broken
  neighbour's health finding is owned by that neighbour.
- Sweep mode skips test fixture trees and `dd.sweep_exclude: true`; direct mode
  always validates.
- Proof: `cd harness/cli && npx vitest run test/services/dd` — 6 files / 43 tests
  passed. Depth 2 excludes the third-hop invalid document, depth 3 includes it;
  stale basis is found at hop 2; infinite cyclic traversal terminates; missing
  and untracked targets remain WARN-only.
- Domain: `harness-cli`; reusable validation-walk contract for P4 doctor.

### T010 — Derived state and rollup

- Added `deriveState(section, gateTerminal?)` with the workshop-002 default
  terminal set and schema-injected custom terminal sets.
- Added `deriveRollup` for pre-resolved cross-file trees; task evidence rolls
  through phase and plan without copying state.
- Proof: `cd harness/cli && npx vitest run test/services/dd` — 7 files / 46 tests
  passed, including a two-file plan/tasks rollup.
- Domain: `harness-cli`; new pure state contract consumed later by P3 render and
  P6 flow gating.

### T006 — E400-E449 freeze

- Allocated all 50 codes exactly once across core/validate, schema/docs,
  render/adapters, links/doctor, and flow-gate sub-ranges.
- Every code has a final conservative failure-class name and JSDoc; later phases
  fill behavior without editing this table.
- Proof: `cd harness/cli && npx vitest run test/services/dd/error-codes.test.ts`
  — 1 file / 1 test passed, asserting the named map is exactly contiguous
  `E400` through `E449`.
- Domain: `harness-cli`; public error contract frozen for Phases 2-6.

### T007 — Full act surface and manifest

- Added all nine dd act-family files plus the shared exit helper and index
  registration; `app.ts` has one `registerDdAct` call and extensions reserve
  `dd`.
- Froze 13 leaf signatures in `dd-surface.md`; all bodies, including validate,
  are honest `unconfigured`/exit 2 stubs naming their owner phase.
- Leaf ruling: `address generate` accepts `<interior>` plus optional `--path`;
  omission is the bare-`#` form. This maps directly to the closed grammar without
  duplicating it as multiple flags.
- Preserved Phase 4 extension space as RESERVED rows for doctor scope, graph
  emission/scope, and explicit basis re-verification mutation semantics.
- Proof: `cd harness/cli && npx vitest run test/acts/dd.test.ts test/acts/dd-surface.test.ts test/services/dd`
  — 10 files / 76 tests passed. `npx tsc -p harness/cli/tsconfig.json` passed;
  `node harness/cli/bin/harness.js dd --help` showed all nine top-level families.
- Domain: `harness-cli`; frozen public command contract for Phases 2-4.

### T008 — dd-core isolation

- Added dependency-cruiser rules forbidding dd-core imports from output, acts,
  and all harness adapters.
- Added an architecture test that first proves a synthetic output/act/adapter
  violation is detected, then walks every real dd-core import and requires zero
  offenders (including `node:` builtins).
- Proof: the targeted dd/architecture slice passed 11 files / 78 tests.
  `harness arch-check` exited 0 with the standing baseline of exactly 2 unrelated
  `services-ports-type-only` warnings and no dd-core violations.
- Domain: `harness-cli`; machine-enforced extraction boundary.

## Discoveries & decisions

| Date | Task | Type | Discovery | Resolution | References |
|---|---|---|---|---|---|
| 2026-08-03 | T001 | Noteworthy | The ruled exclusion prose says `**/test/fixtures/**`, while the fenced corpus must live at `test/services/dd/fixtures/**`. | The core exclusion predicate will recognize fixture directories nested anywhere under `test/`, preserving the intended corpus exclusion without moving outside the fence. | `tasks.md` T001/T005 |
| 2026-08-03 | Phase | Noteworthy | The agent environment injects `safe.bareRepository=explicit` via `GIT_CONFIG_COUNT`, breaking the suite's implicit bare-repo fixture; unrestricted parallelism also pushed the unrelated docs pipe test over its 5-second timeout. | Captured as harness observation `DL-003`; full proof removed only the injected Git config entries and set `VITEST_MAX_WORKERS=4`, leaving the exact `just test` recipe/test set/coverage unchanged. | Full-suite proof below |

## Phase-complete proof

- Required slice: `cd harness/cli && npx vitest run test/services/dd` — 8 files /
  47 tests passed.
- Changed-surface suite: dd services/acts/manifest/architecture plus authorized
  composition-root and error-table expectations — 14 files / 113 tests passed.
- Architecture: `harness arch-check` exited 0 with exactly the standing 2
  unrelated `services-ports-type-only` warnings and zero dd-core violations.
- Local build: `npx tsc -p harness/cli/tsconfig.json` passed.
- CLI surface: `node harness/cli/bin/harness.js dd --help` showed validate,
  schema, docs, build, address, link, links, graph, and doctor; act tests prove
  all 13 leaves return `unconfigured`/exit 2 with the owning phase.
- Full suite:
  `env -u GIT_CONFIG_COUNT -u GIT_CONFIG_KEY_0 -u GIT_CONFIG_VALUE_0 -u GIT_CONFIG_KEY_1 -u GIT_CONFIG_VALUE_1 VITEST_MAX_WORKERS=4 just test`
  — 238 files / 3,274 tests passed; coverage 88.67% statements, 79.12% branches,
  91.46% functions, 91.24% lines.
- Formatting: `just fix` passed with no remaining findings.
- Task closure: T001-T010 are all `[x]`; no `TODO`/`FIXME`/`HACK` markers were
  introduced.

Phase 1 acceptance is met: the pure dd-core foundation, frozen errors/acts,
fixture corpus, derived state, and machine-enforced isolation boundary are ready
for Phase 2 without any Phase 2-6 implementation present.
