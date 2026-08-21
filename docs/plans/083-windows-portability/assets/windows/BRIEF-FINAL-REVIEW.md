# FINAL REVIEW — all three Windows streams, together

**Model**: gpt-5.6-sol, **effort max** · **Branch**: `s077/suite-portability` (PR #118)
**You are the last gate before this merges.** Three streams have already been reviewed
individually. **Do not repeat that work** — assume each diff was read in isolation by a competent
reviewer who signed it off. Your job is what none of them could see.

---

## What you are reviewing against

A measurement, not an opinion. `docs/plans/083-windows-portability/assets/windows/vm-082-measurement.md`: on a Windows 11 VM at
`scope=all`, 393 files, 6038 collected — **112 failures**, of which **81 were one product defect**
and **34 genuine**. Also `docs/plans/083-windows-portability/assets/windows/STREAM-CONTEXT.md` for the rules the streams worked under.

| stream | scope |
|---|---|
| S1 product | `GIT_CONFIG_GLOBAL` null device (81 rows, affects `main`) + `docRepoRoot` returning `"."` on Windows |
| S2 paths | 13 path-shaped assertions + the `embedBinaryPath`/`extract` asymmetry beneath them |
| S3 tests | 6 windsurf fake-fs rows + 3 timing rows + the collection-failure denominator hazard |

## The four questions that are yours alone

**1. INTERACTIONS. Three streams assembled incrementally were never seen together.**
Did S2's path normalisation change what S1's repo-root walk now sees? Does S3's fake-fs fix still
model what S2 made the product do? A defect that exists only in the composition is invisible to
every per-stream review by construction, and this plan has already been bitten by exactly that.

**2. DID ANY TEST GET REWRITTEN TO MATCH THE BUG?** This is the highest-value thing you can find.
Thirteen assertions compared a Windows path against a POSIX expectation, and the cheap fix — rewrite
the expectation to whatever Windows printed — yields a test that **passes a revert and fails a
correct fix**. For each changed assertion ask: *would this still fail if the product regressed?*
Where you cannot answer yes, say so and name the assertion. A per-stream reviewer sees one diff;
you can see whether a pattern of accommodation runs through all three.

**3. DOES EACH REMEDY CARRY THE DEFECT CLASS IT FIXED?** Three separate fixes in this plan already
did. The one-line version, from the coder who diagnosed it:

> *A fix is written by someone holding the defect in mind, which is exactly the state in which its
> shape looks like something that could not happen again.*

Read every new error path, fallback and `catch`. A remedy that fails quietly is not a remedy.

**4. WHAT DOES THE GREEN NOT COVER?** Say it explicitly. Known blind spots to check are still
blind: the suite mixes src-importing and dist-executing tests, so a green row means nothing unless
the build is newer than the edit; the Windows VM is not a clean fixture; `dd-schema-fs.test.ts` may
still fail at **collection**, contributing zero rows while every count stays self-consistent.

## Two specific things to check hard

- **S1's null-device fix must not be a second unexamined constant.** `/dev/null` on Windows works
  because git treats a **missing file** as no config — a behaviour, not a device. If the fix
  substitutes one magic value for another, that is the same defect wearing new clothes. And the
  test must exercise the win32 branch **on every platform**, or it will pass by not being run,
  which is precisely how the original constant survived.
- **`main` is affected by the null device, by a different value** (`os.devNull` = `\\.\nul`, not
  `'NUL'`). Check the fix actually covers what `main` does, not only what the branch did.

## What I do not want

No style notes. No praise. No summary of what the streams did — I know. **Findings ranked
most-severe first, each with a concrete failure scenario: inputs or state → wrong output or crash.**
If a finding is a hypothesis rather than something you traced, label it as such. And state plainly
what you did **not** check — an unstated gap is read as a clean bill of health.

If you find nothing, say so and say what would have had to be true for you to find something. A
review that cannot come back empty-handed is not a review.
