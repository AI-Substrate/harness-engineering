# Requirements spine — typed extensions + `harness sensors`

**Captured**: 2026-07-14 · from the design conversation preceding this flow (Boeckeler "sensors for coding agents" sidecar → engineering-harness/back-pressure lens → iterated design). This is the requirements backbone the plan stage consumes — what and why, with the decisions already settled in conversation marked ⚑ (settled) vs ? (open).

## Thesis

Deterministic back-pressure needs a first-class home in the harness (rules-of-why Rule 7): sensors as a typed kind of harness extension, run continuously by a `harness sensors` built-in, rendered two ways from one truth — a human TUI and an agent-friendly envelope. Prerequisite: the extension authoring model gets a standardising factory refactor, because real-world extensions (the private consumer repo) are hand-rolling subverb dispatch, step-runners, bounded exec, and even a sensor registry (`checks`) in userland.

## A — Extension factory refactor (the substrate)

| # | Requirement | Status |
|---|---|---|
| A1 | A `defineExtension()` factory: one declarative entry per extension package carrying `name`, `summary`/description, and contributed items by kind — `verbs` (with **subverbs**), `sensors`, `records`. | ⚑ |
| A2 | **Real subverbs**: nested commander commands with per-subverb `--help`, scoped options/args; kernel owns empty/unknown-subverb handling (replaces every hand-rolled `switch (ctx.args.verb)` — see private-consumer `db`, `shopify` 15-case/3,744-line evidence). `help`/`doctor`/`instructions`/docs see the full tree structurally. | ⚑ |
| A3 | **Backwards compat is king**: old exports (`HarnessVerb | HarnessRecordType | array`) load forever unchanged; the loader's existing route-by-`kind` union widens by one arm; kernel normalizes v1 exports into the v2 shape right after load (one adapter, not scattered compat). No migration required, no doctor wail — at most an info line. | ⚑ |
| A4 | Platform gaps close in the contract, not userland: `ctx.exec` gains `timeoutMs` + env controls (deletes private-consumer `boot`'s 60-line spawn wrapper); an injected step-runner `ctx.steps()` (timing, ✅/❌ rollup, fail aggregation — deletes private-consumer `db`'s private copy). | ⚑ |
| A5 | `./contract` stays runtime-independent for authors: `defineExtension` is an identity-style branding function; the loader aliases `@ai-substrate/engineering-harness/contract` to the core's own module (jiti alias), so resolution never depends on consumer `node_modules`; plain-JS authors may export the bare branded object literal. | ⚑ |
| A6 | `harness new` scaffolds v2 only, including `--sensor` (wrap-a-command starter). New surface (subverbs, sensors, step-runner) is v2-only — the paved-path migration incentive (Rule 9: never gate). | ⚑ |
| A7 | Anti-sprawl guard: a verb remains `run(ctx) → VerbResult`; no lifecycle hooks/middleware/plugin-of-plugins until a wild extension hand-rolls one (same evidence standard that justified this refactor). | ⚑ |

## B — Sensor kind + contract

| # | Requirement | Status |
|---|---|---|
| B1 | `kind: 'sensor'` as a third extension-export arm. Sensors are **deterministic only**: no LLM, no network expectation, hard `timeoutMs` enforced by the scheduler, safe to run repeatedly. Inferential review stays in skills/verbs. | ⚑ |
| B2 | A narrow `SensorReading` result (not conventions inside `data`): `state` (`pass/warn/fail`), numeric `score` + `direction` (`lower`/`higher`-is-better), optional `threshold`, `guidance` string (self-correction text — Boeckeler's guidance-enriched-messages finding), details line. *(Workshop 002 S2/Q1 widens `state` with `skip` — private-consumer skip-safe evidence.)* | ⚑ |
| B3 | Run-status vs finding-status are separate: envelope status = "did the sensor run" (ok/error/…); `reading.state` = "what it found". A crashed sensor is distinguishable from a failing one. | ⚑ |
| B4 | Sensor declaration carries `watch` globs, `timeoutMs`, and `trigger: 'watch' | 'manual'` (manual = expensive sensors, e.g. mutation testing, contract-ready even if v1 ships watch-only). | ⚑ |
| B5 | Sensors register in a **sensor registry**, not the top-level verb namespace: run via `harness sensors run <name>`, listed by `harness sensors`/`doctor`. `sensors` becomes a reserved core command. | ⚑ |

## C — `harness sensors` built-in (runner + state)

| # | Requirement | Status |
|---|---|---|
| C1 | Watch loop: per-sensor `watch` globs, global quiescence window (~1s of quiet — agents write in bursts), content-hash dedup (no-op saves don't rerun), serialize per sensor, at most one queued rerun (stale-marked, never a backlog). Node 20+ recursive `fs.watch` first; `@parcel/watcher` if edge cases demand. | ⚑ |
| C2 | **Runner/renderer decoupled via state files**: the daemon writes per-sensor readings to `.harness/` (atomic rename) + heartbeat/pidfile. Readers never IPC with the daemon. | ⚑ |
| C3 | Stats persisted per sensor: last run time, last wallclock, rolling average, run count, consecutive-failure streak — all readable daemon-down (stale-flagged via per-sensor `age`). Per-sensor JSON files first; db adapter only if outgrown. | ⚑ |
| C4 | **Snapshot/trend baseline** (Boeckeler's mechanism): `harness sensors snapshot` (and TUI key) stores a baseline; readings carry delta-vs-snapshot so an agent distinguishes "I broke this" from "already broken". | ⚑ |
| C5 | One-off runs allowed anytime (`harness sensors run <name>`), writing the same atomic state (last-writer-wins) — no locking protocol. | ⚑ |
| C6 | Headless mode `harness sensors watch` (loop, no TUI) — agent/CI sessions start it via the existing `ctx.background.spawnDetached`; the TUI is a view you attach, not the runner. | ⚑ |
| C7 | Advisory posture (Rule 9): sensors report and guide; the scheduler never blocks commits or gates agents. | ⚑ |

## D — Surfaces (TUI + JSON + agent detection)

| # | Requirement | Status |
|---|---|---|
| D1 | `harness sensors` on a TTY → long-running **Ink** TUI (React-for-terminal): per-sensor rows with status light, trend-vs-snapshot, cadence, last-run age, wallclock/avg, details/guidance; keys for re-run row, snapshot, quit. Ink lazy-imported on the TTY path only (dependency discipline — non-TTY/JSON callers never load React). | ⚑ |
| D2 | `harness sensors --json` → current status as a standard Envelope from state files: per-sensor readings + stats + `age`, plus `daemon: {running, pid, since, heartbeat}`. Daemon not running → honest `unconfigured`/`degraded` with `next_action: start harness sensors` — it does **not** silently run sensors. *(Workshop 002 S13 pins this to `degraded` only — `unconfigured` exits 2 by the core contract.)* | ⚑ |
| D3 | Agent detection is `process.stdout.isTTY`: non-TTY invocation of bare `harness sensors` emits the `--json` behaviour directly (saves the agent a turn) rather than a "run --json" hint. The Envelope **is** the agent surface — `next_action`/`guidance` carry the self-correction text; no bespoke agent-text format. | ⚑ |
| D4 | Two renderings, one truth: TUI and JSON both derive from the same state files; no divergent computation. | ⚑ |

## E — Open questions for the plan stage

| # | Question |
|---|---|
| E1 | Exact `SensorReading`/`SensorDeclaration`/`ExtensionDefinition` type shapes + state-file schema (the two artifacts everything hangs off). |
| E2 | Sequencing confirmed as: factory + subverbs + v1-normalization first (pure refactor, proven by loading both repos' extensions unchanged), then sensor kind + `harness sensors` on the clean substrate — one plan, phased? Or split plans? |
| E3 | Watcher library decision point (native `fs.watch` vs `@parcel/watcher`) — criteria for when to switch. |
| E4 | How `checks`-style aggregation (run every sensor once, gate on verdicts — the private consumer's hand-rolled version) is offered as a core affordance without violating C7's never-gate posture (CI is allowed to gate; the harness itself doesn't). |
| E5 | Where snapshot state lives relative to git (ignored? committable baseline?). |

## Evidence base

- Boeckeler / martinfowler.com "sensors for coding agents" appendix: sidecar architecture, snapshot/trend, guidance-enriched output, extension-integration reliability finding, per-tool-parser → JSON-schema pivot.
- `harness-foundations/rules-of-why.md` Rules 6, 7, 9 (shift proof left; backpressure needs a home; offered never imposed).
- Wild-extension evidence: `<private-consumer>/.harness/extensions/` — `db` (hand-rolled dispatch + step-runner), `boot` (hand-rolled bounded spawn), `checks` (hand-rolled sensor registry), `shopify` (15-case dispatch, 3,744 lines).
- Existing seams: `kind` discriminator + route-by-kind loader (`src/services/extensions/contract.ts`), Envelope contract (`src/output/envelope.ts`), `ctx.background.spawnDetached`, db adapter.
