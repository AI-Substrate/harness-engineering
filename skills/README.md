# Engineering Harness Skill Suite

This directory contains the installable skills this repo publishes through `npx skills`.

The skills are designed as a small operating loop:

```text
Install skills -> setup harness -> boot session -> do work -> track friction -> bubble learning -> harvest improvements -> encode fixes
```

The broader plan is to make harness engineering practical for people who have not used the concept before. The user should not need to understand every principle up front. They install the skills, run the setup skill if the repo has no harness, start each session with `boot-harness`, and let the compound skills keep the Improve stage alive.

## Quick start

Install all skills globally for a CLI, for example Claude Code:

```bash
npx skills@latest add AI-Substrate/harness-engineering -a claude-code -g
```

Install from this working tree while developing the skills:

```bash
just install-skills-global
```

List what this repo exposes:

```bash
just list-skills
```

## Which skill do I run?

| Situation | Run | Why |
|---|---|---|
| The repo has no engineering harness contract or starter command surface | `engineering-harness-setup` | Creates or validates `docs/project-rules/engineering-harness.md`, scaffolds `harness/cli/`, and points future agents at it from `AGENTS.md`. |
| Starting an engineering session | `boot-harness` | Reads the harness, checks safe boot/health surfaces, reviews known difficulties, and tells the agent how to work through the harness. |
| The repo has no Improve ledger | `compound-0-setup` | Scaffolds `docs/compound/`, the durable storage for friction, retros, and encoded-improvement candidates. |
| The agent hits material friction during work | `compound-1-track` | Silently records the friction or magic-wand idea in the current agent's session buffer. |
| The session or phase is ending | `compound-2-bubble` | Shows one user-facing triage prompt and saves selected entries as durable retros. |
| The team wants to know what to improve next | `compound-3-harvest` | Clusters saved retros by recurrence, severity, and age so harness improvements can be prioritized. |

## The intended loop

### 1. Install the skills

Install from the published repo or from a local checkout. See [`../INSTALL.md`](../INSTALL.md) for per-client commands.

### 2. Set up the engineering harness

Run `engineering-harness-setup` when a target repo does not already have a harness contract.

Expected outcomes:

- `docs/project-rules/engineering-harness.md` exists or is validated.
- `harness/cli/` exists with a starter command map and Python, Node, or existing-tool entry point.
- The starter CLI has agent-friendly `--help` and actionable errors that say what to do next.
- `AGENTS.md` signposts future agents to the harness.
- Known difficulties can be seeded from `docs/compound/` once the compound loop exists.
- Missing boot, health, observe, or validation surfaces are named as harness gaps.

### 3. Boot the harness at session start

Run `boot-harness` when getting ready to work.

Expected outcomes:

- The agent reads the harness contract instead of guessing commands.
- Safe doctor, health, or dry-run checks are attempted where configured.
- Known difficulties and Improve-loop storage are reviewed.
- If no harness exists, the skill fails fast and recommends `engineering-harness-setup`.
- If no compound ledger exists, the skill recommends `compound-0-setup`.

### 4. Track friction during work

Use `compound-1-track` silently when the agent sees meaningful friction:

- confusing boot, build, test, health, auth, or observe failures;
- repeated retries or backtracking;
- slow or missing commands;
- unclear errors;
- missing fixtures, seed data, evidence paths, or validation checks;
- a concrete "if only there were..." improvement idea.

This skill should not interrupt the user. It is the quiet capture side of the loop.

### 5. Bubble once at a natural pause

Run `compound-2-bubble` at session end, phase end, before handoff, or when a new session starts with leftover buffer entries.

This is the one normal user-facing compound prompt. The user can save, task, plan, stage an encoding, dismiss, or all-save entries.

### 6. Harvest periodically

Run `compound-3-harvest` when there are enough saved retros to reveal patterns, or before planning harness improvement work.

Harvest answers:

- what keeps recurring;
- which issues are stale;
- which targets leak the most attention;
- what should be encoded next.

## How this fits the broader plan

The foundation documents explain the thesis: the engineering harness is the project-side loop that makes product work bootable, observable, provable, and improvable.

The skills make that thesis operational:

| Foundation idea | Skill-suite affordance |
|---|---|
| Boot -> Interact -> Observe -> Validate -> Improve | `engineering-harness-setup` records the loop; `boot-harness` starts sessions through it. |
| The harness is the front door, not a replacement toolchain | `engineering-harness-setup` creates `harness/cli/` as a discovery/wrapper surface over existing commands first. |
| Encode the fix, not the memory | Compound entries must name a candidate encoded fix, not just a complaint. |
| Agents are real harness users | `compound-1-track` treats agent friction as product feedback for the harness. |
| Retrospectives need a lifecycle | `compound-2-bubble` and `compound-3-harvest` move entries from buffer to durable retro to prioritized improvement. |
| Known difficulties should be visible at boot | `engineering-harness-setup` can seed Known Difficulties from compound retros; `boot-harness` reviews them before work starts. |

## Operating rules

- Use `boot-harness` before non-trivial work in a repo that has a harness.
- If `boot-harness` says no harness exists, run `engineering-harness-setup`.
- If `boot-harness` says the Improve loop is missing, run `compound-0-setup`.
- Track friction quietly during work; do not nag the user mid-flow.
- Bubble once at a natural pause.
- Harvest when recurring friction should influence planning or harness maintenance.
- Wrap existing build/test/run/seed/health commands before inventing new harness behavior.
- Prefer encoded fixes: commands, checks, fixtures, diagnostics, templates, defaults, or evidence paths.

## Installable skills

| Skill | Path |
|---|---|
| `engineering-harness-setup` | [`engineering-harness-setup/SKILL.md`](engineering-harness-setup/SKILL.md) |
| `boot-harness` | [`boot-harness/SKILL.md`](boot-harness/SKILL.md) |
| `compound-0-setup` | [`compound-0-setup/SKILL.md`](compound-0-setup/SKILL.md) |
| `compound-1-track` | [`compound-1-track/SKILL.md`](compound-1-track/SKILL.md) |
| `compound-2-bubble` | [`compound-2-bubble/SKILL.md`](compound-2-bubble/SKILL.md) |
| `compound-3-harvest` | [`compound-3-harvest/SKILL.md`](compound-3-harvest/SKILL.md) |
