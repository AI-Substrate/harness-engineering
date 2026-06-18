# Operating the Loop

> **The rhythm of a working session.** For humans and agents doing day-to-day work with the harness. ~6 min.

Once the harness is set up, using it is a rhythm, not a ceremony. Three beats: **start clean, capture friction, close the loop.**

## Start the session: boot
Begin every meaningful session by proving the product can start from a known state:

```bash
harness instructions     # orient: what this repo is, how it wants to be operated
harness boot             # prove it starts — your trusted baseline
```

If boot is green, you (or your agent) have a solid foundation to work from. If it is not, you have found the first thing to fix — before sinking time into feature work.

## During work: observe friction
As you work, capture friction the moment you hit it — an unclear step, a missing command, a slow loop, a useless error message:

```bash
harness observe "seed data step was unclear; had to read three files"
```

`harness observe` writes to a transient buffer (in `.harness/temp/`), so it costs you nothing in the moment. These notes are the raw material for improving the harness later. Work through the repo's supported commands rather than ad-hoc shortcuts — the supported path is what the harness can prove.

## Close the loop: retro and improve
At a natural boundary — end of a phase, end of a session — close the loop. The `/eng-harness-flow` router drives it:

| When | Call | What happens |
|---|---|---|
| **A phase just ended** | `/eng-harness-flow --hook post-coding` | **drain**: pull your observations into a retro |
| **The work is done** | `/eng-harness-flow --hook post-flight` | **harvest + improve**: consolidate the retro and encode the best fix |

This is where the magic-wand question gets asked — *what one command, check, or fixture would make the next run better?* — and where the answer becomes a real change to the harness. Retros are durable: `harness record retro` scaffolds a committed retro record under `.harness/records/retro/`, so the learning survives the session.

> **For agents:** boot at the start, `harness observe` whenever you have to infer something the harness should have proved, and surface a concrete magic-wand suggestion at the end. That single habit is what makes the harness compound.

## Where next
- The loop behind the rhythm → [03 · The Harness Loop](03-the-harness-loop.md).
- Turning friction into permanent capability → [10 · Encoding & Learning Loops](10-encoding-and-learning-loops.md).
- The skills that drive these steps → [`skills/README.md`](../../skills/README.md); record types → [`docs/how/record-and-record-types.md`](../how/record-and-record-types.md).

---

<sub>[← Prev: Fitting Your Workflow](08-fitting-your-workflow.md) · [↑ Start Here](README.md) · [Next: Encoding & Learning Loops →](10-encoding-and-learning-loops.md)</sub>
