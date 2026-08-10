# FINDINGS — the same-file mixed commit, measured on Windows with a real human

**Run**: commit `51769645870f35e31d36d3d45feaf1470e397487`, `C:\src\cursor`, 2026-08-10
**Deployed hook**: `46b0dd003e2643796a571b08967a9a2aa0b2f7a1` · **git-ai**: 1.6.21 daemon
**Agent**: Cursor 3.15.6, `gpt-5.6-terra` · **Human**: Jordan, typing by hand in the editor

> **Adjudication status: PROVISIONAL.** The line names are self-describing
> (`humanOne/Two/Three`) and the diff supports the split, but Jordan has not yet explicitly
> confirmed which lines he typed. Self-describing content is evidence, not adjudication.

---

## Why this run is the only one of its kind

The macOS mixed test was attempted **twice** through `validate-attribution` and **the mixed case
never happened**: both times the agent quietly committed only its own new file, leaving the
human's hand-edited lines uncommitted. Both mac runs are a PASS on the *easy* case.

**This is the first same-file mixed commit anyone has actually produced** — and the first with a
genuine human author rather than a script or a second AI.

## Ground truth vs. what the note claims

`seed.mjs` after the commit:

| lines | author | claimed by the note |
|---|---|---|
| 1–6 | pre-existing | — |
| 7–8 | blank | `t_bbb7d08eaa6561` (agent) |
| **9–11** | **HUMAN, typed by hand** | **`t_bbb7d08eaa6561` (9–10) and `t_3f4cd1b26dc426` (11) — both AGENT** |
| 12–14 | agent | `t_3f4cd1b26dc426` (agent) — correct |

Every claim sits under session `s_a9357a5c6d379b` = `agent_id {tool: cursor, model:
gpt-5.6-terra}`. **There is no `h_` known-human claim anywhere in the note.**

**All three human lines were claimed for the agent.** Half the commit by line count, attributed
to an AI, silently.

## The mechanism — the checkpoint layer was CORRECT

This is the part that generalises, and it is stronger evidence than the macOS version because a
real person typed the lines.

The archived working log holds:

```
kind=Human    trace=t_9479ea379c7d8b   files=seed.mjs, jordan5.md, prompts/WIN-PROMPT-6.md
kind=AiAgent  trace=t_3f4cd1b26dc426   files=seed.mjs
kind=AiAgent  trace=t_c97c197d63cb60   files=AGENT-NOTES-6.md
```

**git-ai OBSERVED the human edit to `seed.mjs` and recorded it correctly as `Human`.** That trace
id — `t_9479ea379c7d8b` — **appears nowhere in the note.**

> **A plain `Human` checkpoint is a DIFF BASE, NOT AN ATTESTATION.** Only `s_` and `h_`
> (KnownHuman) are durable claims. The observation existed, was correct, and contributed nothing
> to the outcome.

Proven now on a second platform, with a real human.

### Observed vs minted by recovery

| | this run | the recorded 12:17 run |
|---|---|---|
| trace ids in note | 3 | 8 |
| observed by a checkpoint | 2 | 2 |
| **minted by commit-time recovery** | **1** (`t_bbb7d08eaa6561`, claiming 8–10) | 6 |

A better ratio, the **same failure in kind** — and the minted id is precisely the one claiming
the human's lines.

---

## THE BOUNDARY — read this before concluding anything about our chain

**Our transport works. It is git-ai's attribution semantics for same-file mixing that is wrong,
and that is not ours to fix.**

Our hook journal for this run, 4 entries, every one `strippedBom: true`:

```json
{"phase":"pre", "outcome":{"kind":"recorded","phase":"pre"},"strippedBom":true}
{"phase":"post","outcome":{"kind":"silent","reason":"head-unchanged"},"strippedBom":true}
{"phase":"pre", "outcome":{"kind":"recorded","phase":"pre"},"strippedBom":true}
{"phase":"post","outcome":{"kind":"emitted","head":"51769645870f35e31d36d3d45feaf1470e397487"},"strippedBom":true}
```

**First `emitted` on Windows, ever.** Hook fires → BOM stripped → payload parsed → repo resolved
→ commit detected → emitted → note written. The whole chain is closed on the platform that has
never had it.

The kit already documents the limit this run hit: **attribution is trustworthy at COMMIT
granularity.** Separate commits are correctly attributed in both directions; a human + AI mixed
commit over-counts AI. Nothing here contradicts that. It extends it to a second platform and to
a real human.

---

## A DOCUMENTED CLAIM NEEDS ITS BOUNDARY — for the kit's §5

The validation kit recommends `harness commit "<msg>" <explicit paths…>` over `git add -A`, and
records a run of **eight files across three provenances, all eight attributed correctly**.

**This run used exactly that path** — `harness commit "feat: agent lines six through eight" --
seed.mjs AGENT-NOTES-6.md` — and the human lines were absorbed anyway.

**The kit is not wrong; its claim has an unstated boundary.** The 8/8 run was **CROSS-FILE**
mixing, which the kit's own §5 predicted mostly-OK *because edge extension is per-file and cannot
reach a file the AI never touched*. **SAME-FILE mixing was never tested and is not covered by
that reasoning.**

**Proposed edit, for whoever owns that branch:**

- Add to §5 *Still untested*: **same-file mixed commit** — human and agent lines in ONE file,
  one commit. **Now tested: FAILS.** All human lines absorbed into the agent session, no `h_`
  claim produced, despite explicit pathspecs.
- Mark the `harness commit` recommendation with the boundary it actually has: explicit paths
  prevent *sweeping in* unrelated files; they do **not** protect lines inside a file the agent
  also edited.

---

## THE METHODOLOGICAL ROW — three probes that could not observe what they were built to observe

**Three instances in one day, and the third is the most dangerous because nothing malfunctioned.**

| # | probe | what it actually measured |
|---|---|---|
| 1 | **fiction stimulus** — fed git-ai literal ASCII `n++` | its refusal of a string Cursor never sends. Recorded as *"git-ai has no tolerance"*. It has. |
| 2 | **text-mode instrument** — wrapper read stdin as text | its own PowerShell rendering (`n++`) of the bytes it existed to report (`EF BB BF`) |
| 3 | **the easy half** — macOS mixed-commit run, twice | the *cross-file* case. The mixed case never happened. Both runs PASSED. |

**Instance 3 is the one to study**, because there was no defect anywhere: the tooling worked, the
verdict was correct *about what it actually tested*, and the run completed cleanly.

The agent **explicitly reported** *"existing unrelated changes remain uncommitted."* It saw the
human's work and deliberately left it alone — **which is good agent behaviour**, and exactly what
a well-behaved agent should do with changes it did not make.

The cause was **instruction placement**: the mixed-commit requirement was appended *after* the
verb's numbered steps. The agent read the numbered procedure as the task and the additions as
background. **Twice.**

> **AN INSTRUCTION PLACED AFTER A NUMBERED PROCEDURE IS BACKGROUND, NOT INSTRUCTION.**
> A measurement whose hard half depends on such an instruction will **silently degrade to the
> easy half and still pass.**

Remedy applied: the override goes **first**, and the exact reasoning the agent used is explicitly
forbidden. (This is also why WIN-PROMPT-6 opens by naming the mixture as the point of the
exercise, *before* its numbered steps — the human lines are established as in-scope before the
procedure begins.)

**The family these three share:** a probe that completes, reports honestly, and answers a
question adjacent to the one you asked. None of them errored. All three would have been believed.

---

## `harness commit` — "a note landed" is not "the note is right"

Verbatim output from the run:

```json
{"command":"commit","status":"degraded","mode":"ingress-unverified","probe":"connected",
 "verify":"skipped","buffer":null,
 "detail":"committed 51769645870f — DEGRADED: the collector ingress is a Windows NAMED PIPE
 (\\\\.\\pipe\\git-ai-7e23ac9630ec3d08-trace2). The commit was made with NO trace2 override, so
 git wrote its events to that pipe as usual — but attribution was NOT VERIFIED on this platform,
 and nothing here was buffered. Whether the note landed is UNKNOWN, not proven and not
 disproven."}
```

**The verb behaved exactly as documented** — named the platform reason, buffered nothing, claimed
nothing, and explicitly refused to recommend a recovery that cannot work on a named pipe. Third
documented outcome shape, observed live on the platform it was written for.

**And it exposes a gap.** The note *did* land, and it was *wrong*. On POSIX this identical run
would have returned **`confirmed`** — the verb's strongest outcome — because `confirmed` is
defined as *waits bounded for the `refs/notes/ai` note and tells you whether it landed*.

> **`harness commit` verifies WHETHER A NOTE LANDED, never WHETHER THE NOTE IS CORRECT.**
> A `confirmed` here would have been a green light on a commit that attributed three hand-typed
> human lines to an AI.

Not a defect — the verb does what it says and its docs never claim otherwise. But it is a **gap
in what we can prove**, and it is the same shape as everything else in this plan: *an observation
that exists, is honest, and cannot answer the question you will actually ask of it.*

**The platform irony worth recording:** **Windows is epistemically safer here.** It says UNKNOWN
and the operator goes and looks. POSIX says CONFIRMED and the operator stops looking. The weaker
platform produces the better outcome, purely because it refuses to claim.

**Options considered, and the ruling — `pij-respectable-clam`, 2026-08-10:**

> **THE RULE THIS IS AN APPLICATION OF, and it outranks the ruling below:**
> **AN ACCURATE DEFINITION DOES NOT REPAIR A MISLEADING WORD, BECAUSE THE WORD IS READ AND THE
> DEFINITION IS NOT.** That holds for every status string we ship — `confirmed` is one instance
> of it, not the point.

1. ~~Rename the outcome (`note-landed` rather than `confirmed`)~~ — **rejected.** Churn, and it
   moves a contract.
2. Read the note back and report whether it contains any `h_` claim on a commit whose diff
   includes lines no agent checkpoint covered — **recorded as the real fix, and as a NAMED
   CANDIDATE, not built now.** It is a *second verification*, not a bigger version of the first.
3. ~~Document the limit at the definition of `confirmed`~~ — **insufficient alone.** The docs are
   already accurate. **The WORD is what misleads, and nobody reads the definition at the moment
   they read the output.**
4. **CHOSEN — change the operator string at the point of use.** The `confirmed` outcome should
   say, *in the line the user actually sees*, that a note **LANDED** for this commit and that
   harness does **not** check whether its attribution is **correct**. Zero contract movement,
   and it kills the misreading exactly where the misreading happens.

---

## What this run does NOT establish

- **Not adjudicated.** Jordan has not confirmed his line numbers (see the status note above).
- **Not a claim about macOS.** The mac mixed case has still never been produced.
- **Not a test of `validate-attribution`.** That verb cannot load in the guest (E149, verified),
  and its parser currently drops the new `unparseable` outcome — the pending F009 fix. Scoring
  here was manual and deliberate.
- **Not a statement that our chain is broken.** It is closed and working. See § THE BOUNDARY.
