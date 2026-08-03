# Thinker deliverable — how the-flow uses DDs

> Opus 5 subagent deliverable, 2026-08-03, plan 065. Preserved with technical content intact. Grounded in the real 063 flight plan, `flow-mutations.ts` (`NavShow`, `dueChores` line 100), `acts/flow.ts` (`orientView` ~1141–1220), and builder SKILL.md invariants #4/#12. NOTE (parent context): written before D4 (state enum) — its boolean-tick framing is superseded; its before/after node shapes, completion mechanic, gate-semantics split, and §4 kill-list fed infographic section 09 directly.

## Part 1 — Before/after: what a phase node knows

**TODAY** (verbatim shape from 063's `phase-2`): `{id, type, label, status, next, instructions[…"Done when the phase's acceptance criteria are met…"], ran_at}`. Facts: it names a label, a command, and a prose promise. It does not name a single acceptance criterion, does not say how many there are, which are met, or where they live. `orientView` can only project `{id, label, command, instructions[], chores[]}` — there is no field to project criteria from. "What do I owe here" is an **inference**, sourced from a markdown plan the node does not reference.

**AFTER** (field name `dd_link` is a PROPOSAL): the same node plus

```json
"dd_link": { "file": "docs/plans/…/telemetry-repair-plan.dd.json",
             "section": "plan-phase-2-ac", "kind": "completable-table" }
```

Three properties: **one field, not a copy** (the spine stores a pointer, never criteria text or tick state; ticking "in the flow" and "in the plan" are the same write to the same row — no second place to drift); **the section id is stable by convention** (authored against before the DD section exists; a broken link is a *detectable* condition, not a silent nothing); **everything else is derived** (criterion ids, states, evidence, proof commands read through the link at orient time — nothing duplicated into the-flow.json, so nothing can go stale there).

What orient gains (the renderer already has the slot pattern — chore pips `■ done · ▨ skipped · ▣ open+strong · □ open`):

```
▶ P2: Durable Evidence and Truthful Readers (phase-2)  /builder 6 implement
  Criteria: …plan.dd.json # plan-phase-2-ac
    ■ AC-01  segment tokens are cumulative, not summed
    ■ AC-02  reader rejects a window with no `to`
    □ AC-03  replay fixture round-trips byte-identical   proof: just test-replay
```

## Part 2 — The completion mechanic (6 steps)

The chore protocol is the template, and it is exact: **receipt first, status second**, both real CLI calls, and the agent may never self-skip. Verbatim from 063 `observe-2`: `harness flow comment --kind validation --source agent --text "captures:<count> pointer:<record> time:<…>"` THEN `harness flow status --to done`; real receipt produced: `decision:captured records:DL-001,INS-001 pointer:.harness/temp/agent/session-buffer.md time:2026-07-23T07:49:08.802Z`.

The AC mechanic, one level down — per criterion instead of per node:

```
1 ORIENT   → node phase-2, criteria 3, open: AC-03, proof: `just test-replay`
             (the proof command is read THROUGH the AC row's evidence link — never retyped)
2 WORK     → implement
3 PROVE    → just test-replay   ← a real invocation, never a narrated one → exit 0, 41 passed
4 RECEIPT  → harness dd tick --file <plan>.dd.json --section plan-phase-2-ac --item AC-03
               --evidence "just test-replay exit:0 41 passed time:… artifact_sha256:<…>"
             → append-only entry lands; .dd.md regenerates; doc sha advances
5 GATE     → orient: criteria 3/3 · due_criteria: []
6 DEPART   → harness flow nav set --now review-2   ← permitted only now
```

Parallels that must hold one-for-one with chores:

| Chore protocol (today, real) | AC protocol (proposed) |
|---|---|
| Receipt comment, then status | Evidence, then tick — one atomic `dd tick` call carrying both |
| Append-only comments[]; amendments are new entries (063's backpressure carries receipt + `receipt-amendment` superseding it — nothing edited) | Append-only evidence; a re-tick supersedes, never overwrites |
| A missing/UNAVAILABLE router is a **receipted attempt → done**, never a skip | A proof command that cannot run is a receipted attempt with the reason, not a silent tick |
| Human decline = two calls: comment `--kind decision --source user --text "<verbatim words>"` then `status --to skipped` | Human decline = two calls: evidence with their verbatim words `--source user`, then the criterion marked waived |
| **The agent may never self-skip** — no wording ("advisory", "recommended", `importance`) is agent licence (invariant #4) | Identical: `--evidence` may not be the agent's opinion that it looks fine; it is the output of a proof |

## Part 3 — Nav gate semantics: warn vs refuse

| Condition | Response | Precedent |
|---|---|---|
| Linked DD fails validate (schema broken, section unresolvable, sha drifted) | **WARN** — loud in orient, never blocks travel; a broken *link* is a repo-hygiene defect and `dd doctor` in checks is where it gets fixed | new |
| Linked section has completable items still open | **REFUSE departure** from the node — same rule, same read, same shape as `due_chores` | `dueChores()`, flow-mutations.ts:100 |
| Human declines a criterion | **Permitted always**, via two receipted calls with their verbatim words — never silent, never the agent's judgment | invariant #4 |

Doctrine constraint, exactly: **gates bind the AGENT, never the HUMAN** (invariant #4: "human-declinable is never agent-skippable"; invariant #12: what orient surfaces "gates nothing for the human — but for the agent each listed due chore is work to resolve").

**One mechanical fact this design must not misstate:** today's `due_chores` "refusal" is **not enforced by the CLI** — `navShow()` computes it as a *read*; the refusal lives in invariant #12(b), a skill instruction, and the SKILL.md itself concedes "guaranteed enforcement on an adversarially-weak model ultimately needs a harness-side per-turn hook." The AC gate inherits both the strength and the weakness. The CLI's job is to make the condition **computable and unmissable** — `due_criteria: […]` beside `due_chores`, printed by orient every turn. What the design *does* close is the **knowability** gap: today an unmet AC is not merely unenforced, it is **invisible** — there is no field for it to be absent from.

## Part 4 — What this kills (verified in this repo)

**(a) Unproven-AC-shipped — 056's AC-03 hole, worse than "unverified".** In `056-file-write-telemetry-plan.md` the third criterion reads `3. **n** — A write resolving **outside** the repo emits…` — the id was lost to a stray `n`. The roll-call in tasks.md carries the damage forward (`AC-02 … n out-of-repo… AC-04`). The criterion was **unnameable**: nothing can demand a receipt for a thing with no id, and nothing enumerates the set to notice the sequence skipping 02→04. It shipped. *Killed by:* a completable row cannot exist without an id (validate fails the document), and the node enumerates its criteria by id from one typed section.

**(b) Checkbox rot.** Spot-checked: 053 shipped with 8 unticked plan-doc task checkboxes, 054 with 4, 056 with 10 — while the corresponding `tasks/phase-*/tasks.md` rows were ticked. Two copies of one truth; one maintained, one abandoned. *Killed by:* the criterion exists in exactly one row in one DD; flow and plan render transclude it. There is no second checkbox to rot.

**(c) Stranded proof plans.** 063's survey produced a real receipted artifact (`modes:2-RUN,8-EXTEND,1-BUILD,0-ABSENT`) and the node's own instructions concede the gap: "the plan verb does not auto-read the coverage, so fold the findings in yourself." *Killed by:* the AC table's evidence column is a typed link into the backpressure DD by row id — folding stops being a diligence act and becomes a link that either resolves or fails doctor.

**(d) Orphaned surveys.** Of **54** the-flow.json files under docs/plans/, exactly **1** contains a basis_sha256 (063) — and no one can tell whether the documents other decisions were made against still say what they said. *Killed by:* every .dd.json carries a content-sha regenerated on every edit; drift detection is a property of the format, not a discipline one plan practised.

## Part 5 — Resume vignette

An agent's context is compacted mid-phase; it comes back cold. **Today:** `harness flow orient` gives the rail, the label, six instruction lines, one chore pip — and the only statement of what is owed is boilerplate. The agent opens the ~300-line plan, finds the phase heading, reads the ACs, then reads the execution log and task table to *guess* which were already satisfied, because nothing records that. It re-derives, and its derivation is an opinion. **After:** the same orient prints three criteria by id — two closed, each with the evidence receipt that closed it, one open, carrying its proof command read through its evidence link. The agent runs the command, ticks with evidence, the gate clears. Zero plan-doc reads. "What do I owe" was a **read**, and the answer was the same one the previous context had — not a fresh inference that happens to resemble it.

**Correction the parent carries forward:** the framing "nav refuses to depart a node with unresolved chores" is true as *doctrine* but not as *code* — the refusal is a skill instruction, and this design should not claim a mechanical gate exists today. Part 3 states the split honestly.
