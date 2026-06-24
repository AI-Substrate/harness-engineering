# Engineering Harness Skills

This directory holds the engineering-harness skills this repo publishes through [`npx skills`](https://github.com/vercel-labs/skills). It publishes **three skills** — two that drive the harness loop, plus a standalone interrogation companion:

- **`eng-harness-flow/`** — the stateless router, the single front door to the harness loop. Its **boot / backpressure / retro / adopt / add-extension** verbs are harness-blind modules under `references/stages/`, loaded one at a time by the router — never installed or invoked directly.
- **`eng-harness-0-harnessability-assessment/`** — the standalone peer that scores a repo's harnessability (Operate-Today and Adaptability) and reports back-pressure surfaces, proof ceilings, and command tiers.
- **`grill-agent-done/`** — a standalone interrogation companion: it defends the *definition of done* and the evidence that will prove it, one claim at a time, lining each claim against the right proof grade. The router offers it after a thin backpressure survey; it also runs on its own.

```text
Install 2 skills -> /eng-harness-flow routes: adopt (if no harness) -> loop: boot/backpressure/observe/retro -> encode fixes/checks
```

The goal is to make the engineering harness practical for people new to the concept: install the two skills, then run `/eng-harness-flow` — it figures out where the repo sits on the loop and hands back the one right next command.

## Install

The first-class way is the harness CLI's own command (a transparent pass-through to `npx skills` — it prints the exact command before running and always passes `-y` so the Vercel picker never blocks):

```bash
harness skills install --target claude-code --global      # or --target github-copilot, codex, cursor, opencode, pi…
```

To **refresh** installed skills to latest and **prune** any this repo has since renamed or removed (so an old slug never lingers beside its replacement), use `update` — `npx skills` itself has no prune, so this is the supported way to keep skills clean:

```bash
harness skills update --target claude-code --global       # refresh to latest + remove renamed/removed skills
```

Equivalent direct `npx` invocation (what the command wraps):

```bash
npx skills@latest add AI-Substrate/harness-engineering/skills -a claude-code -g -y
```

Install a single skill:

```bash
npx skills@latest add AI-Substrate/harness-engineering/skills -s eng-harness-flow -a claude-code -g                          # the router (front door)
npx skills@latest add AI-Substrate/harness-engineering/skills -s eng-harness-0-harnessability-assessment -a claude-code -g   # the peer
npx skills@latest add AI-Substrate/harness-engineering/skills -s grill-agent-done -a claude-code -g                          # the interrogation companion
```

From this working tree while developing, or to list what the repo exposes:

```bash
just install-skills-global
just list-skills
```

See [`../INSTALL.md`](../INSTALL.md) for the full per-CLI / global-vs-local matrix.

> **Note on slugs**: external tooling that predates the consolidation (e.g. an SDD `the-flow` routing table) may still reference the former per-stage skills by their old `eng-harness-1-boot … eng-harness-4-retro` / `eng-harness-0-adopt` names. Those are now **verb modules inside `eng-harness-flow`**, not installable skills — reach every one of them through the router (`/eng-harness-flow`). Updating any out-of-repo references that still name the old slugs is a follow-up.

## Skills

| Skill | Role | Why |
|---|---|---|
| `eng-harness-flow` | The front door (router) | The single door to the loop. Stateless: re-derives where the work sits from deterministic repo signals + an optional caller hint — a host names a moment in its own lifecycle with one of five neutral lifecycle hooks (`--hook pre-flight\|pre-coding\|coding\|post-coding\|post-flight`, with `--event session-start\|pre-implement\|post-spec\|task-pause\|phase-end\|plan-complete` as the permanent alias) — then routes to the ONE right harness action and runs it (with explicit go-ahead). Adoption and every loop stage live inside it as modules. |
| `eng-harness-0-harnessability-assessment` | The peer | Surveys the existing engineering environment, then writes `.harness/reports/harnessability/latest.{md,json}` scoring Operate-Today and Adaptability with an A–F matrix, command tiers, proof ceilings, back-pressure surfaces, first-session guidance, and proposal-only affordance recommendations. The router offers it during adoption (the scout rung); also runnable on its own. |
| `grill-agent-done` | The companion | Interrogates and defends the definition of done and the evidence that proves it — one claim at a time — until each is lined up against the right proof grade (`deterministic` / `inferential` / `human-judgement`) or knowingly assigned to a named reviewer. A standalone skill, **not** a routed stage: the coach offers it after a thin backpressure survey, and it runs on its own. Never blocks; the verdict still comes from running the sensors. |

### The verbs inside the router

`eng-harness-flow` loads exactly one module per call — never all of them — from `references/stages/`:

| Verb module | Stage | Why |
|---|---|---|
| `adopt` | Adoption | Walks a repo with no working harness through adoption: install the CLI → (offered) the harnessability assessment → record the injection map (where the repo's extant dev/SDD flow calls `/eng-harness-flow`, so the harness gets used and doesn't vanish on a cold agent start) → stand up a basic `checks` quality gate (lint/test/typecheck) and a `boot` that composes it, built last. A lean flow that generates no files of its own. |
| `add-extension` | Adoption | Guided authoring of a new `harness <verb>` command: reuses gathered intent, runs `harness new`, fills the handler, and verifies. |
| `boot` | Boot | Reads the harness, checks safe boot/health surfaces, reviews known difficulties, reports readiness. `UNAVAILABLE` (not an error) when no harness exists → the router routes to adoption. |
| `backpressure` | Backpressure Check | Advisory survey of whether scoped work can be *proven by deterministic sensors*; names missing sensors. Never blocks. |
| `retro` | Do Work and Observe + Retro / Magic Wand | The friction lifecycle. In-flight capture is a CLI verb — `npx harness observe` logs one entry per call to the gitignored buffer (`.harness/temp/<bucket>/`), with IDs/timestamps/validation/gitignore owned by the CLI; `--drain` presents the end-of-session triage prompt and materialises a committed record via `harness record retro` (under `.harness/records/`); `--harvest` clusters recurring improvement candidates and frames recurrence as token cost. |

> **Backed by `harness record`**: the Observe/Retro stage calls the core CLI command `harness record <type>` (starting with the `retro` type) to scaffold a templated record into `.harness/records/<type>/`. Scratch lives in gitignored `.harness/temp/`; committed records live in tracked `.harness/records/`. See [docs/how/record-and-record-types.md](https://github.com/AI-Substrate/harness-engineering/blob/main/docs/how/record-and-record-types.md).

## The intended loop

1. **Install** the two skills (above).
2. **Route** with `/eng-harness-flow` — run it bare and it picks the moment for you. On a repo with no working harness it routes to **adoption**: install the CLI (`harness doctor` passes), offer the harnessability assessment, stand up a basic `boot`. It writes no governance doc / `harness/cli/` / `AGENTS.md` / `docs/harness/` scaffold itself — that substrate is owned by the harness CLI (`harness init` stamps the governance doc).
3. **Assess** — the router offers the harnessability assessment during adoption (the scout rung), or run `/eng-harness-0-harnessability-assessment` directly for a target-aware readiness report (evidence vs inference vs unknowns vs next safe actions; affordance recommendations are proposal-only).
4. **Boot** at session start — `/eng-harness-flow` re-runs boot so you read the contract instead of guessing commands.
5. **Observe** quietly during work with one CLI call per noticing — `npx harness observe "<what>" --kind <kind>` — for confusing failures, retries/backtracking, slow/missing commands, missing fixtures/sensors, "if only there were…" ideas. Don't nag mid-flow.
6. **Drain** once at a natural pause (session/phase end, handoff) — `/eng-harness-flow` routes to the retro drain, the one normal user-facing retro prompt.
7. **Harvest** periodically — what recurs, what's stale, which targets leak attention, what to encode next.

## How this fits the broader plan

The foundation documents explain the thesis: the engineering harness is the project-side loop that makes product work bootable, observable, provable, and improvable.

| Foundation idea | Skill-suite affordance |
|---|---|
| Boot → Backpressure Check → Do Work and Observe → Retro and Magic Wand → Improve | `/eng-harness-flow` routes adoption to bring the harness into the repo and stand up a basic `boot`, then dispatches each loop stage through it. |
| The harness is the front door, not a replacement toolchain | The adoption flow installs the CLI and authors a `boot` that wraps existing commands first. |
| Cold-start orientation should be repository evidence, not private memory | `eng-harness-0-harnessability-assessment` writes a target-aware report separating evidence, inference, unknowns, and next safe actions. |
| Encode the fix, not the memory | Retro entries name a candidate encoded fix, not just a complaint. |
| Agents are real harness users | The retro stage's in-flight capture (`npx harness observe`) treats agent friction as product feedback for the harness. |
| Back pressure is a product feature | The backpressure stage asks whether scoped work has enough deterministic proof and what sensors are missing. |
| Retrospectives need a lifecycle | The retro stage's `--drain` / `--harvest` move entries from buffer to durable retro to prioritized improvement. |
| Known difficulties and weak signals should be visible at boot | The harness CLI surfaces known difficulties; the boot stage reviews friction and signal readiness before work starts. |
| The agent may report progress, but completion belongs to external evidence | `grill-agent-done` interrogates each claim of done until it is backed by a deterministic sensor — or knowingly routed to a named reviewer — never the agent's own confidence. |

## Operating rules

- Run `/eng-harness-flow` before non-trivial work in a repo that has a harness — it re-runs boot for you.
- If boot says no harness exists, the router routes you to adoption.
- Track friction quietly during work; bubble once at a natural pause; harvest when recurring friction should influence planning.
- Wrap existing build/test/run/seed/health commands before inventing new harness behaviour.
- Prefer encoded fixes: commands, checks, fixtures, diagnostics, templates, defaults, or evidence paths.
- Treat weak or missing signals as harness defects: if the agent had to infer runtime behaviour, architecture compliance, security posture, schema validity, or user-flow correctness, consider adding a deterministic sensor.
