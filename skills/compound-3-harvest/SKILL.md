---
name: compound-3-harvest
description: Curate the compounding-value ledger. Scans docs/compound/agents/**/*.retro.md, clusters recurring entries by kind and target, surfaces stale or severe friction, and supports explicit lifecycle updates such as encoded, dismissed, and wontfix.
---
# compound-3-harvest

Run this skill when the team wants to understand what the harness should improve next.

The harvest reads durable retros and computes a prioritized view. It should not write derived index files. Retros are the source of truth; views are computed at read time.

If `docs/compound/.disabled` exists, print one line that compound is disabled and stop.

---

## When to run

Run manually:

- when the user asks what recurring friction should be fixed;
- before a harness-improvement phase;
- before architecture/planning if compound has many unresolved entries;
- at a merge, review, or phase debrief;
- after several sessions have produced retros.

Suggested thresholds:

| Condition | Behavior |
|---|---|
| 0 retros | Say no retros found; suggest using `boot-harness` and `compound-1-track` during work. |
| 1-4 open entries | Manual harvest only; do not nag. |
| 5+ open entries | Suggest harvest at planning/exploration start. |
| 10+ open entries | Strongly suggest harvest before major implementation planning. |
| Any stale blocking entry | Surface prominently. |

---

## Step 1: Check buffer carryover

If `docs/compound/_buffers/<agent>.session-buffer.md` is non-empty, print:

```txt
Buffer has unbubbled entries. Consider running compound-2-bubble first so this harvest includes them.
```

Then continue scanning durable retros.

---

## Step 2: Scan retros

Canonical path:

```txt
docs/compound/agents/**/*.retro.md
```

For each retro:

- parse frontmatter;
- parse `entries`;
- skip unsupported or malformed retros with a warning;
- deduplicate by `retro_id` if duplicates exist;
- treat missing entry status as `open`.

Optional back-compat path:

```txt
docs/retros/*.md
```

For this repo's first port, report legacy retros if present but do not require migration.

---

## Step 3: Build computed view

Cluster open or suggested entries by:

```txt
(kind, target)
```

Within each cluster compute:

- count;
- oldest entry;
- severities;
- representative description;
- source retros;
- whether any entry is stale.

Stale defaults:

| Status | Stale After |
|---|---|
| `open` | 4 weeks |
| `suggested` | 2 weeks without `resolved_by` |

Priority order:

1. Recurrence count, highest first.
2. Severity: blocking, degrading, annoying, missing.
3. Age: oldest first.

Cap the default view at top 10 clusters.

---

## Step 4: Print terminal view

Default view:

```txt
Compound harvest

Scanned: 12 retros, 31 entries
Open: 14  Suggested: 3  Encoded: 10  Dismissed: 4

Top clusters:
1. [difficulty/observe] weak health diagnostics - 4 entries, oldest 2026-05-01
2. [magic-wand/tooling] missing one-command proof loop - 3 entries, oldest 2026-05-08
3. [confusion/docs] AGENTS.md harness signpost unclear - 2 entries, oldest 2026-05-12

Stale:
- DL-004 [difficulty/build] Build failure lacks next action

Recommended next actions:
- encode a diagnostic or command for the top repeated cluster
- run engineering-harness-setup --validate after updating the harness
```

Optional `--json` shape if the host supports arguments:

```json
{
  "schema_version": "1.0.0",
  "retros": 12,
  "entries": {
    "total": 31,
    "open": 14,
    "suggested": 3,
    "encoded": 10,
    "dismissed": 4,
    "wontfix": 0,
    "stale": 1
  },
  "top_clusters": [
    {
      "kind": "difficulty",
      "target": "observe",
      "count": 4,
      "oldest": "2026-05-01",
      "representative": "weak health diagnostics"
    }
  ]
}
```

---

## Lifecycle actions

Only mutate source retros when the user explicitly chooses a lifecycle action.

| Action | Mutation |
|---|---|
| resolved / encoded | set `system.compound.status: encoded`, ask for `resolved_by` |
| wontfix | set `system.compound.status: wontfix` |
| dismissed | set `system.compound.status: dismissed` |
| stale | set `system.compound.status: stale` |

Default harvest is read-only.

---

## What this skill does not do

- No on-disk index files.
- No auto-applying fixes.
- No buffer draining.
- No mid-session prompting.
- No productivity scoring.

The value is recurrence, severity, age, and encoded-fix visibility.

