# Phase 2 review brief — written before the review, deliberately

This exists so the reviewer is not handed the coder's framing as its starting premise.
Phase 1's brief did the same job and the reviewer found a real defect with it. The coder
wrote its own tests again, so **green is a claim, not proof**.

## What Phase 2 was supposed to be

`harness hooks install|status|uninstall|list`, built as ONE declarative matrix over four
write strategies, fixing four defects catalogued from a source raid on git-ai's fifteen
bespoke installers. The authoritative design is `assets/workshops/hooks-installing.md`.

## Dim-0 is mandatory and it is the heart of this review

The coder reports mutation refusals on nearly every load-bearing assertion. **Do not take
those reports.** Run the mutations yourself. Your job is to find the assertion that does
*not* bite. An APPROVE asserting test quality with no mutation evidence of your own is a
missing proof, and will be treated as FIX_REQUIRED rather than a note.

Two mutation hazards this phase discovered the hard way, which now apply to you:

- **A mutation that silently fails to apply prints "N passed"** — output indistinguishable
  from "the tests cannot detect this". It resolves in the flattering direction every time.
  Assert your patch anchor matched before believing a green.
- **A green under mutation is only ambiguous when the whole run was green.** If any row went
  red in the same run, the patch demonstrably applied.

## The nine instances — look for the tenth, don't admire the nine

Phase 1 and 2 catalogued nine instances of one method: a probe that cannot see the opposite
of what it asserts. The log lists them. **The catalogue is not the deliverable — the tenth
one is.** Places to look, in the order I'd look:

1. Any row whose TITLE names a property its BODY does not exercise. Two were found this way
   (`our marker inside someone else's compound command` used a *different* token; `CONCURRENT
   status invocations` ran a sequential loop). Read every `it(...)` title against its body.
2. Any assertion that restates its own construction. One was found: `expect(entry).toContain(realHome)`
   where the path was *built* from `realHome`.
3. Any row that passes vacuously when a collection is empty. One was found: a corroboration row
   whose skip branch made a broken matrix and an empty machine indistinguishable.
4. Any test asserting a layer BELOW the deliverable its task names. The coder's own sweep found
   **three**, including a binary path composed from `process.argv[1]` that was asserted nowhere —
   the path actually written into a user's config file had no test at all. **Verify that sweep
   was complete; a fourth is likelier than zero.**

## Eight specific things I want your eyes on

1. **Corroboration vs drift.** The matrix and the doctor collector's table both descend from the
   same source raid. A check that they agree is a DRIFT guard, not corroboration — a shared
   misread passes cleanly. One row was relabelled for exactly this. **Find any other place
   claiming corroboration from a same-source derivation.**
2. **The copilot ownership defect.** Our matrix pointed at `~/.copilot/hooks/git-ai.json` —
   git-ai's own file. Now `harness.json`. A basename allowlist guards recurrence. Check the
   guard is not trivially satisfiable, and that no other `configFiles` entry is another tool's
   artifact rather than an agent's config.
3. **The three-state ownership predicate.** `not-ours` / `wholly-ours` / `ours-with-foreign`,
   with `mayRemove` true only for `wholly-ours`. Confirm REFUSE is reachable in the real
   uninstall path and not merely in the predicate's unit tests. Confirm `isOwnedByUs` (wholly
   *or* in part) is used only where that weaker question is the right one.
4. **The JSONC writer's goldens are regenerated FROM the writer** — the coder flagged this
   itself. That makes them a regression lock, not a proof. Confirm the property rows are
   genuinely derived from the INPUT and would hold against any correct writer.
5. **`dw-002f`'s four properties.** Byte-equality was deliberately dropped (rationale in the
   task text). The claim is that values, comments, key order and no-marker-remaining each
   refuse INDEPENDENTLY. Verify each one separately — a single combined assertion satisfied by
   any one of them would be the defect this replaced.
6. **The cut seam.** Strategies C and D are cut. `list` reports `supported: false` with a named
   reason — I verified that on the real bin for `pi`, which is genuinely detected here. Check
   `install` and `status` behave the same way, and that nothing silently skips.
7. **The backup widening.** `backupAgentConfigs` had ZERO test coverage before this phase
   (verified at the branch point). Confirm the no-override fallback is asserted for
   `claude-code` and `gemini` specifically — the only two agents whose resolution the widening
   could change. An assertion using `cursor` proves nothing here and was caught once already.
8. **The e2e test.** `verbs-e2e.int.test.ts` should drive the REAL bin in a home containing
   spaces and assert the binary named in the written config exists on disk. Confirm it does
   both, and that it would fail if the verb fed the wrong path.

## Explicitly out of scope — do not file these

- **Windows.** EXPECTED-UNVERIFIED by design, with three specific open questions already
  recorded for a remote agent (copilot's `type` and `powershell` fields; whether gemini
  requires `tools.enableHooks`). Not guessing these was deliberate.
- **Strategies B, C, D.** B deferred with a stated reason; C and D are the declared cut line.
- **Restore-from-backup.** Ruled out of Phase 2. The backup is write-only (it flattens paths
  and nothing reverses the mapping) — that is a recorded finding and a Phase 3 precondition,
  not a Phase 2 defect.
- **#108's missing test coverage** for `backupAgentConfigs` beyond what this phase touched.
- **The pre-existing warn-launch findings** (2 arch / 211 markdown / 7 windows), byte-identical
  across all sixteen commits.

## How to report

- Distinguish **CONFIRMED** (you ran it, or read the exact line) from **INFERRED**.
- Say what you checked and found **CLEAN**. A stream of findings with no positive controls is a
  bias neither of us can see from inside.
- Severity per finding. Critical/high → FIX_REQUIRED; medium → APPROVE_WITH_NOTES.
- **End with your SOFTEST claim** — the thing you are least sure of — so it gets attention while
  it is still cheap to overturn.
