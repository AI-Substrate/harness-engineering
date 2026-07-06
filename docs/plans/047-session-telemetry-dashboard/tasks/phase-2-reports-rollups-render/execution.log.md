# Phase 2 — Reports, Rollups & Render — Execution Log

**Plan**: 047-session-telemetry-dashboard · **Phase**: 2 of 3 · **Domain**: `telemetry`
**Delegation**: dlg-0001 (flow-pair coder run) · **Branch**: `feat/041-flow-conformance-eval`

---

## Decisions

### D1 — `bash_command` is keyed by shell-tool name, NOT argv token (v2 substrate reality)

**Context**: Workshop 002 specifies `bash_command` rows keyed by the *first argv token* of a
shell command (e.g. `rg ×54`), grounded in `gen.py` reading the raw transcript.

**Finding (verified with orchestrator)**: v2 telemetry scrubs argv **at capture** — a shell run
becomes a `ToolsEvent = { kind:'tools', name, count, span_s }` with **no command string** (P12 /
AC-15: "NEVER free-form tool-arg strings"; `events.ts:9`). The flat `bash_commands` array was also
dropped from the v2 segment contract (`segment.ts:115`). So a saved `*.session.json` carries **no
per-command argv** to key on.

**Decision**: `bash_command` keys by the **shell-tool name, lowercased** (`bash` / `shell` / `sh`),
which is the finest bash granularity the counts-only substrate preserves. Harness invocations are
**excluded** by subtracting `harness` events that are **co-timed** (same `t`) with a shell tools
event, so `bash_command` and `harness_command` never double-count. Declared honestly in
`report.attribution` (`bash_command_key: 'shell-tool-name'`, `note: argv unavailable…`) and in a
schema description note, so a reader isn't surprised the workshop's `rg` example renders as `bash`.

**Proof**: the `copilot-cli/2026-06-24-checks-run` fixture has a `harness doctor` event co-timed with
one `tools:bash` event → `harness_command {doctor:1}`, `bash_command {}` (0), `tool {bash:1}`.

### D2 — `harness_command` is sourced from in-stream `HarnessEvent.verb`

**Context**: Workshop 002 prefers the segment `command` field as the authoritative harness count.

**Finding**: `combineSession` (`session-export.ts`) merges all segments into ONE `signals.logs`
(the per-segment `command` field is not carried into the `SessionExport`). `session-export.ts` is
**out of this phase's allowed scope**. The authoritative in-substrate signal for a harness call is
the `harness` event (`{ kind:'harness', verb }`, e.g. `doctor`, `flow nav`), which IS preserved in
`signals.logs`.

**Decision**: `harness_command` keys by `HarnessEvent.verb`, derived from
`otlpLogsToEvents(export.signals.logs)`. All five dimensions derive from that one event stream —
counts EXACT, time/tokens ESTIMATED and declared via `report.attribution`.

### D3 — the HTML template ships as a compiled TS string (`template.ts`), not a loose `.html`

**Finding**: only `harness/cli/dist` + `bin` are published (`package.json#files`), and `tsc` emits
**only `.ts` → `.js`** (no asset copy). A loose `template.html` in `src/…/render/` would never reach
an `npx`/installed CLI at runtime. Adding a build-copy step is out of this phase's scope
(`package.json`/`scripts/` are not in the allowed paths).

**Decision**: `render/template.ts` is the runtime **source of truth** (exports `REPORT_TEMPLATE_HTML`;
ships in `dist`). `render/template.html` is the human-editable twin; `report-html.test.ts` asserts the
two are **byte-identical** (drift guard). Follows the repo's existing "content baked into a `.ts`"
pattern (`docs-content.ts`, `schemas-content.ts`). `report-html.ts` imports the string (P2: pure, no
`node:*`/fs), so the render is a pure string→string transform.

---

## Discoveries & Learnings

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-07-01 | T001 | decision | bash argv scrubbed at capture; harness_command not in SessionExport | D1/D2 above; all 5 dims from `signals.logs` | events.ts:9, segment.ts:115, session-export.ts |

---

## Task progress

All tasks T001–T010 complete.

## T010 — LIVE SMOKE (runtime proof, not fixtures)

Ran the REAL built CLI (`node harness/cli/bin/harness.js`) against 3 live sessions from the repo's
`.harness/temp/telemetry/` buffer (`2bc6025f` 82 segs, `87c74648` 34 segs incl. v1, `a8d3f5d0` 26
segs), into a `/tmp` scratch dir (never the repo). Findings:

- **N=1** — `session save <id>` for all 3 → schema-valid `.session.json` + a co-produced 1-column
  `.html`; honest degraded markers surfaced (`subagent_tokens`, `v1_segments`).
- **N>1** — `report <scratch>` swept all 3 → one `harness.telemetry-report/v1` report: 3 sessions,
  `single:false`, totals 13,659 s / 40.2M tok. **harness_command ⭐** = `checks ×21`, `flow ×17`,
  `markdown-lint ×12`, … (loop machinery's own cost). **tool** = `Bash ×240`, `Read ×105`, `Edit ×87`.
  **bash_command** = `bash ×206` — i.e. 240 Bash tool calls **minus 34 harness-coincident** → the D1
  no-double-count exclusion fires on real data.
- **Render** — `report-render` + two pre-filtered arms (`Claude`, `Copilot`) in one folder → a
  **2-column** comparison, columns aligned by dimension key. Every emitted HTML rendered cleanly under
  a real DOM engine (jsdom): 5 panels, ★ harness panel, totals cards, provenance footer, **zero JS
  errors**, no `fetch` (self-contained, `file://`-safe).
- **P12 byte-scan** — every emitted artifact (report JSON + all HTML) scanned for `/Users/`, home
  paths, `/tmp/…`, and the username: **0 hits**. The absolute scratch path was sanitized to its
  basename in `provenance.source_paths` (`sanitizeInputPath`), proving the leak guard.

Runtime proof complete — the verbs work end-to-end on real telemetry, not just green fixtures.

