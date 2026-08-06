# Handover — plan 073, git-ai collector v1

**Written**: 2026-08-06, immediately before a context compaction.
**Seat**: `pij-respectable-clam` (PM). **Worktree**:
`/Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1`
**Branch**: `s073/gitai-collector-v1`, base `d08f4942`.

## Live state — the things not recoverable from disk

| Thing | Value |
|---|---|
| **Coder (RUNNING)** | `pij-generous-chipmunk` — copilot, `claude-opus-5`, effort high, pane `%1024` |
| **Reviewer** | **NOT spawned, deliberately.** The pair route mandates acquiring it at first REVIEW, never alongside the coder. Jordan specified copilot **`gpt-5.6-terra`**, effort high |
| flow-pair run | `2026-08-06T08-24-29Z-github.com-AI-Substr` |
| Delegation | `dlg-0001` — the WHOLE phase, not a slice |
| Packet | `.flow-pair/runs/2026-08-06T08-24-29Z-github.com-AI-Substr/prompts/dlg-0001.md` |
| Old reviewer | `pij-running-unicorn` — did the plan review, **closed** |

**What happens next**: the daemon pushes when the coder reports. On that push —
**compact the coder FIRST** (§C3, fire-and-forget, no `--wait`), *then* spawn and
canary-verify the terra reviewer, *then* dispatch the review. Do not poll `pij state`.

## Committed

- `3d66b376` — the plan (22 ACs, 17 tasks, all claimed)
- `d881309b` — the backpressure survey as a `builder/backpressure` dd

`harness plan validate` → **0 errors, 0 warnings, 0 orphans**.
`harness plan ready` → was `not-ready` on the survey; the survey is now receipted, so
re-run it to confirm.

## Flight plan position

`nav.now = phase-1`. Research and Plan are **done**; the backpressure chore is
**receipted and terminal** (validation comment carries
`basis_sha256:a4f8b08f3acbf017c64a52689e63583002cd6db57562dad8816dcaf5a393c6df`).

Three chores now due at `phase-1`: **Boot check**, **Observe: P1**, **Retro: P1 (drain)**.
There is also a gate on `phase-1` — *"not yet evaluated"* — which resolves from the task
rows' terminal state, so it stays unevaluated until the coder's work lands.

## Jordan's rulings — binding, do not re-litigate

1. **git-ai becomes the collector.** v1 **disables** harness capture by default (does
   *not* remove it) so v2 can migrate rather than rebuild.
2. **Disabled by default at ship** — not via an env var the user must set.
3. **Pin a version + per-platform SHA, verify before install**, using our own
   cross-platform download — **not** git-ai's `install.sh`.
4. **Pin is data** — a version bump must be a one-file diff.
5. **trace2**: doctor **never destroys** a trace2 config. Non-empty ⇒ skip
   `install-hooks`, warn that telemetry could not be installed, print manual
   instructions. The **CLI install still proceeds** — a trace2 block degrades, never
   fails. This is why no consent mechanism is needed.
6. **Simple health depth for v1** — doctor does *not* attempt to prove collection is
   occurring; the gap is recorded as `ac-0012` rather than papered over.
7. **Fleet lineage goes dark until v2** — accepted knowingly.
8. **No semantic/flow capture in v1.**

Prime's ruling: `assets/research/RULING-prime-worktree-and-trace2.md`.

## Build discipline in this worktree

- **Never link the global `harness`** from here — invoke
  `node <worktree>/harness/cli/bin/harness.js`.
- **Bash cwd resets to the MAIN checkout between commands** — `cd` in every command.
- `timeout 30 git commit --no-verify` — the hook hangs.
- **Never `git add -A`** — explicit pathspecs; other sessions have uncommitted work in
  the root tree.

## Queued behind the coding (Jordan's sequencing)

**Backpressure remediation**, two items reported to `pij-related-koala`:

1. The backpressure verb module authors **markdown**, but a `builder/backpressure`
   schema exists — the dd migration landed the schema and not the producer.
   Consequence: `builder/plan`'s `done_when.pressure` is required per row and its
   target type is `builder/backpressure/section/rows`, so a markdown artifact cannot
   satisfy it **by construction**. Our `done_when` is empty for that reason.
   *(Do not "fix" the validator — zero rows means zero required fields; that part is
   standard schema behaviour.)*
2. **Three vocabulary divergences** between module prose and schema enums, which
   **cannot be mechanically mapped**:
   - certainty: `Strong/Partial/Weak` vs `Partial/Confident/Proven` — a **collision**;
     `Partial` exists in both and means different things (coverage vs confidence)
   - tier: module has `inferential`, schema does not — a **missing member**
   - status: `BUILDABLE` vs `BUILD` — a **twin**, one concept two tokens

   The collision is the dangerous one: it fails **silently**. I hit it — rated
   `Partial` on the coverage axis, and it happens to be defensible on the confidence
   axis too.

Also reported: **there is no verb to birth a dd document** (`harness dd` has no
`new`/`init`/`create`; `plan new` only scaffolds plan+tasks), so instantiating any
non-plan schema requires hand-writing the envelope — the one action the docs forbid.

## Open, not blocking

- The **outcomes section** ("what you get" list near the top of every plan) — koala is
  ready to build it across builder skill + plan schema + validator, and says the skill
  and schema **must land in the same change**. Jordan has not ruled on sequencing
  (full builder flow at next ordinal vs direct patch).
- **Copilot support in git-ai** was assessed: adequate, not stronger than ours. Two
  real losses — Copilot CLI has **no OTEL at all** (no tokens/cost/latency; our
  `copilot-ledger` carries `nano_aiu`), and VS Code Copilot's model reads `"unknown"`
  in the default configuration. Two silent-failure risks: Codespaces/dev-containers
  return empty with the watermark unchanged, and `~/.vscode-server` is never scanned.
- **1,778 Copilot CLI sessions** exist on this machine, all full-UUID directories,
  sharing ids with harness's own telemetry staging. That is the corpus at stake, and
  it makes the reviewer's F7 concern (hook sends an 8-char id, git-ai joins on the
  UUID) checkable with one live hook firing.

## ⚠️ Known-wrong value, deliberately left in place

`assets/backpressure.dd.json` → `meta.certainty` = **`Partial`**, and that is very
likely the wrong token. Do not silently "fix" it; read this first.

Prime established the collision is sharper than first reported — it is the **same
axis with a different scale**:

```
prose    Strong  > Partial > Weak         Partial = MIDDLE
schema   Proven  > Confident > Partial    Partial = FLOOR
```

I rated on the **prose** scale (19 of 22 criteria have an existing paved sensor, 2
need a named extension, 1 needs a build, 2 are honestly ABSENT → "middling"). Written
into the dd it now reads as **the weakest value the schema offers**, which does not
describe this proof set.

**Why it was not corrected**: the schema declares the enum members and defines
**none** of them — no descriptions, no per-member documentation. The only prose that
defines "certainty" describes the *other* scale. Choosing between `Confident` and
`Partial` would mean inventing the semantics of a vocabulary this seat does not own.
Recorded as underdetermined rather than guessed.

**To close it**: once the schema's rungs are given stated meanings, set it with one
command —
`harness dd set assets/backpressure.dd.json#meta <json> --value-json`.

Note for whoever ships the generator prime allocated: **generation cannot fix this
one.** It closes the twin (`BUILDABLE`/`BUILD`) and the missing member
(`inferential`), turns the gate green, and leaves this value wrong — with the green
then arguing the vocabulary is consistent.
