# Harness retro insights

Use `harness retro insights` to recompute a cross-plan view of committed
retrospective evidence. The CLI scans the record corpus, tolerates known schema
skew, deduplicates records, clusters open entries, and ranks the clusters using
the same recurrence-first doctrine as the engineering-harness harvest.

The command is read-only. It writes no report or ledger and never changes an
entry's `system.compound.status`.

## Run it

```bash
harness retro insights
harness retro insights --json
```

The default scope includes all three record sources, in precedence order:

1. `.harness/records/retro/**/*.md`
2. `docs/harness/agents/**/*.retro.md`
3. `docs/retros/*.md`

Files ending in `*.legacy.md` are ignored. If the same `retro_id` appears in
more than one source, the first source above wins.

## Narrow the scope

```bash
harness retro insights --plan 056-dont-apologise-fix
harness retro insights --plan 052-fleet-telemetry-lane-sources --plan 057-flow-token-efficiency
harness retro insights --since 2026-07-01T00:00:00Z
harness retro insights --kind difficulty
harness retro insights --agent flow-pair-orchestrator
```

The flags compose:

| Flag | Effect |
|---|---|
| `--plan <slug>` | Include one plan; repeat the flag for multiple plans |
| `--since <iso>` | Include records whose `started_at` is at or after the ISO date or instant |
| `--kind <kind>` | Include entries whose exact `kind` matches |
| `--agent <slug>` | Include records produced by the exact agent slug |
| `--json` | Emit the standard machine-readable harness envelope |

## What the command computes

The report schema is `harness.retro-insights/v1`. Its headline includes:

- records and entries included after validation, deduplication, and filters;
- plans and agents touched, plus the record date range;
- exact lifecycle-status, observation-kind, and disposition counts;
- the open-to-encoded count ratio;
- per-source scan, parse, inclusion, and deduplication counts;
- malformed-record and unsupported-major-version counters;
- `buffer_pending`, an advisory count of transient observations not included in
  the committed-record analysis.

The four deterministic sections are:

| Section | Meaning |
|---|---|
| `totals` | Epistemically wrapped scope and lifecycle-count rows |
| `top_clusters` | Up to ten open `(kind,target)` clusters |
| `stale` | `open` entries older than four weeks and unresolved `suggested` entries older than two weeks |
| `disposition_mix_records` | Drain-time disposition counts from committed records |

Clusters rank by recurrence, then maximum severity
(`blocking` > `degrading` > `annoying` > none), then deterministic proof-gap
leverage, then oldest `first_seen_at`.

Proof-gap detection has two visible signals:

- `proof_gap_signal: "target"` for the command-route target set
  (`project-sensor`, `runtime-inspectability`, `architecture-fitness`,
  `security`, `schema`) and magic-wand entries that name a check, diagnostic, or
  command;
- `proof_gap_signal: "keyword"` for the harvest recognizer's deterministic
  smoke, screenshot, log, trace, health, dependency-rule, CodeQL, schema, manual
  reading, and eyeballing phrases.

`infra` and `tooling` do not receive leverage merely because of their target;
they require the keyword signal.

## Cluster provenance

Every top-cluster row carries the source members needed by a later lifecycle
operation:

```json
{
  "kind": "difficulty",
  "target": "tooling",
  "n": 3,
  "members": [
    {
      "record_path": ".harness/records/retro/2026-07-09/001-phase.md",
      "retro_id": "2026-07-09T02:30:00Z-agent-a1b2",
      "entry_id": "DL-001",
      "status": "open"
    }
  ]
}
```

The report itself never follows those pointers to mutate a record.

## Epistemic contract

Every insight row carries a finite `n` and a non-empty `caveat`; the engine
refuses to construct a row without both. Low-sample aggregate rows are folded
into a visible `other (n<5)` row rather than silently dropped. Exact headline
counts remain available even when a display section folds its low-n tail.

Malformed records and unknown major schema versions are skipped and counted,
never silently accepted. Minor schema skew is read tolerantly. Non-standard
entry kinds remain intact in cluster provenance and contribute to the visible
headline `other` kind bucket.
