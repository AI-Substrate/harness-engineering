---
schema_version: "1.2"
retro_id: "2026-08-09T19:31:56Z-agent-082p23"
agent: agent
plan_id: 082-harness-hooks
started_at: "2026-08-09T14:37:09.543Z"
ended_at: "2026-08-09T19:31:56Z"
summary: "retro --drain session-end save (7 entries) — plan 082 phases 2 and 3, the installer and the live install"
entries:
  - id: DL-001
    kind: difficulty
    target: project-sensor
    severity: degrading
    disposition: fixed-now
    description: >-
      A provocation row that asserts only kind==='silent' passes when its own setup silently
      failed — gitTry swallows a non-zero git exit, POST sees HEAD unchanged, and the row
      reports silent/head-unchanged for the WRONG reason. Six real-git rows shared the shape.
    suggested_encoding: >-
      Assert the intended HEAD transition as a postcondition BEFORE asserting silence, and
      assert the expected REASON rather than the outcome kind alone.
    system:
      compound:
        status: encoded
        resolved_by: "4996cbbc — all 19 silent rows carry verify(prev) + expected reason"
  - id: DL-002
    kind: difficulty
    target: harness-itself
    severity: annoying
    disposition: task
    description: >-
      harness dd addressing for done_when cost five failed attempts. Rows are keyed by TASK
      then row (done_when/tk-XXXX/dw-XXXX), but E450 for the wrong shape says only "carries no
      dw-XXXX" without naming the parent key it DOES carry, and its next_action points at a
      command that repeats the same message.
    suggested_encoding: >-
      E450 names the parent key the container actually carries, so the message itself shows the
      correct nesting. This IS the harness repo, so it is a local source fix.
    system:
      compound:
        status: open
  - id: DL-003
    kind: difficulty
    target: project-sensor
    severity: degrading
    disposition: kept
    description: >-
      backupAgentConfigs shipped in the #108 doctor work with ZERO test coverage — verified at
      the branch point, not the current tree. It writes into a user's home directory and is the
      restore path an uninstall depends on. Discovered only because plan 082 widened it.
    suggested_encoding: >-
      A coverage floor for modules that WRITE outside the repo. The general lesson is the
      transferable half: a shipped feature can carry zero regression coverage and nothing
      anywhere says so until someone touches the file.
    system:
      compound:
        status: open
  - id: DL-004
    kind: difficulty
    target: tooling
    severity: annoying
    disposition: kept
    description: >-
      npm ci runs a prepare script that regenerates docs from harness-foundations/ and
      AGENTS_README.md, so those directories are BUILD INPUTS. A partial tree copy fails with
      "gen-docs: sourcePath ... not found" rather than an obviously-missing-input error.
    suggested_encoding: >-
      Make gen-docs name which input is missing and that it is a build input, or skip cleanly
      when its sources are absent.
    system:
      compound:
        status: open
  - id: DL-005
    kind: difficulty
    target: tooling
    severity: blocking
    disposition: task
    description: >-
      Six pij spawns wedged as DEGRADED / never-bound across two harnesses, two cwds and two
      models. Root cause was PANE GEOMETRY: every failure was a 26x5 pane split into a crowded
      window; every success used --layout window (80x23). The agent UI renders fully in a 26x5
      pane with no session behind it, so a spawn that cannot possibly work reports success.
    workaround: "--layout window"
    suggested_encoding: >-
      Refuse the split when the resulting pane would fall below a usable geometry, or fall back
      to --layout window; and name the pane geometry in the DEGRADED message. Filed upstream as
      pij #259 (second presentation) with #265 rescoped.
    system:
      compound:
        status: suggested
        resolved_by: "pij #259"
  - id: DL-006
    kind: difficulty
    target: project-sensor
    severity: blocking
    disposition: fixed-now
    description: >-
      A test escaped its fence and installed hooks into the REAL home, contaminating seven agent
      configs and creating a file — four times over, because the row sits in the FAST scope so
      every gate run reinfected the machine. CI passed the same commit green: a runner's home is
      disposable, so machine-wide writes succeed harmlessly there.
    workaround: >-
      Recovered byte-identical from an out-of-repo snapshot taken before any work began, plus an
      independent pre-step baseline that caught the drift.
    suggested_encoding: >-
      A guard asserting no test resolves a home outside its injected deps — asserted BOTH
      directions, since "nothing written outside the fence" is satisfied by an install that never
      ran. Generally: for any path that writes outside the repo, CI green is not evidence.
    system:
      compound:
        status: encoded
        resolved_by: "5c5e7636 — doctor composes hooks from the injected collector deps; guard RED on revert"
  - id: INS-001
    kind: insight
    target: tooling
    severity: degrading
    disposition: kept
    description: >-
      THREE measuring instruments failed tonight before any code did, and all three reported
      confidently: a digest comparison that lost `cut` from PATH and printed MOVED for all seven
      files; a baseline parser that mis-read "digest  N bytes  path" and printed six-for-six
      MISMATCH; and a mutation harness that printed "!!! SURVIVED !!!" with "Tests 2 failed"
      directly beneath it. In every case the tell was STRUCTURAL, not textual.
    suggested_encoding: >-
      A verification script must FAIL LOUDLY on an unparsed line or a missing tool rather than
      continue with an empty value — a broken instrument must refuse, not report. A mutation
      harness must assert its own preconditions (anchor matched, build succeeded, source
      restored) before emitting any verdict.
    system:
      compound:
        status: open
system:
  compound:
    bubble_action: "all-save"
---

# Retro — plan 082 phases 2 and 3 (the installer, and the live install)

Seven entries. Two are already encoded, one is filed upstream, four remain open.

**The night's defining event is DL-006**, and its shape is worth more than its fix. A test
reached the real home because plan 077 had fixed the identical bug with *two* protections — an
opt-in flag and an injection seam — and only the flag is visible in the function signature. A
competent reader satisfied the visible half. That is a property of the guard, not of the reader,
and the same thing happened to the orchestrator within the hour: verifying a `restore` verb by
finding `restore` in a list where `uninstall` was missing four lines up.

**A guard whose two halves are not both visible at the point of use will be half-satisfied by a
competent person in a hurry.**

**DL-006's second half is the one that generalises beyond this plan.** CI passed the offending
commit green, and would have passed every one of the four reinfecting runs, because a hosted
runner's home directory is disposable. The classes a CI runner is structurally blind to —
machine state, elevation, contention — are exactly the ones an installer lives in. The only
instrument that saw it was someone hashing live files on the actual box.

**INS-001 is the quiet result.** Three instruments failed before any code did, each producing
well-formatted, plausible, confident output. None was caught by reading the output; all three
were caught because the *shape* was implausible — seven-for-seven moving, six-for-six
mismatching, a mutation surviving a suite that reports two failures. One was caught only because
a peer had described their identical failure twenty minutes earlier. The verification layer got
no more scrutiny than the code, and it should have got more.

**The win beat.** Two cross-model reviews each found a confirmed HIGH that the entire in-context
chain had walked past — one of them a verb that did not exist while its task sat checked. And the
`uninstall` verb, argued over at length before it was built, performed a real recovery on a real
machine four hours later, deleting a file it had created and leaving git-ai's entries untouched.
It is the only thing in this plan that was exercised on damage it did not manufacture.

---

## Addendum — the verification exchange, and the rule that came out of it

The `done` on this work was challenged, and the challenge was right: a done is a claim until
verified. What followed is the most useful thing in this record.

**The platform refused self-verification twice, on two different grounds.** `pij report verify`
refused me (`cannot verify its own done claim`) and refused the PA that gathered the evidence
(`state-verify is not available to a PA — it is testimony`). Two gates, one principle, both
enforced mechanically rather than by anyone remembering to behave well.

**Six of my measuring instruments failed across the session, and the verifier's five failed too.**
Mine were the dangerous kind: one instrument, one confident number, nothing to contradict it —
a digest comparison that lost `cut` from PATH and reported all seven files moved; a baseline
parser that mis-read its own input; a mutation harness that printed `!!! SURVIVED !!!` with
"Tests 2 failed" directly beneath. Each was caught only because the *shape* was implausible.

The verifier's five failed differently: they disagreed with each other, which is self-refuting in
a way one wrong answer never is. It stopped and asked for the predicate instead of reporting a
26-versus-36 discrepancy that was never real.

**Then both of us got the cause wrong.** I claimed the rendered markdown omits rows whose titles
wrap. It omits nothing. The verifier claimed its line anchor was at fault. All 36 rows are
line-anchored. The actual cause was one character class: `tk-\d+` against **hex** ids, so
`tk-000a` onward were invisible — which predicts 9 + 11 + 6 = 26 exactly, including phase-2
recovering to 11 because `tk-0010`/`tk-0011` are all-digits again.

> A true cause does not merely fit the observation, it **regenerates** it — including the parts
> you were not trying to explain.

### The rule worth keeping

The verifier's protection was luck, and it said so: five probes disagreed because they were five
guesses at a schema it did not know. Somebody who knew the format would have written one probe,
got 26, and shipped it.

> **Running the same instrument twice is not a second measurement.** When a count matters, derive
> it two different ways *on purpose* — from the source and from the render, by id and by state —
> and treat agreement as informative only because the routes were chosen to fail differently.

That is the same lesson as the drift-versus-corroboration correction earlier in this plan (two
tables descending from one source raid agreeing proves they have not drifted, not that either is
right), arriving at the level of the instruments rather than the data.

**And the outcome that mattered:** the false claim reached nothing durable, because the predicate
was handed over rather than the conclusion. It was refutable in one command. Both of us were wrong
about the cause and neither error survived the hour.
