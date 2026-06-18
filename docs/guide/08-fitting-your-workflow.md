# Fitting Your Workflow

> **It enhances your flow; it doesn't take it over.** For anyone deciding how the harness sits alongside how they already work. ~7 min.

This is the part people worry about: *do I have to change how my team works?* No. The harness is non-coercive by design. You have two ways to use it, and both are first-class.

## Two paths

### Path A — use the built-in flow (`the-flow`)
If you do not already have a spec-driven workflow (or you want a good one out of the box), use `the-flow`. One command, in plain words:

```text
/the-flow pull this Jira ticket and begin work
```

It carries the work through a canonical shape — **research → plan → implement → validate** — driving the spec-driven flow for you. There is little to learn: describe the problem and follow along.

### Path B — bring your own flow
Already have a workflow you like? Keep it. The harness plugs into it with **one skill, `/eng-harness-flow`, called at three moments**. Your flow has the same shape (research → plan → implement → validate), so the touchpoints land naturally:

| Moment | Call | What it does |
|---|---|---|
| **Before work** | `/eng-harness-flow --hook pre-flight` | makes sure the harness is awake and ready (boot check) |
| **After the plan** | `/eng-harness-flow --hook pre-coding` | validates back pressure — *can we prove this work is done, deterministically?* It may suggest strengthening the harness **before** you start |
| **After the work** | `/eng-harness-flow --hook post-flight` | retro + magic wand: gathers how the harness did and what to improve — the self-improving loop |

That is the whole integration: one skill, three call-sites. (The full hook list and their `--event` aliases are in [03 · The Harness Loop](03-the-harness-loop.md).)

## When to use which
- **No established SDD flow, or want one turnkey** → Path A (`the-flow`).
- **You already have a flow you trust** → Path B (BYO + the three touchpoints).

Either way you get the same payoff: deterministic proof before "done," and a loop that improves itself. You are never forced off the workflow your team already knows.

> **Three names, kept straight:**
> - **`/the-flow`** — the built-in **spec-driven design loop** (research → plan → implement → validate). This is what you type to drive a piece of work.
> - **`/eng-harness-flow`** — the single **loop skill** you call at the three moments above. It works with `the-flow` or your own flow.
> - **`harness flow`** — the **deterministic workflow engine** on the CLI (it creates and inspects a flow as a structured DAG). `the-flow` builds on it as a dependency; you rarely call it directly.
>
> You don't need to master the distinction to use the harness — orient here, and follow the links when you want depth.

## Where next
- The loop these touchpoints drive → [03 · The Harness Loop](03-the-harness-loop.md).
- The daily rhythm of a session → [09 · Operating the Loop](09-operating-the-loop.md).

---

<sub>[← Prev: Multi-Repo & Org Rollout](07-multi-repo-and-org-rollout.md) · [↑ Start Here](README.md) · [Next: Operating the Loop →](09-operating-the-loop.md)</sub>
