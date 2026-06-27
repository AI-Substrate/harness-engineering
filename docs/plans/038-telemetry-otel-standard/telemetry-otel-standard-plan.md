# Standardise Harness Telemetry to OTEL/OTLP

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-27
**Status**: READY
**Spec source**: unified (this file)

📚 Incorporates findings from `research-dossier.md`, `research-storage-and-transport.md`, and the two authoritative workshops (`workshops/001-otlp-emit-and-shape.md`, `workshops/002-storage-and-transport.md`).

---

## Business Specification

### Research Context

Three pre-plan investigations converged on a clean, low-risk migration:

- **The dossier** found exactly one place to stand: `serializeSegment` (`segment.ts:406`) is the sole serialization chokepoint (allowlist-by-construction; input never spread). Our two substrates map onto OTLP's two signals almost 1:1 — `event_stream` (14 event kinds) → **OTLP Logs**, derived `rollup` (6 measure groups) → **OTLP Metrics**, identity/window → **resource + scope attributes**. The local-storage shape the user sketched *is* the collector fileexporter format (JSON-Lines, one signal per file).
- **WS-A (OTLP emit & shape)** locked the OTEL-native **supplant** with a critical refinement: keep the typed internal event/rollup model + the single serialize chokepoint — only the *output* shape changes to OTLP. This preserves counts-only privacy and keeps ~18 adapter/event tests green by design. It fixed a hard **reconstruction invariant**, a **two-layer field-naming rule**, and a **Phase-0 sensor-first** test strategy.
- **WS-B (storage & transport)** locked **keep-and-harden git-refs** now (single-writer-per-`(date,session)`-ref → embarrassingly parallel, no fetch-to-write), **rejected git-notes** (reintroduces non-fast-forward contention + object bloat), and made the emit **transport-agnostic** so a future graduation to store-and-forward is a transport swap, not a reshape.

Both workshops are **authoritative** — this plan does not contradict them.

### Summary

Today the harness emits a counts-only `Segment` (schema v2.0) as bespoke JSON to a local buffer, then publishes it as git blobs to `refs/harness-telemetry/*` for the eng-thrive scraper. This work **supplants the stored shape with OTEL/OTLP** — the same data, re-serialized as OTLP Logs (`logs.jsonl`) + Metrics (`metrics.jsonl`), directly ingestible by any OTEL collector with zero translation — **while preserving local storage and full session-timeline reconstruction**. Because nothing has shipped externally, there is no back-compat constraint; we update the serializer, the schema + freeze test, and the scraper in lockstep.

### Goals

- **OTEL-native stored shape**: telemetry is stored and published as OTLP/JSON (logs + metrics), collector-ingestible without translation.
- **Lossless reconstruction**: the OTLP form fully reconstructs the session timeline — every event at its exact `timeUnixNano` (+ precision), inter-event working gaps, agent/human/idle time, and per-turn token buckets — proven by a round-trip test on real sampled sessions.
- **Privacy survives verbatim**: counts-only / allowlist-by-construction, opaque session id, repo-relative paths — all enforced at the single serializer and guarded by an extended byte-scan over the OTLP output bytes.
- **Insulated from semconv churn**: conform on the stable OTLP envelope; own all reconstruction-critical data under `harness.*` + a pinned `schema_url`.
- **Keep local + cheap transport**: keep storing locally; keep-and-harden the git-refs publish, made transport-agnostic for a clean future graduation.

### Non-Goals

- **No store-and-forward shipper this plan** (Q-B2 resolved: defer). We land the transport-agnostic spool emit (WS-B S4) only; the async uploader → OTEL Collector endpoint is the graduation plan when the ref-count tripwire trips.
- **No dedicated telemetry repo this plan** (Q-B1 resolved: stage H1). We document it and land the cheap hardening (H2 scoped advertisement, H4 session-id entropy, H5 idempotent retry); the dedicated-repo move (H1) is a staged follow-up.
- **No runtime OTEL SDK** (WS-A Q3): hand-roll the OTLP objects; the conformance oracle is a **test-only devDependency** (P10 — keep runtime lean).
- **No collector / background daemon at capture time** (dossier H-06): emit OTLP-shaped files at the existing synchronous seam; collection stays a downstream concern.
- **No experimental `gen_ai.agent.*` adoption**: only stable `gen_ai.usage.*` / `gen_ai.request.model`; everything experimental is quarantined behind one mapping module.

### Target Domains

> This repo has **not** initialized the formal domain registry (constitution §5 — `docs/domains/` absent). Work is tracked against the **telemetry service area** (`harness/cli/src/services/telemetry/`), with `architecture.md`'s Ports & Adapters boundaries as the enforced rules. No new domain is created.

| Domain (service area) | Status | Relationship | Role in This Feature |
|---|---|---|---|
| telemetry (segment + rollup + capture + sync) | existing | **modify** | Re-serialize the internal event/rollup model to OTLP; publish OTLP `.jsonl`; harden the git-refs transport |
| eng-thrive scraper | existing (internal consumer) | **modify** | Read OTLP `.jsonl` from `refs/harness-telemetry/*` instead of segment JSON (lockstep) |
| output kernel / ports | existing | **consume** | OTLP write goes through the existing fs port + atomic temp+rename; no new direct Node imports in services |

### Testing Strategy

- **Approach**: **Full TDD, sensor-first** (WS-A Phase 0). The deterministic sensors are built *first*, on real fixtures, so every serializer/storage change builds against green checks. This is the load-bearing backpressure: *"what realistic wrong implementation still passes?"* is answered by a concrete sensor before any code that could be wrong is written.
- **Rationale**: the migration's whole risk is silent fidelity loss (a dropped token bucket, a rebased timestamp, a silently-invalid OTLP line). Each is caught by a deterministic sensor, not eyeballing.
- **Focus areas**: reconstruction round-trip (deep-equal the oracle); OTLP conformance (collector-as-checker — empty emit = fail); privacy byte-scan over OTLP bytes; golden drift over the real corpus; `schema_url`/version assertion.
- **Excluded**: the ~18 green-by-design tests (all `*-adapter`, `*-events`, registry, command-signature) — the internal typed model is unchanged, so they stay untouched.
- **Mock usage**: **avoid mocks entirely** (constitution P3 — fakes over mocks, no `vi.mock`). The plan-037 real-fixture corpus (real Claude/Copilot-CLI/Copilot-VSCode/Cursor sessions) is the reconstruction oracle; injected fakes only for fs/git/clock ports.

### Documentation Strategy

- **Location**: `docs/how/` only. One operator-facing note covering the OTLP on-disk layout (one file per signal), the `schema_url` pinning policy, the two-layer field-naming rule, and the keep-and-harden git-refs contract + graduation tripwire.
- **Rationale**: internal infra change; no README/CLI surface change for end users.

### Complexity

- **Score**: CS-4 (large)
- **Breakdown**: S=2, I=2, D=2, N=1, F=1, T=2 (sum 10)
- **Confidence**: 0.80
- **Assumptions**: the typed internal event/rollup model is preserved (only output shape changes); plan-037 `expected-segment.json` fixtures are valid reconstruction oracles; OTLP/JSON envelope + stable `gen_ai.usage.*` are stable enough to pin.
- **Dependencies**: plan-037 fixture corpus; a conformance oracle devDependency (chosen in the Phase-0 spike, T001).
- **Risks**: see Risks & Assumptions + the Risks table.
- **Phases**: per user direction this is delivered in **Simple mode** (single phase, inline task table) despite the CS-4 surface — the inline tasks are strictly ordered sensors → serializer → storage → migration → docs, so the dependency boundaries are expressed in task order. Escalating to Full (phase-split) remains a cheap later option if the inline table proves unwieldy.

### Acceptance Criteria

1. **AC-01 — Reconstruction round-trip**: for each of the four plan-037 fixtures (claude, copilot-cli, copilot-vscode, cursor), a deterministic test reconstructs the session's `event_stream` + `rollup` from its OTLP `logs.jsonl` + `metrics.jsonl` and **deep-equals** that fixture's `expected-segment.json`.
2. **AC-02 — OTLP conformance (no silent drop), 3-way**: the output passes all three WS-A conformance legs — golden vs `opentelemetry-proto` `examples/{logs,metrics}.json`, a protobuf-JSON round-trip, and collector-as-checker (`otlpjsonfilereceiver`→debug) — with **non-empty** emitted output and lines-read equal to objects-emitted. Severity is part of conformance: `checks`-fail → WARN/ERROR, `command_exit` non-zero → ERROR, `api_error` → ERROR (per the WS-A logs table), asserted here because `severityNumber` is not a `Segment` field and so escapes AC-01's deep-equal.
3. **AC-03 — Timeline fidelity**: inter-event working gaps, agent/human/idle durations, and per-turn token buckets (including `cache_read` / `cache_create`) are recoverable from `logs.jsonl` alone — asserted within AC-01's round-trip.
4. **AC-04 — Privacy byte-scan**: a byte-scan over the OTLP output bytes finds no prompt/file/free-form content, no absolute `/Users/…` paths, and only an opaque `harness.session_id`.
5. **AC-05 — Lockstep schema/scraper**: the OTLP schema (successor to `segment.schema.json`) + its freeze test + the eng-thrive scraper are updated together; the freeze test pins the `harness.*` attribute set + `schema_url` (key-set equality + `additionalProperties:false`).
6. **AC-06 — OTLP publish, transport-agnostic**: the local buffer and `refs/harness-telemetry/*` publish OTLP `.jsonl` (exactly one signal per file); the emit writes to a spool that the transport ships (no transport coupling in the serializer).
7. **AC-07 — Hardened keep**: the git-refs concurrency model is unchanged (single-writer-per-`(date,session)`-ref); `harness.session_id` entropy is verified globally-unique and an idempotent retry (check-exists before push) is added.
8. **AC-08 — semconv quarantine**: only stable `gen_ai.usage.*` / `gen_ai.request.model` are adopted; experimental `gen_ai.agent.*` and cache-token granularity are isolated behind one mapping module (cache buckets live under `harness.*`).
9. **AC-09 — Golden drift**: `telemetry-fixtures.mjs --check` regenerates `expected-otlp-{logs,metrics}.jsonl` from the raw corpus and matches the committed goldens byte-for-byte.
10. **AC-10 — Metric temporality**: metrics use cumulative-per-session temporality (`startTimeUnixNano` = session start, `timeUnixNano` = session end), one datapoint per measure; `rollup: null` emits **no** datapoints (never zero-valued).

### Risks & Assumptions

| Risk / Assumption | Impact | Mitigation |
|---|---|---|
| `gen_ai.*` semconv is experimental | naming churn breaks upstream interop | Adopt only stable `gen_ai.usage.*`; quarantine the rest behind one mapping module; pin the targeted semconv version (AC-08) |
| `t → timeUnixNano` precision loss | estimated timestamps look exact | Carry `t_precision ≠ exact` as `harness.t_precision` so honesty is preserved (round-trip asserts it) |
| Valid-JSON-but-invalid-OTLP silently dropped | a whole session lost on ingest | collector-as-checker sensor: empty emit = test failure (AC-02) |
| A second serialization path bypasses the allowlist | content leak | Emit strictly *from* the serialized internal model; extend the byte-scan to OTLP bytes (AC-04) |
| `rollup: null` on empty stream | fabricated zero metrics | Omit datapoints, never zero-fill (AC-10) |
| CS-4 surface delivered in Simple mode | one large inline task table | Tasks strictly ordered by dependency; Full-mode phase-split available later if needed |

### Open Questions

None blocking. The two pre-plan forks are resolved here: **Q-B1** (dedicated repo) → stage H1, land H2/H4/H5 now; **Q-B2** (shipper) → defer, land transport-agnostic emit only. **Q-A2** (conformance oracle devDependency) is a Phase-0 spike (T001). **Q-A3** (keep `expected-segment.json` as the permanent reconstruction oracle) → keep.

### Workshop Opportunities

None — both design workshops (OTLP emit & shape; storage & transport) are complete and authoritative.

| Topic | Type | Why Workshop | Key Questions |
|---|---|---|---|
| _(none — design space closed)_ | — | — | — |

### Clarifications

#### Session 2026-06-27

- **Workflow Mode** → Simple (user direction, overriding the CS-4 Full recommendation).
- **Testing Strategy** → Full TDD, sensor-first (per WS-A Phase 0).
- **Mock Usage** → Avoid mocks entirely; real fixtures + injected fakes (constitution P3).
- **Documentation Strategy** → `docs/how/` only.

---

## Planning Seam

_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — all resolved (WS-A + WS-B authoritative).

| Artifact | Present? | Effect on the plan |
|---|---|---|
| research-dossier.md | y | informs Key Findings (F-01…F-10, H-01…H-07) |
| research-storage-and-transport.md | y | Parts A/B/C → storage/transport tasks + tripwire |
| workshops/001-otlp-emit-and-shape.md | y | authoritative: OTLP shape, two-layer naming, Phase-0 sensors, test surface |
| workshops/002-storage-and-transport.md | y | authoritative: keep-and-harden git-refs, H1–H8, graduation tripwire |

---

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|---|---|---|---|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` markers; Round 1 resolved conversationally |
| G2 | Constitution | PASS | Preserves P12 (counts-only/public-safe), P2 (ports), P3 (fakes-not-mocks); P10 honored — conformance oracle is a devDependency, no runtime OTEL SDK |
| G3 | Architecture | PASS | OTLP serializer is a pure service transform; write stays behind the fs port + atomic temp+rename; no new direct Node imports in services |
| G4 | ADR Compliance | N/A | No `docs/adr/` in this repo |
| G5 | Structure | PASS | All required sections present and populated |
| G6 | Testing Alignment | PASS | Full TDD — sensor/test tasks (T002–T005) precede all serializer/storage tasks; ACs are measurable |
| G7 | Domain Completeness | PASS | No domain registry (constitution §5); telemetry is the single existing service area; Domain Manifest covers every file referenced below |

### Summary

Build the deterministic sensors first (reconstruction round-trip, OTLP conformance, privacy byte-scan, golden drift) on the plan-037 real corpus, then re-serialize the preserved internal event/rollup model to OTLP Logs + Metrics through the single chokepoint, publish OTLP `.jsonl` via the hardened keep-and-harden git-refs transport (transport-agnostic emit), and update the schema + freeze test + scraper in lockstep. The internal typed model is untouched, so ~18 adapter/event tests stay green; the change is a sensor-guarded transcription, not a redesign.

### Domain Manifest

| File | Domain | Classification | Rationale |
|---|---|---|---|
| `harness/cli/src/services/telemetry/segment.ts` | telemetry | internal | The serialize chokepoint (`serializeSegment`/`serializeEvent`) re-targets to OTLP |
| `harness/cli/src/services/telemetry/otlp/` *(new)* | telemetry | internal | Hand-rolled OTLP Logs/Metrics builders + the `gen_ai.*` mapping module |
| `harness/cli/src/services/telemetry/rollup.ts` | telemetry | internal | Rollup → metric datapoints (cumulative-per-session); `flow_log` exclusion preserved |
| `harness/cli/src/services/telemetry/capture-service.ts` | telemetry | internal | OTLP `.jsonl` write at the existing seam (atomic temp+rename, fs port) |
| `harness/cli/src/services/telemetry/sync-service.ts` | telemetry | internal | Publish OTLP `.jsonl`; harden (entropy verify, idempotent retry) |
| `harness/cli/src/services/telemetry/segment.schema.json` → OTLP schema | telemetry | contract | Schema reshape + `schema_url` pin (lockstep with freeze test) |
| eng-thrive scraper *(consumer)* | eng-thrive | cross-domain | Read OTLP `.jsonl` instead of segment JSON (lockstep) |
| `harness/cli/test/services/telemetry/**` | telemetry | internal | Rewritten / net-new / extended sensors + goldens (see test surface) |
| `harness/cli/scripts/telemetry-fixtures.mjs` | telemetry | internal | Mint + `--check` `expected-otlp-{logs,metrics}.jsonl` |
| `docs/how/telemetry-otlp.md` *(new)* | docs | internal | Operator note: layout, `schema_url`, keep-and-harden contract + tripwire |

### Key Findings

| # | Impact | Finding | Action |
|---|---|---|---|
| 01 | Critical | `serializeSegment` (`segment.ts:406`) is the sole serialization site; allowlist-by-construction (input never spread). Privacy is inherited only if OTLP is emitted *from* the serialized model, never from raw adapter output (F-01). | Build the OTLP emitter strictly downstream of the serialized internal model |
| 02 | Critical | Counts-only / opaque-session / repo-relative privacy is a locked constitutional invariant (P12; dossier H-01/H-02/H-05) that must survive verbatim. | Extend the byte-scan over OTLP bytes; no message/body text invented |
| 03 | High | `event_stream` (14 kinds, each `t` + `t_precision`) → OTLP Logs; `rollup` (6 measure groups, `flow_log`-excluded) → OTLP Metrics (F-03/F-04). | Implement per the WS-A event→logRecord + rollup→metric tables verbatim |
| 04 | High | OTLP envelope + stable `gen_ai.usage.*` are stable; `gen_ai.agent.*` + cache-token granularity are experimental (F-04, dossier risk table). | Two-layer naming: own reconstruction data under `harness.*` + pinned `schema_url`; quarantine experimental attrs |
| 05 | High | fileexporter on-disk = JSON-Lines, exactly one signal per file; ingest path is `otlpjsonfilereceiver`, which silently drops valid-JSON-but-invalid-OTLP (F-09, research Part A). | One `.jsonl` per signal; collector-as-checker sensor guards silent drops |
| 06 | High | `segment.schema.json` `required` includes `event_stream`+`rollup`; `segment-schema.test.ts` pins key-set equality + `additionalProperties:false`; scraper reads our own JSON from refs — internal, not a public break (F-05/F-06, H-03). | Update schema + freeze test + scraper in lockstep |
| 07 | High | git-refs is single-writer-per-`(date,session)`-ref (`sync-service.ts:24-28,290-306`) → no fetch-to-write, zero write contention; git-notes is lateral-to-worse (research C1/C3). | Keep-and-harden; reject git-notes; verify session-id entropy + add idempotent retry |
| 08 | Medium | Metric temporality: cumulative-per-session is the honest offline fit (research A4), refining the dossier's earlier DELTA lean. | One datapoint per measure; `startTimeUnixNano`=session start, `timeUnixNano`=session end; `rollup:null` ⇒ no datapoints |

### Implementation

**Objective**: Supplant the stored telemetry shape with OTEL/OTLP (logs + metrics), losslessly and privately, over a hardened keep-and-harden git-refs transport — sensors first.

**Testing Approach**: Full TDD, sensor-first. T002–T005 land deterministic sensors (RED against the not-yet-built serializer) on the plan-037 real corpus before any serializer/storage task; every later task drives a sensor GREEN. Real fixtures + injected fakes only — no mocks.

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [x] | T001 | **Phase-0 spike**: stand up WS-A's **3-way conformance** harness (golden-vs-`opentelemetry-proto` `examples/{logs,metrics}.json` · protobuf-JSON round-trip · collector-as-checker via `otlpjsonfilereceiver`→debug); Q-A2 chooses only the **devDependency** that backs the round-trip/checker legs (`@opentelemetry/otlp-transformer` vs a vendored proto-JSON validator). | telemetry | `harness/cli/package.json` (devDeps), CI | All three conformance legs are invocable from tests; the devDep choice is recorded in the docs note | SENSORS · resolves Q-A2; 3-way per WS-A Q3; devDep only (P10) |
| [x] | T002 | **Reconstruction round-trip sensor** (RED): `raw → OTLP → reconstruct(event_stream+rollup) → deep-equal expected-segment.json` across all four 037 fixtures; asserts gap deltas, agent/human/idle, token buckets. | telemetry | `harness/cli/test/services/telemetry/reconstruction.test.ts` (new) | Test exists and fails only because the OTLP serializer is absent; oracle wired to `expected-segment.json` | SENSORS · AC-01, AC-03; the load-bearing proof |
| [x] | T003 | **OTLP conformance sensor** (RED): every `logs.jsonl`/`metrics.jsonl` line passes all three T001 legs with non-empty emit; lines-read == objects-emitted (silent-drop guard); **asserts `severityNumber`** per the WS-A logs table for `checks`/`command_exit`/`api_error`. | telemetry | `harness/cli/test/services/telemetry/otlp-conformance.test.ts` (new) | Test exists; empty/invalid OTLP ⇒ failure; a flat-INFO severity emit fails; known-bad fixture is the negative control | SENSORS · AC-02; severity sensored here (escapes AC-01 deep-equal) |
| [x] | T004 | **Privacy byte-scan over OTLP bytes**: extend the scan to the OTLP output path — no content, no absolute paths, opaque session id only; add a known-leak negative control. | telemetry | `fixture-privacy-scan.test.ts`, `fixture-scrub.test.ts` | OTLP bytes scanned; planted-leak fixture fails the scan | SENSORS · AC-04 |
| [ ] | T005 | **Golden drift sensor + minting**: `telemetry-fixtures.mjs` mints `expected-otlp-{logs,metrics}.jsonl` from the raw corpus and `--check` matches committed goldens; retarget the goldens-carrying e2e/int tests to assert OTLP `.jsonl`. | telemetry | `scripts/telemetry-fixtures.mjs`, `fixture-extract.test.ts` (+F005 guard), `real-capture.e2e.test.ts`, `copilot-vscode-sqlite.int.test.ts` | `--check` is green over the real corpus; goldens committed; both e2e/int tests assert OTLP, none left on the old segment shape | SENSORS · AC-09; full WS-A goldens row |
| [x] | T006 | **`harness.*` OTLP schema + `schema_url` pin + version assertion**: define the schema (successor to `segment.schema.json`); pin OTLP/proto version + `schema_url`; assertion test for key-set equality + `additionalProperties:false`. | telemetry | OTLP schema file, `segment-schema.test.ts` (retarget) | Schema + freeze test pin the `harness.*` attribute set + `schema_url` | SERIALIZER · AC-05; two-layer naming |
| [x] | T007 | **event_stream → OTLP Logs**: serialize the 14 event kinds to `logRecords` per the WS-A table (`eventName`=kind, `timeUnixNano`=`t`×1e6, **per-kind severity** — INFO default, `checks`-fail→WARN/ERROR, `command_exit` non-zero→ERROR, `api_error`→ERROR, `harness.t_precision` when `≠exact`); resource attrs once per session. | telemetry | `segment.ts`, `services/telemetry/otlp/logs.ts` (new) | T002 reconstruction passes for the logs half; T003 conformance green on `logs.jsonl` incl. the severity assertion | SERIALIZER · AC-01/02/03; from the serialized model only |
| [x] | T008 | **rollup → OTLP Metrics**: serialize the 6 measure groups to metric datapoints per the WS-A table; cumulative-per-session temporality; `flow_log` excluded; `rollup:null` ⇒ no datapoints. | telemetry | `rollup.ts`, `services/telemetry/otlp/metrics.ts` (new) | T002 reconstruction passes for the rollup half; T003 green on `metrics.jsonl`; AC-10 holds | SERIALIZER · AC-10 |
| [x] | T009 | **`gen_ai.*` mapping module**: isolate all semconv attribute naming; adopt only stable `gen_ai.usage.*`/`gen_ai.request.model`; cache buckets under `harness.usage.*`; experimental attrs quarantined. | telemetry | `services/telemetry/otlp/semconv.ts` (new) | Only stable attrs leave the module; swapping a name touches one file | SERIALIZER · AC-08 |
| [x] | T010 | **Wire OTLP write at the capture seam (transport-agnostic spool)**: write `logs.jsonl` + `metrics.jsonl` via the fs port with atomic temp+rename to the spool the transport reads; no transport coupling in the serializer. | telemetry | `capture-service.ts` | Both `.jsonl` files written atomically per session; serializer has no transport knowledge | STORAGE · AC-06; WS-B S4 |
| [x] | T011 | **Publish OTLP `.jsonl` over keep-and-harden git-refs**: sync the spooled `.jsonl` to `refs/harness-telemetry/*`, concurrency model unchanged (single-writer-per-`(date,session)`-ref). | telemetry | `sync-service.ts` | Refs hold OTLP `.jsonl`; `sync-service.test.ts` green; no fetch-to-write introduced | STORAGE · AC-06/07 |
| [x] | T012 | **Harden the keep (H4/H5)**: verify `harness.session_id` is globally-unique high-entropy; add idempotent retry (check-exists before push); keep the existing buffer rollback. | telemetry | `sync-service.ts`, `capture-service.ts` | Entropy asserted in a test; re-push of an existing ref is a no-op, not an NFF loss | STORAGE · AC-07; H1 staged (Non-Goal) |
| [—] | T013 | **DEFERRED → eng-thrive repo.** Update the eng-thrive scraper (lockstep): read OTLP `.jsonl` from the refs instead of segment JSON. *No scraper source exists in this repo — eng-thrive is a downstream consumer. Its read contract is folded into T016; the scraper change lands in eng-thrive's own repo/plan.* | eng-thrive | (out-of-repo) | Contract documented in T016; scraper migration tracked in eng-thrive | MIGRATION · AC-05 |
| [x] | T014 | **Retarget the rewritten tests**: `segment.test.ts`, `events-rollup.test.ts`, `services/record/segment-record.test.ts` assert the OTLP output + `harness.*` schema. | telemetry | the four rewritten test files | All four green against the OTLP serializer | MIGRATION · the WS-A "Rewritten" row |
| [ ] | T015 | **Touched-storage tests hold `.jsonl`**: update `acts/telemetry.test.ts`, `capture-service.test.ts`, `pending-telemetry.test.ts`, `housekeeping.test.ts`, `gitignore.test.ts`, `capture-perf.test.ts`, `killswitch-failsafe.test.ts`; confirm the ~18 green-by-design tests stay untouched + green. | telemetry | the touched-storage test files | Buffer/refs tests assert `.jsonl`; full suite green; green-by-design set unchanged | MIGRATION · WS-A test surface |
| [ ] | T016 | **Operator doc** (`docs/how/`): OTLP on-disk layout (one file per signal), `schema_url` policy, two-layer naming, keep-and-harden git-refs contract + the graduation tripwire (ref-count thresholds), **+ the ref-tree read contract the eng-thrive scraper must follow (folded from T013): shard ref `refs/harness-telemetry/<YYYY>/<MM>/<DD>/<session>`, flat tree of `<seq>.logs.jsonl` + `<seq>.metrics.jsonl`, partial/legacy `<seq>.json` fallback**. | docs | `docs/how/telemetry-otlp.md` (new) | Note covers layout, schema pinning, transport contract, tripwire, the staged H1 / deferred shipper, and the scraper read contract | DOCS · ties off Q-B1/Q-B2 + T013 |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|---|---|---|
| AC-01 | T002, T007, T008 | reconstruction round-trip deep-equals `expected-segment.json` (4 fixtures) |
| AC-02 | T001, T003 | conformance oracle: non-empty emit, lines-read == objects-emitted |
| AC-03 | T002, T007 | round-trip asserts gaps + agent/human/idle + token buckets |
| AC-04 | T004 | byte-scan over OTLP bytes + planted-leak negative control |
| AC-05 | T006, T013, T014 | freeze test pins `harness.*` + `schema_url`; scraper reads OTLP |
| AC-06 | T010, T011 | one `.jsonl` per signal; transport-agnostic spool emit |
| AC-07 | T011, T012 | single-writer-per-ref preserved; entropy + idempotent retry |
| AC-08 | T009 | only stable `gen_ai.usage.*` leave the mapping module |
| AC-09 | T005 | `telemetry-fixtures.mjs --check` matches goldens |
| AC-10 | T008 | cumulative-per-session datapoints; `rollup:null` ⇒ none |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Silent OTLP drop on ingest | Medium | High | collector-as-checker sensor (T003); empty emit = fail |
| Fidelity loss (dropped bucket / rebased time) | Medium | High | reconstruction round-trip on real fixtures (T002); built RED first |
| semconv churn reaches reconstruction data | Low | Medium | two-layer naming; `harness.*` + pinned `schema_url` (T006, T009) |
| Privacy regression via new serialization path | Low | High | emit from serialized model only; extended byte-scan (T004) |
| Schema/scraper drift out of lockstep | Medium | Medium | T013/T014 in the same change; freeze test gate (T006) |
| Simple-mode inline table too large to track | Medium | Low | strict dependency ordering; Full-mode phase-split available later |
