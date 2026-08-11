# Coder brief — plan 077, round five: drive the consumer's fork to GREEN (#108)

**PM**: `pij-respectable-clam` · **Worktree**: `s077-suite-portability` · **Branch**: `s077/suite-portability` @ `592abcc4`

## The goal changed. It is now zero.

Previous rounds took their ranking and left the tail alone. **That is over** — Jordan's
call is that their fork must go green on Windows. Not fewer failures. Zero.

**Fix or skip is an explicit, sanctioned choice.** Jordan: *"if tests are not adding value
I am happy to skip them."* A win32 skip with a declared reason is a legitimate outcome
here, and often the honest one.

## Your target — five files, six tests

Measured by the consumer on their fork at `592abcc4`. **They verified 6 of 7 reproduce on
our pristine tree**, so fixing ours fixes theirs.

| file | n | signature |
|---|---:|---|
| `adapters/git/exec-remote-telemetry-git.int.test.ts` | 2 | credential-helper MATCHING — `expected '' to contain 'username=matched-user'`; also "materializes URL scopes without matching them" |
| `acts/plan.test.ts` | 1 | `Cannot read properties of undefined (reading 'folder')` — drive-rooted `--dir` |
| `services/dd/render/refresh.test.ts` | 1 | `expected … to contain '[x] 3/3'` |
| `services/dd/links/map-exemplar.test.ts` | 1 | `expected [] to include '$.sections[meta]…'` |
| `services/telemetry/capture-reconcile*` | 1 | `expected undefined to be 5` |

**NOT yours: `services/flow/flow-renderer.test.ts`.** `pij-exuberant-skaffen` owns that
file this round — do not touch it, do not run mutations in it.

## The rule for deciding fix-vs-skip

**Fix** when Windows is the only place the defect would surface, or when the failure
indicates a real product bug.

**Skip (win32, with a declared reason)** when Linux CI already proves the property, so the
Windows run adds noise rather than signal.

**`acts/plan` is the one I expect to be a REAL PRODUCT BUG.** A drive-rooted `--dir` not
being re-anchored is the same shape as the two genuine defects that opened this issue.
Trace it before you reach for a skip. If it is a product bug, fix the product.

A skip is a declaration that something is unproven on Windows. **Say what is no longer
proven, by name, in the skip's comment** — the way `exec-remote-telemetry-git`'s daemon
cluster does. Never skip a whole file to silence a subset.

## Honesty constraints — these have cost four rounds already

- **Nobody here has a Windows box.** Every win32 outcome is **expected, unverified**.
- Simulated win32 is what we have; label it simulated where you use it.
- **Do not infer a mechanism from a test file and call it settled** — that error produced a
  false absence in round two and a wrong mechanism in the consumer's Q3. Name the caller.
- If you cannot reproduce or diagnose one blind, **say so and propose the skip** rather
  than fixing on a theory.
- Report your own softest claim. That has caught something real in three of four rounds.

## Operational

`node harness/cli/bin/harness.js`. **Never `just link`.** Gate with `just checks`.
Commit `HARNESS_NO_TELEMETRY=1 timeout 30 git commit --no-verify`, explicit pathspecs,
**do not push**. Baseline degradations, do not add to them: `arch-check` 2,
`markdown-lint` 210, `windows-check` 6.

Report the disposition of all six (fix / skip / cannot-tell) before committing.

> ⚠️ **BASELINE CORRECTION (2026-08-09):** the `markdown-lint 210` above is stale — the
> branch measured **211** (195 lint / 15 links / 1 mermaid) even on the three-check gate, and
> `6a43fd4d` on main adds a fourth check that will move it again at merge. **Derive it, do not
> quote it:** `harness markdown-lint --json | jq '.data.checks[] | {name, outcome, findings, examined}'`.
> Full reasoning and the three-state attribution table: [`BASELINE-CORRECTION-markdown-lint.md`](./BASELINE-CORRECTION-markdown-lint.md)
