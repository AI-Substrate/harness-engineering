# Using an Existing Harness

> **You cloned a repo that already has one.** For a newcomer — human or agent — who needs to drive a harness they did not set up. ~6 min.

Someone already adopted the harness here. You do **not** need to adopt, `init`, or scout anything — that work is done. You just need to drive it. This page gets you productive without installing or changing a thing in the repo.

## First: make sure the CLI is here
The harness **core** is a global CLI that is never committed to the repo, so you install it once on your machine (skip this if `harness` already runs):
```bash
npm install -g @ai-substrate/engineering-harness
harness doctor
```
`harness doctor` is your first signal: green means the repo's harness is loaded and ready, and it lists the repo's own commands.

## Orient in 30 seconds
```bash
harness instructions     # the agent briefing: what this repo is, how it wants to be operated
harness help             # every verb available here, including this repo's own extensions
harness docs             # the repo's bundled docs (then `harness docs <id>` to read one)
```
`harness instructions` is the cold-start orientation — point your agent at it the moment it lands. `harness help` shows the **repo's** verbs: alongside the built-ins you will see extensions this repo authored, like `boot`.

> **For agents:** `harness instructions` first, then `harness doctor`. Between them you will know what the system is, how to start it, and how to prove a change — without reading the whole codebase.

## Drive the loop
```bash
harness boot                                  # start the product from a known state
# ... do your work through the repo's supported commands ...
harness observe "seed step was unclear"       # capture friction as you hit it
```
- **Boot** proves the product starts. If `harness boot` is green, you can trust your starting point.
- **Observe** captures friction to a transient buffer as you work — it costs nothing and feeds the team's improvement loop later.
- The full rhythm — boot at session start, observe during work, retro at the end — is [09 · Operating the Loop](09-operating-the-loop.md).

## What you should *not* do
- Don't run `harness init` or the adoption router here — the repo is already set up; re-adopting just adds noise.
- Don't bypass the harness with raw shell workarounds. If the supported path is missing something, that is a harness gap worth capturing with `harness observe` (see [10 · Encoding & Learning Loops](10-encoding-and-learning-loops.md)).

## Where next
- The mental model behind the commands → [03 · The Harness Loop](03-the-harness-loop.md).
- The full working rhythm → [09 · Operating the Loop](09-operating-the-loop.md).

---

<sub>[← Prev: Adopting the Harness](04-adopting-the-harness.md) · [↑ Start Here](README.md) · [Next: Repo Layouts →](06-repo-layouts.md)</sub>
