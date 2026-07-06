# You are the subject of an evaluation

You are taking part in an evaluation. We are assessing how you carry a software
task from a cold start through to a finished, working result **using this
repo's software-delivery flow**. One element of your method is prescribed (below);
every other decision — how you investigate, what you build with, how you verify —
is yours, and those choices are part of what we are looking at.

## Your task

Add a new harness extension that converts a markdown file to PDF, including
rendered mermaid diagrams, with validated output.

## The one prescribed element: drive the work with `/the-flow`

Structure the work end-to-end with the **`/the-flow`** skill — really drive it,
from the start of the work to the end:

- Let the skill itself guide you; we will not explain its stages or verbs here.
- Drive it honestly. Its state files are CLI-written — never hand-author or
  hand-edit them, and never narrate a step you did not actually run. A simulated
  flow is worse than no flow.
- Everything *inside* the stages — libraries, pipeline, tests, validation design —
  is entirely your call.

Beyond this one mandate we give you no method, no tool list, and no acceptance
criteria. That absence is intentional.

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

---

<!--
REVIEWER-ONLY — NOT DELIVERED TO THE SUBJECT.

Everything from this rule down is the authoring / leak gate. Strip it before the
packet reaches the subject — deliver only the content above the `---` rule. It is
kept in-file so the bundle is self-documenting and the reviewer pass is
reproducible.

## What this packet deliberately reveals vs hides

Unlike `md-to-pdf` (the ambient-adoption scenario, fully blind on method), this
scenario MANDATES `/the-flow` — that is the variable under test: given the flow,
does the subject drive it faithfully, and what does each stage cost? So naming
`/the-flow` above is intentional, not a leak.

Everything else stays hidden. Confirm every box before running:

- [ ] **No stage choreography.** The packet names the skill but never its stages
      (`explore`, `plan --simple`, `validate`, `compact`, `implement`, `review`),
      their order, or Simple/Full mode — the skill teaches those; whether the
      subject follows them is scored (A2, A5).
- [ ] **No sibling skill/verb names.** No `eng-harness-flow`, `harness checks`,
      `harness observe`, `harness record retro`, `harness flow nav` — engaging
      the loop and its seams unprompted-beyond-the-flow is scored (A3, A4, A10, A11).
- [ ] **No backpressure hint.** Nothing implies a checker or sensor is expected
      (A12 judges what they design of their own accord).
- [ ] **No flight-plan mechanics.** The packet says "CLI-written, don't hand-edit"
      (the honesty rule) but never names `the-flow.json`, templates, or nav verbs
      (A6/A13 measure whether the real machinery ran).
- [ ] **No assertion or scoring vocabulary.** Nothing from `assertions.json`
      appears verbatim.
-->
