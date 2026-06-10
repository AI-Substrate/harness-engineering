---
schema_version: "1.0"
record_kind: "correction"
agent: "operator+claude"
plan_id: "013-dogfood-harness-flow"
created_at: "2026-06-10"
supersedes: "FIND-1 (\"ship harness init\") as a discovered, convergent dogfood finding"
status: "surfaced (not auto-implemented)"
summary: >
  Corrects the plan-013 dogfood signal that "all five workers independently asked
  for `harness init`." They did not discover it — the worker prompt scripted the
  wish and pre-labelled its absence a finding. This record (a) names the
  contamination + the de-leak we applied to the generator, (b) de-conflates the
  ask into the one deterministic slice a CLI verb can ship and the inferential
  slice that can only be a skill, and (c) records the corrected disposition for
  any future `harness init` plan.
---

# Correction — the `harness init` ask was planted, not discovered (plan 013)

> **Surfaced for review, never auto-implemented.** This record annotates frozen
> evidence; it does **not** rewrite any worker farewell envelope. The workers'
> verbatim words stand. What changes is how we *read* them and what we tell the
> *next* run.

## 1. What this corrects

The plan-013 rollups read as a strong, convergent signal: **5/5 worker runs +
the build retro** named "ship `harness init`" as their top magic-wand
(`runs/ROLLUP.md`, `2026-06-09-validate-harness-flow-worker-harvest.md`,
`the-flow.md:39` → "FIND-1 (harness init) → reserved for its own plan").

That unanimity is **not** convergent discovery. It is an echo of our own prompt.
The signal is contaminated; the vote count must not be read as demand.

## 2. Evidence of contamination (the generator handed them the answer)

From the live worker prompt **as it ran** (now de-leaked — see §5):

| Site | What it planted |
|---|---|
| `prompt.md:255` (old) | The how-to-write-a-magic-wand instruction *scripted the wish verbatim*: "Be **specific** … not 'improve setup' but e.g. **'ship `harness init` so governance isn't hand-written.'**" The workers copied the example key back to us. |
| `prompt.md:180` (old) | They entered already knowing the name + that it was owed: "There is **no `harness init`** command (it is a deferred CLI writer — Key Finding 02)." |
| `prompt.md:205-206` (old) | We pre-labelled the friction *as a finding* before they hit it: "This hand-writing is itself a logged dogfood finding — the `harness init` gap." |
| `instructions.md:9` (old) | Same again: "because no `harness init` writer is shipped yet — that gap is itself a finding." |

This is the `validate-v2` **assumption-leakage** failure mode applied to our own
dogfood instrument. The *toil underneath is real* (hand-writing eight grounded
BIO fields every run genuinely is the biggest manual step) — but the priming
destroyed our ability to read the unanimity as evidence of demand. The friction
is real; the vote is rigged.

## 3. The ask is also mis-specified — a deterministic verb can't do the painful part

`harness init` as wished-for ("generate `.harness/engineering-harness.md` with the
eight BIO fields, grounded in repo evidence") asks a **deterministic CLI verb** to
do **inferential** work. The prompt's own field list proves it: every one of the
eight fields (`prompt.md` S3) is qualified **"grounded in what you actually found
in this repo (not boilerplate)."** That phrase *is* the definition of an LLM task.

A `harness` verb is, by Constitution P2, a pure function over `FsPort`/`ExecPort`
with fakes, no LLM, no network. It cannot decide chalk's boot is `npm test` or its
maturity is L2-because-X. So `harness init` *as a grounded-governance generator* is
a category error: it would have to embed an LLM (breaks the constitution), shell
out to an agent (then it's the setup skill in a CLI costume, not `init`), or emit
boilerplate (which the prompt explicitly forbids).

De-conflated, the one ask is really **two separable jobs**:

| Job | Owner | Why |
|---|---|---|
| **Scaffold the `engineering-harness.md` template + mechanically transcribe the already-structured fields** from `latest.json` (grade, two-axis tuple, repo name, a detected test command *if* the assessment captured one); leave the judgment fields as guided TODO prompts | **deterministic CLI `harness init`** — the `harness record` model (placement, never-clobber, schema-agnostic) | This is real but modest: it removes *typing*, not *thinking* |
| **Ground the ~7 judgment BIO fields** (boot cmd, health check, interact, observe, signal inventory, evidence paths, back-pressure gaps, maturity) in this specific repo | **the setup *skill*** (an LLM) — already what the worker does, by hand | "Grounded, not boilerplate" is inherently inferential; it cannot live in a no-LLM verb |

## 4. Corrected disposition (for whenever init is planned) — Step 4

The honest replacement for "FIND-1: ship `harness init`":

- **If `harness init` is ever built, scope it to the deterministic slice only** —
  scaffold + transcribe, mirroring `harness record` (template body *is* the schema;
  the CLI never parses or grounds it). Pre-fill only fields that are *already
  structured* in `.harness/reports/harnessability/latest.json`. Emit the rest as
  commented, guided TODOs. Return the path in an Envelope. Net value: it removes
  the boilerplate-typing, sets placement, and points the agent at what to fill.
- **Assign the grounding to the setup skill, explicitly.** The eight-field
  *judgment* is a first-class skill step, not a CLI feature. The "fix" for the
  toil is to make that skill step own a pre-scaffolded template — not to pretend a
  verb can ground it.
- **Do not ship a deterministic "grounded governance generator."** It cannot exist
  within the CLI constitution. Any rollup wish for `harness setup --json` that
  "generates `.harness/engineering-harness.md`" inherits the same category error
  and must be split the same way.

This is **surfaced**, not a plan. It re-scopes the reserved item; it does not
authorise build.

## 5. What we changed as a result (Step 1 — the de-leak, applied)

The *live* generator was de-leaked so the **next** run can't re-plant the wish
(frozen `runs/*/prompt.md` snapshots were intentionally left as historical record):

- `agents/validate-harness-flow/prompt.md` — S3 now states the task neutrally
  ("hand-write the governance doc from the template"); removed the "no `harness
  init` / deferred Key Finding 02" framing and the "this is itself a finding"
  parenthetical; the magic-wand guidance now demands a **specific, self-derived**
  wish "in your own words … don't reach for a pre-named feature or a solution the
  prompt put in your head," with the scripted `harness init` example deleted.
- `agents/validate-harness-flow/instructions.md` — the governance-doc exception no
  longer names a wished-for command or calls its absence a finding; it just states
  governance is the one artifact the flow doesn't produce via a skill.

## 6. How to read the frozen evidence now

- The worker farewell envelopes + per-repo retros (`runs/**/retro/*.md`,
  `*-worker-harvest.md`) **stand as written** — they are accurate records of what
  the workers said under the contaminated prompt. Read their `harness init`
  magic-wands as *prompt echoes*, not independent demand.
- The real, uncontaminated findings from the same runs (consumer-mode
  `cli-build degraded`, `npm install $ROOT` /tmp hazard, `--wrap` sparse/TODO
  Envelope, boot-failure semantics, VF-vs-MH numbering) are unaffected by this
  correction and remain genuinely surfaced.
- The only way to *measure* how much of the init wish was echo vs real is to
  re-run one worker on the de-leaked prompt (Step 5, not taken). If init still
  surfaces unprompted, the friction is real and honestly evidenced; if it
  vanishes, it was pure echo.
