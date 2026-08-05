# Workshop: Sensors TUI design — layout, keys, single-line + detailed output, playback

**Type**: CLI Flow (TUI surface)
**Plan**: 059-typed-extensions-sensors
**Spec**: `../typed-extensions-sensors-plan.md` § Business Specification (AC-11..AC-14)
**Created**: 2026-07-15
**Status**: Approved (operator: "looks good", 2026-07-15; banner + polish added same session)

**Value Thesis**: Phase 3's TUI tasks (3.2–3.3) are in the lightweight verification lane — the design must therefore be settled *here*, not renegotiated in code review. This document fixes the layout, the column contract, the key map, the single-line vs detailed reading contract, and the playback data model, so the coder renders a spec instead of inventing a UI.
**Target Proof Level**: Implementation Ready
**Current Proof Level**: Implementation Ready (Q1 resolved by the operator; D9 trap ruleset researched and folded in)

**Selected Value Axes**:
- **Operator Usability**: this is the human surface of the whole sensors feature — the columns, glyphs, and keys ARE the product for a supervising human.
- **Implementation Readiness**: the view-model type + mockups let tasks 3.2/3.3 be built and fake-tested without further design calls.
- **Agent Readiness**: the TUI and `--json` render one truth (spine D4); this doc pins what that truth contains so both surfaces agree by construction.
- **Safety to Change**: the reading-field addition (D3) and history file (D4) are additive to the frozen Phase 2 contracts — stated explicitly so review can check nothing v2-breaking slipped in.

**Related Documents**:
- `002-sensor-contract-state-schema.md` — S1–S13 (state layout, stats, trend math, reader-path status floor); this workshop only *adds*, never reshapes.
- Original inspiration: Boeckeler "sensors for coding agents" status table (operator screenshot supplied 2026-07-15).

---

## Purpose

Design the human TUI (`harness sensors` on a TTY) and its relationship to the agent JSON surface: main table, per-sensor detail view, playback of run history, key map, glyph vocabulary, degraded states, and the two contract additions the design needs (single-line vs detailed reading output; a persisted run history).

## Fresh Entrant Outcome

A fresh human or agent can, from this document alone:

- Build the Ink view (tasks 3.2/3.3) — every column, glyph, key, and state is specified with mockups.
- Author a sensor whose output looks right in both surfaces (one-liner in the table, full report in the detail view / JSON).
- Know exactly which two files the TUI reads beyond Phase 2's state (`history/<name>.jsonl`) and what writes them.

## Key Questions Addressed

- What does the main table show, in what order, at what widths? (the operator's screenshot + the brief's extra fields C3/D1)
- How do a sensor's **single-line** and **detailed** outputs coexist? (operator requirement, 2026-07-15)
- What is **playback** and what data feeds it? (operator requirement — interpretation OPEN below)
- Which keys do what, including the screenshot's `S/C/W/Q` set?
- What does the TUI show when the watcher is down, state is missing, or a sensor crashed vs failed? (S3, S13)

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Implementation Ready | Tasks 3.2/3.3 build directly from this; the lightweight lane has no second design pass |
| Primary Value Axis | Operator Usability | The table is the product for humans |
| Supporting Value Axes | Implementation/Agent Readiness, Safety to Change | One truth, two renderers; additive-only contract changes |
| Downstream Loop Improved | Implementation + review of Phase 3 | Coder renders a spec; reviewer diffs against mockups instead of taste |

## Decision Summary (D1–D7)

| # | Decision | Selection |
|---|----------|-----------|
| D1 | Layout shape | **Main table + drill-in detail view** (Option B) — not one mega-wide table |
| D2 | Main-table columns | `# · Sensor · When · St · Trend · Last Run · Run · Details` (widths below) |
| D3 | Single-line vs detailed output | `reading.details` **stays the one-liner** (table column, ≤80 chars, truncated with `…`); new **optional `reading.report: string`** (multi-line) shown in detail view + `--json` — additive to S2, normalizer passes it through, v1 untouched |
| D4 | Playback data | New per-sensor **append-only ring `history/<name>.jsonl`** under `.harness/temp/sensors/`, capped at **50** records (rewrite-on-append keeps newest 50); writer = the same state-store write path that lands `state/<name>.json`; gitignored like all of S4 |
| D5 | Update loop | Poll `state/` mtimes + `daemon.json` heartbeat every **1000ms** (S6 readers never IPC); re-read only changed files |
| D6 | Key map | Screenshot-compatible: `1-9` re-run row · `↑/↓` select · `enter` detail · `←/→` playback in detail · `s` snapshot · `c` clear & re-run all · `w` close viewer (watcher keeps running) · `q` quit + stop watcher · `esc` back |
| D7 | Status glyph vocabulary | One table below — encodes S3's runStatus/reading split so a crash never masquerades as a fail |
| D8 | Banner + visual polish | Hand-authored 3-line box-glyph **SENSORS** wordmark (a string constant — NO figlet/banner dependency); dim borders, one accent color, braille spinner for in-flight rows; banner collapses to plain bold `SENSORS` when rows < 20 or cols < 84 |
| D9 | TUI traps ruleset | 14 researched rules below (Perplexity deep-research 2026-07-15): alt-screen + raw-mode restore on ALL exit paths, memoized rows, single-width glyphs only (no emoji), NO_COLOR glyph fallback set, debounced resize with tiered breakpoints, spinner timer only while in-flight, coalesced 1s poll |

---

## D1/D2 — The main table

Everything from Phase 2's real shapes: `SensorStateView { record, stats, ageMs }`, `computeTrend(...)`, `SensorDaemonView`. Nothing rendered here that the `--json` envelope doesn't also carry (spine D4).

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  ╔═╗╔═╗╔╗╔╔═╗╔═╗╦═╗╔═╗                                                                │
│  ╚═╗║╣ ║║║╚═╗║ ║╠╦╝╚═╗   harness-engineering                                          │
│  ╚═╝╚═╝╝╚╝╚═╝╚═╝╩╚═╚═╝   watcher ● running (pid 84121, up 2h 14m)                     │
│  snapshot: 2026-07-15 11:42:09        (deltas vs this baseline)                        │
├────┬────────────────┬────────┬────┬───────┬───────────┬─────────────┬─────────────────┤
│  # │ Sensor         │ When   │ St │ Trend │ Last Run  │ Run         │ Details         │
├────┼────────────────┼────────┼────┼───────┼───────────┼─────────────┼─────────────────┤
│  1 │ tests          │ watch  │ ●  │  →    │ 2s ago    │ 4.9s ~5.1s  │ 2472 passed     │
│  2 │ lint-count     │ watch  │ ●  │  ▲    │ 4s ago    │ 1.2s ~1.1s  │ 1 warning · no-…│
│  3 │ typecheck      │ watch  │ ●  │  →    │ 5s ago    │ 3.0s ~3.2s  │ no errors       │
│  4 │ mutation-score │ manual │ ●  │  ↗    │ 31m ago   │ 58s  ~61s   │ 87% killed      │
│  5 │ coverage       │ watch  │ ●  │  →    │ 8s ago    │ 5.0s ~5.0s  │ 80.7% branch (t…│
│  6 │ deps-audit     │ watch  │ ✖  │  —    │ 12s ago ✗3│ 0.4s ~2.9s  │ E211 registry u…│
│  7 │ arch-check     │ watch  │ ◐  │       │ running…  │ 2.1s… ~4.0s │                 │
│  8 │ docs-drift     │ watch  │ ◌  │  —    │ 1h ago ⚠  │ 0.9s ~1.0s  │ skipped: no doc…│
├────┴────────────────┴────────┴────┴───────┴───────────┴─────────────┴─────────────────┤
│ 1-9 re-run  ↑↓ select  ⏎ details  s snapshot  c clear+rerun  w close  q quit sensors  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Column contract

| Column | Width | Source | Rendering rules |
|--------|-------|--------|-----------------|
| `#` | 3 | row index | `1-9` are hotkeys; rows past 9 selectable via `↑/↓` only |
| `Sensor` | 14 flex-min | `name` | truncate with `…` |
| `When` | 6 | `decl.trigger ?? 'watch'` | `watch` / `manual`; the article's cadence seconds don't exist here — our sensors are repo-change-triggered (AC-10), and the watch globs live in the detail view |
| `St` | 2 | `record.runStatus` + `record.reading.state` | glyph table below (D7) |
| `Trend` | 5 | `computeTrend` vs snapshot | `↗` better · `→` steady · `▲` worse · `—` null (no baseline / skip) |
| `Last Run` | 9 | `stats.lastRunAt` → age | humanized (`2s ago`, `31m ago`); suffix `✗N` when `stats.failStreak ≥ 2` (N = streak); suffix `⚠` when `record.stale` or the watcher is down (staleness flag, brief C3) |
| `Run` | 11 | `stats.lastWallclockMs` + `avgWallclockMs` | `4.9s ~5.1s` (last, then `~`rolling avg); while running: elapsed + `…` |
| `Details` | rest | `reading.details` (one-liner) | truncate with `…`; crash/timeout rows show `E211/E212 <message>` instead; `runCount` deliberately NOT a column — it lives in the detail view |

Header carries the two global facts: **watcher liveness** (`SensorDaemonView` — `● running (pid, up X)` / `○ STOPPED — readings stale`) and the **snapshot timestamp** the Trend column is measured against (`no snapshot — press s to set a baseline` when null).

## D7 — Status glyphs (the S3 split, visible)

| Glyph | Means | From |
|-------|-------|------|
| `●` green | reading `pass` | `runStatus:'ok'` + `reading.state:'pass'` |
| `●` yellow | reading `warn` | … `'warn'` |
| `●` red | reading `fail` | … `'fail'` |
| `◌` dim | reading `skip` | … `'skip'` (excluded from trend + streak per S5) |
| `✖` red | sensor **crashed** — not a failing reading | `runStatus:'error'` (E211) |
| `⧖` red | sensor **timed out** | `runStatus:'timeout'` (E212) |
| `◐` cyan | running now | scheduler in-flight |
| `·` dim | queued (stale rerun pending) | scheduler depth-one queue |

A crashed sensor never renders as a red reading — the operator sees *the measurement is broken*, not *the code is bad* (S3's whole point, kept visible).

**NO_COLOR / low-color fallback (D9 rule 9 — never color-only meaning).** `pass/warn/fail` share `●` and differ only by color above, which is illegible under `NO_COLOR`, 8-color terminals, or color-blindness. When color is suppressed (env `NO_COLOR` set, or `TERM=dumb`), the St column switches to a shape-distinct set: `✓` pass · `!` warn · `✗` fail · `-` skip · `E` crash · `T` timeout · `~` running. All glyphs in both sets are single-width (wcwidth=1); **no emoji anywhere** in the TUI.

## D8 — Banner + visual polish

The wordmark is one hand-authored, three-row block-element string constant (no figlet/banner dependency — the 2-runtime-dep discipline stands; ink itself is the only Phase 3 addition, and it's optional):

```
█▀▀▀▀  █▀▀▀▀  █▄  █  █▀▀▀▀  ▄▀▀▀▄  █▀▀▀▄  █▀▀▀▀
▀▀▀▀█  █▀▀▀▀  █ ▀▄█  ▀▀▀▀█  █   █  █▀█▀   ▀▀▀▀█
▀▀▀▀▀  ▀▀▀▀▀  ▀   ▀  ▀▀▀▀▀   ▀▀▀   ▀  ▀   ▀▀▀▀▀
```

Revised from box-glyph after operator legibility finding OP-1.

- Rendered dim/accent-tinted, top-left; repo name + watcher liveness ride its right side (see mockup) so the banner costs zero extra rows beyond the header block.
- **Collapse rule**: terminal `rows < 20` or `cols < 84` → plain bold `SENSORS` single line. `--ascii` mode (or a box-glyph-hostile terminal) → same plain-text collapse; ASCII `+-|` borders replace box-drawing throughout.
- Polish vocabulary (whole TUI): dim borders · ONE accent color (cyan) for selection + banner · status colors only in St/Trend/Details · braille `dots` spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) at 120ms **only** on in-flight rows.

## D9 — TUI traps ruleset (researched 2026-07-15, Perplexity deep-research)

Binding on tasks 3.2/3.3 — each rule is a review checkline:

| # | Rule | Trap it prevents |
|---|------|------------------|
| 1 | Enter alt-screen (`\x1b[?1049h`) on mount, leave (`\x1b[?1049l`) via `useEffect` cleanup AND `process.on('exit'/'SIGINT'/'uncaughtException')` | scrollback lost / terminal stuck in alt buffer on crash |
| 2 | Raw-mode restore rides the same centralized exit path | shell stops echoing; user needs `stty sane` |
| 3 | ONE `useInput` owner routing by mode (`table` \| `detail`); never parallel global handlers | double-handled keys, focus fights |
| 4 | Memoize row components (`React.memo`) + stable callbacks (`useCallback`); a tick re-renders only rows whose data changed | full-table diff every second → flicker + CPU |
| 5 | One coalesced state update per 1s poll tick (read changed files only, by mtime cache) | render storms from per-file updates |
| 6 | Spinner timer (120ms) exists ONLY while ≥1 row is in-flight; no timers when idle beyond the 1s stat poll | idle CPU burn |
| 7 | Keep flex nesting shallow (≤3 levels); fixed column widths, one flex-grow Details column | expensive layout recompute per tick |
| 8 | `<Static>` only for append-only regions — v1 has none, so don't use it | "updating" Static rows duplicates output |
| 9 | Never color-only meaning; honor `NO_COLOR` + `TERM=dumb` (fallback glyph set above); ONE accent color | illegible under color suppression |
| 10 | Single-width glyphs only (wcwidth=1); no emoji; braille spinners OK | column misalignment from double-width chars |
| 11 | `stdout.on('resize')` → debounce ~150ms → state; tiered breakpoints: full ≥100 cols · reduced (drop Run/Trend) ≥84 · minimal below; verify Ink's fixed-width-at-instantiation issue in the 3.4 spike | no reflow, or jitter under rapid resize |
| 12 | TUI ONLY when `stdout.isTTY && TERM !== 'dumb'` — else exactly the `--json` path (AC-12); never emit alt-screen/ANSI to pipes/CI | ANSI noise in logs, corrupted pipes |
| 13 | Ink 4/5 is ESM-only: load exclusively via `await import('ink')` behind the TTY branch; the 3.4 packaging spike proves it from our build's module system | require() of ESM crash / accidental eager React load |
| 14 | Detail pane = full-width overlay (not side-by-side) — width-independent, matches the k9s drill-in pattern; context-sensitive footer swaps hints per mode; `?` reserved for a help overlay if hints ever outgrow the footer | broken side-by-side under narrow widths; footer clutter |

**Operator amendment (OP-2/OP-4/OP-5/OP-6/OP-8; supersedes D2/D6/D9 #11 where different):** row `⚠` means `record.stale` or age >15m (never watcher-down alone); the footer uses actual `1-N`, adds `a` run-all without clearing, and gives guidance its own row; reduced width drops Trend before Run so duration remains visible.

**OP-9 amendment:** all non-watch run-all actions share a declaration-ordered bounded pool (default 4); `sensors check --concurrency 1` retains uncontended sequential timing.

## D1 — Detail view (⏎ on a row) + D4 playback

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  coverage                                              ● pass · → steady vs snapshot  │
├────────────────────────────────────────────────────────────────────────────────────────
│  summary    Branch coverage across harness/cli (v8)                                   │
│  trigger    watch: harness/cli/src/**, harness/cli/test/**       timeout 30000ms      │
│  last run   2026-07-15 11:44:02 (8s ago) · ok · 5.0s (avg 5.0s over 214 runs)         │
│  streak     0 consecutive failures                                                    │
│  snapshot   80.5% at 11:42:09 → now 80.7%  (Δ +0.2, direction: higher-is-better)      │
│  details    80.7% branch (target 80)                                                  │
│  guidance   Add branch tests for the files named in the report before raising the bar │
│  report ────────────────────────────────────────────────────────────────────────────  │
│    Statements   : 91.12% ( 9387/10301 )                                               │
│    Branches     : 80.66% ( 6393/7925 )                                                │
│    Functions    : 93.91% ( 1543/1643 )                                                │
│    uncovered: services/sensors/scheduler.ts 118-124, adapters/hash/node-hash.ts 21    │
│  history ── run 214 of 214 (live) ──────────────────────────────────────────────────  │
│    11:44:02 ● 80.7%   11:43:10 ● 80.7%   11:41:55 ● 80.5%   11:38:12 ● 80.5%          │
│    11:31:09 ● 79.9%   11:29:44 ⧖ E212    11:22:03 ● 79.9%   …                         │
├────────────────────────────────────────────────────────────────────────────────────────
│  ←/→ playback older/newer   r re-run   esc back                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **Playback** (`←/→`): scrub through the history ring; the upper panel re-renders *that* run's record (state, details, report, wallclock) with a `⏪ viewing run 209 of 214 — → to return to live` banner. Live tail resumes on `→` past newest or `esc`.
- `report` shows `reading.report` verbatim (multi-line, scrollable when long); absent → the section is omitted.
- `guidance` = `reading.guidance ?? decl.guidance` (S1/S2 precedence, unchanged).

### D4 — `history/<name>.jsonl` (the playback substrate)

```
.harness/temp/sensors/
├── state/<name>.json       # unchanged (S4): { schema, record, stats }
├── history/<name>.jsonl    # NEW: one SensorRunRecord JSON per line, newest last, ≤50 lines
├── daemon.json             # unchanged (S6)
└── snapshot.json           # unchanged (S7)
```

- Written by the same store call that lands `state/<name>.json` (append + trim to 50; atomic rewrite like S4's temp-rename).
- Records only — stats are derivable and not duplicated. Unparseable/missing history → detail view shows `history unavailable` and the TUI stays functional (S13 posture: degrade, never die).
- Cap 50 is a constant next to S10's scheduler constants; not configurable in this plan.

## D3 — Single-line + detailed output (authoring contract addition)

```typescript
// contract.ts — SensorReading gains ONE optional field (additive; v1 untouched; normalizer passes through)
interface SensorReading {
  state: 'pass' | 'warn' | 'fail' | 'skip';
  score?: number;
  direction?: 'higher' | 'lower';
  threshold?: number;
  details?: string;    // EXISTING — the single line (table column). Keep ≤80 chars; UI truncates.
  guidance?: string;   // EXISTING — self-correction one-liner
  report?: string;     // NEW — multi-line detailed output; detail view + --json only. S12 still applies:
                       // author-written content, never raw child stdout/stderr dumped wholesale.
}
```

Fallback when `details` is absent: the table derives `"<state>` + `score` when present (e.g. `pass (87)`); authors are nudged toward real one-liners by the scaffold template.

## The agent surface (unchanged truth, one addition)

`harness sensors --json` (and non-TTY bare — AC-12) already carries everything above from the same view-model; D3/D4 add `report` on readings and nothing else (history is *read on demand* in the detail view, not shipped in the status envelope — envelopes stay small for agents):

```json
{ "command": "sensors", "status": "degraded",
  "data": { "daemon": { "running": false, "pid": null },
            "snapshot": { "takenAt": "2026-07-15T01:42:09Z" },
            "sensors": [ { "name": "coverage", "trigger": "watch", "trend": "steady",
                           "ageMs": 8123, "stale": false,
                           "record": { "runStatus": "ok", "reading": { "state": "pass", "score": 80.7,
                                       "details": "80.7% branch (target 80)", "report": "…" } },
                           "stats": { "runCount": 214, "lastWallclockMs": 5012,
                                      "avgWallclockMs": 5031, "failStreak": 0 } } ] },
  "next_action": "Start the watcher: `harness sensors watch`." }
```

(`status: "degraded"` here because the daemon is down — S13's floor: reader paths never exit 2.)

## Degraded / empty states (all mockup-level, no new logic)

| State | TUI rendering |
|-------|---------------|
| Watcher down | header `watcher ○ STOPPED — readings stale`; every `Last Run` gains `⚠`; table still renders from last state (S6: readers never IPC) |
| No state at all | empty table + one centered line: `No sensor state yet — press c to run all, or start the watcher.` |
| No sensors registered | `No v2 sensors: declarations found.` + the E210-family next_action verbatim |
| No snapshot | Trend column all `—`; header invites `s` |
| >9 sensors | rows 10+ have no number; hotkey column blank; `↑/↓ + ⏎` unaffected |

## Key map (D6) — full semantics

| Key | Action | Notes |
|-----|--------|-------|
| `1-9` | re-run that row now | via the engine's manual-run path (`trigger:'manual-run'`); works on `manual` sensors too |
| `↑/↓` | move selection | selection highlight on the row |
| `⏎` | open detail view | `esc` back |
| `←/→` | (detail view) playback older/newer | D4 ring |
| `r` | (detail view) re-run this sensor | same as its number |
| `s` | take snapshot | engine snapshot verb; header timestamp updates; a no-readings snapshot returns a degraded envelope (no E-code) — its `next_action` surfaces as a footer flash, not a crash |
| `c` | clear state + re-run all | deletes `state/` + `history/` (scratch by contract, S4) then fires a check-style run-all |
| `w` | close viewer, watcher keeps running | the TUI is a view you attach (spine C6) |
| `q` | quit AND stop the watcher | confirm flash: `q again to stop sensors` |

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|-------------|-----------------|----------------|
| Implementation (3.2/3.3) | Coder invents layout, glyphs, keys, history storage mid-task | Renders the mockups; view-model + two contract additions are pinned |
| Review | Reviewer argues taste | Reviewer diffs behaviour against D1–D7 + mockups |
| Sensor authoring | Authors guess how output appears | `details` = table line, `report` = drill-in; scaffold template shows both |
| Operator supervision | Crash vs fail vs stale ambiguous | D7 glyphs + staleness/streak suffixes make each mechanically distinct |

## Open Questions

### Q1: Is "playback" run-history scrubbing?

**RESOLVED** (operator, 2026-07-15: "looks good" on the design as written): playback = scrub back through a sensor's past runs in the detail view, fed by the D4 history ring.

### Q2: `c` (clear & re-run) — acceptable to also clear history?

**RESOLVED (proposed)**: yes — state and history are both regenerable scratch (S4/S13); `c` resets both. Snapshot is NOT cleared (it's the baseline you chose deliberately; `s` overwrites it).

## Validation / Acceptance

This workshop reaches Implementation Ready when:

- ~~Q1 is confirmed by the operator~~ ✅ resolved 2026-07-15.
- Tasks 3.2/3.3 are cut referencing D1–D9 with no additional design decisions needed.
- The D3 field addition + D4 history file are reflected in the Phase 3 task list as explicit, additive contract tasks (with conformance-corpus coverage for `report` pass-through).
- Each D9 rule appears as a checkable line in the phase's review scope (the reviewer greps the ruleset, not their taste).

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| Main-table mockup | § D1/D2 | layout, columns, header/footer | Ready |
| Detail + playback mockup | § Detail view | drill-in, playback UX | Ready |
| Column contract table | § Column contract | exact sources/widths/truncation | Ready |
| Glyph table | § D7 | S3 split rendered | Ready |
| `report` field diff | § D3 | single-line vs detailed contract | Ready |
| `history/*.jsonl` schema | § D4 | playback substrate | Ready |
| JSON envelope example | § Agent surface | D4 spine parity (one truth) | Ready |
| Degraded-state table | § Degraded states | S13 posture in the UI | Ready |
| Banner constant + collapse rule | § D8 | wordmark, polish vocabulary, --ascii fallback | Ready |
| Trap ruleset (14 rules) | § D9 | exit/raw-mode restore, memoization, glyph widths, NO_COLOR, resize tiers, ESM loading | Ready |
