# Coder brief — plan 077, round two review fixes (#108)

**PM**: `pij-respectable-clam` · **Reviewer**: `pij-rolling-mammal` (terra @ xhigh) · **Verdict**: CHANGES

Read `assets/reviews/phase-3-review.md` first. Three findings, all P1–P3, all the same
shape: **a claim outran its evidence**. None is a code defect. Terra confirmed the code.

## The headline: you were right to flag your own softest claim, and it was wrong

You wrote the absence as *"I could not find one"* rather than *"there is none"*, and asked
for it not to harden. Terra ran the instrumentation you did not, and **the absence is
false — not merely unverified**. A read-only `node:child_process` preload observed:

- `spawnSync('git', …)` from `readIngress()` → `ExecGitAttribution.globalTrace2Target()`
- `spawnSync('which', …)` from `checkToolchain()` — **`where` on Windows**
  (`adapters/process/node-process.ts:5-11`)

**I verified the cause at source**: `acts/doctor.ts` `runReport()` constructs
`new NodeFs()`, `new ExecGit()`, `new ExecGitAttribution(cwd)` **itself**. Only
`sockets?.probe` is injectable. So a test handing `doctor` fake ports gets **real
adapters anyway** — the fakes are accepted and ignored.

That is why "fully faked deps" read as true and was not. The search boundary was the
test file; the spawn is two layers down in the act.

## The three fixes

**P1 — instrument all five, publish the MEASURED result.**
Run the child-process spy across all five ceiling cases (`app.test.ts` ×4 at
`:382-437`, `update-banner.test.ts` ×1 at `:110-116`). Record what each actually
spawns and how many times. Then report it as a **measured** finding — either a
mechanism with a count, or a measured negative. **Delete every instance of "no
mechanism was found" / "there is no work inside them to remove"** from the execution
log, the task notes, and anywhere else it travels. ac-000c cannot close on a static
absence.

**P2 — the surviving case is UNMEASURED, not ~26s.**
Replace the `~26s` / `~1.15x` figures with: one spawn remains where three were, and
its Windows elapsed time is unmeasured. The derived number invites comparison against
a 30s ceiling as though we had checked, and their own variance was 25.7s–77.8s on
identical repeats.

**P3 — `tk-0201` is `checked` while `ac-000c` is unchecked.**
`plan validate --complete` reports the contradiction. Keep the partial visible: either
leave `tk-0201` open, or split the completed batching work from the unresolved
eight-case outcome. Do not close the outcome to make the task tidy.

## Explicitly NOT in this round — do not fix it

**Do not fix `doctor` ignoring its injected ports.** It is a real product smell and it
is the most interesting thing round two found, but it is a new item and the consumer
ranks the work. **Measure it, name it, let them rank it.** Fixing it here would be us
choosing our own priority in a round we agreed to scope to theirs.

## Bar

Terra confirmed the code is right: FakeFs control seeds win32 keys and checks copied
content, the Mermaid batch preserves all three properties (`fencesUnder()` rejects an
empty slice, so a vacuous assertion is not possible), 139/139 on the changed suites,
and no native Windows result was inferred from local success. **This round is
corrections to claims, not to code** — resist rewriting anything terra confirmed.

Commit with explicit pathspecs. Never `git add -A`. Never `git stash`. Do not push.
Report back with the measured P1 result — that is the one I need before the consumer
prompt can go out.
