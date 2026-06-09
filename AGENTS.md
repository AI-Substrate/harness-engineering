# AGENTS.md

This repository is a public-facing engineering-harness first-principles and tutorial project.

## This repo's dual role

This repository is **two things at once** — keep them distinct (the full version is in `docs/project-rules/constitution.md` §1):

1. **The home/source of the harness product.** The harness CLI (`harness/cli/`) and the engineering-harness skills (`skills/eng-harness-setup/`, `skills/eng-harness-loop/`) are *authored here* and *deployed out to other repos* via `npx skills` / `harness skills install`. A change here propagates to every consumer.
2. **A dogfooding site.** We also *use* the harness on this repo: `.minih.json` wires the loop skills as `minih` agents, and `.harness/extensions/` holds extensions this repo authored for itself.

Other repos are **consumers**: they install the CLI + skills, and *their* harness substrate (`.harness/extensions/`, governance doc, fixtures) lives in *their* tree — not here.

### Build mode vs. dogfood mode (do not conflate)

- **Editing** `skills/eng-harness-*/SKILL.md` or `harness/cli/` is **product development** — it changes the harness shipped to every consumer. Treat it as source work, governed by the repo's tests/checks/constitution.
- **Running** a loop skill (e.g. `eng-harness-1-boot`) is **dogfooding** — it operates on *this* repo only. Friction or improvements found while dogfooding usually belong in the **product source** (the skill or CLI), because that is where the fix helps every consumer, not just this checkout.

### Self-reference caveat (boot / setup)

The loop skills expect a governance doc at `.harness/engineering-harness.md`. This repo does **not** have one yet — its governance lives in `docs/project-rules/{constitution,architecture,rules,idioms}.md`. So `eng-harness-1-boot` will report `UNAVAILABLE` here and suggest `eng-harness-0-setup`. **Do not run setup against this repo to "fix" that** — this is the harness's own home, not a target repo. (A deterministic `harness init` writer that would reconcile this is a deferred next-plan item.)

## Repo framing

- Build a reusable, evidence-backed guide for harness engineering: how teams create fast, observable, repeatable development loops.
- Treat the engineering harness as a first-class product surface, not scaffolding.
- Keep the engineering harness / agent harness distinction explicit in public content: this repo studies the project-side engineering harness, not agent runtimes themselves.
- Distill private/raw source material into general principles, patterns, and tutorial content that can be shared safely.
- Prefer practical, agent-readable guidance: commands, checks, examples, templates, and explicit feedback loops.

## Harness layer definitions

- **Engineering harness**: the project/product development loop — commands, recipes, fixtures, seed data, boot/build/test/run/health/observe/verify flows, feedback capture, and encoded improvements that let a human or agent change the actual software safely and quickly.
- **Agent harness**: the runtime/control plane around an AI model that turns it into a tool-using agent: tool dispatch, permissions, context/session management, orchestration, state, and execution environment. Examples include Claude Code, pi, Copilot CLI, MAF-style agent systems, and `minih`.
- The agent harness invokes and benefits from the engineering harness, but does not replace it. If the software cannot boot, run, seed, and prove behavior, the agent has nothing reliable to drive.
- Practices like magic-wand retrospectives, difficulty ledgers, and self-improving feedback loops are engineering-harness practices when they improve the project/product development loop, even if an agent harness helps collect or enforce them.

## Source handling and research workflow

- `scratch/` is a private research workspace and is gitignored. Raw sources, notes, excerpts, and evidence drafts live there only.
- Some sources are referenced in-place from local repositories instead of copied into `scratch/`; respect the source registry handling note for each source.
- Never commit raw source documents, private notes, customer-specific details, person names, internal codewords, employer/client names, or unreleased platform details.
- Public/tracked content must use neutral language such as “a legacy platform,” “a private source,” “the team,” or “the experiment.”
- Do not quote private sources directly in tracked files unless the quote has been explicitly approved for publication.
- Before committing, run `git status --short` and verify that `scratch/` remains ignored.

Workflow:

1. Copy raw/private material into `scratch/sources/` only when allowed; otherwise reference the local source path without copying it.
2. Register each source in `scratch/notes.md` with a local source ID and handling note.
3. Extract first principles, evidence, and reusable patterns in sanitized form.
4. Promote only generalized, publication-safe synthesis into tracked repo content.
5. Keep traceability from public claims back to private source IDs in the private notes until claims are replaced by public citations or approved wording.

## minih agents (engineering-harness testing loop)

This repo uses [`minih`](https://github.com/AI-Substrate/minih) agents to exercise the harness end-to-end. minih agents live under `agents/<slug>/` (per-run artifacts in `agents/*/runs/` are gitignored).

- **Passing skills into a minih agent**: minih does **not** load global skills implicitly. Wire repo-local skills via the root `.minih.json` `skills` block — `{ "skills": { "sources": ["path:skills"], "include": ["<slug>"] } }` — where `path:skills` points at this repo's `skills/<name>/SKILL.md`. Equivalent one-off form: `minih run <agent> --skill-source path:skills --skill <slug>`. Verify resolution with `minih skills doctor` / `minih inspect <agent>`. Source aliases: `.agents`, `.claude`, `.github`, `global:*`, `path:<path>`.
- **Always collect feedback + magic wand after EVERY minih agent run.** Every minih agent emits a `retrospective` (`workedWell`, `confusing`, `magicWand`, plus self-numbered `difficulties` MH-NNN). After any run completes, the calling agent/human MUST review that feedback (and `minih difficulties` across runs), then act on it: route project-layer friction into harness/CLI/skill improvements and the difficulty ledger, and minih-layer friction upstream. Encode fixes so the next run never hits the same friction — the harness is a self-improving product, not a static test tool.


