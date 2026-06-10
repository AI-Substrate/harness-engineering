---
schema_version: "1.0"
retro_id: "2026-06-10T03:18:00Z-agent-b57d7b1"
agent: agent
plan_id: null
started_at: "2026-06-10T03:04:36.668Z"
ended_at: "2026-06-10T03:18:00Z"
summary: "eng-harness-4-retro --drain session-end save (2 entries) — 015 observe-retro-merge build seam; first real dogfood drain through `harness observe --list/--clear`"
entries:
  - id: SUGG-001
    kind: improvement-suggestion
    description: "User note mid-015-build: add a harness boot extension (harness verb wrapping the just-test + doctor pre-flight T000 does by hand) so the repo dogfoods its own harness loop; add the dogfood requirement to AGENTS.md"
    target: project
    suggested_encoding: "harness extension wrapping boot pre-flight + an AGENTS.md dogfood clause"
    system:
      compound:
        status: open
        source: user
        first_seen_at: "2026-06-10T03:04:36.668Z"
  - id: DL-001
    kind: difficulty
    description: "FakeFs.readdir did not reflect dynamically created dirs — observe write-then-list integration came back falsely empty; NodeFs would have seen the bucket"
    target: tooling
    severity: annoying
    workaround: "extended FakeFs.readdir to derive mkdirp-created child dirs (pinned in fake-fs.test.ts)"
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-06-10T03:04:37.739Z"
        resolved_by: "e4a943a (FakeFs.readdir NodeFs-fidelity fix, same build)"
system:
  compound:
    bubble_action: "all-save"
---

# Drain — 015 observe-retro-merge build seam (2026-06-10)

First end-to-end dogfood of the merged friction lifecycle: both entries were
captured mid-build with `npx harness observe` (CLI-assigned IDs + timestamps,
gitignored transient buffer), read back via `harness observe --list --json`
(all-buckets sweep, `malformed_skipped: 0`), materialized into this record at
the CLI-returned `data.path`, then cleared via `harness observe --clear`.

- **SUGG-001** (from the user, mid-build): encode the T000 boot pre-flight as a
  harness extension and add the dogfood requirement to AGENTS.md — follow-up
  candidate for `/plan-5 --fix` or a small plan.
- **DL-001** (agent-self, already encoded in this same build): FakeFs readdir
  fidelity gap, fixed + pinned in commit `e4a943a`.
