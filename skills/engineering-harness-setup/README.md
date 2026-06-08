# engineering-harness-setup

Install a repo's **engineering harness** from npx and guide the user to a working basic `boot` — the command every engineering task starts from.

This skill is a **flow**, not a generator. It installs the harness CLI, then orchestrates two sibling skills — `harnessability-assessment` (size up the repo) and `add-extension` (author the first extension). It **creates no files of its own**: the deterministic substrate (the `.harness/` nucleus, retros, known-difficulties, back-pressure surfaces) is owned by the harness CLI as real code, and by a future `harness init`.

> **The agent harness drives. The engineering harness proves.**

## The flow

```mermaid
flowchart TD
    A["1 · Install harness<br/>npx + (future) harness init"] --> Ad{harness doctor OK?}
    Ad -- no --> At["Troubleshoot<br/>Node · network/gh · build"] --> A
    Ad -- yes --> C{".harness/reports/harnessability/latest.json<br/>exists?"}
    C -- no --> D["2 · Run harnessability-assessment skill"] --> E
    C -- yes --> E["Read assessment recommendations"]
    E --> F["3 · add-extension skill →<br/>basic `boot` (wrap build / run / health)"]
    F --> V["Verify · harness doctor / harness boot / harness help"]
```

## When to use

Run this when a repo has no working `harness boot` (or no harness front door at all) and you want an agent-operable engineering loop started quickly. Safe to re-run — it detects what already exists and only fills the gap.

## What it does

1. **Install the harness** via `npx github:AI-Substrate/harness-engineering`, make `harness` resolve locally (`npm install github:AI-Substrate/harness-engineering`), initialise the nucleus with `harness init` (graceful fallback if your CLI predates it), and sanity-check with `harness doctor`.
2. **Assess harnessability** — only if no report exists at `.harness/reports/harnessability/latest.json`. Runs the `harnessability-assessment` skill and reads its recommendations.
3. **Stand up a basic `boot`** — via the `add-extension` skill, wrapping the repo's real readiness command (build / run / health) chosen from the assessment. Boot returns a ready/degraded/error verdict and re-orients the agent.

## Why `boot`

"Boot is the first proof." Before coding, an agent runs `harness boot` to prove the environment is ready **and** to be reminded how the harness works. The deliverable here is a **working boot, even if basic** — a thin wrapper over existing commands. Don't boil the ocean; the harness is self-improving, so boot grows by use.

## What it does **not** do

- No governance doc, `AGENTS.md` block, `docs/harness/` scaffold, placeholder CLI, or retro/known-difficulties files — those are `harness init` / CLI concerns.
- No reimplementation of `harnessability-assessment` or `add-extension` — it calls them.
- No comprehensive boot — basic nucleus only.

## Where it fits

```text
engineering-harness-setup  ->  harnessability-assessment  ->  add-extension (boot)  ->  runtime loop
   install + drive the CLI       report-only readiness         author the nucleus       boot · work · observe · retro · improve
```

Use **setup** to install and bootstrap. Use **harnessability-assessment** to get a target-aware readiness picture (it writes `.harness/reports/harnessability/`). Use **add-extension** to author `boot` (and later extensions). Use the runtime harness-loop skills to operate day to day.

## Agent harness vs engineering harness

The agent harness is adjacent to the engineering harness; it does not replace it.

```mermaid
flowchart LR
    A["Agent harness<br/>model, tools, permissions, context"] -->|"drives"| H["Engineering harness<br/>commands, boot, observe, prove, improve"]
    H -->|"proves"| P["Product behavior<br/>what actually works"]
```

The boundary sentence is load-bearing: **The agent harness drives. The engineering harness proves.**
