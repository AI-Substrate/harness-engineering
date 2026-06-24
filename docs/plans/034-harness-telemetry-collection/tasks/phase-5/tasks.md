# Phase 5 — Event-stream v2 (Amendment A2) · task table

Driven directly from the plan's Phase 5 table (the `tasks` stage was skipped — implement consumes the inline plan tasks). Live progress: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked.

| # | Task | Status | Commit | Notes |
|---|------|--------|--------|-------|
| 5.1 | v2 event types + rollup-derivation tests (incl. counts-only privacy control on events[]) | [x] | (this commit) | `events-rollup.test.ts`; AC-15 allowlist + AC-17 activity + AC-16 purity |
| 5.2 | Extend `segment.ts` + `segment.schema.json` to v2.0 (`event_stream[]` + `rollup`; v1 counts kept as compat view) | [x] | (this commit) | named `event_stream` (v1 `events` key kept for compat); schema_version `2.0`; migrated 3 tests |
| 5.3 | Gap classification + rollup engine (agent/human/idle, IDLE_CAP, working_ratio; tool-burst BURST_N) | [x] | (this commit) | `rollup.ts` pure engine; AC-17 fixture exact; bursts + skill-status helpers |
| 5.4 | Emit `events[]` from Claude + Copilot adapters | [x] | commits 2-3 | Claude (c2a0712) + Copilot (this commit). Copilot turn tokens attributed per interaction. flow/checks/command_exit deferred to 5.6/5.7 |
| 5.5 | Emit `events[]` from Cursor adapter via DbPort bubbles (tokens null; t_precision anchored) | [x] | commit 5 | bubble-`createdAt`-anchored timeline; tokens null; `event_stream` null on headless (no bubbles); rollup.tools==v1 tools |
| 5.6 | Skill-status inference + flow-stage events from `the-flow.json` nav | [x] | commit 6 | `flow-nav.ts` pure helper + capture-service injection (AC-18); skill-status already wired via `buildEventStream` (honest `lastSkillActive=false` — no adapter has a still-open signal) |
| 5.7 | Outcome events: `checks` (+gates), `command_exit` (exit code) | [x] | commit 8 | `outcome-events.ts` pure helper (envelope→events); Claude full (checks+command_exit from tool_result envelope), Copilot command_exit from `success` flag (no envelope→no checks), Cursor deferred (untimed transcript carries no tool results) — each to its observability ceiling; AC-15 (notes/summary dropped); commits excluded |
| 5.8 | Session-end flush (trailing tail) or document accepting tail loss | [ ] | | detail doc §6 |
| 5.9 | Update guide `telemetry.md` (v2) + extend `harness-value-measures.md` (working-time/flow-stage) | [ ] | | reconcile design-doc field name `events`→`event_stream` |

**ACs**: AC-15 (event privacy) · AC-16 (events+rollup, no drift) · AC-17 (agent/human/idle, ratio excludes idle) · AC-18 (skill status + flow-stage time) · AC-19 (outcome events).
