# The Engineering Harness

Engineering harnesses aren't new. This repo takes the decades-old idea and modernises it for **agentic software engineering** — a world where the agent starts cold every session, and proof matters more than ever.

An engineering harness takes your codebase — its scripts, tools, fixtures, checks, and hard-won knowledge — and turns them into a **first-class thing**: one focal point for discovery and improvement.

Combined with an agent, it becomes something more — a very obvious place to encode discoveries, friction points, and fixes the moment they surface, so they're captured instead of lost.

And it becomes your repo's **home of quality**. The harness guides both you and your agent to *create* **deterministic backpressure** — the types, tests, schemas, and checks that make *"done"* provable — so *"looks good to me"* gives way to *not yet, and here's why.*

Together, that's the **missing layer** between your agent and your codebase: the **first-class, deterministic** one most repos don't have yet.

**It's an *engineering* harness, not an *agent* harness** — the loop that proves your *product*, not the runtime around the *model*. It works through an improving feedback loop, so a human or agent gets the most out of every token instead of spending them to relearn your repo every session. → [Engineering harness vs agent harness](#engineering-harness-vs-agent-harness)

Crucially, the harness never takes the wheel: it holds no LLM and no agents of its own (skills aside) — just deterministic tooling. Your coding agent stays in the driver's seat, driving the harness the way it already drives `git`. Because that tooling is deterministic, the same harness holds whichever model you point at it — a cheap one for routine passes, a stronger one when the work is hard.

## Quick start

**Fastest start — let your agent do it.** Paste this into your coding agent (Claude Code / Copilot / Cursor / Codex…), pointed at the repo you want to harness:

```text
Read https://raw.githubusercontent.com/AI-Substrate/harness-engineering/main/AGENTS_README.md
and follow it in this repo.
```

That one file is self-contained, re-entrant, and self-locating: it works out where your repo already is in the process and does the right next step — typically installing the CLI and skills, then running adoption. Nothing needs to be set up first; if the agent loses context partway, paste the same line again and it picks up where it left off.

For this, point your agent at a **capable model** — a recent Claude Opus or GPT model. Adoption is a reasoning-heavy, multi-step task, and a stronger model sets the repo up noticeably better.

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

Underneath both: every agent session is a fresh developer onboarding into your repo — cold. If the supported path lives in scattered scripts, docs, and tribal memory, the agent has to infer it, and you pay for that inference every session, on every dev machine. Those tokens are real money — and tomorrow you spend them again to rediscover what you already solved today.

And the knowledge you *do* win tends to evaporate. Every correction — the workaround, the fix, the years of codebase instinct a human spends steering the agent right — usually lives in that one chat session, and then it's gone. Next week the same friction is waiting, unchanged, for the next person on your team — or for you, in a month, when you've forgotten. An engineering harness gives that hard-earned knowledge a permanent home — not scattered docs or tribal memory, but a runnable check: **encode the fix, not the memory**. Fix it once and it's caught forever — what used to leak away is now durable, compounding in the repo instead of evaporating, and it's yours. → [Encoding & Learning Loops](docs/guide/10-encoding-and-learning-loops.md)

> Two questions decide it: how does a fresh agent know when a change is *actually* done — and where does the fix go so it isn't lost tomorrow, on a teammate's machine or your own?

If your repo has no reliable answer, the engineering harness is the surface to improve.

## The loop

An engineering harness makes the **product-development loop** explicit and operable:

```text
Boot -> Backpressure Check -> Do Work and Observe -> Retro and Magic Wand -> Improve
```

- **Boot** proves the product can start from a known state.
- **Backpressure Check** is an LLM-assisted, advisory survey of the current scope against the deterministic sensors the repo exposes — types, compilers, tests, schemas, health checks, proof gates. Backpressure is how the harness makes wrong, unsafe, or unproven work hard to continue and easy to correct: *not yet, and here is why*. → [Backpressure Patterns](docs/guide/11-backpressure-patterns.md)
- **Do Work and Observe** exercises real product behaviour through supported surfaces and captures what happened in inspectable forms.
- **Retro and Magic Wand** turns friction, missing signals, and improvement wishes into reviewable candidates.
- **Improve** encodes what was learned so the next run is faster, clearer, safer, or backed by stronger signals — the harness compounds: every teammate and future agent session starts on top of everything the team has encoded.

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

None of this is new — engineering harnesses (build systems, test harnesses, smoke suites, fixtures, health checks) predate LLMs by decades. What changed is the *load*: a surface a human ran occasionally is now driven every session by every agent, so an under-invested harness gets expensive — paid in tokens and wrong guesses — and a well-made one compounds. → [Harness engineering vs an engineering harness](docs/guide/02b-harness-engineering-vs-an-engineering-harness.md)

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
| [`docs/`](docs/) | How-to guides ([records](docs/how/record-and-record-types.md), [architecture conformance](docs/how/architecture-conformance.md), [the `harness flow` verbs](docs/how/harness-flow.md), [dogfooding](docs/how/dogfood-harness-flow.md)), presentations, plans, and project rules. |

Start with [first-principles](harness-foundations/first-principles.md) for the thesis, [patterns-that-work](harness-foundations/patterns-that-work.md) for practical moves, or [directives](harness-foundations/directives.md) for the shortest operating version.

## About this repo

This is the **home of the harness product itself**: the CLI and skills are authored here and deployed into *other* repos. We also **dogfood** the harness on this repo — *editing* the CLI or skills is product development that ships to every consumer; *running* the loop skills is dogfooding this checkout. See [`AGENTS.md`](./AGENTS.md#this-repos-dual-role) and the constitution ([`docs/project-rules/constitution.md`](docs/project-rules/constitution.md) §1).

The CLI's hexagonal architecture is itself under deterministic backpressure: `harness arch-check` proves the import graph against committed dependency-cruiser rules on every PR. Two dogfood extensions exercise the harness against real, unfamiliar repos (`harness validate-harnessability`, `harness validate-harness-flow`) — collected retros are **surfaced, never auto-implemented**. See [`docs/how/dogfood-harness-flow.md`](docs/how/dogfood-harness-flow.md).

**Publication boundary**: this repo distils private and public research into general, publication-safe principles. Raw notes and private source material live outside the public surface. Public content should avoid private names, internal codewords, local paths, unreleased details, and exact private metrics unless explicitly approved.
