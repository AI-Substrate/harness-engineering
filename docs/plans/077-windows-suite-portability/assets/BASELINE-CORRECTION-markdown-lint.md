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

## 2a. THE CAUSE IN §1 IS UNPROVEN — and the real reason is stronger

**Withdrawn, 2026-08-09:** §1 attributes the 210 → 211 gap to *drift nobody tracked tightly
enough*. The **observation** is solid — the briefs say 210, this branch measures 211 — but the
**cause** is not established, and a second explanation fits the same evidence.

**The three checks derive scope from `git ls-files`, so the total is BRANCH-DEPENDENT.** One
branch measures 194 `markdownlint` findings; another measures 195. **Both are correct
simultaneously and nobody has drifted** — the branches simply track different sets of markdown
files. So 210 vs 211 may be temporal drift, or the briefs may have been written from elsewhere
in the tree. Both fit, and nobody can tell which without knowing where each figure was measured.

**This makes the guidance stronger, not weaker.** A copied total rots along **two axes at once
— time AND branch**, and a coder comparing against "about 210" cannot distinguish drift from
simply standing somewhere else:

> **An absolute total is not even wrong in a single place, because it has no single true value.**

So *"derive the baseline at the moment you use it, from your own merge-base"* is not merely
tidier than copying a number — it is **the only formulation that is well-defined at all**. A
copied total is a claim whose truth depends on where the reader stands, stated as a constant.

**Report in the long form.** On a pre-`6a43fd4d` branch, *"markdown findings identical to
baseline"* overclaims by omission — it presents a three-row result as a complete answer. Say
**"three checks unchanged; fourth not available here."**

---

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

## 3a. NARROWER THAN FIRST STATED — only the AGGREGATE moves

**Correction, 2026-08-09, from the check's own author who tested it rather than reasoning
about it:** `6a43fd4d` changed **only** the new `unexamined` check and the **aggregate**
`totals.findings`. The per-check counts — `markdownlint`, `links`, `mermaid` — are
**byte-for-byte unaffected**.

So:

| what you quoted | does it still reproduce? |
|---|---|
| an **aggregate** (`markdown-lint 210`, `211 total`) | **no** — annotate it |
| a **per-check** figure (`195 lint`, `links 15 before / 15 after`) | **yes, exactly** — no annotation needed |

That cuts the annotation set substantially. The six briefs in this folder quote an
**aggregate**, so they do need this note. `2fbbfba7`'s `15 before, 15 after` is **per-check**
and still reproduces.

**And plan assets cannot produce an `unexamined` finding at all.** Measured by planting an
untracked, genuinely broken `.md` (two H1s, a real MD025) into plan assets and running the
gate: `unexamined: pass, findings=0, examined 4 -> 5`. The gate **saw** the file and correctly
declined to claim it was in scope — `docs/plans/**` and `.harness/**` are both in
`IGNORE_GLOBS`. That `examined` move with `findings=0` is the denominator doing exactly its
job: **an exclusion and a blind spot look identical without it.**

The realistic shared-tree case is therefore a peer's untracked draft of a **guide or a skill**
(`docs/how/**`, `docs/guide/**`, `skills/**`, the root docs) — not a brief, not a packet.

---

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
