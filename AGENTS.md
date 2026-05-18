# AGENTS.md

This repository is a public-facing engineering-harness first-principles and tutorial project.

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

## Maintenance note

Update this file whenever the repo’s intent, publication boundary, or research workflow changes.
