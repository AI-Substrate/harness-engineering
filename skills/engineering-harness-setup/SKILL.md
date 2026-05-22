---
name: engineering-harness-setup
description: Install a repo-local engineering harness in one invocation — front-door doc, command-mapped CLI, friction log, retrospective, install report. Use on a fresh greenfield repo or a brownfield repo that wants to establish a front door for human and agent contributors.
---

**Version**: 0.1.0

## Section 0 — Preamble

### When to use this skill

Invoke this skill when you are about to spend non-trivial time in a repository that doesn't yet have a clear engineering-harness front door. Concretely:

- A fresh greenfield repo — install the harness *before* you start writing real code, so the build/test/run loop is encoded as you discover each command.
- A brownfield repo where build/test/run knowledge is scattered across docs, scripts, and tribal memory — the harness becomes the place each command finally lands and stays.
- A repo where future agent sessions need repeatable onboarding — `<CLI> onboard` becomes the one-line entry point.
- A repo where repeated friction is solved by re-explaining the workaround — the friction log + magic-wand prompt convert that into encoded improvements over time.

### The boundary this skill installs

The agent harness drives. The engineering harness proves.

This skill installs only the **engineering harness** — the project-side development loop. It does not configure the agent runtime, tool permissions, or session state; those are the agent harness's job. The boundary sentence ships byte-identically in every load-bearing template the skill writes so neither side gets collapsed.

### Worked example (anchor)

A team encoded a single new validation recipe after a class of bug bypassed every existing gate. The bug had slipped through unit tests (which passed), integration tests (which used a different bundler config), and human review (which read the diff but didn't run the binary). After the postmortem the team added a single `<CLI> verify` recipe that built the artifact the way the deploy pipeline builds it and then exercised the failing scenario directly. The next month, four PRs that would have shipped the same class of bug were caught by the recipe before merge. That is the harness pattern this skill installs: a *narrow, executable* check encoded next to the workflow that needed it, not a *wide, prose* doc explaining the trap.

The first install of the harness rarely produces a recipe like `<CLI> verify`. It produces the place to put one when the team discovers the next bug class.

---

## Section 1 — Principles

The skill embodies eight principles. Each ships as a section of `HARNESS.md`, but the skill itself enforces them through file structure, validation gates, and the install-flow's question wording.

<!-- foundations: first-principles#10, #27 -->
**P1. The harness boundary is non-negotiable.** The skill keeps the agent-harness vs engineering-harness boundary crisp in every template it writes. The canonical sentence — *"The agent harness drives. The engineering harness proves."* — appears byte-identically in at least five files. The skill rejects edits that collapse the boundary, and the AGENTS.md patch routes agents into the harness rather than dumping the manual into the agent's instruction file.

<!-- foundations: first-principles#15, patterns-that-work#P3 -->
**P2. The development loop is productised.** The skill assumes Boot → Interact → Observe → Validate → Improve as the operating loop. `HARNESS.md` documents it; `<CLI> validate` runs the layered tiers; `<CLI> doctor` reports readiness; `harness/state/friction-log.md` captures Improve.

<!-- foundations: directives#D1, patterns-that-work#P11 -->
**P3. The supported path is easier than the shortcut.** The skill installs `<CLI>` as the front door for build/test/run/health/lint commands and writes an AGENTS.md equivalence table mapping forbidden direct invocations to required harness equivalents. Going around the harness now requires more typing than going through it.

<!-- foundations: first-principles#22, patterns-that-work#P10 -->
**P4. The fix is encoded, not just documented.** The skill installs a friction-log workflow where each entry must name a *candidate encoded fix* — a command, flag, fixture, diagnostic, or template change. Documentation alone is a tombstone for an unsolved problem.

<!-- foundations: first-principles#21, patterns-that-work#P12 -->
**P5. Validation is deterministic where possible.** The skill installs `<CLI> validate --tier {fast,quick,proof}` with the step list read from `harness/config.json.validation`, not from agent inference. When commands are unconfigured, the verdict is `unconfigured` (process exit 2), not a confident `pass`. Agent confidence is never recorded as completion evidence.

<!-- foundations: first-principles#48 -->
**P6. Agent friction is harness feedback.** The skill installs the onboarding doc with a seven-layer friction classification (instructions, tools, environment, state, feedback, validation, product) so agents and humans triage failures away from "the model can't do this" before reaching for that explanation.

<!-- foundations: first-principles#51, patterns-that-work#P10 -->
**P7. The magic-wand question closes the loop.** The skill installs the magic-wand prompt as a load-bearing artefact: it ships in `harness/templates/magic-wand-prompt.md` and is echoed byte-identically by `HARNESS.md` Rule 5, the friction log, the proof-note template, the install report, and the retrospective schema. The CLI's `<CLI> magic-wand` subcommand reads from the prompt template so future drift is impossible.

<!-- foundations: directives#D6, patterns-that-work#P13 -->
**P8. The first harness is small.** The skill ships ~11 required files plus 2 optional. No giant ledgers, no dashboards, no required schemas beyond the retrospective + harness-config schemas. The first useful version is the goal; v0.2 evolutions live in the friction log until they earn their place.

---

## Section 2 — Install flow

The skill performs these 14 steps in order. Each step is observable (an agent or human reading the install report can see which steps ran, with what input, and what changed).

| # | Step | Purpose | Inputs read | Questions asked (verbatim) | Files written | Failure mode |
|---|---|---|---|---|---|---|
| 1 | **Orient** | Confirm target repo path and load prior install state if present | `pwd`, `git rev-parse --show-toplevel`, existing `harness/config.json` if any | (none) | (none) | exit 1 if no git repo and `--no-git-ok` flag absent |
| 2 | **Inspect** | Detect host tooling, runtimes, existing harness artifacts | `package.json`, `pyproject.toml`, `Makefile`, `Justfile`, `Dockerfile`, root `HARNESS.md`, `docs/project-rules/harness.md`, `AGENTS.md`, Python version, Node version | (none) | (none) | (read-only step; never fails) |
| 3 | **Decisions** | Resolve FR-01 (HARNESS.md location), FR-02 (CLI implementation), permission grants | (results of step 2) | *"Where should HARNESS.md live: repo root (recommended) or `docs/project-rules/harness.md`?"* (FR-01, only if both legal locations are unoccupied OR exactly one is occupied); *"Install new CLI at `harness/bin/`, OR wrap existing tooling (justfile, package.json scripts, Makefile)?"* (FR-02, only if host tooling is detected); *"Grant permission to write 11–13 files in this repo?"*; *"Grant permission to patch `AGENTS.md`?"* | (none) | exit 1 if user denies write permission |
| 4 | **Propose** | Show candidate-command table (build/test/lint/format/run/health) detected from inspection; user confirms or edits | (results of step 2) | per-command confirm prompts: *"build: detected `pnpm build` — accept?"*, etc. | (none) | (never fails; unconfirmed commands become empty strings) |
| 5 | **Substitute** | Resolve all placeholders strictly; abort if any required slot cannot be filled | (results of steps 3–4) | (none) | (in-memory) | exit 1 with `error.code: INVALID_ARGS` if a required placeholder cannot be resolved |
| 6 | **Create harness skeleton** | Materialise `harness/{README.md, config.json, state/, templates/, proofs/, skills/}` | (template files) | (none) | `harness/README.md`, `harness/config.json`, `harness/state/{known-difficulties.md, friction-log.md}`, `harness/templates/{proof-note.md, friction-entry.md, retrospective-schema.json}`, `harness/proofs/.gitkeep`, `harness/skills/onboard-agent-session.md` | abort if any file already exists with non-empty USER-CONTENT region and user chose skip |
| 7 | **Install CLI** | Either install new stdlib CLI (`harness/bin/harness.{py,mjs}`) or wrap-existing (`harness/bin/harness.sh`); honour AC-13 if neither runtime detected | (chosen branch from step 3) | (none) | one of `harness/bin/harness.{py,mjs,sh}`; **OR** if neither Python ≥ 3.10 nor Node ≥ 18 is detected: write no CLI, set `harness/config.json.harness.cli_language = ""`, exit 0 in degraded mode | exit 1 if write fails and runtime was available |
| 8 | **Write HARNESS.md** | Place at root (default) or `docs/project-rules/harness.md` per FR-01; both-locations branch consolidates | (template + step 5 substitutions) | (only in both-locations branch) *"Both `HARNESS.md` and `docs/project-rules/harness.md` exist — which should be canonical? The other becomes a one-line pointer."* | `HARNESS.md` OR `docs/project-rules/harness.md` (+ optional pointer file at the non-canonical location) | abort if both-exist and user declines consolidation |
| 9 | **Patch AGENTS.md** | Append the engineering-harness section with FR-03 equivalence-table scaffold and detected rows | existing `AGENTS.md` if present | (none) | `AGENTS.md` (append-only; sentinel-bracketed) | log a warning if `AGENTS.md` already contains the boundary sentence; do not duplicate |
| 10 | **Validate** | Invoke `<CLI> --help`, `<CLI> doctor`, `<CLI> validate --dry-run` and capture verdicts | the newly installed CLI | (none) | (in-memory — captured for install report) | non-blocking: any failure becomes a row in the install report; skill does not exit on validate failure |
| 11 | **Self-check placeholders** | Grep every written file for unsubstituted `{{NAME}}` markers | written files | (none) | (none) | exit 1 with `error.code: PLACEHOLDER_LEAK` if any literal remains |
| 12 | **Seed friction** | Write one entry to `harness/state/friction-log.md` per detected install-time gap (unconfigured command, missing runtime, no-tool-for-wrap, etc.) | (results of steps 4, 7, 10) | (none) | append to `harness/state/friction-log.md` | (never fails; friction-log seeding is best-effort) |
| 13 | **Emit install report** | Write the QT-04-style report with verdict columns + QT-06 ceiling sentence | (captured verdicts from steps 4, 10) | (none) | `harness/proofs/install-report-<timestamp>.md` | (never fails) |
| 14 | **Magic-wand close-out** | Print the hybrid magic-wand prompt; optionally append answer to friction-log | (none) | the hybrid wording from `magic-wand-prompt.md`; *"Would you like to append your answer to `harness/state/friction-log.md`?"* | append to friction-log if user agrees | (never fails) |

### Per-file merge policy (re-runs)

A second invocation of the skill against the same target with no changes must be safe. The skill follows this per-file policy:

| File | First-install policy | Re-run, no edits | Re-run with user edits |
|---|---|---|---|
| `HARNESS.md` | overwrite | no-op | preserve USER-CONTENT-sentinel regions verbatim; refresh outside-sentinel content; surface diff |
| `AGENTS.md` | append sentinel-bracketed section | no-op | preserve sentinel-bracketed user content; refresh equivalence-table rows additively (never delete user rows) |
| `harness/config.json` | write substituted template | no-op | merge: preserve user-set values; add newly-detected commands; never delete a populated value automatically; surface diff |
| `harness/state/friction-log.md` | write substituted template | no-op | **never overwrite** (preserve byte-for-byte) |
| `harness/state/known-difficulties.md` | write substituted template | no-op | **never overwrite** |
| `harness/bin/harness.{py,mjs,sh}` | write template | no-op (mtime unchanged) | diff and ask: refresh or keep edits |
| `harness/templates/retrospective-schema.json` | write template | no-op | refresh on schema change; preserve user-added optional fields |
| `harness/templates/{proof-note,friction-entry}.md` | write template | no-op | preserve user customisations |
| `harness/skills/onboard-agent-session.md` | write template | no-op | preserve user customisations |
| `harness/README.md` | write template | no-op | refresh on template change; surface diff |

**Sentinel detection algorithm**: exact-string match on the two literal lines `<!-- USER CONTENT START -->` and `<!-- USER CONTENT END -->`. Each appearance must be paired; an unmatched sentinel is a parse error (skill aborts with `error.code: INVALID_ARGS` and `next_action: "User-content sentinels are malformed in <file>; please fix or remove the file before re-running."`). Content between paired sentinels is preserved verbatim on re-runs.

---

## Section 3 — Non-goals

The skill deliberately does not do these things in v0.1. They are not bugs; they are scope choices.

1. **Create a fully featured universal CLI.** The CLI skeleton is small on purpose. v0.1 ships ~12 subcommands; growing the surface is friction-log work.
2. **Replace CI/CD.** The harness CLI is for local and PR-time loops. CI may invoke harness commands but the harness does not provision pipelines.
3. **Claim product validation without evidence.** `<CLI> validate` returns `unconfigured` when commands are empty; it never invents a `pass`.
4. **Invent build/test/run commands without confirmation.** Every detected candidate is shown to the user before being written to config.
5. **Run destructive commands without explicit approval.** No subcommand v0.1 mutates external state without explicit `--execute`.
6. **Hide failures behind optimistic summaries.** The install report uses sharpened `Ran`/`Outcome` enums; "pass-with-warnings" is recorded as `degraded`, not `pass`.
7. **Generate a markdown manual instead of executable affordances.** Every prose file the skill writes either documents a load-bearing invariant or wraps an executable command. There is no introductory chapter.
8. **Treat agent review as product proof.** Agent self-assessment is never a substitute for a deterministic check.
9. **Auto-apply magic-wand suggestions.** Magic-wand entries become friction-log rows requiring human review before encoding.
10. **Make individual-productivity claims from harness activity metrics.** The skill does not track or report on per-author command counts; activity is not value.
11. **Overfit to one ecosystem.** The CLI itself is Python or Node, but the wrapped commands are language-agnostic; the wrap-existing branch defers to whatever the repo already runs.
12. **Configure long-running boot.** `<CLI> run` is dry-run by default and requires `--execute` to spawn the child process. `<CLI> validate` never invokes `run` under any tier.
13. **Audit existing AGENTS.md content.** The skill appends a sentinel-bracketed section; it does not analyse or rewrite pre-existing content.
14. **Multi-environment / multi-profile config.** v0.1 ships a single `harness/config.json`. `harness/profiles/` is a v0.2 evolution path.
15. **Recover from partial install.** If the skill aborts mid-flow (e.g. user denies permission at step 9), v0.1 leaves whatever was written. v0.2 considers a resume flag.
16. **Detect `CLAUDE.md` / `.cursorrules` / `.github/copilot-instructions.md`.** v0.1 only patches `AGENTS.md`. v0.2 may grow.
17. **Generate language-specific test scaffolding.** The harness wraps existing test commands; it does not seed `test/`, `tests/`, or `__tests__/`.
18. **Replace the team's existing PR templates, issue templates, or contribution docs.** The harness is the project-side development loop, not the project-side governance.
19. **Self-update or auto-upgrade.** v0.1 does not check for newer versions of itself.
20. **Cross-repo configuration.** Each invocation installs one harness in one repo.
21. **Substitute for the agent harness.** Tool permissions, session state, and orchestration belong to the agent harness; the engineering harness assumes they exist and proves the product.

---

## Section 4 — Known limitations (v0.1)

These are real friction points in v0.1, surfaced honestly so they can become friction-log entries during dogfood.

**Runtime requirement.** The new-CLI branch requires Python ≥ 3.10 OR Node ≥ 18 on the target host. Python 3.9 is detected but treated as missing (the new-CLI branch falls back to neither-runtime degraded mode); the v0.2 friction-log entry is "detect Python 3.9 explicitly and offer the wrap-existing branch instead". The wrap-existing branch requires only POSIX shell, which is universal on macOS and Linux.

**Agent-runtime portability.** v0.1 assumes pi runtime conventions (frontmatter `name` + `description` only). Other runtimes (Claude Code, Cursor, Cline) may parse skill packages differently. The `check.sh --inline-fallback` produces a single-file SKILL.md variant if multi-file packaging is rejected.

**Equivalence-table catalogue.** The AGENTS.md equivalence-row catalogue covers seven common host-tool signals (pnpm/npm/yarn test, build; just test, build; pytest; make test; harness proofs). Exotic tooling — Bazel, Pants, gradle, dotnet, Cargo — falls through with zero rows. v0.2 grows the catalogue based on dogfood friction-log entries.

**Multi-environment targets.** Production repos sometimes need `harness/profiles/{dev,staging,prod}/config.json`. v0.1 ships a single config. v0.2 considers a `--profile` flag.

**Partial-install recovery.** If the skill aborts mid-install (e.g. user denies permission at step 9 of 14), v0.1 leaves whatever was written and does not roll back. The friction is visible — the install report row is missing — but the user must manually clean up. v0.2 considers an `install-state.json` + resume flag.
