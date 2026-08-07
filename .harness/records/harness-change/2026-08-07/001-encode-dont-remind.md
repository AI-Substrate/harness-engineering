---
record_kind: "harness-change"
harness_version: "0.13.0"
branch: "s076/commit-guidance-block"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-08-07T09:19:53.456Z"
agent: "pij-respectable-clam"
plan_id: "076"
schema_version: "1.0"
resolves: "docs/plans/076-commit-guidance-convergence/assets/reviews/phase-1-review.md"
change_type: "sensor"
target: "harness/cli/src/services/instructions/commit-guidance.ts + its test — a source-reading uniqueness assertion and a Record<CommitMode,…> totality constraint"
---

# Harness change — encode, don't remind: a correction written as prose is a control with no failure mode

## The observation

Plan 076 fixed a documentation surface that claimed more than the code delivered. Across four
review rounds, the **same overclaim** — "X is the ONLY declaration/writer of Y" — was found and
fixed **six times**, each time one layer up from the last:

| # | Where | Falsified by |
|---|---|---|
| 1 | the outcome table's `nudge` datum | declared but never rendered, free to disagree with the prose beside it |
| 2 | a source comment claiming sole ownership of the nudge verb | `RECOVERY_SECTION` named the verb by hand |
| 3 | `ac-0002`'s claim | the two-level design put promises in a companion map |
| 4 | the doc comment directly above the table | `COMMIT_OUTCOMES` contradicted it |
| 5 | the `CommitRecovery` comment | `RECOVERY_SECTION` again |
| 6 | **the comment written in round 3 to fix #5** | the page's Windows bullet named the verb by hand, in rendered output |

**Instance 6 is the finding, not the count.** The sixth violation was written *inside the comment
authored to prevent the fifth*, by the same agent, within the hour, while it was actively fixing
that exact class of bug. A lesson had been recorded in prose as `D5` — *"when you assert X is the
only writer of Y, grep for Y before you write the sentence"* — and was then violated twice more in
the same file.

## Why this is not carelessness

The self-referential shape is what makes it unarguable. The reminder reproduced the error it was
written to prevent, immediately, in itself. No amount of author diligence closes that gap, because
the diligence *was* the control that failed.

**A correction written as prose is a control with no failure mode.** It cannot be violated
loudly — nothing goes red when the next author contradicts it. It degrades silently into a
statement that used to be true, and every test stays green while it does.

## What actually held

Two mechanisms, both of which fail *loudly* when violated. These are the recipe; "encode, don't
remind" is only its name.

**1. Totality as a compile error.** The outcome table is declared
`as const satisfies Record<CommitMode, CommitOutcomeGuidance>`. Adding a `CommitMode` arm without
describing it fails `tsc` — mutation-proven at 2 errors, both in `commit-guidance.ts` (TS1360 at
the table, TS7053 at its renderer), with `commit-service.ts` compiling clean.

*Stated bound, honestly:* this proves **declaration totality**, not semantic correctness. A fifth
mode pointed at the *wrong* outcome still compiles.

**2. Uniqueness as a source-reading test.** A test reads `commit-guidance.ts` as text and requires
the literal `harness doctor telemetry-nudge` to appear **exactly once**, at its declaration — and
separately asserts both rendered surfaces *do* contain the verb, so "named once" cannot be
satisfied by simply omitting it. Mutation-proven: hand-typing the verb into the page body fails
with `expected 2 to be 1`.

This is the general form of **DL-007** (*a guarantee about future code needs the type system, not
a test*) extended to the case where the type system cannot reach: when the invariant is about
**text**, assert it against the **source file**, not against behaviour.

## The transferable rule

> When you write "X is the only writer/declaration of Y", you have created an invariant.
> Either encode it so violating it fails, or do not claim it.

Prose corrections are acceptable for things that are *true today and need remembering*. They are
**not** acceptable for things that must **stay** true — those need a failure mode.

## Related — the review-loop half of the same night

The same plan overran its review by two rounds. A **find-another-instance** posture has no internal
stopping signal: a round finding something real is exactly what it looks like both when the loop is
working and when it is spinning, and those states are indistinguishable from inside it. Prime made
the ceiling general in response:

> Every review loop states its **termination condition at dispatch**, not after. Default: the loop
> ends when a round returns only findings that are neither (a) a correctness defect in the changed
> code nor (b) a control that does not fail when it should.

Note the second arm of that condition **is** this record's subject — a control with no failure mode
is worth another round; a reworded comment is not.

## Provenance

- Plan: `docs/plans/076-commit-guidance-convergence/`
- Review record (all four rounds, including the two that overran — kept deliberately as the
  evidence for this entry): `assets/reviews/phase-1-review.md`
- Coder's own account, `D5`/`D6`: `assets/tasks/phase-1/execution.log.md`
- Cross-model: opus-5 coder, terra reviewer. Instances 4 and 6 were surfaced only because the
  reviewer was told to *assume* another existed rather than confirm the known ones were fixed.
