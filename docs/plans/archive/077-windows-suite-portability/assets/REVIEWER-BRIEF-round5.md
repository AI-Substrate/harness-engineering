# Reviewer brief — plan 077, round five (#108)

**PM**: `pij-respectable-clam` · **Coders**: `pij-exuberant-skaffen`, `pij-nasty-mosquito` · **You**: terra

## Scope — two commits, two authors, disjoint files

- **Worktree**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability`
- **`80033379`** (skaffen) — `test/services/flow/flow-renderer.test.ts` only
- **`5a8e8f5b`** (mosquito) — six files: `src/services/dd/render/refresh.ts` + five tests
- Branch `s077/suite-portability`, clean at `5a8e8f5b`, **NOT PUSHED**. Do not fix, do not push.
- `node harness/cli/bin/harness.js`. Never `just link`.

**Both coders are still live** so each can take its own failures. Route anything you find
to me and I will hand it to the right one.

**Save yourself 200 lines:** `exec-remote-telemetry-git.int.test.ts` looks like a ~200-line
change and is not. `git diff -w` gives **61 insertions / 3 deletions** — I verified this.
The rest is biome re-indenting an untouched body one level deeper because
`it.skipIf(FLAG)(` plus a 92-char name exceeds 100 cols.

## The standing constraint

**Nobody here has a Windows box.** The goal this round changed to *their fork must go
green on Windows*, so every disposition is **expected, unverified** until they re-run. The
highest-value finding remains **any place a win32 outcome is stated more confidently than
it was measured**.

## Where I want your skepticism, ranked

**1. SKAFFEN'S BUDGET NUMBER — 120s is DERIVED, not measured, and it said so.**
The sentinel was resolved as a **test timeout on a test that SUCCEEDED**: `execFileSync`
blocks the event loop so vitest's timer cannot fire, the body completes, and a post-hoc
elapsed check fails it retroactively. Reproduced on macOS, nine frames matching the
consumer's paste at identical line:col.

120s = 2 × their worst observed spawn (27.5s) plus room. **Attack whether the mitigation
carries the uncertainty**: at ≥50% consumed it writes a stderr warning while still
passing, so the number is meant to be *self-reporting* rather than right. Does it actually
do that, and does a reader learn the margin is shrinking before it goes red?

Note I **reversed my own round-two ruling** to allow this — then, we refused to raise a
ceiling for *unmeasured* work; now the work is measured at 1.09× of a 30s cap. That
distinction is supposed to be stated at the raise site. **Check it is**, or the next reader
sees a ceiling raised twice and correctly distrusts it.

**2. THE RETRY — it was a timeout generator, and the fix must not have quietly killed it.**
A second spawn spent the *same* 30s budget, so at ~25s/spawn a retry guaranteed the
failure it was meant to prevent. Skaffen reports four fault-injected proofs including
**proof D: the retry still fires when budget is ample**. Verify D specifically — fixing the
skip case by removing the retry is the cheap version that passes a careless review.

**3. MOSQUITO'S PRODUCT FIX (`refresh.ts`) AND ITS OWN SOFTEST CLAIM.**
`referencesTarget` normalised its left side and compared against a raw watcher-supplied
path → **silent false** on win32, so nothing throws and the consumer's markdown just goes
stale. It is **latent**: no production callers today (module header says "library support
only"), only the test's own lambda.

Its stated limit: *"I proved the predicate returns false and that my fix flips it. I have
NOT proved it is the only thing failing in that case."* The same test then calls
`autoRegenerateSibling` → `renderDocument`/`isWithin`/schema resolver, and it traced the
resolver **by reading, not running**. **That is the gap to probe.**

**4. THE DECLARED SKIP — is it scoped and is the declaration honest?**
One case in `exec-remote-telemetry-git.int.test.ts`, win32 only. Confirm it names what
goes unproven (Git selecting only the URL-scope-matching helper; the matching helper's
secret absent from the sanitized config), says Linux CI proves both, and labels the
mechanism expected/unverified. **Never a whole file to silence a subset.**

**5. A CORRECTION I MADE THAT YOU SHOULD CHECK.**
I wrote into mosquito's brief that `acts/plan` was *"the one I expect to be a REAL PRODUCT
BUG"*. **It refused that and I accept the refusal** — `resolveInRepo` returns `C:/out`
unchanged and is correct on both platforms. If mosquito is wrong and I was right, that is a
finding; a supervisor's prediction that gets deferred to is exactly the thing nobody
re-audits.

Also verify the second defect it found: on a writable drive root that test **created a real
`C:\out` outside the sandbox**, and the fix now asserts the document landed in tmpdir and
that nothing appeared under the repo — a filesystem claim where it was a string claim.

## Known and deliberate — do not re-report

- `accepts the exact helper… 64-entry boundaries` — untouched by design; passes locally,
  consistent with skaffen's timeout mechanism.
- The `~1137` negative assertion is green **for the wrong reason** on win32 (no `!`-helper
  launches at all). Recorded, deliberately not fixed.
- Baseline degradations: `arch-check` 2, `markdown-lint` 210, `windows-check` 6. Report only
  if these commits **added** to them.
- `#129`, `#130`, `pij#215`, the upstream vitest bug: filed/out of scope.

## Bar for a finding

A real defect, a control that does not fail when it should, or a claim outrunning its
evidence. Not polish. If it is clean, say so plainly.

## Deliverable

Append to `assets/reviews/phase-5-review.md`, then `pij send pij-respectable-clam`
**APPROVE** or **CHANGES** with findings ranked, and say which coder each finding belongs to.

> ⚠️ **BASELINE CORRECTION (2026-08-09):** the `markdown-lint 210` above is stale — the
> branch measured **211** (195 lint / 15 links / 1 mermaid) even on the three-check gate, and
> `6a43fd4d` on main adds a fourth check that will move it again at merge. **Derive it, do not
> quote it:** `harness markdown-lint --json | jq '.data.checks[] | {name, outcome, findings, examined}'`.
> Full reasoning and the three-state attribution table: [`BASELINE-CORRECTION-markdown-lint.md`](./BASELINE-CORRECTION-markdown-lint.md)
