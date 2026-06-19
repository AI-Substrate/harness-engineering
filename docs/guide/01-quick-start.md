# Quick Start

> **From zero to a green boot.** For an engineer (and their agent) installing the harness into their own repo. ~15 min.

This is the brisk path: install the CLI, install the skills, and let the router walk you to your first proven boot. Want the unhurried version with the *why* behind each step? See [04 · Adopting the Harness](04-adopting-the-harness.md).

> **⚡ Fastest start — let your agent do it.** You don't even need the CLI yet. Paste this to your agent, inside your repo:
>
> ```text
> Install and adopt the engineering harness in this repo. Read
> https://github.com/AI-Substrate/harness-engineering/blob/main/AGENTS_README.md
> and follow it: install the CLI, install the skills, then run /eng-harness-flow.
> ```
>
> It installs everything (CLI included) and walks adoption. **Use a capable model for this** — a recent Claude Opus or GPT model; adoption is multi-step reasoning, and a stronger model sets the repo up noticeably better. Prefer to do it by hand? Continue below.

## Before you start
- **Node.js** (the CLI ships as an npm package) and **git**.
- Optionally, an agent CLI you already use — Claude Code, Copilot CLI, Cursor, and others are supported. The harness works human-only too.

## 1 · Install the CLI (once per machine)

```bash
npm install -g @ai-substrate/engineering-harness
harness doctor
```

`harness doctor` is your readiness check — it reports what loaded and what (if anything) failed or conflicted. Run it any time you want a status read.

## 2 · Stamp the governance doc

```bash
harness init
```

This seeds `.harness/engineering-harness.md` — a short, repo-local "how this project wants to be operated" doc (a skeleton you fill in). It is idempotent and prints the path it wrote. `.harness/` is the only new directory the harness adds to your repo; it does **not** rewrite your build, your CI, or your workflow.

## 3 · Install the skills into your agent

The harness ships **skills** — agent-readable workflows for adoption and the daily loop.

```bash
harness skills install --target claude-code --global
```

`harness skills install --help` lists the supported targets (`claude-code`, `codex`, `cursor`, `github-copilot`, `opencode`, `pi`); drop `--global` for a project-local install. Under the hood this is a pass-through to `npx skills add`. Then **reload skills** in your agent so it sees them — in many CLIs that is `/skills reload`, or just restart the session. The per-agent matrix lives in [`INSTALL.md`](../../INSTALL.md).

> **For agents:** point me at a repo and I can bootstrap myself — `harness docs agents-readme` prints the self-contained onboarding guide.

## 4 · Run the router

```text
/eng-harness-flow
```

`/eng-harness-flow` is the **adoption + loop router** skill. On a not-yet-adopted repo it detects that and walks you through the rest: a harnessability scout, recording where your workflow should call the harness, and authoring your **first boot command**.

> `boot` is **not** built into the CLI — it is the first *extension* you author for your repo, because only your repo knows how it starts. The router guides you through it; [04 · Adopting the Harness](04-adopting-the-harness.md) shows it command-by-command.

## 5 · The finish line: a green boot

You have finished the quick start when:

```bash
harness doctor      # readiness is green; your new extension(s) loaded
harness boot        # your product starts from a known state — and proves it
```

A green `harness boot` means a cold human or agent can start your product and trust the result. That is the foundation everything else builds on.

## Where next
- Understand what you just set up → [02 · What Is an Engineering Harness?](02-what-is-an-engineering-harness.md)
- The detailed onboarding walkthrough → [04 · Adopting the Harness](04-adopting-the-harness.md)
- Driving a harness someone else set up → [05 · Using an Existing Harness](05-using-an-existing-harness.md)

---

<sub>[← Prev: Start Here](README.md) · [↑ Start Here](README.md) · [Next: What Is an Engineering Harness? →](02-what-is-an-engineering-harness.md)</sub>
