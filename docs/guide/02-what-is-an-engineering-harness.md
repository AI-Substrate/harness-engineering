# What Is an Engineering Harness?

> **The missing layer between your agent and your product.** For anyone deciding whether this is worth their time. ~7 min.

You have felt this: the plan was perfect, the tests are green, the agent says "done" — and then you open it and something is obviously wrong. Or the agent *did* finish, but it burned twenty-five minutes mid-run just figuring out how to start the app and check an endpoint. Both are the same gap: nothing in the project could **prove** the work, cheaply and deterministically, so the agent (and you) had to infer it.

An **engineering harness** closes that gap.

## Two different harnesses (don't conflate them)

| | **Agent harness** | **Engineering harness** |
|---|---|---|
| Makes operable… | the **model** | the **productisation of your engineering environment** |
| Examples | Copilot, Claude Code, Cursor, Codex, Cline | `harness doctor`, a repo-authored `boot`, your tests, fixtures, checks |
| Job | tool dispatch, permissions, memory, orchestration | boot, run, seed, observe, and **prove** real behaviour |

The agent harness *drives*. It does not *replace* the project-side loop. A model runtime can coordinate work, but only the project-side harness can prove the actual software behaves correctly. Productive agentic engineering needs both — but the harness this guide is about is the **engineering** one.

> For the agent-harness side of the line — what a coding agent runtime actually is — see [this overview of agent harnesses](https://code.visualstudio.com/blogs/2026/05/15/agent-harnesses-github-copilot-vscode). This guide stays on the engineering-harness side.

## The missing layer

![The engineering-harness layers](../media/harness-layers.png)

Every new agent session is basically a fresh developer onboarding into your codebase. If the only way to operate your repo is scattered `AGENTS.md` paragraphs, half-remembered package scripts, and tribal setup steps, the agent has to infer too much — and you pay for every inference, in tokens and in trust.

The harness makes that operating layer a **first-class, productised surface**: the repo-local commands, fixtures, docs, checks, state, and review paths that every future feature, human, and agent passes through. It is not a separate installable product — it lives in your repo. A small CLI usually works well as its front door, because agents are very good at using CLIs: verbs, help text, stable arguments, exit codes, and structured output they can probe with `--help` instead of guessing.

## The deterministic layer is the point

The highest-value harness knowledge is **executable**, not written down:

- A prompt that says *"follow our architecture"* is a start. An architecture check that **fails** when the rule is violated is much better.
- A prompt that says *"make sure it still builds and runs"* can burn tokens. A `harness boot` extension (one your repo authors) plus a smoke check is much better.

The agent can *say* it is done. The harness decides whether that claim is supported by **evidence** — compilers, type systems, schemas, linters, tests, architecture checks, boot probes, and smoke tests that can refuse weak work directly. Deciding *which* evidence is enough is itself work you and the agent can do together up front — the `/grill-agent-done` companion interrogates each claim of done until it rests on a real check, a named reviewer, or explicit human judgement rather than confidence. This is back pressure, and turning it from a human review habit into part of the repo is what earns trust over time.

> The companion idea — **encode the fix, not the memory** — is the rule that quietly does the most work. We come back to it in [10 · Encoding & Learning Loops](10-encoding-and-learning-loops.md).

## Keep reading
- The canonical, vivid version of this argument: [`harness-foundations/simple-mode.md`](../../harness-foundations/simple-mode.md) and the [layered visual intro](../static-site/layers.html).
- The fuller principle set (58 of them): [`harness-foundations/first-principles.md`](../../harness-foundations/first-principles.md).
- How the harness actually *runs* as a loop → next.

---

<sub>[← Prev: Quick Start](01-quick-start.md) · [↑ Start Here](README.md) · [Next: Harness Engineering vs an Engineering Harness →](02b-harness-engineering-vs-an-engineering-harness.md)</sub>
