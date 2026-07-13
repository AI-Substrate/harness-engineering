# Mockup — what `harness retro insights` produces (end result)

**Status**: illustrative design mockup (plan 058) — numbers are indicative, drawn from the real corpus as of 2026-07-12; the shipped verb recomputes everything fresh. The JSON shape here is the AC-01 contract; the human view is Step 4 of the harvest doctrine, upgraded.

---

## Face 1 — the human terminal view

What you see typing `harness retro insights` (all plans) in this repo:

```text
🌾 Retro insights — 2026-07-12T04:05:00Z

📚 Scanned 35 records · 22 plans · 2026-06-09 → 2026-07-10
   Sources: .harness/records/retro (35) · docs/harness/agents (0) · docs/retros (0)
   Entries: 182 — 133 open · 26 suggested · 23 encoded · 0 wontfix
   Parse: 0 malformed skipped · 0 unsupported versions
   ℹ️ Buffer: 1 pending observation (not counted here — drain to include it)

📊 Top clusters (recurrence → severity → leverage → age; top 10 of 31):

   1. [difficulty/tooling] test-runner traps — root vitest sweeps scratch/,
      just test is the only canonical gate                    n=5 · 4 plans
      ↻ re-paid every session since 2026-06-16 · PROOF-GAP (keyword)
      💡 suggested: root vitest exclude for scratch/ + a checks pointer
   2. [difficulty/project-sensor] missing smoke/evidence path for envelope
      verdicts (had to eyeball green-vs-red output)           n=4 · 3 plans
      ↻ PROOF-GAP (target) · oldest 2026-06-17
      💡 suggested: verdict line on check:docs; smoke fixture for envelopes
   3. [confusion/tooling] ambiguous check output (check:docs diff-looking
      but exit 0; doctor 12KB when the question is ok/degraded) n=4 · 3 plans
      ⏸ REPEATEDLY DEFERRED (2× deferred dispositions) — keeps losing to
      feature work; cost recurs every boot check
   4. [improvement-suggestion/harness-itself] retro machinery gaps —
      compound-value consumer never built; harvest re-derived by inference
      n=3 · 3 plans · ⚠ STALE (open > 4 weeks)
      💡 this cluster is plan 058 itself
   5. [magic-wand/telemetry] per-stage token attribution capture-false
      (flow events too sparse to label stages)                n=3 · 2 plans
      ↻ PROOF-GAP (target: schema)
   … 5 more clusters (n≥2) · 12 singletons folded into "other (n<2)"

⏰ Stale: 6 open clusters older than 4 weeks · 2 suggested >2wk without resolved_by
✅ Recently encoded (last 30 days): 9 entries — the loop IS closing on 9/23

Every count above is exact (counts EXACT; ages/spans derived from first_seen_at).
Cluster ranking is deterministic; "most valuable" phrasing belongs to your agent.

To act on a cluster: its members[] (record paths + entry ids) are in --json.
Lifecycle ops (done / won't-fix / stale) remain agent-driven at the harvest.
```

Scoped runs change only the scan line, e.g. `harness retro insights --plan 056-dont-apologise-fix --plan 057-flow-token-efficiency`:

```text
📚 Scanned 4 records · 2 plans · 2026-07-08 → 2026-07-10   (filters: plan×2)
```

---

## Face 2 — the `--json` contract (machine surface, AC-01)

Excerpt — one envelope, `data` shown partially:

```json
{
  "command": "retro",
  "status": "ok",
  "timestamp": "2026-07-12T04:05:00.000Z",
  "data": {
    "schema_version": "harness.retro-insights/v1",
    "generated_at": "2026-07-12T04:05:00.000Z",
    "filters": { "plans": [], "since": null, "kind": null, "agent": null },
    "sources": [
      { "root": ".harness/records/retro", "records": 35 },
      { "root": "docs/harness/agents", "records": 0 },
      { "root": "docs/retros", "records": 0 }
    ],
    "totals": {
      "records": 35, "entries": 182, "plans": 22,
      "by_status": { "open": 133, "suggested": 26, "encoded": 23, "wontfix": 0, "other": 0 },
      "by_kind": { "difficulty": 65, "improvement-suggestion": 40, "insight": 26, "win": 12, "confusion": 11, "magic-wand": 10, "other": 18 },
      "malformed_skipped": 0,
      "unsupported_versions": [],
      "buffer_pending": 1
    },
    "top_clusters": [
      {
        "key": { "kind": "difficulty", "target": "tooling" },
        "n": 5,
        "caveat": "counts exact; cluster = same (kind,target), descriptions vary — read members before acting",
        "plans": ["041-flow-conformance-eval", "046-flow-eval-loop", "056-dont-apologise-fix", "057-flow-token-efficiency"],
        "first_seen_at": "2026-06-16T02:11:00.000Z",
        "last_seen_at": "2026-07-10T02:42:59.795Z",
        "statuses": { "open": 3, "suggested": 2 },
        "dispositions": { "kept": 3, "task": 2 },
        "proof_gap": true,
        "proof_gap_signal": "keyword",
        "repeatedly_deferred": false,
        "stale": false,
        "representative": "npx vitest run from repo ROOT sweeps scratch/evals/** artifact tests…",
        "suggested_encodings": ["root vitest config exclude for scratch/"],
        "members": [
          {
            "record_path": ".harness/records/retro/2026-07-10/001-057-flow-token-efficiency.md",
            "retro_id": "2026-07-10T03:34:49.000Z-agent-057p2",
            "entry_id": "DL-002",
            "status": "suggested"
          }
          // …4 more members — the provenance the harvest lifecycle ops
          // (done / won't-fix / stale, in-place status mutation) act on
        ]
      }
      // …9 more clusters; below-threshold clusters fold into a visible
      // "other" row, never silently dropped
    ],
    "stale": { "open_over_4w": 6, "suggested_over_2w_unresolved": 2 },
    "disposition_mix_records": {
      "n": 47, "caveat": "dispositions exist only on schema ≥1.2 drains; older records excluded",
      "mix": { "kept": 31, "fixed-now": 4, "task": 5, "declined": 4, "deferred": 3 }
    }
  },
  "evidence": [
    { "label": "records root", "path": ".harness/records/retro" }
  ],
  "next_action": "Act on a cluster via its members[] paths; lifecycle ops stay agent-driven at the harvest."
}
```

Contract properties (from the ACs): deterministic (byte-identical minus `generated_at`) · every row carries `n` + `caveat` · read-only (nothing written, `system.compound.status` untouched) · tolerant (`malformed_skipped` / `unsupported_versions` visible, never a crash) · no contributor ranking anywhere.

---

## Face 3 — the flow surface (what the agent says at a seam)

At a harvest seam — or ad-hoc via `/eng-harness-flow at=insights --plan <a> --plan <b>` — the agent runs the verb and **narrates its numbers** (never computes its own):

> 🌾 I ran the cross-plan insights over all 22 plans. The corpus holds **182 observations, 133 still open against 23 encoded** — the loop is capturing far more than it's encoding.
>
> **Highest-value next move, and why:** the top cluster is the **test-runner trap** (n=5 across 4 plans, recurring since mid-June, proof-gap): agents keep running root `vitest` and hitting scratch/ artifact failures that look like product breaks. One `vitest` exclude + a pointer at `harness checks` kills a friction that has now bitten five sessions. Second is the **missing envelope smoke path** (n=4, proof-gap by target) — that one wants a first-class check, not a recipe.
>
> Worth a look: cluster 3 (**ambiguous check output**, n=4) is flagged **repeatedly deferred** — we've said "later" twice; it will keep costing every boot until someone spends the hour.
>
> Act on any of these? For #1 I can stage the vitest exclude now (small + reversible), file #2 as a `harness new <verb>` scaffold, or mark clusters done/won't-fix/stale — the report gave me the exact record paths for each.

The judgement ("worth an hour", "wants a first-class check") is the agent's; **every number in it is traceable to the JSON above** — that's the 048 rule this whole design inherits.

---

## What it looks like end-to-end (the user story)

```text
you:    /eng-harness-flow at=insights
agent:  (runs `harness retro insights --json` — deterministic, <1s)
        narrates the ranked report above
you:    "do #1 now, file #2, mark #4 done — that's this plan"
agent:  stages the exclude diff · prints the scaffold command ·
        mutates #4's members to encoded via their record paths
```

Fixed once, caught forever — and now the *finding* of what to fix next is deterministic too.
