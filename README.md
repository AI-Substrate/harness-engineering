# Harness Engineering

Harness engineering is the practice of productising the software-development loop so humans and agents can move from intent to evidence, then encode what they learn into the next run.

This repo is a public foundation and tutorial project for teams that want faster, safer, more observable development loops in the age of AI-assisted engineering.

It is also the **home of the harness product itself**: the harness CLI (`harness/cli/`) and the engineering-harness skills (`skills/`) are authored here and deployed into *other* repos — which consume them via `npx skills` / `harness skills install`. We also **dogfood** the harness on this repo. When working here, keep the two modes distinct: *editing* the CLI or skills is product development that ships to every consumer, whereas *running* the loop skills is dogfooding this checkout. See [`AGENTS.md`](./AGENTS.md#this-repos-dual-role) and the constitution (`docs/project-rules/constitution.md` §1) for the full framing.

## Install the skills

This repo publishes its engineering-harness skills — a **setup group** (`skills/eng-harness-setup/`) and the **interactive loop group** (`skills/eng-harness-loop/`) — consumable by [`npx skills@latest`](https://github.com/vercel-labs/skills). The harness CLI also wraps this in a first-class `harness skills install` command (a transparent pass-through to the same installer — see [`INSTALL.md`](./INSTALL.md)).

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

Both generic commands above install every skill this repo publishes (the `eng-harness-setup` group + the `eng-harness-loop` group). To install a single skill, add `-s <skill-name>` — for example the harnessability assessment skill, project-local for GitHub Copilot CLI:

```bash
npx skills@latest add AI-Substrate/harness-engineering \
  -s eng-harness-0-harnessability-assessment \
  -a github-copilot \
  -y
```

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

## Skills authored here

For a practical guide to when to run the setup skill and how the loop skills fit, see [`skills/README.md`](skills/README.md).

**Setup group** — [`skills/eng-harness-setup/`](skills/eng-harness-setup/):

- [`eng-harness-0-setup`](skills/eng-harness-setup/eng-harness-0-setup/SKILL.md): installs and validates the repo-local engineering harness nucleus — the CLI command surface, sensor inventory, improvement surfaces, and an `AGENTS.md` route — and coordinates the governance doc at `.harness/engineering-harness.md` (provisioning it is the deferred `harness init` writer; the doc itself stays hand-maintained).
- [`eng-harness-0-harnessability-assessment`](skills/eng-harness-setup/eng-harness-0-harnessability-assessment/SKILL.md): scores a repository's harnessability across Operate-Today and Adaptability, mapping back-pressure surfaces, proof ceilings, external-dependency exposure, command tiers, first-session guidance, and proposal-only codebase affordance recommendations.
- [`eng-harness-0-add-extension`](skills/eng-harness-setup/eng-harness-0-add-extension/SKILL.md): the guided path for authoring a new `harness <verb>` extension.

**Loop group** — [`skills/eng-harness-loop/`](skills/eng-harness-loop/) (the interactive Boot → Backpressure → Observe → Retro loop, now hosted here):

- `eng-harness-1-boot`
- `eng-harness-2-backpressure` (the advisory Backpressure Check)
- `eng-harness-4-retro` (the friction lifecycle — in-flight capture via the `harness observe` CLI verb, drain, harvest)

The Observe/Retro stages are backed by a core CLI command: **`harness record <type>`** scaffolds a templated record (starting with `retro`) into `.harness/records/<type>/` and returns its path for the agent to fill. Observe jots crash-resilient working notes to the gitignored scratch buffer `.harness/temp/<agent>/`; `eng-harness-4-retro --drain` then materialises a **committed** record under `.harness/records/`. Record types are a generic 4-field contract loadable from core or extensions — see [`docs/how/record-and-record-types.md`](docs/how/record-and-record-types.md).

### Dogfooding the harness on itself

Two repo-local dogfood extensions exercise the harness against real, unfamiliar repos by firing parallel `minih` workers: `harness validate-harnessability` runs the *assessment* skill on each clone, and `harness validate-harness-flow` runs the **entire setup flow** (assess → governance → boot → retro), then `--collect` aggregates the workers' records + reports. See [`docs/how/dogfood-harness-flow.md`](docs/how/dogfood-harness-flow.md). Collected retros are **surfaced, never auto-implemented**.

