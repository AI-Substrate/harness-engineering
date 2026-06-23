# Harness Telemetry Collection
**Mode**: Full
**Plan Version**: 1.0.0
**Created**: 2026-06-23
**Status**: READY — *§T1 governance gate ✅ RATIFIED 2026-06-23 (non-individual commit author); all phases unblocked*
**Spec source**: unified (this file)

## Business Specification

### Research Context
📚 Incorporates findings from `research-dossier.md` (6 subagents) and the proven probes in `scratch/telem/` (`dump.cjs`, `since.cjs`). Token/skill/subagent sources for Claude Code and Copilot CLI are **empirically verified**, captured in agent memory (`telemetry-claude-transcript-correlation`, `telemetry-copilot-cli-correlation`, `telemetry-concept-and-decisions`). The repo already ships the substrate this feature extends: the record system + 8-key provenance, hexagonal ports/DI, and `docs/how/harness-value-measures.md` (the eng-thrive contract this telemetry feeds).

### Summary
Build an ambient, zero-friction **sensor layer**: every `harness` command auto-captures a per-session `segment` — the tokens, skills, tools, subagents, files, and plan-links that occurred *since the last command* in the current agent-harness session — normalizes it across heterogeneous harnesses (Claude Code, Copilot CLI; Cursor later), and persists it durably to a single out-of-tree git ref for the eng-thrive measurement program. **Emit + commit only**: this layer produces faithful measures; downstream tooling scrapes and correlates them (DORA/bugs/value) — we are the sensor, not the analyst.

### Goals
- Auto-capture telemetry on **every** harness command, deterministically, with **zero** change to the host command's output or exit code.
- One **normalized, capability-based** `segment` record across harnesses — adding a new harness (Cursor) is a new adapter, never a schema change.
- **Counts/metadata only** — token buckets, skill/tool names, subagent identity, file paths (repo-relative), model changes, branch, timecode, plan links. Never prompt/message/file content.
- Persist durably **without polluting** working trees or PR diffs (out-of-tree git ref), synced by a first-class command.
- Feed the existing `harness-value-measures` eng-thrive contract at **team/repo grain**.

### Segment Schema (counts-only, enumerated)
The load-bearing cross-tool/cross-repo contract — enumerated here so Phase 1 and the downstream scraper are not blocked (the workshop only refines internals like the `system.*` extension namespace, not this field set). All capability fields are nullable; an unimplemented capability serializes `null` (never absent, never estimated). **No content fields ever.**

```jsonc
// reused 8-key provenance (CLI-stamped): record_kind, harness_version, branch, repo,
//   created_at, agent (nullable), plan_id, schema_version
{
  "command": "flow",                       // harness command that triggered capture
  "harness": "claude-code|copilot-cli|cursor|…",  // detected innermost harness
  "harness_session_id": "<opaque id>",     // correlation handle (not individual identity)
  "timecode": "2026-06-23T04:58:00Z",
  "window": { "since": "session-start|last-command", "from": <int>, "to": <int> },
  "branch": "034-…", "branch_changed": false,
  "tokens": null | { "input": 0, "output": 0, "cache_create": 0, "cache_read": 0,
                     "total": 0, "subagent_tokens": 0, "grand_total": 0 },
  "models": { "<model-id>": { "turns": 0, "output_tokens": 0 } },  // per-model (mutable in-segment)
  "effort": "high" | null,
  "skills": { "<skill>": 0 },              // name → count
  "tools":  { "<tool>": 0 },               // name → count
  "subagents": [ { "type": null, "agent_name": null, "model": null,
                   "status": null, "tokens": null, "tool_uses": null } ],
  "files": { "written": ["<repo-relative>"], "edited": ["<repo-relative>"] },
  "plans_touched": ["<plan-id>"],          // deduped
  "events": { "compactions": [ { "trigger": null, "pre_tokens": 0, "post_tokens": 0 } ],
              "api_errors": 0, "local_commands": 0 },
  "thinking": { "blocks": 0 } | null
}
```

### Non-Goals
- **No** cross-repo scanner, measure-engineering, or DORA/bug correlation here (downstream eng-thrive tooling owns these — PL-01/19).
- **No** per-individual reporting or productivity scoreboard (Constitution P12 + value-measures doctrine — see Open Questions / §T1).
- **No** OTel collector, background daemon, or token estimation (sources are authoritative; null when absent).
- **No** Cursor adapter in this plan (capability slot reserved; deferred).
- **No** harness-change / bypass record work (already exists — `harness record harness-change`).
- **No** trailing-tail exhaustive capture (best-effort; window bounds emitted).

### Target Domains
> No `docs/domains/registry.md` exists — per Constitution §5, domain governance is not yet initialized; the boundaries below are **conceptual, for traceability only**. The enforced rules are `architecture.md` (hexagonal layering). No `domain.md` files are created.

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| telemetry | **NEW** (conceptual) | **create** | Capture service, per-harness adapters, segment schema, normalizer, session cursor — `src/services/telemetry/` |
| record | existing | **consume** | Reuse the record type system + 8-key provenance splice for the `segment` type (no rebuild) |
| cli-kernel | existing | **modify** | One thin auto-capture preamble at the `app.ts` composition root |
| git | existing | **modify** | Extend the read-only `GitPort` with a `GitWritePort` adapter (plumbing) for the orphan-ref flush |
| sync (ship) | **NEW** (conceptual) | **create** | A first-class core entry that flushes buffered segments → orphan ref → push |
| docs/measures | existing | **modify** | A `docs/how/` telemetry guide + extend `harness-value-measures.md` (team/repo grain) |

#### New Domain Sketches
##### telemetry [NEW, conceptual]
- **Purpose**: turn raw agent-harness session artifacts into normalized, counts-only `segment` records, ambiently and per-command.
- **Boundary Owns**: harness detection, session cursor/windowing, the segment schema + normalizer, per-harness capability adapters, buffer writes.
- **Boundary Excludes**: git persistence (→ git domain / GitWritePort), measure-engineering & correlation (→ downstream eng-thrive), the kernel wiring (→ cli-kernel), record provenance stamping (→ record domain, reused).

### Testing Strategy
- **Approach**: Full TDD (Constitution P3; matches CLI's hexagonal discipline).
- **Rationale**: parsers (transcript/process-log), token math (dedupe + bucket summation), cursor windowing, and git plumbing are real branching logic that must be pinned by tests-first.
- **Focus Areas**: adapter token/skill/subagent extraction (golden-file fixtures from real captures), counts-only payload enforcement, fail-safety (capture never alters host exit), git plumbing via fake.
- **Excluded**: thin entrypoint/preamble wiring (lightweight — assert "invoked + exit unchanged").
- **Mock Usage**: hand-written `Fake*` adapters for injected ports (fs/git/clock/exec/env); **never `vi.mock`** (P3, PL-15); real captured fixtures (sanitized, counts-only).

### Documentation Strategy
- **Location**: `docs/how/` — a new telemetry collection guide + extend `docs/how/harness-value-measures.md` with how `segment` telemetry feeds the eng-thrive measures (team/repo grain, hand-traced example).
- **Rationale**: matches the value-measures precedent; the segment is a cross-tool/cross-repo consumer contract that needs a durable doc.

### Complexity
- **Score**: CS-4 (large)
- **Breakdown**: S=2, I=2, D=2, N=1, F=1, T=2 (sum 10)
- **Confidence**: 0.80
- **Assumptions**: token/skill sources are stable as probed; git supports orphan-ref plumbing in target environments; `HARNESS_*` env identity chain is reused.
- **Dependencies**: existing record/provenance services, ports/DI, `harness-value-measures.md`.
- **Risks**: see Risks table. **Phases**: 4.

### Acceptance Criteria
- **AC-01**: Running any `harness <verb>` updates the current session's segment with tokens/skills/tools/subagents/files since the last command, and the host command's stdout + exit code are byte-identical to running without telemetry.
- **AC-02**: With `CLAUDE_CODE_SESSION_ID` set, the Claude adapter's token totals equal the transcript's per-message `usage` deduped by `message.id` and summing all four buckets, asserted exactly against a golden fixture; subagent cost is read from the `Agent` tool_result.
- **AC-03**: With `COPILOT_AGENT_SESSION_ID` set as the innermost harness, the Copilot adapter extracts exact token detail from process-log `assistant_usage` (golden fixture); when the source is absent, token fields are `null` (never estimated).
- **AC-04**: A segment payload contains only counts/identifiers; a test asserts the serialized segment has **no** prompt/message text, file contents, or free-form tool-arg fields, and that file paths are repo-relative (no absolute `/Users/...`).
- **AC-05**: Setting `HARNESS_NO_TELEMETRY=1` (the kill-switch, naming-consistent with `HARNESS_NO_EXTENSIONS`) produces zero telemetry side effects (no temp writes, no ref writes); default (unset) captures.
- **AC-06**: Telemetry never appears in a feature branch's working tree or PR diff — capture writes only to gitignored `.harness/temp/telemetry/`; durable writes go to refs under `refs/harness-telemetry/` via plumbing without touching the index/working tree (asserted: `git status --porcelain` unchanged across a capture + flush). _(Amended 2026-06-24, pre-ship: sharded ref namespace — see Amendment A1.)_
- **AC-07**: The sync step writes commits to per-(capture-date, session) shard refs `refs/harness-telemetry/<YYYY>/<MM>/<DD>/<session>` (Amendment A1) authored by a **non-individual identity** (default `harness-telemetry <noreply@…>`) — **no `git config user.email` is stored at the storage layer by default** (see §T1, AC-13). It pushes only telemetry shard refspecs under that namespace, best-effort; no `refs/heads/*` branch or other ref is modified; a failed shard push leaves that shard's buffer intact for retry (AC-14).
- **AC-08**: When run inside `docs/plans/<id>/` or with `HARNESS_PLAN_ID` set, the session segment records the plan link; multiple distinct plans in one session are recorded as a deduped set.
- **AC-09**: An adapter that throws (corrupt transcript / missing dir / parse error) is caught; the host command still exits with its original code (proven via an injected throwing adapter).
- **AC-10**: `docs/how/` contains a telemetry guide, and `harness-value-measures.md` is extended to **document the segment _contract_** (which fields are available to the eng-thrive measures) at **team/repo grain only** — a contract doc, not measure computation/correlation — with one hand-traced segment example and an explicit statement that commit-author/`agent` are never surfaced per-individual.
- **AC-11**: Attribution is team/repo-level by default: no per-individual identity is stored at the storage layer; the optional `agent` provenance field follows the house pattern (nullable, `null` when unset, never individually reported). A doc/test check confirms no per-individual reporting surface exists (governance alignment, §T1).
- **AC-12**: A new harness adapter can be registered as a capability module without modifying the segment schema or capture core; an unimplemented capability serializes as `null`, proven by a stub "future-harness" adapter test.
- **AC-13** *(constitutional gate — added by validation)*: A test confirms the shard-ref commit author **and** committer are the non-individual identity (not the engineer's `git config user.email`) and that the serialized segment contains no per-individual identity field; shard refs are keyed by session (not engineer). Directly gates the §T1 failure consequence (per-individual surveillance).
- **AC-14** *(added by validation)*: Capture/sync are offline-safe: a push that fails (no auth, network down, non-fast-forward) does not error the host command and leaves the buffer for the next sync; auth uses the ambient git credential mechanism (no token handling in CLI code).

> **Amendment A1 — sharded ref namespace (2026-06-24, pre-ship; ratified by user).** The original design pushed one **shared mutable** ref `refs/harness-telemetry`. That is broken at team scale: many engineers pushing from independent clones is a distributed write-contention problem — every pusher after the first gets a non-fast-forward rejection and their telemetry never drains (the local ff-retry only re-reads the *local* tip, which a fetch-less clone never advances). **Resolution:** shard the namespace by **(capture-date, session)** — `refs/harness-telemetry/<YYYY>/<MM>/<DD>/<session>` — so each flush targets a ref no other writer touches; every push is a clean create-or-fast-forward (no fetch/merge/retry across writers). This is the canonical git pattern for many-writer out-of-tree metadata (Gerrit `refs/changes/*`, GitHub `refs/pull/*`; confirmed via research). A central scraper still collects everything in **one** globbed fetch (`git fetch origin '+refs/harness-telemetry/*:…'` is a single round-trip, not one-per-ref); the date prefix is the **prune/retention key**; the namespace can be hidden from ordinary clones via `uploadpack.hideRefs`. **Privacy unchanged (§T1/P12):** the shard key is the opaque **session** id (never an engineer), same granularity already in the buffer paths; commit author **and** committer stay the fixed non-individual identity. Each shard's commit tree is a flat `<seq>.json` set (date+session live in the ref name). Impl: `git-write-port.ts` (`telemetryRefFor`/`TELEMETRY_REF_GLOB`), `sync-service.ts` (date-grouped per-shard flush; watermark advances only across shards that pushed). Docs: `docs/how/telemetry.md` § Team scale.

### Risks & Assumptions
| Risk | Mitigation |
|------|------------|
| Auto-preamble adds latency to every command | Incremental cursor read (not full transcript); perf-bounded; capture is fail-fast and may early-exit |
| Copilot process-log format is undocumented/version-fragile | Isolate behind the adapter; golden fixtures; null-on-absence (no estimation); log dropped coverage |
| Orphan-ref plumbing unproven in this repo (no precedent — GIT-05) | Isolate all git-write behind `GitWritePort` + fake; confine to the deferred flush path, not the hot path |
| Per-user attribution conflicts with house doctrine (§T1) | Resolve toward team/repo grain; per-user reporting explicitly out of scope; agent field optional provenance only |
| Capture failure breaks a host command | Fail-safe wrapper; AC-09 test; never touch exit code |

### Open Questions
- **§T1 (attribution governance) — ✅ RATIFIED by user 2026-06-23 (Phase 4 unblocked).** The doctrine-safe default below is now the sanctioned decision (Constitution P12): commit author = non-individual `harness-telemetry`, no per-individual identity stored, optional `agent` nullable, per-user attribution out of scope. Grilling landed on commit-author = engineer identity + per-user reports, but research surfaced that Constitution P12 + `harness-value-measures.md` mandate **team/repo-only, never individual** (token count is explicitly on the do-not-use-for-individuals list). Storing the engineer's `git config user.email` as the commit author durably on every telemetry commit is a latent surveillance vector even if never *reported* — a constitutional contradiction. **This plan now defaults to the doctrine-safe resolution** (AC-07/11/13): commit author = a non-individual `harness-telemetry` identity; no per-individual identity stored; the optional `agent` field stays nullable per house pattern; per-user attribution is **out of scope** and would require a separate, governance-gated decision. This reverses the earlier grilled decision, so it needs the user's sign-off before Phase 4's durable writes land. *(Governance gate, not a post-implementation workshop.)*
- **§T3 (storage shape) — SETTLED.** Adopt **temp-buffer-then-flush-at-sync**: the hot path writes a gitignored `.harness/temp/telemetry/` buffer (no git on the hot path); the sync step flushes to the orphan ref. Direct orphan-ref-per-command was rejected (hot-path git cost + fragility). The remaining workshop item is **only the orphan-ref internals** (ref layout, commit structure, ff-retry, scraper fetch contract) — not the temp-vs-direct decision.
- **Core `ship` vs the-flow stage-8 ship** — the user wants a first-class extensible core `ship` command; the-flow already owns a `ship` *stage*. This plan delivers the **telemetry-sync capability** as a concrete `harness telemetry sync` verb (a `telemetry` core command family, mirroring `flow`); a future core `ship` command may invoke it. The broader `ship` design is out of scope here. *(Settled enough to implement; ship-command design is a separate concern.)*
- **Session boundary across long Claude sessions vs per-`-p` Copilot sessions** — cursor/watermark handles Claude; Copilot is naturally per-invocation. Confirmed approach; flagged for adapter tests.

### Workshop Opportunities
| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| Attribution governance (§T1) | Other (governance) | **Ratify** the doctrine-safe default (non-individual author) — reverses the grilled per-user decision; blocks Phase 4 | Confirm: non-individual commit author + nullable `agent`; per-user out of scope? |
| Orphan-ref internals | Storage Design | The temp→flush shape is settled (§T3); only the ref's internal layout is open | ref layout, commit structure, ff-retry, scraper fetch contract |

> Note: the segment **schema field set** is now enumerated in `### Segment Schema` (no longer a workshop blocker); the **sync verb name** is fixed to `harness telemetry sync` (Phase 4). Both were closed by validation.

### Clarifications
#### Session 2026-06-23
- **Workflow Mode** → Full (CS-4; multi-domain, multi-phase).
- **Testing Strategy** → Full TDD (house style; hexagonal + fakes).
- **Mock Usage** → Hand-written fakes, no `vi.mock`; real captured fixtures.
- **Documentation Strategy** → `docs/how/` guide + extend `harness-value-measures.md`.

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: Attribution governance (§T1), Segment schema shape, Core ship/sync command, Orphan-ref + GitWritePort.

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings, domains, complexity, the three tensions |
| workshops/*.md | n | none yet — four opportunities flagged above |

## Implementation Plan

### Gate Matrix
| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No critical `[NEEDS CLARIFICATION]` markers; §T1 is an Open Question + Workshop, not a blocking gap |
| G2 | Constitution | PASS | Complies with P2/P3/P5/P8/P9/P12. P10 (verbs extension-owned): capture is **core loop infrastructure** like `observe`/`record`/`flow`/`doctor` — not a user verb — so a core capture mechanism + sync entry is consistent; no deviation ledger needed. P12 (counts-only, no PII) is directly satisfied and mandates AC-04 |
| G3 | Architecture | PASS | Fills the **deferred "Telemetry" adapter seam** (architecture §2.1); ports-only services; preamble stays thin (logic in service, per §7 anti-patterns); `GitWritePort` extends the §2.1 adapter set |
| G4 | ADR Compliance | N/A | No `docs/adr/` present |
| G5 | Structure | PASS | All required sections present and populated |
| G6 | Testing Alignment | PASS | Full TDD; every phase task table orders test tasks before implementation; ACs are measurable |
| G7 | Domain Completeness | PASS | No registry (Constitution §5 — domains not initialized); conceptual domains mapped for traceability; Domain Manifest covers all referenced files; no `domain.md` creation required |
| G0 | Tensions / governance | **PASS (Phases 1–3); GATED (Phase 4)** | Added by validation. §T2 resolved (core preamble); §T3 resolved (temp→flush); schema enumerated; **§T1 defaults to doctrine-safe (non-individual author) but requires user ratification before Phase 4** |

### Summary
Reuse the record/provenance substrate and hexagonal ports to add a `telemetry` service that, on every command, detects the innermost agent harness from env, reads "since last command" via a session cursor, and writes a normalized counts-only `segment` to a gitignored buffer. Per-harness capability adapters (Claude, Copilot) translate native artifacts into the shared schema. A thin kernel preamble triggers capture fail-safely. A deferred sync step flushes buffered segments to a single orphan git ref via new `GitWritePort` plumbing, authored by the engineer's git identity, feeding the eng-thrive measures at team/repo grain.

### Domain Manifest
| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/telemetry/segment.ts` | telemetry | contract | Segment type + counts-only schema |
| `harness/cli/src/services/telemetry/segment.schema.json` | telemetry | contract | Cross-tool/repo consumer schema |
| `harness/cli/src/services/telemetry/capture-service.ts` | telemetry | internal | Detection, cursor, windowing, buffer write (ports-only) |
| `harness/cli/src/services/telemetry/cursor.ts` | telemetry | internal | Session watermark store |
| `harness/cli/src/services/telemetry/adapters/harness-adapter.ts` | telemetry | contract | Capability adapter interface |
| `harness/cli/src/services/telemetry/adapters/claude.ts` | telemetry | internal | Claude transcript adapter |
| `harness/cli/src/services/telemetry/adapters/copilot.ts` | telemetry | internal | Copilot process-log adapter |
| `harness/cli/src/services/record/core-types/segment.ts` | record | contract | `segment` core record type (reuses provenance) |
| `harness/cli/src/app.ts` | cli-kernel | internal | Thin auto-capture preamble (calls service) |
| `harness/cli/src/adapters/git/git-write-port.ts` | git | contract | Plumbing port (hash-object/commit-tree/update-ref/push) |
| `harness/cli/src/adapters/git/exec-git-write.ts` | git | internal | Node impl + `FakeGitWrite` |
| `harness/cli/src/services/telemetry/sync-service.ts` | sync | internal | Flush buffer → orphan ref |
| `harness/cli/src/acts/telemetry-sync.ts` | sync | internal | Core entry that invokes sync |
| `docs/how/telemetry.md` | docs/measures | contract | Telemetry guide |
| `docs/how/harness-value-measures.md` | docs/measures | contract | Extend with segment → eng-thrive (team/repo grain) |

### Key Findings
| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | Extensions are invocation-only — no kernel hooks (EXT-04/11) | Auto-capture must be a **core** preamble in `app.ts`, not an extension (Phase 3) |
| 02 | Critical | Per-user attribution conflicts with P12 + value-measures doctrine (REC-05, PL-20) | Resolve to team/repo grain; per-user reporting out of scope; agent = optional provenance (AC-11, §T1 workshop) |
| 03 | High | Record system + 8-key provenance already exist and auto-stamp branch/repo/created_at/agent/plan_id (REC-02, PL-13) | `segment` is a core record type reusing provenance; **don't rebuild** (Phase 1) |
| 04 | High | GitPort is read-only; plumbing not wrapped (GIT-01/05); `harness ship` doesn't exist (GIT-06) | New `GitWritePort` + minimal sync entry are net-new, isolated to Phase 4 |
| 05 | High | `.harness/temp/` self-ignores via shared `ensureTemp` (`temp/.gitignore`=`*`); atomic temp+rename precedent is **`flow-service`**, NOT `observe` (which writes directly) — corrected by validation | Capture hot path writes there → PR-invisible, fast, no git on hot path; mirror `flow-service` for atomic writes (§T3, Phase 1) |
| 06 | High | Architecture §2.1 already reserves a deferred **Telemetry** adapter seam | This feature fills an anticipated seam — low architectural risk (G3) |
| 07 | Medium | Token sources empirically proven; provenance splice must be pure-string (PL-14); fakes-not-mocks (PL-15) | Port adapters; golden fixtures; no YAML parse in service; hand-written fakes |

### Phases

#### Phase Index
| Phase | Title | Primary Domain | Objective (1 line) | Depends On |
|-------|-------|---------------|-------------------|------------|
| 1 | Segment substrate & capture core | telemetry | Define the counts-only segment + capture service writing to a gitignored buffer | None |
| 2 | Per-harness capability adapters | telemetry | Claude + Copilot adapters behind one capability interface (Cursor slot null) | Phase 1 |
| 3 | Auto-capture kernel preamble | cli-kernel | Trigger capture on every command, fail-safe, zero output/exit impact | Phases 1–2 |
| 4 | Durable sync: GitWritePort + sharded refs + docs | git / sync / docs/measures | Flush buffer → `refs/harness-telemetry/<date>/<session>` shards via plumbing (Amendment A1); guide + measures contract | Phase 1 |

#### Phase 1: Segment substrate & capture core
**Objective**: Establish the normalized counts-only segment and a pure capture service that buffers "since last command" to gitignored temp.
**Domain**: telemetry
**Delivers**: segment type + `segment.schema.json`; `segment` core record type (reusing provenance); capture-service (detection, cursor, windowing, buffer write); kill-switch; fail-safe wrapper.
**Depends on**: None
**Key risks**: hot-path latency — keep reads incremental.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 1.1 | Write tests for the enumerated segment schema + counts-only enforcement, incl. a **planted-secret negative control** at the *serializer/allowlist* boundary | telemetry | Asserts no content/free-form-arg fields; repo-relative paths only; matches `### Segment Schema`; the serializer given an object carrying a planted secret in a non-allowlisted field + an absolute `/Users/` path yields a segment containing **neither** (control fails if the allowlist regresses) | TDD-first; AC-04; serializer-boundary control (grill-agent-done; adapter-boundary control is task 2.2/2.3 — adapters are Phase 2) |
| 1.2 | Implement `segment.ts` + `segment.schema.json` from the enumerated `### Segment Schema` (capability-based, nullable) | telemetry | Schema validates a golden segment; capability fields default `null` | AC-12; field set already enumerated |
| 1.3 | Add `segment` core record type reusing 8-key provenance splice | record | `harness record segment` scaffolds with provenance; frozen-body-keys test | PL-02/06/14 |
| 1.4 | Write tests for innermost-harness detection + cursor windowing (FakeEnv/FakeFs/FakeClock) | telemetry | Detects Copilot-over-Claude; "since last" delta correct; first-run = since session start | AC-01 |
| 1.5 | Implement capture-service (detection, cursor store, buffer write to `.harness/temp/telemetry/`) | telemetry | Service is ports-only (no `node:*`); arch-check passes | P2; §T3 |
| 1.6 | **Atomic cursor read-modify-write + concurrency test** (two same-session captures in parallel) | telemetry | Concurrent captures don't corrupt the watermark or lose segments (temp+rename, per GIT-11) | added by validation; AC-01 |
| 1.7 | Ensure/verify `.harness/temp/telemetry/` is gitignored | telemetry | A test writes a buffer file and asserts `git status --porcelain` does not list it | added by validation; AC-06 |
| 1.8 | Add `HARNESS_NO_TELEMETRY` kill-switch + fail-safe wrapper (catch-all → no-op) | telemetry | Kill-switch → zero side effects; thrown error swallowed | AC-05, AC-09 |

#### Phase 2: Per-harness capability adapters
**Objective**: Translate Claude and Copilot native artifacts into the shared segment via one capability interface.
**Domain**: telemetry
**Delivers**: `harness-adapter.ts` interface; Claude + Copilot adapters; golden fixtures; documented Cursor-null slot.
**Depends on**: Phase 1
**Key risks**: Copilot log fragility — isolate + null-on-absence.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 2.1 | *(interface now defined in Phase 1, T004 — per validation F1)* Implement Claude + Copilot adapters **against the existing** `HarnessAdapter` interface | telemetry | Adapters register without modifying capture-service; partial capability → null | AC-12; interface seam built in Phase 1 |
| 2.2 | Write Claude adapter tests against a sanitized golden transcript fixture, incl. **negative controls** | telemetry | Token total = dedupe-by-message.id, 4 buckets, subagent from tool_result; fixture includes a **duplicated `message.id`** (dedupe must drop it), **non-zero `cache_creation`+`cache_read`** (no bucket dropped), a **subagent tool_result** (nested cost counted once), and a **planted secret + absolute path in a tool arg** (adapter-boundary privacy control — must never reach the segment); expected totals **hand-derived, not lifted from a run** | TDD; AC-02, AC-04; negative controls (grill-agent-done) |
| 2.3 | Implement Claude transcript adapter | telemetry | Passes 2.2; skills/tools/files/model-changes/compaction extracted | from scratch/telem proof |
| 2.4 | Write Copilot adapter tests against a sanitized golden process-log fixture | telemetry | Exact `assistant_usage` token detail; subagent identity; null when absent | TDD; AC-03 |
| 2.5 | Implement Copilot process-log adapter | telemetry | Passes 2.4; innermost-harness aware | no estimation |
| 2.6 | Add a stub "future-harness" adapter test proving capability null-fill | telemetry | New adapter, no schema/core change; unimplemented caps = null | AC-12 |

#### Phase 3: Auto-capture kernel preamble
**Objective**: Trigger capture on every command without altering output/exit.
**Domain**: cli-kernel
**Delivers**: thin preamble in `app.ts` (calls capture-service), excludes help/version, fail-safe, perf-bounded.
**Depends on**: Phases 1–2
**Key risks**: business logic creeping into the kernel — keep it a one-call delegation. **Rollback strategy**: the capture trigger is isolated to one call site; if the composition-root preamble proves problematic (latency, ordering), fall back to the existing **exit/banner-decorator** precedent (`setBannerDecorator` in `exit.ts`) for an at-exit capture — less precise on timing but strictly additive and removable. This is the CS-4-vs-CS-5 mitigation (the kernel change is the one load-bearing edit; rollback keeps it reversible).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 3.1 | Write composition-root test: capture invoked once per command; help/version excluded | cli-kernel | Test asserts service called; skipped for `--help`/`--version` | AC-01 |
| 3.2 | Write fail-safety test: throwing capture leaves host exit code unchanged | cli-kernel | Host command exit byte-identical with a throwing adapter | AC-09 |
| 3.3 | Implement thin preamble at `app.ts` composition root (delegates to capture-service) | cli-kernel | Logic stays in service (§7 anti-pattern); passes 3.1/3.2 | CLI-03/04 |
| 3.4 | Verify zero stdout/stderr/exit drift + **structural perf sensor** on representative core commands (golden) | cli-kernel | Output byte-identical with/without telemetry on `doctor`/`flow`/`record`; capture path is **bounded read-count + cursor-incremental** (FakeFs `readText` call count is a small constant — Claude path = 2; a prior cursor shrinks the processed window) — asserted via FakeFs call inspection, **not** a wall-clock threshold. *(Corrected by Phase-3 validation M-K6: `FsPort` has no range read, so the adapter reads the whole transcript twice — the guarantee is bounded read-count + windowed parse, NOT bounded bytes; the residual O(file-size) read is accepted M1 debt.)* | AC-01; perf **reshaped** from the flaky `<10ms` wall-clock by grill-agent-done, then from "no full-transcript read" to the buildable M1-honest sensor; rollback strategy unchanged |

#### Phase 4: Durable sync — GitWritePort + orphan ref + docs
**Objective**: Flush buffered segments to one orphan ref via plumbing, and document the consumer/measures contract.
**Domain**: git / sync / docs/measures
**Delivers**: `GitWritePort` + Node impl + `FakeGitWrite`; sync-service + core entry; plan-linking; `docs/how/` guide + value-measures extension.
**Depends on**: Phase 1
**Key risks**: plumbing portability — fully fake-tested; confined to this path.

> **✅ §T1 governance gate — RATIFIED 2026-06-23**: the user ratified the non-individual commit-author default (`harness-telemetry`; no per-individual identity; `agent` nullable; per-user attribution out of scope). Phase 4 is unblocked.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 4.1 | Write `GitWritePort` tests (hash-object/commit-tree/update-ref/push) with `FakeGitWrite` | git | Fake records plumbing calls; orphan commit shape asserted | TDD; PL-15 |
| 4.2 | Implement `GitWritePort` + `ExecGitWrite` (commit to a `refs/harness-telemetry/<date>/<session>` shard, **non-individual author**, no index touch) | git | `git status --porcelain` unchanged across write; author ≠ engineer email | AC-06, AC-07, AC-13 |
| 4.3 | Write sync-service tests (flush buffer → ref; plan-link dedupe; **failed-push leaves buffer**) | sync | Buffered segments flushed once; plan links deduped; offline-safe | AC-08, AC-14 |
| 4.4 | Implement sync-service + core `harness telemetry sync` verb + best-effort per-shard push (ambient git auth) | sync | Pushes only `refs/harness-telemetry/*` shards; failed push doesn't error host; no `refs/heads/*` touched | AC-07, AC-14; verb named; Amendment A1 |
| 4.5 | Write `docs/how/telemetry.md` (the guide) | docs/measures | Covers capture model, enumerated segment schema, `HARNESS_NO_TELEMETRY`, sync, offline behavior, trailing-tail caveat | AC-10 |
| 4.6 | Extend `docs/how/harness-value-measures.md` with the segment **contract** (which fields are available to the measures) at team/repo grain — **contract doc only, no measure computation** | docs/measures | Hand-traced segment example; states team/repo-only; commit-author/`agent` never surfaced per-individual | AC-10, AC-11; scope-clarified by validation |

### Acceptance Coverage Map
| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | 1.4, 1.5, 1.6, 3.1, 3.4 | windowing + concurrency + composition-root + golden output |
| AC-02 | 2.2, 2.3 | Claude golden fixture |
| AC-03 | 2.4, 2.5 | Copilot golden fixture |
| AC-04 | 1.1, 1.2 (serializer boundary) · 2.2, 2.3 (adapter boundary) | counts-only schema test + adapter-boundary planted-secret on a real transcript |
| AC-05 | 1.8 | kill-switch test (`HARNESS_NO_TELEMETRY`) |
| AC-06 | 1.5, 1.7, 4.2 | gitignored buffer + porcelain-unchanged |
| AC-07 | 4.2, 4.4 | non-individual author + single-refspec push |
| AC-08 | 4.3 | plan-link dedupe test |
| AC-09 | 1.8, 3.2 | throwing-adapter fail-safety |
| AC-10 | 4.5, 4.6 | docs present + contract |
| AC-11 | 4.6 | team/repo grain doc check |
| AC-12 | 1.2, 2.1, 2.6 | stub future-harness adapter |
| AC-13 | 4.2 | non-individual commit author + no per-individual field |
| AC-14 | 4.3, 4.4 | offline-safe / failed-push leaves buffer |

### Done Contract (grill-agent-done, 2026-06-23)
Each material claim lined against the strongest proof grade it admits, with the negative control that keeps the sensor honest. Companion to `backpressure-coverage.md` (which inventoried sensor *existence*); this records what wrong-but-green implementation each sensor must reject. **Privacy scope (decided):** AC-04 must catch secrets-in-args, message/file content, and absolute paths; branch names / skill·tool·model names / plan ids / repo name are kept **verbatim** (already exposed on push/PR; hashing would break eng-thrive correlation); per-individual attribution is the separate §T1 gate.

| Claim | Grade | Sensor | Pass condition | Wrong impl it must reject | Gap |
|------|-------|--------|----------------|---------------------------|-----|
| AC-04 no secrets/content/abs-paths | deterministic | **serializer-allowlist** control (1.1, Phase 1) **+ adapter-boundary planted-secret** on a real transcript (2.2/2.3, Phase 2) | planted secret + `/Users/` absent from serialized segment at *both* boundaries | adapter copies a `Bash` tool-arg or message verbatim into `tools`/`subagents` | — |
| AC-02 Claude token math | deterministic | golden + **dup `message.id`** control, hand-derived expected (2.2) | dedupe drops the dup; all 4 buckets summed; subagent counted once | circular fixture pinning a dedupe/bucket-drop bug | — |
| AC-03 Copilot tokens | inferential | golden capture; null-on-absence (2.4) | matches capture; `null` when log absent | — (drift unsensable — accepted, not a gap to close) | drift accepted |
| AC-01/09 fail-safe + byte-identical | deterministic | throwing-adapter + golden stdout (3.1/3.2) | exit code + stdout byte-identical with a throwing adapter | "invoked + exit ok" test that ignores stdout drift / double-fire | — |
| AC-06 PR-invisible | deterministic | porcelain-unchanged; gitignore **EXISTS** (1.7/4.2) | `git status --porcelain` unchanged across capture+flush | flush touches the index / writes a tracked file | — |
| AC perf | deterministic | **structural** bounded-read-count + cursor-incremental via FakeFs (3.4) | `readText` call count is a small constant (no per-line / O(history) re-scan) **and** a prior cursor shrinks the processed window | flaky wall-clock that passes on a fast CI run, hides an O(history) re-count | M1: bounded read-count + windowed parse, not bounded bytes (whole file read twice) |
| AC-07/13 attribution | deterministic sensor / **human-judgement decision** | non-individual author check (4.2) | commit author ≠ engineer `git config user.email` | author defaults to engineer identity | **§T1 ratification owed by user — gates Phase 4** |
| AC-10/11 docs/value-contract | inferential | doc presence + review (4.5/4.6) | guide + contract present, team/repo grain | — (quality is human-judged) | quality inferential |

**One open gap, and it is not a sensor's — it is the user's:** §T1 (non-individual commit-author default) must be ratified before Phase 4. Every other material claim has a deterministic sensor or a knowingly-accepted inferential grade.

### Risks
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Hot-path latency from per-command capture | Medium | Medium | Incremental cursor read; fail-fast; perf check in 3.4 |
| Copilot log format drift | Medium | Medium | Adapter isolation; golden fixtures; null-on-absence; log dropped coverage |
| Orphan-ref plumbing portability | Medium | High | `GitWritePort` + fake; confined to sync path; not on hot path |
| Attribution doctrine breach (§T1) | Low | High | Team/repo grain; per-user out of scope; governance workshop before docs |
| Capture breaks a host command | Low | High | Fail-safe wrapper + AC-09 test |

---

## Validation Record (2026-06-23)

### Validation Thesis
**Raison d'être**: An implementation-ready plan for an ambient telemetry sensor layer (auto per-command capture → normalized segments → out-of-tree git ref) that reduces build risk and reconciles the three research tensions.
**Value claim**: Building becomes safer/clearer — phases, testable ACs, honest gates, reuse-not-rebuild, and §T1–§T3 resolved with house-doctrine grounding.
**Artifact promise**: stage-5 tasks + stage-6 implement can consume each phase; the eng-thrive scraper can consume the enumerated segment contract.
**Intended beneficiaries**: implementation agents, the eng-thrive program, reviewers, future maintainers.
**Proof target**: Implementation. **Evidence standard**: testable ACs, gates grounded in real doctrine, paths matching the codebase, tensions resolved against the constitution.
**Thesis source**: research-dossier.md + original-ask.md + harness-value-measures.md + agent memory.
**Thesis verdict**: Partially advanced → **advanced after fixes**, with one governance gate (§T1) pending user ratification.
**Main thesis risk**: Storing per-individual commit-author identity durably would breach the anti-surveillance doctrine — now defaulted to a non-individual author (AC-07/13) pending sign-off.

| Agent | Lenses Covered | Thesis Axes | Issues | Verdict |
|-------|---------------|-------------|--------|---------|
| Coherence + Architecture | Coherence, Domain Boundaries, Technical Constraints, Integration & Ripple | Proof-Level Fit | 0 (2 advisory) | ✅ (paths/gates verified against codebase) |
| Risk + Completeness + CS | Edge Cases, Hidden Assumptions, Performance, Deployment/Ops | Implementation Readiness | 3 HIGH + 2 MED fixed | ⚠️→✅ |
| Thesis Alignment | Thesis Alignment, Evidence Sufficiency, Proof-Level Fit | Thesis, User-Value | 1 CRIT + 2 HIGH + 3 MED — CRIT defaulted-safe + gated; rest fixed | ⚠️ (§T1 ratification) |
| Forward-Compatibility | Forward-Compatibility, Contract Integrity, Concept Documentation | Downstream Usefulness | schema enumerated, verb named, governance documented | ⚠️→✅ |

### Forward-Compatibility Matrix
| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| stage-5 `tasks` | concrete Done-When + paths per phase | shape mismatch | ✅ (was BLOCKED) | schema enumerated in `### Segment Schema`; verb named; concurrency/gitignore tasks added |
| stage-6 `implement` | testable ACs + concrete paths + verb name | shape mismatch | ✅ (was BLOCKED) | `harness telemetry sync` named; AC-13/14 added; perf budget set |
| eng-thrive scraper | enumerated segment contract | contract drift | ✅ (was AT RISK) | full field set in `### Segment Schema`; contract doc task 4.6 |
| value-measures consumers | team/repo grain; no per-individual | contract drift / lifecycle | ✅ (was AT RISK) | AC-07/11/13 default to non-individual author; §T1 gate before Phase 4 |

**Thesis alignment**: Value claim advanced at the Implementation proof level after fixes; the one residual risk — per-individual attribution — is defaulted to doctrine-safe and gated on user ratification before Phase 4.
**Outcome alignment**: The plan advances *"make how teams build with agents measurable so the harness program can prove and improve"* — segment substrate, capture, and the measures-contract extension all feed team-level measures; the schema/verb/governance gaps that previously blocked stage-5/6 are closed, with §T1 the one decision left to the user.
**Standalone?**: No — downstream consumers (stage-5, stage-6, eng-thrive scraper) exist.

Overall: ⚠️ **VALIDATED WITH FIXES** — Phases 1–3 are implementation-ready; **Phase 4 is gated on §T1 user ratification**.
