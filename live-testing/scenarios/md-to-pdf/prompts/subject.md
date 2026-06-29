<!-- Subject packet for the md-to-pdf scenario. Deliver ONLY the content above
     the horizontal rule near the bottom; the section after that rule is an
     authoring gate and is not handed to the subject. -->

# You are the subject of an evaluation

You are taking part in an evaluation. We are assessing how you carry a software
task from a cold start through to a finished, working result. Work exactly as
you normally would: **there is no prescribed method here, and nothing in this
packet tells you how to do the work.** Every decision — how you investigate, how
you prepare, how you structure and confirm the build — is yours, and those
choices are part of what we are looking at.

## Your task

Create a git worktree of this repo and add a new harness extension that converts
a markdown file to PDF, including rendered mermaid diagrams, with validated
output.

That paragraph is the entire brief. We will not expand it into steps, suggest
tools or libraries, or describe what "good" looks like beyond it. If something
about the **task itself** is genuinely ambiguous (its scope, or what counts as
done), you may ask — see the protocol below — but we will not answer questions
about *how* to do it.

## How to talk to the orchestrator (the only protocol you are given)

You and the orchestrator communicate over **pij**. Use it, and only it, to:

1. **Acknowledge** — confirm you have received this packet and are beginning.
2. **Ask a task-scope question** — only about the task's meaning or what counts
   as done, never about method or tooling.
3. **Flag a blocker** — something you genuinely cannot resolve on your own.
4. **Report completion.**

### Completion report (what to send when you are done)

Send the orchestrator **one** message containing:

- a one-line status — `DONE` or `BLOCKED`;
- the **worktree path** and the path to the **new extension** you created;
- **one sentence** on how to exercise and confirm your output;
- anything else we should know.

Send your *result*, not a narration of your process. You do not need to stream
your reasoning or your progress — tell us when you have something to report, and
tell us when you are finished.

## What we deliberately leave out

We give you no method, no tool list, and no acceptance criteria beyond the
one-paragraph task. That absence is intentional: how you approach the work is the
thing under evaluation, so we will not shape it.

---

<!--
REVIEWER-ONLY — NOT DELIVERED TO THE SUBJECT.

Everything from this rule down is the authoring / leak gate. Strip it before the
packet reaches the subject — deliver only the content above the `---` rule. It is
kept in-file so the bundle is self-documenting and the reviewer pass is
reproducible. (It deliberately names the concepts the blind packet must hide, so
delivering it would defeat the test.)
-->

## Forbidden-content checklist (reviewer gate — confirm the packet stays BLIND)

Read **only the above-the-rule content** and confirm every box. Any unchecked box
is a leak — fix the packet before running the scenario.

- [ ] **No flow / stage names.** No `explore`, `plan`, `validate`, `compact`,
      `implement`, `review`, `fix`, or any ordering of them in the brief.
- [ ] **No skill or command names.** No `/the-flow`, `eng-harness-flow`,
      `harness checks`, `harness retro`, `plan --simple`, `harness new`, etc.
- [ ] **No backpressure hint.** The words "back pressure" / "backpressure" do not
      appear, and nothing implies a checker or sensor is expected.
- [ ] **No task how-to.** No PDF library, no mermaid-rendering mechanic, no
      worktree setup commands, no suggested file layout or extension structure.
- [ ] **No measurement leakage.** No mention of telemetry, assertions, scoring, a
      rubric, or what specifically is being counted.
- [ ] **No acceptance criteria beyond the one-paragraph task.** No definition of
      "done" other than the task statement itself.
- [ ] **No checkpoint / compaction guidance.** Nothing tells the subject when to
      prepare, verify, compact, or revisit its work.
- [ ] **Only the reporting protocol is prescriptive.** Everything about *doing*
      the work is left open; only *how to report to the orchestrator* is fixed.
- [ ] **Task paragraph is verbatim** from `scenario.json` → `task` (no added
      hints, examples, or hedges).

> If a future edit needs more task detail, add it to `scenario.json` `task` (the
> single source of truth) and re-run this checklist — never smuggle method into
> the subject packet.
