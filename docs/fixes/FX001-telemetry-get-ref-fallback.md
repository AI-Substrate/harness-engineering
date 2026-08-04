# FX001 — `telemetry get` reads the ref when the buffer is flushed

**Mode**: standalone fix (docs/fixes/) · **CS**: 3 · **Domains**: telemetry (adapters/git, services/telemetry), flow-eval scorer (consumer, unchanged)
**Origin**: found live during plan 071's flow-eval runs (2026-08-05), proven twice.

## Problem

`harness telemetry get <pij-session-id>` — the flow-eval scorer's entire
telemetry lane — reads ONLY the local buffer (`.harness/temp/telemetry/`).
`telemetry sync` (flush) moves segment payloads to `refs/harness-telemetry/*`
and leaves marker files, so a flushed session returns
`E100 "no telemetry found"` even though every segment — with its
`captured_env` PIJ join keys — is durably on the ref.

This is not fixable by runbook ordering: the **post-commit hook auto-flushes
on every commit**, so any subject that commits blinds its own telemetry lane
before an orchestrator can score it. Proven twice tonight:

- eval run `20260804-160553Z-rictor` (blind subject): buffer synced pre-score
  → telemetry lane 0 segments → A1/A7/A8/A10 all `unknown`, with A10
  (`gate-refused`) being the assertion the scenario exists for. The segments
  sat on `refs/harness-telemetry/2026/08/04/a7bda1ce-*` with
  `PIJ_SESSION_ID=pij-key-constrictor` in all 28.
- self-score `20260804-210515Z-dkoala`: session `pij-related-koala` E100'd
  while its E440 gate-refusal evidence was verifiably on the ref.

## Fix

When the local buffer yields no segments for the session (absent OR
flushed-markers-only), `telemetry get` falls back to reading
`refs/harness-telemetry/*`: locate the session's ref(s) by the same join keys
it already uses locally (captured_env `PIJ_SESSION_ID`, harness session id),
read the rolled segment files from the ref tree, and normalize into the same
counts-only evidence object. The envelope must SAY where evidence came from
(`source: buffer | ref | buffer+ref`) — a silent merge is how the next
debugging session gets lied to. E100 remains the answer only when BOTH
surfaces are empty. Read-only: no fetch over the network is implied — local
refs only; if the ref namespace is absent locally, say so in the envelope
(`ref_checked: false`) rather than failing.

## Tasks

| # | Task | Domain | Files (expected) | Success | CS | Notes |
|---|------|--------|------------------|---------|----|----|
| T1 | Ref-read path: enumerate `refs/harness-telemetry/*`, filter to the session by join key, read+parse rolled segment files | telemetry/adapters | `harness/cli/src/adapters/git/*telemetry*`, `services/telemetry/**` | A flushed session returns its real segments from the ref | 3 | Reuse the existing rollup format (`manifest.json` + `session.logs.jsonl` + `session.metrics.jsonl`); never shell to `git` outside the existing adapter idiom |
| T2 | Fallback wiring + provenance in the envelope (`source`, `ref_checked`) | telemetry/services | `telemetry get` act + service | Envelope names its evidence source; buffer-only behavior byte-identical when buffer has data | 2 | Buffer wins when non-empty (freshest); no silent merge |
| T3 | Controls, planted-bad BOTH ways | tests | `harness/cli/test/**` | (a) flushed-buffer + ref-present → segments returned, `source: ref` FIRES pre-fix as E100; (b) both-empty → E100 still; (c) buffer-present → identical to today, `source: buffer`; (d) a ref present for a DIFFERENT session must NOT satisfy the join (wrong-session control) | 3 | Fixture: real git repo with a `refs/harness-telemetry/...` commit built by the existing sync code, then buffer wiped — the control must see the opposite (pre-fix E100) |
| T4 | Live proof against tonight's evidence | validation | none (run-only) | `telemetry get pij-related-koala` returns segments incl. the E440 `command_exit`; re-score `dd-native-builder --session pij-related-koala` shows `telemetry.available: true` (verdict may still FAIL on fs-lane domain — that is expected and out of scope) | 1 | Quote both envelopes in the execution log; do NOT commit a new ledger row as proof of exit-anything |

## Constraints (fence for the fix pair)

- Allowed: `harness/cli/src/**`, `harness/cli/test/**`. Nothing else without
  a fence question — early, by pij send.
- Forbidden: `docs/plans/**` (071 is archived + shipped; its corpus is
  closed), `live-testing/scenarios/**` (scorer bundle unchanged — this fix is
  in the CLI under it), any the-flow files, any push (orchestrator pushes),
  `.harness/live-testing/**` ledgers.
- Surface discipline: no new E-code expected (E100 semantics narrow); if one
  becomes genuinely necessary, fence-question it. `--help` text updated for
  the new fallback + provenance field.
- Every refusal/behavior class gets a planted-bad control that FIRES pre-fix
  (T3a is the headline: it must reproduce E100 against current source).
- Branch: `s065/deterministic-documents` — NOTE: commits here move PR #95's
  head; the 2026-08-05 exit green stays bound to `e4e08d42` historically and
  a fresh green is required before merge. This is deliberate (Jordan's
  direction, 2026-08-05).

## Review

Cross-model review required (same pair discipline as plan 071): Dim-0
mutation gate on T3's controls first, then fix verification, then
no-regression (`just test` full suite + `harness checks` warn trio
byte-identical to the current baseline at dispatch sha).
