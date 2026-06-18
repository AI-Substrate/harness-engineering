# The Engineering Harness

An engineering harness productises the software-development loop so humans and agents can move from intent to evidence, then encode what they learn into the next run.

It is the **deterministic layer** between your agent and your codebase: one CLI focal point where a fresh human or agent can boot the product, prove a change is good, and encode the fix so the next run is easier.

## Quick start

**Fastest start — let your agent do it.** Paste this into your coding agent (Claude Code / Copilot / Cursor / Codex…), pointed at the repo you want to harness:

```text
Read https://raw.githubusercontent.com/AI-Substrate/harness-engineering/main/AGENTS_README.md
and follow it in this repo.
```

That one file is self-contained and re-entrant: the agent installs the CLI (if it's missing), installs the skills, and runs adoption — nothing needs to be set up first. If the agent loses context partway, paste the same line again and it picks up where it left off.

Prefer to drive it by hand? Follow **[01 · Quick Start](docs/guide/01-quick-start.md)** — install the CLI and skills yourself and reach a green boot.

## Documentation

New to the harness? Start with the **[adopter's guide](docs/guide/)** — a read-in-order path from zero to a green boot, on through operating, growing, and maintaining the harness. No prior context needed; written to read cleanly in the GitHub UI.

| If you want to… | Go to |
|---|---|
| **Adopt it**, step by step | [The adopter's guide](docs/guide/) — start at [01 · Quick Start](docs/guide/01-quick-start.md), then [04 · Adopting the Harness](docs/guide/04-adopting-the-harness.md) |
| **Understand the idea** | [02 · What Is an Engineering Harness?](docs/guide/02-what-is-an-engineering-harness.md) · [03 · The Harness Loop](docs/guide/03-the-harness-loop.md) |
| **See the visual intro** | [the deck](https://ai-substrate.github.io/harness-engineering/) (press `P` to present) · [the layers, one page](https://ai-substrate.github.io/harness-engineering/layers.html) |
| **Install the CLI or skills** | [INSTALL.md](./INSTALL.md) · [`harness/cli/README.md`](harness/cli/README.md) · [`skills/README.md`](skills/README.md) |
| **Read the thesis** | [`harness-foundations/`](harness-foundations/) — [first principles](harness-foundations/first-principles.md) · [patterns that work](harness-foundations/patterns-that-work.md) |
| **Contribute to this repo** | [`AGENTS.md`](./AGENTS.md) — this repo is the harness's own home |

Everything below explains *why* the harness exists and how it fits together. To just use it, the two links above are enough.

## Why it exists

Out of all the problems with agent-driven development, two matter most:

- **The loop closes too slowly.** The agent takes too long to get real feedback from your codebase, so it guesses, loops, or waits for a human.
- **The loop is hard to trust.** "Looks good to me" from a model is inference, not proof.

Underneath both: every agent session is a fresh developer onboarding into your repo — cold. If the supported path lives in scattered scripts, docs, and tribal memory, the agent has to infer it, and you pay for that inference every session, on every dev machine.

And the knowledge you *do* win tends to evaporate. Every correction — the workaround, the fix, the years of codebase instinct a human spends steering the agent right — usually lives only in that one session, then it's gone. Tomorrow the same friction hits a teammate, or your future self. An engineering harness gives that hard-earned knowledge a permanent home: **encode the fix, not the memory**, so every loop you solve makes the next one cheaper instead of being re-discovered from scratch. → [Encoding & Learning Loops](docs/guide/10-encoding-and-learning-loops.md)

> Can a fresh human or agent move from clean start to proved product behaviour without private tribal knowledge?

If the answer is no, the engineering harness is the surface to improve.

## The loop

An engineering harness makes the **product-development loop** explicit and operable:

```text
Boot -> Backpressure Check -> Do Work and Observe -> Retro and Magic Wand -> Improve
```

- **Boot** proves the product can start from a known state.
- **Backpressure Check** is an LLM-assisted, advisory survey of the current scope against the deterministic sensors the repo exposes — types, compilers, tests, schemas, health checks, proof gates. Backpressure is how the harness makes wrong, unsafe, or unproven work hard to continue and easy to correct: *not yet, and here is why*. → [Backpressure Patterns](docs/guide/11-backpressure-patterns.md)
- **Do Work and Observe** exercises real product behaviour through supported surfaces and captures what happened in inspectable forms.
- **Retro and Magic Wand** turns friction, missing signals, and improvement wishes into reviewable candidates.
- **Improve** encodes what was learned so the next run is faster, clearer, safer, or backed by stronger signals.

The harness is not throwaway scaffolding. It is a **productised development surface**: the repo-local commands, fixtures, docs, checks, state, proof paths, and feedback loops every future feature, experiment, human, and agent passes through. → [The Harness Loop](docs/guide/03-the-harness-loop.md)

## The layers

Intent flows down. Evidence flows up. The engineering harness is the **deterministic layer** — the one your repo probably doesn't have as a first-class thing.

<!-- Diagram source: docs/media/harness-layers.mmd — re-render to docs/media/harness-layers.png
     (image, not a ```mermaid block, so it renders on npm too — npm doesn't render Mermaid). -->
![The engineering harness layers — intent flows down, evidence flows up; the deterministic (engineering harness) layer sits between the inference layer and the codebase.](docs/media/harness-layers.png)

Reduce all that diffuse engineering-environment knowledge to a single focal point — the harness CLI — and a fresh agent explores it the way it explores `git`: it has never seen your repo, but it knows how to work a CLI. `--help` instead of tribal memory; one place deterministic verdicts live, evidence attached; one tangible place to encode the fix when friction shows up, so everyone on the repo gets it. The nucleus, in one line:

```text
[CLI focal point + required agent use] + [deterministic backpressure]
  + [friction capture] + [human-selected encoding] = engineering harness nucleus
```

## Install

The CLI is published to the **public npm registry** as `@ai-substrate/engineering-harness` — an **ambient global tool** (like `git`/`node`), installed once per machine and **never committed into a repo** (Node >= 22, no token or `.npmrc`):

```bash
npm install -g @ai-substrate/engineering-harness
harness doctor          # sanity-check the install
harness update          # later: upgrade to @latest (no-op if current)
```

Then install the **skills** — the choreography agents drive — published via [`npx skills`](https://github.com/vercel-labs/skills):

```bash
npx skills@latest add AI-Substrate/harness-engineering/skills -a claude-code -g
```

Swap `-a` for `github-copilot`, `codex`, `cursor`, `opencode`, `pi`…; drop `-g` for a project-local install. The CLI also wraps this as `harness skills install` / `harness skills update`. Full per-CLI matrix and update/prune notes: [`INSTALL.md`](./INSTALL.md), [`harness/cli/README.md`](harness/cli/README.md), [`skills/README.md`](skills/README.md).

## Engineering harness vs agent harness

This repo is about the **engineering harness**, not agent runtimes themselves. An agent harness can drive an engineering harness, but it cannot replace one: if the product cannot boot, run, seed, observe, and prove behaviour, the agent has nothing reliable to operate.

| Layer | Makes operable | Proves |
|---|---|---|
| **Engineering harness** | The product and its development loop — boot, build/test/run, seed data, fixtures, health checks, diagnostics, proof bundles, retros, encoded improvements | Whether the actual product can run and prove behaviour |
| **Agent harness** | The model as a tool-using agent — tool dispatch, permissions, context, session management, orchestration, memory, execution environment | Whether an agent can attempt or coordinate work |

## What's in this repo

| Area | What it is |
|---|---|
| [`harness-foundations/`](harness-foundations/) | The thesis: [first principles](harness-foundations/first-principles.md), [patterns that work](harness-foundations/patterns-that-work.md), [directives](harness-foundations/directives.md), [the simple version](harness-foundations/simple-mode.md), and [source notes](harness-foundations/source-notes/). |
| [`harness/cli/`](harness/cli/) | The harness CLI core — a global tool (`npm i -g`), self-updating via `harness update`, extended per repo from `.harness/extensions/`. |
| [`skills/`](skills/) | The two deployable skills: the [`eng-harness-flow`](skills/eng-harness-flow/SKILL.md) router (the front door — adoption and every loop stage live inside it as modules) and the standalone [`eng-harness-0-harnessability-assessment`](skills/eng-harness-0-harnessability-assessment/SKILL.md) peer. See [`skills/README.md`](skills/README.md). |
| [`docs/`](docs/) | How-to guides ([records](docs/how/record-and-record-types.md), [architecture conformance](docs/how/architecture-conformance.md), [dogfooding](docs/how/dogfood-harness-flow.md)), presentations, plans, and project rules. |

Start with [first-principles](harness-foundations/first-principles.md) for the thesis, [patterns-that-work](harness-foundations/patterns-that-work.md) for practical moves, or [directives](harness-foundations/directives.md) for the shortest operating version.

## About this repo

This is the **home of the harness product itself**: the CLI and skills are authored here and deployed into *other* repos. We also **dogfood** the harness on this repo — *editing* the CLI or skills is product development that ships to every consumer; *running* the loop skills is dogfooding this checkout. See [`AGENTS.md`](./AGENTS.md#this-repos-dual-role) and the constitution ([`docs/project-rules/constitution.md`](docs/project-rules/constitution.md) §1).

The CLI's hexagonal architecture is itself under deterministic backpressure: `harness arch-check` proves the import graph against committed dependency-cruiser rules on every PR. Two dogfood extensions exercise the harness against real, unfamiliar repos (`harness validate-harnessability`, `harness validate-harness-flow`) — collected retros are **surfaced, never auto-implemented**. See [`docs/how/dogfood-harness-flow.md`](docs/how/dogfood-harness-flow.md).

**Publication boundary**: this repo distils private and public research into general, publication-safe principles. Raw notes and private source material live outside the public surface. Public content should avoid private names, internal codewords, local paths, unreleased details, and exact private metrics unless explicitly approved.
