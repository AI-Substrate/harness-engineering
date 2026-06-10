# Set up and run an engineering harness — agent onboarding

> **For AI agents reading this**: this is the canonical self-contained guide for standing up — or operating — a repo-local engineering harness using the harness CLI and skills published from [`AI-Substrate/harness-engineering`](https://github.com/AI-Substrate/harness-engineering). If a human gave you this document (or its URL) and pointed you at a repository, your mission is below. You need nothing else: no access to the harness-engineering repo, no prior knowledge of the product.
>
> **For humans**: paste this into your agent — *"Read https://raw.githubusercontent.com/AI-Substrate/harness-engineering/main/AGENTS_README.md and follow it in this repo."*

**Audience note**: this guide is for agents working in **consumer repos** (any codebase that wants a harness). If you are contributing to the harness-engineering repo itself, read its `AGENTS.md` instead — that is a different job.

---

## What you're building

An **engineering harness** makes a repo's development loop explicit and operable:

```text
Boot → Backpressure Check → Do Work and Observe → Retro and Magic Wand → Improve
```

Concretely, you will leave behind:

- the **`harness` CLI** installed as a repo dependency — the agent-friendly front door (`harness help`, `harness doctor`, structured JSON envelopes, honest exit codes);
- a **`boot` verb** that proves the product runs (wraps the repo's canonical test/build/smoke lane);
- the **harness skills** installed project-local, so future agents get the choreography, not just the tools;
- an **`AGENTS.md` route**, so the next agent in this repo finds all of the above at session start;
- committed **records** (`.harness/records/`) carrying forward what was learned.

The harness never fakes success. A `boot` that honestly reports `degraded` or `unconfigured` (with a `next_action`) is correct behaviour. If the repo genuinely cannot be harnessed, saying so — grounded in evidence — is a valid outcome.

---

## Route by situation

| Situation | Go to |
|---|---|
| Repo has **no harness** (no `.harness/`, no `harness-engineering` in `package.json`) | [First-time setup](#first-time-setup) below |
| Repo **already has a harness** | [Operating an existing harness](#operating-an-existing-harness-run-2) |

---

## First-time setup

### Step 1 — Install the harness CLI into the repo

The CLI is a Node package installed straight from GitHub (Node >= 22 required; pin a tag with `#vX.Y.Z` for reproducibility):

```bash
# Repos with no package.json (typical for Python/Go): npm walks UP to the
# nearest manifest and installs OUTSIDE the repo. Seed a manifest first:
[ -f package.json ] || npm init -y

npm install github:AI-Substrate/harness-engineering
```

Verify — this must print the CLI's usage:

```bash
npx --no-install harness --help
```

> **Never run bare `npx harness`** — that fetches an unrelated `harness` package from the npm registry. After the install above, always use `npx --no-install harness …` (or `./node_modules/.bin/harness …`) so you get the repo-local binary.

**If the install fails in the `prepare` build step** (the package compiles TypeScript on install, and a consumer repo's own toolchain can interfere): build a clean tarball outside the repo and vendor it —

```bash
git clone --depth 1 https://github.com/AI-Substrate/harness-engineering /tmp/he-build
(cd /tmp/he-build && npm install --ignore-scripts && npm run build && npm pack)
mkdir -p .harness/vendor
cp /tmp/he-build/harness-engineering-*.tgz .harness/vendor/
npm install ./.harness/vendor/harness-engineering-*.tgz
```

This also makes the install deterministic for everyone who clones the repo later — `npm install` restores the harness from the vendored artifact with no network fetch.

### Step 2 — Read the CLI's own briefing

```bash
npx --no-install harness instructions   # the agent briefing — envelope contract, self-briefing loop
npx --no-install harness help --json    # the verb map + safe first actions
npx --no-install harness docs           # bundled offline docs (then `harness docs <id>`)
```

The contract in one breath: every command emits one envelope `{command, status, data, error?, next_action?, timestamp}`; `status` is `ok | degraded | unconfigured | error`; exit codes are `0` (ok/degraded), `2` (unconfigured), `1` (error); `next_action` is required on any non-ok status — **follow it before improvising**. Pass `--json` for machine-readable output (piped output auto-selects JSON).

### Step 3 — Install the harness skills (project-local)

The CLI brings determinism; the **skills** bring the choreography. Install them into the repo for your agent CLI:

```bash
npx --no-install harness skills install --target <your-cli>
# targets (repeatable): claude-code | codex | cursor | github-copilot | opencode | pi
```

This is a transparent pass-through to `npx skills add` (it announces the exact command before running, always non-interactive). The source defaults to `AI-Substrate/harness-engineering` — no flags needed beyond the target. Omit `--global` so the skills land **project-local** (e.g. `./.agents/skills/`, `./.claude/skills/`): the repo should stand alone for the next agent.

**Consent note**: if your operator asked you to set up the harness end-to-end (including by handing you this document), that instruction is your go-ahead for a project-local install. If you are pairing interactively with a human, offer first.

What you get:

| Skill | Group | Purpose |
|---|---|---|
| `eng-harness-0-setup` | setup | The setup flow itself — install, assess, stand up `boot`, route agents. |
| `eng-harness-0-harnessability-assessment` | setup | Score the repo's harnessability; map back-pressure surfaces and proof ceilings. |
| `eng-harness-0-add-extension` | setup | Guided authoring of a new `harness <verb>` extension. |
| `eng-harness-1-boot` | loop | Boot stage — validate harness health at session start. |
| `eng-harness-2-backpressure` | loop | Advisory survey of deterministic-sensor coverage for the current scope. |
| `eng-harness-4-retro` | loop | The friction lifecycle — capture (via `harness observe`), drain, harvest. |

### Step 4 — Assess, then stand up `boot`

Drive the installed skills (`eng-harness-0-setup` is the orchestrator; it runs the assessment if one doesn't exist yet). The shape of the work:

1. **Assess** — run the harnessability assessment. It writes a graded report to `.harness/reports/harnessability/` (Operate-Today and Adaptability axes). If the assessment itself concludes the repo isn't workable, abandoning with that evidence is a valid, honest outcome.
2. **Stand up `boot`** — find the repo's canonical "prove it runs" command (test suite, build + smoke, dev-server health check), then scaffold a real verb around it:

   ```bash
   npx --no-install harness new boot --wrap "<canonical command>"
   # e.g. --wrap "npm test"   or   --wrap "make check"   or   --wrap "pytest -q"
   ```

   This creates `.harness/extensions/boot/` (entry + `instructions.md` briefing). Edit the briefing so it tells the next agent what `boot` proves and what judgment is expected back.
3. **Verify independently** — don't trust your own scaffold:

   ```bash
   npx --no-install harness doctor --json          # extension loaded, no convention complaints
   npx --no-install harness instructions boot      # the briefing reads true
   npx --no-install harness boot --json            # a real run: honest status + legal exit code
   ```

### Step 5 — Route future agents (`AGENTS.md`)

This is what makes run 2 work. Add this block to the repo's `AGENTS.md` (create the file if it doesn't exist; adapt the boot line to what you wrapped):

```markdown
## Engineering harness

This repo has an engineering harness. At session start:

1. `npm install` — restores the repo-local `harness` CLI
2. `npx --no-install harness instructions` — the agent briefing (AGENTS START HERE)
3. `npx --no-install harness doctor --json` — what's configured + which extensions loaded
4. `npx --no-install harness boot --json` — prove the product runs before changing it

Capture friction the moment it happens:
`npx --no-install harness observe "<what happened>" --kind difficulty --severity degrading`
Drain at session end: `harness observe --list --json` → `harness record retro` → `harness observe --clear`.
```

### Step 6 — Record the journey, then commit

You just had the most valuable experience this repo will ever get: a fresh entrant's first contact. Capture it before it evaporates:

```bash
# As you work (the moment friction happens — don't batch):
npx --no-install harness observe "<what happened, 10+ chars>" \
  --kind difficulty --severity degrading \
  --workaround "<what you did>" --suggested-encoding "<how to fix it for the next agent>"
# kinds: difficulty | magic-wand | gift | insight | coordination | improvement-suggestion | confusion
# severities: blocking | degrading | annoying

# At the end — drain the buffer into a committed record:
npx --no-install harness observe --list --json
npx --no-install harness record retro     # returns data.path — write the retro there
npx --no-install harness observe --clear
```

Two storage classes: `.harness/records/` is **committed team memory**; `.harness/temp/` is **gitignored session scratch** (the capture self-heals that protection; `doctor` checks it).

Then commit everything durable: `package.json` (+ lockfile, + vendored tarball if used), `.harness/extensions/`, `.harness/records/`, `.harness/reports/`, the `AGENTS.md` block, and the project-local skills directory.

---

## Operating an existing harness (run 2+)

Signs a repo already has a harness: a `.harness/` directory, `harness-engineering` in `package.json`, an `AGENTS.md` harness block, or skills in `./.agents/skills/` / `./.claude/skills/`.

```bash
npm install                                    # restore the CLI from the repo's own manifest
npx --no-install harness instructions          # the briefing — read it before acting
npx --no-install harness doctor --json         # what loaded, what failed, why (every complaint has a next_action)
npx --no-install harness boot --json           # prove it runs BEFORE you change anything
```

Then work normally, with the loop around you: run `harness instructions <verb>` before using any verb; capture friction with `harness observe` as it happens; drain into `harness record retro` at session end. If something is missing or broken, `doctor` and the envelope's `next_action` tell you the prescribed fix — follow that before improvising.

---

## What done looks like (first-time setup)

- [ ] `npx --no-install harness --help` prints usage (CLI is repo-local)
- [ ] `harness doctor --json` → extensions loaded, no convention complaints
- [ ] `harness boot --json` → an honest envelope from a **real** run (a `degraded`/`unconfigured` status with `next_action` is honest; a fake `ok` is failure)
- [ ] Harness skills installed **project-local** (both setup and loop groups)
- [ ] `AGENTS.md` carries the harness block (Step 5)
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
| `harness skills install --target <cli>` | Install this harness's skills (pass-through to `npx skills add`, always non-interactive) |
| `harness observe "<desc>" --kind … --severity …` | Capture one friction observation to the transient buffer |
| `harness record [type]` | Scaffold a committed record (e.g. `retro`) into `.harness/records/<type>/` |
| `harness <verb>` | Anything an extension contributes (e.g. `boot`), with its own `--help` and envelope |

## Further reading

- In-CLI, offline: `harness docs` → `cli-readme`, `extend-the-harness`, `authoring-verbs`, `record-and-record-types`
- Repo docs (if you have web access): [`README.md`](./README.md) (the thesis), [`INSTALL.md`](./INSTALL.md) (per-CLI skills install matrix), [`skills/README.md`](./skills/README.md) (when to run which skill)
