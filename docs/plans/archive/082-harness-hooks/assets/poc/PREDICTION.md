# Prediction — written BEFORE the run, 2026-08-09

Recorded so the result cannot be retro-fitted to whichever mechanism I like.

## The claim under test

git-ai's **pre**-hook on any Shell/Bash tool call stamps every already-dirty file
as human (`orchestrator.rs:507`, `CheckpointKind::Human`, `PreparedPathRole::WillEdit`).
That is the designed defence against exactly this failure. It is written **only if**
`send_control_request(control.sock)` succeeds; on any error the orchestrator logs at
`tracing::debug!` and does `return Ok(vec![])` — no checkpoint, no stderr, exit 0.

**CONFIRMED from source.** What is **NOT** confirmed is which exit fires here.

## Control run — already measured, OUTSIDE Cursor

```
resolve branch: unix-direct
control path  : /Users/jordanknight/.git-ai/internal/daemon/control.sock
path exists   : True
connect()     : CONNECTED
```

The probe can report success, so a REFUSED from inside Cursor means something.

## The four candidates and what separates them

| # | mechanism | probe INSIDE cursor | HUMAN.md in this tiny repo |
|---|---|---|---|
| A | sandbox refuses the socket `connect()` | `REFUSED`, same path | attributed to AI |
| B | 1500ms stat walk abandons | `CONNECTED` | **attributed correctly** (3 files cannot time out) |
| C | env-rewritten channel — sandbox changes `HOME`/`TMPDIR`, so the hook resolves a path that never existed | `CONNECTED`/`REFUSED` but a **DIFFERENT `control path`** | attributed to AI |
| D | downstream — pre-checkpoint lands and is absorbed anyway | `CONNECTED`, same path | attributed to AI |

**D refutes me**, and it also refutes upstream #2067's stated mechanism. It is a live
possibility and I am naming it in advance rather than after.

C is the one nobody has considered. It produces an identical symptom to A with **no
denial anywhere**, because nothing was blocked — the hook simply looked in the wrong place.

## Falsifiable statements

1. If the probe prints `CONNECTED` **and the same control path** inside Cursor, then
   the sandbox is not blocking the control channel and **A and C are both dead**.
2. If `HUMAN.md`'s lines are attributed correctly in this 3-file repo but wrongly in
   harness-engineering, the mechanism is **size**, not the sandbox.
3. If `HUMAN.md` is misattributed while the probe says `CONNECTED` on the same path,
   my mechanism is **wrong** and the defect is downstream of the pre-checkpoint.

## Ground truth

`HUMAN.md` holds `HUMAN-LINE-01` .. `HUMAN-LINE-08`, written by `seed-human.py` with
every `CLAUDE_*`/`CURSOR_*`/`COPILOT_*` marker stripped and subprocess-verified CLEAN.
Cursor never touches that file. **Assert on the line identities, not the count** — a
total tells you something moved; an identity tells you which.
