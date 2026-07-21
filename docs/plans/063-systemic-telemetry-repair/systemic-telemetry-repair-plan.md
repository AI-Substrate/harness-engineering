# Systemic Telemetry Repair — Token Recovery
**Mode**: Full
**Plan Version**: 1.0.1
**Created**: 2026-07-21
**Status**: READY
**Spec source**: unified (this file)

## Business Specification

### Research Context

📚 Incorporates findings from `research-dossier.md` and the official-source boundary in `research/official-claude-session-storage.md`.

The dossier proved a non-vacuous private oracle: five opaque Copilot cases have vendor token evidence while their matched durable Harness refs are token-dark, and two standard-Claude cases are measured durable-ref controls. P060 landed on `main` at `562a2255fc8c470aabd068ee6198d41e2d45ead8`; the atomic Plan was committed as `26f4eb094100471ad8feb806098c2c4b25e18230` and converged by merge `c3ec0cef2dbd42b8c5058df8db176f143e2187bd`. The converged `harness/cli`, `docs/how`, and `docs/project-rules` trees are byte-identical to landed main562, so the original source findings remain current.

### Summary

Repair token evidence end to end without broadening into every telemetry defect. Standard Claude transcript lookup becomes bounded and worktree-aware; current Copilot events become typed usage observations; durable readers merge evidence per field by quality; and every public reader exposes missing or partial token coverage as degraded with a closed reason. The preserved real historical sessions remain the mandatory RED→GREEN oracle, and minimized public fixtures are derived only after that replay is green.

### Goals

1. Locate standard-Claude transcripts through a safe, bounded current-project and known-worktree candidate set.
2. Parse current Copilot message, checkpoint, compaction, and shutdown usage as distinct observation kinds without adding unlike kinds.
3. Let measured vendor evidence supplement or outrank empty durable refs per token field while preserving compatibility.
4. Keep session and fleet token reads available after sync/prune removes live buffers.
5. Make zero or partial token coverage publicly degraded with an explicit evidence reason and `cause: unknown` unless authoritative.
6. Prove the repair on the immutable private real-session corpus before deriving minimized sanitized CI fixtures.

### Non-Goals

- Turn-duration joining, nullable duration, duration reasons, or duration schema migration.
- Full model interval or contradictory model-observation provenance.
- Plan-attribution persistence across ref rewrites.
- Broad lifecycle-cause or outcome semantics; shutdown/reconciliation qualifiers remain observation-mechanism metadata only.
- Adopted-seat PIJ or initial-model producer changes.
- PIJ death-notice freshness, timestamping, or deduplication.
- A selected-root global transcript filename scan.
- Any product special case for the excluded machine-local alternate Claude configuration.
- P060 remote telemetry `ls`/`pull`, bundle integrity, repository selection, and `RemoteTelemetryGitPort` behavior; P063 preserves those landed contracts while modifying shared telemetry act surfaces only for token coverage.
- Any implementation task for the deferred systemic defects above.

### Target Domains

| Domain | Status | Relationship | Role in This Feature |
|---|---|---|---|
| harness-cli | existing conceptual | **modify** | Capture, normalize, persist, merge, and render truthful token evidence through ports and adapters. |
| repo-engineering-substrate | existing conceptual | **modify** | Hold TDD coverage, privacy guards, sanitized fixture workflow, and telemetry guides. |

The repository has no initialized `docs/domains/` registry; these are the constitution's existing conceptual domains, so no new domain setup is required.

### Testing Strategy

- **Approach**: Full TDD.
- **Rationale**: Source selection, cumulative/final precedence, partial evidence, schema transport, and degraded public envelopes all have plausible silent-failure modes.
- **Focus Areas**: bounded locator safety; typed observation reduction; non-double-counting; OTLP/ref round-trip; post-prune reads; per-field quality merge; compatibility projection; public coverage state/reason; privacy.
- **Excluded**: turn-duration, broad model/lifecycle/plan-attribution follow-ons.
- **Mock Usage**: injected port fakes and literal structural fixtures only; no `vi.mock`, `vi.spyOn`, monkey-patching, or behavioral mocks.
- **Real proof**: the authorized private corpus must show current-head RED and repaired GREEN under the frozen historical report fence; fake or synthetic evidence cannot substitute.
- **CI fixture order**: minimized sanitized fixtures may be authored only after real replay establishes the semantics, then must pass byte-scan plus manual publication review.

### Documentation Strategy

- **Location**: update the existing `docs/how/telemetry.md`, `docs/how/telemetry-reports.md`, and `docs/how/telemetry-fixtures.md` guides and their generated CLI documentation projection.
- **Rationale**: users need one existing place to understand source precedence, coverage states, post-sync reads, and the real-before-sanitized proof order.

### Complexity

- **Score**: CS-5 (epic)
- **Breakdown**: S=2, I=2, D=2, N=1, F=2, T=2 (sum 11)
- **Confidence**: 0.88
- **Assumptions**: authorized corpus identities remain frozen; current event structures match the dossier's allowlisted observations; converged merge `c3ec0cef2dbd42b8c5058df8db176f143e2187bd` remains the downstream source baseline.
- **Dependencies**: existing ports/fakes, segment/OTLP/ref substrate, public envelope contract, authorized private replay access under a later born-closed execution packet.
- **Risks**: additive event/schema drift, cumulative/final double counting, source precedence masking, private evidence leakage, post-convergence source drift.
- **Phases**: three—the minimum that separates capture contracts, durable/public consumption, and real replay plus fixture promotion.

### Acceptance Criteria

1. **AC-01 — Bounded Claude lookup**: Given a selected standard config root and explicit current/main/common-repo known-worktree candidates, the locator reads exactly one confined `<session-id>.jsonl`; zero, multiple, unresolved, symlinked, traversing, oversized, or malformed candidates return a typed unavailable/degraded reason without a global scan or arbitrary pick.
2. **AC-02 — Typed Copilot observations**: Current message-output, cumulative checkpoint, partial compaction, and final shutdown records parse into distinct typed observations; same-kind event aggregation follows its own rule, unlike kinds are never added, and a valid final observation is authoritative.
3. **AC-03 — Per-field evidence quality**: Live, durable-ref, and vendor-ledger evidence merge independently for each token field; a measured field cannot be masked by an empty ref, every selected field records source/kind/coverage, and the existing scalar `source` remains a deterministic compatibility projection.
4. **AC-04 — Teardown-safe token reads**: After sync has published the whole-session ref and the live buffer is pruned, `telemetry get`, session export/save, and fleet reads return the same measured token fields from durable evidence; missing identity links remain unavailable rather than inferred.
5. **AC-05 — Honest public coverage**: Complete token evidence reports `measured`; partial evidence reports `partial`; zero usable token evidence reports `unavailable`; partial/unavailable public commands use a degraded envelope with `next_action`, a closed evidence reason, and `cause: unknown` unless an authoritative cause exists.
6. **AC-06 — Real historical RED→GREEN**: After re-verifying every authorized source identity and applying the original report fence, the unchanged private oracle records current-head RED and repaired GREEN field by field for all applicable opaque cases, including an empty-ref-versus-measured-vendor conflict and a post-prune read.
7. **AC-07 — Sanitized CI fixtures follow real proof**: Only after AC-06 is green, the smallest structural fixtures needed to defend the observed semantics are sanitized, manually reviewed, byte-scanned, and committed without raw identifiers, private paths, prose, payloads, model footers, real totals, or person-level data.
8. **AC-08 — Compatibility and privacy**: Existing measured standard-Claude controls remain measured, existing consumers continue to receive the scalar source projection, counts-only publication remains closed, and no tracked artifact or validator input contains raw private corpus material.

### Risks & Assumptions

| Risk / Assumption | Impact | Mitigation |
|---|---|---|
| Cumulative checkpoints or final shutdown totals are treated as independent deltas | Inflated tokens | One typed reducer with kind-specific rules; mutation-defended tests assert unlike kinds are never added. |
| A token-dark ref wins merely because it exists | Valid vendor evidence remains hidden | Merge by per-field evidence quality, not location-first selection; retain location only as provenance. |
| Partial token buckets are projected as numeric zero | Public false precision | Nullable per-field evidence plus measured/partial/unavailable coverage and a closed reason. |
| Claude session IDs collide across candidate project keys | Wrong transcript read | Exact bounded candidates, metadata-first confinement, exactly-one-match rule, typed ambiguity. |
| Ref lookup cannot prove a PIJ↔Harness join after teardown | Wrong identity inference | Consume only durable captured joins; return unavailable when absent; adopted-seat producer repair remains follow-on. |
| Private replay bytes leak into tracked artifacts or validation | Publication breach | Orchestrator-owned private replay, opaque case IDs, no raw validator context, sanitizer + byte scan + manual review. |
| P060 landed changes share acts/docs/Git surfaces | Remote telemetry regression | Converged product paths are byte-identical to main562; retain P060 remote grammar/envelope/integrity tests while adding token behavior. |

### Open Questions

None. Jordan resolved the only blocking security choice in this session: “1 is fine, its rare occurance” selects bounded current-project plus known-worktree candidates and rejects a selected-root global scan.

### Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|---|---|---|---|
| None | Other | The sole blocking locator boundary was resolved directly by Jordan; deferred systemic topics are explicit non-goals. | None. |

### Clarifications

#### Session 2026-07-21

- **Workflow Mode — Jordan**: Full / multi-phase.
- **Testing — Jordan**: Full TDD; existing telemetry guides; private real replay mandatory; minimized sanitized fixtures only afterward.
- **Mocks — Jordan**: injected port fakes only; no behavioral mocks.
- **Usage semantics — Jordan**: per-event message output, cumulative checkpoint cost, partial compaction usage, and final shutdown totals are unlike typed observations; unlike kinds are never added; final is authoritative when present.
- **Compatibility — Jordan**: additive per-field evidence map; complementary live/ref/ledger merge; retain scalar `source` as compatibility projection.
- **Coverage — Jordan**: state plus closed evidence reason; cause remains unknown unless authoritative; P063 applies this only to token coverage/source availability.
- **Locator — Jordan**: “1 is fine, its rare occurance” → selected standard root with explicit bounded current/main/common-repo known-worktree candidates; no global scan.
- **Convergence — Jordan**: complete the atomic Plan on base81, then converge/revalidate against landed main562 before any workshop, tasks, or implementation.
- **Convergence evidence — o-prime**: Plan-only commit `26f4eb094100471ad8feb806098c2c4b25e18230` was merged with exact main562 as `c3ec0cef2dbd42b8c5058df8db176f143e2187bd`; no rebase, stash, or autostash; source/path/privacy revalidation is clean.

## Planning Seam

_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — the locator decision is resolved and deferred systemic topics are non-goals

| Artifact | Present? | Effect on the plan |
|---|---|---|
| `research-dossier.md` | yes | Supplies current source findings, opaque real-case matrix, privacy boundary, and historical contracts. |
| `research/official-claude-session-storage.md` | yes | Fixes the documented standard storage behavior and bounded locator decision. |
| `workshops/*.md` | no | No authoritative workshop decisions to fold in. |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|---|---|---|---|
| G1 | Clarify | PASS | Full mode, TDD, evidence semantics, compatibility, coverage, locator, privacy, and convergence are resolved. |
| G2 | Constitution | PASS | Ports/adapters, fakes over mocks, stable envelopes, honesty, evidence paths, and privacy are preserved; no deviation required. |
| G3 | Architecture | PASS | Business rules remain in telemetry services, I/O remains behind injected ports, acts stay composition/output only. |
| G4 | ADR Compliance | N/A | No `docs/adr/` registry exists. |
| G5 | Structure | PASS | Both halves, seam, required implementation sections, phases, tasks, AC map, and cross-references are present. |
| G6 | Testing Alignment | PASS | Every implementation phase starts with failing behavioral contracts; private replay precedes fixture derivation; no behavioral mocks. |
| G7 | Domain Completeness | PASS | Both conceptual domains and every referenced file are mapped; no new domain exists. |

### Summary

The implementation introduces one typed token-evidence vocabulary across capture and readers rather than teaching each surface independent arithmetic. Phase 1 fixes bounded Claude location and current Copilot observation capture; Phase 2 carries token evidence through refs, per-field quality merge, and degraded public surfaces; Phase 3 proves the completed path on immutable real sessions before deriving sanitized CI fixtures. Deferred duration, model, plan-attribution, lifecycle, adopted-seat, and PIJ notice work is not represented in any task.

### Domain Manifest

| File | Domain | Classification | Rationale |
|---|---|---|---|
| `harness/cli/src/adapters/git/git-port.ts` | harness-cli | contract | Add read-only explicit project/worktree candidate discovery. |
| `harness/cli/src/adapters/git/exec-git.ts` | harness-cli | internal | Resolve bounded Git project/worktree roots without service shell-outs. |
| `harness/cli/src/adapters/git/fake-git.ts` | repo-engineering-substrate | cross-domain | Deterministic port fake for locator tests. |
| `harness/cli/src/adapters/fs/fs-port.ts` | harness-cli | contract | Add a bounded no-follow regular-file metadata/read contract. |
| `harness/cli/src/adapters/fs/node-fs.ts` | harness-cli | internal | Enforce symlink refusal and the byte ceiling before transcript allocation. |
| `harness/cli/src/adapters/fs/fake-fs.ts` | repo-engineering-substrate | cross-domain | Deterministic no-follow metadata and oversize cases for TDD. |
| `harness/cli/src/services/telemetry/adapters/harness-adapter.ts` | harness-cli | contract | Thread the already-resolved standard config root and candidate project roots. |
| `harness/cli/src/services/telemetry/capture-service.ts` | harness-cli | internal | Compose safe explicit locator inputs once per capture. |
| `harness/cli/src/services/telemetry/adapters/claude-adapter.ts` | harness-cli | internal | Metadata-first, bounded, exactly-one standard transcript locator. |
| `harness/cli/src/services/telemetry/adapters/copilot-adapter.ts` | harness-cli | internal | Parse current event records instead of obsolete process-log-only usage. |
| `harness/cli/src/services/telemetry/copilot-ledger.ts` | harness-cli | internal | Parse final shutdown and non-final typed vendor observations defensively. |
| `harness/cli/src/services/telemetry/usage-observation.ts` | harness-cli | internal | Single kind-specific reducer, coverage state/reason vocabulary, and evidence-quality ordering. |
| `harness/cli/src/services/telemetry/events.ts` | harness-cli | contract | Add counts-only typed usage events to the closed event union. |
| `harness/cli/src/services/telemetry/segment.ts` | harness-cli | contract | Serialize typed usage evidence without zero-filling absent fields. |
| `harness/cli/src/services/telemetry/segment.schema.json` | harness-cli | contract | Validate the additive usage event shape and closed enums. |
| `harness/cli/src/services/telemetry/otlp/semconv.ts` | harness-cli | contract | Assign closed OTLP attributes for typed usage evidence. |
| `harness/cli/src/services/telemetry/otlp/logs.ts` | harness-cli | internal | Losslessly encode/decode usage observations through published refs. |
| `harness/cli/src/services/telemetry/otlp/harness-otlp.schema.json` | harness-cli | contract | Keep stored OTLP shape closed and schema-valid. |
| `harness/cli/src/services/telemetry/session-evidence.ts` | harness-cli | contract | Return tokens, field evidence, source coverage, and closed reasons from live/ref/vendor tiers. |
| `harness/cli/src/services/telemetry/session-export.ts` | harness-cli | contract | Resolve session tokens from typed evidence without absent→zero conversion. |
| `harness/cli/src/services/telemetry/session-export.schema.json` | harness-cli | contract | Publish additive token coverage/evidence while preserving old fields. |
| `harness/cli/src/services/telemetry/ref-source.ts` | harness-cli | internal | Reconstruct typed usage and token coverage from whole-session refs. |
| `harness/cli/src/services/telemetry/fleet-evidence.ts` | harness-cli | contract | Merge live/ref/ledger per field for every lane, not orphans only. |
| `harness/cli/src/services/telemetry/fleet-export.schema.json` | harness-cli | contract | Close the additive per-field evidence map and compatibility source. |
| `harness/cli/src/services/telemetry/report.ts` | harness-cli | contract | Aggregate token coverage honestly and retain contributors/reasons. |
| `harness/cli/src/services/telemetry/report.schema.json` | harness-cli | contract | Close measured/partial/unavailable report provenance. |
| `harness/cli/src/services/telemetry/render/report-html.ts` | harness-cli | internal | Render degraded token coverage and reasons without false zero/ok. |
| `harness/cli/src/services/telemetry/sweep.ts` | harness-cli | internal | Preserve degraded coverage across multi-session discovery. |
| `harness/cli/src/acts/telemetry.ts` | harness-cli | cross-domain | Map service coverage into canonical public envelopes and next actions. |
| `harness/cli/src/services/docs/docs-content.ts` | repo-engineering-substrate | cross-domain | Regenerated projection of updated telemetry guides. |
| `docs/how/telemetry.md` | repo-engineering-substrate | internal | Document capture kinds, source precedence, and post-sync reads. |
| `docs/how/telemetry-reports.md` | repo-engineering-substrate | internal | Document public coverage state/reason and compatibility projection. |
| `docs/how/telemetry-fixtures.md` | repo-engineering-substrate | internal | Document real-replay-first fixture derivation and privacy gate. |
| `harness/cli/test/services/telemetry/claude-adapter.test.ts` | repo-engineering-substrate | internal | Bounded locator behavior and safety regressions. |
| `harness/cli/test/services/telemetry/copilot-adapter.test.ts` | repo-engineering-substrate | internal | Current-event typed usage extraction. |
| `harness/cli/test/services/telemetry/copilot-events.test.ts` | repo-engineering-substrate | internal | Usage event ordering, privacy, and round-trip behavior. |
| `harness/cli/test/services/telemetry/copilot-ledger.test.ts` | repo-engineering-substrate | internal | Kind-specific final/checkpoint/compaction/message precedence. |
| `harness/cli/test/services/telemetry/capture-service.test.ts` | repo-engineering-substrate | internal | Explicit selected-root/candidate input threading. |
| `harness/cli/test/adapters/git/fake-git.test.ts` | repo-engineering-substrate | internal | Candidate-root port fake behavior. |
| `harness/cli/test/adapters/git/exec-git.test.ts` | repo-engineering-substrate | internal | Bounded worktree porcelain parsing and malformed-output failure. |
| `harness/cli/test/adapters/fs/fake-fs.test.ts` | repo-engineering-substrate | internal | No-follow and byte-ceiling fake behavior. |
| `harness/cli/test/adapters/fs/node-fs.test.ts` | repo-engineering-substrate | internal | Production symlink refusal and pre-allocation size guard. |
| `harness/cli/test/services/telemetry/segment-schema.test.ts` | repo-engineering-substrate | internal | Additive closed usage schema. |
| `harness/cli/test/services/telemetry/otlp/reconstruction.test.ts` | repo-engineering-substrate | internal | Lossless typed usage ref round-trip. |
| `harness/cli/test/services/telemetry/session-evidence.test.ts` | repo-engineering-substrate | internal | Live/ref/vendor fallback and post-prune tokens. |
| `harness/cli/test/services/telemetry/session-export.test.ts` | repo-engineering-substrate | internal | Partial/unavailable tokens never zero-filled. |
| `harness/cli/test/services/telemetry/ref-source.test.ts` | repo-engineering-substrate | internal | Durable ref reconstruction and malformed-ref reasons. |
| `harness/cli/test/services/telemetry/fleet-evidence.test.ts` | repo-engineering-substrate | internal | Per-field source quality and compatibility projection. |
| `harness/cli/test/services/telemetry/fleet-golden-051.test.ts` | repo-engineering-substrate | internal | Preserve established fleet semantics outside token enrichment. |
| `harness/cli/test/services/telemetry/report.test.ts` | repo-engineering-substrate | internal | Aggregate measured/partial/unavailable coverage. |
| `harness/cli/test/services/telemetry/report-html.test.ts` | repo-engineering-substrate | internal | Human rendering of degraded token state. |
| `harness/cli/test/services/telemetry/sweep-act.test.ts` | repo-engineering-substrate | internal | Multi-session coverage propagation. |
| `harness/cli/test/acts/telemetry.test.ts` | repo-engineering-substrate | internal | Canonical degraded envelopes and next actions. |
| `harness/cli/test/services/telemetry/publication-boundary.test.ts` | repo-engineering-substrate | internal | Counts-only closed publication contract. |
| `harness/cli/test/services/telemetry/fixture-privacy-scan.test.ts` | repo-engineering-substrate | internal | Sanitized fixture byte-scan with live negative control. |

### Key Findings

| # | Impact | Finding | Action |
|---|---|---|---|
| 01 | Critical | On landed main, `claudeTranscriptPath()` still hardcodes `~/.claude/projects/<mangled capture cwd>/<session>.jsonl`; both `currentPosition()` and extraction use it. | Thread the selected standard root and a bounded explicit project-root candidate set through ports; metadata-first exactly-one resolution. |
| 02 | Critical | `copilotAdapter.extract()` still gets tokens from obsolete process-log `assistant_usage`; current `readEvents()` ignores usage/checkpoint/compaction/shutdown records, while `extractCopilotLedger()` reads only the last final shutdown. | Introduce one typed observation parser/reducer and serialize its closed counts-only event shape. |
| 03 | Critical | `getSessionEvidence()` scans live candidate buffers only; sync/prune therefore removes its only token source, and the current `SessionEvidence` surface has no token field. | Add durable ref/vendor tiers, token coverage, per-field evidence, and captured-identity-only joins. |
| 04 | Critical | Fleet enrichment runs only for roster `orphans`; an existing unmeasured ref prevents ledger evaluation and `FleetLane.source` can represent only one winner. | Evaluate every lane, merge per token field by evidence quality, and keep scalar `source` as a deterministic compatibility projection. |
| 05 | High | `buildTokens()` initializes every missing bucket to zero, while `tokensFromBlobs()` marks a ref measured from any positive turn value; partial and absent coverage cannot be distinguished publicly. | Resolve nullable field evidence first, then derive totals only when supported and propagate measured/partial/unavailable state plus reason. |
| 06 | High | Whole-session refs already preserve allowlisted `captured_env` through OTLP and `session-export` recovers `pij_session_id`; missing joins can therefore remain honest instead of being invented. | Reuse durable captured identity where present and return unavailable where it is absent. |
| 07 | High | Existing fixture docs and byte-scan/publication tests provide a reusable privacy gate, but promoted fixtures contain public permanent bytes and require manual review. | Keep real replay private; derive only minimal structural fixtures after GREEN and run both automated and manual gates. |

### Phases

#### Phase Index

| Phase | Title | Primary Domain | Objective | Depends On |
|---|---|---|---|---|
| 1 | Safe capture and typed usage | harness-cli | Establish the private oracle baseline, bounded Claude lookup, and current Copilot typed observations. | None |
| 2 | Durable evidence and truthful readers | harness-cli | Carry token evidence through refs, merge by field quality, and expose honest public coverage. | Phase 1 |
| 3 | Real replay and CI fixture promotion | repo-engineering-substrate | Prove end-to-end GREEN on real sessions before deriving privacy-reviewed regression fixtures and guides. | Phase 2 |

#### Phase 1: Safe Capture and Typed Usage

**Objective**: Replace cwd-only Claude lookup and obsolete Copilot usage extraction with safe, typed, non-double-counting capture contracts.
**Domain**: harness-cli
**Delivers**:
- Frozen private expected-value ledger and current-head RED evidence under opaque case IDs.
- Bounded selected-root Claude locator with explicit current/main/common-repo known-worktree inputs.
- Typed Copilot usage event and kind-specific reducer preserved through segment/OTLP round trips.
**Depends on**: None
**Key risks**: Transcript ambiguity and cumulative/final double counting; both fail closed and are mutation-defended.

| # | Task | Domain | Success Criteria | Notes |
|---|---|---|---|---|
| 1.1 | Reverify the authorized corpus identities and record the private current-head RED ledger at the original report fence | repo-engineering-substrate | Every authorized source matches its frozen identity; opaque expected fields are independently derived; any mismatch stops; no raw content enters tracked artifacts | AC-06, AC-08; private execution packet required |
| 1.2 | Write failing locator, Git/filesystem port, and typed-observation tests before product changes | repo-engineering-substrate | Tests fail on cwd-only lookup, malformed worktree discovery, zero/multiple/symlink/traversal/oversize/malformed candidates, allocation before the byte guard, obsolete-log-only Copilot extraction, unlike-kind addition, and final-precedence mutation | AC-01, AC-02; injected fakes only |
| 1.3 | Extend Git/capture context with read-only explicit project candidates, add bounded no-follow file reads, and implement the Claude locator | harness-cli | Exactly one metadata-safe candidate is read within explicit named candidate/byte caps; size and symlink checks occur before content allocation; all other outcomes produce the closed reason; no service shell-out, global scan, arbitrary pick, or product special case | Per finding 01 |
| 1.4 | Implement typed Copilot usage parsing, reduction, closed serialization, and OTLP reconstruction | harness-cli | Message events aggregate only as distinct events; cumulative/partial choose their valid observation; unlike kinds never add; valid final is authoritative; corrupt records fail closed | Per finding 02 |
| 1.5 | Run focused adapter, schema, OTLP, capture, and privacy tests | repo-engineering-substrate | Phase 1 tests pass and existing Claude/Copilot counts-only privacy and measured-control tests remain green | AC-01, AC-02, AC-08 |

#### Phase 2: Durable Evidence and Truthful Readers

**Objective**: Make token evidence teardown-safe, quality-aware, compatibility-preserving, and publicly honest.
**Domain**: harness-cli
**Delivers**:
- Session/ref/export token evidence with measured/partial/unavailable coverage.
- Per-field live/ref/ledger quality merge across all fleet lanes.
- Compatibility scalar `source` plus additive field evidence.
- Degraded public envelopes, schemas, report HTML, sweep behavior, and updated telemetry guides.
**Depends on**: Phase 1
**Key risks**: Breaking existing consumers or treating absent identity/evidence as zero; additive schemas and compatibility tests contain both.

| # | Task | Domain | Success Criteria | Notes |
|---|---|---|---|---|
| 2.1 | Write failing durable-read, field-merge, compatibility, and public-status tests before reader changes | repo-engineering-substrate | Tests reproduce post-prune loss, empty-ref masking, partial-as-zero, and false-ok envelopes; scalar source compatibility is pinned | AC-03–AC-05 |
| 2.2 | Add typed token evidence to session evidence/export/ref reconstruction | harness-cli | Live and whole-session ref paths use the same reducer; post-prune reads preserve measured fields; absent joins/fields return closed reasons and `cause: unknown` | Per findings 03, 05, 06 |
| 2.3 | Replace orphan/location-first fleet selection with per-field quality merging | harness-cli | Every rostered lane evaluates complementary live/ref/ledger evidence; measured fields beat empty fields; unlike observations never add; scalar source projection is deterministic | Per finding 04 |
| 2.4 | Propagate coverage state/reason through schemas, reports, HTML, sweep, and telemetry acts | harness-cli | Complete=`measured`; partial=`partial`; zero=`unavailable`; partial/unavailable command envelopes are degraded with `next_action`; no false zero/ok; P060 remote `ls`/`pull` grammar and envelopes remain unchanged | AC-05 |
| 2.5 | Update existing telemetry, reports, and fixture guides and regenerate their CLI projection | repo-engineering-substrate | Guides document bounded locator, typed precedence, post-sync reads, per-field provenance, compatibility projection, coverage reasons, and real-before-sanitized proof | Documentation strategy |
| 2.6 | Run focused session/ref/fleet/report/act/schema/privacy tests | repo-engineering-substrate | Phase 2 tests pass; established fleet golden, standard-Claude controls, P060 remote telemetry grammar/envelopes/integrity, envelope schema, and counts-only publication remain green | AC-03–AC-05, AC-08 |

#### Phase 3: Real Replay and CI Fixture Promotion

**Objective**: Establish end-to-end truth on immutable historical evidence, then encode only the smallest sanitized regression substrate.
**Domain**: repo-engineering-substrate
**Delivers**:
- Field-by-field private RED→GREEN replay record for every applicable opaque case.
- Post-prune and source-conflict GREEN evidence.
- Minimal sanitized fixtures defended by privacy and drift guards.
- Final guide and gate evidence.
**Depends on**: Phase 2
**Key risks**: Historical-fence drift and publication leakage; identity rechecks, fence selection, opaque outputs, manual review, and byte scans are mandatory.

| # | Task | Domain | Success Criteria | Notes |
|---|---|---|---|---|
| 3.1 | Reverify corpus identities and run the repaired private replay against the frozen ledger and historical fence | repo-engineering-substrate | All applicable opaque cases move from recorded RED to field-by-field GREEN; later events do not rewrite historical expectations; missing/mismatched evidence stops | AC-06 |
| 3.2 | Exercise teardown and conflict scenarios on copied/read-only replay boundaries | repo-engineering-substrate | Token reads stay measured after live-buffer removal; a measured vendor field beats an empty ref; unknown joins remain unavailable; source inventories remain unchanged | AC-03, AC-04, AC-06 |
| 3.3 | Only after replay GREEN, derive minimized sanitized structural fixtures and TDD regressions | repo-engineering-substrate | Fixtures contain only the minimum event shapes; no raw private identifier/path/prose/payload/footer/real total/person data; mutations fail the intended tests | AC-07, AC-08 |
| 3.4 | Run fixture drift, privacy byte-scan, publication-boundary, focused telemetry, and repository composite gates | repo-engineering-substrate | Automated guards pass; promoted bytes receive the documented manual review; `harness checks` passes after convergence | AC-07, AC-08 |
| 3.5 | Reconcile guides with observed GREEN behavior | repo-engineering-substrate | Public docs describe only behavior proven by replay/tests and retain the explicit limits/non-goals | AC-05–AC-08 |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|---|---|---|
| AC-01 | 1.2, 1.3, 1.5 | Claude adapter/capture/Git fake safety tests |
| AC-02 | 1.2, 1.4, 1.5 | Copilot adapter/ledger/event/schema/OTLP mutation tests |
| AC-03 | 2.1, 2.2, 2.3, 2.6, 3.2 | Session/ref/fleet source-conflict tests plus real replay |
| AC-04 | 2.1, 2.2, 2.6, 3.2 | Post-sync/prune session/export/act tests plus real teardown replay |
| AC-05 | 2.1, 2.4, 2.5, 2.6, 3.5 | Report/schema/HTML/sweep/act tests and guides |
| AC-06 | 1.1, 3.1, 3.2 | Private immutable replay ledger and RED→GREEN comparison |
| AC-07 | 3.3, 3.4 | Sanitized fixture drift guard, byte-scan, publication test, manual review |
| AC-08 | 1.1, 1.5, 2.6, 3.3, 3.4 | Compatibility controls and privacy/publication gates |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Event field variations across current Copilot versions | Medium | High | Defensive allowlisted parser, closed kind enum, malformed-source reason, real multi-case replay. |
| Final/cumulative observations overlap prior message evidence | High | Critical | Kind-specific reducer and precedence; never add unlike kinds; final authoritative; mutation tests. |
| Additive schema is not lossless through OTLP/ref | Medium | Critical | Schema-first tests and encode→decode equality before reader implementation. |
| Compatibility consumers depend on scalar source or old token totals | Medium | High | Retain deterministic scalar projection; additive field map; golden and act tests. |
| Durable PIJ join absent after teardown | Medium | Medium | Use only captured durable join; typed unavailable; producer expansion explicitly deferred. |
| Raw corpus reaches a tracked/validator context | Low | Critical | Opaque IDs only, private orchestrator replay, no raw validator input, sanitizer + byte-scan + manual review. |
| Converged source moves after revalidation | Medium | High | Pin implementation intake to merge `c3ec0cef2dbd42b8c5058df8db176f143e2187bd`; any newer base requires another source/path/gate revalidation before downstream work. |
