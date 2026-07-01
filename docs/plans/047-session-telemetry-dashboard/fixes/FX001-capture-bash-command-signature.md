# Fix FX001: Capture bash-command signature into the event stream

**Created**: 2026-07-01
**Status**: Proposed (awaiting GO)
**Plan**: [047-session-telemetry-dashboard](../session-telemetry-dashboard-plan.md) — motivating consumer (the `bash_command` rollup, Phase 2)
**Source**: Phase-2 build discovery (coder pij-1ih6gj9 dlg-0001 + orchestrator verification) → observe `MW-001`; principal directive "collect first param for any external bash command (bash rg) or powershell"
**Domain(s)**: `telemetry` / `_adapters` (capture — plan 034 lineage) + `telemetry` (report keying — plan 047)

---

## Problem

A saved `SessionExport` cannot tell `rg` from `git` from `grep` — every shell call survives only as `ToolsEvent{kind:'tools', name:'bash', count, span_s}`, with **no argv**. Workshop 002's headline use-case ("where did 1M tokens go — is it `rg`?") is therefore unanswerable at argv granularity from the counts-only substrate.

**But the extraction already exists and is discarded.** `command-signature.ts` already reduces a command line to a privacy-safe signature (`rg foo`→`rg`, `git commit -m "secret"`→`git commit`, cross-platform `.exe/.ps1` strip, quote/heredoc-aware, allowlist-by-construction — P12/AC-15 safe). All three adapters (`claude`/`copilot`/`cursor`) **already call `commandSignatures(cmd)` on every command** — but they keep only signatures that resolve to a **harness** verb (→ `HarnessEvent.verb`) and **throw away every non-harness signature** (`claude-adapter.ts:358`, `copilot-adapter.ts:467`, `cursor-adapter.ts:329`). The fix is to **keep** the discarded signatures.

## Proposed Fix

Attach the (already-computed, already-privacy-safe) command signature to the shell tool event so the `bash_command` rollup can key by it. Additive and counts-only: reuse `commandSignatures()` verbatim — **no new privacy surface**. Harness invocations stay as separate `HarnessEvent`s, so `bash_command` still subtracts co-timed harness events to avoid double-count (unchanged).

**Key design decision (flag for GO)** — burst-collapse granularity: `collapseToolBursts` (`rollup.ts`) currently collapses tool calls **by name** (`event-builder.ts:46` → `{name:'bash', count}`). For per-signature counts, **key shell-tool bursts by `(name, signature)`** instead of `name` alone (so `bash:rg ×54` and `bash:git ×12` are distinct bursts), leaving non-shell tools (`Read`, `Edit`) collapsing by name as today. Alternative (simpler, coarser): attach only the burst's dominant signature. **Recommend the `(name, signature)` keying** — it's what makes the `rg` vs `git` split real.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| `telemetry` (events/schema) | modify | `ToolsEvent` gains optional `signature?: string`; `serializeEvent` allowlists it for `tools` (mirrors the existing `api_error.signature` allowlist, `segment.ts:406`) |
| `_adapters` (capture) | modify | 3 adapters keep non-harness `commandSignatures` and attach to the shell tool event; `collapseToolBursts` keys shell bursts by `(name, signature)` |
| `telemetry` (report, plan 047) | additive | Phase 2 `bash_command` keys by `signature` **when present**, else falls back to tool name (existing data/fixtures unaffected) |

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | FX001-1 | Add optional `signature?: string` to `ToolsEvent`; allowlist it in `serializeEvent`'s `tools` case (counts-only, mirrors `api_error.signature`) | telemetry | `harness/cli/src/services/telemetry/events.ts`, `segment.ts` | Typecheck passes; a `tools` event with `signature` round-trips through serialize; unknown fields still dropped (allowlist intact) | Additive; P12 allowlist-by-construction preserved |
| [ ] | FX001-2 | Key shell-tool bursts by `(name, signature)` in `collapseToolBursts`; carry the signature from the raw `ToolCall` through `buildEventStream` (`event-builder.ts:46`) | telemetry | `harness/cli/src/services/telemetry/rollup.ts`, `event-builder.ts` | `rg ×N` and `git ×M` from the same session collapse to **distinct** `tools` events with their signature; non-shell tools unchanged | Design decision above |
| [ ] | FX001-3 | Keep the discarded non-harness signatures in all 3 adapters — attach to the emitted shell tool event; harness verbs still emit separate `HarnessEvent`s | _adapters | `adapters/{claude,copilot,cursor}-adapter.ts` | The copilot-cli/claude real fixtures: a non-harness command surfaces its signature; a co-timed `harness doctor` stays a `harness` event (no double-count) | Reuse `commandSignatures`; F008 co-timed guard unchanged |
| [ ] | FX001-4 | **Test-first**: adapter/segment test over the real corpus asserting non-harness signature capture + no harness double-count; mutation flips it | telemetry | `harness/cli/test/services/telemetry/**` | A failing test exists before FX001-2/3; a mutated fixture (drop the signature) flips the assertion | Fakes over mocks; real fixtures |
| [ ] | FX001-5 | **(depends on Phase 2)** report `bash_command` keys by `signature` when present, else tool name; update `report.attribution` note to declare argv-granularity-when-available | telemetry | `harness/cli/src/services/telemetry/report.ts` | With a signature-bearing fixture, `bash_command` shows `rg`/`git` rows; with an old fixture, falls back to `bash`; attribution declares which | Additive on Phase 2; do **after** dlg-0001 lands |

## Workshops Consumed

[002 — report model](../workshops/002-report-model-rollups-and-html.md) (the `bash_command` dimension + the "1M tokens on rg" ask this restores at argv granularity). The workshop's argv assumption was grounded in `gen.py` reading the transcript; this fix moves that capability into the counts-only substrate safely.

## Acceptance

- [ ] A newly-captured session records shell commands by signature (`rg`, `git commit`) in the event stream — verified over a real capture, not just a unit fixture.
- [ ] No new free-form text reaches the segment (P12 byte-scan clean — signature is program+verb only, via `commandSignatures`).
- [ ] `harness_command` and `bash_command` never double-count a `harness …` invocation.
- [ ] Phase 2 `bash_command` keys by signature when present and falls back to tool name for old data (FX001-5).

## Not in scope

- Skill invocation args (`/the-flow 7`) — flow **stages** are already captured authoritatively from `the-flow.json` nav as `FlowEvent{flow, stage}` (plan 035 replay), a better source than parsing typed args; no change needed for stage-mapping.
- Full argument capture — only the program+verb **signature** is ever stored (P12).

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
