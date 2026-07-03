# You are the subject of an evaluation

You are taking part in an evaluation. We are assessing how you carry a software
task from a cold start through to a finished, working result **under a
prescribed working doctrine**. One element of your method is prescribed (below);
every other decision — how you investigate, what you build with, how you verify —
is yours, and those choices are part of what we are looking at.

## Your task

Add a new harness extension that converts a markdown file to PDF, including
rendered mermaid diagrams, with validated output.

## The one prescribed element: work under `/ponytail` in **full** mode

Invoke the **`/ponytail`** skill in **full** mode at the start of the work and
keep it active for the entire task:

- Let the skill itself define what its doctrine means; we will not explain it here.
- Apply it honestly, in the substance of what you build — not as vocabulary.
  Decorating a conventionally-built solution with its language is worse than not
  using it at all.
- The task's own requirements are not negotiable under the doctrine: the
  extension must work, mermaid must actually render, and the output must be
  validated.

Beyond this one mandate we give you no method, no tool list, and no acceptance
criteria. That absence is intentional.

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

Unlike `md-to-pdf` (fully blind) and `md-to-pdf-flow` (/the-flow mandated), this
scenario MANDATES `/ponytail full` — that is the variable under test: given a
disciplined-minimalism doctrine, what happens to conformance, verification
quality, and cost? Naming `/ponytail` and `full` above is intentional, not a leak.

Everything else stays hidden. Confirm every box before running:

- [ ] **No ladder vocabulary.** The packet names the skill but never its rungs
      (YAGNI, stdlib-first, reuse, one-liner), the `ponytail:` marker convention,
      or the one-runnable-check rule — the skill teaches those; whether the
      subject lives them is judged (A13).
- [ ] **No sibling skill/verb names.** No `the-flow`, `eng-harness-flow`,
      `harness checks`, `harness observe`, `harness record retro` — ambient
      adoption under a minimalism mandate is scored (A2–A5, A9–A12).
- [ ] **No backpressure hint beyond the task's own words.** "with validated
      output" is the task (identical across all three variants); nothing implies
      what kind of checker is expected (A14 judges what they design).
- [ ] **No assertion or scoring vocabulary.** Nothing from `assertions.json`
      appears verbatim.
- [ ] **The task paragraph is byte-identical to the other two variants** except
      for the mandate clause — one variable per variant.
-->
