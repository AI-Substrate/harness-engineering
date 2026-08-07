# Harness Skills Install — first-class skill installation via the Vercel `skills` CLI

**Mode**: Simple

ℹ️ No `research-dossier.md` — clear engineering ask, went straight to spec. Consider `/plan-1a-explore` only if the Vercel `skills` discovery behaviour needs deeper verification.

## Summary

Give the harness a **first-class way to install its own skills**. Today this repo's skills (`skills/<slug>/SKILL.md`) have no installer; the canonical mechanism is Vercel Labs' `npx skills@latest add <owner/repo> …` CLI (the same tool the sibling `jakkaj/tools` repo documents). This feature: (1) **imports** the four harness-loop skills (`harness-1-boot`, `harness-2-backpressure`, `harness-3-observe`, `harness-4-retro`) into this repo; (2) **regroups** all of the repo's skills into two `eng-harness-*` category folders (`eng-harness-setup` for setup+explore, `eng-harness-loop` for the loop) so the suite reads as one product; (3) adds a **first-class `harness skills install` command** that is a thin, transparent **pass-through** to `npx skills@latest add AI-Substrate/harness-engineering …` — it asks which CLI target(s) and global-vs-local, always passes `-y` so the Vercel interactive picker never blocks, and **announces the exact command before running it**; and (4) has the installer skill (`engineering-harness-setup`) **offer** to run it (never force) with a copy-paste "install later" line.

## Goals

- A `harness skills install` command exists as a **first-class (core) verb**, travelling with the published CLI so it works in any repo the harness is installed into.
- The command **mirrors and passes through** to the Vercel `skills` CLI — it never reimplements skill installation (wrap, don't rebuild). **Rationale:** the Vercel tool already owns the full *target × type* matrix (claude-code / codex / cursor / github-copilot / opencode / pi… × global `-g` / project-local), including each CLI's per-target install path; piggybacking it means we never re-derive or maintain that matrix ourselves. Our value-add is only the *transparency layer* (announce-before-run, always-`-y`, structured envelope) and the harness-native ergonomics.
- The command **never triggers the blocking Vercel picker UI** — it always supplies `-y` (and a target).
- The command **announces the exact `npx …` invocation before executing** and tells the user where to learn more (`github.com/vercel-labs/skills`).
- The user can choose **which CLI target(s)** (claude-code / codex / cursor / github-copilot / opencode / pi…) and **global (`-g`) vs project-local**.
- The four harness-loop skills live in this repo and are installable alongside the existing skills.
- All seven skills are regrouped into two `eng-harness-*` category folders (`eng-harness-setup`, `eng-harness-loop`) for legible grouping and category-scoped installs.
- `engineering-harness-setup` **offers** the install (opt-in), and on decline prints the exact "to install later, run: …" command.
- Skills are actually installed into this repo's environment via the pass-through as the closing step.

## Non-Goals

- **Not** reimplementing skill discovery, download, or file-copying logic — the Vercel CLI owns that.
- **Not** vendoring or forking the Vercel `skills` package.
- **Not** rewriting historical plan docs under `docs/plans/*/` to use the new `eng-harness-*` names (history is preserved; only live/canonical docs are updated).
- **Not** changing the harness extension system or the `new`/`doctor`/`docs` commands.
- **Not** building an agent harness / Boot→Interact→Observe loop for this work (validated by vitest + structural checks instead).

## Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| harness-cli (`harness/cli/`) | existing | **modify** | Add a first-class `skills` command (act + service + exec pass-through), mirroring the `docs`/`doctor` core-command pattern. |
| skills corpus (`skills/`) | existing | **modify** | Regroup all 7 skills into two category folders — `skills/eng-harness-setup/` (group 0: setup + explore) and `skills/eng-harness-loop/` (the loop) — with `eng-harness-*` leaf slugs; import the 4 loop skills from `jakkaj/tools`; update `skills/README.md`. |
| engineering-harness-setup skill | existing | **modify** | Add an opt-in "offer to install skills" step with a copy-paste later-run line. |

_No `docs/domains/registry.md` in this repo — domains above are conceptual groupings for this Simple plan, not a formal domain system._

## Testing Strategy

- **Approach**: Lightweight (per Round 1).
- **Rationale**: One genuinely testable seam — the pure function that builds the `npx skills@latest add …` argv from `{ targets[], global, yes }` — plus a pass-through test that asserts the command shells out via the injected exec port with the expected argv. Follows existing `harness/cli` vitest + ports/adapters conventions (`FakeExec`).
- **Focus Areas**: argv construction (targets fan-out via repeated `-a`, `-g` presence/absence, always-`-y`, repo source string); exec invocation (`npx` + argv, no shell); the announce-before-run output; error envelope when `npx`/network fails (exit code mapped, `next_action` set).
- **Excluded**: the Vercel CLI's own internal behaviour (out of our control — we assert we *invoke* it correctly, not what it does); the mechanical skill copies/renames (verified structurally, not unit-tested).
- **Mock Usage**: Targeted (Round-1 default) — external systems (the `npx` child) are exercised via the injected `FakeExec` port; no real network in tests.

## Documentation Strategy

- **Location**: Hybrid (Round-1 default) — update `harness/cli/README.md` (command surface), root `INSTALL.md` + `skills/README.md` (how to install the skills), and the `engineering-harness-setup` SKILL body (the offer + later-run line). The bundled `harness docs` corpus gets an entry if the gen-docs pipeline enumerates commands.
- **Rationale**: The command is agent- and human-facing; both the CLI reference and the install guide must show the new path and the Vercel attribution/link.

## Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=2, I=1, D=0, N=1, F=1, T=1 (total 6)
- **Confidence**: 0.75
- **Assumptions**: (a) `npx skills@latest add <owner/repo>` discovers this repo's `skills/**/SKILL.md` regardless of one-level-vs-two-level nesting; (b) the new command can be a core verb without disturbing the extension registry; (c) the exec port can stream/capture the install output acceptably for both agent and human modes.
- **Dependencies**: Vercel Labs `skills` CLI (`npx skills@latest`); Node ≥22; network/GitHub access at install time; the source repo being public/clonable.
- **Risks**: see Risks & Assumptions.
- **Phases**: single phase, task groups G1 (import the 4 loop skills into `skills/eng-harness-loop/`) · G2 (regroup all 7 skills into the two `eng-harness-*` category folders + rename + update live docs) · G3 (`skills install` core command + tests) · G4 (`eng-harness-0-setup` skill offer + later-run line) · G5 (run the real install + verify + docs).

## Acceptance Criteria

1. `harness skills install --help` lists the command with options for target CLI(s) and global/local, and a one-line pointer to `github.com/vercel-labs/skills`.
2. Running the command **prints the exact `npx skills@latest add AI-Substrate/harness-engineering …` invocation it will run before running it.**
3. The constructed invocation **always includes `-y`** (no Vercel interactive picker is ever shown) and **always includes at least one `-a <target>`.**
4. Choosing global adds `-g`; choosing project-local omits `-g`; multiple targets fan out as repeated `-a <target>` flags.
5. The command shells out **only** through the injected exec port (no direct child spawn, no shell string) — verified by a `FakeExec` test asserting `npx` + the exact argv.
6. On `npx`/network failure the command returns a structured error envelope (non-zero exit, actionable `next_action`), never a raw stack trace.
7. The four loop skills exist under `skills/eng-harness-loop/` as `eng-harness-1-boot` … `eng-harness-4-retro`, each with its `SKILL.md` and bundled references intact.
8. All seven skills are regrouped into `skills/eng-harness-setup/` (`eng-harness-0-setup`, `eng-harness-0-harnessability-assessment`, `eng-harness-0-add-extension`) and `skills/eng-harness-loop/` (`eng-harness-1-boot` … `eng-harness-4-retro`), and every **live** reference (`skills/README.md`, `INSTALL.md`, `docs/how/extend-the-harness.md`, internal SKILL cross-links, gen-docs inputs) resolves — no dangling old-slug links in tracked, non-historical docs.
9. `engineering-harness-setup` includes an **opt-in** step that offers to run `harness skills install` and, if declined, prints the exact "to install later, run: …" command. It does not run the install unprompted.
10. `harness build`, `harness lint`, and the vitest suite pass after the change (`npm run build`, `npm run lint`, `npm test`).
11. The skills are installed into this repo's environment via the pass-through (closing step), and the install is verified (the chosen target's skills directory contains the harness skills).
12. The CLI's existing agent-first contract is preserved: `--json` emits a `status`/`data`/`error`/`next_action` envelope for the new command.

## Risks & Assumptions

- **Vercel discovery layout** — the tool documents a `skills/<category>/<slug>/SKILL.md` layout. **Resolved (Round 2):** the chosen two-category structure (`skills/eng-harness-setup/<slug>/`, `skills/eng-harness-loop/<slug>/`) is exactly that 2-level layout, so discovery works without a flat-vs-nested gamble. Still verify against the real CLI during G2.
- **Loop-skill slug coupling** — `harness-1-boot`…`harness-4-retro` are referenced by exact slug in external tooling (`the-flow`, `plan-6` companion). **Accepted (Round 2):** the user chose a full rename to `eng-harness-*`. Those external references live in **other repos** and updating them is a **follow-up outside this plan**; this plan must not silently break them without recording the gap.
- **Agent-first vs interactive** — the CLI is non-blocking and envelope-first; literal interactive prompting inside the CLI would block agents. *Mitigation*: flags are the contract; the *skill* (or a human-TTY-only prompt) does the asking.
- **Install mutates the environment** — the closing install step writes real files into a CLI's skills directory; it is the one non-idempotent, side-effecting AC and is gated behind explicit invocation.

## Open Questions

- ~~**Q1 — Command surface**~~ → **RESOLVED (Round 2): core built-in verb.**
- ~~**Q2 — Rename scope**~~ → **RESOLVED (Round 2): rename everything** to `eng-harness-*`; external slug refs in `the-flow`/`plan-6` are a follow-up outside this plan.
- ~~**Q3 — Grouping mechanism**~~ → **RESOLVED (Round 2): two category folders** `skills/eng-harness-setup/` + `skills/eng-harness-loop/` with `eng-harness-{0-,1-,2-,3-,4-}*` leaf slugs.
- **Q4 — Default target/scope** when the user gives no flags: flags are the contract; the *skill* does the asking; optional human-TTY prompt; no implicit default install. *Recorded; confirm at architect.*

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| `skills install` command surface | CLI Flow | Reconcile agent-first envelope contract with "the command should ask" — where does the asking live (skill vs CLI TTY)? how is install output streamed? | Core verb vs extension? Flags-as-contract? How to render long-running `npx` output in both modes? |
| Skill regroup + Vercel discovery | Integration Pattern | The grouping mechanism is coupled to what `npx skills add` actually discovers and how it dedupes/prunes on re-install. | Flat prefix vs category folder? Does discovery walk `skills/**/SKILL.md`? Orphan/prune behaviour on rename? |

_Simple mode — workshops optional. The two forks above are resolved inline via Round 2 questions rather than full workshops unless an answer proves deep._

## Clarifications

### Session 2026-06-09

**Round 1 (front-loaded):**
- **Q: Workflow Mode?** → **Simple** (single phase, inline task groups G1–G5).
- **Q: Testing Strategy?** → **Lightweight** — vitest unit tests on the argv builder + a fake-exec pass-through test, matching existing CLI conventions.
- **Mock Usage** (default applied): **Targeted** — external `npx` child exercised via injected `FakeExec`; no real network in tests.
- **Documentation Strategy** (default applied): **Hybrid** — `harness/cli/README.md` + `INSTALL.md` + `skills/README.md` + the `engineering-harness-setup` SKILL body.

**Round 2 (design forks):**
- **Q1: Command surface?** → **Core built-in command.** `harness skills install` is a reserved core verb (alongside `help`/`doctor`/`new`/`docs`) so it travels with the published CLI and works in any repo the harness is installed into.
- **Q2: Rename scope?** → **Rename everything** to the `eng-harness-*` namespace, including the 4 loop skills. *Accepted consequence:* external tooling (`the-flow` routing table, `plan-6` companion) references the old `harness-1-boot…harness-4-retro` slugs; those live in **other repos** (`~/.agents/skills`, `jakkaj/tools`) and updating them is a **follow-up outside this plan's scope** (recorded as a risk, not a task here).
- **Q3: Grouping mechanism + names?** → **Two in-repo category folders** under `skills/`, which also satisfy Vercel's documented `skills/<category>/<slug>/` layout (resolving the discovery-depth risk):
  - `skills/eng-harness-setup/` — base setup + explore (group **0**, pre-loop): `eng-harness-0-setup` (was `engineering-harness-setup`), `eng-harness-0-harnessability-assessment` (was `harnessability-assessment`), `eng-harness-0-add-extension` (was `add-extension`).
  - `skills/eng-harness-loop/` — the interactive flow loop: `eng-harness-1-boot`, `eng-harness-2-backpressure`, `eng-harness-3-observe`, `eng-harness-4-retro`.
  - Rationale: `0` = pre-loop setup so it sorts before the `1–4` loop stages; category folders enable category-scoped installs (`npx skills add AI-Substrate/harness-engineering/skills/eng-harness-loop`); leaf slugs stay self-describing. More skills will join either group later.
- **Agent harness** (decision, not asked): this feature **does not need an agent harness** (Boot→Interact→Observe) — it's CLI + content work validated by vitest + structural checks. No Phase 0 harness build.
