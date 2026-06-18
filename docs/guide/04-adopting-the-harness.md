# Adopting the Harness

> **The onboarding walkthrough, step by step.** For an engineer bringing the harness into a repo for the first time. ~15 min to read; longer to do.

[01 · Quick Start](01-quick-start.md) got you moving fast. This is the same journey, unhurried — what each step does, why it is there, and where a decision is yours to make. You can drive it yourself, or hand it to your agent.

## What actually changes in your repo
Almost nothing. Adoption adds **one directory** — `.harness/` — and (optionally) installs skills into your agent. Your build, tests, CI, and workflow stay exactly as they are. The harness *wraps* what you already have; it does not replace it. ([06 · Repo Layouts](06-repo-layouts.md) shows the full tree.)

## Two ways to drive it
- **You drive, the agent helps** — you run the commands; the agent answers questions and authors extensions on request.
- **The agent drives, you approve** — point the agent at the repo and let it bootstrap, then review what it did.

> 🚧 **TODO(confirm):** the agent drop-file is surfaced as `harness docs agents-readme`; the underlying source file is `AGENTS_README.md`. Confirm the exact filename/anchor the agent path should reference once onboarding (plan 023) settles.

## The shape of it: five rungs
The `/eng-harness-flow` router walks you up an **adoption gate**, in order, with **boot last**:

**Install → Scout → Governance → Inject → Boot**

Boot comes last on purpose — you boot once the repo knows how it wants to be operated. Below is that gate as concrete commands.

## Step by step

### 1 · Install the CLI
```bash
npm install -g @ai-substrate/engineering-harness
harness doctor
```
`doctor` confirms the CLI is healthy and shows which extensions loaded — none yet, which is expected on a fresh repo.

### 2 · Install the skills, run the router
```bash
harness skills install --target claude-code --global   # `--help` lists targets
# reload skills in your agent (often `/skills reload`), then:
/eng-harness-flow
```
`/eng-harness-flow` is stateless and self-detecting: on an un-adopted repo it sees there is no harness yet and routes you to the first rung. From here you are following its lead — it offers the next step at each stage.

### 3 · Scout — harnessability assessment
The router offers a **harnessability assessment**: a read-only survey of how operable your repo is today (can it boot? what sensors exist? what is missing?). It produces a report under `.harness/reports/harnessability/`.

> 🚧 **TODO(confirm):** the harnessability assessment is an **LLM-assisted skill** — your agent *assembles* it by following the skill, not a single deterministic `harness` command. Phrase expectations accordingly; do not promise one-command determinism here.

### 4 · Governance — fill in the operating doc
```bash
harness init     # idempotent; seeds .harness/engineering-harness.md and prints its path
```
`harness init` seeds the **governance doc** skeleton — your repo's short "how this project wants to be operated" brief (boot command, key checks, known difficulties). The Governance rung is where you fill that skeleton in, informed by the scout. (Quick Start stamps this early; either order is fine — the file is the same.)

### 5 · Inject — tell your workflow where to call the harness
Record where your team's flow should hit the loop's touchpoints — session start, after a spec, after a phase, at completion. This **injection map** is captured in `.harness/engineering-harness.md`. The hooks themselves are in [03 · The Harness Loop](03-the-harness-loop.md); choosing which to wire in is [08 · Fitting Your Workflow](08-fitting-your-workflow.md).

### 6 · Boot — author your first extension and prove it
```bash
harness new boot --wrap "<your real start command>"
harness doctor      # boot now shows as a loaded extension
harness boot        # starts your product from a known state — and proves it
```
`boot` is the first **extension** you author — a small package under `.harness/extensions/boot/`. `harness new … --wrap` scaffolds it around a command you already have — you rarely hand-write much, and your agent can guide you through it ([12 · Extending the Harness](12-extending-the-harness.md) goes deeper). A green `harness boot` is the finish line: a cold human or agent can now start your product and trust the result.

## It is resumable
Adoption is a journey, not a single sitting. The router is stateless: each time you call it, it re-derives the next likely rung from your repo's signals, so you can stop and pick up later without losing your place.

> 🚧 **TODO(confirm):** onboarding resumability is being made first-class in plan 023 (an ephemeral `.harness/temp/adopt-flow.json` that survives a context compaction, plus cold-start discoverability). Treat the resume mechanism as "it picks up where you left off"; the exact state file is 023's contract and may change.

## Where next
- Choose how you'll work day-to-day — the built-in `the-flow`, or your own flow plus the harness's three touchpoints → [08 · Fitting Your Workflow](08-fitting-your-workflow.md).
- The skills you just installed, and what each does → [`skills/README.md`](../../skills/README.md).
- Driving a harness that is already set up → [05 · Using an Existing Harness](05-using-an-existing-harness.md).
- Adding stronger proof beyond boot → [11 · Backpressure Patterns](11-backpressure-patterns.md).

---

<sub>[← Prev: The Harness Loop](03-the-harness-loop.md) · [↑ Start Here](README.md) · [Next: Using an Existing Harness →](05-using-an-existing-harness.md)</sub>
