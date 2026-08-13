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

## Local checks

- Run the composite gate **`harness checks`** yourself before declaring work done — tests+coverage, biome, typecheck, the docs/flows/telemetry drift guards, and arch/skills/markdown/windows-check, in one envelope. (`just checks` builds first, then runs it.) **CI + branch protection are the authoritative gate.**

### CI does NOT auto-run on a PR-branch push — you must dispatch it

Pushing to a PR branch starts **no** workflow. `.github/workflows/ci.yml` triggers on
`workflow_dispatch` and on pushes to `main` only; the `pull_request` trigger was removed
because every WIP push was paying for the full Node 22 + Node 24 matrix plus package-smoke,
and with many concurrent seats that was the largest Actions line item in the repo.

**Nothing was loosened — but check which half is live.** The `ci-required` job publishes a
`ci-verdict` commit status, and the intent is that `ci-verdict` be a **required** status
check on `main`, so a head SHA that has never been dispatched has no verdict and the PR
reads *Expected — waiting for status to be reported*: unmergeable.

> **Enforcement status: the pin is NOT yet applied.** The `main` ruleset carries no
> `required_status_checks` rule, so today nothing blocks a merge on CI — that hole predates
> this change (the old branch-protection object that required a check was replaced by a
> ruleset that dropped it). Do not trust this paragraph; ask the repo:
>
> ```bash
> gh api repos/AI-Substrate/harness-engineering/rules/branches/main --jq '[.[].type]'
> ```
>
> `required_status_checks` present ⇒ enforced. Absent ⇒ CI is advisory and a red PR can be
> merged by anyone who doesn't look.

Ask for the verdict when you want it:

```bash
just ci                                # dispatch on the current branch
gh workflow run ci.yml --ref <branch>  # …or any branch
gh run list --workflow=ci.yml --branch <branch>   # watch
```

**Before pinning `ci-verdict`, check the publisher's PRESENCE on every open PR head** — a
branch that predates the publisher cannot emit the context at all, so pinning would leave it
blocked with no reachable green:

```bash
git show <ref>:.github/workflows/ci.yml | grep -c ci-verdict   # must be non-zero, every PR
```

Derive from the property you need (*emits `ci-verdict`*), never the proxy (*has taken
main*) — a branch can be legitimately unable to take main.

**Why the required check is `ci-verdict` and not the `ci-required` job.** A
`workflow_dispatch` check suite is **excluded from the commit's `statusCheckRollup`**, and
rulesets evaluate the rollup — so a dispatched run's check runs can never satisfy a required
check, however green they are. (Measured on sha `803ff983`: all five check runs present and
successful via `/commits/<sha>/check-runs`, the suite even listing `pull_requests: [166]`,
yet `statusCheckRollup` was `null` and the PR sat BLOCKED. The same query on a
`pull_request`-event sha returned a SUCCESS rollup.) A commit **status** *is* rollup-eligible
regardless of event, so the `ci-required` job publishes its verdict as the `ci-verdict`
status and the ruleset requires that. The rule is pinned to the GitHub Actions app
(`integration_id: 15368` — *not* `41898282`, which is the `github-actions[bot]` **user** id),
so a human cannot hand-post a green verdict with `gh api .../statuses/<sha>`.

**Dependabot cannot satisfy this check on its own.** Dependabot opens PRs but cannot dispatch
a workflow, and nothing runs on its branches, so every dependabot PR needs someone to run
`gh workflow run ci.yml --ref <head>` before it can ever merge.

> **The failure mode is silence, not an error.** A dependabot PR that is permanently
> unmergeable looks exactly like a dependabot PR nobody has got round to. A quiet queue is
> not evidence of a calm one — if the security queue looks idle, check whether anything has
> been *dispatched*, not whether anything is red.

Auto-merge would hide this completely: it would wait forever on a check nothing triggers.
That needs two deliberate acts today — the repo setting **`allow_auto_merge` is `false`**, so
per-PR auto-merge cannot be enabled until someone flips it. **If you are the one flipping it,
this paragraph is the consequence you are taking on**; pair it with a dispatcher for
dependabot heads (one `gh workflow run` per PR) or the queue stalls in silence.

Two consequences that bite if you forget them:

- **CI tests the sha on the REMOTE**, and the verdict binds to *that* sha — dispatch with
  unpushed commits and you get a green verdict against code you did not write. `just ci`
  refuses when `origin/<branch>` and your HEAD disagree; a bare `gh workflow run` will not.
- **Every new commit re-blocks the PR.** That is the design, not a bug — dispatch again once
  you have stopped pushing.

Do **not** "fix" any of this by restoring `pull_request` with a job-level `if:` guard. A job
skipped by `if:` reports as **skipped**, and branch protection counts skipped as **success** —
that shape lets an untested PR merge. An absent check blocks; a skipped check does not.

### Never `git stash` in this repo — measure against a ref instead

**The stash stack is SHARED across every worktree** (34 of them, 13 concurrent seats, one `refs/stash`). A `stash`/`pop` pair races every other seat, and the loser silently inherits someone else's uncommitted work into a tree they are about to commit from. **A bad pop is indistinguishable from legitimate work in progress** — no error, no marker, just modified tracked files beside your own edits.

- **Do not** `git stash`, `stash pop` or `stash apply`, **for any reason — including "just to measure."** Three seats reached for it in one day, every one of them while *measuring* rather than delivering.
- Checking `git stash list` first is **not** a control. It answers *whose is this?* when the question is *what will `pop` restore into my tree?* — and one seat read a foreign stash, correctly noted it wasn't theirs, and filed that as reassurance.
- To compare against another ref: **`harness checks --ref <ref>`** (below), or `git show <ref>:<path>` / `git grep <pat> <ref> -- <path>` for a single file, or a throwaway `git worktree add`.

**`harness checks --ref <ref> [--keep]`** answers **"is this ref sound?"** — it runs the whole gate against any ref in a throwaway worktree that installs its own dependencies, and returns a verdict pinned to the resolved sha. Your tree is never touched; the isolation is structural, so there is nothing to be careful about. ~55s cold.

It measures **the ref, not your tree.** Because it builds fresh from the ref it cannot see local breakage — a stale `dist/`, a half-applied rebase, an uninstalled dependency — which a plain `harness checks` does report. Ask `--ref` about a commit; ask the ordinary gate about your working tree. The isolated tree **must** own its `node_modules`: vitest writes `node_modules/.vite/vitest/<hash>/results.json` on an ordinary run, so sharing or symlinking deps would leak writes back into your checkout — an untracked write, invisible to `git status`.

If a `--ref` run is **interrupted**, it leaves a registered worktree — and **`git worktree prune` will not reclaim it**, because prune only drops entries whose directory is gone and a half-installed tree still has one. Recover with `git worktree remove --force <path>`. The verb reports any it finds rather than deleting them: another seat may be running its own `--ref` gate, and the name cannot distinguish a crashed tree from a live one. **`git worktree prune` is itself repo-global** — it can remove other seats' entries, so prefer the targeted `remove`.

### Test scope: the suite runs FAST by default, and says so

The test suite defaults to a **fast scope** that skips the 12 slowest files — **5% of the tests, ~81% of the runtime, 1,363 of 1,617 process spawns** (measured: `just test` 22.5s → 8.9s; `harness checks` 31.5s → 19.6s). The list is `SLOW_TESTS` in `harness/cli/vitest.config.ts`, each entry carrying its measured median.

| Command | Scope | Use |
|---|---|---|
| `just test` / `just fft` / `just checks` | fast | the inner loop |
| `just test-all` | **all** | **before you push** |
| `just test-heavy` | the 12 slow files only | rarely, directly |

- **`HARNESS_TEST_SCOPE`** (`fast`\|`all`\|`slow`) is the single control point, chosen over vitest `projects`/`--project` precisely because `harness checks` spawns vitest itself — an env var is inherited by every invocation path, so the default cannot be true locally and false in the gate. An unrecognised value **fails loudly** rather than falling back to a smaller suite.
- **CI sets `HARNESS_TEST_SCOPE=all`** (`.github/workflows/ci.yml`). That line is load-bearing: the skipped 12 are the git adapters, the pre/post-commit hooks and the telemetry push path — the code most likely to break on Windows. Without it they would run **nowhere**.
- **A reduced scope always declares itself** — a stderr banner on every fast run, and a `note` on the `tests` gate in the `checks` envelope for JSON consumers. A local green must never quietly mean less than yesterday's.
- Do **not** use vitest tags for this. Tags filter *tests* but still **load the files**, and ~86% of the tail's cost is module import — you would skip the assertions and keep the cost.
- `test/architecture/fast-scope-guard.test.ts` fails if a `SLOW_TESTS` entry stops existing (a stale entry excludes nothing and the fast scope silently grows back). It asserts composition, not wall-clock times — a duration threshold on shared hardware is a flake generator.

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

### Git hooks: this repo installs NONE — and two rules survive their removal

**There is no `just install-hooks`, no `.githooks/`, and no tracked git hook here.** The
harness-side capture those hooks fed went **off by default in code** at plan 073
(`capture-gate.ts` — `CAPTURE_DEFAULT_ENABLED = false`), when git-ai became the collector,
so a `pre-commit` that buffered a capture and a `post-commit` that flushed it were serving a
path that no longer runs unless someone sets `HARNESS_TELEMETRY_CAPTURE=1`. They were
removed rather than left to rot.

If you ran `just install-hooks` before it was removed, your clone still has
`core.hooksPath=.githooks` pointing at a directory that no longer exists. That is harmless —
git finds no hook and proceeds — but you can clear it with
`git config --unset core.hooksPath`.

Two rules outlived the hooks, and both still bind:

- **Never add a push-triggered `harness checks` gate.** A tracked `.githooks/pre-push` that
  ran `harness checks` on every push recursed — `harness checks` auto-pushes telemetry on
  exit, the push re-fired the gate — and it pinned a 16-core box at load 175.
- **The `--no-verify` on the telemetry push (`exec-git-write.ts`) is load-bearing.** It is
  what makes any commit- or push-time flush recursion-proof, and it must stay even though
  nothing hooks those events today.

**`git-ai install-hooks` is a DIFFERENT command and is untouched by any of the above.** It
belongs to the live collector (`services/doctor/collector/`), it is what plan 073 replaced
harness-side capture *with*, and a search-and-destroy on the string `install-hooks` would
gut it. Likewise `core.hooksPath=` in `exec-remote-telemetry-git.ts` is a *suppression* that
makes the telemetry push hook-free — not an install.

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
