# Engineering Harness Setup Skill

This directory contains the installable setup/provisioning skill this repo publishes through `npx skills`.

The setup skill prepares a project to participate in the operating loop now owned upstream in `jakkaj/tools`:

```text
Install setup skill -> setup harness -> tools runtime skills boot/observe/retro -> encode fixes/checks
```

The broader plan is to make harness engineering practical for people who have not used the concept before. The user should not need to understand every principle up front. They install this setup skill when a repo has no harness, then use the canonical runtime loop skills from `jakkaj/tools`: `harness-1-boot`, `harness-2-observe`, and `harness-3-retro`.

## Quick start

Install the setup skill globally for a CLI, for example Claude Code:

```bash
npx skills@latest add AI-Substrate/harness-engineering -a claude-code -g
```

Install from this working tree while developing the skill:

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
| Starting an engineering session after setup | `harness-1-boot` from `jakkaj/tools` | Reads the harness, checks safe boot/health surfaces, reviews known difficulties, and reports readiness. |
| Capturing friction during work | `harness-2-observe` from `jakkaj/tools` | Silently records material friction, signal gaps, or concrete improvement ideas. |
| Draining or harvesting retros | `harness-3-retro` from `jakkaj/tools` | Presents the end-of-session triage prompt and harvests recurring improvement candidates. |

## The intended loop

### 1. Install the setup skill

Install from the published repo or from a local checkout. See [`../INSTALL.md`](../INSTALL.md) for per-client commands.

### 2. Set up the engineering harness

Run `engineering-harness-setup` when a target repo does not already have a harness contract.

Expected outcomes:

- `docs/project-rules/engineering-harness.md` exists or is validated.
- `harness/cli/` exists with a starter command map and Python, Node, or existing-tool entry point.
- The starter CLI has agent-friendly `--help` and actionable errors that say what to do next.
- `AGENTS.md` signposts future agents to the harness.
- Known difficulties can be surfaced from `docs/harness/` once the harness improvement loop exists.
- Missing boot, health, observe, validation, sensor, or back-pressure surfaces are named as harness gaps.

### 3. Boot the harness at session start

Run `harness-1-boot` from `jakkaj/tools` when getting ready to work.

Expected outcomes:

- The agent reads the harness contract instead of guessing commands.
- Safe doctor, health, or dry-run checks are attempted where configured.
- Known difficulties and Improve-loop storage are reviewed.
- Runtime inspectability, smoke paths, architecture/static checks, and security/dependency/schema checks are surfaced where the harness names them.
- If no harness exists, the runtime skill reports `UNAVAILABLE` and recommends `engineering-harness-setup`.
- If no `docs/harness` ledger exists, the runtime loop reports the missing Improve surface without falling back to legacy paths.

### 4. Track friction during work

Use `harness-2-observe` from `jakkaj/tools` silently when the agent sees meaningful friction:

- confusing boot, build, test, health, auth, or observe failures;
- repeated retries or backtracking;
- slow or missing commands;
- unclear errors;
- missing fixtures, seed data, evidence paths, or validation checks;
- missing sensors or deterministic checks that would have caught runtime, architecture, security, schema, or user-flow risk;
- a concrete "if only there were..." improvement idea.

This skill should not interrupt the user. It is the quiet capture side of the loop.

### 5. Bubble once at a natural pause

Run `harness-3-retro --drain` from `jakkaj/tools` at session end, phase end, before handoff, or when a new session starts with leftover buffer entries.

This is the one normal user-facing harness retro prompt. The user can save, task, plan, stage an encoding, dismiss, or all-save entries.

### 6. Harvest periodically

Run `harness-3-retro --harvest` from `jakkaj/tools` when there are enough saved retros to reveal patterns, or before planning harness improvement work.

Harvest answers:

- what keeps recurring;
- which issues are stale;
- which targets leak the most attention;
- what should be encoded next;
- whether the next improvement should reduce friction, add back pressure, or both.

## How this fits the broader plan

The foundation documents explain the thesis: the engineering harness is the project-side loop that makes product work bootable, observable, provable, and improvable.

The setup skill and upstream runtime skills make that thesis operational:

| Foundation idea | Skill-suite affordance |
|---|---|
| Boot -> Backpressure Check -> Do Work and Observe -> Retro and Magic Wand -> Improve | `engineering-harness-setup` records the local nucleus; tools runtime skills operate the loop through it. |
| The harness is the front door, not a replacement toolchain | `engineering-harness-setup` creates `harness/cli/` as a discovery/wrapper surface over existing commands first. |
| Encode the fix, not the memory | Harness entries should name a candidate encoded fix, not just a complaint. |
| Agents are real harness users | `harness-2-observe` treats agent friction as product feedback for the harness. |
| Back pressure is a product feature | The harness exposes deterministic sensors; the advisory Backpressure Check asks whether scoped work has enough proof and what sensors are missing. |
| Retrospectives need a lifecycle | `harness-3-retro --drain` and `--harvest` move entries from buffer to durable retro to prioritized improvement. |
| Known difficulties and weak signals should be visible at boot | `engineering-harness-setup` can seed Known Difficulties from `docs/harness` retros; `harness-1-boot` reviews both friction and signal readiness before work starts. |

## Operating rules

- Use `harness-1-boot` from `jakkaj/tools` before non-trivial work in a repo that has a harness.
- If `harness-1-boot` says no harness exists, run `engineering-harness-setup`.
- If the runtime loop says the Improve surface is missing, run `engineering-harness-setup` to provision or validate the setup.
- Track friction quietly during work; do not nag the user mid-flow.
- Bubble once at a natural pause.
- Harvest when recurring friction should influence planning or harness maintenance.
- Wrap existing build/test/run/seed/health commands before inventing new harness behavior.
- Prefer encoded fixes: commands, checks, fixtures, diagnostics, templates, defaults, or evidence paths.
- Treat weak or missing signals as harness defects: if the agent had to infer runtime behaviour, architecture compliance, security posture, schema validity, or user-flow correctness, consider adding a deterministic sensor.

## Installable skill

| Skill | Path |
|---|---|
| `engineering-harness-setup` | [`engineering-harness-setup/SKILL.md`](engineering-harness-setup/SKILL.md) |

## Runtime loop skills

Install these from `jakkaj/tools`:

| Runtime skill | Source |
|---|---|
| `harness-1-boot` | `jakkaj/tools` |
| `harness-2-observe` | `jakkaj/tools` |
| `harness-3-retro` | `jakkaj/tools` |
