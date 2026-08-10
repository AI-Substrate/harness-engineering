---
name: telemetry-insights-narrate
description: |
  Route the LLM edge of the cohort-telemetry insights layer: turn a generated
  insights.json into short prose for the report's reserved narrator slot
  (narrator), or propose NEW deterministic generators as reviewable code
  (insight-smith). The one hard rule both obey: the LLM never computes a number
  that appears in a report — it restates computed numbers or writes tooling,
  never conclusions. Use when someone says "narrate the insights", "write up
  the telemetry report", "add prose to the insights HTML", or "propose a new
  insight generator".
---

# /telemetry-insights-narrate

A **thin router** for the LLM edge (WS001 layer 4). The numbers are already
computed by `harness telemetry insights`; this skill only routes prose and
generator-authoring around them. It owns no analysis — the
[insights schema](../../../harness/cli/src/services/telemetry/insights.schema.json)
and [workshop 001 D7](../../../docs/plans/048-cohort-telemetry-insights/workshops/001-cohort-measures-and-insights-layer.md)
are the authority for what a row means and where the LLM may participate.

## The one hard rule

**The LLM never computes a number that appears in a report.** A narrator sentence
may restate a number **verbatim** from `insights.json`; it may never derive, sum,
average, round, or infer one. The smith proposes number-producing *code*, never
numbers. Everything below is a consequence of this rule.

## Route 1 — narrator (prose over computed numbers)

- **Input**: a generated `insights.json` (+ its co-produced `index.html`).
- **Output**: short prose for the reserved narrator slot — every sentence cites a
  row that exists in `insights.json`, carries that row's **n** and **caveat**
  weight, and uses **correlational language only** (no causation).
- **Injection mechanic**: a plain HTML edit into the inert slot. In `index.html`,
  write the prose inside `<div id="narrator-prose"></div>` within
  `<section id="narrator-slot" data-narrator="reserved">` — leave the
  `<!--INSIGHTS_DATA-->` island and the computed tables untouched.

**Honesty check** (mandatory, mechanical, **artifact-bound**). Verify the page
**you just edited** — never a fresh render. Every visible number in the page
body must be a digit-run that also exists in *that same page's*
`#insights-data` island. So ground each figure to an **island digit-run**: cite
the island's raw value, not the table's `k`/`M` display form (the island stores
`509680`, so restating the cell as "509.7k" does **not** trace and reads as
minted). Run this against the artifact you edited:

```bash
node -e 'const fs=require("fs"),h=fs.readFileSync(process.argv[1],"utf8"),m=h.match(/<script[^>]*id="insights-data"[^>]*>([\s\S]*?)<\/script>/i);if(!m){console.error("no #insights-data island");process.exit(2)}const isl=new Set(JSON.stringify(JSON.parse(m[1])).match(/\d+/g)||[]),vis=(h.match(/<body[\s\S]*<\/body>/i)||[""])[0].replace(/<(script|style)\b[\s\S]*?<\/\1>/gi," ").replace(/<[^>]*>/g," "),bad=[...new Set(vis.match(/\d+/g)||[])].filter(n=>!isl.has(n)&&n!=="3");if(bad.length){console.error("MINTED (not in #insights-data): "+bad.join(", "));process.exit(1)}console.log("OK: every visible number traces to #insights-data")' path/to/insights/index.html
```

Exit 1 lists every page number with **no source in the island** — a minted,
derived, or **stale** figure. Fix the sentence, never the island. (`"3"` is the
lone allowlisted scaffolding digit: the reserved slot's static "Phase 3" label;
the un-narrated tables are built by script at browser time, so a file read sees
only your prose against the island.)

- **Narrate the CURRENT artifact.** If the insights were regenerated after a
  fix, re-narrate the **new** page — restating numbers off a stale render *is*
  minting, and the check above catches it (the old figures no longer trace to
  the new island).
- **Renderer coverage is a SEPARATE check, not this one.** The renderer smoke
  `npx vitest run harness/cli/test/services/telemetry/insights-html.test.ts`
  renders a *fixture* and executes it in jsdom to prove the **generator/template**
  mints no number. It never opens your edited `index.html`, so it cannot vouch
  for your prose. Keep both: the vitest guards the renderer, the one-liner above
  guards the artifact.

## Route 2 — insight-smith (authors new generators, reviewed in)

- **Input**: `insights.json` + the generator library
  [`insights.ts`](../../../harness/cli/src/services/telemetry/insights.ts).
- **Output**: a **NEW deterministic generator** proposed as a code diff / PR-able
  suggestion — tooling that computes a number, never the number itself and never
  a conclusion.
- **Review-gated**: proposals go through normal code review + the repo gate
  (`harness checks`); a smith proposal is **never self-merged**. Its measures,
  n-threshold, and caveat contract must match the existing rows' shape before it
  can render.

## Hard rules (both roles)

- **No computed numbers.** (The rule above. Restate, don't derive.)
- **No people analytics.** Insights aggregate over work units; the narrator never
  ranks, names, or profiles a contributor (WS001 D6).
- **Mandatory n + caveat.** Every claim the narrator writes carries the row's n
  and its confound note — an insight the HTML can't caveat doesn't get narrated.
- **Suppressed stays suppressed.** Below-threshold rows are not narrated around,
  hinted at, or reconstructed — silence is the honest render.

## Notes

- The slot is **inert by design**: nothing in the CLI calls an LLM; the render
  ships an empty, dashed placeholder and this skill is the only thing that fills
  it.
- The end-to-end loop this skill plugs into is
  [docs/how/telemetry/cohort-insights.md](../../../docs/how/telemetry/cohort-insights.md).
- Iterate this skill after each real narration — when a beat needs tribal
  knowledge, fix it here (a line), not in chat memory.
