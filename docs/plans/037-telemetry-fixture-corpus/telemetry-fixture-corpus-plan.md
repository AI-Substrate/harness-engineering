# Telemetry Fixture Corpus — Real-Log Capture, Scrub & End-to-End Validation
**Mode**: Full
**Plan Version**: 1.0.0
**Created**: 2026-06-25
**Status**: READY
**Spec source**: unified (this file)

ℹ️ Research was done in-conversation (no `research-dossier.md`): the current all-synthetic fixture strategy was mapped, all four surfaces confirmed present on this machine, and the scrub policy + tooling home were resolved via a `/grill-me` pass. Two Part-B research subagents (domain/pattern scout, risk/constraint finder) grounded the gates below.

---

## Business Specification

### Summary
Today every telemetry adapter test is fed **synthetic, hand-authored** input (`FakeDb`/`FakeFs` rows + three hand-crafted JSONL/TXT fixtures), and **no test drives a real captured harness log end-to-end** through an adapter to a serialized segment. We cannot prove the extractors handle the shapes the four surfaces really emit, and we have no realistic corpus to build the next surfaces/features against. This plan captures **real sessions from this machine**, scrubs them to a publication-safe boundary while keeping verbatim prompts + tool usage, commits them as a **per-instance fixture library**, and adds **golden + invariant end-to-end tests** — regression-guard first, living dev corpus second. The capture/scrub/extract tooling ships as a **`.harness` extension** (reference-available, never compiled into the published CLI).

### Goals
- A **regression guard**: real captured input → adapter → `serializeSegment` asserted against a per-instance **golden segment** plus **hand-pinned invariants** (counts/totals/privacy) derived independently of the adapter.
- A **living corpus**: capture instances now; drop more alongside later; tests select which fixture(s) they exercise.
- A **first-class, documented regeneration path** so re-capturing next time is a supported workflow, not archaeology.
- **Publication safety**: scrubbed fixtures that satisfy Constitution P12, proven by an automated **raw-fixture byte-scan** and a named manual review.

### Non-Goals
- **Not** replacing the three existing synthetic fixtures — they keep their hand-derived, negative-control unit assertions; real captures are **additive**.
- **Not** shipping a public `harness` CLI verb — the tool lives as a `.harness` extension (dogfood/reference) and does not enter the published npm surface.
- **Not** building a new telemetry surface or changing any adapter's extraction logic (bug fixes surfaced by real data are out-of-scope follow-ups, logged not fixed here).
- **Not** formalizing a `docs/domains/` registry.

### Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| telemetry | existing (informal — no registry) | **modify** | Add a real-capture fixture corpus + E2E tests beside the adapters; add a pure scrub/extract service |
| _tooling (`.harness` extension + `scripts/`) | existing | **modify** | Capture command as a `.harness` extension; `--check` drift guard as a `scripts/*.mjs` generator |
| _governance (`docs/project-rules`) | existing | **modify** | One Deviation Ledger row for committing scrubbed session content |

No domain registry exists (`docs/domains/` absent), so domains are informal; no new domain documents are created (Non-Goal).

### Testing Strategy
- **Approach**: **Hybrid.** TDD for the **pure scrub/normalize/extract logic** (deterministic functions — tests first). **Fixture-golden + invariants** for the adapter→segment E2E. A dedicated **raw-fixture byte-scan** privacy test for the committed files themselves.
- **Rationale**: the scrub is a correctness *and* a compliance control — it earns test-first rigour. The adapters already exist; their E2E proof is data-driven, not logic-driven.
- **Focus areas**: scrub completeness (paths/identity/secrets across POSIX + Windows shapes); the raw-fixture byte-scan (the *only* guard for committed input); golden drift detection; the real `node:sqlite` round-trip.
- **Excluded**: re-testing adapter internals already covered by the synthetic unit tests; perf (the existing `capture-perf.test.ts` keeps its own synthetic fixture).
- **Mock usage**: **Real data / fixtures only** — feed real scrubbed fixtures through the existing `FakeFs`/`FakeDb`/`FakeEnv` Ports; build a **real throwaway `node:sqlite`** for the SQLite E2E. No behavioral mocks.

### Documentation Strategy
- **Location**: `docs/how/telemetry-fixtures.md` (the capture→scrub→review→promote runbook) + the extension's `instructions.md`.
- **Rationale**: regeneration must be a documented, repeatable maintainer workflow; the user explicitly asked for "good doco on how to do it."

### Complexity
- **Score**: CS-4 (large)
- **Breakdown**: S=2, I=1, D=1, N=1, F=2, T=2
- **Confidence**: 0.80
- **Assumptions**: see Risks & Assumptions. **Dependencies**: existing telemetry adapters/Ports, `node:sqlite` (Node ≥22), `scripts/flow-fixtures.mjs` pattern. **Risks**: see below. **Phases**: 3.

### Acceptance Criteria
1. **AC-01** — A real, scrubbed **claude** session fixture is committed under the telemetry fixtures dir; a test drives it through `claudeAdapter` → `serializeSegment` and asserts a committed **golden segment** plus hand-pinned **invariants** (token `grand_total`, prompt count, and that `event_stream` is present with **exact** ISO timestamps — the timestamped path synthetic fixtures never exercise. *(Correction, T008: claude carries real per-line timestamps → events are exact, NOT `t_precision==='anchored'`; `anchored` is for approximated stamps — cursor/synthetic.)*
2. **AC-02** — A **byte-scan** test asserts every committed real artifact's *bytes* — both the raw input fixtures **and** their `expected-segment.json` goldens (out-of-repo paths serialize to a basename, which can itself be identifying) — contain no `/Users/…`, no `C:\…`, no home-username token, no API-key-shaped strings, and no configured person-name. The scanner's **liveness** is proven by feeding it a known-bad string **in test code** and asserting it *flags* it (so the absence-assertion on real artifacts can't pass vacuously) — **no banned-token control is ever committed into the published corpus**.
3. **AC-03** — A real, scrubbed **copilot-cli** fixture (`events.jsonl` + process-log) is committed; an E2E test asserts its golden segment including **token correlation** from the process log.
4. **AC-04** — A **copilot-vscode** extracted-rows fixture is committed; an **int-test builds a throwaway real `node:sqlite`** from those rows and runs the adapter's actual SQL through `NodeDb` to a golden segment. If the live store yields too few turns, the thin capture is documented and the test still proves the SQL round-trip.
5. **AC-05** — A real, scrubbed **cursor** fixture (the on-disk agent transcript JSONL + the `cursorDiskKV` model/timing rows extracted from `state.vscdb`) is committed; an E2E test asserts its golden segment including the transcript↔bubble **model/timing join**. The synthetic `cursor-transcript.jsonl` is retained unchanged.
6. **AC-06** — The capture/scrub/extract tool ships as `.harness/extensions/telemetry-fixtures/` with **pure scrub logic unit-tested in isolation**; no `node:*` in service logic; all I/O via injected Ports at the extension's `run()` composition root; path scrubbing **reuses `shared/posix-path.ts`** (no bespoke path math).
7. **AC-07** — A **`--check` drift guard** that reuses `scripts/flow-fixtures.mjs`'s `--check` *drift contract* (regenerate → `git`-clean assertion → non-zero on drift), regenerates goldens, and **fails when a committed golden diverges** from a re-extract; wired to a `just`/npm target and runnable in CI. Because the plan ships **no public CLI verb** (Non-Goal), the regen entrypoint **imports the built `dist/` telemetry adapter + `serializeSegment` modules directly** (it does *not* shell a `harness telemetry …` bin the way `flow-fixtures.mjs` shells `flow render`).
8. **AC-08** — `docs/how/telemetry-fixtures.md` documents **capture → gitignored `scratch/` → scrub → manual "anything bad" review → promote**, with the manual review a named, **non-skippable** step.
9. **AC-09** — A **Deviation Ledger** row (rules §9) records the deliberate commit of *scrubbed* session content (the P12 `scratch/`-only exception), naming scrub + raw-scan test + manual review as the controls.
10. **AC-10** — The three existing synthetic fixtures and the tests that read them are **unchanged** (additive, not replaced); `capture-perf.test.ts` keeps its synthetic fixture.

### Risks & Assumptions

| Risk / Assumption | Note |
|---|---|
| **P12 publication boundary** | Committing verbatim prompts/commands to a *public* repo is exactly what Constitution P12 / Rules §1 constrain. The scrub is the compliance control; capture stages through gitignored `scratch/`; a Deviation Ledger row records the exception. |
| **Raw fixture = sole guard** | The allowlist serializer protects *output* only; the committed raw fixture's safety rests entirely on the scrub → the AC-02 byte-scan is mandatory, with a planted negative-control so it can't rubber-stamp. |
| **Cross-platform path shapes** | A captured macOS session won't contain `C:\`, but Windows users' commands will; the scrubber normalizes both separator styles, the claude `-Users-<user>-…` project-dir mangle, drive-letter/UNC forms — reusing `relativizePath`/`toPosix`, never rolling its own. |
| **Cursor capture path** | Cursor's agent transcripts persist on disk at `~/.cursor/projects/<mangled-cwd>/agent-transcripts/<conv>/<conv>.jsonl` (+ `state.vscdb` for model/timing). `AGENT_TRANSCRIPTS` being unset only blocks the *runtime adapter's auto-detection*, not capture — the extension reads the path directly and passes the conv id (= filename) as `CURSOR_CONVERSATION_ID`. **Caveat:** many on-disk conversations are short stubs and cursor self-redacts some assistant text → pick a substantive conversation for the fixture. |
| **copilot-vscode thin store** | `session-store.db` is ~4 KB here → possibly few turns. Capture what exists; if thin, the SQL round-trip int-test still proves the mechanism. |
| **`node:sqlite` is read-only in `NodeDb`** | The throwaway-db test builds the db writable (`DatabaseSync` without `readOnly`), then reads through the real `NodeDb` (read-only). Requires Node ≥22 (already the floor). |
| **Real captures may surface adapter bugs** | If a real fixture reveals an extraction bug, log it as a follow-up (Deferred), don't fix in this plan — the goal is the harness, not adapter rework. |

### Open Questions
- None blocking. The capture-tool topology has a real trade-off → see Workshop Opportunities (defaulted, not blocking).

### Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Capture-tool topology | Integration Pattern | The two research subagents disagreed: a `.harness` extension verb (user's stated preference, reference-but-won't-ship) vs core telemetry tooling + a `scripts/*.mjs` generator. Plan **defaults** to: pure logic in a telemetry service + a `.harness` extension `run()` wrapping it + a `scripts/` `--check` drift guard. | Does the extension import the core scrub service, or vendor the logic (arch-check style)? Is the `--check` guard the extension or a separate script? Lock before Phase 1 builds it. |
| Golden format | Storage Design | House style is explicit field-assertions + `FROZEN_V2_0_FIELDS`, not `toMatchSnapshot`. Plan defaults to a committed `expected-segment.json` per instance + invariants. | Committed expected-JSON vs vitest snapshot? (Low stakes — defaulted.) |

### Clarifications
#### Session 2026-06-25
- **Workflow Mode** → **Full** (four surfaces + extension + runbook + real privacy NF; CS-4; claude-first-then-fan-out is inherently multi-phase). *Inferred from the grill + complexity; not re-prompted given the user's "run the plan" go-ahead.*
- **Testing Strategy** → **Hybrid** (TDD for pure scrub logic; fixture-golden+invariants for E2E; raw-fixture byte-scan). *From grill.*
- **Mock Usage** → **Real data / fixtures only.** *The premise of the work.*
- **Documentation Strategy** → **docs/how/** runbook + extension `instructions.md`. *User asked for "good doco."*
- **Scrub policy** → keep verbatim prompts + tool usage; strip machine paths / home dirs / emails / real names / API keys / tokens / secrets; **manual "anything bad" review** before commit is non-skippable.
- **Sequencing** → **claude first** (we run inside it), then fan out.
- **Capture-tool home** → a `.harness` extension ("available as reference but it wont ship").

---

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: **Capture-tool topology** (defaulted; worth a quick workshop before Phase 1), Golden format (defaulted, low stakes).

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | n | In-conversation research instead; folded into Key Findings |
| workshops/*.md | n | none yet |

---

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No critical `[NEEDS CLARIFICATION]`; Round 1 resolved; grill settled the design |
| G2 | Constitution | PASS | P12 governs; mitigated by scrub-as-control + capture-via-`scratch/` + a Deviation Ledger row (AC-09) |
| G3 | Architecture | PASS | Pure scrub logic (no `node:*`) + I/O via injected Ports at the extension `run()` root; reuse `shared/posix-path.ts`; command returns the canonical Envelope |
| G4 | ADR Compliance | N/A | No accepted ADR bears on fixture/test tooling |
| G5 | Structure | PASS | All required sections present |
| G6 | Testing Alignment | PASS | Hybrid: pure-logic tests precede impl; measurable ACs; real-data/fixtures only |
| G7 | Domain Completeness | PASS | No registry; `telemetry` informal-existing; Domain Manifest covers every file referenced |

### Summary
Stand up a real-log fixture corpus and golden+invariant E2E tests for the telemetry adapters, proving the pipeline first on **claude**, then fanning out to **copilot-cli**, **copilot-vscode**, and **cursor**, and shipping the capture/scrub/extract tooling as a `.harness` extension with a `--check` drift guard and a runbook. The scrub is treated as a P12 compliance control with an automated raw-fixture byte-scan and a named manual review as its proofs.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/telemetry/fixture-scrub.ts` | telemetry | internal | Pure scrub/normalize logic (paths/identity/secrets); reuses `shared/posix-path.ts` |
| `harness/cli/src/services/telemetry/fixture-extract.ts` | telemetry | internal | Pure: project SQLite adapter rows / shape extracted-row fixtures |
| `harness/cli/test/services/telemetry/fixtures/real/` (committed fixtures + `expected-segment.json` goldens) | telemetry | internal | The per-instance real-capture library |
| `harness/cli/test/services/telemetry/fixture-scrub.test.ts` | telemetry | internal | TDD unit tests for the scrub logic |
| `harness/cli/test/services/telemetry/real-capture.e2e.test.ts` | telemetry | internal | Adapter→segment golden + invariants per real instance |
| `harness/cli/test/services/telemetry/fixture-privacy-scan.test.ts` | telemetry | internal | Raw-fixture byte-scan + planted negative control (AC-02) |
| `harness/cli/test/services/telemetry/copilot-vscode-sqlite.int.test.ts` | telemetry | internal | Throwaway real `node:sqlite` round-trip (AC-04); cursor's `cursorDiskKV` model/timing join reuses this pattern |
| `.harness/extensions/telemetry-fixtures/extension.ts` | _tooling | contract | The capture verb `run()` — composition root injecting `NodeFs`/`NodeEnv`/`NodeDb` |
| `.harness/extensions/telemetry-fixtures/instructions.md` | _tooling | contract | Extension usage doc |
| `scripts/telemetry-fixtures.mjs` | _tooling | internal | `--check` golden drift guard (clone of `flow-fixtures.mjs`) |
| `docs/how/telemetry-fixtures.md` | _tooling | internal | Capture→scrub→review→promote runbook |
| `docs/project-rules/rules.md` | _governance | cross-domain | One Deviation Ledger row (AC-09) |
| `.gitignore` | _tooling | internal | Ensure capture staging `scratch/` is ignored |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | The committed **raw fixture** has only the scrub as its guard; the allowlist serializer protects output only — a segment-only golden test would rubber-stamp a leaky fixture. | AC-02 raw-fixture byte-scan with a planted negative-control is mandatory and lands in Phase 1. |
| 02 | Critical | Constitution **P12** / Rules §1 forbid person-names/private-ids in tracked files and route raw material to gitignored `scratch/`; we deliberately commit scrubbed content. | Capture→`scratch/`→scrub→promote; add a Deviation Ledger row (AC-09); scrub is the compliance control. |
| 03 | High | **Layering** (P2 / `architecture.md` §2): no `node:*` in services; reuse `FsPort`/`EnvPort`/`DbPort`, and `shared/posix-path.ts` for path math. | Scrub/extract = pure services; the extension `run()` injects `NodeFs`/`NodeEnv`/`NodeDb`; never roll bespoke path normalization. |
| 04 | High | **Cursor** *is* capturable here — agent transcripts persist at `~/.cursor/projects/<cwd>/agent-transcripts/<conv>/<conv>.jsonl` (+ `state.vscdb`); `AGENT_TRANSCRIPTS` only gates the runtime adapter's auto-detect, not capture. **copilot-vscode** store is thin (~4 KB). | Cursor = real Phase-2 surface (capture by path; pick a substantive convo); copilot-vscode best-effort, SQL round-trip still proven. |
| 05 | Medium | `node:sqlite` via `NodeDb` opens **read-only**; the existing `scripts/flow-fixtures.mjs` `--check` drift pattern is the established fixture-gen precedent; vitest snapshots exist but segment tests use explicit assertions. | Throwaway db built writable then read via `NodeDb`; clone `flow-fixtures.mjs` for `--check`; goldens are committed `expected-segment.json` + invariants, not `toMatchSnapshot`. |
| 06 | Medium | The 3 synthetic fixtures are load-bearing (dedupe + planted-secret negative controls; `capture-perf.test.ts` reads one) and have **no timestamps** → `event_stream` null. | Keep synthetic alongside; real captures (timestamped) add the untested `event_stream`/`rollup` coverage as a bonus. |

### Phases

#### Phase Index

| Phase | Title | Primary Domain | Objective (1 line) | Depends On |
|-------|-------|---------------|-------------------|------------|
| 1 | Foundation + claude proof | telemetry | Land every pattern (library layout, scrub service, extension skeleton, raw-scan, golden+invariants) by proving the full pipeline on one real claude capture | None |
| 2 | Fan out — copilot-cli + copilot-vscode + cursor | telemetry | Apply the proven pattern to the JSONL+process-log, the SQLite (throwaway-db), and the cursor transcript+`cursorDiskKV` surfaces | Phase 1 |
| 3 | Operability + regeneration | _tooling | `--check` drift guard, runbook, manual-review checklist, Deviation Ledger row, `just`/npm wiring | Phase 1 |

#### Phase 1: Foundation + claude proof

**Objective**: Establish the fixture-library layout, the scrub service, the `.harness` extension skeleton, and the two-guard test pattern by proving the whole pipeline on a single real, scrubbed claude session.
**Domain**: telemetry
**Delivers**:
- `fixtures/real/` library layout + per-instance `expected-segment.json` golden + invariants convention.
- Pure `fixture-scrub.ts` service (paths/identity/secrets; reuses `shared/posix-path.ts`), TDD-tested.
- `.harness/extensions/telemetry-fixtures/` extension `run()` composition root (injects Ports), capturing **claude** into gitignored `scratch/` then promoting on scrub-pass.
- One real scrubbed claude fixture; the AC-02 raw byte-scan test (+ planted negative control); the AC-01 adapter→segment golden + invariants (incl. exact-timestamped `event_stream`).
**Depends on**: None
**Key risks**: Getting the scrub complete enough that the byte-scan passes on a real transcript (mangle + identity tokens).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 1.1 | Define `fixtures/real/<surface>/<instance>/` layout + golden/invariant convention (raw input + `expected-segment.json` + `invariants.json`/inline) | telemetry | A documented layout exists; claude instance dir created | Additive to existing `fixtures/` (Finding 06) |
| 1.2 | **(test-first)** `fixture-scrub.test.ts` — cases for `/Users/<user>`, `C:\Users\<user>`, the `-Users-<user>-` mangle, api-key shapes, emails, configured name; each scrubbed, prompts/commands preserved | telemetry | Tests written and failing | TDD per G6; Findings 01/03 |
| 1.3 | Implement `fixture-scrub.ts` (pure; reuse `relativizePath`/`toPosix` from `shared/posix-path.ts`) | telemetry | 1.2 green; no `node:*` imported | Finding 03 |
| 1.4 | `.harness/extensions/telemetry-fixtures/extension.ts` — verb `run()` injecting `NodeFs`/`NodeEnv`/`NodeDb`; captures claude transcript → `scratch/` → scrub → promote to `fixtures/real/claude/`; returns canonical Envelope | _tooling | `harness <verb>` produces a scrubbed claude fixture; `scratch/` gitignored | AC-06; Findings 02/03 |
| 1.5 | Capture + scrub one real claude session; manual "anything bad" review | telemetry | Fixture committed; reviewer confirms clean | AC-08 manual step (runbook lands Phase 3) |
| 1.6 | **`fixture-privacy-scan.test.ts`** — scan committed BYTES of **both** the raw fixtures **and** the `expected-segment.json` goldens for `/Users/`, `C:\`, username, api-key shapes, names; assert absent. Prove scanner liveness with a known-bad string **in test code** asserted *flagged* — never a banned token committed to the corpus | telemetry | Real artifacts scan clean; the in-test known-bad string is flagged | AC-02; Finding 01 |
| 1.7 | **`real-capture.e2e.test.ts`** (claude) — drive fixture through `claudeAdapter` → `serializeSegment`; assert `expected-segment.json` golden + invariants (token `grand_total`, prompt count, `event_stream` present + exact timestamps) | telemetry | Test green; golden committed | AC-01; Finding 06 |
| 1.8 | **SQLite mechanism spike** — minimal `node:sqlite` `DatabaseSync` (writable) build → read back through the read-only `NodeDb` adapter; retire the Phase-2 AC-04 mechanism risk before fixture work depends on it | telemetry | A throwaway db is built, seeded, and read via `NodeDb` in one test | De-risks AC-04 early (validator Finding 4) |

#### Phase 2: Fan out — copilot-cli + copilot-vscode + cursor

**Objective**: Reuse Phase 1's pattern for the three remaining capturable surfaces (copilot-cli, copilot-vscode, cursor), including the real SQLite round-trip.
**Domain**: telemetry
**Delivers**: real scrubbed copilot-cli fixture + E2E golden (with token correlation); copilot-vscode extracted-rows fixture + throwaway-`node:sqlite` int-test; real scrubbed cursor fixture (transcript + `cursorDiskKV` rows) + E2E golden with the model/timing join; synthetic fixtures untouched.
**Depends on**: Phase 1
**Key risks**: copilot-vscode store thin (~4 KB) → may yield few turns; cursor on-disk conversations are often short stubs / partly self-redacted → choose a substantive one; the writable-then-read sqlite dance.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 2.1 | Extend the extension to capture **copilot-cli** (`events.jsonl` + `process-*.log`) → scrub → promote | _tooling | Scrubbed copilot-cli fixture committed | Reuses 1.3/1.4 |
| 2.2 | E2E golden+invariants for copilot-cli incl. **token correlation** from the process log; raw byte-scan covers the new files | telemetry | Test green; golden committed; scan green | AC-03 |
| 2.3 | `fixture-extract.ts` (pure) — project the copilot-vscode `sessions`/`turns` rows (privacy-safe SQL projection) into an extracted-rows fixture; capture path in the extension | telemetry | Extracted-rows fixture committed (no message text) | AC-04; Finding 05 |
| 2.4 | **`copilot-vscode-sqlite.int.test.ts`** — build a throwaway real `node:sqlite` from the rows (writable), then read via `NodeDb` (read-only) through the adapter's actual SQL → golden segment | telemetry | Test green; SQL round-trip proven (or thin-capture documented if store empty) | AC-04; Finding 05 |
| 2.5 | Capture real **cursor** surface — read the on-disk transcript (`~/.cursor/projects/<cwd>/agent-transcripts/<conv>/<conv>.jsonl`, content) + extract `cursorDiskKV` model/timing rows from `state.vscdb`, scrub → promote; E2E golden+invariants asserting the transcript↔bubble model/timing **join** (reuses 1.3/1.4 scrub + the 1.8/2.4 throwaway-sqlite pattern); raw byte-scan covers the new files. Keep synthetic `cursor-transcript.jsonl` + its test unchanged | telemetry | Scrubbed cursor fixture committed; E2E green; join proven; synthetic untouched | AC-05/AC-10; Finding 04 |

#### Phase 3: Operability + regeneration

**Objective**: Make the corpus regenerable, documented, and governance-clean.
**Domain**: _tooling
**Delivers**: `--check` golden drift guard + `just`/npm wiring; `docs/how/telemetry-fixtures.md` runbook with the non-skippable manual review; the Deviation Ledger row; extension `instructions.md`.
**Depends on**: Phase 1 (pattern); parallelizable with Phase 2.
**Key risks**: keeping the `--check` guard deterministic across machines (path/identity normalization must be machine-independent post-scrub).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 3.1 | `scripts/telemetry-fixtures.mjs` — regenerate goldens by **importing the built `dist/` telemetry modules** (adapter + `serializeSegment`) over each committed fixture; `--check` reuses `flow-fixtures.mjs`'s drift contract (re-extract → fail non-zero on divergence). No CLI verb (Non-Goal). | _tooling | `--check` passes clean; mutating a golden makes it fail | AC-07; Finding 05; validator Finding 1 |
| 3.2 | Wire `just`/npm targets (`gen:telemetry-fixtures`, `check:telemetry-fixtures`) + CI gate | _tooling | Targets run; CI step green | AC-07 |
| 3.3 | `docs/how/telemetry-fixtures.md` runbook — capture → gitignored `scratch/` → scrub → **manual "anything bad" review (non-skippable)** → promote; + how to capture cursor from the on-disk `~/.cursor/projects/.../agent-transcripts/` path | _tooling | Runbook complete; manual step explicit | AC-08/AC-05 |
| 3.4 | Extension `instructions.md` | _tooling | Present | AC-06 |
| 3.5 | Add the Deviation Ledger row to `docs/project-rules/rules.md` (committing scrubbed session content; controls = scrub + raw-scan + manual review) | _governance | Row present; G2 satisfied | AC-09; Finding 02 |
| 3.6 | Confirm `.gitignore` covers the capture staging `scratch/` | _tooling | `scratch/` ignored | Finding 02 |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | 1.7 | `real-capture.e2e.test.ts` (claude) golden + invariants |
| AC-02 | 1.6 | `fixture-privacy-scan.test.ts` byte-scan + negative control |
| AC-03 | 2.1, 2.2 | copilot-cli E2E golden + token correlation |
| AC-04 | 1.8 (mechanism spike), 2.3, 2.4 | `copilot-vscode-sqlite.int.test.ts` real sqlite round-trip |
| AC-05 | 2.5, 3.3 | real cursor fixture + E2E golden (model/timing join); synthetic retained |
| AC-06 | 1.4, 3.4 | extension `run()` + pure logic + `instructions.md` |
| AC-07 | 3.1, 3.2 | `--check` drift guard + CI |
| AC-08 | 3.3 | runbook with non-skippable manual review |
| AC-09 | 3.5 | Deviation Ledger row |
| AC-10 | (constraint) | synthetic fixtures + their tests unchanged; `capture-perf.test.ts` intact |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Scrub misses an identity token in a real transcript | Medium | High (public leak) | AC-02 byte-scan + planted control + named manual review; capture via gitignored `scratch/` first |
| copilot-vscode store too thin to be a meaningful fixture | Medium | Low | Capture what exists; SQL round-trip int-test still proves the mechanism; document thinness |
| Golden drift guard non-deterministic across machines | Low | Medium | Scrub normalizes all machine-specific tokens → goldens are machine-independent by construction |
| Real fixture exposes an adapter extraction bug | Medium | Low | Log as Deferred follow-up; do not fix in this plan (Non-Goal) |
| Capture-tool topology re-litigated mid-build | Low | Medium | Default locked in plan; optional workshop before Phase 1 if desired |
