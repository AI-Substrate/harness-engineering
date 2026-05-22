# Authoring notes — engineering-harness-setup

**This file is repo-internal and NOT installed by the skill.** It documents the conventions and self-checks the skill maintains so future editors can extend it without regressing on the load-bearing invariants.

## Why this skill exists

The skill's job is to make the engineering harness materially exist in a target repository in one invocation. "Engineering harness" here means the project-side development loop: a front-door doc (`HARNESS.md`), a command-mapped CLI (`harness/bin/harness.{py,mjs,sh}`), a friction log, a retrospective schema, an install report, and the AGENTS.md patch that points agents at the harness instead of letting them invent their own commands. The skill is the agent-installable form of the principles in `harness-foundations/` (this repo's foundational research).

The skill answers a specific failure mode: when a fresh team — or a fresh agent in a fresh target repo — wants to start the engineering-harness practice, they should not have to read 2000 lines of source material first. They should be able to invoke one skill, answer a handful of inspection questions, and end up with a working harness on disk that can be `git diff`'d in one PR.

The skill **embodies** the principles; it does not just describe them.

## Sources

- `docs/plans/002-engineering-harness-setup-skill/engineering-harness-setup-skill-spec.md` — the spec. Authoritative for the package contract.
- `docs/plans/002-engineering-harness-setup-skill/decisions.md` — the decision log. Authoritative for resolved ambiguities.
- `docs/plans/002-engineering-harness-setup-skill/source-prompt.md` — the original 2236-line research brief. Authoritative for template bodies; the spec's Group B table maps brief sections to template filenames.
- `docs/plans/002-engineering-harness-setup-skill/field-research-minih-chainglass.md` — the production-pattern validation. Authoritative for the deltas between the brief and real-world harness implementations.
- `harness-foundations/` — the foundational research. Source for the citation references in template bodies.

## Foundation citation discipline

Every template paraphrasing a foundation principle must carry an HTML-comment citation near the top:

```html
<!-- foundations: first-principles#NN, patterns-that-work#PNN, directives#DN -->
```

These citations exist so a curious agent or human can trace any installed text back to the foundational claim. The citations are HTML comments because they ship into the target repo as part of the installed file; HTML-comment form keeps them out of rendered markdown while still being grep-friendly.

The citation must reference foundation IDs only — never source IDs (`S001`, `N2-S001`, `M00`, etc.) and never private-source identifiers. The privacy check in `check.sh privacy` enforces this.

## Load-bearing invariants

Five invariants must hold across the package. `check.sh` runs the corresponding self-check for each.

**Scope rule for shipped surfaces.** Invariants 1–4 apply to **shipped surfaces only** — `SKILL.md` and everything under `templates/`. The two repo-internal files (`AUTHORING.md` and `check.sh` itself) legitimately reference the foundation paths, source-ID patterns, and substitution syntax in prose or pattern strings; they are not installed to target repos, so they are not checked.

### 1. Canonical boundary sentence

The sentence *"The agent harness drives. The engineering harness proves."* appears byte-identically in at least five files: `SKILL.md`, `templates/root-HARNESS.md`, `templates/agents-md-snippet.md`, `templates/harness-onboard-agent-session.md`, `templates/install-report.md`. The canonical form lives in `templates/canonical-boundary.txt` (one line, single trailing newline, no commentary). Any drift erodes the front-door contract; `check.sh boundary` runs `grep -rcF` plus a `diff` against `canonical-boundary.txt`.

Usage:

```sh
./check.sh boundary
```

### 2. No private-source contamination

Shipped prose must never reference `harness-foundations/`, `docs/plans/`, `scratch/`, `source-notes/`, the source IDs `S001|S002|S003|S004|N2-S00|M00`, or the substrate names `minih` / `chainglass` outside HTML comments. `check.sh privacy` runs `grep -rE` for these patterns.

Usage:

```sh
./check.sh privacy
```

### 3. Magic-wand wording byte-identity

The hybrid magic-wand wording from `templates/magic-wand-prompt.md` is the single source of truth. Six surfaces echo it byte-for-byte: the prompt template itself, `templates/root-HARNESS.md` Rule 5, `templates/harness-friction-log.md`, `templates/harness-proof-note.md`, `templates/install-report.md`, and `templates/retrospective-schema.json` (the `magicWand.description` field). `check.sh magic-wand` runs `grep -rcF` against the canonical sentence.

Usage:

```sh
./check.sh magic-wand
```

### 4. Placeholder syntax is well-formed

Every `{{XXX}}` marker in `templates/` must match the canonical form `{{[A-Z_][A-Z0-9_]*}}` (uppercase letters, digits, and underscores; starts with a letter or underscore). This catches authoring typos like `{XX}}`, `{{XX}`, `{{lower}}`, or `{{Mixed_Case}}`. The pre-commit check is named `placeholder-syntax`.

A separate **runtime** check, `assert_no_placeholder_leaks()` inside the CLI skeletons, verifies that no `{{XXX}}` markers survived install-time substitution into the target repo's `HARNESS.md`, `AGENTS.md`, or `harness/config.json`. That check runs as the final step of `<CLI> validate` and returns `error.code: PLACEHOLDER_LEAK` on failure. The two checks are deliberately separated: pre-commit catches *authoring* mistakes; runtime catches *substitution* mistakes.

Usage:

```sh
./check.sh placeholder-syntax
```

### 5. `cli-envelope.schema.json` conformance

Every CLI subcommand documented in `templates/cli-command-contract.md` must produce stdout that conforms to `templates/cli-envelope.schema.json`. The two CLI skeletons (`cli-python-harness.py`, `cli-node-harness.mjs`) and the wrapper recipe (`wrapper-recipe.template`) all emit envelopes through a single helper function so the conformance is structural, not by convention.

There is no automated check for this in v0.1 (no JSON-Schema runtime in the package); the dogfood run is the verification.

## Drift checklist for v0.2

These are known evolution paths that v0.1 deliberately defers. They become friction-log entries in the target repo during dogfood; v0.2 promotes them to feature work.

- **Single-file SKILL.md fallback** — `check.sh --inline-fallback` concatenates templates into a single-file variant if the pi runtime ever rejects multi-file packages.
- **Richer exit-code semantics** — chainglass-style numeric codes (`E100`–`E126`) for finer-grained CI branching. v0.1 keeps process exits as 0/1/2 with `error.code` enum inside the envelope.
- **Wrap-existing improvements** — v0.1 supports POSIX-shell wrappers only. v0.2 candidates: justfile-target generation, Python-shim wrapper, npm-script wrapper, Makefile-target wrapper.
- **Portability beyond pi** — v0.1 assumes pi runtime conventions (frontmatter `name`+`description` only). v0.2 considers Claude Code skill packaging.
- **Multi-environment / multi-profile targets** — production repos sometimes need `harness/profiles/{dev,staging,prod}/config.json`. v0.1 ships a single `harness/config.json`; v0.2 considers a `--profile` flag.
- **Partial-install recovery** — if the skill aborts mid-install (e.g. user denies permission at step 9 of 14), v0.1 leaves whatever was written. v0.2 considers an `install-state.json` + resume flag.
- **AGENTS.md duplicate-sentence dedup** — v0.1 logs a warning if `AGENTS.md` already contains the boundary sentence. v0.2 considers replacing the duplicate with a pointer comment.
- **Equivalence-row catalogue expansion** — v0.1 ships a 7-row catalogue (see `templates/agents-md-snippet.md`). Exotic tooling (Bazel, Pants, dotnet, gradle) falls through. v0.2 grows the catalogue based on dogfood friction-log entries.
- **`CLAUDE.md` / `.cursorrules` co-installation** — v0.1 only patches `AGENTS.md`. v0.2 considers detecting and patching `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`.

## How to run `check.sh`

```sh
./check.sh boundary             # invariant 1
./check.sh privacy              # invariant 2
./check.sh magic-wand           # invariant 3
./check.sh placeholder-syntax   # invariant 4
./check.sh all                  # all of the above (the Group G pre-commit gate)
./check.sh --inline-fallback    # produce single-file SKILL.md variant (v0.2 fallback)
```

`check.sh` is portable POSIX shell. It assumes `grep` is GNU-ish (BSD `grep` on macOS supports the flags used). It does not require `jq`, `python`, or `node`.

## How to extend this skill

If you are adding a new template or a new CLI subcommand:

1. Author the new file under `templates/`.
2. Add an HTML-comment foundation citation at the top.
3. If the file contains the boundary sentence: read it byte-for-byte from `templates/canonical-boundary.txt`; do not re-type.
4. If the file contains the magic-wand prompt: read it byte-for-byte from `templates/magic-wand-prompt.md`'s "Canonical wording" block.
5. If the file is a CLI source: emit envelopes via the shared helper; do not invent a new envelope shape.
6. Run `./check.sh all` before committing.
7. Run one dogfood pass against a real target.
8. Append a one-line entry to the spec's "Known limitations" or "v0.2 evolution paths" section if the change suggests a future generalisation.

The skill is small on purpose. New surfaces become new templates; new branches become new install-flow steps; new error modes become new `error.code` enum entries. Resist adding configuration knobs — strong defaults beat options (see `harness-foundations/patterns-that-work.md`).
