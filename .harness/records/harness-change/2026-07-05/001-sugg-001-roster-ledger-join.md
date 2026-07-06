---
schema_version: "1.0"
resolves: ".harness/records/retro/2026-07-04/007-052-ship-harvest.md:SUGG-001"
change_type: sensor
target: harness/cli/src/services/telemetry/fleet-evidence.ts (get-fleet ledger join)
---

# Harness change — fleet ledger join survives `pij close` (descriptor-independent)

`get-fleet` joined vendor cost ledgers only through the pij registry descriptor
(`~/.pij/<id>.json`), which `pij close` deletes — so a fleet snapshot taken after
teardown silently degraded every worker lane to `cost_measured:false` (hit live on
the 052 dogfood). `parseRoster` now carries each member's persisted `run.json` join
keys (`harnessSessionId`/`harness`/`transcriptPath`/`model`), and `enrichOrphans`
falls back to a synthesized descriptor when the registry one is absent; the
live/bound descriptor still wins when present (byte-inert pre-teardown). Paired tests
in `fleet-golden-051.test.ts` prove non-vacuity (join key present → ledger lane;
absent → honest orphan). Commit `7c4a7fe3`. Unblocked by pij plan 031 (`pij sessions
--json` + harness-aware adopt, AI-Substrate/pij `525e652`); consuming that verb for
the live path instead of globbing `~/.pij` is a tracked optional follow-on.
