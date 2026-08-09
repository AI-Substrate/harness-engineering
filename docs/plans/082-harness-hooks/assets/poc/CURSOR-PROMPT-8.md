# Validate `harness hooks` end to end, from inside Cursor

This file has three parts: **read the state you are in**, **the prompt to paste into Cursor**, and
**how to score the result**. You do not need any other document to run it.

---

## 0. THE STATE YOUR MACHINE IS IN — read this first

`harness hooks install` has been run on this machine. Six agents are hooked: claude-code, cursor,
gemini, droid, github-copilot and windsurf.

**The hook points at a temporary git worktree:**

```
…/harness-engineering-worktrees/s077-suite-portability/harness/cli/bin/harness.js
```

**When that worktree is removed, the hook silently stops working.** It does not warn you and it does
not fail loudly — the hook is designed to exit 0 and print nothing, so a dead one and a working one
look identical from the outside. The only way to see it is to ask:

```
harness hooks status --json
```

A hook whose target is gone reports `"binaryState": "unresolvable"` with `"installed": true` — the
entry is still in your config, the program it names is not there. A healthy one reports
`"binaryState": "resolves"`.

**When you have finished validating, remove the hooks:**

```
harness hooks uninstall
```

That is surgical: it removes only the entries carrying our marker, deletes the one config file the
install created (`~/.copilot/hooks/harness.json`), and leaves everything else — including the
existing git-ai entries — byte-identical. It has been measured returning all seven touched configs to
their exact prior bytes.

The durable install is `harness doctor`, once this work is merged and the globally-installed
`harness` actually carries these verbs. Until then, this install is for validation only.

---

## 1. Set up a clean repo for the run

Do this yourself, in your own terminal, before pasting the prompt:

```bash
mkdir -p ~/temp/hooks-validate && cd ~/temp/hooks-validate
git init -q -b main
printf 'export const seed = 1;\n' > seed.mjs
printf '# hooks-validate\n\nA scratch repo for validating agent commit attribution.\n' > README.md
git add -A && git commit -qm 'chore: seed'
```

Optionally, **write a few lines yourself** in your own editor now (not through Cursor) and leave them
uncommitted. That gives the run a human-authored change alongside the agent's. If you do, note which
lines you wrote — you will want them when scoring.

---

## 2. THE PROMPT — paste everything in this box into Cursor

> You are working in `~/temp/hooks-validate` on branch `main`.
>
> There may be changes in this repo that you did **not** make. **Leave every one of them exactly as
> they are** — do not reformat, reorder, tidy, review, or "fix" anything you did not write.
>
> Do exactly this, in order:
>
> 1. Create `SHIPPED.md` with exactly four lines describing what this repo is for.
> 2. Add `export const eight = 8;` to the **end** of `seed.mjs`.
> 3. Stage **everything**: `git add -A` — this will include changes you did not make, and that is
>    intended.
> 4. Commit with the message: `feat: SHIPPED.md and eight (prompt 8)`
>
> Run `git add` and `git commit` **yourself, in your own terminal**. Use plain commands. Do **not**
> pass `--no-verify`. Do **not** set or export any environment variables.
>
> Do **not** run any `git-ai`, `harness`, or telemetry command, and do **not** inspect, check, or try
> to fix anything about authorship attribution or git notes — a collector is being observed and
> touching it invalidates the run.
>
> When you are done, report back:
>
> - the exact shell command(s) you used for the commit, **verbatim**, including any `&&` chaining and
>   any wrapper your tooling added
> - the resulting commit sha
> - **which lines of which files you personally wrote** in this run — this is the ground truth the
>   attribution is scored against, so be precise
> - whether the run was sandboxed, and paste any sandboxing notice **verbatim**
> - anything you noticed that seemed unusual, however minor

---

## 3. WHAT TO EXPECT, AND WHAT FAILURE LOOKS LIKE — read before you score

State both to yourself before looking, so that a null result is legible as a null result rather than
as confusion.

**Expected outcome.** A note exists on the new commit. It names `SHIPPED.md` and `seed.mjs`, with
line ranges matching what Cursor reported writing, and each range carries an actor id.

**Failure signature — and they are different failures:**

| what you see | what it means |
|---|---|
| `error: no note found for object …` | **The hook did not fire, or fired and could not deliver.** This is the total-loss case the hook exists to prevent. Check `harness hooks status --json` first — if cursor reports `unresolvable`, the worktree is gone and that is the cause, not the collector. |
| A note exists, but `SHIPPED.md` is absent from it | The commit was recorded and the agent's own files were not attributed. A different and more interesting failure than no note at all. |
| A note exists and every range is `h_…` | Recorded, but attributed to a human. **See the observation below before calling this a failure.** |
| A note names files Cursor said it did **not** write | Over-claiming. `git add -A` sweeps in foreign changes and they must not be claimed as agent-authored. |

---

## 4. Scoring — for you, the operator, after the run

Read the note:

```bash
cd ~/temp/hooks-validate && git notes --ref=ai show HEAD
```

> The ref is **`ai`** (`refs/notes/ai`). `--ref=git-ai` is a different, empty ref — using it prints
> nothing and reads exactly like a failed run.

The body looks like this — a filename, then one indented line per attributed range:

```
SHIPPED.md
  s_ed609d39de2442::t_6289f77e005b9f 1-4
seed.mjs
  s_ed609d39de2442::t_f0fca2438d59d5 2
```

`s_…::t_…` is an **agent** actor (session, turn). `h_…` is a **human** actor.

**Assert IDENTITY, never a count.** Check the commit sha, the file names, the line ranges, and the
actor kind — read out of the note's own body. Do **not** assert on how many notes exist: any
unsandboxed commit anywhere in the repo moves a count, so a count can pass or fail for reasons that
have nothing to do with this run.

| check | pass condition |
|---|---|
| note exists | a note is present **on the sha Cursor reported** — not on `HEAD` by assumption |
| identity | the note names `SHIPPED.md` and `seed.mjs`, with ranges matching Cursor's own report |
| actor kind | each range carries an actor id, and you **record which kind** it is — see below |
| no over-claim | files Cursor said it did not write are **not** claimed as agent-authored |
| guard held | your own hand-written lines, if any, are not attributed to the agent |

### An observation to hold, not an expectation to meet

**Measured on this machine: across five runs, notes came back 1 agent-attributed to 4
human-attributed for the same commit shape.** That is data, not a defect, and it is recorded here so
that a human-attributed note reads as *a result* rather than as a failed run.

So the honest instruction is: **record which actor kind appeared**, and add it to the tally. A single
run cannot distinguish "the attribution is wrong" from "this is the 4-in-5 case". Several runs can.

**Do not seed a human checkpoint yourself to make the split appear.** That taints the run: the
question is what *Cursor* does, not what can be staged. If you want a human-authored change in the
mix, write it in your own editor before the run, as in step 1.

---

## 5. When you are finished

```bash
harness hooks uninstall
harness hooks status --json     # every agent should report installed: false
```

Leaving the hooks installed is not dangerous, but it points your editors at a worktree that is going
to be deleted, and a hook that exits 0 will never tell you it has stopped working.
