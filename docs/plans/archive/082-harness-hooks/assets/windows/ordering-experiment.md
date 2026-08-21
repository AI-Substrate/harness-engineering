# The ordering experiment — it is the LADDER, not the edit mechanism

**Design**: `pij-respectable-clam`, from Jordan's hypothesis · **Run**: Windows VM, 2026-08-10
**Commit**: `d35a2c6e71c55f5b7d7d569313ed44abafc9af58` · **Hook**: `46b0dd00` · **git-ai**: 1.6.21
**Agent**: Cursor 3.15.6, `gpt-5.6-terra`, one chat across both parts

---

## The question, and why it needed answering

Every mixed run before this one was **human edits → agent edits → agent commits**, with the
agent's line landing **immediately adjacent** to the human's. Two explanations survived, and they
need different fixes:

1. **Edit-mechanism artifact** — the agent's tool rewrote a *region* rather than appending, so
   git-ai legitimately recorded the agent writing content that included the human's line.
   Attribution would be **correct about what it observed**.
2. **The recovery ladder proper** — commit-time recovery assigns unwitnessed lines to the only
   session it knows about, regardless of who wrote them or when.

**The design inverts the order and breaks adjacency together.** If human lines are still claimed
for the agent, explanation 1 and simple proximity are both dead.

## What was actually done

| step | actor | action |
|---|---|---|
| 1 | **agent** | appended ONE line to the **end** of `seed.mjs`, then **STOPPED** — committed nothing |
| 2 | *(the agent's checkpoint window closes)* | |
| 3 | **human** | inserted **8 lines by hand near the TOP** (after line 2), 13+ lines from the agent's |
| 4 | **agent** | in the **same chat**: `git add -A`, commit, and declare **only its own line** |

Final `seed.mjs`, 23 lines: **human wrote 3–10**, **agent wrote 23**.

## THE RESULT — the human's lines are still claimed for the agent

```
seed.mjs
  s_a9357a5c6d379b::t_282b169f2af1dd 22-23     <- OBSERVED. The agent's genuine append.
  s_a9357a5c6d379b::t_dfdaea3e6edd48 3-10      <- MINTED. THE HUMAN'S EIGHT HAND-TYPED LINES.
```

**No `h_` claim anywhere in the note.** Every claim sits under the agent session
`s_a9357a5c6d379b` (`tool: cursor`, `model: gpt-5.6-terra`).

### Verdict: HYPOTHESIS 2. It is the ladder.

- **Order inverted** — the agent edited *first* and stopped; the human edited *after* the agent's
  checkpoint window closed. Still absorbed.
- **Adjacency broken** — 13 lines apart, opposite ends of the file. Still absorbed.
- **Edit mechanism ruled out** — the agent's own append is correctly and narrowly claimed at
  22–23. It did not rewrite a region; its checkpoint is exact.

**The mechanism is commit-time recovery assigning unwitnessed lines to the only session it knows
about.** Not proximity, not ordering, not the editing tool. **This is git-ai attribution
semantics, and it is not ours to fix.**

### And the checkpoint layer was RIGHT AGAIN — third time

The archived working log for this commit holds **both** authors, correctly typed:

```
kind=AiAgent  trace=t_282b169f2af1dd  files=seed.mjs      <- the agent's append
kind=Human    trace=t_6cee4ed3f8d331  files=seed.mjs      <- the human's edit, OBSERVED
```

**git-ai observed the human's edit, on the right file, and recorded it as `Human`. That trace id
appears nowhere in the note.** A plain `Human` checkpoint is a **diff base, not an attestation** —
now demonstrated three times, on two platforms, with a real human, under inverted order.

---

## THE BIGGER FINDING — `git add -A` claimed EIGHT files the agent never touched

This was not part of the design and is the more alarming half.

```
.harness/temp/gitai-collector.json   t_9a0ec413fd1fc4  3,31-36,39-47
jordan4.md                           t_63a12cac63a6e6  1-6
jordan5.md                           t_ccf0db4c79debe  1-8
prompts/WIN-PROMPT-5.md              t_64e7a8aec0b978  1-35
prompts/WIN-PROMPT-6.md              t_6732b23d1420e2  1-62
prompts/WIN-PROMPT-7.md              t_ea82b4df1d9406  1-60
prompts/WIN-PROMPT-8A.md             t_cb6a77bffee07c  1-34
prompts/WIN-PROMPT-8B.md             t_178553d6b0a73b  1-41
```

**Every one of these was written from OUTSIDE the guest**, over the Parallels share, by tooling —
several of them *before this chat existed*. The agent never opened them. **All eight are claimed,
in full, for the agent session, each by a freshly minted trace id.**

**Observed vs minted: 1 of 10 observed, 9 minted.**

### The comparison that makes this actionable

| run | commit path | trace ids | minted |
|---|---|---|---|
| run 6 | `harness commit … -- <explicit paths>` | 3 | **1** |
| run 8 | `git add -A` + `git commit` | 10 | **9** |

**Explicit pathspecs do not fix same-file mixing — but they contain the blast radius
dramatically.** A sweeping stage hands the ladder every unwitnessed file in the tree, and it
claims all of them. This is direct measured support for the `harness commit` recommendation, on
a different axis from the one the kit argued: not *"it attributes better"*, but **"it gives the
ladder far less to over-claim."**

> **Confound, stated:** run 8 used `git add -A` to match the macOS arm, so the commit mechanism
> differs from run 6. The comparison above is therefore suggestive of scope, not a controlled
> A/B of the two commit paths. Worth running deliberately.

---

## What this does NOT establish

- **Not adjudicated by the human yet** — line names are self-describing (`three`…`ten` inserted
  near the top) and the diff shows `@@ -2,0 +3,8 @@`, but that is evidence, not adjudication.
- **Not a macOS claim.** The macOS arm of this experiment was running in parallel; the platform
  pair is the point and should be read together.
- **The agent's edit-mechanism self-report** should be read alongside this. The note's narrow
  22–23 claim already indicates a targeted append rather than a whole-file rewrite, but the
  agent's own answer is the direct evidence and belongs in the record.

## Scoring discipline used

- `git-ai await` before reading the note.
- Trace ids matched **only after `::`** — a bare `t_[0-9a-f]+` also matches inside
  `git_ai_version` (`git_ai` → `t_a`), an artifact that fooled two agents earlier today.
- The note was **read directly**, not summarised through `validate-attribution` — which cannot
  load in the guest (E149), and whose PASS means *the note covers the agent's declared lines*,
  never that it claims **nothing beyond** them.
