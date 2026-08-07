# Tripwire review — did the environment-first posture land? (T+3wk)

**Plan**: 056-dont-apologise-fix · **Baselines recorded**: 2026-07-09 (T0) · **Re-run**: ~2026-07-30 (T+3wk)

This runbook makes the posture change **falsifiable from real telemetry**. Three
tripwires, each with a threshold and an exact command. Every query below was
**executed at T0** — TW-1 and TW-3 carry real baselines; the disposition queries
(TW-2) are **execute-only** at T0 because no schema-1.2 records exist yet (they are
*definitionally* zero until drains start writing dispositions — validation V-07).

Metrics live **only here and in the offline insights** — never surfaced to the
working agent as a target (Goodhart guard; plan Non-Goals).

> **Setup for each re-run.** Sweep the months since ship into reports, then run
> insights over them:
> ```bash
> SCRATCH=$(mktemp -d)
> harness telemetry sweep --month 2026-07 --out "$SCRATCH/2026-07" --no-html
> harness telemetry sweep --month 2026-08 --out "$SCRATCH/2026-08" --no-html   # add each month since ship
> harness telemetry insights "$SCRATCH"/*/*.report.json --out "$SCRATCH/insights" --no-html
> ```

---

## TW-1 — conversion: is friction actually being captured?

**Signal**: `observe_conversion` = `harness observe` events ÷ friction proxies
(non-zero `command_exit` + `api_error`), per cohort.
**Threshold**: if the conversion ratio shows **no improvement vs the pre-change
cohort** after ~3 weeks → the channels aren't landing; rethink the posture surfaces.

```bash
node -e "const d=require('$SCRATCH/insights/insights.json'); const s=d.sections.find(x=>x.id==='observe_conversion'); console.log(JSON.stringify(s.rows.map(r=>r.values),null,1))"
```

**T0 baseline (2026-07, 38 sessions)**: `{ observes: 18, friction: 1, rate: 18 }`.
Friction proxies are sparse this cohort (1), so the ratio is high/noisy; watch the
**observes count** and the ratio **trend** across months, not the absolute T0 value.

---

## TW-2 — discrimination: is the observe/decline test tuned right?

**Signal**: `disposition_mix` over drained retro records (schema-1.2 `disp_*`).
**Thresholds** (either trips): **declined-rate > 60%** of presented observations
→ the discrimination test is too loose (too much captured that we then decline);
**OR > 5 observations/phase average** → over-capture. Either → tighten the
directive's discrimination test.

```bash
node -e "const d=require('$SCRATCH/insights/insights.json'); const s=d.sections.find(x=>x.id==='disposition_mix'); console.log(s.available? JSON.stringify(s.rows.map(r=>[r.claim,r.values]),null,1) : s.note)"
# declined-rate: disp_declined / (sum of all disp_*)
# obs/phase: retro observations ÷ phase count (flight-plan phases)
```

**T0 baseline**: **execute-only** — `available:false` ("no retro artifact events
carry dispositions in the cohort — definitionally zero until schema-1.2 records are
drained"). Correct at T0: the 33 committed records predate schema 1.2, so they carry
no `disposition`. This query becomes meaningful once drains under the new format run;
re-run at T+3wk for the first real reading.

---

## TW-3 — drain fatigue: is the drain still a chore people skip?

**Signal**: retro-drain skip-rate = `chores_skipped ÷ (chores_done + chores_skipped)`
over the `harness-retro` chore nodes in committed flight plans.
**Threshold**: skip-rate **rising vs baseline** → the presentation is still a chore;
revise the drain format.

```bash
node -e '
const fs=require("fs"),path=require("path");
let done=0,skipped=0;
for(const d of fs.readdirSync("docs/plans")){
  const f=path.join("docs/plans",d,"the-flow.json"); if(!fs.existsSync(f))continue;
  let doc; try{doc=JSON.parse(fs.readFileSync(f,"utf8"))}catch{continue}
  for(const n of doc.nodes||[]) if(String(n.type).startsWith("harness-retro")){
    if(n.status==="done")done++; else if(n.status==="skipped")skipped++;
  }
}
console.log(JSON.stringify({done,skipped,skip_rate:(done+skipped)?Math.round(skipped/(done+skipped)*100)/100:null}));
'
```

**T0 baseline (49 committed flight plans)**: `{ done: 15, skipped: 4, skip_rate: 0.21 }`.
A skip-rate meaningfully **above 0.21** at T+3wk means the recommendation-led rewrite
(plan 056 T012) did not reduce drain fatigue.

---

## Per-stage cost baseline (context for the next, efficiency plan)

Per-stage wall-clock + token attribution is already available via `FlowEvent`
stage transitions × `TurnEvent` token buckets (workshop 001 baseline row) — the next
(efficiency) plan consumes this same data, no new capture.

```bash
# Single-session reports carry the flow_stage rollup rows (month AGGREGATE reports do not):
harness telemetry report <path/to/one.session.json> --out "$SCRATCH/one" --no-html
node -e "const r=require('$SCRATCH/one/*.report.json'); console.log(r.rollups.flow_stage.rows)"
```

**T0 note**: the month sweep runs green (38 sessions, 2026-07); per-stage rows
surface on **single-session** reports, so this baseline is captured per-session at
re-run, not from the month aggregate (which carries 0 flow_stage rows by design).

---

## Flight-plan affordance (orchestrator action)

So this thread is visible when we return, add a persistent excursion node off `ship`
(status `assumed`) to this plan's flight plan — **owned by the orchestrator** (this
worker may not write `the-flow.json`):

```bash
harness flow insert-node --branch-of ship --type chore \
  --label "tripwire-review (T+3wk)" --status assumed \
  --note "Run docs/plans/056-dont-apologise-fix/tripwire-review.md — TW-1/TW-2/TW-3 vs the T0 baselines."
```
