# P060 Phase 1 implementation execution log

**Delegation**: `dlg-0002`  
**Base**: `132e0749fbf132e8cbcd526586f52848fec686b9`  
**Fence**: packet-enumerated 66 paths only; no install, fan-out, flow/ledger mutation, commit, push, PR, merge, or release.

## T001 — RED public contracts

**State**: in progress

Contract locked from Plan 2.0.1 §§6–19 (verified SHA-256 `ea50ca66fc16436ef4939bc4dd773836c0c922a73e906d499b4d9a76cd60dec9`). T001 is tests-only; production and `error-codes.ts` remain unchanged until later owning tasks.

### RED evidence

```text
npm test -- test/acts/telemetry.test.ts test/acts/errors.test.ts test/services/telemetry/remote-input.test.ts
exit 1 — expected RED
- remote-input module missing
- telemetry ls/pull absent (3 contract failures)
- E220–E227 absent (1 allocation failure)
- 25 pre-existing focused tests passed
```

**Checkpoint**: T001 tests only; no production file or error allocation changed. RED is attributable solely to missing P060 behavior.

## T002 — ports, fakes, repository/ref identity and grouping

**State**: complete

### RED → GREEN evidence

```text
npm test -- test/services/telemetry/remote-input.test.ts test/services/telemetry/remote-selection.test.ts
RED: exit 1 — remote-input, remote-selection, and remote port/fake modules absent
GREEN: exit 0 — 2 files, 25 tests passed
```

Implemented dedicated remote-read contracts/recording fake, strict UTF-8 repository-file parsing, canonical safe network identities and collision closure, selector parsing, strict advertisement parsing, unsigned UTF-8 ordering, and repository-scoped grouping. Services remain `node:*`-free; local GitRead/GitWrite contracts were not widened.

## T003 — Segment 2.5 / OTLP v0.2 product provenance

**State**: in progress

### dlg-0003 recovery continuation

Preserved the abandoned T003 bytes and resumed from the frozen manifest. The first focused run exposed the unfinished sync thread exactly:

```text
npm test -- test/services/telemetry/segment-schema.test.ts test/services/telemetry/otlp/harness-otlp-schema.test.ts test/services/telemetry/otlp/reconstruction.test.ts test/services/telemetry/otlp/metrics.test.ts test/services/telemetry/sync-service.test.ts test/services/telemetry/rolled-read.test.ts
exit 1
Test Files 1 failed | 5 passed (6)
Tests 1 failed | 74 passed (75)
FAIL sync-service.test.ts > carries a stable prior+new product-commit union
AssertionError: expected undefined to deeply equal ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]
```

Threaded prior/new product OIDs through steady-state rebuilds and migration, deriving a missing prior aggregate from canonical Logs/loose Segment-2.5 records. Added strict manifest/per-segment known/partial/unavailable agreement, stable dedupe, explicit-empty rejection, and real `ExecGit.currentCommit` no-repo/unborn/detached proof.

A non-authoritative package-script probe failed exactly and was not used as evidence:

```text
npm run typecheck
exit 1
npm error Missing script: "typecheck"
```

### GREEN evidence

```text
npm test -- test/adapters/git/fake-git.test.ts test/services/telemetry/segment-schema.test.ts test/services/telemetry/capture-service.test.ts test/services/telemetry/otlp/harness-otlp-schema.test.ts test/services/telemetry/otlp/reconstruction.test.ts test/services/telemetry/otlp/metrics.test.ts test/services/telemetry/sync-service.test.ts test/services/telemetry/sync-migration.test.ts test/services/telemetry/file-rollup.test.ts test/services/telemetry/rolled-read.test.ts test/services/telemetry/session-export.test.ts
exit 0 — 11 files / 156 tests passed
```

**State after recovery**: complete. Segment 2.4/v0.1 remains readable; Segment 2.5/v0.2 round-trips exact per-segment OIDs; capture calls Git only after activity; rollup/v1 manifests preserve/derive and verify the stable aggregate; Metrics remains present with unchanged measure payloads.

## T004 — whole-session selection, compatibility, fidelity, and privacy

**State**: complete

### RED evidence

```text
npm test -- test/services/telemetry/remote-selection.test.ts test/services/telemetry/published-telemetry.test.ts
exit 1
- published-telemetry module missing
- partial known commit match incorrectly reported completeness `complete`
- merge-aware inclusive membership helper missing
- 11 pre-existing focused tests passed
```

Implemented the pure whole-group selector and strict published reader. It preserves complete refs/histories/raw `Uint8Array` blobs, shares the existing logs-rooted SessionExport path, accepts canonical/mixed/fallback/legacy shapes, applies complete-pair precedence, keeps event and measurement coverage independent, and rejects malformed UTF-8/JSONL, duplicate keys, unsafe paths/modes/content, and product/date contradictions without echoing input.

### GREEN / regression evidence

```text
npm test -- test/services/telemetry/remote-selection.test.ts test/services/telemetry/published-telemetry.test.ts
exit 0 — 2 files / 27 tests passed

npm test -- test/services/telemetry/remote-selection.test.ts test/services/telemetry/published-telemetry.test.ts test/services/telemetry/rolled-read.test.ts test/services/telemetry/session-export.test.ts test/services/telemetry/fixture-privacy-scan.test.ts
exit 0 — 5 files / 79 tests passed
```

The corpus loops prove 52 canonical, 2 pair-plus-fallback, and 14 fallback-only sessions; zero-observed events and zero-measured Metrics remain affirmative zero evidence, while unavailable values stay null+gaps.

## T005 — verified disposable remote Git adapter

**State**: complete

### RED evidence

```text
npm test -- test/adapters/git/exec-remote-telemetry-git.int.test.ts
exit 1 — exec-remote-telemetry-git module missing; no tests collected
```

Implemented argv-only Git protocol-v2 advertisement/fetch in command-owned bare stores, exact advertised/fetched OID verification with one whole-snapshot restart, deterministic child-before-parent/OID history and unsigned path ordering, pre-blob source-tree rejection, bounded metadata-only product graph fetch, endpoint/divergence/candidate outcomes, active timeout/object/output caps, safe errors, and unconditional cleanup.

### GREEN / regression evidence

```text
npm test -- test/adapters/git/exec-remote-telemetry-git.int.test.ts
exit 0 — 1 file / 4 tests passed

npm test -- test/services/telemetry/remote-input.test.ts test/services/telemetry/remote-selection.test.ts test/services/telemetry/published-telemetry.test.ts test/adapters/git/exec-remote-telemetry-git.int.test.ts
exit 0 — 4 files / 47 tests passed
```

The real `git daemon` fixture proves namespace-only traffic, byte-exact snapshots, movement restart, inclusive endpoint membership, candidate/object caps, disposable cleanup, and unchanged caller HEAD/index. Production limits remain 10,000 candidates, 120 seconds, and 256 MiB; tests inject smaller equivalents.

## T006 — deterministic bundle and exclusive publisher

**State**: complete

### RED evidence

```text
npm test -- test/services/telemetry/telemetry-bundle.test.ts test/services/telemetry/bundle-publisher.test.ts test/adapters/fs/fake-fs.test.ts
exit 1
- telemetry-bundle and bundle-publisher modules missing
- FakeFs/NodeFs byte, no-follow, sibling-temp, and exclusive-directory methods missing
- 36 pre-existing filesystem tests passed
```

Implemented the exact `harness.telemetry-pull-bundle/v1` key order and deterministic repository/session/ref/history/tree mappings, repository-local content-addressed raw blobs, SHA-256 integrity inventory (excluding `bundle.json` self-hash), complete/partial empty bundles, and ports-only exact-folder publication. `BundleFsPort` adds byte/no-follow/sibling-temp/exclusive operations; `NodeFs` uses a parent-local `wx` lock and same-filesystem rename, while `FakeFs` records the semantic operations.

### GREEN evidence

```text
npm test -- test/services/telemetry/telemetry-bundle.test.ts test/services/telemetry/bundle-publisher.test.ts test/adapters/fs/fake-fs.test.ts
exit 0 — 3 files / 44 tests passed
```

Absent targets publish through verified sibling temps; exact targets reuse; missing/extra/different/non-regular targets return conflict; hash/publish/lock failures clean temps and return filesystem failure. A failed lock acquisition never removes another writer's lock.

## T007 — remote service and `telemetry ls|pull` wiring

**State**: complete

### RED evidence

```text
npm test -- test/services/telemetry/remote-telemetry-service.test.ts test/acts/telemetry.test.ts test/acts/errors.test.ts
exit 1
- remote-telemetry-service module missing
- ls/pull commands absent (3 grammar failures)
- E220–E227 absent (1 allocation failure)
- 25 pre-existing focused tests passed
```

Implemented async repository orchestration, immutable snapshot decode/selection, commit-graph membership, safe rows/effects, partial-success `ls`, all-or-none `pull`, conclusive E221, deterministic empty bundles, written/reused outcomes, and exact E220–E227 mapping. Commander validates repository/selector grammar before remote or output-write effects; the composition root injects `ExecRemoteTelemetryGit`, `NodeHash`, and the existing `NodeFs`.

### GREEN evidence

```text
npm test -- test/acts/telemetry.test.ts test/acts/errors.test.ts test/services/telemetry/remote-telemetry-service.test.ts
exit 0 — 3 files / 38 tests passed
```

JSON and human surfaces are covered; `ls` emits no durable evidence, `pull` points to `bundle.json`, raw blob/source content and subprocess details never enter rows/errors, and every effect reports caller mutation false.

## T008 — bundle ingestion through report/render/insights

**State**: complete

### RED evidence

```text
npm test -- test/services/telemetry/telemetry-bundle-reader.test.ts
exit 1 — telemetry-bundle-reader module missing; no tests collected
```

Implemented duplicate-key-safe `bundle.json` parsing, exact no-follow managed-file verification, SHA-256/size/path confinement, and raw-history reconstruction through the same strict published reader. The report input union tags repository-scoped `full|partial|identity-only` sessions without fabricating a `SessionExport` for weaker evidence. The established `buildReport(SessionExport[])` branch is untouched; bundle reports add `provenance.input_coverage` and discriminated `evidence_totals` only.

### GREEN / regression evidence

```text
npm test -- test/services/telemetry/telemetry-bundle-reader.test.ts test/services/telemetry/report.test.ts test/services/telemetry/report-html.test.ts test/services/telemetry/insights.test.ts
exit 0 — 4 files / 74 tests passed

npm test -- test/acts/telemetry.test.ts test/services/telemetry/telemetry-bundle-reader.test.ts test/services/telemetry/report.test.ts test/services/telemetry/report-html.test.ts test/services/telemetry/insights.test.ts
exit 0 — 5 files / 103 tests passed
```

Full bundle totals/rollups equal direct reconstructed exports; partial measured zero carries a contributor; identity-only contributes scope only; duplicate terminal ids remain separate across repositories; complete and unresolved partial empty bundles produce valid reports, with unresolved gaps preventing a zero-activity claim. Legacy-only reports omit every additive bundle field.

## T009 — operator guide and generated docs

**State**: complete with repository-wide baseline gate limitation carried to T010

Created `docs/how/telemetry-pull.md` with copyable single/multi-repository inventory and exact/date/product-commit pulls; whole-session semantics; annotated exact folder and field-by-field manifest tour; independent selection/provenance/fidelity axes; measured-zero versus unavailable; raw Logs+Metrics bytes and Segment-2.5/v0.2 metadata; duplicate identity behavior; report workflow; status/gaps/zero matches; effects/privacy; E220–E227; and deterministic reruns. Added the scoped links/version notes and curated the guide in the docs manifest.

### Generator / scoped proof

```text
npm run gen:docs
exit 0 — wrote 12 docs to docs-content.ts

npm run check:docs
exit 0 — check:docs OK, no drift

npx --no-install markdownlint-cli2 docs/how/telemetry-pull.md docs/how/telemetry.md docs/how/telemetry-otlp.md
exit 0 — 3 files, 0 errors
```

AC-25 zero-context documentation comprehension pending Jordan. Mechanical generation, drift, and scoped Markdown proof remain recorded separately; coder/reviewer assessment does not satisfy the human-only acceptance.

The authoritative repository-wide wrapper did not reach `status:ok` because of existing outside-fence findings; exact observed result:

```text
just lint-md
exit 0, Envelope status: degraded
199 findings: 197 markdown lint, 1 existing missing presentation link, 1 existing skill Mermaid syntax finding
first markdown finding: harness-foundations/first-principles.md:7 MD001
missing link: ../harness-presentations/missing-layer-101/intro-to-harness.md
Mermaid: skills/builder/references/stages/50-phase-tasks.md:186
```

Those paths are outside the exact 66-path fence and were not changed. Scoped P060 docs are clean.

## T010 — integrated proof and handoff

**State**: BLOCKED by an exact outside-fence hard-gate need; stopped immediately after recording.

### Passing proof before blocker

```text
focused new pure/fake suites
exit 0 — 8 files / 95 tests passed

provenance compatibility first run
exit 1 — 11 files / 156 tests: 154 passed, 2 failed
Cause: FakeFs write methods had begun duplicating caller-maintained seeded directory listings.
Fix: restored the established listing semantics; bundle no-follow listing remains path-derived.

provenance compatibility rerun
exit 0 — 11 files / 156 tests passed

real remote Git adapter
exit 0 — 1 file / 4 tests passed

telemetry act/session/rolled/bundle-reader/report/HTML/insights
exit 0 — 8 files / 125 tests passed

privacy fixture scan + planted negatives
exit 0 — 2 files / 49 tests passed

architecture no-direct-node-I/O
exit 0 — 1 file / 1 test passed

npm run check:docs
exit 0 — no drift

scoped telemetry Markdown
exit 0 — 3 files / 0 errors
```

Fence recheck before T010: exact packet fence 66 paths; 58 changed implementation/doc/log paths; zero outside-fence changes.

### In-fence static failures observed before the hard blocker

```text
npx --no-install tsc --noEmit -p harness/cli/tsconfig.json
exit 2
published-telemetry.ts(491,31): TS2571 Object is of type 'unknown'
published-telemetry.ts(491,61): TS18046 'sum' is of type 'unknown'

npx --no-install biome check harness/cli
exit 1 — 56 errors, 3 warnings, 2 infos
The reported P060 findings are formatting/import order plus noControlCharactersInRegex in remote input/published/adapter guards.
```

These owning paths are inside the fence, but the packet requires STOP when an outside-fence need is discovered; they were not changed after the blocker.

### Hard blocker — telemetry fixture drift requires forbidden paths

```text
npm run check:telemetry-fixtures
exit 1
Test Files 2 failed (2)
Tests 8 failed | 12 passed (20)
```

Every failure is the intentional current-producer contract change:

```text
expected Segment schema_version 2.4; received 2.5
expected OTLP schema URL .../v0.1.0; received .../v0.2.0
expected scope version 2.4; received 2.5
```

The failing owners are outside the exact 66-path fence:

- `.harness/extensions/telemetry-fixtures/**` committed Segment/Logs/Metrics goldens are explicitly read-only in the packet;
- `harness/cli/test/services/telemetry/real-capture.e2e.test.ts` is outside the exact allowed list;
- `harness/cli/test/services/telemetry/copilot-vscode-sqlite.int.test.ts` is outside the exact allowed list.

Regenerating those goldens is also explicitly forbidden by the packet. Keeping the current producer at 2.4 merely to satisfy the old fixtures would contradict Plan 2.0.1/T003, which requires the current producer to emit Segment 2.5 / OTLP v0.2 while retaining old 2.4/v0.1 fixtures as read compatibility evidence.

`harness checks` was not run after this hard-gate/fence contradiction. No fixture regeneration, outside-fence edit, install, remote telemetry action, commit, push, or flow/ledger mutation occurred.

## dlg-0004 T010 resume — static cleanup

The approved 70-path recovery fence was verified byte-for-byte before product authority. The 58-path T001–T009 substrate and four newly approved compatibility owners were exact; all 31 frozen corpus files and aggregate were exact.

Replaced control-character regex classes with equivalent explicit code-point guards, applied P060-only Biome formatting/import cleanup, and fixed the `unknown` reduce accumulator with an explicit numeric generic. No compatibility owner or frozen corpus file was touched during this step.

```text
npx --no-install tsc --noEmit -p harness/cli/tsconfig.json
exit 0

npx --no-install biome check harness/cli
exit 0 — Checked 408 files. No fixes applied.
```

## dlg-0004 T010 resume — frozen/current compatibility split

Changed only the four approved addendum owners. The compatibility assertions now require:

- exact current Segment 2.5, OTLP v0.2, and scope 2.5 identities;
- exact frozen Segment 2.4, OTLP v0.1, and scope 2.4 identities;
- no legacy `product_commit`, with only an optional valid lowercase full current OID;
- deep equality of every remaining Segment and Logs field after projecting only schema/resource/scope metadata;
- exact `scopeMetrics[].metrics` equality, plus full Metrics equality after the same metadata projection; and
- fail-closed legacy regeneration in both the default script path and direct `REGEN_GOLDEN` suite path, before any write.

```text
npx --no-install tsc --noEmit -p harness/cli/tsconfig.json
exit 0

npx --no-install biome check harness/cli
exit 0 — Checked 408 files. No fixes applied.

node --check scripts/telemetry-fixtures.mjs
exit 0

npm run check:telemetry-fixtures
exit 0
Test Files 2 passed (2)
Tests 20 passed (20)
telemetry-fixtures: checked 2 frozen compatibility suite(s); 4 committed instance(s) all covered.
```

Post-check corpus proof: 31/31 files matched SHA-256, size, and mode; canonical aggregate remained `4f5675a4799e9a6e39cbc0ea56d7356318e909dab5920310078ee3432757224a`. No frozen Segment, OTLP, raw, invariant, or `.harness` byte changed. The rewriting generator was not run.

## dlg-0004 T010 ordered proof

```text
focused pure/fake retrieval and bundle suites
exit 0 — 8 files / 95 tests passed

Segment/OTLP/capture/sync/prune/migration compatibility
exit 0 — 11 files / 156 tests passed

real remote Git adapter integration
exit 0 — 1 file / 4 tests passed

telemetry act/error/session/rolled/bundle-reader/report/HTML/insights regressions
exit 0 — 8 files / 125 tests passed

privacy fixture scan + planted published-input negatives
exit 0 — 2 files / 49 tests passed

npm run check:docs
exit 0 — no drift

scoped telemetry Markdown
exit 0 — 3 files / 0 errors

just lint-md
exit 0, Envelope status: degraded
199 pre-existing outside-fence findings: 197 markdown lint, 1 missing link, 1 Mermaid syntax

npx --no-install tsc --noEmit -p harness/cli/tsconfig.json
exit 0

npx --no-install biome check harness/cli
exit 0 — Checked 408 files. No fixes applied.

architecture no-direct-node-I/O
exit 0 — 1 file / 1 test passed

just windows-check
exit 0 — status:ok; scanned 24; findingCount 0
```

### Full-regression outside-fence blocker

```text
just test
exit 1
Test Files 3 failed | 218 passed (221)
Tests 3 failed | 2639 passed (2642)

FAIL test/output/error-codes.test.ts
Expected the pre-P060 exhaustive ErrorCodes object; received the required additive
REMOTE_TELEMETRY_* E220–E225 and TELEMETRY_BUNDLE_* E226–E227 allocations.

FAIL test/services/telemetry/future-harness-adapter.test.ts:87
expected Segment schema_version "2.4"; received "2.5"

FAIL test/services/telemetry/segment.test.ts:68
expected Segment schema_version "2.4"; received "2.5"
```

All three owning test files are outside the exact approved 70 paths. Downgrading the current producer to 2.4 would contradict Plan 2.0.1/T003 and the newly green frozen/current compatibility gate. Removing or hiding E220–E227 would contradict T001/T007's required public error allocation. This is therefore a 71st-path need, and the packet requires immediate STOP.

`harness checks` was not run after this blocker. No outside-fence edit, frozen corpus mutation, producer downgrade, install, generator, fan-out, flow/ledger mutation, remote telemetry action, commit, push, or other outward action occurred.

## dlg-0005 final assertion-only resume

Applied exactly the approved expectation deltas and no production/schema/corpus/generator change:

- exhaustive `ErrorCodes` expectation now includes existing E220–E227 mappings;
- future-adapter current Segment literal is 2.5; and
- core serializer test title/literal are 2.5, retaining the `SEGMENT_SCHEMA_VERSION` assertion.

```text
npm test -- test/output/error-codes.test.ts test/services/telemetry/future-harness-adapter.test.ts test/services/telemetry/segment.test.ts
exit 0
Test Files 3 passed (3)
Tests 22 passed (22)
```

### Final regression, corpus, and composite proof

```text
just test
exit 0
Test Files 221 passed (221)
Tests 2642 passed (2642)
Statements 89.14% | Branches 78.81% | Functions 91.18% | Lines 91.74%

frozen-corpus SHA/size/mode rehash
exit 0
31/31 files exact
aggregate 4f5675a4799e9a6e39cbc0ea56d7356318e909dab5920310078ee3432757224a

HARNESS_NO_TELEMETRY=1 node harness/cli/bin/harness.js checks --json
exit 0 — Envelope status: degraded
tests: ok
biome: ok
typecheck: ok
check:docs: ok
check:flows: ok
check:telemetry-fixtures: ok
check:doctrine-parity: ok
arch-check: degraded (2 warn-severity services-ports-type-only findings)
skills-check: ok
markdown-lint: degraded (known 199 warn-launch findings: 197 lint, 1 link, 1 Mermaid)
windows-check: ok
```

Direct architecture detail confirmed the two non-blocking warnings are the existing `GitWritePort` value imports in `services/telemetry/ref-source.ts` and `services/telemetry/sync-service.ts`; the rule severity is `warn`, and the composite explicitly classified both as non-blocking. The focused no-direct-node-I/O architecture test remains green from the ordered proof.

Final fence proof: all three expectation files equal their exact authorized baseline transforms; the product changed set is exactly the preserved 62 plus those three (65/65), with zero missing and zero outside. The exact write fence remains 73 paths and no 74th product path appeared. Cached diff remains empty; package and lock hashes remain exact. A second post-composite corpus check remained 31/31 exact at the required aggregate.

The composite ran with `HARNESS_NO_TELEMETRY=1`; no telemetry capture/sync or other outward action occurred. No install, generator, fixture/schema/snapshot/production change, fan-out/reviewer, flow/ledger mutation, commit, push, PR, merge, release, or deploy occurred.

## dlg-0006 independent-review repairs

### F1 — known-field privacy validation

Added nine adversaries before implementation. Exact RED summary:

```text
published-telemetry.test.ts
exit 1
Tests 23 total: 14 passed, 9 failed
- Segment known-field free prose
- Segment invalid known numeric value
- Metrics known description prose
- Metrics known unit credential
- Metrics unknown known-slot name
- Metrics duplicate semantic resource attribute
- Metrics extra resource block
- Logs duplicate semantic resource attribute
- Logs extra resource block
```

Replaced the broad known-key trust exemption with field-specific Segment and closed OTLP Logs/Metrics validation before raw admission. Supported schema/resource/scope pairs, unique attributes, fixed metric identities/units/point shapes, safe identifiers/OIDs/timestamps/numbers, one resource/scope block, and bounded safe additive Segment fields are now checked before any `ValidatedPublishedBlob` is retained.

```text
npm test -- test/services/telemetry/published-telemetry.test.ts
exit 0 — 1 file, 23 tests passed

npm test -- test/services/telemetry/published-telemetry.test.ts test/services/telemetry/fixture-privacy-scan.test.ts
exit 0 — 2 files, 58 tests passed
```

### F2/F3 — candidate transaction and mutation-resistant real Git

Service RED before implementation:

```text
remote-telemetry-service.test.ts
exit 1 — 7 tests: 5 passed, 2 failed
- groups exact candidates before fetch and never snapshots unrelated advertised refs
- owns one whole advertise→group→candidate→snapshot retry and includes a new same-session ref

remote-selection.test.ts
exit 1 — 15 tests: 13 passed, 2 failed
- pre-fetch date candidate grouping absent
- inventory/commit/exact candidate policy absent
```

Moved grouping and selector-specific candidate choice before fetch. `SnapshotRequest` now separates the complete advertised namespace from candidate refs; the adapter fetches only candidates and compares the complete namespace afterward. The service owns one complete advertise→group→candidate→snapshot retry; second movement remains `namespace_moved`/E223. Date fetches only groups with a known inclusive match, fetches the entire matched duplicate group, leaves unknown-only groups as unfetched gaps, and skips known-out-of-range groups. Commit inventory still fetches all groups for evidence-first ancestry selection.

Real-suite RED before the new runtime hooks/proofs:

```text
exec-remote-telemetry-git.int.test.ts
exit 1 — 9 tests: 5 passed, 4 failed
- exact telemetry-only argv/traffic was not observable
- real whole-transaction movement hook was absent
- injected cleanup failure was not surfaced
- argv-only Windows-shaped evidence was not observable
```

Added exact argv evidence, unrelated head/tag/private refs, a source-shaped parent, deterministic merge DAG, real one/second namespace movement, filter rejection, timeout/output/object/candidate bounds, cleanup success/failure, caller immutability, and Windows-shaped argv/ref assertions.

Mandatory mutation repeats, serialized and restored:

```text
TELEMETRY_NAMESPACE refs/harness-telemetry/* → refs/*
exit 1 — named exact-argv test failed (0 passed, 1 failed)
restored

SAFE_TELEMETRY_PATH allowlist → /^.*$/
exit 1 — named source-shaped-parent test failed (0 passed, 1 failed)
restored

npm test -- test/services/telemetry/remote-selection.test.ts test/services/telemetry/remote-telemetry-service.test.ts test/adapters/git/exec-remote-telemetry-git.int.test.ts
exit 0 — 3 files, 31 tests passed
```

### F4 — exact reviewed bundle-v1 contract

Independent golden and malformed matrix RED:

```text
telemetry-bundle.test.ts + telemetry-bundle-reader.test.ts
exit 1 — 15 tests: 6 passed, 9 failed
- exact independent Workshop 002 bundle-v1 golden
- selection extra key
- credential-bearing repository URL
- declared selected-ref count mismatch
- invalid per-ref date pair
- invalid per-ref shape
- invalid per-ref product null rule
- unexpected nested commit key
- integrity repository ownership mismatch
```

Replaced the drifted nested selector/session aggregate with fixed selection mode/endpoints, matched counts, canonical repository URL/counts, reviewed session coverage states, per-ref date/shape/product proof, `commits[].tree` evidence, and repository-owned integrity rows. The strict reader independently closes every nested key set and validates enums/null pairs/counts, canonical URL→key identity, duplicate identities, ref date/session agreement, OIDs/logical paths, product state, tree/integrity ownership, exact managed files, and decoded fidelity/coverage/product agreement. Per-ref product/shape evidence now comes from each validated ref rather than the session aggregate.

```text
npm test -- test/services/telemetry/telemetry-bundle.test.ts test/services/telemetry/telemetry-bundle-reader.test.ts
exit 0 — 2 files, 15 tests passed

npm test -- test/services/telemetry/published-telemetry.test.ts test/services/telemetry/telemetry-bundle.test.ts test/services/telemetry/telemetry-bundle-reader.test.ts test/services/telemetry/remote-telemetry-service.test.ts
exit 0 — 4 files, 45 tests passed
```

### F5 — filter-first reporting and honest bundle presentation

RED before implementation:

```text
report.test.ts + report-html.test.ts + insights.test.ts
exit 1 — 76 tests: 72 passed, 4 failed
- filters the input union before scope, repositories, coverage, gaps, and numeric aggregation
- excludes weaker evidence when a requested facet is unavailable and declares the exclusion gap
- bundle coverage renders N-of-M, unavailable evidence, and gaps without zero/no-activity claims
- insights adds coverage denominators and suppresses numeric sections without event evidence
```

`buildReportFromInputs` now filters the repository-tagged union first. Full evidence uses the established `matchesFilter`; repository facets use known key/identity; weaker evidence with an unevaluable requested facet is excluded explicitly. Scope, repository/session counts, numeric exports, coverage, contributor denominators, evidence totals, and gaps all derive from the same included set, while excluded counts and `filter_evidence_unavailable` gaps remain visible.

`renderReports` retains the exact legacy `input_coverage`-absent path (`embedReports(REPORT_TEMPLATE_HTML, columns)`) and adds an in-stack bundle-only coverage section from `report-html.ts`; both template twins remain untouched. Bundle HTML states accepted/considered sessions, N-of-M contributors, measured-zero versus unavailable, filter exclusions, and gaps without claiming zero sessions or no activity. Insights adds one evidence-coverage section with contributors/denominators/unavailable/excluded/gaps and excludes event-unavailable bundle reports from numeric sections rather than turning missing evidence into zeros.

```text
npm test -- test/services/telemetry/report.test.ts test/services/telemetry/report-html.test.ts test/services/telemetry/insights.test.ts
exit 0 — 3 files, 76 tests passed
```

### F6 — human acceptance truth and repaired operator guide

Replaced the false human-pass sentence with: `AC-25 zero-context documentation comprehension pending Jordan.` Mechanical docs evidence remains separate and no coder/reviewer statement is treated as human acceptance.

Updated the authored pull guide for the fixed selection fields, repository/ref/commit/tree/integrity schema, per-ref evidence, closed reader checks, candidate-first full-namespace transaction, filter-first reporting, N-of-M HTML/insight presentation, and measured-zero contributor rule.

```text
npm run gen:docs
exit 0 — wrote 12 docs to harness/cli/src/services/docs/docs-content.ts
```

Only the authorized generated `docs-content.ts` output was regenerated; no template, corpus, fixture, schema, package, lock, workflow, or Justfile generator ran.

### dlg-0006 integrated proof

```text
finding-focused privacy/selection/service/real-Git/bundle/reader/report/HTML/insights/act cluster
exit 0 — 11 files, 209 tests passed
```

The first full regression caught two TypeScript narrowing errors through the PTY suite; exact observed result:

```text
just test
exit 1
Test Files 1 failed | 220 passed (221)
Tests 2667 passed | 7 skipped (2674)
published-telemetry.ts(435,37): TS2345 string not assignable to SEGMENT_FIELD_KEYS literal union
telemetry-bundle-reader.ts(202,62): TS18046 product.values is unknown
```

Both owners were inside exact25. Corrected only the narrowing expressions, then reran:

```text
just test
exit 0
Test Files 221 passed (221)
Tests 2674 passed (2674)
Statements 89.04% | Branches 78.91% | Functions 91.20% | Lines 91.76%
```

The first Biome pass then reported formatting/import findings plus two `noUnsafeFinally` errors on injected cleanup failures. Replaced return-from-finally with one typed cleanup wrapper that always attempts removal and returns a safe cleanup failure without overriding operation control flow; formatted only exact25 TypeScript owners.

```text
npx --no-install tsc --noEmit -p harness/cli/tsconfig.json
exit 0

npx --no-install biome check harness/cli
exit 0 — Checked 408 files. No fixes applied.

finding-focused cluster after cleanup refactor/format
exit 0 — 11 files, 209 tests passed

just test final rerun
exit 0
Test Files 221 passed (221)
Tests 2674 passed (2674)
Statements 89.04% | Branches 78.90% | Functions 91.21% | Lines 91.76%

frozen corpus rehash
exit 0 — 31/31 SHA-size-mode exact
aggregate 4f5675a4799e9a6e39cbc0ea56d7356318e909dab5920310078ee3432757224a

template twin rehash
render/template.ts 5fd8d9329385510269222be18eba96bf3e97382e9bc9c38edf782e6a0c3ed71a exact
render/template.html dc0cf4355161bf619005e78c554e5209d330bca3969dd3af132fbc60db1bf773 exact

npm run check:docs
exit 0 — no drift

scoped telemetry-pull Markdown
exit 0 — 1 file, 0 errors

npm run check:telemetry-fixtures
exit 0 — 2 files, 20 tests passed; four committed instances covered

architecture no-direct-node-I/O
exit 0 — 1 file, 1 test passed

just windows-check
exit 0 — status:ok; scanned 24; findingCount 0
```

Final composite:

```text
HARNESS_NO_TELEMETRY=1 node harness/cli/bin/harness.js checks --json
exit 0 — Envelope status: degraded
tests: ok
biome: ok
typecheck: ok
check:docs: ok
check:flows: ok
check:telemetry-fixtures: ok
check:doctrine-parity: ok
arch-check: degraded (unchanged 2 warn-severity services-ports-type-only findings)
skills-check: ok
markdown-lint: degraded (unchanged 199 warn-launch findings: 197 lint, 1 link, 1 Mermaid)
windows-check: ok
```

All blocking gates are `ok`. The two architecture warnings and 199 Markdown findings are the independently reviewed pre-existing/non-P060 warn-launch baseline. The composite ran with telemetry disabled; no telemetry capture/sync or other outward action occurred.

## dlg-0007 second independent-review repair

Authority was exact26. The restored 69-path product, exact73 outer fence, 31-file corpus, template twins, package/lock/workflow/Justfile, and every path outside exact26 remained read-only.

### R1 — exact known types and credentials

Added wrong known type/null/missing/enum/range and required-resource AnyValue matrices before production repair. Ten new cases exposed current acceptance before the field-specific validator was installed. Segment 2.4/2.5 required/optional fields now use explicit type/null/range/enum contracts; required Logs/Metrics resource identities require exact `stringValue` kinds and valid values. GitHub classic/fine-grained, Bearer, private-key, password, credential, secret, and token-assignment shapes are rejected in every string channel before raw admission.

```text
published-telemetry + frozen privacy scan
exit 0 — 2 files, 75 tests passed
```

### R2 — repository-scoped membership

Exact RED:

```text
remote-selection + remote-service
exit 1 — 2 files; 23 passed, 4 failed
- same OID A=true/B=false
- same OID A=true/B=unavailable
- opposite repository order
- pure repository-scoped selection
```

Membership now remains keyed by repository through pure selection. Unavailable evidence stays an unresolved row/gap for inventory but is never selected into a pull because another repository marked the same OID true.

```text
remote-selection + remote-service
exit 0 — 2 files, 27 tests passed
```

### R3 — duplicate-ref logical union

The initial adversaries made explicit-sequence conflict and distinct identity-less evidence RED; the asymmetric later-ref case was then independently killed by a first-ref-only mutation. Each ref is now decoded independently. A canonical Logs+Metrics pair shadows only its local matching loose fallback; identical same-sequence claims dedupe; non-identical claims for one explicit sequence fail E222 with neither renumbered nor retained; distinct explicit and identity-less legacy evidence unions in deterministic sequence/ref/internal order.

```text
published-telemetry + privacy
exit 0 — 2 files, 75 tests passed
```

### R4 — exact bundle evidence

Exact RED:

```text
bundle + reader + publisher
exit 1 — 3 files; 18 passed, 2 failed
- camel/string gap shapes instead of public objects
- impossible 2026-02-30 emitted as known
```

The public manifest now uses exact snake-case `SelectionGap` objects and `{field,reason,refs}` `DataCoverageGap` objects. Dates use a real-calendar check. Per-ref products use unsigned ascending OIDs, and the reader compares each declared ref against independently decoded ref evidence. The corrected publisher fixture uses the reviewed manifest. A first per-ref-swap mutation probe exposed a vacuous fixture (`selected_ref_count:1` for two refs); the fixture was corrected to two, after which disabling only the per-ref comparison turned its named test RED while aggregate evidence remained unchanged.

```text
bundle + reader + publisher
exit 0 — 3 files, 21 tests passed
```

### R5 — whole returned coverage page

Exact RED:

```text
report-html
exit 1 — 11 passed, 2 failed
- returned page still contained/executed renderTotals and empty dimensions
- mixed evidence had no contributor-only analytics branch
```

Coverage-mode output now removes the legacy totals/dimension runtime from the returned page and replaces `<main>` with evidence coverage plus non-empty analytics only when event-substrate contributors exist. It does not prepend or CSS-hide the old UI. The no-coverage branch remains exactly `embedReports(REPORT_TEMPLATE_HTML, columns)` and both twins are untouched.

```text
report-html
exit 0 — 1 file, 13 tests passed
```

### R6 — bounded real Git and shaped paths

Exact RED:

```text
real Git adapter
exit 1 — 9 passed, 3 failed
- injected Windows-shaped store/hook paths ignored
- product timeout reset per subprocess
- store-creation exception escaped typed behavior
```

The real daemon suite now proves a truly divergent DAG, unavailable candidate, one total product deadline shared across endpoint/candidate/ancestry calls, no unfiltered fallback, typed creation/cleanup failure, and actual drive-letter/backslash/space-bearing store/hook values carried as single argv/path-seam values. Native Windows execution remains honestly unrun.

```text
real Git adapter
exit 0 — 1 file, 12 tests passed
```

### Residual AC-01/03/17/24

- Direct `--pij|--agent|--source|--offline|--refresh` invocation against both `ls` and `pull` exits through Commander invalid-args behavior before Git/output effects.
- Poisoned cwd origin/ref/buffer/vendor/PIJ files and environment do not alter results or call vectors and are never read; E220 remote failure cannot fall back.
- A true differing writer conflicts without replacing/mixing the first target. Pre-held fake and real `wx` locks remain owned by the first writer; post-acquire failure/success releases only the current writer's lock; only the losing writer's temp is removed.
- Windows-shaped store/hook and filesystem values remain single arguments/logical POSIX bundle/ref paths; static Windows proof stays green.

```text
act + errors
exit 0 — 2 files, 45 tests passed

FakeFs + bundle publisher
exit 0 — 2 files, 45 tests passed
```

### Serialized mutation proof

Every mutation target was backed up outside the repository, mutated alone, produced its named RED, and was restored by an exit trap before the next mutation:

```text
prior in-scope repeats: Metrics-description guard; date candidate predicate; telemetry namespace; telemetry path allowlist; reviewed matched_refs key; AC-25 pending-Jordan truth
new guards: known Segment type; GitHub token shape; repository membership; asymmetric ref loss; same-sequence conflict; strict calendar date; per-ref product swap; whole coverage DOM; total deadline; Windows-shaped argv; pre-held lock ownership; former flag acceptance; poisoned-local read
all expected RED; all restored
```

The prior filter-first mutation evidence remains recorded under dlg-0006 and its green report/HTML/insight tests remain in the full regression. It was not repeated because its `report.ts` owner is outside exact26; touching it even temporarily would have created a forbidden 27th path. One attempted `--reporter=basic` mutation probe failed at Vitest reporter loading and was discarded; the same mutation was rerun with the supported dot reporter and produced the intended behavioral RED.

### Integrated and full proof before final composite

```text
R1–R6 + residual focused cluster
exit 0 — 12 files, 235 tests passed

npx --no-install tsc --noEmit -p harness/cli/tsconfig.json
exit 0

npx --no-install biome check harness/cli
exit 0 — Checked 408 files. No fixes applied.

just test
exit 0
Test Files 221 passed (221)
Tests 2718 passed (2718)
Statements 88.49% | Branches 77.66% | Functions 90.52% | Lines 91.11%

frozen corpus rehash
exit 0 — 31/31 SHA-size-mode exact
aggregate 4f5675a4799e9a6e39cbc0ea56d7356318e909dab5920310078ee3432757224a

template twins
render/template.ts exact 5fd8d9329385510269222be18eba96bf3e97382e9bc9c38edf782e6a0c3ed71a
render/template.html exact dc0cf4355161bf619005e78c554e5209d330bca3969dd3af132fbc60db1bf773

npm run check:docs
exit 0 — no drift

scoped telemetry-pull Markdown
exit 0 — 1 file, 0 errors

npm run check:telemetry-fixtures
exit 0 — 2 files, 20 tests passed; four committed instances covered

architecture no-direct-node-I/O
exit 0 — 1 file, 1 test passed

just windows-check
exit 0 — status:ok; scanned 24; findingCount 0
```

Only `docs-content.ts` was regenerated. No template, corpus, fixture, schema, package, lock, workflow, or Justfile generator ran. AC-25 zero-context documentation comprehension pending Jordan.

Final composite:

```text
HARNESS_NO_TELEMETRY=1 node harness/cli/bin/harness.js checks --json
exit 0 — Envelope status: degraded
tests: ok
biome: ok
typecheck: ok
check:docs: ok
check:flows: ok
check:telemetry-fixtures: ok
check:doctrine-parity: ok
arch-check: degraded (unchanged 2 warn-severity services-ports-type-only findings)
skills-check: ok
markdown-lint: degraded (unchanged 199 warn-launch findings: 197 lint, 1 link, 1 Mermaid)
windows-check: ok
```

All blocking gates are `ok`. The architecture and Markdown findings are the already assessed warn-launch baseline. The composite ran with telemetry disabled; no telemetry capture/sync or other outward action occurred.

## dlg-0008 third independent-review repair

Authority was exact30. The restored 69-path product, exact73 outer fence, frozen corpus, template twins, package/lock/workflow/Justfile, and every path outside exact30 remained read-only.

### F1 — finite environment and closed string/attribute channels

The test-first current/legacy/credential/attribute matrix produced exact RED:

```text
capture + segment schema + segment serializer + published reader
exit 1 — 4 files; 108 passed, 36 failed
```

Segment 2.5 now captures and serializes only eight current pij keys with per-key identifier, harness/role enum, correlation, provider/model, and effort grammars. Segment 2.4 strict reads use that set plus only `PIJ_ID`, `PIJ_STATUS_KEY`, and `PIJ_PANE_ID`. Unknown keys and `PIJ_SPAWN_TASK` fail before raw admission. Full regression supplied two additional source-proven current harness enum values, `claude` and `copilot`; the first full run exposed each sequentially through the fleet compatibility oracle before the finite enum was corrected.

One exported pure credential detector now covers GitHub classic/fine-grained, AWS access/session identifiers, Slack/GitLab/common access-token prefixes, JWTs, Bearer, private keys, and secret/password/credential/token assignments. Capture, serializer, known strings, dynamic/additive strings, resource/env values, Logs attributes, and Metrics attributes all use it. Resource attributes are exact; each Logs event kind has one key/AnyValue vocabulary; Metrics datapoint semantic keys are closed. Validation still completes before `rawBlobs.push()`.

```text
F1 focused GREEN — 4 files, 144 tests passed
```

### F2 — producer-owned complete Metrics contract

Exact RED:

```text
Metrics producer + published reader
exit 1 — 2 files; 78 passed, 3 failed
- producer definition table absent
- emitted names could not be equated to definitions
- valid flow/tool/skill/exit Metrics rejected by the strict reader
```

`otlp/metrics.ts` now exports and consumes one ten-definition closed table covering activity, working ratio, flow-stage, token/cache, tool-call, skill-status, and command-exit families. Each definition fixes name, unit, sum/gauge kind, monotonicity, point type, required/optional attributes, and finite attribute values. The strict reader imports the same table; duplicate/unknown metrics, wrong kind/unit/point/temporality, missing/extra attributes, and wrong enums fail.

```text
F2 focused GREEN — 2 files, 81 tests passed
```

### F3 — canonical line ordinal is explicit sequence

Focused adversaries made equal canonical positions and cross-ref canonical conflict RED. Canonical one-based line ordinal is now `explicitSequence`; loose filenames retain numeric identity. Same-sequence equal claims dedupe, non-equal claims fail E222, different sequences survive equal payloads, canonical pair precedence remains local, and truly identity-less legacy claims are preserved without payload-only dedupe. The old two-ref product-swap fixture was updated from two conflicting canonical sequence-1 claims to valid explicit sequences 1 and 2.

```text
published reader GREEN — 1 file, 68 tests passed
```

### F4–F6 — public date/mode/selector closure

Exact RED evidence included:

```text
strict ls date
exit 1 — impossible 2026-02-30 rendered as known

bundle + reader + publisher
exit 1 — 3 files; 27 passed, 6 failed
```

`ls` now reuses `parseTelemetryAdvertisement()` and reports only real calendar dates; invalid evidence is null plus `date_provenance_unavailable`. Internal `commit` maps to public bundle mode `product-commit`; v1 has no `commit` alias. Reader selection validation checks runtime type before regex/order, requires exact null/non-null fields by mode, real ordered dates, safe non-empty session ids, and same-width lowercase full 40/64 OIDs.

```text
remote service GREEN — 1 file, 12 tests passed
bundle/reader/publisher GREEN — 3 files, 33 tests passed
```

### F7 — one static display model for every mixed column

Exact RED: the mixed-page test found the bundle label/analytics but no visible legacy column. Coverage mode now builds one pure final-page model for every column. Bundle columns carry N-of-M coverage and contributor-backed non-empty analytics; legacy columns carry visibly labelled event-substrate totals and non-empty rollups. The base `renderTotals`/`DIMS` runtime is removed rather than hidden or prepended. Unavailable evidence is not rendered as zero. The all-legacy branch remains exactly `embedReports(REPORT_TEMPLATE_HTML, columns)`; both template twins are untouched.

```text
report HTML GREEN — 1 file, 14 tests passed
```

### F8 — canonical target-wide writer lock

Exact RED:

```text
FakeFs/NodeFs + bundle publisher
exit 1 — 2 files; 44 passed, 4 failed
- canonical target identity port missing
- relative/dot/absolute/trailing aliases diverged
- content-keyed pre-held lock did not contend
```

`BundleFsPort.normalizeBundleTargetIdentity()` now owns target normalization. NodeFs uses native absolute resolution; FakeFs deterministically models relative, dot, trailing, drive-letter, slash/backslash, and `..` shapes. Publisher uses the canonical identity for existence/reuse/temp/publish and hashes only that identity into a parent-local lock. Aliases converge, distinct targets diverge, differing bytes for one target contend, target recheck remains, and lock/temp cleanup retains ownership safety without public path disclosure.

```text
filesystem/publisher GREEN — 2 files, 48 tests passed
```

### F9 — conditional repository filtering contract

The first help assertion was RED while both runtime branches already behaved correctly. Public help, source comments, and the guide now state that `--filter-repo` is applied before all calculations for repository-tagged bundle inputs and is echo-only for legacy `SessionExport` inputs lacking repository identity. The direct runtime test proves one tagged repository is selected while both legacy exports remain included with the filter echoed.

```text
telemetry act GREEN — 1 file, 42 tests passed
```

### Cumulative serialized mutation proof

Each accepted mutation used an out-of-repository byte backup and exit-trap restoration before the next mutation. Nineteen guards produced their named behavioral RED:

```text
current8 widened to legacy11
legacy11 narrowed to current8
shared credential detector disabled
Logs event attribute vocabulary opened
producer metric definition removed
Metrics datapoint vocabulary opened
canonical explicit sequence identity removed
strict ls calendar date bypassed
public product-commit mapping removed
selector same-width check removed
selector type-first session guard removed
mixed legacy display column dropped
target normalization disabled
content-keyed lock restored
conditional filter help removed
filter-first repository guard disabled
repository membership flattened
reviewed matched_refs key drifted
per-ref product comparison removed
```

Two initial probes were correctly rejected as vacuous and rerun against the owning secondary guard: removing only the preliminary Logs unknown-key check still failed closed in the per-attribute dispatch; canonical identity removal still preserved equal lines through the identity-less retention law. Opening the complete Logs dispatch and targeting same-sequence conflict respectively produced RED. The Metrics credential/resource test was split so its attribute and credential guards mutate independently.

The prior telemetry namespace and source-path allowlist owners are outside exact30, so they were not touched even temporarily. Their prior dlg-0006 mutation evidence remains recorded; the real-Git/full regressions keep the current guards green. No 31st repair path was created.

### Integrated and platform proof before final composite

```text
F1–F9 focused cluster
exit 0 — 12 files, 307 tests passed

just test first run
exit 1 — 220 files passed, 1 failed; 2772 passed, 1 failed
fleet-evidence expected source-proven PIJ_HARNESS `claude`; serializer dropped it
focused rerun then exposed source-proven `copilot`; finite enum corrected in exact30

just test final
exit 0
Test Files 221 passed (221)
Tests 2773 passed (2773)
Statements 88.61% | Branches 78.21% | Functions 90.84% | Lines 91.27%

npx --no-install tsc --noEmit -p harness/cli/tsconfig.json
exit 0

npx --no-install biome check harness/cli
exit 0 — Checked 408 files. No fixes applied.

npm run check:docs
exit 0 — no drift

scoped telemetry-pull Markdown
exit 0 — 1 file, 0 errors

npm run check:telemetry-fixtures
exit 0 — 2 files, 20 tests passed; four committed instances covered

architecture no-direct-node-I/O
exit 0 — 1 file, 1 test passed

just windows-check
exit 0 — status:ok; scanned 24; findingCount 0

frozen corpus rehash
exit 0 — 31/31 SHA-size-mode exact
aggregate 4f5675a4799e9a6e39cbc0ea56d7356318e909dab5920310078ee3432757224a

template twins
render/template.ts exact 5fd8d9329385510269222be18eba96bf3e97382e9bc9c38edf782e6a0c3ed71a
render/template.html exact dc0cf4355161bf619005e78c554e5209d330bca3969dd3af132fbc60db1bf773
```

Only `docs-content.ts` was regenerated. No template, corpus, fixture, package, lock, workflow, or Justfile generator ran. Native Windows remains unrun; shaped/static proof is green. AC-25 zero-context documentation comprehension pending Jordan.

Final composite:

```text
HARNESS_NO_TELEMETRY=1 node harness/cli/bin/harness.js checks --json
exit 0 — Envelope status: degraded
tests: ok
biome: ok
typecheck: ok
check:docs: ok
check:flows: ok
check:telemetry-fixtures: ok
check:doctrine-parity: ok
arch-check: degraded (unchanged 2 warn-severity services-ports-type-only findings)
skills-check: ok
markdown-lint: degraded (unchanged 199 warn-launch findings: 197 lint, 1 link, 1 Mermaid)
windows-check: ok
```

All blocking gates are `ok`. The architecture and Markdown findings remain the assessed warn-launch baseline. The composite ran with telemetry disabled; no telemetry capture/sync or other outward action occurred.

## dlg-0009 systemic fifth-fix repair

Authority was exact27. The restored final69, exact73 outer fence, frozen corpus, template twins, package/lock/workflow/Justfile, and every path outside exact27 remained read-only.

### N1 — positive field grammars and common credential defense

Cross-layer capture/serializer/schema/reconstruction/strict-reader adversaries were added before repair. The first focused run produced 23 expected failures, including Stripe `sk_live_*`, Google `AIza*`, novel opaque high-entropy values, non-`pij-*` current identities, non-`spawn-*` correlations, non-`status/*` legacy keys, arbitrary service versions/harnesses/commands/sessions, schema parity, and OTLP env/resource raw-retention cases.

Segment now owns positive validators for current pij ids, spawn correlations/provider-models, effort/role/harness values, semantic/fixture service versions, command/session/model/signature/path/time forms, and conservative low-entropy extensions. Segment-2.5 current capture remains exact8; Segment-2.4 reads remain the finite union11 with `PIJ_ID`, `status/*`, and `%<digits>` historical grammars. PIJ harness remains its closed current enum. The broader Segment harness role separately carries source-proven `codex`, `future-harness`, and `acme-harness-<digits>` compatibility forms; explicit empty session identity remains the established unavailable form.

The shared defense-in-depth classifier now includes GitHub, AWS, Stripe, Google, Slack/GitLab/package-token, JWT, Bearer, private-key, and assignment-shaped password/secret/credential/access-token classes. Capture, serializer, Segment strict reads, OTLP resource/env reconstruction, Logs, Metrics, and unknown additive strings all fail closed before `rawBlobs.push()`.

```text
N1 focused GREEN — 5 files, 191 tests passed
```

### N2 — producer-owned complete Logs contract

Exact RED:

```text
reconstruction + published strict reader
exit 1 — 3 named failures
- producer event table absent
- required/optional assertions absent
- mark fields lost during OTLP round-trip
```

`otlp/logs.ts` now exports one 17-event definition table consumed by encoder and strict reader. Every attribute declares required/optional status, exact AnyValue kind, applicable enum/range/string role, and event severity. Encoder output is checked against the table before return. Strict reading imports the same table; the former reader-local incomplete map was removed.

The matrix drives every event kind, deletes every required attribute, omits every present optional attribute, corrupts enums/ranges/types, and retains duplicate/unknown/resource/scope guards. `mark_kind`, counts, and optional verdict now round-trip losslessly. Source-proven `flow:active` remains in the closed flow-status enum alongside the current nav-derived states.

```text
N2 focused GREEN — 2 files, 103 tests passed
```

### N3 — producer-owned dependent Metrics tuples

Exact RED:

```text
Metrics producer + published strict reader
exit 1 — 5 named failures
- ten definitions had no tuple policy/validator
- output+cache_read accepted
- output+cache_create accepted
```

Every producer definition now declares `independent|token-buckets`, and `validateMetricDataPointTuple()` owns exact required/optional/unknown/enum checks plus dependent combinations. Producer construction validates every emitted datapoint; strict reading calls the same function. Plain input/output points omit `harness.token.type`; cache-read/create require `gen_ai.token.type=input` and the matching cache enum. Generated matrices cover all ten families and every emitted point.

```text
N3 focused GREEN — 2 files, 96 tests passed
```

### N4 — reason-specific gap referential integrity

Exact RED:

```text
selection + bundle + reader
exit 1 — 3 files; 43 passed, 10 failed
- ghost session/ref accepted
- known date/product claimed unavailable
- single-ref duplicate accepted
- manifest conflict could name a ghost
- complete/partial contradiction accepted
- unresolved producer dropped ref identity
```

Selection gaps now carry `ref:string|null`; unknown-only date and unresolved commit groups emit one strict advertisement ref per unavailable claim. Selector-irrelevant groups emit no gaps. Producer validation checks repository/session/ref identity, reason state, completeness, uniqueness, and unresolved evidence before serializing. Session duplicate/manifest gaps are derived into deterministic reason-specific rows.

The strict reader independently indexes repositories, selected sessions, refs, strict dates, per-ref product states, and decoder-derived manifest conflicts. It rejects ghost or mismatched identities, known evidence claimed unavailable, duplicate-session gaps with fewer than two refs, invented manifest conflicts, duplicate/reordered gaps, and complete/partial contradictions. Advertisement-only unresolved refs remain valid without fabricating sessions.

```text
N4 focused GREEN — 4 files, 67 tests passed
```

### N5 — explicit report input origin

Exact RED:

```text
report + act
exit 1 — 80 passed, 2 failed
- direct mixed union dropped the legacy export
- real act mixed path produced zero sessions
```

`TelemetryReportInput` now carries `origin:'legacy'|'bundle'`. Repository filtering and repository provenance apply only to bundle origins. Legacy exports remain included under repo filters in both direct and real act-level mixed paths; nonmatching bundle repositories are excluded. Other harness/model/branch/date filters retain their evidence-aware behavior. Scope, totals, coverage, excluded denominators, gaps, repository lists, and contributor counts derive from the same included set.

Public help and the guide state that mixed inputs retain every legacy `SessionExport` while repo filtering applies only to bundle origins.

```text
N5 + reader focused GREEN — 3 files, 113 tests passed
```

### Serialized cumulative mutation proof

Every mutation used an out-of-repository backup, ran alone, and restored the exact source bytes in `finally` before the next mutation. Thirty-two valid in-scope mutations produced their named RED:

```text
N1: current8 widened; legacy11 narrowed; current pij-id grammar opened; shared Stripe defense disabled; low-entropy extension guard opened; service-version grammar opened; Segment harness vocabulary opened; explicit empty-session form removed
N2: prompt required→optional; API signature optional→required; event definition removed; flow active enum removed
N3: token dependent tuple disabled; cache discriminator made globally required
N4: unavailable-date ref dropped; global reason consistency bypassed; gap ordering bypassed; completeness consistency bypassed; independently derived session evidence bypassed
N5: origin discriminator bypassed; legacy counted as a repository; origin help regressed
prior in-scope: canonical ordinal removed; real-calendar check bypassed; public product mode drifted; selector type-first removed; filter-first union bypassed; repository membership flattened; matched-ref count drifted; per-ref product comparison disabled; former `--pij` accepted; poisoned local `.git/config` read restored
```

Three preliminary probes were rejected as vacuous rather than counted: generated required/optional loops followed the mutated table, and the first session-gap edit left the independent check intact. Fixed external prompt/API requiredness assertions and an existing-but-nonconflicting manifest-ref adversary made all three corrected mutations RED.

The namespace/source-path, mixed-display, target-lock, deadline, and native-path owners are outside exact27 and were not touched even temporarily. Their dlg-0006–0008 mutation/runtime evidence remains recorded, and the final full regression retains their green guards. AC-25 truth is mutated separately after this log entry.

### Integrated and platform proof before final composite

```text
N1–N5 focused cluster
exit 0 — 12 files, 361 tests passed

just test first run
exit 1 — 216 files passed, 5 failed; 2807 passed, 7 failed (2814)
source-proven compatibility exposed: codex/future harness forms, empty unavailable session identity, and flow:active

compatibility focused rerun
exit 0 — 7 files, 96 tests passed

just test final
exit 0
Test Files 221 passed (221)
Tests 2818 passed (2818)
Statements 88.18% | Branches 77.82% | Functions 90.67% | Lines 90.89%

npx --no-install tsc --noEmit -p harness/cli/tsconfig.json
exit 0

npx --no-install biome check harness/cli
exit 0 — Checked 408 files. No fixes applied.

npm run check:docs
exit 0 — no drift

scoped telemetry-pull Markdown
exit 0 — 1 file, 0 errors

npm run check:telemetry-fixtures
exit 0 — 2 files, 20 tests passed; four committed instances covered

architecture no-direct-node-I/O
exit 0 — 1 file, 1 test passed

just windows-check
exit 0 — status:ok; scanned 24; findingCount 0

frozen corpus rehash
exit 0 — 31/31 SHA-size-mode exact
aggregate 4f5675a4799e9a6e39cbc0ea56d7356318e909dab5920310078ee3432757224a

template twins
render/template.ts exact 5fd8d9329385510269222be18eba96bf3e97382e9bc9c38edf782e6a0c3ed71a
render/template.html exact dc0cf4355161bf619005e78c554e5209d330bca3969dd3af132fbc60db1bf773
```

Only `docs-content.ts` was regenerated. No template, corpus, fixture, package, lock, workflow, or Justfile generator ran. Native Windows remains unrun; shaped/static proof is green. AC-25 zero-context documentation comprehension pending Jordan.

The first telemetry-disabled composite encountered a transient outside-exact27 real-Git transport failure in the transaction-restart test, despite that test passing in the preceding full suite:

```text
HARNESS_NO_TELEMETRY=1 node harness/cli/bin/harness.js checks --json
exit 1 — tests:error
Test Files 220 passed | 1 failed
Tests 2817 passed | 1 failed
exec-remote-telemetry-git.int.test.ts transaction-restart expected success; received typed transport failure
```

No outside-scope edit was made. The named real-daemon suite was rerun once and passed 12/12, establishing transient fixture transport rather than a reproducible dependency failure. The telemetry-disabled composite rerun then passed:

```text
real Git adapter targeted rerun
exit 0 — 1 file, 12 tests passed

HARNESS_NO_TELEMETRY=1 node harness/cli/bin/harness.js checks --json
exit 0 — Envelope status: degraded
tests: ok
biome: ok
typecheck: ok
check:docs: ok
check:flows: ok
check:telemetry-fixtures: ok
check:doctrine-parity: ok
arch-check: degraded (unchanged 2 warn-severity services-ports-type-only findings)
skills-check: ok
markdown-lint: degraded (unchanged 199 warn-launch findings: 197 lint, 1 link, 1 Mermaid)
windows-check: ok
```

All blocking gates are `ok`. The architecture and Markdown findings remain the assessed warn-launch baseline. The composite ran with telemetry disabled; no telemetry capture/sync or other outward action occurred.

Final scope proof: the fifth-fix delta is 25 unique paths, all inside exact27, with no 28th path. Every final69 path outside exact27 remains identity-exact; the product changed set remains exact69/69 inside exact73. Package, lock, index, and cached diff remain exact; the cached binary diff is empty. The corpus and both templates remained exact after the composite. No install, fan-out/reviewer, flow/ledger mutation, commit, push, PR, merge, release, deploy, remote telemetry, or other outward action occurred.

## Sixth systemic repair and closeout

### F1–F6 verified behavior

- **F1 — additive values:** unknown additive strings reject unless a producer-owned known field supplies a positive grammar. Unknown bounded, string-free structural values remain constrained. This is an allow-contract, not an entropy or provider-prefix heuristic.
- **F2 — Logs:** the producer-owned contract binds the envelope timestamp to `harness.event.t` and rejects unsupported observed timestamps.
- **F3 — Metrics:** the producer-owned contract validates full-datapoint-set tuple uniqueness and exact token-bucket cardinality.
- **F4 — repository gaps:** repository filtering preserves matching unresolved-only gaps through repository key and canonical identity, independently of selected sessions.
- **F5 — partial product evidence:** partial product-graph availability remains separate from telemetry provenance. Known-selected plus unavailable evidence produces a typed degraded bundle, while residual contradictions map to typed failures.
- **F6 — Git isolation:** every Git child receives an explicit safe environment and a disposable `--git-dir`; hostile inherited redirection cannot mutate caller Git state.

### Integration-test fixture-manager proof

Deterministic injected failures are **fixture-manager Dimension 0 control-flow tests only**, not product transport or safety evidence. Fixture-only replay exists only in the integration-test fixture manager. Production remains fail-closed and unchanged, with no retry added.

1. **D1:** a first synthetic typed transport failure triggered one visible fixture restart and whole-operation replay through a fresh adapter, followed by real second-attempt advertisement and snapshot success.
2. **D2:** a second typed transport failure remained terminal after the one allowed fixture replay.
3. **D3:** a non-transport semantic failure remained terminal without a fixture restart.

The final harness passed 40/40 serialized fresh-process poison/readiness runs. One real intermittent local loopback transport at lifecycle 7 produced one visible bounded fixture recovery; no operation recovered more than once, and there was no unrecovered failure. Five fresh full real-Git suites passed 17/17 each, for 85/85 total. Store, daemon, fixture-root, and caller state had zero delta throughout; existing ambient residue was neither deleted nor treated as proof.

### Integrated proof and honesty

The focused cluster passed 10 files and 313/313 tests. The full regression passed 221 files and 2,836/2,836 tests. TypeScript, Biome, documentation and flow drift, telemetry fixtures, the no-direct-node-I/O architecture test, skills, scoped Markdown, and shaped Windows checks passed. The telemetry-disabled composite exited 0 with every blocking gate `ok`; only the unchanged warn-launch architecture and Markdown baseline remained.

Two validation-wrapper count expectations were stale, without changing the underlying results. After an already-green 17/17 full process legitimately emitted 28 operations, its wrapper expected 20. After an already-green 313/313 focused process, its wrapper expected 312. The envelope expectations were corrected for subsequent observation where applicable; no source or product change and no result fabrication occurred.

The frozen corpus, templates, package, lock, index, cached state, and final path identities remained exact, and no additional product path appeared. AC-25 zero-context documentation comprehension remains pending Jordan. Native Windows remains unrun; shaped and static proof is green. No commit, push, PR, merge, release, deploy, real remote telemetry, or other outward action occurred.
