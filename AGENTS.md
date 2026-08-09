# AGENTS.md

This repository is a public-facing engineering-harness first-principles and tutorial project.

## Required reading (start here)

Read [`harness-foundations/the-harness-distilled.md`](harness-foundations/the-harness-distilled.md) before doing work in this repo — or `node harness/cli/bin/harness.js docs the-harness-distilled` for the same text through the docs surface. It is the single-hit orientation for the product this repo builds: definition, the four-layer stack, backpressure, encode-don't-document, the CLI front door, extensions, sensors, the operating loop, and the minimal nucleus. The rest of this file assumes it. The other foundation docs (`first-principles.md`, `patterns-that-work.md`, `directives.md`, `rules-of-why.md`) go deeper per area.

## This repo's dual role

This repository is **two things at once** — keep them distinct (the full version is in `docs/project-rules/constitution.md` §1):

1. **The home/source of the harness product.** The harness CLI (`harness/cli/`) and the engineering-harness skills (`skills/eng-harness-flow/`, `skills/eng-harness-0-harnessability-assessment/`) are *authored here* and *deployed out to other repos* via `npx skills` / `harness skills install`. A change here propagates to every consumer.
2. **A dogfooding site.** We also *use* the harness on this repo: `.minih.json` wires the loop skills as `minih` agents, and `.harness/extensions/` holds extensions this repo authored for itself.

Other repos are **consumers**: they install the CLI + skills, and *their* harness substrate (`.harness/extensions/`, governance doc, fixtures) lives in *their* tree — not here.

### Skills installs are local-source only (ruling, 2026-07-15)

Skill **content** installed onto this machine always comes from the tracked working-tree `skills/` directory, via the packaged→staged local path: `just install-skills-from-source` → `harness skills install --source packaged` → `resolvePackagedSkillsDir()` (`harness/cli/src/services/skills/skills-service.ts`) stages *this checkout's* `skills/` into a temp dir and installs from that path. Content is **never** fetched from a registry or proxy — do not add an install path that does.

The one remaining network touch is the installer **tool**: the recipe shells out to `npx skills@latest` (Vercel's installer), re-fetched from the registry each run. This is a **temporary bootstrap defect owned by p061, not an allowed exception** — it must be replaced with exact local/pinned, fail-closed tooling. Until then, do not read the `@latest` fetch as precedent for pulling anything else at install time.

### Where the SDD / the-flow skills live (NOT this repo)

`the-flow` and the rest of the SDD pipeline skills are **authored in a different repo**:

- **Source of truth**: `/Users/jordanknight/github/tools/skills/SDD/` (e.g. `the-flow/`, `validate-v2/`, `thesis/`, `crew-cut/`). **Edit here.**
- **Deployed copy**: `~/.claude/skills/the-flow/` is a *deployed/symlinked* artifact — read-only for inspection, **never edit it**; changes get overwritten on the next deploy.

So when working on `the-flow` (schema, template, references, routing), open `/Users/jordanknight/github/tools/skills/SDD/the-flow/…`, not the `~/.claude` mirror. (The `eng-harness-*` skills are the opposite — *those* are authored **here** under `skills/`.)

### Build mode vs. dogfood mode (do not conflate)

- **Editing** `skills/eng-harness-*/SKILL.md` or `harness/cli/` is **product development** — it changes the harness shipped to every consumer. Treat it as source work, governed by the repo's tests/checks/constitution.
- **Running** the loop (e.g. `/eng-harness-flow`'s boot stage) is **dogfooding** — it operates on *this* repo only. Friction or improvements found while dogfooding usually belong in the **product source** (the skill or CLI), because that is where the fix helps every consumer, not just this checkout.

### Self-reference caveat (boot / setup)

This repo HAS its own governance doc at `.harness/engineering-harness.md` (hand-written in plan 014; boot = the CLI's vitest suite via `just test`) — `/eng-harness-flow` boots it and reports normally here. The repo's *rules* (constitution, architecture, idioms) still live separately in `docs/project-rules/`. **Do not run `/eng-harness-flow` adoption against this repo** — this is the harness's own home, not a target repo; its governance doc is maintained by hand like any other repo's. For a zero-context start **in this repo**, invoke the bin via node directly: `node harness/cli/bin/harness.js instructions` (the agent briefing), then `… help` / `… doctor --json`. Don't lean on `npx` for the repo's *own* bin — `npx --no-install` resolution of the root package's own bin is nondeterministic across npm majors (plan 017; npm 10 ok, npm 11.13 `Permission denied`), and bare `npx harness` fetches an unrelated registry package. In **consumer** repos (harness installed as a dependency) `npx --no-install harness …` is fine — that path is proven by the package-smoke CI job.

## Deterministic documents: the `dd` CLI (there is no `harness dd`)

`harness dd *` was **removed** (plan 080). dd is consumed as a *package*
(`@ai-substrate/dd`, pinned by full 40-char git sha in the root `package.json`) and
operated through **its own CLI**. `harness plan` and `harness flow` still work — they use
the package directly — but `dd validate|build|set|doctor|link` now come from dd.

**Invoke it as `node_modules/.bin/dd <verb>`.** That is the only spelling that is both
correct and runnable today:

| spelling | what actually runs |
|---|---|
| `node_modules/.bin/dd` | **ours — use this** |
| `dd` | coreutils' disk-dump utility (`/bin/dd`) — fails loudly on our verbs |
| `npx dd` | **an unrelated package that really exists on npm** (v0.26.0). In a repo without ours installed this **fetches and executes remote code** |
| `npx @ai-substrate/dd` | ours, but **not published yet** (`npm view` → E404). Correct only after the release lands, and after registry/proxy lag clears |

The middle row is the trap worth internalising: `npx dd` is dangerous *precisely because
it looks like the careful fix* for bare `dd`. A rule that only says "don't use bare `dd`"
steers people straight into it — so name the safe spelling, never just forbid the unsafe
one.

`harness doctor` carries a `dd-cli` row that reports this, non-fatally, and only in a
repo that actually has `.dd.json` documents.

## Local checks

- Run the composite gate **`harness checks`** yourself before declaring work done — tests+coverage, biome, typecheck, the docs/flows/telemetry drift guards, and arch/skills/markdown/windows-check, in one envelope. (`just checks` builds first, then runs it.) **CI + branch protection are the authoritative gate.**

## Sensors: one truth, two views

This repo declares its fast development signals in `.harness/extensions/repo-sensors/`.
Both human and agent surfaces read the same persisted state; they are two renderers,
not two implementations.

- **Human view:** on a supported TTY with Ink available, bare
  `node harness/cli/bin/harness.js sensors` opens the live TUI. Use `1`–`9` to
  rerun a row, `a` to rerun all sensors (history-preserving), arrows to select,
  `enter` for detail, `←`/`→` for history playback, `s` for a trend snapshot,
  `c` to clear and rerun, `w` to detach, and `q`, `q` to stop the watcher and
  quit. Status glyphs separate a failing
  reading from a crashed/timed-out sensor; Trend compares the current score with
  the working-session snapshot.
- **Agent view:** agents never parse TUI output. Read
  `node harness/cli/bin/harness.js sensors --json` for the same readings,
  guidance, trends, and actionable `next_action`. Use `sensors check` only when
  an explicit CI-style gate should map fail/error/timeout to a non-zero exit.
  Run-all defaults to bounded concurrency 4; use `sensors check --concurrency 1`
  when CI needs uncontended per-sensor wallclocks. Run the headless watcher
  through the agent environment's
  `ctx.background.spawnDetached` capability, using `node` plus the local
  `harness/cli/bin/harness.js sensors watch` arguments—not a shell wrapper.
- **Branch semantics:** `--json` always selects JSON, and non-TTY output uses the
  JSON path. A supported TTY with Ink uses the TUI. Missing Ink or an unsupported
  terminal takes the honest degraded fallback path; do not claim every TTY is
  guaranteed a TUI or forbidden from receiving JSON-shaped fallback output.

Sensors are short-feedback instruments, not batch jobs: target seconds, tolerate
up to about 2–3 minutes, never longer. The default 30-second hard kill is the
paved path; a timeout above 180 seconds is a design smell. **If your sensor needs
20 minutes, it isn't a sensor.** See [the sensors guide](docs/how/harness-sensors.md)
for the shipped set, authoring rules, and watch globs.

### Git hooks: NO pre-push gate, YES a post-commit telemetry flush

These are deliberately asymmetric — keep them straight:

- **NO `pre-push` checks gate.** A tracked `.githooks/pre-push` that ran `harness checks` on every push was removed because it recursed: `harness checks` auto-pushes telemetry on exit, the push re-fired the gate, and it pinned a 16-core box at load 175. **Do not re-add a push-triggered `harness checks` gate.**
- **YES a `post-commit` telemetry flush** (`just install-hooks` → `core.hooksPath=.githooks` → `.githooks/post-commit`). It runs **only `harness telemetry sync`** — a counts-only push to `refs/harness-telemetry/*` — so each commit flushes buffered telemetry without anyone remembering to. It **cannot recurse** (no build, no tests; the telemetry push is `--no-verify`, so it triggers no hook) and **cannot block a commit** (post-commit's exit code is ignored). `harness doctor` warns when a repo is capturing telemetry but has no flush hook — run `just install-hooks` to resolve it. The `--no-verify` on the telemetry push (`exec-git-write.ts`) is **load-bearing**: it is what makes any commit/push-time flush recursion-proof.

## Model-to-task fit & delegation (token discipline)

Match the model to the task, and delegate chores out of the parent window. Unless the context carries overriding instructions:

- **Chores → cheap model, in a subagent**: codebase searches, git commit/push ceremonies, file sweeps, grep audits, artifact collection. Two independent reasons: they clog the parent context window, and they burn an expensive model on work a cheap one does fine (Sonnet-class).
- **Analysis / review / critique → capable model** (Opus-class), still usually in a subagent so the parent keeps its context for judgement.
- **Judgement, design, adjudication — and reviews deemed genuinely hard → the lead/premium model.** Tier selection scales with difficulty; it never defaults to "whatever the parent is running".
- These are suggestions the flow/agent makes, never mandates — explicit user or context instructions about model or placement always win.

Rationale: small token costs compound at team scale — see `harness-foundations/rules-of-why.md` (Rules 5–6).

## Repo framing

- Build a reusable, evidence-backed guide for engineering harnesses: how teams create fast, observable, repeatable development loops.
- Treat the engineering harness as a first-class product surface, not scaffolding.
- Keep the engineering harness / agent harness distinction explicit in public content: this repo studies the project-side engineering harness, not agent runtimes themselves.
- Distill private/raw source material into general principles, patterns, and tutorial content that can be shared safely.
- Prefer practical, agent-readable guidance: commands, checks, examples, templates, and explicit feedback loops.
- **Wording rule**: never use "the harness is the product / the task is the exercise" framing in docs, decks, or skill prose — audiences found it demoted the actual work. Use the softened framing from `harness-foundations/rules-of-why.md` Rule 3: every run produces two things — the work, and evidence about the environment; both matter, neither is the other's exercise.
- **Durable guidance lives in the repo** (AGENTS.md, `harness-foundations/`, skills), never in a client-side session memory — not every agent reads Claude Code memories.

## Harness layer definitions

- **Engineering harness**: the project/product development loop — commands, recipes, fixtures, seed data, boot/build/test/run/health/observe/verify flows, feedback capture, and encoded improvements that let a human or agent change the actual software safely and quickly.
- **Agent harness**: the runtime/control plane around an AI model that turns it into a tool-using agent: tool dispatch, permissions, context/session management, orchestration, state, and execution environment. Examples include Claude Code, pi, Copilot CLI, MAF-style agent systems, and `minih`.
- The agent harness invokes and benefits from the engineering harness, but does not replace it. If the software cannot boot, run, seed, and prove behavior, the agent has nothing reliable to drive.
- Practices like magic-wand retrospectives, difficulty ledgers, and self-improving feedback loops are engineering-harness practices when they improve the project/product development loop, even if an agent harness helps collect or enforce them.

## Source handling and research workflow

- `scratch/` is the **user-accessible temporary working area** and is gitignored — agents may write here freely for artifacts the user wants to inspect (e.g. sample outputs, generated HTML/report demos under `scratch/sample-telemetry/`, scratch scripts, evidence drafts). Prefer `scratch/` over the session-private OS temp dir when the output is something the user should be able to open locally.
- `scratch/` is also the private research workspace. Raw sources, notes, excerpts, and evidence drafts live there only.
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



<!-- BEGIN harness:commit-guidance -->
## Committing in this repo

Use `harness commit "<message>" -- <paths>` rather than a chained
`git add … && git commit …`.

A `harness commit` is **verified or named**: it probes the collector ingress,
commits, and then tells you WHICH outcome you got. It never blocks and never
rolls back. The outcomes are:

- **confirmed** — when the collector ingress socket is reachable: harness commits with no trace2 override, waits (bounded) for the `refs/notes/ai` note, and tells you whether it landed. A landed note is the healthy shape, and a miss is reported to you rather than hidden — with the next step named in the command's own output. Nothing was buffered on this path, so there is nothing to drain.
- **buffered and named** — when git's configured trace2 target is a plain FILE, or when the ingress is blocked, absent or unconfigured: the commit is made with its trace2 events going to a buffer file instead of the collector, so attribution is DEFERRED, not lost — and it isn't proven yet either. `harness commit` names the buffer it used; when the configured target is a plain FILE it must be pointed back at the socket first, because while it names a file there is no ingress to replay into. Drain it with `harness doctor telemetry-nudge` from an UNSANDBOXED shell. Recovery is POSIX-ONLY: the drain replays into an af_unix socket, so on a Windows host `harness doctor telemetry-nudge` refuses on platform grounds and drains nothing — the buffered events stay on disk, untouched, until they are drained from a host whose collector ingress is an af_unix socket.
- **NOT VERIFIED on this platform** — when trace2 points at a Windows NAMED PIPE (\\.\pipe\…): the commit is made with no trace2 override (git talks to the pipe as usual), nothing was buffered, nothing was written beside the pipe — and nothing is claimed about attribution, because nothing was measured. Check for yourself with `git notes --ref=ai show HEAD`. Do NOT run `harness doctor telemetry-nudge` — there is no buffer to drain and no replay path for the named-pipe transport, and it will refuse.

A chained or compound `git commit` can **silently lose attribution** — agent
command sandboxes block git-ai's socket, git quietly disables trace2, and the
commit's authorship may later be recorded as human.

Neither shape guarantees delivery. What `harness commit` guarantees is that the
outcome is never silent. Read `harness instructions commit` for the detail.
<!-- END harness:commit-guidance -->
