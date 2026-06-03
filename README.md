# Harness Engineering

Harness engineering is the practice of productising the software-development loop so humans and agents can move from intent to evidence, then encode what they learn into the next run.

This repo is a public foundation and tutorial project for teams that want faster, safer, more observable development loops in the age of AI-assisted engineering.

## Install the setup skill

This repo publishes the engineering-harness setup/provisioning skill consumable by [`npx skills@latest`](https://github.com/vercel-labs/skills).

```bash
npx skills@latest add AI-Substrate/harness-engineering \
  -a claude-code \
  -g
```

To install the setup skill from remote GitHub into the **current repository** for GitHub Copilot CLI and Cursor, omit `-g`:

```bash
npx skills@latest add AI-Substrate/harness-engineering \
  -a github-copilot \
  -a cursor \
  -y \
  --copy
```

This writes the skill to `./.agents/skills/`, the project-local location used by both targets.

For GitHub Copilot CLI, Codex CLI, OpenCode, Pi, project-local installs, local-branch testing, and single-skill installs, see [`INSTALL.md`](./INSTALL.md).

## Core thesis

An engineering harness makes the **product-development loop** explicit and operable:

```text
Boot -> Backpressure Check -> Do Work and Observe -> Retro and Magic Wand -> Improve
```

- **Boot** proves the product can start from a known state.
- **Backpressure Check** is an LLM-assisted, advisory survey of the current scope against the deterministic sensors the repo exposes.
- **Do Work and Observe** exercises real product behaviour through supported surfaces and captures what happened in inspectable forms.
- **Retro and Magic Wand** turns friction, missing signals, and improvement wishes into reviewable candidates.
- **Improve** encodes what was learned so the next run is faster, clearer, safer, or backed by stronger signals.

The harness is not throwaway scaffolding. It is a **productised development surface**: the repo-local commands, fixtures, docs, checks, state, workflows, proof paths, and feedback loops every future feature, experiment, human, and agent passes through.

## Engineering harness versus agent harness

This repo is about the **engineering harness**, not agent runtimes themselves.

| Layer | Makes operable | Examples | Proves |
|---|---|---|---|
| Engineering harness | The product and its development loop | boot commands, build/test/run flows, seed data, fixtures, health checks, diagnostics, proof bundles, retros, encoded improvements | Whether the actual product can run and prove behaviour |
| Agent harness | The model as a tool-using agent | tool dispatch, permissions, context, session management, orchestration, memory, execution environment | Whether an agent can attempt or coordinate work |

An agent harness can drive an engineering harness, but it cannot replace one. If the product cannot boot, run, seed, observe, and prove behaviour, the agent has nothing reliable to operate.

## Backpressure

A useful harness is also a **backpressure system**.

Backpressure is project-side feedback that makes wrong, unsafe, incomplete, or unproven work hard to continue and easy to correct. It is how the harness says: **not yet, and here is why**.

Good backpressure includes:

- type checks, compilers, linters, schemas, tests, and proof gates;
- health checks, doctor commands, browser traces, logs, screenshots, and database checks;
- structured command output with failure categories and next actions;
- proof artefacts that show what passed, what remains unproven, and how to rerun;
- human judgement routes for decisions machines cannot make.

Prompts and checklists are useful guides, but high-risk or repeated invariants should move into the strongest practical refusal surface: a command, type, schema, fixture, validation, generated guard, diagnostic, or reviewable proof path.

The goal is not to add ceremony. The goal is to stop wasting human attention on machine-checkable failure and reserve human judgement for ambiguity, product intent, tradeoffs, taste, risk, and non-executable criteria.

## What this repo contains

- [`harness-foundations/first-principles.md`](harness-foundations/first-principles.md): the current first-principles foundation.
- [`harness-foundations/patterns-that-work.md`](harness-foundations/patterns-that-work.md): practical patterns for making the principles real.
- [`harness-foundations/directives.md`](harness-foundations/directives.md): concise operating commitments for the engineering-harness concept.
- [`harness-foundations/source-notes/`](harness-foundations/source-notes/): public-safe source syntheses and traceability notes.

## How to read this project

Start with the first-principles document if you want the thesis. Read the patterns if you want practical moves. Read the directives if you want the shortest operating version.

A good first question for any repo is:

> Can a fresh human or agent move from clean start to proved product behaviour without private tribal knowledge?

If the answer is no, the engineering harness is the product surface to improve.

## Publication boundary

This repo distils private and public research into general, publication-safe principles. Raw notes and private source material live outside the public surface. Public content should avoid private names, internal codewords, local paths, unreleased details, and exact private metrics unless explicitly approved.

## Skill authored here

For a practical guide to when to run this setup skill and how it fits the upstream runtime loop, see [`skills/README.md`](skills/README.md).

- [`skills/engineering-harness-setup/`](skills/engineering-harness-setup/SKILL.md): creates or validates a repo-local engineering harness nucleus: `docs/project-rules/engineering-harness.md`, a starter `harness/cli/` command surface and sensor inventory, `docs/harness` improvement surfaces, and an `AGENTS.md` route for future agents.
- [`skills/engineering-harness-orient/`](skills/engineering-harness-orient/SKILL.md): runs after setup to produce a target-aware harnessability report with command tiers, proof readiness, first-session guidance, and proposal-only codebase affordance recommendations.

Runtime loop skills now live upstream in `jakkaj/tools`:

- `harness-1-boot`
- `plan-2d-backpressure-survey` (the advisory Backpressure Check)
- `harness-2-observe`
- `harness-3-retro`

This repo remains the public foundations and setup surface. The tools repo owns the canonical runtime loop.
