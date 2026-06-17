# INSTALL.md - Skills Installation Reference

> **For AI agents reading this**: this is the canonical install reference for the skills in this repository. If a user asks you to install them, identify which CLI they use and whether they want a global install or project-local install, then run the matching `npx skills@latest add ...` command below. The harness CLI also wraps this as `harness skills install` (a transparent pass-through — it prints the exact `npx` command before running it and always passes `-y`).

This repository publishes **two skills** through the [`npx skills@latest`](https://github.com/vercel-labs/skills) installer: the **`eng-harness-flow`** router (the single front door to the harness loop) and the standalone **`eng-harness-0-harnessability-assessment`** peer. There is no separate repository-specific installer — `harness skills install` is a thin wrapper over the same `npx skills` tool.

## Skills

| Skill | Purpose |
|---|---|
| `eng-harness-flow` | Stateless harness-loop router — the single front door; a host can pin a moment with one of five lifecycle hooks (`--hook pre-flight\|pre-coding\|coding\|post-coding\|post-flight`, with `--event` as a permanent alias), and it re-derives loop position every call and routes to the one right harness action. Its **boot / backpressure / retro / adopt / add-extension** verbs are harness-blind modules under `references/stages/`, loaded one at a time by the router — never installed or called directly. |
| `eng-harness-0-harnessability-assessment` | Score a repository's harnessability (Operate-Today and Adaptability) and report back-pressure surfaces, proof ceilings, command tiers, and proposal-only affordances. |

## Canonical install patterns

### Install globally for Claude Code

```bash
npx skills@latest add AI-Substrate/harness-engineering/skills \
  -a claude-code \
  -g
```

### Install globally for GitHub Copilot CLI

```bash
npx skills@latest add AI-Substrate/harness-engineering/skills \
  -a github-copilot \
  -g
```

### Install globally for Codex CLI

```bash
npx skills@latest add AI-Substrate/harness-engineering/skills \
  -a codex \
  -g
```

### Install globally for OpenCode

```bash
npx skills@latest add AI-Substrate/harness-engineering/skills \
  -a opencode \
  -g
```

### Install globally for Pi

```bash
npx skills@latest add AI-Substrate/harness-engineering/skills \
  -a pi \
  -g
```

### Install globally for several CLIs at once

```bash
npx skills@latest add AI-Substrate/harness-engineering/skills \
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
npx skills@latest add AI-Substrate/harness-engineering/skills \
  -a claude-code
```

Project-local installs are useful when a repository wants to pin the skill alongside the codebase.

### Install project-local for GitHub Copilot CLI and Cursor

GitHub Copilot CLI and Cursor both use the project-local `.agents/skills/` target through `npx skills`.

```bash
npx skills@latest add AI-Substrate/harness-engineering/skills \
  -a github-copilot \
  -a cursor \
  -y \
  --copy
```

This installs the skills from the remote GitHub repository into:

```txt
./.agents/skills/
```

Use `--copy` when you want the installed skill files to be physically present in the current repo for review or commit.

### Install selected skill

Use `-s` / `--skill` to install only one skill explicitly. Swap `-a <agent>` for your CLI and use `-g` for a global install or omit it for a project-local install into `./.agents/skills/`.

Router skill, global, Claude Code:

```bash
npx skills@latest add AI-Substrate/harness-engineering/skills \
  -s eng-harness-flow \
  -a claude-code \
  -g
```

Harnessability assessment skill, global, Claude Code:

```bash
npx skills@latest add AI-Substrate/harness-engineering/skills \
  -s eng-harness-0-harnessability-assessment \
  -a claude-code \
  -g
```

Harnessability assessment skill, project-local, GitHub Copilot CLI:

```bash
npx skills@latest add AI-Substrate/harness-engineering/skills \
  -s eng-harness-0-harnessability-assessment \
  -a github-copilot \
  -y
```

### Test from a local checkout

From this repository:

```bash
npx skills@latest add "$(pwd)" -l
```

Install the local working tree skills globally to all supported CLIs:

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

Install the local working tree skills project-locally:

```bash
npx skills@latest add "$(pwd)" \
  -a claude-code \
  -a codex \
  -a opencode \
  -a github-copilot \
  -a pi \
  -y
```

## Updating installed skills

Once skills are installed, refresh them to the latest published version **and** prune any this repo has since renamed or removed. The Vercel installer's `add`/`update` are additive — they never remove a renamed skill's old copy, so without a prune it lingers and keeps loading beside its replacement.

```bash
harness skills update --target claude-code --global
# repeatable --target; drop --global for a project-local update; --branch <ref> / --source owner/repo#ref to pin a branch
```

`harness skills update` wraps `npx skills add` (refresh + pull any new skills), then `npx skills remove` of the renamed-away slugs — announcing both exact commands before running. Run it after updating the harness CLI itself, so the renamed-skill list it prunes is current, and restart your CLI afterwards (skills load at session start).

## Just recipes

This repository also exposes convenience wrappers:

```bash
just list-skills
just install-skills-local
just install-skills-global
```

These install from the current working tree, which is useful when validating local changes before they are pushed.
