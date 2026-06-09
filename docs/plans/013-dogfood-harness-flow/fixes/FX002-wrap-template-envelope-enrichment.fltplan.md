# Flight Plan: Fix FX002 — `harness new --wrap` sparse boot Envelope

**Fix**: [FX002-wrap-template-envelope-enrichment.md](FX002-wrap-template-envelope-enrichment.md)
**Status**: Landed — `0aad609` (companion review in flight)

## What → Why

**Problem**: A `--wrap` scaffold returns a thin Envelope (`ctx.ok({ command })` — no stdout, no duration) with a literal `TODO` summary, so boot extensions authored from it under-report the very evidence the harness exists to surface.
**Fix**: Enrich `wrapTs`/`wrapJs` to emit an honest summary + a self-timed success Envelope carrying `durationMs` and a bounded `stdout` tail — no contract or exec-port change.

## Domain Context

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| harness-cli | owner | `wrapTs`/`wrapJs` builders + byte-exact fixtures + workshop §4b/§4d. No `Envelope`/`ExecResult` change. |

## Stages

- [x] Stage 1: Enrich `wrapTs` + `wrapJs` (summary, self-time, enriched `ok()`) (`templates.ts`) — `0aad609`
- [x] Stage 2: Update byte-exact fixtures `WRAP_TS_TEST`/`WRAP_JS_TEST` + workshop §4b (`templates.test.ts`, workshop 001) — `0aad609`
- [x] Stage 3: Build + full suite green (277/277), commit `0aad609`

## Acceptance

- [ ] Success Envelope = `ctx.ok({ command, durationMs, stdout: <≤20-line tail> })`; summary has no `TODO`
- [ ] `durationMs` is a real `Date.now()` delta; no `ExecResult`/exec-port change
- [ ] Byte-exact fixtures + workshop blocks updated; full vitest suite green
- [ ] minimal/record templates + `Envelope`/`Evidence` contract untouched
