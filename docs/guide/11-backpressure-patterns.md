# Backpressure Patterns

> **The deterministic proof ladder.** For anyone deciding how to prove "done" without relying on the agent's say-so. ~7 min.

Back pressure is the signal that tells you — deterministically — how the work is *truly* doing: build failures, type errors, test failures, lint, runtime failures, smoke checks, architecture checks. The agent can *say* it is done; back pressure is what actually decides.

A useful harness layers these sensors from cheap-and-shallow to expensive-and-real, so cheap failures fail fast and nothing reaches "done" on a weak signal.

## The ladder (cheapest first, most real last)

| Rung | Sensor | Catches | Cost |
|---|---|---|---|
| 1 | **Compile · type · lint** | syntax, type errors, obvious smells | very cheap |
| 2 | **Unit tests** | logic in isolation | cheap |
| 3 | **Architecture checks** | structural drift, boundary violations, reinvention | cheap |
| 4 | **Build · boot · smoke** | does it actually start and serve? | medium |
| 5 | **End-to-end / browser** | real user workflows behave | higher |
| 6 | **Health / runtime probes** | it is genuinely up and behaving | higher |

Work down the ladder until the proof matches the risk. A green **unit** suite is necessary but not sufficient — if your team's real failures happen at startup, rendering, integration, architecture drift, or security boundaries, you need the rungs that exercise *those*.

## These are extensions, not built-ins
Rungs 3–6 are things **you author as extensions** for your repo — `arch-check`, `smoke`, `boot`, a browser check — because only your repo knows what "started and serving" means. They are **not** core `harness` commands; they appear in `harness help` once you add them. ([12 · Extending the Harness](12-extending-the-harness.md) shows how.)

## Choosing what to add next
You do not build the whole ladder at once. The harness loop tells you where the gap is: when you call `/eng-harness-flow --hook pre-coding` after a plan, it surveys the scope against the sensors you already have and flags what is missing to prove *this* particular work. Add the rung that closes that gap, then continue.

## Defending the proof — `/grill-agent-done`

The survey tells you *what* is missing; it does not pin down *why* a chosen check is enough. When coverage comes back thin, `/grill-agent-done` interrogates the definition of done one claim at a time — driving the question *"what realistic wrong implementation would still pass the checks you just named?"* — until each claim is lined up against the right grade of proof (`deterministic`, `inferential`, or `human-judgement`), or knowingly handed to a named reviewer. You and the agent work through it together. It is a companion to the survey, not a stage and not a gate: it never blocks, and the verdict still comes from running the sensors.

> **The principle:** turn back pressure from a human review habit into part of the repo. A check that fails on the rule is stronger than a prompt that asks the agent to remember it.

## Keep reading
- Architecture checks in depth → [`docs/how/architecture-conformance.md`](../how/architecture-conformance.md).
- Authoring the extensions that provide these rungs → [12 · Extending the Harness](12-extending-the-harness.md).

---

<sub>[← Prev: Encoding & Learning Loops](10-encoding-and-learning-loops.md) · [↑ Start Here](README.md) · [Next: Extending the Harness →](12-extending-the-harness.md)</sub>
