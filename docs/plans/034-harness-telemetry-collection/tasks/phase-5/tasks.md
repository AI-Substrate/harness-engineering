# Phase 5 — Event-stream v2 (Amendment A2) · task table

Driven directly from the plan's Phase 5 table (the `tasks` stage was skipped — implement consumes the inline plan tasks). Live progress: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked.

| # | Task | Status | Commit | Notes |
|---|------|--------|--------|-------|
| 5.1 | v2 event types + rollup-derivation tests (incl. counts-only privacy control on events[]) | [x] | (this commit) | `events-rollup.test.ts`; AC-15 allowlist + AC-17 activity + AC-16 purity |
| 5.2 | Extend `segment.ts` + `segment.schema.json` to v2.0 (`event_stream[]` + `rollup`; v1 counts kept as compat view) | [x] | (this commit) | named `event_stream` (v1 `events` key kept for compat); schema_version `2.0`; migrated 3 tests |
| 5.3 | Gap classification + rollup engine (agent/human/idle, IDLE_CAP, working_ratio; tool-burst BURST_N) | [x] | (this commit) | `rollup.ts` pure engine; AC-17 fixture exact; bursts + skill-status helpers |
| 5.4 | Emit `events[]` from Claude + Copilot adapters | [~] | (claude: commit 2) | **Claude done** (event-builder.ts + claude emission + claude-events.test.ts); **Copilot next**. flow/checks/command_exit deferred to 5.6/5.7 |
| 5.5 | Emit `events[]` from Cursor adapter via DbPort bubbles (tokens null; t_precision anchored) | [ ] | | honest ceiling; builds on shipped DbPort |
| 5.6 | Skill-status inference + flow-stage events from `the-flow.json` nav | [ ] | | helper landed in 5.3 (`inferSkillStatuses`); wire into adapters |
| 5.7 | Outcome events: `checks` (+gates), `command_exit` (exit code) | [ ] | | codes/verdicts only; commits excluded by design |
| 5.8 | Session-end flush (trailing tail) or document accepting tail loss | [ ] | | detail doc §6 |
| 5.9 | Update guide `telemetry.md` (v2) + extend `harness-value-measures.md` (working-time/flow-stage) | [ ] | | reconcile design-doc field name `events`→`event_stream` |

**ACs**: AC-15 (event privacy) · AC-16 (events+rollup, no drift) · AC-17 (agent/human/idle, ratio excludes idle) · AC-18 (skill status + flow-stage time) · AC-19 (outcome events).
