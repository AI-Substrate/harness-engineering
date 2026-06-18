# Encoding & Learning Loops

> **The payoff: a harness that gets better every run.** For anyone who wants the compounding part, not just the setup. ~8 min.

Everything so far — boot, observe, retro — leads here. This is the rule that quietly does the most work, and the reason a harness is worth building at all.

## Encode the fix, not the memory

When an agent (or a new teammate) discovers the app only starts after three obscure setup steps, the instinct is to write it down — another paragraph in `AGENTS.md` explaining the dance. **Resist it.** Ask instead: *can the harness do the dance?*

> Documentation can orient, but the highest-value harness knowledge is **executable**. Markdown explains the trap; code prevents you falling into it.

That is the whole move. "Coding in markdown" — telling the agent how to work around a problem in prose — is how you stay stuck. Fixing it properly, in the harness, is how you stop hitting it.

## Friction → deterministic capability

Every recurring friction is a fixable harness defect with an executable answer:

| The friction (again and again) | The encoded fix |
|---|---|
| Keeps forgetting a migration step | a preflight check that fails without it |
| Keeps misreading an architecture rule | an architecture check ([11 · Backpressure Patterns](11-backpressure-patterns.md)) |
| Keeps needing the same seed data | a `seed` command |
| Keeps misusing an internal API | a lint rule or a typed wrapper |
| Burns minutes figuring out if it built and ran | a `boot` + smoke check |

Notice the shape: a prose reminder becomes a **deterministic sensor**. The agent no longer has to *remember* — the harness *refuses* the weak path.

## The magic wand, then close the loop

At the end of a meaningful run, ask the two questions ([09 · Operating the Loop](09-operating-the-loop.md) shows where they fire):

> *If you had a magic wand, what one command, flag, output field, fixture, check, or workflow change would make the next run easier, safer, or higher quality?*
>
> *What did you have to infer that the harness should have proved?*

Then **review the answers** — this part needs a human. Some will be bad. Some too expensive. Some are gold. The point is not to collect lessons; it is to make the next run better. Encode the good ones; let the rest go.

## The compounding part

The first few improvements feel basic: a clearer `doctor` check, a reusable seed command, a smoke test, a better error message. None feel like a big deal.

But after a few iterations, something shifts. The next session starts faster, with less preamble. The next validation run is more deterministic. The next time someone hits that friction, the harness catches it before a human has to.

That is the whole idea: **don't just use agents to write code — use agents to improve the loop the agents themselves use** to write your product and prove it works. A harness without this step is only a test rig; with it, every run pays forward to the next.

## Keep reading
- Patterns teams actually encode: [`harness-foundations/patterns-that-work.md`](../../harness-foundations/patterns-that-work.md).
- The simple, vivid version of this whole argument: [`harness-foundations/simple-mode.md`](../../harness-foundations/simple-mode.md).
- The proof ladder you encode against → [11 · Backpressure Patterns](11-backpressure-patterns.md).

---

<sub>[← Prev: Operating the Loop](09-operating-the-loop.md) · [↑ Start Here](README.md) · [Next: Backpressure Patterns →](11-backpressure-patterns.md)</sub>
