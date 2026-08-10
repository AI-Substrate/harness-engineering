# Phase 4 — `harness validate-attribution`

The scoring procedure the team ran by hand all evening, turned into a verb.

Phase 4 was not in the original plan. It exists because runs 9 and 10 established that the
procedure *works* and simultaneously showed how easily it is misread — twice, in ten minutes, by two
people who had both read the source documents. The verb is the response to the second half of that.

---

## What was built

| artifact | what it is |
|---|---|
| `.harness/extensions/validate-attribution/scoring.ts` | **Pure.** No I/O, no imports. Every verdict rule. |
| `.harness/extensions/validate-attribution/extension.ts` | The I/O shell: census, journal, probe, note, `--begin`/`--end`. |
| `.harness/extensions/validate-attribution/fixtures.ts` | The two real control runs as recorded evidence, provenance named field by field. |
| `.harness/extensions/validate-attribution/scoring.test.ts` | 24 rows. The controls, the gates, the ordering. |
| `.harness/extensions/validate-attribution/extension.test.ts` | 25 rows. Classification, parsing, the delivered surface. |
| `.harness/extensions/validate-attribution/README.md` | The operator's document — a deliverable, not a courtesy. |

Shipped in `a834a88c`. The record it supersedes was corrected first, in `589335c0`.

### The shape: two phases, because one step cannot be automated

The agent has to actually run, and the connectivity probe has to execute **inside its sandbox**.

```text
--begin   baseline · relay census · binary identity · emits the probe · prints the prompt
             … the human pastes the prompt into their agent …
--end     journal delta · probe result · note identity · verdict
```

### The three rules it encodes

1. **REPORT AND REFUSE, NEVER ACT.** A second commit-signal relay invalidates a run; it is not
   something to delete on the operator's behalf. The verb names what it found and declines to
   certify. It never edits a config or a sandbox setting.
2. **INCONCLUSIVE IS FIRST-CLASS.** A well-executed non-experiment is the normal outcome of a
   careful first attempt. A scorer that cannot say INCONCLUSIVE reports a confounded run as a PASS —
   which is what nearly happened on run 9.
3. **SCORE ON IDENTITY, NEVER ON COUNT.** Path, line range and actor kind, cross-checked against
   ground truth written down *before* the note is read. The ref is `refs/notes/ai`, baked in:
   `--ref=git-ai` prints nothing and "no note" is the total-loss signature, so the wrong ref invents
   a false negative indistinguishable from the failure being hunted.

---

## The controls are the evidence

`scoring.ts` is pure so both real runs can be replayed from recorded evidence:

| control | verdict | why |
|---|---|---|
| run 9 (`1cbdf0de`) | **INCONCLUSIVE** | two channel-2 relays; either could have caused the note |
| run 10 (`5ac3eaa`) | **PASS** | one relay, sandbox engaged, we emitted, note identity matched |

**Pinned as a DISCRIMINATOR, not as two verdicts.** One row drops the POC relay from run 9's own
evidence and asserts it becomes PASS; another adds it to run 10 and asserts INCONCLUSIVE. Without
those, the pair could have been passing for a reason nobody had identified.

`RUN_10_WITHOUT_PROBE` pins the precondition gate: strip run 10's shell-side probe, change nothing
else, and the PASS falls to INCONCLUSIVE.

**Four mutations, four RED**, one of them worth naming: moving the INCONCLUSIVE gates *after* the
note check fails five rows. The ordering is the design — asking "did the note appear?" of a
confounded run produces an answer that means nothing, and printing it is how a non-experiment becomes
a result.

---

## The two misreadings, recorded because they are why the verb exists

A close that lists only outcomes teaches nothing. Both of these were made while reviewing run 10, by
someone who had read the two-channel model that afternoon.

**One — proving a relay RAN is not proving a commit signal was SENT.** `git-ai checkpoint`
demonstrably ran during both runs; `checkpoints.jsonl` can only be written by it. The conclusion
drawn was "both runs are confounded". But `git-ai checkpoint` is **channel 1** — it records what the
agent wrote and cannot produce a note on its own. The relay removed between the runs was channel 2.
The evidence was correct and the conclusion was wrong, and the two are one grep apart.

**Two — an instrument read correctly, in the wrong context.** `/tmp/hook-probe.log` shows 130 lines
of `control=OK trace2=OK sandbox=unset` across ten hours, not one EPERM. Read as "the sandbox was
never engaged for any run". That log measures the **hook** context, which is **not sandboxed by
design** — a hook-side OK is the *premise* of the relay, since that is where we emit from. The
shell-side probe reported `seatbelt` and `REFUSED` on both sockets for both runs.

**Both are the same failure**, and neither was careless: an instrument read accurately, against the
wrong question. That is why the verb classifies every relay by channel rather than by recognisability,
and why the probe it emits prints `"context": "shell"` on its own face.

**The encode-don't-document move is the `next_action` on the open-socket branch.** It could have been
"be careful which probe you read". Instead, at the exact moment someone would repeat the mistake, the
tool says: *"a HOOK-side probe reporting OK is expected and is NOT this measurement."*

### And the precondition that was measured once

Run 10's PASS was **provisional for twenty minutes**, because its sandbox condition was inferred from
run 9 rather than measured for run 10. Not a wrong measurement — an **un-repeated** one. `--begin`
now obtains the shell-side probe for *this* run and refuses without it. The rule has a real incident
behind it rather than a principle, and the incident belongs to the person who wrote the rule.

---

## Three bugs found by RUNNING it, not by a test

Every one of these passed a green suite first.

0. **A note on all three: each was invisible to a green suite and visible within a minute of running
   the thing.** The fourth, below, was invisible to both and visible only to the gate.

1. **The census counted ENTRIES, not relays.** The first live `--begin` reported four possible
   commit-signal relays where there were two: every config carries a PRE and a POST entry for the
   same relay. A correctly configured machine would have been refused every time anyone tried.
2. **And it still miscounted after that was fixed** — because `--begin` held its **own inline copy**
   of the census predicate and never called the de-duplicating one. Every unit test passed; they were
   all asking the other answer. **Two answers to one question, inside the verb whose entire job is
   counting relays** — the fourth appearance of that class in this plan, after `detectId`,
   `configPathsFor`, and the doctor/hooks home.
3. **The rebuild stamp watched the wrong file.** `bin/harness.js` is a thin launcher whose mtime sat
   at 2026-08-07 while the program it loads was rebuilt four times in one evening. The
   mid-run-rebuild gate could never have fired. It now folds in the package's `dist/` entry.

Each has a row now. The transferable point is that all three were invisible to a suite that was
green, and visible within one minute of running the thing against a real machine.

### And a fourth, caught by the gate rather than by running it

`windows-check` moved **7 → 13** on the first full gate after the extension landed. Four of the six
new findings were mine, and two of them were **real Windows defects**, not lint:

| finding | why it mattered |
|---|---|
| `WIN005` ×2 — a `node -e` shell-out for `homedir()` and for `statSync()` | A builtin import inside an extension violates the constitution — **and the homedir one-liner would have resolved nothing useful on Windows**. `ctx.env.get('USERPROFILE')` was one call away on a port already injected. |
| `WIN004` ×2 — `path.split('/').pop()` | A Windows config carries backslashes, so relay classification and relay identity would both have silently mis-keyed. The relay census — this verb's entire job — would have been wrong on Windows and green everywhere. |
| `WIN002` ×2 — `/tmp` literals in `fixtures.ts` | **Not a defect.** Verbatim command strings recorded off a macOS machine: evidence, never opened. Suppressed with a trailing `// win-ok:` and a note saying why, because a control run whose inputs were tidied is not the run that happened. |

**The `statSync` refusal produced a better design rather than a workaround.** There is no stat
capability on the verb context, so with the shell-out closed off the mid-run-rebuild gate had to be
answered differently: read the bytes through `ctx.fs` and digest them. That needs no builtin, no
shell-out and no platform branch — and it asks the better question, *"is this the same program?"*
rather than *"was this file touched?"*. A gate refusing the easy route is what produced it.

Two further findings were in the doc comments themselves, which quoted the very expressions being
warned about. Those were **rephrased rather than suppressed**: a `// win-ok:` on prose teaches the
next reader that the rule is noisy, when the rule was right and the sentence was lazy.

#### What those two defects would actually have done

Not "lint on Windows". They break the census, which is the one thing this verb exists to get right:

- **`basename` via `split('/')`** on a config full of backslashes computes relay identity from the
  **whole path** instead of the program, so the two entries for one relay stop folding into one. The
  verb would then either **refuse a correctly configured Windows machine forever**, or **certify a
  two-relay one** — and which of those you get cannot be predicted without running it.
- **`HOME` with no `USERPROFILE` fallback.** On Windows `HOME` is routinely unset, so the census
  would resolve an empty home, find **no config files at all**, and report **no relays**. That is a
  **vacuous certification**: the strongest-sounding possible answer, produced by looking nowhere.

**The irony is the point.** The verb built to prevent false certification would itself have been
unreliable on the platform of the person most likely to be its first real user. The Windows agent is
holding on issue #108 and will meet `validate-attribution` through the merge; had these shipped,
their first use of it would have produced a **confident wrong answer** about whether attribution
works on their box.

#### The counts, separately — and the instrument proven

"Back to baseline" is not a measurement, and if four findings are fixed the count **must** move. If it
read 7 again unchanged, that would itself be a finding: either the check does not see these paths, or
the fixes did not land where it looks.

| state | total | in `validate-attribution` |
|---|---|---|
| before the extension existed | **7** | — |
| extension landed (`a834a88c`) | **13** | **6** |
| after the fixes (`099bc96c`) | **7** | **0** |

And the instrument was tested rather than trusted — re-introduce **one** defect (`basename` back to a
single separator) and the count moves, naming the exact line:

```text
after the fixes        total=7  in-validate-attribution=0
one defect restored    total=8  in-validate-attribution=1   WIN004 extension.ts:167
restored               total=7  in-validate-attribution=0
```

So the 7 is genuinely the pre-existing set (`checks/` ×1, `html-snap/` ×6), the six were mine, and
they are gone from the place the check actually looks.

---

## MEASURED vs EXPECTED-UNVERIFIED

| claim | label | evidence |
|---|---|---|
| Both control runs replay to their recorded verdicts | **MEASURED** | `scoring.test.ts`, 24 rows |
| The relay census discriminates run 9 from run 10 | **MEASURED** | drop/add rows, both directions |
| `--begin` works against a live machine config | **MEASURED** | real config: 2 senders → refuses; `--acknowledge hook-probe.py` → 1, certifies |
| `--end` scores a live run end to end | **MEASURED** | driven in a throwaway repo: probe, real fires, real commit, ground truth → **INCONCLUSIVE**, correctly, on an unsandboxed shell |
| The agent-config map agrees with the core | **MEASURED** | fenced HOME, compared against `hooks install --json` |
| **`--end` scores a live SANDBOXED run** | **UNVERIFIED** | needs Jordan's next run |
| Windows | **EXPECTED-UNVERIFIED** | two real Windows defects were found and fixed by `windows-check` (below), but nothing has RUN there; the verb still shells to `python3`, `git` and `git-ai` |

---

## NOT delivered, and known limits

- **`--end` has never scored a live SANDBOXED run.** It has now scored a live *unsandboxed* one and
  correctly refused it, which exercises the whole parsing path — journal delta, probe read, note
  read, verdict — but the PASS branch has only ever been reached from recorded evidence.
- **THE VERB IS AN EXTENSION, AND EXTENSIONS ARE NOT DISCOVERED UPWARD.** Running it from outside a
  repo that has `.harness/extensions/` returns `E149`. It must be run **from the repo root**, with
  `--repo` pointing at the test repository. Met in practice before it was raised in theory.
  - The consequence is the open question: **a consumer who installs the harness cannot run the verb
    that tells them whether the harness's attribution works on their machine.** That is the same
    criterion that made `hooks` a core verb — it validates a MACHINE property, not a repo property.
  - The counter: it is a validation tool rather than a runtime feature, extensions are the sanctioned
    way to add verbs, and promoting it widens the shipped surface late in a plan that has already
    grown twice.
  - **Escalated, not decided.** It changes the shipped surface, so it is the product owner's call.
    Nothing here promotes it.
- **The acknowledgement mechanism is a judgement call.** Anything the census cannot classify counts
  as a *possible* commit signal, and `--acknowledge <substring>` lets the operator declare otherwise.
  Without it the verb refuses every real machine; with a cleverer classifier instead, it would guess
  wrong in the direction that certifies a bad run. The declaration is recorded in the evidence and
  appears in the verdict — visible rather than buried.
- **The agent-config map is duplicated** from the core's agent matrix, because the single-source route
  (`hooks status --json`) calls `journal.compact()` and would rewrite the journal this verb is about
  to baseline. The duplication is measured against the core rather than assumed to agree — but it is
  still duplication, and the correspondence test is the only thing holding it.
- **It scores one commit.** Attribution is known to over-count AI on a **mixed human+AI commit**. This
  verb neither changes nor tests that.

---

## Softest claim

**A PASS from this verb is one agent, one machine, one commit.** It is evidence, not a guarantee, and
it does not transfer to another agent's sandbox without re-running. The verb's real contribution is
narrower and more useful than a PASS: it makes **INCONCLUSIVE** cheap to obtain and impossible to
mistake for a result — which is the failure that produced it.

And the honest one about its own construction: **three of its bugs were found by running it, none by
its tests, and its test suite was green throughout.** The rows exist now, retrofitted. Whatever the
fourth bug of that class is, the suite is currently green on that too.
