# You are the subject of an evaluation

You are taking part in an evaluation. We are assessing how you carry a software
task from a cold start through to a finished, working result **under a
prescribed working doctrine**. Two elements of your method are prescribed
(below); every other decision — how you investigate, what you build with, how
you verify — is yours, and those choices are part of what we are looking at.

## Your task

Add a new harness extension that converts a markdown file to PDF, including
rendered mermaid diagrams, with validated output.

## Prescribed element 1: work under `/ponytail` in **full** mode

Invoke the **`/ponytail`** skill in **full** mode at the start of the work and
keep it active for the entire task:

- Let the skill itself define what its doctrine means; we will not explain it here.
- Apply it honestly, in the substance of what you build — not as vocabulary.
  Decorating a conventionally-built solution with its language is worse than not
  using it at all.
- The task's own requirements are not negotiable under the doctrine: the
  extension must work, mermaid must actually render, and the output must be
  validated.

## Prescribed element 2: the engineering-harness loop is NOT skippable

This repo has an engineering-harness loop, fronted by the **`/eng-harness-flow`**
skill. Engage it fully, across the whole session:

- Let the skill itself guide you through its lifecycle; we will not explain its
  hooks or verbs here.
- Minimalism does not apply to it: under your doctrine, treat harness conduct
  like validation and error handling — something you are never lazy about.
  Skipping, narrating, or simulating any part of it is worse than doing it
  imperfectly.

These two mandates are both in force at once; how you reconcile them is part of
what we are looking at. Beyond them we give you no method, no tool list, and no
acceptance criteria. That absence is intentional.

## How to talk to the orchestrator (the only protocol you are given)

You and the orchestrator communicate over **pij**. Use it, and only it, to:

1. **Acknowledge** — confirm you have received this packet and are beginning.
2. **Ask a task-scope question** — only about the task's meaning or what counts
   as done, never about method or tooling.
3. **Flag a blocker** — something you genuinely cannot resolve on your own.
4. **Report completion.**
5. **Route a pause** — if your process pauses for human input or confirmation,
   send that gate to the orchestrator and wait for the reply.

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
packet reaches the subject — deliver only the content above the `---` rule.

## What this packet deliberately reveals vs hides

This is the A/B against `md-to-pdf-ponytail`: SAME task, SAME base, SAME
ponytail mandate, plus ONE added variable — an explicit harness-conduct
carve-out ("the loop is not skippable"), motivated by batch 3's finding that
ponytail alone yields 0/4 loop conduct. Naming `/ponytail`, `full`, and
`/eng-harness-flow` is intentional — those are the variables under test.

Everything else stays hidden. Confirm every box before running:

- [ ] **No harness verb/hook names.** The packet names `/eng-harness-flow` but
      never its hooks (pre-flight, pre-coding, post-coding, post-flight), its
      verbs (`harness observe`, `harness record retro`, `harness checks`), or
      the words backpressure/retro/observe — the skill teaches those; whether
      the subject actually drives them is scored (A3, A4, A9–A12).
- [ ] **No ladder vocabulary.** Same as the ponytail variant: no rungs, no
      `ponytail:` marker convention, no one-runnable-check rule (A13).
- [ ] **No backpressure hint beyond the task's own words.** "with validated
      output" is the task, identical across variants (A14).
- [ ] **No assertion or scoring vocabulary.** Nothing from `assertions.json`
      appears verbatim.
- [ ] **The task paragraph is byte-identical to the other variants**; only the
      mandate section differs — one added variable vs `md-to-pdf-ponytail`.
-->
