---
record_kind: "retro"
harness_version: "0.12.0"
branch: "feat/059-typed-extensions-sensors"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-07-15T00:26:27.847Z"
agent: agent
plan_id: 059-typed-extensions-sensors
schema_version: "1.2"
retro_id: "2026-07-15T00:26:27Z-agent-p059p2"
started_at: "2026-07-14T22:23:12.916Z"
ended_at: "2026-07-15T00:26:27.851Z"
summary: "Phase 2 (sensors engine, headless) drain — 5 entries captured during the 6-round flow-pair review + prime-hold closure cascade; Jordan disposition: save all (kept)."
entries:
  - id: DL-001
    kind: difficulty
    description: "harness flow verb flags are guessable-wrong: comment rejects positional text (needs --text), status/comment need --node, event takes none — three flag-shape retries in one session"
    target: tooling
    severity: annoying
    workaround: "checked --help per verb after each rejection"
    suggested_encoding: "accept positional text on flow comment (or align flag shapes across the flow verb family)"
    fp: "450e9a9c230b"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-14T22:23:12.916Z"
  - id: CONF-001
    kind: confusion
    description: "global 'harness' on PATH is published 0.12.0 without the sensors verb — worktree smoke tests silently need 'node harness/cli/dist/index.js'; exit 1 looked like a code bug"
    target: tooling
    workaround: "reran via node harness/cli/dist/index.js"
    suggested_encoding: "doctor/verb-missing hint comparing PATH harness version vs repo dist; or a worktree convention note"
    fp: "9246e30bc296"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-14T22:23:13.104Z"
  - id: DL-002
    kind: difficulty
    description: "cross-stream error-code collision (s059 + s060 both reserved E210-E217) was invisible to file reads because both reservations lived in unmerged worktree workshops; needed a prime ruling to resolve"
    target: project
    severity: degrading
    workaround: "o-prime ruling: sensors keep E210-E217, telemetry moves to E220-E227"
    suggested_encoding: "small error-code-block registry in main that workshops claim rows in — reservations become merged substrate"
    fp: "ff273e3d7f62"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-14T22:23:13.312Z"
  - id: CONF-002
    kind: confusion
    description: "harness/cli has no own package.json — 'cd harness/cli && npm test' ENOENTs; the root script cds internally, which packet authors and coders both tripped on"
    target: tooling
    workaround: "run npm test from repo root"
    suggested_encoding: "AGENTS.md note or a harness/cli stub script pointing at the root runner"
    fp: "2055ed1c6c4e"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-14T22:23:13.505Z"
  - id: SUGG-001
    kind: improvement-suggestion
    description: "pre-existing services-layer ports-only breach: services/observe/observe-service.ts:1 imports node:crypto directly (plan 056). Follow-up opportunity: migrate to the generic HashPort (adapters/hash/) that plan 059 fix5 introduces — separate work, not an arch-baseline excuse, byte-untouched in phase 2 per prime ruling"
    target: architecture-fitness
    suggested_encoding: "small chore: inject HashPort into observe-service, delete its node:crypto import, wire at composition root"
    fp: "26c4575ab509"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-14T22:38:45.764Z"
system:
  compound:
    bubble_action: "all-save"
---

# Retro — plan 059 Phase 2 (sensors engine, headless)

Captured across the Phase 2 review/closure session (2026-07-14→15). Highest-leverage cluster per the drain: the `harness flow` flag-shape friction (DL-001, hit three times in one session) — a local CLI fix in this repo. SUGG-001 carries the prime-ruled HashPort follow-up for observe-service.
