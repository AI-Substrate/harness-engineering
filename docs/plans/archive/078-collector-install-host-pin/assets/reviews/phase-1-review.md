# Phase 1 review — plan 078 (#124)

**Reviewer**: claude-sonnet-5, spawned as `pij-marked-koala` (intended gpt-5.6-terra on
copilot; copilot spawns are currently blocked on an absent github-mcp-server, so this
review shares a model family with the coder — compensated for by running the claims
mechanically rather than reasoning about them; see the methodology note at the end).
**Commit reviewed**: `ab078ece` · **Branch**: `s078/collector-install-pin` · **PR**: #125
(CI green at review time — `rename-guard`, `build-test (22)`, `build-test (24)`,
`package-smoke`, `ci-required` all SUCCESS).

## Verdict: APPROVE

No defect found. Every claim I could mechanically re-run, I re-ran, and all of them
reproduced exactly as stated. What follows is ranked by the brief's own priority order.

## 1. The deleted test — is anything now unchecked that the digest doesn't cover?

**Clean. No security regression.**

Read `download.ts` in full. The SHA-256 check is unconditional: it runs on every code
path, on bytes read back off disk, *before* the rename, regardless of which host served
the response. There is no branch anywhere that skips or weakens it based on the final
URL. `hostOf()`, `expectHost`, the redirect-refusal branch, and the `'redirect'` failure
reason are gone from `download.ts`, `install.ts`, `pin.ts`, and `regenerate.ts` — I
grepped the whole `collector/` src tree and the whole repo outside `docs/plans/078*` for
`release_host`, `expectHost`, and `hostOf`; the only surviving hits are the new
`toContain`/`not.toContain` assertions in `regenerate.test.ts`. No orphaned optional
param, no dead branch, no stale type field (`CollectorPin = typeof GITAI_PIN`, so the
type follows the value — nothing to fall out of sync).

I also read `node-download.ts`: redirects are followed manually, capped at 5, no
Authorization/cookie headers are ever sent (a redirect-to-attacker-host header leak
doesn't apply here — there's no auth to leak), and the pre-078 host guard fired *after*
the request had already completed, so removing it changes nothing about which network
requests are made — only whether a legitimate result is now accepted. The only way a
redirect "leads somewhere harmful and the digest doesn't save us" is a SHA-256 preimage
attack, which is out of scope for a pinned-hash design by definition.

**Verdict: the digest was always the real control, dropping the host check does not
weaken it, and I confirmed this by reading the unconditional code path rather than
trusting the comment that says so.**

## 2. The AC flip — audited cold, one by one

| AC | Claim | My check | Result |
|---|---|---|---|
| ac-0001 | Host pin removed at all 3(→4) sites, no orphan in generated manifest | Grepped repo-wide for the three symbol names; ran `regenerate.test.ts`'s `leaves NO orphan release_host` test | **Supported** |
| ac-0002 | A test fakes the real CDN redirect and asserts success — "load-bearing", claimed RED against unfixed code | Reconstructed the pre-fix `download.ts`/`pin.ts`/`install.ts` from `ab078ece^`, ran the new test against them | **Supported — reproduced byte-for-byte**, see below |
| ac-0003 | Bad digest still refused after a redirect to the real CDN host | Ran the test; read the code path — digest check is unconditional | **Supported** |
| ac-0004 | Field-list test can't self-heal; byte-for-byte test can | Ran the two-step mutation myself | **Supported — reproduced exactly**, see below |
| ac-0005 | Boundary honestly stated, not "install works" | Cross-checked the 4 named gaps against `install.test.ts` (32 existing fake-driven `installCollector` tests, confirming "fake-only" is accurate, not an excuse) and the PR body (identical wording) | **Supported, with one nuance below** |

None of the five is checked on evidence that doesn't support it. ac-0005 is the one
worth a second look because it's the PM's own wording being self-graded, and it holds:
"the boundary is stated" is a true statement about what execution.log.md and the PR body
say, and I could not find a step that was skipped *and* left unnamed.

**ac-0002, independently reproduced:** I copied `ab078ece^`'s `download.ts`, `pin.ts`,
`install.ts` back into place, restored `expectHost: 'github.com'` in the test's
`request()` helper (removed in the same commit), and ran only the new positive test:

```
AssertionError: expected { ok: false, reason: 'redirect', …(1) } to match object { ok: true, …(3) }
```

That is character-for-character the error quoted in `tasks.dd.md`'s tk-0001 receipt. Not
"plausible" — reproduced.

**ac-0004, independently reproduced (brief item 3):** dropped `expect_schema_version`
from `renderPinSource` only → both the byte-for-byte test and the new named test go red
(3 failures, `npx vitest run regenerate.test.ts`). Then also dropped it from `pin.ts`
(simulating a regenerator re-run) → the byte-for-byte test goes **green**, the named
test stays **red**. Exactly the claimed self-heal. Reverted both files; `git diff
--stat` confirmed byte-identical to HEAD before re-running the full suite (252/252, 10
files — matches the execution log and PR body exactly).

## 3. The self-heal mutation

Covered above under ac-0004 — done as a live mutation, not read as a log entry.

## 4. Is the unverified column complete?

I looked for a fifth gap along three angles and didn't find one that clears "real
defect, not polish":

- **Digest provenance for the other 5 platforms** (only checked against `curl -sI`
  redirect behavior + internal manifest consistency, never against an independent source
  like git-ai's own `SHA256SUMS`) — this is real, but it predates plan 078 (pin.ts's
  digests came from plan 073) and is already subsumed by "5 of 6 platforms not installed
  end-to-end."
- **The live proof called `downloadAndVerify` directly, not through
  `resolveArtifact()`/`installCollector()`** — so the platform-artifact-selection wiring
  wasn't part of the live proof either. This is a legitimate sharpening of "the
  command's own orchestration never ran," but it's already inside that named gap, not a
  new one.
- **No CI job re-verifies the live GitHub redirect on a schedule**, so a future GitHub
  CDN rename would silently reopen #124 with nothing catching it until someone runs
  `doctor --install-collector` for real. This is process, not a control that fails
  silently on the code that's actually in this diff — closer to a good follow-up than a
  finding against this PR.

None of these change my verdict; I'm naming them so "I looked and didn't find a fifth"
is a checked claim, not an assumed one.

## 5. Anything asserted more confidently than measured?

Cross-checked PR #125's body against `execution.log.md` line by line — they say the same
things in the same register (live vs. fake vs. unverified is not blurred in either).
`just checks`/CI claims match the live GitHub Actions status. The "252 passed / 10
files" figure is exact, re-run twice by me, matching before and after my own mutation
experiments. `tsc --noEmit` is clean. I found no place where the prose oversells what
was actually run.

## Methodology note

Per the PM's message: I was meant to be a different model family from the opus-5 coder
(gpt-5.6-terra on copilot), and copilot spawns are currently broken, so this review runs
on the same model family as the code under review — a real reduction in independence.
I compensated by treating every checkable claim in the brief, the log, and the PR body
as something to re-run rather than re-read: reconstructed the pre-fix source from git
history and reproduced the ac-0002 failure verbatim, ran the ac-0004 mutation live in
both steps, re-ran the full suite three times across the experiments, and grepped for
orphaned symbols rather than trusting the removal was complete. Every reconstruction was
reverted and confirmed byte-identical to `ab078ece` via `git diff --stat` before the
next step and before writing this review.
