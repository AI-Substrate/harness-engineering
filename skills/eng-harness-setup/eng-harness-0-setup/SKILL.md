---
name: eng-harness-0-setup
description: Install the repo-local engineering harness from npx and guide the user to a working basic `boot`. A lean flow that orchestrates other skills — it installs/initialises the harness CLI, runs eng-harness-0-harnessability-assessment when no report exists yet, records the injection map (where the repo's extant dev/SDD flow will call /eng-harness-flow, so the harness gets used instead of disappearing on a cold agent start), then stands up a basic `boot` extension via eng-harness-0-add-extension. It generates no artifacts of its own; the CLI (and a future `harness init`) own the deterministic substrate.
---
# eng-harness-0-setup

Get a repo's **engineering harness** installed and working, then leave behind the one thing every engineering task starts from: a **basic `boot`**.

This skill is a **flow**, not a generator. It installs the harness CLI from npx, then **orchestrates other skills** — `eng-harness-0-harnessability-assessment` to size up the repo, and `eng-harness-0-add-extension` to author the first extension. It **creates no files of its own**: the deterministic substrate (the `.harness/` nucleus, retros, known-difficulties, back-pressure surfaces) is owned by the harness CLI as real code (and by a future `harness init`), not re-generated here.

> **The agent harness drives. The engineering harness proves.**

## The flow

```mermaid
flowchart TD
    P{"already installed?<br/>npx harness doctor responds"} -- yes --> C
    P -- no --> A["1 · Install harness<br/>npx + (future) harness init"] --> Ad{harness doctor OK?}
    Ad -- no --> At["Troubleshoot<br/>Node · network/gh · build"] --> A
    Ad -- yes --> C{".harness/reports/harnessability/latest.json<br/>exists?"}
    C -- no --> D["2 · Run eng-harness-0-harnessability-assessment skill"] --> E
    C -- yes --> E["Read assessment recommendations"]
    E --> I["3 · Record the injection map<br/>extant dev/SDD flow → /eng-harness-flow seams"]
    I --> F["4 · eng-harness-0-add-extension skill →<br/>basic `boot` (wrap build / run / health)"]
    F --> V["Verify · harness doctor / harness boot / harness help"]
    V --> S["5 · Offer (opt-in) · harness skills install<br/>→ install the eng-harness skills into the user's CLI"]
```

Four steps to a working boot, plus an opt-in fifth that offers to install the harness's own skills. Each box is a CLI call, a hand-off to another skill, or a recorded decision. The goal is **a working boot, even if basic** — the nucleus a team self-improves from — already wired into the flow the repo actually runs.

## When to use

Run this when a repo does not yet have a working `harness boot` (or has no harness front door at all), and you want to get an agent-operable engineering loop started quickly. It is safe to re-run: it detects what already exists and only fills the gap.

## Why `boot` is the deliverable

"Boot is the first proof." Before any engineering work, an agent runs `harness boot`, which:

- **proves the environment is ready** — builds / installs if needed, starts the product (directly or via `docker compose up`), and confirms readiness with a health, smoke, or "tests pass" signal; and
- **re-orients the agent** — a boot (like `doctor`) is orientation, not just diagnostics: it reminds the agent how this project wants to be operated and what to do next.

Keep it a **basic nucleus**. Do **not** boil the ocean — a thin wrapper over the repo's existing commands is the whole job here; the harness is self-improving, so boot grows by use. (The CLI may later flag a missing `boot`, reinforcing it as the expected entry point.)

---

## Step 1 — Install the harness

The harness CLI ships from its GitHub repo and runs via `npx` (there is intentionally no npm-published package).

1. **Check whether the harness is already installed — never blindly (re)install:**

   ```bash
   npx harness doctor --json 2>/dev/null || echo "NO_HARNESS"
   ```

   An envelope back (any `status` — `degraded` counts) means the CLI already resolves in this repo: **skip the install entirely (steps 2–3)** and jump to the sanity-check (step 5) — re-running setup only fills whatever gaps `doctor` names from there (step 4's `harness init` still applies if the nucleus is missing). A `.harness/` directory or a harness dependency already in `package.json` are the same signal. Only `NO_HARNESS` (or command-not-found) proceeds with the install below.

2. **Prove the installer runs** (checks Node + network + the CLI itself):

   ```bash
   npx github:AI-Substrate/harness-engineering help
   ```

3. **Make `harness` resolve locally** for repeated use — install it into the target repo (its `prepare` step builds the CLI):

   ```bash
   # Repos with no package.json (typical for Python/Go): npm walks UP to the
   # nearest manifest and installs OUTSIDE the repo. Seed a manifest first
   # (or pin the prefix: `npm install … --prefix "$PWD"`):
   [ -f package.json ] || npm init -y

   npm install github:AI-Substrate/harness-engineering
   # pin a release if you want reproducibility:
   # npm install github:AI-Substrate/harness-engineering#vX.Y.Z
   ```

   Afterwards use `npx harness <command>` (it resolves the locally-installed CLI whether or not `harness` is on PATH). **All examples below use `npx harness …`; drop the `npx` prefix only if `harness` is already on your PATH.**

4. **Initialise the nucleus** — run the deterministic bootstrap:

   ```bash
   npx harness init
   ```

   > **Graceful fallback (important).** `harness init` is the planned bootstrap that creates the `.harness/` nucleus deterministically. If your installed CLI does **not** recognise it yet (unknown-command error), **do not fail** — continue. `.harness/extensions/` is created lazily by `harness new` (Step 3), so the flow still works today. Note the gap so it's encoded once `init` ships.

   `.harness/temp/` is transient agent scratch — never committed; the CLI self-heals its nested `.gitignore` and `harness doctor` checks the convention.

5. **Sanity-check** with the CLI's own front door:

   ```bash
   npx harness doctor          # human-readable
   npx harness doctor --json    # envelope: status / data / error / next_action
   ```

   On a fresh consumer repo, the `cli-build` layer reports **ok (n/a)** — it only runs a real build check inside the CLI's own repo (FX001) — and `.harness/extensions/` is **empty**; both are expected, not failures. `doctor` can still go `status: degraded` for other reasons (a missing tool, a failed extension), so the signal you need is that the CLI **runs and returns an envelope** (exit 0); read `data.layers` / `data.extensions` rather than gating on a top-level `ok`.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `command not found: npx` / very old Node | Node toolchain missing/old | Install a current Node LTS; re-run. |
| `npx` hangs or 404 on the GitHub spec | No network / no GitHub access | Check connectivity and `gh auth status`; retry, or pin a `#vX.Y.Z` tag. |
| Install errors during `prepare`/build | Build toolchain issue | Read the build error; ensure devDeps can install; re-run `npm install`. |
| `harness init` → unknown command | CLI predates `init` | Expected today — skip per the graceful fallback above; `harness new` still creates `.harness/`. |
| `harness doctor` non-zero with a real error | Genuine config problem | Follow the envelope's `next_action`; it prescribes the fix. |

**Read only the envelope.** When parsing CLI output programmatically, use `--json` (the `status` / `data` / `error` / `next_action` fields) and exit codes — never scrape human prose. This keeps the flow forward-compatible with a future MCP server over the same surfaces.

---

## Step 2 — Assess harnessability (only if not already done)

Check for an existing assessment report. The canonical sentinel is `latest.json`; treat **any** file under the report directory as an existing report (the AC4 fallback):

```bash
# reuse if the sentinel exists, OR any report file is present in the dir:
test -f .harness/reports/harnessability/latest.json \
  || ls .harness/reports/harnessability/* >/dev/null 2>&1
```

- **Report exists** (sentinel `latest.json`, or any file under `.harness/reports/harnessability/`) → reuse it. Read its recommendations (highest-leverage improvements / remediations) — they tell you what `boot` should prove first for *this* repo. (The producer keeps the root `latest.json` current on every run and stores per-run history under `.harness/reports/harnessability/<ordinal>-<slug>/`; reading the root `latest.json` always gives the newest run.)
- **No report** → run the **`eng-harness-0-harnessability-assessment`** skill (read-only by default). It scores Operate-Today and Adaptability and emits the recommendations that drive Step 3.

> The assessment is a separate skill — invoke it, don't reimplement it. The flow only needs its **recommendations** to choose the first `boot`.

---

## Step 3 — Record the injection map (so the harness gets *used*)

An installed harness that nothing calls **disappears on the next cold agent start** — a fresh agent only runs what's in the surfaces it already loads. This step makes usage structural instead of memorial: identify the repo's *extant* development flow, map its natural moments onto the harness seams, weave the calls into surfaces a cold agent loads anyway, and record the result. It runs **before** boot deliberately (the router's setup gate orders S3 · Inject before S4 · Boot) so the instant boot works, the harness is already plugged into real work.

1. **Identify the extant flow.** Read `engineering_flows[]` from the harnessability report (Step 2) — the assessment already inventories SDD-like pipelines (a `plans/` directory, `/plan-*` or `task-*` skills, RFC/ADR conventions) alongside build/test/release/review flows. No report or no entry → take a quick look yourself (skills directories, `docs/plans/`, CI workflow names, CONTRIBUTING).

2. **Map flow moments → seams.** The router speaks six universal seam events: `session-start | post-spec | pre-implement | task-pause | phase-end | plan-complete`. Whatever the host flow calls its stages, find where those moments fall. Not every flow has every seam — map what exists, skip the rest.

3. **Propose the map to the user before touching anything.** This is *their* flow — the step is a hand-held conversation, never a silent batch edit. Show the proposed map as a small table (flow moment → seam event → the surface that would carry the call), with one line per seam on why it earns its place. Invite pruning: the user reshapes or declines seams freely, and "none, thanks" is a perfectly good answer.

4. **Weave the accepted calls** into surfaces a cold agent already loads — **per surface**: show the exact edit (which file, what gets inserted, where) and get an explicit go-ahead for *each* file before applying it. Never bundle the edits into one approval, and never present the weave as already done:

   | Repo shape | Where the seams go |
   |------------|--------------------|
   | Flow is already harness-aware (its skills/guides fire `/eng-harness-flow --event …` themselves) | Nothing to weave — record "host flow self-fires" and which seams it covers |
   | Flow skills / instructions live **in this repo** | Add `/eng-harness-flow --event <seam>` calls at the mapped moments in those files |
   | No formal flow (plain branch/PR work) | The agent-context surface (`AGENTS.md` or equivalent) carries the cues: `--event session-start` when work begins, `--event phase-end` before a PR/handoff |

   A declined weave is a fine outcome — record what was decided either way (a map row can say `declined` or `manual`).

5. **Record the injection map** in the governance doc (`.harness/engineering-harness.md`) under a `## Injection map` heading — one row per seam: the seam event, where it fires from, and what fires it. This is the durable artifact the router's S3 rung reads; without it, the stateless router re-offers this step on every call. **When governance is still owed** (the `harness init` writer hasn't shipped or run), the injection map is owed with it — propose the map in conversation, note it as owed, and move on; never create the governance doc here. See [`../../eng-harness-loop/eng-harness-flow/references/governance-doc.md`](../../eng-harness-loop/eng-harness-flow/references/governance-doc.md).

**Ask first, always.** The weave edits the user's own files; nothing in this step is applied without the user having seen the specific change and said yes to it. Keep descriptions of the host flow generic and public-safe (name the flow's *shape*, never private tooling identifiers the repo doesn't already commit).

---

## Step 4 — Stand up a basic `boot`

Use the assessment's recommendations to pick the **cheapest, most valuable** readiness proof for this repo, then author it with the **`eng-harness-0-add-extension`** skill (which drives `harness new` under the hood — never hand-write the file).

Pick the boot shape from what the repo actually has:

| Repo shape | A reasonable *basic* boot wraps… |
|------------|----------------------------------|
| Dockerised service | `docker compose up -d` + a health poll |
| Web app / API with a dev server | start the server + hit a health/smoke route |
| Library / CLI (no running service) | `build` then `test`, with a printed "ready" note |

Author it via the skill, e.g.:

```bash
# the eng-harness-0-add-extension skill runs, under the hood, something like:
npx harness new boot --wrap "<the readiness command for this repo>"
```

Then **fill the handler only as much as needed** to:

- return a clear **verdict** — ready / degraded / error (the `--json` envelope + exit code an agent can branch on); and
- print short **orientation** — what the harness is and what to do next.

Keep it minimal. Resist adding seed/reset/observe/sensors now — capture those as harness friction for later; the loop will encode them when they earn their place.

### Verify

```bash
npx harness doctor      # boot now shows as a loaded extension
npx harness help        # the `boot` verb appears in the command surface
npx harness boot        # runs it — inspect the envelope/exit code for the verdict
```

When `harness boot` returns a usable verdict and re-orients the agent, the nucleus is in place. Stop here — the rest compounds through normal use.

---

## Step 5 — Offer to install the harness skills (opt-in)

The harness ships its own **skills** — the `eng-harness-*` setup + loop suite (`boot` / `backpressure` / `observe` / `retro`). Once the nucleus is in place, **offer** — never force — to install them into the user's CLI so they can run the loop directly.

1. **Ask** which CLI target(s) and scope:
   - Targets: `claude-code`, `codex`, `cursor`, `github-copilot`, `opencode`, `pi`.
   - Scope: `--global` (available everywhere) or project-local (omit `--global`).
2. **Only with the user's explicit go-ahead**, run the first-class command — a transparent pass-through to the Vercel `npx skills` installer. It **prints the exact `npx` line before running** and always passes `-y`, so nothing blocks on an interactive picker:

   ```bash
   npx harness skills install --target <cli> [--global]
   # e.g.  npx harness skills install --target github-copilot --global
   ```

3. **If the user declines, do not install.** Tell them how to do it later:

   > To install the harness skills later, run: `npx harness skills install --target <cli> [--global]`

More about the underlying installer: <https://github.com/vercel-labs/skills>.

> **Offer, don't force.** This step never runs the install unprompted. The CLI command takes explicit `--target`/`--global` flags and never blocks on a prompt — *this skill* is what asks the user, then runs the command with their answers.

---

## What this skill does **not** do

- It does **not** generate a governance doc, an `AGENTS.md` block, a `docs/harness/` scaffold, a placeholder CLI, or known-difficulties/retro/back-pressure files. Those are deterministic CLI concerns (`harness init` + the CLI), not this skill's output. The governance doc is therefore **owed, not provisioned** by this flow until `harness init` ships: this skill attempts `npx harness init` (with the graceful fallback above) and, when it isn't available yet, the governance rung stays owed and downstream readers degrade to `UNAVAILABLE` rather than erroring. See [`../../eng-harness-loop/eng-harness-flow/references/governance-doc.md`](../../eng-harness-loop/eng-harness-flow/references/governance-doc.md) for what the doc contains and when it is written. (Step 3 is the one narrow exception: with the user's go-ahead it **updates** the `## Injection map` section of an *existing* governance doc and weaves seam calls into the user's own flow surfaces — it still never *creates* the doc.)
- It does **not** reimplement `eng-harness-0-harnessability-assessment` or `eng-harness-0-add-extension` — it calls them.
- It does **not** build a comprehensive boot. Basic nucleus only.

## Guardrails

- **Orchestrate, don't generate.** Install and drive the harness; hand off judgement to the sibling skills.
- **Wrap, don't rebuild.** `boot` wraps existing repo commands.
- **Don't boil the ocean.** A working basic boot is success.
- **Public-safe.** This skill ships in a public repo — never bake in a private repo name, path, person, or internal codeword. Describe boot shapes generically.
- **Envelope-only.** Depend on `--json` envelope fields + exit codes, not scraped prose — so a future MCP server reuses the same surfaces.
