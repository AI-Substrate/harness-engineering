# INSTALL.md - Skills Installation Reference

> **For AI agents reading this**: this is the canonical install reference for the skills in this repository. If a user asks you to install them, identify which CLI they use and whether they want a global install or project-local install, then run the matching `npx skills@latest add ...` command below. The harness CLI also wraps this as `harness skills install` (a transparent pass-through — it prints the exact `npx` command before running it and always passes `-y`).

This repository publishes two skill groups through the [`npx skills@latest`](https://github.com/vercel-labs/skills) installer: the **setup group** (`skills/eng-harness-setup/`) and the **interactive loop group** (`skills/eng-harness-loop/`, formerly hosted in `jakkaj/tools`). There is no separate repository-specific installer — `harness skills install` is a thin wrapper over the same `npx skills` tool.

## Skills

| Skill | Group | Purpose |
|---|---|---|
| `eng-harness-0-setup` | setup | Install the harness CLI, run the harnessability assessment if needed, record the injection map (where the repo's extant dev/SDD flow calls `/eng-harness-flow`), and stand up a basic `boot`. |
| `eng-harness-0-harnessability-assessment` | setup | Score a repository's harnessability (Operate-Today and Adaptability) and report back-pressure surfaces, proof ceilings, command tiers, and proposal-only affordances. |
| `eng-harness-0-add-extension` | setup | Guided authoring of a new `harness <verb>` extension. |
| `eng-harness-flow` | loop | Stateless harness-loop router — the single front door; re-derives loop position every call and routes to the one right skill. |
| `eng-harness-1-boot` | loop | Boot stage — validate the harness is healthy at session start. |
| `eng-harness-2-backpressure` | loop | Backpressure Check — advisory deterministic-sensor coverage survey. |
| `eng-harness-4-retro` | loop | The friction lifecycle — in-flight capture (via the `harness observe` CLI verb), session-end drain, long-horizon harvest. |

## Canonical install patterns

### Install globally for Claude Code

```bash
npx skills@latest add AI-Substrate/harness-engineering \
  -a claude-code \
  -g
```

### Install globally for GitHub Copilot CLI

```bash
npx skills@latest add AI-Substrate/harness-engineering \
  -a github-copilot \
  -g
```

### Install globally for Codex CLI

```bash
npx skills@latest add AI-Substrate/harness-engineering \
  -a codex \
  -g
```

### Install globally for OpenCode

```bash
npx skills@latest add AI-Substrate/harness-engineering \
  -a opencode \
  -g
```

### Install globally for Pi

```bash
npx skills@latest add AI-Substrate/harness-engineering \
  -a pi \
  -g
```

### Install globally for several CLIs at once

```bash
npx skills@latest add AI-Substrate/harness-engineering \
  -a claude-code \
  -a codex \
  -a opencode \
  -a github-copilot \
  -a pi \
  -g
```

### Install project-local

Drop `-g` to install into the current project rather than the user-global skill location.

```bash
npx skills@latest add AI-Substrate/harness-engineering \
  -a claude-code
```

Project-local installs are useful when a repository wants to pin the skill alongside the codebase.

### Install project-local for GitHub Copilot CLI and Cursor

GitHub Copilot CLI and Cursor both use the project-local `.agents/skills/` target through `npx skills`.

```bash
npx skills@latest add AI-Substrate/harness-engineering \
  -a github-copilot \
  -a cursor \
  -y \
  --copy
```

This installs the setup skill from the remote GitHub repository into:

```txt
./.agents/skills/
```

Use `--copy` when you want the installed skill files to be physically present in the current repo for review or commit.

### Install selected skill

Use `-s` / `--skill` to install only one skill explicitly. Swap `-a <agent>` for your CLI and use `-g` for a global install or omit it for a project-local install into `./.agents/skills/`.

Setup skill, global, Claude Code:

```bash
npx skills@latest add AI-Substrate/harness-engineering \
  -s eng-harness-0-setup \
  -a claude-code \
  -g
```

Harnessability assessment skill, global, Claude Code:

```bash
npx skills@latest add AI-Substrate/harness-engineering \
  -s eng-harness-0-harnessability-assessment \
  -a claude-code \
  -g
```

Harnessability assessment skill, project-local, GitHub Copilot CLI:

```bash
npx skills@latest add AI-Substrate/harness-engineering \
  -s eng-harness-0-harnessability-assessment \
  -a github-copilot \
  -y
```

### Test from a local checkout

From this repository:

```bash
npx skills@latest add "$(pwd)" -l
```

Install the local working tree setup skill globally to all supported CLIs:

```bash
npx skills@latest add "$(pwd)" \
  -a claude-code \
  -a codex \
  -a opencode \
  -a github-copilot \
  -a pi \
  -g \
  -y
```

Install the local working tree setup skill project-locally:

```bash
npx skills@latest add "$(pwd)" \
  -a claude-code \
  -a codex \
  -a opencode \
  -a github-copilot \
  -a pi \
  -y
```

## Just recipes

This repository also exposes convenience wrappers:

```bash
just list-skills
just install-skills-local
just install-skills-global
```

These install from the current working tree, which is useful when validating local changes before they are pushed.
