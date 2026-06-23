# Execution Log — Phase 2: Per-harness capability adapters

**Plan**: [harness-telemetry-collection-plan.md](../../harness-telemetry-collection-plan.md)
**Started**: 2026-06-23 · **Mode**: Full · **Companion**: code-review-companion (run `2026-06-23T08-20-18-651Z-f6c5`)
**Awareness**: built against the Done Contract (AC-02 dup-message.id control; AC-04 adapter-boundary deep-scan; AC-12 future-harness null-fill) + backpressure-coverage.md (Partial — all Phase-2 ACs BUILDABLE; ports-only EXISTS).

---

## T001 + T002 + T003 — Claude transcript adapter + golden fixture
**Commit**: `65779af` · **Status**: ✅ done · **AC**: AC-02, AC-04, AC-12

- **T001 (fixture)**: `test/services/telemetry/fixtures/claude-transcript.jsonl` — sanitized JSONL with all four negative controls: (1) `msg_A`/`msg_B` each on two lines with identical usage (dedupe-by-`message.id`); (2) non-zero `cache_creation`+`cache_read`; (3) an `Agent` tool_use + tool_result with inline `<usage>subagent_tokens: 1234\ntool_uses: 7</usage>`; (4) planted `SUPER_SECRET_…` + `/Users/jordan/secrets/keys.env` in a `Bash` tool-arg and a user message (non-counted fields).
- **T002 (tests, RED→GREEN)**: `claude-adapter.test.ts` — **hand-derived** expecteds: tokens `{input:8, output:60, cache_create:100, cache_read:3500, total:3668, subagent_tokens:1234, grand_total:4902}`; subagent `[{type:Explore, tokens:1234, tool_uses:7}]`; models `{claude-opus-4-8:{turns:2, output_tokens:60}}`; skills `{the-flow:1, eng-harness-flow:1}`; tools `{Skill:2,Bash:1,Read:2,Edit:1,Write:1,Agent:1}`; thinking `{blocks:2}`; compactions `[{auto,50000,8000}]`; effort `high` (from env). Path test hand-derives the leading-dash mangle. Edge: empty window → all-null; missing transcript → all-null.
- **AC-04 control (M4)**: caps run through `serializeSegment`, then the **whole serialized Segment** deep-scanned — asserts no `SUPER_SECRET`, no `/Users/`, no `Authorization`, no `keys.env`, and `files` are repo-relative. Fails if any tool-arg/message string survives in any field.
- **T003 (impl)**: `adapters/claude-adapter.ts` — `claudeAdapter` + exported `claudeTranscriptPath`. Ports-only: `env.home()` (not `env.get('HOME')`), `env.get('CLAUDE_CODE_SESSION_ID')`, `fs.readText`; offset unit = non-empty line count (M2), whole-file read + `[from,to)` slice (M1); usage deduped by `message.id`, tool_uses counted per line; subagent correlated by `tool_use_id`.
- **Evidence**: 14/14 new tests green; arch (`no-direct-node-io`/`no-direct-exit`) green; `tsc --noEmit` clean; biome clean. `capture-service.ts` + segment schema untouched (AC-12).

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-23 | T003 | decision | Claude compaction line shape varies upstream; pinned a `{type:'compaction',compactMetadata:{trigger,preTokens,postTokens}}` form in the fixture | Capability is exercised against a pinned shape (same drift-accepted stance as AC-03); real-format drift is mitigated, not proven | M-note |
| 2026-06-23 | T002 | insight | Tests legitimately use `node:fs` (`readFileSync`) to load the fixture — only `src/` is arch-restricted | Mirrors `gitignore.test.ts`; the *adapter* stays ports-only | — |

## T004 + T005 + T006 — Copilot process-log adapter + golden fixtures
**Commit**: `b0e9390` (amended from `5032f65`) · **Status**: ✅ done · **AC**: AC-03, AC-04, AC-12

- **T004 (fixtures)**: `copilot-events.jsonl` (session.model_change, tool.execution_complete with a planted secret + `/Users/` in `arguments`) + `copilot-process-log.txt` (`assistant_usage` events, `subagent_completed`). **Tokens come from `assistant_usage` only** — `session.shutdown` is not live and never read.
- **T005 (tests, hand-derived)**: tokens `{input:120, output:95, cache_create:0, cache_read:40, total:255, subagent_tokens:0, grand_total:255}` (uncached→input, cached→cache_read, reasoning folded into output); models `{claude-opus-4-8:{turns:2, output_tokens:95}}`; effort `high`; tools `{bash:1, str_replace:1}` (name only); subagent `{agent_name:explorer, model:gpt-5-mini, status:completed, tokens:null}`; null-on-absence (missing log → tokens null, events still give effort/tools).
- **T006 (impl)**: `copilot-adapter.ts` — ports-only; events for effort/tools, process-log discovery via `readdir`+prefix+session-id match for authoritative tokens. **Tool `arguments` are never copied** (AC-04). Privacy deep-scan green.
- **Fixture-tracking fix**: the `.log` fixture was gitignored (`*.log`) → renamed to `copilot-process-log.txt` (amended into `b0e9390`) so CI sees it.
- **Evidence**: 11→12 tests green; arch/tsc/biome/dep-cruiser clean.

## T007 + T008 — future-harness AC-12 proof + core-adapter registry
**Commit**: `1cf3b15` · **Status**: ✅ done · **AC**: AC-12

- **T007**: 3 proofs — partial-cap adapter → schema-shaped all-null-filled segment; null-default handles any unknown id; capture-service consumes an arbitrary adapter unmodified. (Claim later narrowed — F003.)
- **T008**: `adapters/index.ts` — `coreTelemetryAdapters = [claudeAdapter, copilotAdapter]` (null-default excluded; the Phase-3 seam, mirrors `coreRecordTypes`). Asserts disjoint `handles`, assignable to `CaptureDeps.adapters`.

## Companion findings — reconciliation (code-review-companion, every commit reviewed)
**Run**: `2026-06-23T08-20-18-651Z-f6c5` · all findings **ADDRESSED INLINE + companion-verified**.

| ID | Sev | File | Issue | Resolution | Verify |
|----|-----|------|-------|------------|--------|
| F001 | MEDIUM | claude-adapter.ts | `effort` leaked on missing/empty window (contra M6 all-null) | return pure `nullCaps`; effort read only after source present; edge tests assert `effort` null | `61f51f0` — APPROVE |
| F002 | **HIGH** | copilot-adapter.ts | process-log records summed without per-`session_id` filter → cross-session contamination (AC-03 breach) | filter every log record by `session_id`; added a `sess-OTHER-9` contamination fixture line + assertion totals stay 255 | `61f51f0` — APPROVE |
| F003 | MEDIUM | future-harness test | AC-12 capture-path proof overclaimed (detected harness was claude-code, not a new id) | narrowed claim + docstring; assert `seg.harness==='claude-code'`; documented new-harness detection = `HARNESS_ENV_CHAIN` (capture-service) concern | `c8f180a` — APPROVE |

**Companion magicWand (follow-up candidate, surfaced not auto-filed)**: *"an inbox/review helper that pins a requested SHA into a temporary read-only checkout"* — born from MH-002 below; would prevent moving-worktree confusion during async review.

## Phase 2 — COMPLETE
- **All tasks T001–T008 done**, every commit companion-reviewed, **0 open findings** (F001/F002/F003 fixed + verified). Tests: **1074/1074 green** (35 new telemetry tests across claude/copilot/future/registry). Gates: `no-direct-node-io` + `no-direct-exit` + dep-cruiser (104 modules) clean; `tsc --noEmit` clean; biome clean. `capture-service.ts` + segment schema **untouched** (AC-12 honoured).

### Deferred & Noteworthy (this phase)
| Tag | Item | Why it's fine for now |
|-----|------|----------------------|
| Noteworthy | Compaction line shape (Claude) is pinned to a fixture form; real upstream format may drift | Capability exercised; same drift-accepted stance as AC-03 (Done Contract) |
| Noteworthy | Copilot `files`/`compactions`/`thinking` left `null` this phase | `codeChanges` lives only in the non-live `session.shutdown`; tool-arg parsing avoided for AC-04 — intentional, documented (M5) |
| Noteworthy | New-harness *detection* needs a `HARNESS_ENV_CHAIN` edit (capture-service) | AC-12 covers the capability/adapter layer + null-default; detection extension is a Phase-3-adjacent capture-service concern (F003 scope note) |
| Process | MH-002: amending a commit AFTER pinging the companion caused worktree/SHA confusion mid-review | Recovered by re-pinging the corrected SHA; avoid amend-after-ping next time |

