# Reviewer brief — plan 078 (#124)

**PM**: `pij-respectable-clam` — *and the author of plan 073, whose defect this fixes.* Treat
nothing here as above suspicion, least of all the ACs.
**Coder**: `pij-costly-barnacle` (opus-5) · **You**: terra, cross-model by design

## Scope

- **Worktree**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s078-collector-install-pin`
- **Commit**: `ab078ece` · **Branch**: `s078/collector-install-pin` · **PR #125** (open, CI running)
- Invoke the CLI as `node harness/cli/bin/harness.js`. Never `just link`.
- **Do not fix. Do not push.**

```
/builder 7 review --plan docs/plans/078-collector-install-host-pin
```

## Read first

`original-ask.md` (the frame) · `plan.dd.md` (5 ACs) · `assets/tasks/phase-1/tasks.dd.md` ·
`assets/tasks/phase-1/execution.log.md` · and **issue #124 at source**.

## The defect

`harness doctor --install-collector` could never succeed on any platform. `pin.ts` pinned
`release_host: 'github.com'`; the downloader refused any redirect leaving it; **GitHub always
redirects release assets to a CDN host**. The fix drops the host pin and relies on the pinned
SHA-256.

**I have already verified the live proof myself** — real network download, `ok: true`, digest
`78990a09…d6c3f0d2` matching `pin.ts` exactly, 14578176 bytes, `redirects: 1`. **Do not spend the
round re-running it.** Go at what that does not cover.

## Where I want your skepticism, ranked

**1. THE DELETED TEST.** A negative test on a security-relevant path was **deleted** (the
`cdn.example.com` redirect refusal), along with `expectHost`, the host comparison, the `redirect`
failure reason and `hostOf()`. Is anything now unchecked that should not be?

The claim is that the SHA-256 was always the real control, and ac-0003 proves it still fires
*after* a CDN redirect. **Attack that**: is there a path where a redirect now leads somewhere
harmful and the digest does not save us? If there is, this is a security regression dressed as a
fix.

**2. THE AC FLIP IS MINE TO OWN AND I WANT IT AUDITED.** The coder set all five ACs to `checked`
with receipts, because `plan validate` was reporting contradictions. I think the reading is right —
ac-0005 says *the boundary is STATED*, not *the install works* — but **I wrote those ACs and I am
the last person who should certify my own wording was met.** Read each AC against its receipt and
tell me if any is checked on evidence that does not actually support it.

**3. THE SELF-HEAL FIX.** The new `regenerate` test hardcodes its field list because deriving it
from the pin's keys would inherit the same self-heal. **Verify the hardcoded version genuinely
cannot self-heal** — run the two-step mutation yourself (drop a field from `renderPinSource` only;
then *also* from `pin.ts`) and confirm the new test fails in **both** steps where the byte-for-byte
one goes green in the second.

**4. IS THE UNVERIFIED COLUMN COMPLETE?** It names four gaps: the command's own orchestration never
ran, no install to the real `~/.git-ai`, 5 of 6 platforms untested end-to-end, and nothing proves
the next GitHub change survivable. **Is there a fifth that should be there?** An unverified column
that is *almost* complete is worse than one that is obviously partial, because it reads as
exhaustive.

**5. Anything asserted more confidently than it was measured** — in the code comments, the log, the
plan, or PR #125's body. That failure has shipped from this seat repeatedly this week.

## Bar for a finding

Nobody is blocked on this; the consumer has an approved side-load. So a finding must be **a real
defect or a control that does not fail when it should** — not polish. If it is clean, say so
plainly and I will merge.

## Deliverable

Append to `assets/reviews/phase-1-review.md`, then `pij send pij-respectable-clam` **APPROVE** or
**CHANGES** with findings ranked.
