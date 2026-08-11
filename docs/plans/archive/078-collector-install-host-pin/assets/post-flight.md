# Post-flight — 078-collector-install-host-pin

**Closed out**: 2026-08-11T07:57:28
**Archived to**: docs/plans/archive/078-collector-install-host-pin/
**Shipped**: yes — `f4944a0d` — drop the unsatisfiable release_host pin (#124 / PR #125)

## Completion

| Check | Result |
|-------|--------|
| Phases / tasks | all complete |
| Shipped to `main` | confirmed by commit, not by plan metadata |
| Flight plan relocate | not applicable — no dd-native flow registered (`harness flow list` returns `flows: []`; `.harness/flows/` is empty and untracked), so there are no `dd_link` gate addresses to re-point |

## Open / deferred items

_None — flight fully clean._

## Note

`7d01465d` (#128) committed the review record and reviewer brief.

## How completion was established

The `status` field in `plan.dd.json` is **authoring** state, not completion — 077 shipped and
still reads `draft`, so it was not used. Completion was taken from the shipping commit on
`origin/main`, cross-checked against the task tables.
