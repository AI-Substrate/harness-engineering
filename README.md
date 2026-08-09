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

## Live repository sensors

The newer harness workflow gives repositories typed, deterministic **sensors**:
small measurements that persist readings, trends, run history, and guidance while
you work. Agents read the stable surface with `harness sensors --json`; humans run
`harness sensors` in a terminal for the lazy-loaded live table and drill-in
playback. Both render the same scratch state, so supervision and automation cannot
drift into separate truths.

Sensors stay advisory during ordinary work. Use `harness sensors check` only when
you deliberately want fail/error/timeout readings to block CI. Repositories author
sensors under API-2 extensions or start with `harness new <name> --sensor`.
See [Harness sensors](docs/how/harness-sensors.md) for the contract, keys, glyphs,
JSON shape, and degraded modes. Contributors and agents should also follow
[AGENTS.md's one-truth/two-views rule](AGENTS.md#sensors-one-truth-two-views).

### This repo's own sensors

The dogfood extension `.harness/extensions/repo-sensors/` ships these 12 real
signals; each watch entry is repository-relative:

| Sensor | Measures | Watch globs |
|--------|----------|-------------|
| `tests` | Full Vitest suite with coverage | `harness/cli/src/**/*.{ts,tsx}`, `harness/cli/test/**/*.ts`, `.harness/extensions/**/*.{ts,tsx,js,mjs,cjs}`, `harness/cli/vitest.config.ts`, `package.json`, `package-lock.json` |
| `skills-check` | Agent Skills frontmatter validity | `skills/**/*.md`, `.harness/extensions/skills-check/**/*.ts` |
| `typecheck` | CLI TypeScript with no emit | `harness/cli/src/**/*.{ts,tsx}`, `harness/cli/tsconfig.json`, `package.json`, `package-lock.json` |
| `lint` | Read-only Biome check | `harness/cli/**/*.{ts,tsx,json}`, `biome.json`, `package.json`, `package-lock.json` |
| `arch-check` | Dependency-cruiser architecture rules | `harness/cli/src/**/*.{ts,tsx}`, `.dependency-cruiser.cjs`, `.harness/extensions/arch-check/**/*.ts` |
| `docs-drift` | Generated CLI docs against curated sources | `docs/**/*.md`, `harness/cli/src/services/docs/**/*.{ts,json}`, `scripts/gen-docs.mjs` |
| `flows-drift` | Generated flow schemas/templates/fixtures | `docs/plans/**/*.md`, `harness/cli/src/services/flow/**/*.{ts,json}`, `scripts/gen-flows.mjs`, `scripts/flow-fixtures.mjs` |
| `doctrine-parity` | Harness chore/seam doctrine mirror | `skills/eng-harness-flow/SKILL.md`, `scripts/doctrine-parity.mjs` |
| `windows-check` | Cross-platform extension-source hazards | `.harness/extensions/**/*.{ts,js,mjs,cjs}` |
| `coverage-branch` | Independent branch-coverage run; higher is better, target 80% | same six globs as `tests` |
| `todo-debt` | Tracked debt-marker count; lower is better, target 20 | `harness/cli/src/**/*.{ts,tsx}`, `harness/cli/test/**/*.ts`, `.harness/extensions/**/*.{ts,tsx,js,mjs,cjs}`, `skills/**/*.md`, `scripts/**/*.{ts,js,mjs,cjs}`, `docs/**/*.md`, `*.md` |
| `lock-hygiene` | Internal/proxy/signed URLs in the lock; target zero | `package.json`, `package-lock.json` |

Sensors are short-feedback instruments: target seconds, tolerate up to about
2–3 minutes, never longer. The 30-second default timeout is the paved path and
raising a sensor beyond 180 seconds is a design smell. **If your sensor needs 20
minutes, it isn't a sensor.** Long work belongs in CI or a verb.

## Documentation

New to the harness? Start with the **[adopter's guide](docs/guide/)** — a read-in-order path from zero to a green boot, on through operating, growing, and maintaining the harness. No prior context needed; written to read cleanly in the GitHub UI.

| If you want to… | Go to |
|---|---|
| **Adopt it**, step by step | [The adopter's guide](docs/guide/) — start at [01 · Quick Start](docs/guide/01-quick-start.md), then [04 · Adopting the Harness](docs/guide/04-adopting-the-harness.md) |
| **Understand the idea** | [02 · What Is an Engineering Harness?](docs/guide/02-what-is-an-engineering-harness.md) · [03 · The Harness Loop](docs/guide/03-the-harness-loop.md) |
| **See the visual intro** | [the deck](https://ai-substrate.github.io/harness-engineering/) (press `P` to present) · [the layers, one page](https://ai-substrate.github.io/harness-engineering/layers.html) |
| **Install the CLI or skills** | [INSTALL.md](./INSTALL.md) · [`harness/cli/README.md`](harness/cli/README.md) · [`skills/README.md`](skills/README.md) |
| **Author and operate sensors** | [Harness sensors](docs/how/harness-sensors.md) — JSON for agents, live TUI for humans |
| **Read the thesis** | [`harness-foundations/`](harness-foundations/) — [first principles](harness-foundations/first-principles.md) · [patterns that work](harness-foundations/patterns-that-work.md) |
| **Contribute to this repo** | [`AGENTS.md`](./AGENTS.md) — this repo is the harness's own home |

Everything below explains *why* the harness exists and how it fits together. To just use it, the two links above are enough.

## A little anecdote

Imagine you are new to the team. The codebase is new to you. You've been pouring over documentation. Your agent has never seen the codebase before now (as is the way every time!). You pick up a ticket, you and your agent do the work. You review it, tests pass etc. You've used the correct documentation and tooling to do the work to the best of your knowledge

You pop up a PR and request a review from your colleague. They immediately spot that there are issues in the implementation. Perhaps its a slight architecture issue, or a class that should not reference another class - things that you'd know if you'd been on the codebase a bit longer perhaps, and because of this PR, you'd not make the same mistake again. 

So you go and fix it with your agent, resubmit the PR and off to the races. This knowledge is tribal and its lost to the next agent and next new person (unless they read all PRs!).

What an engineering harness will promote is the encoding of this knowledge. How could you create a check that you run before commit that finds this kind of thing. 

You should have some kind of architecture check baked in to your environment. It checks all the things. 

Let's say you and your team have added a new check (the harness convention is a single extension called "checks" - this composite command can run all your checks before checkin!). You pop your PR up after running the shiny architecture check. And you get knocked back! It's a new thing the check missed! This is where having an engineering harness as a first class concept *really* shines. There is no question what to do next. You don't just go and fix the issue directly.  

You fix the check. 

Then you re-run the check - the agent sees the issue and fixes it. This PR comment, the knowledge that the more experienced person had is now *encoded* in to the system for everyone else. No need to load extensive architecture documents in to context. No need for human to back read every PR ever. It just works. 

> This repo practices exactly that. The composite gate is **`harness checks`** (tests, lint, typecheck, drift guards, architecture, skills, markdown, Windows-compat) — one command. Run it before you push; CI runs it on every PR so nothing merges red. You don't fix the code and move on — you fix the *check*.

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

## How we evaluate this system

This repo evaluates the harness by dogfooding it: a blind peer agent does real
work, the run is watched by both deterministic evidence and a hardened judged
layer, and the findings are fed back into the harness or the eval process. The
flow-conformance evaluator writes per-run reports and an append-only ledger so
we can see regressions, compare models, and spot ritual-without-capability
mimicry. Start with [Evaluating the harness](docs/how/evaluating-the-harness.md).

## Install

The CLI is published to the **public npm registry** as `@ai-substrate/engineering-harness` — an **ambient global tool** (like `git`/`node`), installed once per machine and **never committed into a repo** (Node >= 22, no token or `.npmrc`):

```bash
npm install -g @ai-substrate/engineering-harness
harness doctor          # sanity-check the install — see the note below
harness update          # later: upgrade to @latest (no-op if current)
```

> **`harness doctor` writes to your machine on first run.** It installs **two** things, and
> they are separate, with separate opt-outs. It never asks — but it always tells you what it
> did, and every failure is warn-only: doctor still completes, still prints every other row,
> and still exits 0.
>
> **1. The git-ai collector** — the **pinned, SHA-256-verified** git-ai binary plus its own
> agent hooks, so AI attribution works without you configuring anything. It refuses to touch a
> **pre-existing global git `trace2` config** (the vendor command deletes that section
> machine-wide). Opt out with **`HARNESS_NO_COLLECTOR=1`**: nothing is downloaded, installed or
> written.
>
> **2. Our agent hooks** — one entry per detected agent, so a commit made inside an agent's
> sandbox is still attributed to that agent. Every entry carries the marker
> `ai-substrate-harness-hook-v1`, which is how `harness hooks uninstall` finds its own work and
> nothing else. Opt out with **`HARNESS_NO_HOOKS`** (see the value rule below).
>
> These are the exact files we write, and we write **only** these:
>
> | agent | file(s) |
> |---|---|
> | claude-code | `~/.claude/settings.json` — or `$CLAUDE_CONFIG_DIR/settings.json`, used **verbatim as the directory** |
> | cursor | `~/.cursor/hooks.json` |
> | gemini | `~/.gemini/settings.json` — or `$GEMINI_CLI_HOME/.gemini/settings.json`, where the variable is the **home root** and `.gemini` is appended |
> | droid | `~/.factory/settings.json` |
> | firebender | `~/.firebender/hooks.json` |
> | github-copilot | `~/.copilot/hooks/harness.json` — **created** if absent; it is ours, not git-ai's `git-ai.json` |
> | windsurf | `~/.codeium/hooks.json` **and** `~/.codeium/windsurf/hooks.json` |
>
> A file is touched only if the agent is **detected** (its directory exists). We append one entry
> per event array; we do not reorder, reformat other containers, or change any setting of yours.
> `amp`, `opencode`, `pi` and `cline` are **not supported** — `harness hooks list` reports them by
> name with a reason rather than skipping them silently.
>
> **`HARNESS_NO_HOOKS` — any non-empty value declines**, including `0`, `false` and `no`. To
> re-enable, **unset it**; setting it to `0` still declines, and the command says so when you use
> one of those values. Unset or empty means proceed.
>
> **Check and undo:** `harness hooks status --json` shows, per agent, whether our entry is present
> and whether the program it names still **resolves** — an entry pointing at a deleted binary
> reports `unresolvable`, which is the only way to notice a hook that has silently stopped working,
> since hooks exit 0 by design. `harness hooks uninstall` removes only our marked entries and
> deletes only a file we created.
>
> **About the backup, honestly:** before the collector's installer rewrites your agent configs,
> we copy them to `~/.git-ai/harness-backups/<timestamp>/` with a `manifest.json`. `harness hooks
> restore` puts them back — the round trip is tested, including deleting a file that did not exist
> before. Two limits worth knowing: it covers only the agents we **detect**, and the record of what
> an install created lives in `~/.harness/hooks/install-record.json`, which nothing garbage-collects
> — a stale entry there can only ever make an uninstall remove a key we **did** create, never one of
> yours.
>
> Full detail in [the telemetry docs](docs/how/telemetry/README.md).

Then install the **skills** — the choreography agents drive. The CLI stages the package's baked `skills/` tree locally and wraps [`npx skills`](https://github.com/vercel-labs/skills):

```bash
harness skills install --target claude-code --global
```

Swap `--target` for `github-copilot`, `codex`, `cursor`, `opencode`, `pi`…; drop `--global` for a project-local install. The install is recorded in `skills.lock.json`, so bare `harness update` can reconcile skills later with the fresh package copy. Full per-CLI matrix and update/prune notes: [`INSTALL.md`](./INSTALL.md), [`harness/cli/README.md`](harness/cli/README.md), [`skills/README.md`](skills/README.md).

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
| [`skills/`](skills/) | The deployable skills shipped in the npm package: the [`eng-harness-flow`](skills/eng-harness-flow/SKILL.md) router, [`eng-harness-0-harnessability-assessment`](skills/eng-harness-0-harnessability-assessment/SKILL.md), `grill-agent-done`, and the packaged SDD pipeline (`builder`, `the-flow` redirect, and helper skills). See [`skills/README.md`](skills/README.md). |
| [`docs/`](docs/) | How-to guides ([records](docs/how/record-and-record-types.md), [architecture conformance](docs/how/architecture-conformance.md), [the `harness flow` verbs](docs/how/harness-flow.md), [dogfooding](docs/how/dogfood-harness-flow.md)), presentations, plans, and project rules. |

Start with [first-principles](harness-foundations/first-principles.md) for the thesis, [patterns-that-work](harness-foundations/patterns-that-work.md) for practical moves, or [directives](harness-foundations/directives.md) for the shortest operating version.

## About this repo

This is the **home of the harness product itself**: the CLI and skills are authored here and deployed into *other* repos. We also **dogfood** the harness on this repo — *editing* the CLI or skills is product development that ships to every consumer; *running* the loop skills is dogfooding this checkout. See [`AGENTS.md`](./AGENTS.md#this-repos-dual-role) and the constitution ([`docs/project-rules/constitution.md`](docs/project-rules/constitution.md) §1).

The CLI's hexagonal architecture is itself under deterministic backpressure: `harness arch-check` proves the import graph against committed dependency-cruiser rules on every PR. Two dogfood extensions exercise the harness against real, unfamiliar repos (`harness validate-harnessability`, `harness validate-harness-flow`) — collected retros are **surfaced, never auto-implemented**. See [`docs/how/dogfood-harness-flow.md`](docs/how/dogfood-harness-flow.md).

**Publication boundary**: this repo distils private and public research into general, publication-safe principles. Raw notes and private source material live outside the public surface. Public content should avoid private names, internal codewords, local paths, unreleased details, and exact private metrics unless explicitly approved.
