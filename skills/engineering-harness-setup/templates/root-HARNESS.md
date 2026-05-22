---
maturityLevel: L1
maturityLadder: harness-maturity
canonicalBoundary: true
---

<!-- foundations: first-principles#10, #27, patterns-that-work#P3, #P10–P14, directives#D1–D6 -->

# Engineering Harness

This repository uses a repo-local engineering harness.

The agent harness is the model runtime: the system that drives a coding agent through tool calls and session state.

The engineering harness is this repository's project-side development loop: boot, build, run, seed, interact, observe, test, validate, diagnose, and improve.

The agent harness drives. The engineering harness proves.

## Maturity level

This harness self-reports its maturity on the **harness-maturity ladder** (L0–L4). This is distinct from the **proof-level ladder** (L0–L6) which classifies what individual harness commands prove about the product. The two ladders compose: a mature harness (high on this ladder) can still produce low-proof-level results when commands are missing or unconfigured.

| Level | Meaning |
|---|---|
| L0 | No harness. Commands live in tribal knowledge, scattered docs, or ad-hoc scripts. |
| L1 | Front door installed. `HARNESS.md`, `harness/`, CLI skeleton, AGENTS.md pointer exist. Commands may be unconfigured. **(this repo, just installed)** |
| L2 | Commands encoded. Build/test/run/health are confirmed and runnable. `<CLI> validate --tier quick` returns useful verdicts. |
| L3 | Improvement loop active. Friction log has entries; at least one entry has been encoded into the harness; magic-wand prompts have resulted in shipped harness changes. |
| L4 | Self-improving. The harness regularly produces improvements during normal work; new agents reliably onboard without human help; proof-level ceilings are tracked. |

Update the frontmatter `maturityLevel` when a meaningful step is reached. Higher levels are not the goal of the harness; they are a side effect of using it.

## Front door

Prefer the harness CLI over raw commands where a harness command exists.

Current harness CLI:

```txt
{{HARNESS_CLI_INVOCATION}}
```

Start with:

```txt
{{HARNESS_CLI_INVOCATION}} --help
{{HARNESS_CLI_INVOCATION}} doctor
```

## Operating loop

Use the harness to move from intent to evidence:

```txt
Boot → Interact → Observe → Validate → Improve
```

- Boot: prove the product can start from a known state.
- Interact: exercise meaningful behaviour through supported surfaces.
- Observe: capture logs, responses, screenshots, generated files, events, or other evidence.
- Validate: turn evidence into a verdict.
- Improve: encode what was learned so the next run is better.

## Phase Gates

Gates connect repository-state milestones to harness commands. When the repo reaches a milestone, the listed gate command must pass before the milestone is claimed.

| Milestone | Gate command | What it proves |
|---|---|---|
| Code change is ready to commit | `{{HARNESS_CLI_INVOCATION}} validate --tier fast` | Tests for the changed area pass; quick feedback (<60s typical). |
| Pull request is ready for review | `{{HARNESS_CLI_INVOCATION}} validate --tier quick` | doctor + build + test pass on a clean checkout. |
| Release is ready to claim | `{{HARNESS_CLI_INVOCATION}} fft` (alias for `validate --tier proof`) | Full proof: doctor + build + test + health + smoke. |

<!-- USER CONTENT START -->
<!-- Add repo-specific gates here. Each row should name the milestone, the exact harness command, and what passing the command means. Examples:
     - "Schema migration is ready"   → `<CLI> migrate --check`   → migration is reversible and dry-run succeeded.
     - "Deploy is ready for staging"  → `<CLI> smoke --env staging` → product responds to a real request in staging. -->
<!-- USER CONTENT END -->

## Core rules

### Rule 1. Make the harness the front door

Use harness commands before inventing raw command sequences.

If a command is missing, consider whether adding a harness command is better than adding another prose instruction.

### Rule 2. Encode the fix, not the memory

Do not only document repeated workarounds.

When practical, encode the solution as a command, check, fixture, default, diagnostic, template, error message, or validation path.

Documentation can orient. Executable knowledge compounds.

### Rule 3. Prefer deterministic validation over agent inference

Do not ask the agent to infer whether it is done when the repository can prove it.

Use build, test, lint, typecheck, boot, health, smoke, architecture, or other deterministic checks where possible.

If judgement remains non-executable, route it to a human with evidence.

### Rule 4. Treat friction as harness feedback

When a human or agent gets stuck, classify the friction:

- instructions unclear;
- command missing;
- environment not bootable;
- setup too slow;
- seed data absent;
- validation weak;
- state not durable;
- error message unhelpful;
- supported path harder than shortcut.

Record material friction in `harness/state/friction-log.md`.

### Rule 5. Ask the magic-wand question

At the end of meaningful work, ask:

> If you had a magic wand, what ONE thing would you change to make the next run easier, safer, faster, or higher quality? Be concrete — name a command, flag, output field, fixture, diagnostic, template, or workflow change.

After human review, encode good suggestions into the harness.

## Current command map

The canonical command map lives in:

```txt
harness/config.json
```

Typical commands:

```txt
{{HARNESS_CLI_INVOCATION}} doctor
{{HARNESS_CLI_INVOCATION}} build
{{HARNESS_CLI_INVOCATION}} test
{{HARNESS_CLI_INVOCATION}} run
{{HARNESS_CLI_INVOCATION}} health
{{HARNESS_CLI_INVOCATION}} validate
{{HARNESS_CLI_INVOCATION}} onboard
{{HARNESS_CLI_INVOCATION}} fft         # alias for validate --tier proof
{{HARNESS_CLI_INVOCATION}} magic-wand
```

Unset commands are not failures by themselves. They are harness improvement opportunities.

## Definition of done for agent work

Before claiming work is complete, an agent should report:

1. What changed.
2. Which harness commands were run.
3. Which checks passed.
4. Which checks failed or were not configured.
5. What evidence was produced.
6. What remains unproven.
7. Any harness friction discovered.
8. One concrete magic-wand improvement candidate, if any.

Agent confidence is not completion evidence.

Where completion can be checked, use the harness.

Where completion requires judgement, give the human the evidence needed to decide.

## Known difficulties

Known project difficulties live in:

```txt
harness/state/known-difficulties.md
```

Do not let this become a dumping ground. Promote repeated difficulties into commands, checks, fixtures, or diagnostics.

## Friction log

Session friction and improvement candidates live in:

```txt
harness/state/friction-log.md
```

The friction log is an improvement backlog, not a diary.

Prioritise recurring, severe, or old issues.

<!-- USER CONTENT START -->
<!-- Add repo-specific harness notes below this line. The skill will preserve everything between the USER CONTENT sentinels on re-run. Suggested uses:
     - Local conventions specific to this codebase.
     - Team agreements about when to run fast vs proof gates.
     - Links to project-specific runbooks the harness CLI does not yet wrap. -->
<!-- USER CONTENT END -->
