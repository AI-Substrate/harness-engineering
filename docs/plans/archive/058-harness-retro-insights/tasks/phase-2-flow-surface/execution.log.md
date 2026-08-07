# Phase 2 execution log — Flow surface + doctrine reconcile

## T101–T104 — Skill doctrine and routing

**Status**: Complete

- Replaced harvest Steps 1–3 with one `harness retro insights --json` invocation.
- Kept the Step 4 narration template, action menu, and lifecycle operations intact.
- Pinned the narration rule: computed numbers come only from the verb envelope.
- Wired lifecycle operations to `data.sections.top_clusters.rows[].members[].record_path`.
- Removed both dangling `compound-value` references.
- Added `at=insights` as an additive ad-hoc route with scope-flag pass-through.
- Kept non-empty-buffer behavior as `route` with a drain advisory, never `redirect`.
- Added one frontmatter-description line for cross-plan insights discovery.

### Static proof

```text
compound-value refs: 0
lifecycle section SHA-256 before/after:
35e083b007728b25d52333657fd11eb4a0a6095fd339c391e452b23dddc204ef
--hooks manifest section SHA-256 before/after:
63b3316d2fd5450af4c0d51c9aa36e4d2616bb289441017d715c3bc9eff55cce
SKILL.md description: 855 characters
harness skills-check: ok — 8 skills, 0 errors, 0 warnings
```

`retro.md` contains no `doctrine-parity` marker, so no mirrored doctrine block required an edit.

## T105 — Redeploy and live validation

**Status**: Complete

Redeployed before invoking the flow surface:

```text
npm run build: exit 0
just install-skills-local: exit 0
targets: claude-code, codex, opencode, github-copilot, pi
```

The deployed `.agents/skills/eng-harness-flow` copy contained the new `at=insights` route, the single verb invocation, the no-recompute narration rule, and `members[].record_path` lifecycle provenance.

### Real-corpus harvest

The live `at=insights` path ran `harness retro insights --json` against this repository:

```text
command/status: retro / ok
schema: harness.retro-insights/v1
records / entries: 33 / 182
plans / agents: 21 / 9
date range: 2026-06-09T12:19:00Z → 2026-07-09T02:37:48.016Z
status counts: 133 open, 26 suggested, 23 encoded, 0 wontfix, 0 stale, 0 other
buffer_pending: 4
malformed_skipped: 15
unsupported_versions: 0
```

The non-empty buffer remained advisory: the route proceeded and excluded all 4 pending entries from committed-record totals.

Narrated harvest, restating verb-returned values:

> Scanned 33 committed retros containing 182 entries across 21 plans and 9 agents. The lifecycle mix is 133 open, 26 suggested, and 23 encoded; no wontfix, stale, or other statuses were counted. The observe buffer has 4 unbubbled entries, so drain remains advisable, but those entries are not included here.
>
> The ranked view starts with difficulty/(none), n=12; improvement-suggestion/(none), n=11 with keyword proof-gap signal; and difficulty/tooling, n=10, severity degrading, also with keyword proof-gap signal. The improvement-suggestion/token-efficiency cluster is n=4 and is explicitly repeatedly deferred. Every selected cluster carries exactly n member pointers for lifecycle operations.

No corpus scan, cluster merge, rank, or lifecycle provenance was recomputed by the skill.

### Final gates

```text
just fix: exit 0 — Biome checked 327 files; no fixes applied
harness checks: exit 0, status degraded
hard gates ok:
  tests, biome, typecheck, check:docs, check:flows,
  check:telemetry-fixtures, check:doctrine-parity,
  skills-check, windows-check
warn-launch only:
  arch-check — 2 existing warn-severity findings
  markdown-lint — 199 existing non-blocking findings
```

**Deviations**: None. No CLI source, flow state, flow-pair ledger, record corpus, or other forbidden path was written during Phase 2.
