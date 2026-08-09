# Correction — the `markdown-lint` baseline quoted in this plan's briefs is stale, twice over

**Recorded**: 2026-08-09 · **By**: `pij-respectable-clam` (PM) · **Applies to**: every brief
under `docs/plans/077-windows-suite-portability/assets/`

Six briefs in this folder carry `markdown-lint 210` as a **baseline degradation, do not add**.
Five of them are mine. That figure is wrong, and the way it went wrong is worth more than the
number.

## 1. It was already wrong before anything changed on main

Measured on this branch, three-check gate, by `pij-exuberant-skaffen`:

```
markdownlint  findings 195   examined 147
links         findings  15   examined 147
mermaid       findings   1   examined  31
                      = 211
```

**The branch is at 211. The briefs say 210.** The baseline moved 210 → 211 *during this plan*,
was silently re-baselined inside a commit body (`2fbbfba7`), and the six briefs were never
updated.

It went unnoticed for the reason small drifts always do: **the delta was 1, and everyone
comparing against "210-ish" called it a match.** A brief is read by a coder who has been told
to compare and report — so a stale *instruction* misdirects someone **acting**, where stale
*evidence* only misleads someone reasoning.

## 2. And it is about to be wrong again, for an unrelated reason

`6a43fd4d` (PR #146, on main) adds a **fourth** check, `unexamined`, which reports in-scope
**untracked** markdown as a finding — warn-launch, exit 0, cannot fail a build.

`6a43fd4d` is **not** an ancestor of this branch, verified. So the three-check numbers still
reproduce here today, **and will keep reproducing right up until the merge from main** — at
which point they all move at once, inside a merge commit that touched none of them.

That is worse than "the numbers stopped reproducing": the failure is **delayed and lands
attached to the wrong change**. Anyone re-deriving 211 before the merge gets confirmation and
concludes the numbers are sound; the same person after the merge gets a mismatch. Both
readings are available and which you get depends on *when you looked*.

## 3. THE FIX — stop quoting a number, derive it

**Do not treat any hardcoded lint total in this folder's briefs as authoritative.** Derive the
baseline at the moment you need it:

```bash
harness markdown-lint --json | jq '.data.checks[] | {name, outcome, findings, examined}'
```

Read the **examined** count, not just the findings count. A check that examined nothing reports
zero findings and is indistinguishable from a clean pass — that is the exact blindness `#146`
fixed at gate level and `#148` records at tool level.

### Attributing a change — three states, not two

| what you see | reading |
|---|---|
| `unexamined` row **absent** | **your branch predates `6a43fd4d`** — the comparison is not available. The other three are still comparable to an old baseline |
| `unexamined` non-zero, other three match your baseline | **main did it**, not you |
| any of the other three moved | **that part is yours**, and it predates `6a43fd4d` |

**Absent is not zero** — `pij-exuberant-skaffen`'s catch, and the same rule we are enforcing in
#144, where a missing Cursor config must give *"cannot tell"* and never a green.

## 4. A caveat that must travel with the correction

The **links** sub-count is structurally blind to `docs/plans/**`, which `markdown-lint`'s scope
config drops (`IGNORE_GLOBS`, alongside `scratch/**`, `.harness/**`, `docs/retros/**`). The
`15` was never able to speak for the archive corpus, before or after `6a43fd4d`.

So "the number is fine once you account for the new check" would still be reading it as
**broader than it is**. Confirmed by reading the scope module, not inferred: packets and briefs
under `scratch/` are *ignored*, not untracked, so the new check cannot name them.

## 5. Why the briefs were not edited

Five of the six are mine, one is not, and all six are records of completed rounds. Rewriting a
number inside a delivered instruction hides that the instruction was ever wrong — and the
correction (210 → 211) is itself about to be invalidated by the merge, so it would be
re-staled in the act of de-staling it.

This note is additive and leaves the original wording visible, which is the same standard we
applied to the four rotten claims in `docs/how/telemetry/`.
