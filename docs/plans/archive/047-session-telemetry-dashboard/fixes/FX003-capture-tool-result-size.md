# Fix FX003: Capture per-tool-call result size (the "dumper" signal)

**Created**: 2026-07-01
**Status**: Complete — implemented (bundled with FX002) + cross-model reviewed (gpt-5.5); 1 HIGH (segment-schema omission) found+fixed+re-reviewed (2026-07-01); see [reviews/fx002-fx003-review.md](../reviews/fx002-fx003-review.md)
**Plan**: [047-session-telemetry-dashboard](../session-telemetry-dashboard-plan.md) — feeds [FX002](./FX002-honest-attribution-rules.md)'s command-token lens
**Source**: Live-data attribution design with the principal — "see actual tokens from a single call to a tool … is a particular command dumping 200k tokens back per call?" The API bills tokens **per assistant turn**, not per tool call, so a *single* call's token cost cannot be recovered from turn-usage alone. The one honest, capturable per-call number is **the size of what the call dumped back** (its `tool_result` payload), which lands as the *next* turn's input.
**Domain(s)**: `telemetry` / `_adapters` (capture — plan 034 lineage)

---

## Problem

FX002's command lens attributes a tool call's **input** token cost as its share of the *following* turn's non-cache `in` (the result it dumped becomes next-turn input). With only turn-level usage, that share is an **even-split estimate** across the tools in the window — so a 200k-dumping `cat` and a 3-line `git status` in the same turn look identical. The question "which specific call dumped 200k back?" is unanswerable from the counts-only substrate.

**But the payload is right there at capture time.** The adapters already extract the `tool_result` text (`claude-adapter.ts` `toolResultText()`), and already correlate `tool_use → tool_result` (they parse the `<usage>` block out of `Agent` tool_results by id). We just discard the payload's **size** after reading it. FX003 keeps that size — a bare token/char count, privacy-safe by construction (a number, never the content).

## Proposed Fix

Measure each `tool_result`'s payload size at capture and attach it to the tool event, so FX002 can report a **real** per-call result size and upgrade its even-split to a **byte-weighted** split.

- **`ToolCall` gains `result_tokens?: number`** (raw per-call size). Mirror FX001's `signature` threading exactly — same additive, allowlist-by-construction path (no new privacy surface: it is a count, not text).
- **Burst-collapse sums it.** `collapseToolBursts` already keys by `(name, signature)` (FX001); it **sums `result_tokens` across the burst** → `ToolsEvent.result_tokens` = total tokens this signature dumped back over its `count` calls. Report can show both total and total/count (avg per call).
- **Sizing unit = token estimate, not raw bytes.** Reuse the same word/line counting already in the adapters (`nonEmptyLines`/`wordCount`) or a cheap char/4 heuristic — it is an *estimate* label anyway (FX002 declares it). Do **not** pull in a tokenizer (per memory: tiktoken is wrong for Claude; and this is a proxy, not a billing figure).
- **Threaded through OTLP** (as FX001's `signature`/`arg` were): attach on the log record, allowlisted in `serializeEvent`'s `tools` case + the OTLP `logs.ts`/`semconv.ts` round-trip, so it survives on the committed shard.
- **Adapters**: claude-cli + copilot-cli have tool_result payloads (size them); copilot-vscode is turns-only (no per-tool payload → omit, honest absence, like FX001 Facet B there).

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| `telemetry` (events/schema) | modify | `ToolsEvent` gains optional `result_tokens?: number`; `serializeEvent` allowlists it for `tools` (mirrors `signature`) |
| `_adapters` (capture) | modify | claude/copilot adapters size the correlated `tool_result` payload → `ToolCall.result_tokens`; `collapseToolBursts` sums it per burst |
| `telemetry` (OTLP) | modify | `logs.ts`/`semconv.ts` + schema round-trip a `harness.tool.result_tokens` attribute (mirrors `harness.tool.signature`) |
| `telemetry` (report, FX002) | additive | FX002 command lens uses `result_tokens` when present to **weight** the input-split; falls back to even-split when absent (old data unaffected) |

## Tasks

| Status | ID | Task | Path(s) | Done When |
|--------|-----|------|---------|-----------|
| [ ] | FX003-1 | Add optional `result_tokens?: number` to `ToolCall` + `ToolsEvent`; allowlist in `serializeEvent`'s `tools` case (counts-only, mirrors `signature`) | `events.ts`, `segment.ts` | Typecheck passes; a `tools` event with `result_tokens` round-trips; unknown fields still dropped |
| [ ] | FX003-2 | Size the correlated `tool_result` payload in claude + copilot adapters; thread onto `ToolCall`; sum across the burst in `collapseToolBursts` | `adapters/{claude,copilot}-adapter.ts`, `rollup.ts`, `event-builder.ts` | A large-result call surfaces a large `result_tokens`; `rg ×N` sums its N results; copilot-vscode omits it (honest) |
| [ ] | FX003-3 | Thread `result_tokens` through the OTLP logs round-trip (`harness.tool.result_tokens`) + schema | `otlp/{logs,semconv}.ts` + schema | Suppressing the OTLP attr drops it on the committed shard (mutation flips a test) |
| [ ] | FX003-4 | **Test-first**: adapter/segment test over the real corpus — a big-result call carries a big `result_tokens`, a tiny one a small; P12 byte-scan proves only a number is serialized (never payload text); mutation flips it | `test/services/telemetry/**` | Failing test exists first; mutating the size to 0 flips the assertion; no payload text in the segment |
| [ ] | FX003-5 | **(FX002 hand-off)** FX002 command lens weights the input-split by `result_tokens` when present, else even-split; `report.attribution` declares "byte-weighted when available, else even-split estimate" | `report.ts` | With size-bearing fixture, a 200k-dumper shows a high `input`; without, even-split; attribution declares which |

## Acceptance

- [ ] A newly-captured session records each tool burst's total `result_tokens` (a number) — verified over a real capture, not just a unit fixture.
- [ ] No payload text reaches the segment (P12 byte-scan clean — a count only).
- [ ] FX002's command `input` is byte-weighted by `result_tokens` when present, falls back to even-split for old data.
- [ ] A known big-output call (e.g. `cat`/report of a large file) shows a **high `result_tokens`** — the "dumper" is now visible per signature.
- [ ] copilot-vscode (turns-only) omits `result_tokens` honestly (no fabricated zero-as-real).

## Not in scope

- **Per-call duration** (`tool_use → tool_result` timestamp delta) — a separate future capture add; FX002 still gives commands no time.
- **True per-call output tokens** — impossible from turn-usage (one usage number per turn covers all its tools); stays FX002's declared even-split estimate. FX003 only makes the **input/result-size** direction real.

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
