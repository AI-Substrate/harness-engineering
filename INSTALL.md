# INSTALL.md - Setup Skill Installation Reference

> **For AI agents reading this**: this is the canonical install reference for the setup skill in this repository. If a user asks you to install it, identify which CLI they use and whether they want a global install or project-local install, then run the matching `npx skills@latest add ...` command below.

This repository publishes `engineering-harness-setup` through the [`npx skills@latest`](https://github.com/vercel-labs/skills) installer. There is no separate repository-specific installer. Runtime loop skills (`harness-1-boot`, `harness-2-observe`, `harness-3-retro`) are installed from `jakkaj/tools`.

## Skill

| Skill | Purpose |
|---|---|
| `engineering-harness-setup` | Create or validate a repo-local engineering harness governance file and route future agents to it. |

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

Use `-s` / `--skill` to install only the setup skill explicitly:

```bash
npx skills@latest add AI-Substrate/harness-engineering \
  -s engineering-harness-setup \
  -a claude-code \
  -g
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
