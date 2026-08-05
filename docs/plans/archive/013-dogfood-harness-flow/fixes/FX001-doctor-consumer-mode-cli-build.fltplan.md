# Flight Plan: Fix FX001 — Consumer-mode `doctor` `cli-build` false degraded

**Fix**: [FX001-doctor-consumer-mode-cli-build.md](FX001-doctor-consumer-mode-cli-build.md)
**Status**: Landed

## What → Why

**Problem**: `doctor` checks the dev-repo path `harness/cli/dist/index.js`, so every installed consumer is falsely reported `cli-build` degraded — the first diagnostic a consumer runs lies to them.
**Fix**: Gate the check on the file marker `fs.exists('harness/cli/tsconfig.json')` — dev repo keeps the build check verbatim; consumers get an honest `ok` layer noting the dev build check doesn't apply. (File marker, not the directory: `FakeFs.exists` models exact file paths only.)

## Domain Context

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| harness-cli | owner | `checkCliBuild` mode detection in `doctor-service.ts`; tests for both modes. No contract change. |

## Stages

- [x] Stage 1: Mode-aware `checkCliBuild` gated on `harness/cli/tsconfig.json` marker (`doctor-service.ts`)
- [x] Stage 2: Unit tests dev+built / dev+unbuilt / consumer via exact-path seeds; `BUILT_CLI` seed gains the marker (`doctor-service.test.ts`)
- [x] Stage 3: Build + full suite green, commit

## Acceptance

- [ ] Consumer tree (no `harness/cli/tsconfig.json`) → `cli-build` ok + detail mentions `consumer`, envelope not degraded by it
- [ ] Dev repo without `dist/` → still not-ok + `npm run build` next_action
- [ ] Full vitest suite passes
