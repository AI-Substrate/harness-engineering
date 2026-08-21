# Post-flight — 073-gitai-collector-v1

**Closed out**: 2026-08-11T07:57:28
**Archived to**: docs/plans/archive/073-gitai-collector-v1/
**Shipped**: yes — `7b39b2d5` — git-ai becomes the collector, harness capture off by default, pinned+verified install (#104)

## Completion

| Check | Result |
|-------|--------|
| Phases / tasks | all complete |
| Shipped to `main` | confirmed by commit, not by plan metadata |
| Flight plan relocate | not applicable — no dd-native flow registered (`harness flow list` returns `flows: []`; `.harness/flows/` is empty and untracked), so there are no `dd_link` gate addresses to re-point |

## Open / deferred items

_None — flight fully clean._

## Note

`f4944a0d` (#125) later dropped the unsatisfiable `release_host` pin — the install path that plan shipped had never worked.

## How completion was established

The `status` field in `plan.dd.json` is **authoring** state, not completion — 077 shipped and
still reads `draft`, so it was not used. Completion was taken from the shipping commit on
`origin/main`, cross-checked against the task tables.
