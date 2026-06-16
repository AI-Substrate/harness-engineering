# Set up and run an engineering harness — agent onboarding

> **For AI agents reading this**: this is the canonical self-contained guide for standing up — or operating — a repo-local engineering harness using the harness CLI and skills published from [`AI-Substrate/harness-engineering`](https://github.com/AI-Substrate/harness-engineering). If a human gave you this document (or its URL) and pointed you at a repository, your mission is below. You need nothing else: no access to the harness-engineering repo, no prior knowledge of the product. **This file is re-entrant** — you may be reading it for the first time, or again after a restart wiped your context. Either way, start at *Where are you?* below; it self-locates.
>
> **For humans**: paste this into your agent — *"Read https://raw.githubusercontent.com/AI-Substrate/harness-engineering/main/AGENTS_README.md and follow it in this repo."* If your agent loses context partway (including the restart in Stage 4), feed it the same line again — the guide picks up where it left off.

**Audience note**: this guide is for agents working in **consumer repos** (any codebase that wants a harness). If you are contributing to the harness-engineering repo itself, read its `AGENTS.md` instead — that is a different job (probe row 0 below catches this).

---

## Where are you? (run this first)

Check the rows **top-to-bottom**; the **first row whose condition passes** tells you where to go. A row fails when its condition is not met — fall through to the next.

| # | Probe (passes if…) | You are | Go to |
|---|---|---|---|
| 0 | The root `package.json` declares `"name": "@ai-substrate/engineering-harness"` (this repo IS the package, not a dependency) | In the harness's own home repo | **Stop** — this file is for consumer repos. Read `AGENTS.md` instead; never run `eng-harness-0-adopt` here. |
| 1 | `eng-harness-flow` appears in **your own list of invocable skills/commands** (introspect your skill registry — not `harness help`, which lists CLI verbs, not agent skills) | Skilled — ready to go | [Stage 5 — Go](#stage-5--go-enter-the-harness-loop) |
| 2 | `ls ./.claude/skills ./.agents/skills 2>/dev/null \| grep eng-harness` is non-empty (skill **files** on disk) but row 1 failed | Pre-restart — skills installed but not loaded | [Stage 4 — Restart](#stage-4--restart-load-the-skills) |
| 3 | `test -f .harness/engineering-harness.md && test -d .harness/extensions/boot` (harness substrate exists; no skills loaded) | Run 2+, unskilled | [Operating an existing harness](#operating-an-existing-harness-run-2) |
| 4 | `harness --version` exits 0 (the CLI resolves on PATH) | CLI installed, no skills | [Stage 3 — Install the skills](#stage-3--install-the-harness-skills-project-local) |
| 5 | None of the above passed | Fresh repo | [Stage 1 — Make the CLI available](#stage-1--make-the-harness-cli-available) |

Two of these probes only **you** can answer:

- **Row 1** is introspection of your own loaded skills — no file check can answer it.
- **Which CLI you are** (needed in Stage 3): you know your own runtime — Claude Code → `claude-code` · Copilot CLI → `github-copilot` · Codex → `codex` · Cursor → `cursor` · OpenCode → `opencode` · pi → `pi`. If genuinely unsure, ask your human; never guess.

---

## What you're building

An **engineering harness** makes a repo's development loop explicit and operable:

```text
Boot → Backpressure Check → Do Work and Observe → Retro and Magic Wand → Improve
```

The nucleus in one line: **[CLI focal point + required agent use] + [deterministic back pressure] + [friction capture] + [human-selected encoding] = engineering harness.**

Concretely, you will leave behind:

- the **`harness` CLI** available as an ambient global tool — the agent-friendly front door (`harness help`, `harness doctor`, structured JSON envelopes, honest exit codes);
- a **`boot` verb** that proves the product runs (wraps the repo's canonical test/build/smoke lane);
- the **harness skills** installed project-local, so future agents get the choreography, not just the tools;
- an **`AGENTS.md` route**, so the next agent in this repo finds all of the above at session start;
- committed **records** (`.harness/records/`) carrying forward what was learned.

The harness never fakes success. A `boot` that honestly reports `degraded` or `unconfigured` (with a `next_action`) is correct behaviour. If the repo genuinely cannot be harnessed, saying so — grounded in evidence — is a valid outcome.

---

## Stage 1 — Make the harness CLI available

The harness CLI is an **ambient tool** — like `git`, `node`, or `gh` — installed **globally on the machine, never into the repo**. It's published to the **public npm registry** as `@ai-substrate/engineering-harness`, so this needs **no token or `.npmrc`** (Node >= 22). Check first; only install if it's missing:

```bash
harness --version 2>/dev/null || npm install -g @ai-substrate/engineering-harness
# pin a release for reproducibility:  npm install -g @ai-substrate/engineering-harness@vX.Y.Z
```

Nothing about the CLI is committed into the repo — no `package.json` entry, no lockfile, no `node_modules`. Adoption leaves only `.harness/` substrate and (with consent) `AGENTS.md` edits. Once installed, `harness` is on PATH, so every command below is just `harness …`.

Verify — this must print the CLI's usage:

```bash
harness --help
```

> **Never run bare `npx harness`** — that fetches an unrelated `harness` package from the npm registry. Use the globally-installed `harness`. A no-global-write alternative is `npx @ai-substrate/engineering-harness <command>` (the scoped package, run from the npm cache); inside the harness-engineering *source* repo itself, invoke the bin via node directly (`node harness/cli/bin/harness.js …`) — `npx` resolution of a root package's *own* bin is unreliable across npm majors.

**If the global install is denied** with `EACCES`, that's a filesystem-permissions issue (not auth): set a user-writable prefix (`npm config set prefix ~/.npm-global`, then add its `bin` to PATH) and re-run, or use a Node version manager (nvm/Volta). A `404` / registry rejection means the wrong registry — confirm `npm config get registry` is `https://registry.npmjs.org`; the package is public, so no token is needed.

## Stage 2 — Read the CLI's own briefing

```bash
harness instructions   # the agent briefing — envelope contract, self-briefing loop
harness help --json    # the verb map + safe first actions
harness docs           # bundled offline docs (then `harness docs <id>`)
```

The contract in one breath: every command emits one envelope `{command, status, data, error?, next_action?, timestamp}`; `status` is `ok | degraded | unconfigured | error`; exit codes are `0` (ok/degraded), `2` (unconfigured), `1` (error); `next_action` is required on any non-ok status — **follow it before improvising**. Pass `--json` for machine-readable output (piped output auto-selects JSON).

## Stage 3 — Install the harness skills (project-local)

The CLI brings determinism; the **skills** bring the choreography. Install them into the repo for your agent CLI (the self-ID map in *Where are you?* tells you your `--target` value):

```bash
harness skills install --target <your-cli>
# targets (repeatable): claude-code | codex | cursor | github-copilot | opencode | pi
```

This is a transparent pass-through to `npx skills add` (it announces the exact command before running, always non-interactive). The source defaults to `AI-Substrate/harness-engineering` — no flags needed beyond the target. Omit `--global` so the skills land **project-local** (e.g. `./.agents/skills/`, `./.claude/skills/`): the repo should stand alone for the next agent.

Installing from a branch (pre-release/pinned): add `--branch <ref>` — or write the source as `--source owner/repo#ref`. Single-segment branch names only; the underlying installer cannot express slashed refs (you'll get a clear `E108` if you try).

**Consent note**: if your operator asked you to set up the harness end-to-end (including by handing you this document), that instruction is your go-ahead for a project-local install. If you are pairing interactively with a human, offer first.

What you get — **seven skills, two groups**:

| Skill | Group | Purpose |
|---|---|---|
| `eng-harness-flow` ⭐ | loop | **The front door** — stateless router; detects where the repo is on the loop and hands back the one right next command. After Stage 4, this is the only skill you need to remember. |
| `eng-harness-0-adopt` | setup | The adoption flow — install, assess, inject, stand up `boot`, route agents. |
| `eng-harness-0-harnessability-assessment` | setup | Score the repo's harnessability; map back-pressure surfaces and proof ceilings. |
| `eng-harness-0-add-extension` | setup | Guided authoring of a new `harness <verb>` extension. |
| `eng-harness-1-boot` | loop | Boot stage — validate harness health at session start. |
| `eng-harness-2-backpressure` | loop | Advisory survey of deterministic-sensor coverage for the current scope. |
| `eng-harness-4-retro` | loop | The friction lifecycle — capture (via `harness observe`), drain, harvest. |

> Heads-up: your own CLI most likely won't *see* these new skills until your operator reloads it — that's Stage 4, next.

## Stage 4 — Restart (load the skills)

The coding harness you are running inside enumerates its skills **at session start** — skills installed mid-session usually cannot be invoked until it is reloaded. Check first: **can you invoke `/eng-harness-flow` right now?** If yes, skip straight to Stage 5 — no restart needed.

If not: **you cannot reload yourself.** Restarting or reloading the agent CLI is your operator's action, not yours — ask for it and wait. Say exactly this:

> *"Skills installed. Please restart me (a fresh session), then feed me this same file again — I'll detect the installed skills and continue from where we left off."*

On re-entry, the *Where are you?* table routes you to Stage 5 in one hop.

**No-restart fallback**: the installed skills are just markdown on disk. You can read them and follow them inline without skill invocation:

```bash
cat ./.claude/skills/eng-harness-0-adopt/SKILL.md   # or ./.agents/skills/… per your CLI
```

If a SKILL.md proves unreadable or incomplete this way, fall back to the restart script above rather than improvising.

## Stage 5 — Go: enter the harness loop

```text
/eng-harness-flow
```

`/eng-harness-flow` is the front door to the harness loop. It is **stateless**: every time you run it, it re-reads the repo's signals and hands back the ONE right next command — finishing adoption if anything is missing (install → assess → governance → a working `boot`, built last), then cycling the loop (Boot → Backpressure → Observe → Retro → Improve). Run it any number of times, at any point, even after your context is wiped — it never guesses, never blocks, and says why it chose what it chose.

Whether the router drives it or you follow the adopt skill inline (Stage 4 fallback), the first-time work has the same shape:

1. **Assess** — run the harnessability assessment. It writes a graded report to `.harness/reports/harnessability/` (Operate-Today and Adaptability axes). If the assessment concludes the repo isn't workable, abandoning with that evidence is a valid, honest outcome.
2. **Stand up `boot`** — find the repo's canonical "prove it runs" command (test suite, build + smoke, dev-server health check), then scaffold a real verb around it:

   ```bash
   harness new boot --wrap "<canonical command>"
   # e.g. --wrap "npm test"   or   --wrap "make check"   or   --wrap "pytest -q"
   ```

   This creates `.harness/extensions/boot/` (entry + `instructions.md` briefing). Edit the briefing so it tells the next agent what `boot` proves and what judgment is expected back.
3. **Verify independently** — don't trust your own scaffold:

   ```bash
   harness doctor --json          # extension loaded, no convention complaints
   harness instructions boot      # the briefing reads true
   harness boot --json            # a real run: honest status + legal exit code
   ```

Then finish with Stage 6 — those steps are this guide's, not the router's.

## Stage 6 — Leave the repo better than you found it

### Route future agents (`AGENTS.md`)

This is what makes run 2 work. Add this block to the repo's `AGENTS.md` (create the file if it doesn't exist; adapt the boot line to what you wrapped):

```markdown
## Engineering harness

This repo has an engineering harness. At session start:

1. `harness --version` — ensure the global CLI is installed (`npm i -g @ai-substrate/engineering-harness` if missing)
2. `harness instructions` — the agent briefing (AGENTS START HERE)
3. `harness doctor --json` — what's configured + which extensions loaded
4. `harness boot --json` — prove the product runs before changing it

If the eng-harness skills are loaded in your CLI, `/eng-harness-flow` routes you
to the right next harness action at any point.

Capture friction the moment it happens:
`harness observe "<what happened>" --kind difficulty --severity degrading`
Drain at session end: `harness observe --list --json` → `harness record retro` → `harness observe --clear`.
```

### Record the journey, then commit

You just had the most valuable experience this repo will ever get: a fresh entrant's first contact. Capture it before it evaporates:

```bash
# As you work (the moment friction happens — don't batch):
harness observe "<what happened, 10+ chars>" \
  --kind difficulty --severity degrading \
  --workaround "<what you did>" --suggested-encoding "<how to fix it for the next agent>"
# kinds: difficulty | magic-wand | gift | insight | coordination | improvement-suggestion | confusion | win
# severities: blocking | degrading | annoying

# At the end — drain the buffer into a committed record:
harness observe --list --json
harness record retro     # returns data.path — write the retro there
harness observe --clear
```

Two storage classes: `.harness/records/` is **committed team memory**; `.harness/temp/` is **gitignored session scratch** (the capture self-heals that protection; `doctor` checks it).

Then commit everything durable: `.harness/extensions/`, `.harness/records/`, `.harness/reports/`, the `AGENTS.md` block, and the project-local skills directory. (The `harness` CLI itself isn't committed — it's a global tool; the `AGENTS.md` block above tells the next agent to ensure it's installed.)

---

## Operating an existing harness (run 2+)

Signs a repo already has a harness: a `.harness/` directory, an `AGENTS.md` harness block, or skills in `./.agents/skills/` / `./.claude/skills/`.

```bash
harness --version             # ensure the global CLI is installed (npm i -g @ai-substrate/engineering-harness if missing)
harness instructions          # the briefing — read it before acting
harness doctor --json         # what loaded, what failed, why (every complaint has a next_action)
harness boot --json           # prove it runs BEFORE you change anything
```

If the eng-harness skills are loaded in your CLI, `/eng-harness-flow` does all of this routing for you — run it at session start, at phase ends, or whenever you're unsure what the right next harness action is. (Skills installed in the repo but not loaded? Stage 4.)

Then work normally, with the loop around you: run `harness instructions <verb>` before using any verb; capture friction with `harness observe` as it happens; drain into `harness record retro` at session end. If something is missing or broken, `doctor` and the envelope's `next_action` tell you the prescribed fix — follow that before improvising.

---

## Keeping the harness current (update)

Two things drift independently over time — the **CLI** and the **skills**. Update them in this order (CLI first, so the renamed-skill list it carries is current).

### a) Update the harness CLI

The CLI knows how to update itself — it's a global install, so there's nothing to commit:

```bash
harness update            # upgrade the global install to @latest (no-op if already current)
harness update --check    # report installed vs latest, change nothing (safe to script)
harness update --pin vX.Y.Z   # move to one exact published version
```

`harness update` announces, then runs, `npm i -g @ai-substrate/engineering-harness@latest`; a denied global install / wrong registry maps to an actionable error (`E201`–`E204`). First-time bootstrap when no copy exists yet: `harness self-install` (or `npm i -g @ai-substrate/engineering-harness`). Verify:

```bash
harness --version
harness doctor --json
```

### b) Optionally update the skills

```bash
harness skills update --target <your-cli>   # add --global if your skills are installed globally
# …or fold it into the CLI update in one step:  harness update --target <your-cli> [--global]
```

`skills update` does two things the plain installer can't: it **refreshes** every skill to the latest published version (and pulls any newly added ones), then **prunes** skills this harness has since **renamed or removed** — so a rename never leaves a stale twin loading beside its replacement (e.g. an old `harness-1-boot` next to the current `eng-harness-1-boot`). It is a thin wrapper over `npx skills add` + `npx skills remove` and announces both exact commands before running. Run it **after** updating the CLI, since the CLI carries the list of renamed-away slugs to prune. Skills load at session start, so **restart your CLI** afterwards to pick up the changes.

> `npx skills` itself has no prune — its `add`/`update` are additive, so without this a renamed skill's old copy lingers forever. That's the gap `skills update` closes.

---

## What done looks like (first-time adoption)

- [ ] `harness --help` prints usage (CLI on PATH, installed globally)
- [ ] `harness doctor --json` → extensions loaded, no convention complaints
- [ ] `harness boot --json` → an honest envelope from a **real** run (a `degraded`/`unconfigured` status with `next_action` is honest; a fake `ok` is failure)
- [ ] Harness skills installed **project-local** (both setup and loop groups — all seven)
- [ ] `AGENTS.md` carries the harness block (Stage 6)
- [ ] A retro record exists under `.harness/records/retro/` describing your onboarding — friction, workarounds, and what you'd magic-wand
- [ ] All of the above committed

## Command surface (cheat sheet)

| Command | What it does |
|---|---|
| `harness help` | Purpose, dynamic verb list, output modes, safe first actions (`--json` for the machine-readable map) |
| `harness instructions [verb]` | The agent briefing (AGENTS START HERE), or one verb's briefing |
| `harness doctor` | What's configured + which extensions loaded/failed — safe at session start |
| `harness new <name> [--wrap "<cmd>"]` | Scaffold a new extension package into `.harness/extensions/<name>/` |
| `harness docs [id]` | List/print the bundled offline docs |
| `harness skills install --target <cli> [--branch <ref>]` | Install this harness's skills (pass-through to `npx skills add`, always non-interactive) |
| `harness skills update --target <cli> [--global]` | Refresh this harness's skills to latest **and prune** renamed/removed ones (wraps `npx skills add` + `npx skills remove`) |
| `harness observe "<desc>" --kind … --severity …` | Capture one friction observation to the transient buffer |
| `harness record [type]` | Scaffold a committed record (e.g. `retro`) into `.harness/records/<type>/` |
| `harness <verb>` | Anything an extension contributes (e.g. `boot`), with its own `--help` and envelope |

And once the skills are loaded: `/eng-harness-flow` (a skill, not a CLI verb) routes you to the right next harness action at any time.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm i -g` denied with `EACCES` | Global npm prefix not writable | Set a user-writable prefix (`npm config set prefix ~/.npm-global`, add its `bin` to PATH), or use nvm/Volta; re-run. |
| `spawn npx ENOENT` from `harness skills install` (Windows) | The CLI spawns without a shell, which can't launch `npx.cmd` on Windows — known issue, upstream fix pending | Run the exact `npx skills@latest add …` line the command announced before failing — identical result. *(Temporary note: remove once the win32 spawn fix ships.)* |
| `npm i -g` → 404 / registry rejects | Wrong registry, or offline | Confirm `npm config get registry` is `https://registry.npmjs.org`; the package is public — no token needed. |
| `harness init` → unknown command | An older global CLI predates the bootstrap | Upgrade with `harness update` (or `npm i -g @ai-substrate/engineering-harness@latest`); meanwhile `harness new` creates `.harness/` lazily. |
| Skills installed but you can't invoke them | Your CLI loads skills at session start | Stage 4 — ask your operator to reload/restart you (you can't do it yourself), then have them re-feed this file. |

## Further reading

- In-CLI, offline: `harness docs` → `cli-readme`, `extend-the-harness`, `authoring-verbs`, `record-and-record-types`
- Repo docs (if you have web access): [`README.md`](./README.md) (the thesis), [`INSTALL.md`](./INSTALL.md) (per-CLI skills install matrix), [`skills/README.md`](./skills/README.md) (when to run which skill)
