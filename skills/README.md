# Engineering Harness Skills

This directory holds the engineering-harness skills this repo publishes through [`npx skills`](https://github.com/vercel-labs/skills). They are grouped into two category folders:

- **`eng-harness-setup/`** — base setup + explore skills (group `0`, pre-loop).
- **`eng-harness-loop/`** — the interactive Boot → Backpressure → Observe → Retro loop that runs during work.

```text
Install skills -> set up harness (eng-harness-0-setup) -> loop: boot/backpressure/observe/retro -> encode fixes/checks
```

The goal is to make harness engineering practical for people new to the concept: install the skills, run the setup skill when a repo has no harness, then use the loop skills during every session.

## Install

The first-class way is the harness CLI's own command (a transparent pass-through to `npx skills` — it prints the exact command before running and always passes `-y` so the Vercel picker never blocks):

```bash
harness skills install --target claude-code --global      # or --target github-copilot, codex, cursor, opencode, pi…
```

Equivalent direct `npx` invocation (what the command wraps):

```bash
npx skills@latest add AI-Substrate/harness-engineering -a claude-code -g -y
```

Install a single category or skill:

```bash
npx skills@latest add AI-Substrate/harness-engineering/skills/eng-harness-loop -a claude-code -g   # whole loop group
npx skills@latest add AI-Substrate/harness-engineering -s eng-harness-0-setup -a claude-code -g     # one skill
```

From this working tree while developing, or to list what the repo exposes:

```bash
just install-skills-global
just list-skills
```

See [`../INSTALL.md`](../INSTALL.md) for the full per-CLI / global-vs-local matrix.

> **Note on slugs**: external tooling that predates this repo (e.g. an SDD `the-flow` routing table) may still reference the loop skills by their former `harness-1-boot … harness-4-retro` names. Updating those out-of-repo references is a follow-up; within this repo the canonical slugs are the `eng-harness-*` names below.

## Skills

### Setup group — `eng-harness-setup/`

| Skill | When | Why |
|---|---|---|
| `eng-harness-0-setup` | The repo has no working `harness boot` (or no harness front door at all) | Installs the harness CLI from npx and orchestrates a basic `boot`: install → (conditional) `eng-harness-0-harnessability-assessment` → `eng-harness-0-add-extension`. A lean flow that generates no files of its own. |
| `eng-harness-0-harnessability-assessment` | The front door exists but the repo needs a target-aware readiness picture | Surveys the existing engineering environment, then writes `.harness/reports/harnessability/latest.{md,json}` scoring Operate-Today and Adaptability with an A–F matrix, command tiers, proof ceilings, back-pressure surfaces, first-session guidance, and proposal-only affordance recommendations. |
| `eng-harness-0-add-extension` | You need a new `harness <verb>` command | Guided authoring: reuses gathered intent, runs `harness new`, fills the handler, and verifies. |

### Loop group — `eng-harness-loop/`

| Skill | Stage | Why |
|---|---|---|
| `eng-harness-1-boot` | Boot | Reads the harness, checks safe boot/health surfaces, reviews known difficulties, reports readiness. `UNAVAILABLE` (not an error) when no harness exists → recommends `eng-harness-0-setup`. |
| `eng-harness-2-backpressure` | Backpressure Check | Advisory survey of whether scoped work can be *proven by deterministic sensors*; names missing sensors. Never blocks. |
| `eng-harness-3-observe` | Observe | Silently records material friction, signal gaps, and concrete improvement ideas during work, to the gitignored scratch buffer `.harness/temp/<agent>/`. |
| `eng-harness-4-retro` | Retro / Magic Wand | `--drain` presents the end-of-session triage prompt and materialises a committed record via `harness record retro` (under `.harness/records/`); `--harvest` clusters recurring improvement candidates. |

> **Backed by `harness record`**: the Observe/Retro stages call the core CLI command `harness record <type>` (starting with the `retro` type) to scaffold a templated record into `.harness/records/<type>/`. Scratch lives in gitignored `.harness/temp/`; committed records live in tracked `.harness/records/`. See [`docs/how/record-and-record-types.md`](../docs/how/record-and-record-types.md).

## The intended loop

1. **Install** the skills (above).
2. **Set up** the harness with `eng-harness-0-setup` when a repo has no working `harness boot` — installs the CLI (`harness doctor` passes), ensures a harnessability report exists, and stands up a basic `boot` extension. Writes no governance doc / `harness/cli/` / `AGENTS.md` / `docs/harness/` scaffold — that substrate is owned by the harness CLI (and a future `harness init`).
3. **Assess** with `eng-harness-0-harnessability-assessment` for a target-aware readiness report (evidence vs inference vs unknowns vs next safe actions; affordance recommendations are proposal-only).
4. **Boot** with `eng-harness-1-boot` at session start — read the contract instead of guessing commands.
5. **Observe** with `eng-harness-3-observe` quietly during work — confusing failures, retries/backtracking, slow/missing commands, missing fixtures/sensors, "if only there were…" ideas. Don't nag mid-flow.
6. **Drain** with `eng-harness-4-retro --drain` once at a natural pause (session/phase end, handoff). The one normal user-facing retro prompt.
7. **Harvest** with `eng-harness-4-retro --harvest` periodically — what recurs, what's stale, which targets leak attention, what to encode next.

## How this fits the broader plan

The foundation documents explain the thesis: the engineering harness is the project-side loop that makes product work bootable, observable, provable, and improvable.

| Foundation idea | Skill-suite affordance |
|---|---|
| Boot → Backpressure Check → Do Work and Observe → Retro and Magic Wand → Improve | `eng-harness-0-setup` installs the harness CLI and stands up a basic `boot`; the loop skills operate the loop through it. |
| The harness is the front door, not a replacement toolchain | `eng-harness-0-setup` installs the CLI and authors a `boot` that wraps existing commands first. |
| Cold-start orientation should be repository evidence, not private memory | `eng-harness-0-harnessability-assessment` writes a target-aware report separating evidence, inference, unknowns, and next safe actions. |
| Encode the fix, not the memory | Harness entries name a candidate encoded fix, not just a complaint. |
| Agents are real harness users | `eng-harness-3-observe` treats agent friction as product feedback for the harness. |
| Back pressure is a product feature | `eng-harness-2-backpressure` asks whether scoped work has enough deterministic proof and what sensors are missing. |
| Retrospectives need a lifecycle | `eng-harness-4-retro --drain` / `--harvest` move entries from buffer to durable retro to prioritized improvement. |
| Known difficulties and weak signals should be visible at boot | The harness CLI surfaces known difficulties; `eng-harness-1-boot` reviews friction and signal readiness before work starts. |

## Operating rules

- Run `eng-harness-1-boot` before non-trivial work in a repo that has a harness.
- If boot says no harness exists, run `eng-harness-0-setup`.
- Track friction quietly during work; bubble once at a natural pause; harvest when recurring friction should influence planning.
- Wrap existing build/test/run/seed/health commands before inventing new harness behaviour.
- Prefer encoded fixes: commands, checks, fixtures, diagnostics, templates, defaults, or evidence paths.
- Treat weak or missing signals as harness defects: if the agent had to infer runtime behaviour, architecture compliance, security posture, schema validity, or user-flow correctness, consider adding a deterministic sensor.
