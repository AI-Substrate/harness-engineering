# Cohort telemetry insights

> **Frozen corpus, reproducible analysis.** Harness capture is off by default.
> Every session this command can analyse was captured before the v1 collector
> handover (or under an explicit legacy-capture opt-in). Re-running the same
> saved reports is reproducible; new default-install months are empty.

Turn a month of committed telemetry into **practice analytics** — where the time
and tokens actually go across a cohort of sessions — rendered as one
self-contained HTML page, with an LLM at the very edge writing prose over the
computed numbers and proposing new generators as reviewed code.

This page is a map, not a manual. It sits **on top of** the measures pipeline in
[telemetry-reports.md](./reports.md) (`session save → report →
report-render`): a report answers *"what happened in one rollup"*; the insights
layer joins **1..N reports** into the seven WS001 v1 sections plus the
loop-discipline panel. The section semantics, row schema, and n-threshold are
defined once — read them there, not here:

- [`insights.schema.json`](../../../harness/cli/src/services/telemetry/insights.schema.json)
  — the row contract (`{claim, measures, n, interval?, caveat}`) and every section.
- [Workshop 001](../../plans/048-cohort-telemetry-insights/workshops/001-cohort-measures-and-insights-layer.md)
  — the four layers, D1–D7, and *why* the LLM may never compute a rendered number.
- [The plan](../../plans/048-cohort-telemetry-insights/cohort-telemetry-insights-plan.md)
  — the acceptance criteria this loop satisfies (AC-08…AC-11).

## Why a separate layer

The measures report is deliberately dumb: exact counts and declared estimates,
no causal language, no external joins. Insights is where practice questions get
answered — *does more explore time correlate with fewer review cycles? which
skills cost the most sent tokens? is the loop discipline actually being run?* —
and where the honesty bar is highest. Every insight row carries its **n**, an
interval where applicable, and a confound note; a row the HTML can't caveat does
not render, and a below-threshold row is suppressed rather than shown small.

Crucially, the layer **consumes reports only** — no shards, no git, no LLM. It is
a pure function of the `report.json` files you feed it, which is what makes it a
comparable, re-runnable artifact.

## The loop, in real commands

Insights' full power comes from **N single-session reports** (they unlock the
per-session sections and the control-marker timeline). An aggregate-only input
still works, but the per-session sections degrade to a visible
`available: false` caveat — never a fabricated number. So the pipeline is
*sweep → report each cached export → insights over the N*:

```bash
# 1. Sweep one month of committed telemetry → a month report + a per-session export cache.
harness telemetry sweep --month 2026-07 --out ./telemetry-report
#   → ./telemetry-report/sessions/<id>.session.json   (the per-session cache; re-sweeps reuse it)
#     ./telemetry-report/2026-07.report.json + index.html   (the month aggregate)

# 2. Report EACH cached session export into its own single-session report.
for s in ./telemetry-report/sessions/*.session.json; do
  harness telemetry report "$s" --no-html \
    --out "./insights-reports/$(basename "$s" .session.json).report.json"
done

# 3. Compute the insights over the N single-session reports.
harness telemetry insights ./insights-reports --out ./telemetry-insights
#   → ./telemetry-insights/insights.json + index.html

# 4. Open the page — self-contained, file://, no server, no network.
open ./telemetry-insights/index.html
```

The HTML embeds its own data island and computes every table client-side from
it; the numbers you see all originate in `insights.json` (a smoke test proves no
number is minted at render time).

## Narrate — the LLM edge

The page ships with an **inert** reserved narrator slot. Nothing in the CLI calls
an LLM; the edge is a skill, and it obeys one hard rule — **the LLM never computes
a number that appears in a report**:

- **Narrator** — reads `insights.json`, writes short prose into the slot. Every
  sentence cites a row that exists, restates its numbers *verbatim*, carries the
  row's n and caveat, and stays correlational. Because restated numbers already
  live in the data island, the no-minting smoke stays green.
- **Insight-smith** — proposes a *new deterministic generator* as reviewable
  code, never a conclusion. Proposals go through normal review + the repo gate;
  they are never self-merged.

Both roles are routed by the
[`telemetry-insights-narrate` skill](../../../.claude/skills/telemetry-insights-narrate/SKILL.md)
— read it for the injection mechanic and the honesty check.

## Feed it back

The loop earns its keep when it improves the harness, not when it produces a
pretty page. A recurring finding becomes work, per the normal harness rule:

- A missing analysis a reader keeps wanting → a **smith proposal** (a new
  generator, reviewed into `insights.ts`).
- A measure that renders wrong or unmeasurable → a **fix task** against the
  measures layer (the report), where every downstream insight inherits the fix.
- A capture gap the insight can only caveat, never close → a named difficulty,
  not a silent absence.

## See also

- [Harness telemetry — reports & rollups](./reports.md) — the measures
  layer this sits on.
- [Harness value measures](../harness-value-measures.md) — what the broader
  program engineers from committed telemetry.
- [Harness telemetry — the OTLP stored shape](./otlp.md) — the
  counts-only spool the whole pipeline reads.
- [The git-ai collector handover](../gitai-collector.md) — why the corpus stopped
  growing and what captures current line attribution.
