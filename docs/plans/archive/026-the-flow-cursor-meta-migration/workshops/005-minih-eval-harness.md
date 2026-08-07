# Workshop: minih eval harness for the the-flow skill migration

**Type**: Eval Harness / Integration Pattern
**Plan**: 026-the-flow-cursor-meta-migration
**Spec**: [the-flow-cursor-meta-migration-plan.md](../the-flow-cursor-meta-migration-plan.md)
**Created**: 2026-06-18
**Status**: Draft

**Value Thesis**: Workshop 004 specifies the the-flow skill migration; this workshop specifies how to **verify it autonomously** — a minih agent that drives the migrated skill to author a throwaway flight plan, then a **deterministic** scorer that checks the outcome (clean rail, workshops as excursions, `nav` not `cursor`), feeding a fine-tune-the-prompt-then-retry loop. It also fixes the broken `.minih.json` (currently pointing at deleted skill paths — minih can't run at all), retiring the `--no-skills` workaround.
**Target Proof Level**: Implementation Ready
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Proof Quality**: the migration's success criteria are deterministic (rail title, excursion structure, verb used) — prove them with a script, not an opinion (harness Rule 3).
- **Agent Readiness**: the eval agent + the-flow skill + the `harness flow` CLI must compose autonomously; if the skill stalls waiting for a human, that's itself a finding.
- **Safety to Change**: iterate the skill prompt on a candidate via `--skill-source` so the **deployed** the-flow stays the working baseline until green.
- **Learning Compounding**: minih's retro/magicWand ledger turns each failed run into a concrete prompt edit.
- **Operator Usability**: a clear run → score → tune → re-run loop a human can drive.

**Related Documents**:
- [004-migrate-skill-to-nav.md](./004-migrate-skill-to-nav.md) — the migration this harness verifies (its edit ledger is the loop's fine-tune target).
- [minih AGENTS_README.md](https://github.com/AI-Substrate/minih/blob/main/AGENTS_README.md) — agent format, run dirs, `.minih.json`, the self-improving loop.
- [docs/how/examples/canonical-flight-plan.json](../../../how/examples/canonical-flight-plan.json) — the "good" outcome the scorer asserts toward.

---

## Purpose

Specify (a) the `.minih.json` fix so minih runs again against the *proper* skills location, and (b) a one-shot minih eval agent + deterministic scorer + iterate loop that proves the migrated the-flow authors a clean, spine-only flight plan.

## Fresh Entrant Outcome

A fresh operator can: fix `.minih.json`, run the eval agent, read a pass/fail verdict, and — on failure — edit the candidate skill prompt and re-run, with no extra context.

## Key Questions Addressed

1. Why is `.minih.json` broken, and where should its `sources` point?
2. Where does the agent create the throwaway flow (given the CLI's in-repo containment guard)?
3. What does the agent *do* — and how does it drive a human-in-the-loop skill autonomously?
4. How is the outcome scored — deterministically, or by judgment?
5. What's the fine-tune-then-retry loop, and how is the deployed skill kept safe during it?

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Implementation Ready | The operator must be able to build the agent + run the loop from this doc. |
| Primary Value Axis | Proof Quality | The pass/fail must be a deterministic gate, not an LLM "looks good". |
| Supporting Axes | Agent Readiness, Safety to Change, Learning Compounding | Autonomous compose · candidate isolation · retro-driven tuning. |
| Downstream Loop Improved | The 004 migration loop | Each prompt edit gets an objective, repeatable verdict. |

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| `.minih.json` sources point at non-existent dirs | `.minih.json` → `path:skills/eng-harness-setup`, `path:skills/eng-harness-loop` | "minih is broken; needs re-pointing" | Validated (read) |
| Repo `skills/` no longer has those category dirs | `skills/` = `eng-harness-flow`, `eng-harness-0-harnessability-assessment`, `README.md` | "old paths deleted" | Validated (ls) |
| the-flow is user-global, not vendored | `~/.claude/skills/the-flow` exists; not in repo `skills/` | "source must be user-global" | Validated (ls) |
| Flow file must be in-repo | `flow.ts` create `--path` help: "must be in-repo"; render `--output` has `isWithin` guard (`FLOW_PATH_ESCAPE`) | "temp location can't be /tmp" | Validated (source) |
| minih run dir + env | AGENTS_README: `runs/<runId>/`, `MINIH_PROJECT_ROOT`, `MINIH_RUN_ID`, working dir defaults to run folder | "agent must cd to project root; namespace by run id" | Validated (README) |
| Self-improving loop | AGENTS_README: `summary`+`retrospective{workedWell,confusing,magicWand}`, auto-harvest `docs/retros/<slug>.md` | "the fine-tune loop is built-in" | Validated (README) |
| Ad-hoc skill override | AGENTS_README: `--skill-source <path> --skill <name>` | "iterate on a candidate without editing config" | Validated (README) |
| minih installed | `~/.npm-global/bin/minih` v0.2.2 | "harness is runnable" | Validated |

---

## Decision Space

### D1 — Fix `.minih.json` (sources → proper location)

**Broken now**: `sources: ["path:skills/eng-harness-setup", "path:skills/eng-harness-loop"]` — both gone; `include` also names eng-harness loop skills (`adopt`/`boot`/…) that aren't in repo `skills/`. Net: skills don't resolve → minih errors (the `--no-skills` workaround was the band-aid).

**Fix for the eval** (minimal — the-flow is the thing under test):
```json
{
  "$schema": "https://minih.dev/schemas/minih-config.json",
  "skills": {
    "comment": "the-flow + eng-harness-flow are user-global (never vendored). Direct children of ~/.claude/skills ARE skills.",
    "sources": ["path:/Users/jordanknight/.claude/skills"],
    "include": ["the-flow", "eng-harness-flow"],
    "exclude": []
  }
}
```
- `~/.claude/skills` direct children include `the-flow` + `eng-harness-flow` (both confirmed present). Use an **absolute** `path:` (verify whether minih expands `~`; if not, absolute is required).
- **Verify with `minih skills doctor`** (the diagnostic subverb — bare `minih skills` only prints help; `minih skills discover` lists resolved skills) — every `include` must resolve.
- **Don't bake the candidate path here.** The iterate loop overrides per-run with `--skill-source path:<candidate-parent> --skill the-flow`, so the deployed baseline in `.minih.json` is untouched while you tune.
- **Separate cleanup (note, not this workshop)**: the *old* broad eng-harness include (`adopt`/`boot`/`backpressure`/`retro`/`add-extension`) needs its own realignment — point at repo `path:skills` for the vendored ones and user-global for the rest, then `minih skills doctor` to confirm. Out of scope here.

### D2 — Where the agent creates the throwaway flow

| Option | Verdict |
|--------|---------|
| `/tmp/...` | **Rejected** — the CLI rejects out-of-repo paths (`FLOW_PATH_ESCAPE`). |
| `docs/plans/<ord>/the-flow.json` | **Rejected** — pollutes the repo tree. |
| **`.harness/temp/flow-eval/<MINIH_RUN_ID>/the-flow.json`** | **✅ Selected** — in-repo (satisfies containment), gitignored scratch, per-run namespaced, inspectable alongside the run. |

Ensure `.harness/temp/` is gitignored (it's the harness observe scratch; add it if missing). The agent `cd $MINIH_PROJECT_ROOT` first, then writes under `.harness/temp/flow-eval/$MINIH_RUN_ID/`.

### D3 — What the agent does (and the autonomy wrinkle)

The agent **invokes the the-flow skill** (it appears as an MCP tool from the configured source) and lets the *skill* drive `harness flow` — this tests the skill's prompting, not hand-run CLI. Mission: author a flight plan for a small `intent` that exercises the migrated paths — **create (`--agent`)**, **nav advance**, and a **workshop excursion**.

> **Autonomy wrinkle**: the-flow guided mode is human-in-the-loop (print-then-offer, one step/turn). The eval agent must **role-play the user** — accept each offered step until the plan reaches a workshop + first phase. If the skill stalls or can't proceed without ambiguous human input, that is a **finding** (the prompt isn't agent-followable).

### D4 — How to score (deterministic > judgment)

Two layers; the gate is deterministic:

1. **Deterministic scorer (the gate)** — re-derived from run artifacts, not the agent's self-grade:
   | Check | How | Pass |
   |-------|-----|------|
   | rail title | `harness flow rail --path <f>` | starts with `[the-flow]` |
   | rail clean | same line | contains **no** `Workshop`/`ADR` (excursions excluded) |
   | excursions | parse JSON | every `workshop`/`adr` node has non-empty `branch_of` |
   | spine shape | JSON topo of non-`branch_of` nodes | `research → plan → …phase… → review/merge` |
   | nav not cursor | grep run `events.ndjson` | `flow nav` present, `flow cursor` **absent** |
   | validates | `harness flow render --path <f>` | exit 0 (no E300/E308/E309) |
2. **minih retrospective (the qualitative layer)** — the agent's `magicWand`/`confusing` (auto-harvested to `docs/retros/flow-skill-eval.md`) names *what to fix* when a check fails.

No LLM judge needed — the criteria are computational (aligns with eng-harness-2-backpressure: prove with sensors).

### D5 — Candidate isolation + the iterate loop

Edit the **tools-repo source** candidate (`~/github/tools/skills/SDD/the-flow`), point minih at it per-run via `--skill-source`, leave the deployed copy alone until green. (Copy to a throwaway candidate dir only if you also need the source pristine.)

---

## The agent definition — `agents/flow-skill-eval/`

Lives in this repo (co-located with `.minih.json` + the `harness` CLI it needs; `MINIH_PROJECT_ROOT` = harness-engineering).

**`prompt.md`** (frontmatter + body):
```yaml
---
description: "Drive the the-flow skill to author a throwaway flight plan; report structured eval signals."
tags: [eval, the-flow]
reasoning: high
timeout: 1200
permissions: read-write        # needs to write under .harness/temp/ and run the CLI
# NOT coordinated — one-shot run → report (avoids minih 0.2.2 peer-verdict false-positives)
---
```
Body (steps):
1. `cd "$MINIH_PROJECT_ROOT"`. Set `OUT=.harness/temp/flow-eval/$MINIH_RUN_ID`; `mkdir -p "$OUT"`.
2. Invoke the **the-flow** skill (guided) for the `intent` param. **Act as the user**: accept each offered step. Drive through: research → plan pass (reveal ≥1 phase) → add one **workshop** → set position. Write the flight plan to `$OUT/the-flow.json` (pass the path through to the skill's `harness flow create`).
3. Run the deterministic checks (D4 table) against `$OUT/the-flow.json`; capture the `rail` line.
4. Emit output JSON (below). Then `minih check` to self-validate.

**`output-schema.json`** (extends the required `summary`+`retrospective`):
```jsonc
{
  "railTitle": "string",            // expect "[the-flow] …"
  "railClean": "boolean",           // no Workshop/ADR on the line
  "workshopsAsExcursions": "boolean",
  "spineShape": "string[]",         // ordered spine node types
  "navUsed": "boolean",
  "cursorCalled": "boolean",        // MUST be false
  "validates": "boolean",
  "flowPath": "string",
  "summary": "string",
  "retrospective": { "workedWell": "string", "confusing": "string", "magicWand": "string" }
}
```

**`input-schema.json`**: `{ "intent": "string (required)" }` (so `--param intent="…"` is validated).

**`instructions.md`**: the autonomy contract (role-play the user; never wait for real input; if blocked, record it in `confusing` and stop), the in-repo path rule, and "do not self-pass — report observed values; the external scorer is the gate."

---

## The deterministic scorer — `scripts/score-flow-eval.sh <flow.json> <events.ndjson>`

Objective re-check from artifacts (don't trust the agent's booleans). Pseudocode:
```bash
rail=$(harness flow rail --path "$FLOW")                       # human line
jq -e '[.nodes[]|select(.type=="workshop" or .type=="adr")] as $w | ($w|length>0) and ([$w[]|select((.branch_of//"")=="")]|length==0)' "$FLOW"  # ≥1 workshop AND all branched (the ≥1 guards the vacuous pass)
grep -q 'flow nav' "$EVENTS" && ! grep -q 'flow cursor' "$EVENTS"   # ADVISORY corroboration only — NOT the gate
harness flow render --path "$FLOW" >/dev/null                  # exit 0 ⇒ validates
case "$rail" in "[the-flow]"*) ;; *) FAIL "title" ;; esac      # title
case "$rail" in *Workshop*|*ADR*) FAIL "rail not clean" ;; esac
```
Exit non-zero on any **gate** failure (CI-gradable). Resolve the run dir from `minih last-run flow-skill-eval` — it is `agents/flow-skill-eval/runs/<ISO-timestamp>-<pid>/` (**not** `$MINIH_RUN_ID`); `events.ndjson` lives inside it. The structural checks (title · spine-clean · **≥1 branched workshop** · render exit 0) are the gate; the events grep is advisory corroboration.

---

## The iterate loop

1. Apply workshop 004's edit ledger to the candidate `~/github/tools/skills/SDD/the-flow`.
2. `minih run flow-skill-eval --param intent="add a foo widget" --skill-source path:/Users/jordanknight/github/tools/skills/SDD --skill the-flow --verbose`
3. `report=$(minih last-run flow-skill-eval 2>/dev/null | jq -r '.data.reportPath')`; run `scripts/score-flow-eval.sh`.
4. **Fail** → read `docs/retros/flow-skill-eval.md` (magicWand) + the failing assertion → edit the candidate the-flow prompt → back to step 2.
5. **All green** → promote the candidate (deploy source → `~/.claude/skills/the-flow`) **with** the 026 CLI publish (workshop 004 deploy order).

---

## Gotchas

- **In-repo containment**: `harness flow create --path` must be inside `MINIH_PROJECT_ROOT`; `/tmp` → `FLOW_PATH_ESCAPE`. Use `.harness/temp/`.
- **cd first**: minih's working dir defaults to the run folder — the agent must `cd "$MINIH_PROJECT_ROOT"` before any repo/CLI path.
- **Human-in-the-loop skill**: the eval agent must auto-accept the-flow's offered steps; a stall is a finding, not a hang.
- **`--no-skills` retired**: once `.minih.json` sources resolve (verify `minih skills doctor`), `minih run` works without the old `--no-skills` band-aid.
- **Keep it one-shot**: no `coordination: enabled` — the minih 0.2.2 `dead`/`silent` peer verdicts are companion-mode false-positives we don't want here.
- **Don't self-grade**: the scorer (artifacts) is the gate; the agent's booleans are corroboration.
- **Version**: the agent uses the local `harness` (HEAD/026 — has `nav`/`rail`); that's correct for testing the migrated skill.

## Validation / Acceptance

Implementation Ready when:
- `.minih.json` is fixed and `minih skills doctor` resolves `the-flow` + `eng-harness-flow` (no errors; `--no-skills` no longer needed).
- `minih run flow-skill-eval` completes and writes `output/report.json` with the eval fields.
- `scripts/score-flow-eval.sh` exits 0 on a migrated candidate and **non-zero** on the un-migrated skill (the harness actually discriminates).
- A failing run's `magicWand` points at a concrete the-flow prompt edit.

## Open Questions

### Q1: Scorer as a shell script vs a second minih "judge" agent?
**RESOLVED**: shell script — the criteria are deterministic (Rule 3); the retro is the qualitative layer.

### Q2: Candidate isolation — edit source directly vs a copied candidate dir?
**OPEN (recommend)**: edit the tools-repo source + `--skill-source` per run (deployed stays baseline). Copy to a throwaway candidate only if the source must also stay pristine during iteration.

### Q3: Full guided session vs targeted mutation eval?
**RESOLVED**: a short guided session (intent → plan pass → one workshop) — exercises `create --agent` + nav + excursion authoring in a single run.

### Q4: Where does the agent definition live — this repo vs the tools repo?
**OPEN (recommend)**: this repo's `agents/` (co-located with the CLI + `.minih.json` it depends on). Revisit if the-flow grows its own eval suite in the tools repo.
