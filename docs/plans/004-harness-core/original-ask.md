# Original ask — harness-core
**Captured**: 2026-06-07T00:19:59Z  ·  **By**: manual scaffold

> create docs/plan/<slug>-harness-core

## Status

Plan folder scaffolded per repo convention (`docs/plans/<ordinal>-<slug>/`, matching
`001`/`002`/`003`). Scope is not yet defined — seed only.

## Scope

First implementation slice: the **Starter harness CLI core** — an agent-friendly Node
CLI (`harness/cli/`) that acts as the harness front door. Installed via NPX; an extension
system (added later) provides the customisable harness behaviour. This slice also stands
up the nucleus repo's own engineering fundamentals: Biome, justfile (`fix`/`format`/`test`/`fft`),
npm vulnerability scanning, GitHub Actions CI, semver + release-please, branch protection,
and coverage reporting.

The full verbatim ask, command surface, output/evidence contract, clean-architecture shape,
quality bar, and acceptance criteria are captured in [`cli-core-ask.md`](./cli-core-ask.md).

## Source material

- `cli-core-ask.md` — verbatim implementation ask for this slice.
- Reference repos (local, study-not-copy): `~/substrate/minih` (Node CLI; biome, justfile,
  release-please), `~/substrate/chainglass` (doctor commands, docker run, playwright debug
  extensions, clean-architecture `DESIGN_PATTERNS.md`).
- `install-flow.md` — the broader 4-stage harness-core install flow this CLI is Stage 1 of.
