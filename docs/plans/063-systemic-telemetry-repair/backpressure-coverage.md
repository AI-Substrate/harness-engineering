# Backpressure Coverage — Systemic Telemetry Repair: Token Recovery

**Plan**: [systemic-telemetry-repair-plan.md](./systemic-telemetry-repair-plan.md)
**Basis (plan SHA-256)**: d8a6dcde37ad956466fee3dc8ffec2aa88015dc2ac194f6d406d686f361742bb
**Generated**: 2026-07-21
**Certainty**: Partial

> Advisory only. Never blocks, never gates, no scores. (Advisory backpressure survey.)
> Selection, not enforcement: nothing here executes at phase end—the proof lines below are what the plan owner folds into each task's Done When.

## Existing Sensors (inventory)

| Sensor | Paved command | Dimension | Found in |
|---|---|---|---|
| Targeted Vitest with coverage | `npm test -- <test paths>` | behaviour | root `package.json`; `harness/cli/vitest.config.ts` |
| Full CLI and extension suite | `just test` | behaviour | root `justfile`; `.harness/engineering-harness.md` |
| Composite repository gate | `just checks` | maintainability + architecture-fitness + behaviour | root `justfile`; `.github/workflows/ci.yml` |
| Documentation drift guard | `npm run check:docs` | maintainability | root `package.json` |
| Telemetry fixture drift guard | `npm run check:telemetry-fixtures` | behaviour + data integrity | root `package.json` |
| Telemetry publication/privacy tests | `npm test -- test/services/telemetry/publication-boundary.test.ts test/services/telemetry/fixture-privacy-scan.test.ts` | security + data integrity | `harness/cli/test/services/telemetry/` |
| Architecture tests | `npm test -- test/architecture/no-direct-node-io.test.ts test/architecture/no-direct-exit.test.ts` | architecture-fitness | `harness/cli/test/architecture/` |
| Schema and OTLP reconstruction tests | `npm test -- test/services/telemetry/segment-schema.test.ts test/services/telemetry/otlp/reconstruction.test.ts` | contract integrity | `harness/cli/test/services/telemetry/` |
| Private historical replay | — | behaviour + integration | No authorized paved command exists yet; a born-closed execution packet is required before access or execution. |

Workspace probe: root `package.json` owns the TypeScript workspace; the implementation/test root is `harness/cli/`. Recursive discovery found root and CLI Vitest configs, telemetry unit/integration/e2e tests, closed JSON schemas, `just` recipes, and the CI composite gate. No Playwright or Cypress surface is relevant to this CLI-only work.

## Coverage Matrix

| Criterion / failure mode | Phase | Selected proof | Status | Tier | Probe trail (required if ABSENT) |
|---|---|---|---|---|---|
| Bounded standard-Claude lookup rejects missing, duplicate, unresolved, traversing, symlinked, oversized, and malformed candidates (AC-01) | 1 | EXTEND→RUN: add locator, Git-candidate, and no-follow filesystem cases; then `npm test -- test/services/telemetry/claude-adapter.test.ts test/services/telemetry/capture-service.test.ts test/adapters/git/fake-git.test.ts test/adapters/git/exec-git.test.ts test/adapters/fs/fake-fs.test.ts test/adapters/fs/node-fs.test.ts` | EXTEND | computational | — |
| Current Copilot observations remain distinct and never double-count unlike kinds; valid final is authoritative (AC-02) | 1 | EXTEND→RUN: add current message/checkpoint/compaction/final mutations; then `npm test -- test/services/telemetry/copilot-adapter.test.ts test/services/telemetry/copilot-events.test.ts test/services/telemetry/copilot-ledger.test.ts` | EXTEND | computational | — |
| Typed usage survives the closed segment schema and OTLP round trip losslessly | 1 | EXTEND→RUN: extend the usage event schema and reconstruction cases; then `npm test -- test/services/telemetry/segment-schema.test.ts test/services/telemetry/otlp/reconstruction.test.ts test/services/telemetry/events-rollup.test.ts` | EXTEND | computational | — |
| Services keep filesystem/Git/process I/O behind ports | 1 | RUN: `npm test -- test/architecture/no-direct-node-io.test.ts test/architecture/no-direct-exit.test.ts` | EXISTS | computational | — |
| Measured live/ref/ledger fields merge by evidence quality and preserve scalar source compatibility (AC-03) | 2 | EXTEND→RUN: add empty-ref-versus-measured-ledger and per-field provenance cases; then `npm test -- test/services/telemetry/session-evidence.test.ts test/services/telemetry/ref-source.test.ts test/services/telemetry/fleet-evidence.test.ts test/services/telemetry/fleet-golden-051.test.ts` | EXTEND | computational | — |
| Token reads survive sync/prune and missing joins remain unavailable (AC-04) | 2 | EXTEND→RUN: add buffer-pruned ref reconstruction and unavailable-join cases; then `npm test -- test/services/telemetry/session-evidence.test.ts test/services/telemetry/session-export.test.ts test/services/telemetry/ref-source.test.ts test/services/telemetry/buffer-prune.test.ts test/acts/telemetry.test.ts` | EXTEND | computational | — |
| Zero and partial token coverage produce closed reasons, unknown cause, degraded envelopes, and no false zero/ok (AC-05) | 2 | EXTEND→RUN: extend report/schema/HTML/sweep/act cases; then `npm test -- test/services/telemetry/report.test.ts test/services/telemetry/report-html.test.ts test/services/telemetry/sweep-act.test.ts test/acts/telemetry.test.ts` | EXTEND | computational | — |
| P060 remote `ls`/`pull`, bundle integrity, selection, and envelopes do not regress | 2 | RUN: `npm test -- test/acts/telemetry.test.ts test/services/telemetry/remote-telemetry-service.test.ts test/services/telemetry/remote-selection.test.ts test/services/telemetry/telemetry-bundle.test.ts test/services/telemetry/telemetry-bundle-reader.test.ts` | EXISTS | computational | — |
| Immutable real cases prove current RED and repaired GREEN under the historical fence, including post-prune and source conflict (AC-06) | 1 + 3 | BUILD→RUN: separately authorize a born-closed replay execution packet that verifies identities, exposes only opaque/numeric outputs, and supplies one exact private local command; run that packet command before product changes for RED and after Phase 2 for GREEN | BUILDABLE | computational | — |
| Sanitized fixtures are derived only after real GREEN and remain drift/privacy clean (AC-07) | 3 | EXTEND→RUN: after real GREEN, add minimized fixture cases; then `npm run check:telemetry-fixtures` and `npm test -- test/services/telemetry/fixture-privacy-scan.test.ts` | EXTEND | computational | — |
| Standard-Claude measured controls and counts-only publication remain compatible (AC-08) | 1 + 2 + 3 | EXTEND→RUN: retain measured-control and publication mutations; then `npm test -- test/services/telemetry/claude-adapter.test.ts test/services/telemetry/claude-events.test.ts test/services/telemetry/publication-boundary.test.ts` | EXTEND | computational | — |
| Promoted public fixture bytes contain nothing sensitive or embarrassing | 3 | Manual end-to-end review of the exact promoted bytes, after automated scrub and byte scan | ABSENT | human-judgement | Probed root + `harness/cli/` for automated privacy/schema/fixture sensors; they cannot judge unanticipated sensitive prose, and `docs/how/telemetry-fixtures.md` explicitly retains the non-skippable human review. |

## Proof Plan (selected)

### Phase 1: Safe Capture and Typed Usage

| Proves | Mode | Proof line |
|---|---|---|
| Private oracle is usable and current implementation is RED (AC-06) | BUILD→RUN | Separately approve the born-closed replay packet; then run its exact authorized private local command in RED mode before any product edit. |
| Bounded Claude locator (AC-01) | EXTEND→RUN | Add locator/Git/filesystem boundary tests; then run `npm test -- test/services/telemetry/claude-adapter.test.ts test/services/telemetry/capture-service.test.ts test/adapters/git/fake-git.test.ts test/adapters/git/exec-git.test.ts test/adapters/fs/fake-fs.test.ts test/adapters/fs/node-fs.test.ts`. |
| Typed Copilot observations (AC-02) | EXTEND→RUN | Add kind/precedence/mutation cases; then run `npm test -- test/services/telemetry/copilot-adapter.test.ts test/services/telemetry/copilot-events.test.ts test/services/telemetry/copilot-ledger.test.ts`. |
| Closed usage transport | EXTEND→RUN | Extend schema/OTLP/rollup cases; then run `npm test -- test/services/telemetry/segment-schema.test.ts test/services/telemetry/otlp/reconstruction.test.ts test/services/telemetry/events-rollup.test.ts`. |
| Ports-and-adapters boundary | RUN | `npm test -- test/architecture/no-direct-node-io.test.ts test/architecture/no-direct-exit.test.ts`. |
| Phase-wide regression | RUN | `just test`, then `just checks` at the completed phase gate. |

### Phase 2: Durable Evidence and Truthful Readers

| Proves | Mode | Proof line |
|---|---|---|
| Per-field evidence quality and compatibility (AC-03) | EXTEND→RUN | Extend session/ref/fleet tests; then run `npm test -- test/services/telemetry/session-evidence.test.ts test/services/telemetry/ref-source.test.ts test/services/telemetry/fleet-evidence.test.ts test/services/telemetry/fleet-golden-051.test.ts`. |
| Post-sync/prune tokens (AC-04) | EXTEND→RUN | Add teardown cases; then run `npm test -- test/services/telemetry/session-evidence.test.ts test/services/telemetry/session-export.test.ts test/services/telemetry/ref-source.test.ts test/services/telemetry/buffer-prune.test.ts test/acts/telemetry.test.ts`. |
| Honest public state (AC-05) | EXTEND→RUN | Add state/reason/envelope cases; then run `npm test -- test/services/telemetry/report.test.ts test/services/telemetry/report-html.test.ts test/services/telemetry/sweep-act.test.ts test/acts/telemetry.test.ts`. |
| P060 remains intact | RUN | `npm test -- test/acts/telemetry.test.ts test/services/telemetry/remote-telemetry-service.test.ts test/services/telemetry/remote-selection.test.ts test/services/telemetry/telemetry-bundle.test.ts test/services/telemetry/telemetry-bundle-reader.test.ts`. |
| Phase-wide regression | RUN | `just test`, then `just checks` at the completed phase gate. |

### Phase 3: Real Replay and CI Fixture Promotion

| Proves | Mode | Proof line |
|---|---|---|
| Real repaired semantics are GREEN (AC-06) | BUILD→RUN | Reauthorize the born-closed packet and identities; then run its exact authorized private local command in GREEN mode. |
| Sanitized fixture fidelity/privacy (AC-07) | EXTEND→RUN | Only after real GREEN, derive minimized fixtures; then run `npm run check:telemetry-fixtures` and `npm test -- test/services/telemetry/fixture-privacy-scan.test.ts`. |
| Counts-only compatibility (AC-08) | EXTEND→RUN | Run measured-control and publication cases, then `just checks`. |
| Human publication boundary | ABSENT | Manually review the exact promoted fixture bytes after automated checks and before commit. |

## Certainty: Partial

Counts (behaviour/architecture rows): 2 RUN · 8 EXTEND · 1 BUILD · 0 ABSENT
Recommended next move (per-task lookup, advisory): extend the existing test/schema sensors first, and establish the risk-linked born-closed private replay command before feature code.

Existing Vitest, schema, architecture, privacy, and composite gates cover every machine-checkable contract after targeted extensions; the private historical replay is the only new deterministic sensor required.

## Recommended Phase 0: Establish Backpressure (build or extend)

| Sensor to build/extend | Proves | Suggested form | Paved command it strengthens/exposes |
|---|---|---|---|
| Extend current telemetry unit/schema suites | AC-01, AC-02, AC-03, AC-04, AC-05, AC-08 | Add mutation-defended cases to the named existing Vitest files; no new runner | `npm test -- <named telemetry test paths>` |
| Born-closed private replay sensor | AC-06 and the source-conflict/post-prune risks | Separately approved execution packet: exact corpus identities, read-only inputs, opaque/numeric output schema, historical fence, RED/GREEN modes, one exact private local command, no raw logging or worker access | packet-defined exact command (not guessed or stored in tracked artifacts) |
| Extend fixture drift/privacy sensors after real GREEN | AC-07 | Minimized sanitized cases plus existing generated-golden and byte-scan gates | `npm run check:telemetry-fixtures`; `npm test -- test/services/telemetry/fixture-privacy-scan.test.ts` |

## Closing Verdict

One thing I already did, automatically: I selected the exact existing test, schema, architecture, privacy, and composite commands that will prove each machine-checkable promise, so completion is based on command output rather than an opinion.

One thing that still needs Jordan's separate OK: create and run a born-closed private replay packet before product code, because the real historical RED baseline and later GREEN result have no safe paved command today; if any selected checker passes while the observed contract is still wrong, fix the checker first and then the code so that blind spot cannot recur.

The only irreducible human call is the mandatory review of sanitized fixture bytes before publication; automation cannot recognize every sensitive or embarrassing phrase.

In summary: existing sensors become sufficient after eight focused extensions, while one separately gated private replay sensor proves the real-session contract. Approve only the born-closed replay packet and its proposed local command now; Phase 1 product work remains stopped until that gate is satisfied.
