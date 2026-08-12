
# CODER PACKET — `dd-schema-fs.test.ts` has never collected on Windows

**Continuation for `pij-defeated-peacock`** — you built `test/support/symlink-capability.ts`; this
is the fourth site you flagged for it and the reason you flagged it.

**Repo root**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s083-windows-portability`
**Branch**: `s083/windows-portability` @ `3958aa8c`. **DO NOT COMMIT.**

## The state of play

The Windows suite is now **test-green: 0 failing over 6055 collected across 395 files.** But
`Failed Suites: 1` — and it has been 1 on **every run ever taken**, including both original
baselines. **Test-green is not suite-green.** This is the last piece.

```
harness/cli/test/acts/dd-schema-fs.test.ts
  beforeAll → symlinkSync('.', join(loopedRoot, 'loop'))
  → EPERM on unelevated Windows → the WHOLE FILE never collects
```

Its tests are then not passed, not failed, not skipped — **absent**, while every reported number
stays self-consistent. That is why nothing caught it for six runs.

## What to do

Route the `beforeAll` staging through `trySymlink` so **collection never dies**. That is the whole
non-negotiable part: a file that cannot collect reports nothing at all, which is strictly worse
than a file that reports a weaker property.

Then decide, per row, what survives:

- **Row 1** (`returns [] for the two benign cases`) uses `cleanRoot` and **does not need the
  symlink at all**. It should run unconditionally on every host. Confirm that is true rather than
  assuming it.
- **Row 2** (`throws rather than reporting emptiness when the path cannot be read`) builds an
  ELOOP from a 64-deep symlink chain. This is the one needing judgement.

## The constraint that rules out the easy answer

**Do not substitute a fake fs.** This file's own docstring: *"The one suite that must touch the
REAL filesystem: it exists to prove a property of the fs boundary itself (review finding F002),
which no fake can witness."* Replacing the real boundary with a fake would delete the reason the
file exists while leaving a green row behind — the exact defect class this plan has spent all day
removing.

## Your judgement, and I want reasoning rather than compliance

The property is *"'nothing here' and 'could not look' are different answers."* Row 1 already proves
the **`[]` side** (ENOENT, ENOTDIR). Row 2 proves the **throw side**, and needs a genuinely
unreadable real path.

Options worth weighing — **your call, and say why**:

1. **Another real unreadable path that needs no privilege.** If one exists on Windows that reliably
   makes `readdir` throw rather than return `[]`, that is the best outcome: full property, every
   host, no degradation.
2. **A Windows directory junction.** Junctions are creatable **without** elevation, unlike symlinks,
   and a junction loop may produce the same unreadable condition. If that works it is a genuine
   fix; if it does not, say so — do not force it.
3. **Degrade honestly** per the helper's own convention, naming what was not proven via
   `provenLabel`.
4. **Skip** — the helper's doc calls this a last resort *for a case with no weaker property at
   all*, and says that if you reach for it you must say so in the row. **If that is the honest
   answer here, take it and justify it.** An admitted gap beats a manufactured green.

**This file must still collect on macOS and Linux with the full property intact.** Nothing you do
for Windows may weaken the platforms where the ELOOP is real.

## Expect the failure count to RISE, and that is the point

This file has **never run on Windows**. Once it collects, it may carry failures nobody has ever
seen. **That is a gain, not a regression** — do not tune anything to keep a number down, and do not
treat a new red as your fix failing. Report what appears.

If you find product defects that only surface now, **report them; do not fix them in this commit** —
they are a separate change with a separate measurement.

## Allowed paths

`harness/cli/test/acts/dd-schema-fs.test.ts` · `harness/cli/test/support/symlink-capability.ts`
(if the helper needs an addition — say what and why).

## Forbidden

`src/**` · `docs/plans/**` · `.github/workflows/**` · `government/**` · the-flow state files.

## Done-report

Outcome · what each row does on a host without symlink privilege · **whether the file now
collects** · verification (you can simulate: force `SYMLINK_CAPABLE` false and confirm collection
survives) · revert proof · anything found and not fixed.
