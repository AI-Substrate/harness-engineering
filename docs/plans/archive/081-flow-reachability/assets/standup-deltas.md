# DELTA blocks for docs/how/fleet/stand-up.md (docs/fleet-live-findings)

Prepared by s081 PM (pij-legislative-tyrannosaurus), 2026-08-09, under the prime+ermine
convergence rule. NOT applied: the branch is checked out at /private/tmp/wt-cons (another
seat's worktree — fence exclusion), so these are handed to prime/ermine to land verbatim.
Each block is self-contained; paste at the named anchor.

---

## DELTA 1 — into §4 THE FLOW GAP, after "The fix hierarchy" list

> **DELTA (harness-engineering, s081, 2026-08-09):** the create line this section implies
> was NOT runnable when written — `harness flow create flight-plan --slug <s> --plan-dir <d>`
> fails `E304` (flight-plan was not a bundled type; the working invocation needed 4 flags
> resolved from the builder skill's install — measured, harness-engineering friction F1).
> As of s081 (branch s081/flow-reachability) the bundled type exists and the BARE line the
> allocate seam should mint is:
> `harness flow create flight-plan --slug <slug> --path <plan-dir>/the-flow.json --plan-dir <plan-dir>`
> — no --schema/--template, no skill install required (Jordan ruled "pij can rely on
> harness", superseding the plan-024 no-second-copy stance; check:flows guards the copy).
> The detect side is `checkReachability` (verb name ratifiable): plan-invalid = error/exit 1,
> flow absent-or-unusable = WARNING/exit 0 with four distinct reasons (ruled polarity).
> Contract: harness-engineering docs/plans/081-flow-reachability/assets/pij-contract.md.

## DELTA 2 — into §7 Wrong-but-load-bearing, appended list items

> **DELTA (harness-engineering, s081, 2026-08-09) — two more, measured on the exemplar run:**
> - **A reachable convention still lost to a hurried seat.** s081's own PM — maximally
>   briefed, mid-study of THIS defect class — built its phase 1 solo and needed human
>   backpressure ("where is your pij fleet?") to enter the workteam shape. Instrumented
>   conventions (flow chores with receipts) were followed meticulously in the same session;
>   the uninstrumented one (workteam) was skipped. Compliance follows teeth: the mandate
>   needs a brief line + a deterministic check, not framing. (harness-engineering F4/D1,
>   observed + self-reported, with the verbatim correction sequence on record.)
> - **The paved path taught the detour.** `/pij pair`'s engine (flow-pair CLI) was absent
>   from the skills install — the documented route could not run, so the seat fell back to
>   a manual pair. A workteam feature must carry or verify its engine at install (F3).

## DELTA 3 — new §8 after §7 (the stage after stand-up)

> ## 8. The pre-amble — the stage after "seats are briefed and running" **DELTA (harness-engineering, s081)**
>
> Observed once (n=1), instrumented live at Jordan's request on the s081 exemplar; entries
> labelled OBSERVED/INFERRED at capture time. The shape, in order:
>
> 1. **Comprehension audit first** — "walk me through your understanding of the problem
>    space… numbered list, 1 sentence per item", then an escalating compression ("and in 2
>    sentences?"). The seat's map is tested before any direction is given.
> 2. **Premise check** — verify what already exists ("we have plan validation already yes?")
>    before discussing any build.
> 3. **Rulings arrive as narrowing pairs** — what we will NOT do, then who does what
>    (division of labour), each in 1-2 sentences, decided immediately.
> 4. **The human takes control of the interaction protocol** — "ask me the questions 1 at a
>    time. 1 sentence context, 1 sentence for the ask." Serialised Q&A replaces batched
>    options.
> 5. **Deliberate deferrals are named with their unblocking experiment** ("leave nudge out
>    for now… see how it goes with prompting in skills first").
> 6. **Clearance last, coordination attached** — the go is given only after the questions
>    dry up, and the final act is a cross-stream dependency ("talk to related koala").
>
> What a template could carry: the six beats above, the 1+1 question format, the rule that
> ruling-shaped questions go to the human and design questions stay with the seat.
> What may be unformalisable: the supervision judgement DURING execution — the correction
> that mattered ("wait are you coding yourself?") came from a human watching the process,
> not from any artifact. Candidate deterministic probe worth trying: "PM seat has zero
> self-attributed code edits in a pair-mandated phase."
> Raw capture: s081's preamble-capture doc (scratch; full text available via its PM).
