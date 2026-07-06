# INSTALL.md - Skills Installation Reference

> **For AI agents reading this**: this is the canonical install reference for the skills in this repository. If a user asks you to install them, identify which CLI they use and whether they want a global install or project-local install, then run the matching `harness skills install ...` command below. The harness CLI stages its baked `skills/` tree into an absolute temp dir, then wraps `npx skills@latest add <tempdir>` with `-y`.

This repository ships its skills inside the `@ai-substrate/engineering-harness` npm package and installs them through the [`npx skills@latest`](https://github.com/vercel-labs/skills) installer. The set includes the **`eng-harness-flow`** router, the standalone **`eng-harness-0-harnessability-assessment`** peer, the **`builder`** SDD pipeline, a compatibility **`the-flow`** redirect, and the SDD helper skills `validate-v2`, `plan-0-v2-constitution`, and `plan-v2-extract-domain`.

## Skills

| Skill | Purpose |
|---|---|
| `eng-harness-flow` | Stateless harness-loop router — the single front door; a host can pin a moment with one of five lifecycle hooks (`--hook pre-flight\|pre-coding\|coding\|post-coding\|post-flight`, with `--event` as a permanent alias), and it re-derives loop position every call and routes to the one right harness action. Its **boot / backpressure / retro / adopt / add-extension** verbs are harness-blind modules under `references/stages/`, loaded one at a time by the router — never installed or called directly. |
| `eng-harness-0-harnessability-assessment` | Score a repository's harnessability (Operate-Today and Adaptability) and report back-pressure surfaces, proof ceilings, command tiers, and proposal-only affordances. |
| `builder` | The packaged SDD pipeline: guided `/builder` plus direct stage jumps for research, plan, tasks, implement, review, and ship. |
| `the-flow` | Backwards-compatible redirect that loads `builder` with the same args. |
| `validate-v2`, `plan-0-v2-constitution`, `plan-v2-extract-domain` | Helper skills invoked by `builder`; vendored so the pipeline works without cloning the old SDD source. |

## Canonical install patterns

### Install globally for Claude Code

```bash
harness skills install --target claude-code --global
```

### Install globally for GitHub Copilot CLI

```bash
harness skills install --target github-copilot --global
```

### Install globally for Codex CLI

```bash
harness skills install --target codex --global
```

### Install globally for OpenCode

```bash
harness skills install --target opencode --global
```

### Install globally for Pi

```bash
harness skills install --target pi --global
```

### Install globally for several CLIs at once

```bash
harness skills install \
  --target claude-code \
  --target codex \
  --target opencode \
  --target github-copilot \
  --target pi \
  --global
```

### Install project-local

Drop `-g` to install into the current project rather than the user-global skill location.

```bash
harness skills install --target claude-code
```

Project-local installs are useful when a repository wants to pin the skill alongside the codebase.

### Install project-local for GitHub Copilot CLI and Cursor

GitHub Copilot CLI and Cursor both use the project-local `.agents/skills/` target through `npx skills`.

```bash
harness skills install \
  --target github-copilot \
  --target cursor
```

This installs the baked package skills into:

```txt
./.agents/skills/
```

Use the underlying `npx skills` flags directly only when you intentionally need an installer option the harness wrapper does not expose.

### Install selected skill

Use `-s` / `--skill` to install only one skill explicitly. Swap `--target <agent>` for your CLI and use `--global` for a global install or omit it for a project-local install into `./.agents/skills/`.

Router skill, global, Claude Code:

```bash
harness skills install --target claude-code --global --skill eng-harness-flow
```

Harnessability assessment skill, global, Claude Code:

```bash
harness skills install --target claude-code --global --skill eng-harness-0-harnessability-assessment
```

Harnessability assessment skill, project-local, GitHub Copilot CLI:

```bash
harness skills install --target github-copilot --skill eng-harness-0-harnessability-assessment
```

### Test from a local checkout

From this repository:

```bash
npx skills@latest add "$(pwd)/skills" -l
```

Install the local working tree skills globally to all supported CLIs:

```bash
npx skills@latest add "$(pwd)/skills" \
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
npx skills@latest add "$(pwd)/skills" \
  -a claude-code \
  -a codex \
  -a opencode \
  -a github-copilot \
  -a pi \
  -y
```

## Updating installed skills

Once skills are installed, refresh them to the package's baked copy **and** prune any this repo has since renamed or removed. The Vercel installer's `add`/`update` are additive — they never remove a renamed skill's old copy, so without a prune it lingers and keeps loading beside its replacement.

```bash
harness skills update --target claude-code --global
# repeatable --target; drop --global for a project-local update; --branch <ref> / --source owner/repo#ref to pin a branch
```

`harness skills install` / `update` records targets and scope in `skills.lock.json` (`.harness/` for project installs, `~/.harness/` for global installs). Bare `harness update` reads that lock and reconciles skills automatically; when the CLI binary actually upgrades, it re-invokes the freshly-installed `harness skills update` child so the new package's baked skills are used, not the old running process's copy.

## Just recipes

This repository also exposes convenience wrappers:

```bash
just list-skills
just install-skills-local
just install-skills-global
```

These install from the current working tree, which is useful when validating local changes before they are pushed.
