# Harness changelog — encoded improvements

> One row **per improvement encoded into the harness** (the Improve beat of the
> loop) — never per session or per boot. The governance doc
> (`engineering-harness.md`) holds the *current* snapshot; this file is the
> trajectory.

| Date | Improvement | Trigger | Evidence |
|------|-------------|---------|----------|
| 2026-06-10 | Test suite made cwd-independent: architecture guards + NodeFs real-tree probes resolve from their own file location (`import.meta.url`), not `process.cwd()`; the docs byte-compare failure now names its fix ("stale dist — run `npm run build`") | Plan 014 orchestrator magic wand (retro OH-001/OH-003: 4 false-alarm failures + one undiagnosable stale-dist red across the build session) | suite 317/317 green from BOTH `harness/cli` and the repo root |
