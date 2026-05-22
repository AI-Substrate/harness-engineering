# Engineering Harness Setup Skill

**Mode**: Simple
**Plan folder**: `docs/plans/002-engineering-harness-setup-skill/`
**Spec author**: pi assistant via `/plan-1b-v2-specify`
**Generated**: 2026-05-22
**Status**: Specifying → Ready for implementation

> 📚 This specification incorporates findings from:
> - `research-dossier.md` (8-lens synthesis, ~80 findings, 752 lines)
> - `decisions.md` (7 critical findings resolved + Simple Mode + no-tests + multi-file packaging)
> - `field-research-minih-chainglass.md` (488 lines validating the brief against two real-world harnesses; resolves 4 additional decisions inline below)
> - `source-prompt.md` (the original 2236-line authoring brief; canonical for templates §9–§24)

---

## Start here (implementer reading top-to-bottom)

**To implement**: jump to §Implementation Outline → Group A. Then proceed A→G in order.

§Decisions and §Acceptance Criteria are **reference material to consult during implementation**, not to read top-to-bottom. The decisions are locked; the AC are checks to run during Group F (dogfood). §Validation Record at the bottom of this file documents the validate-v2 audit that produced this version of the spec.

---

## Research Context

Three research phases informed this spec:

1. **8-lens parallel research** (`lenses/{ia,dc,ps,qt,ic,de,pl,db}-*.md`) — surfaced 7 critical findings and 15 prior-learnings to honour. Locked in `research-dossier.md`.
2. **Standalone-scope user decision** — the skill ships standalone, with no coordination with `engineering-harness-v2`, `compound-*`, `harness-is-the-product-v2`, or other sibling skills. Collapses 3 of the 7 critical findings.
3. **Field research against `~/substrate/minih` (L2 harness) and `~/substrate/chainglass` (L3 harness)** — validated the brief's HARNESS.md skeleton 1:1 against minih's `docs/project-rules/harness.md`; surfaced 8 production-tested patterns to lift; challenged and re-resolved 4 decisions (magic-wand wording, HARNESS.md location, CLI implementation default, exit-code granularity).

Critical findings status (full detail in `decisions.md`):

| ID | Decision | Resolution |
|---|---|---|
| CF-01 | Lifecycle position vs sibling skills | Standalone — no coordination |
| CF-02 | Canonical boundary-sentence lint | Adopted as authoring commitment + one-time pre-commit grep |
| CF-03 | Onboarding source of truth | File (`harness/skills/onboard-agent-session.md`); CLI reads & prints it |
| CF-04 | Skill packaging | Multi-file (brief §4 layout) |
| CF-05 | Friction-log overlap with compound-* | Standalone — single canonical friction surface |
| CF-06 | Magic-wand wording | **Re-resolved by field research** — hybrid form (see §Decisions below) |
| CF-07 | Placeholder substitution | Strict — always resolve + final `{{…}}` self-check |

Field-research challenges (re-resolved in this spec, §Decisions):

| FR-ID | Topic | Resolution |
|---|---|---|
| FR-01 | HARNESS.md location | Default to root; ask if `docs/project-rules/harness.md` exists |
| FR-02 | CLI implementation default | Install new stdlib CLI by default; inspection asks whether to wrap existing tooling instead |
| FR-03 | AGENTS.md equivalence table | Adopted — `AGENTS.md` snippet template includes a scaffolded equivalence table |
| FR-04 | Exit-code granularity | Keep 0/1/2 at process level; add `error.code` enum inside JSON envelope |

---

## Summary

Author a **portable skill package** named `engineering-harness-setup` in this repository at `skills/engineering-harness-setup/`. When installed into a target repo (via pi's standard skill mechanism at `~/.pi/agent/skills/`) and invoked, the skill inspects the target, asks a short decision flow, then materialises the **first useful version** of a repo-local engineering harness:

- `HARNESS.md` (at repo root by default; alternate `docs/project-rules/harness.md` location supported)
- `harness/` directory (CLI bin, state, templates, proofs, onboarding skill)
- An `AGENTS.md` routing patch (with a scaffolded equivalence table)
- A small CLI installed at `harness/bin/harness.{py,mjs}` (or wrapper recipes if the user opts to wrap existing tooling)
- A schema-enforced retrospective contract (`harness/templates/retrospective-schema.json`)

The skill is **standalone**: it does not coordinate with `engineering-harness-v2`, `compound-*`, or any sibling skill. It does not run automated tests against itself; it is validated by **one dogfood run during authoring** against a real greenfield target.

The artefact ships in **v0.1** as a multi-file skill package. The authoring effort itself runs in Simple Mode: one phase, inline tasks, manual validation.

---

## Goals

1. A fresh team — or a fresh agent in a fresh target repo — can install the first useful version of a repo-local engineering harness in **one invocation**, instead of reading 3000+ lines of foundations prose and rebuilding the scaffolding by hand each time.
2. The installed harness **dogfoods itself on day one** — its `<CLI> doctor` and `<CLI> validate --dry-run` run from the install report; if they cannot run, the report says so honestly rather than falling back to raw commands (per PL-03).
3. The installed harness **operationalises the magic-wand → friction → encoded-fix loop** from day one: schema-enforced retrospective contract (`retrospective-schema.json`), structured friction-log template, and a closing prompt at the end of each session.
4. Future agent sessions in the target repo find a clear front door: `AGENTS.md` routes to `HARNESS.md`; `HARNESS.md` routes to `harness/config.json` (the executable encoding); the CLI reads `harness/config.json` and produces JSON envelopes on stdout.
5. The skill respects the publication boundary: templates contain no private terminology, no internal source IDs, no `scratch/`/`harness-foundations/`/`docs/plans/`/`source-notes/` references. Safe to install into any public repo.
6. The skill preserves the canonical boundary sentence — *"The agent harness drives. The engineering harness proves."* — byte-identical everywhere it appears (CF-02).
7. Re-running the skill against a target that already has an engineering harness is **idempotent** — never silently overwrites user content, preserves `<!-- USER CONTENT START -->`/`<!-- USER CONTENT END -->` regions, asks before merging or replacing pre-existing files.

---

## Non-Goals

Carried forward from brief §3 plus the field-research / standalone-scope refinements:

1. **Not a maintenance tool.** Once a substrate exists, evolving it is the team's work; this skill bootstraps once.
2. **Does not coordinate** with `engineering-harness-v2`, `agent-harness-v2`, `harness-is-the-product-v2`, or `compound-*` siblings. No pointers, no detection branches, no shared friction surfaces.
3. **No automated tests** against the skill itself (decisions.md Q2). One dogfood run during authoring; manual validation only.
4. **Not a CI configurator.** It does not write GitHub Actions, GitLab pipelines, or any CI workflow files.
5. **Not a project scaffolder.** It does not create `package.json`, `pyproject.toml`, `Cargo.toml`, etc.; it builds on whatever runtime the target already has.
6. **Not a Docker / container provisioner.** Inspired by chainglass but out of scope for v0.1.
7. **Not a code reviewer / linter installer.** It detects existing lint/format commands; it does not pick them.
8. **Not portable beyond pi for v0.1.** Authored to pi's multi-file skill schema; multi-runtime portability deferred to v0.2.
9. **Does not auto-execute long-running boots** (e.g. `next dev`, `vitest --watch`). The CLI's `run` subcommand is dry-run by default; `validate` never invokes `run`.
10. **Does not write to `docs/project-rules/engineering-harness.md`** — that surface belongs to the (sibling, not coordinated) `engineering-harness-v2`. The default is `HARNESS.md` at root.
11. **Does not auto-apply magic-wand answers.** Friction is collected; encoding is a staged human decision (PL-11).
12. **No `skills/README.md` index file** in this repo (decisions.md Q3); the root `README.md` mention is the only repo-level addition.
13. **No `AGENTS.md` framing paragraph** in this repo (decisions.md Q3); the repo intent shift is signaled only by the README mention.
14. **No `docs/how/engineering-harness-setup.md` tutorial** in this repo for v0.1.
15. **No single-file packaging variant** maintained alongside the multi-file version.

---

## Target Domains

This repo has no `docs/domains/registry.md` and no formal domain system. The feature touches conceptual domains only.

| Domain | Status | Relationship | Role in This Feature |
|---|---|---|---|
| `skills` (this repo's authored-skill surface) | **NEW** | **create** | Establishes `skills/` as a first-class directory where this repo authors installable skill packages. |
| `harness-foundations` (this repo's existing principle docs) | existing | **consume** | Skill templates lift principles, directives, and rules; no edits to foundation files. |
| Target-repo's `harness/` (installed by the skill) | **NEW** (in the target) | **create** | The skill creates this domain whole-cloth in target repos; documented only via the skill's templates. |

### New Domain Sketches

#### skills [NEW — in this repo]

- **Purpose**: Authoring home for portable skill packages this repo ships. Each subdirectory is one installable skill, conforming to the pi skill-package contract (frontmatter-tagged `SKILL.md` + optional `templates/`, `references/`, `tests/`).
- **Boundary owns**: skill-package source files, authoring notes (`AUTHORING.md` per skill), template files that are materialised at install time, canonical wording constants (e.g. `templates/canonical-boundary.txt`), JSON schemas the skill enforces.
- **Boundary excludes**: any reference to private terminology or internal source IDs (per `AGENTS.md` L18–24); raw research notes (those stay in `scratch/`); the skill's runtime install path (`~/.pi/agent/skills/…`, owned by the agent harness, not by this repo).

#### target-repo `harness/` [NEW — in installed repos]

- **Purpose**: The repo-local engineering harness this skill installs. Encodes the Boot → Interact → Observe → Validate → Improve loop in concrete files.
- **Boundary owns**: `harness/bin/` (the CLI), `harness/state/` (friction-log, known-difficulties), `harness/templates/` (proof-note, friction-entry, retrospective-schema), `harness/proofs/` (evidence captures), `harness/skills/onboard-agent-session.md` (the canonical onboarding checklist), `harness/config.json` (the executable command map).
- **Boundary excludes**: any source code of the product being harnessed (the harness routes to commands; it does not embed them); CI configuration; long-running processes (the CLI manages dry-run / approval semantics).

---

## Decisions baked into this spec

Locked from `decisions.md` (Q1–Q7 + CF-01..CF-07) plus the 4 field-research challenges resolved here:

### From decisions.md

- **Workflow Mode**: Simple. Single-phase, inline tasks, manual validation.
- **Testing**: None. Dogfood once against a real target. No tests/ folder in the skill package.
- **Documentation**: SKILL.md (mandatory) + a one-paragraph "Skills authored here" section in this repo's root `README.md`. No `skills/README.md` index, no `AGENTS.md` framing update, no `docs/how/` tutorial.
- **Sibling-skill coordination**: none. No pointers, no detection branches.
- **Boundary-sentence lint**: *"The agent harness drives. The engineering harness proves."* must appear byte-identical in `SKILL.md` preamble, `templates/root-HARNESS.md`, `templates/agents-md-snippet.md`, `templates/harness-onboard-agent-session.md`, and `templates/install-report.md`. One-time pre-commit grep validates this and that no template references `harness-foundations/`, `docs/plans/`, `scratch/`, `source-notes/`, or source IDs.
- **Onboarding source of truth**: `harness/skills/onboard-agent-session.md` is canonical (brief §15 verbatim, including the friction-layer-classification 7th step). The Python and Node CLI `onboard()` functions read the file and print its content; they do NOT carry hardcoded checklists. Exit 2 (`error.code: UNCONFIGURED`) with `next_action = "Run engineering-harness-setup to materialise the onboarding guide."` if the file is missing.
- **Skill packaging**: Multi-file. Brief §4 layout — `SKILL.md` at root + sibling `templates/` folder. Assumes pi runtime supports filesystem-relative sibling reads (precedent: `~/.pi/agent/skills/install-hve-core-rpiv/references/`). If a future runtime probe shows pi rejects this, falling back to single-file with inlined templates is a v0.2 friction-log entry, not a spec change.
- **Placeholder substitution**: Strict — always resolve in prose; always resolve in `harness/config.json` (empty string `""` if unknown, never literal `{{…}}`); the skill emits a final self-check that fails with a clear `next_action` if any literal `{{…}}` remains in any written file. Token enumeration expanded to all 10: the 7 from brief §32.2 plus `{{LINT_COMMAND}}`, `{{FORMAT_CHECK_COMMAND}}`, `{{harness_cli_file}}`.

### Re-resolved by field research

- **CF-06 magic-wand wording** (re-opened by field research; both minih and chainglass use a 1-thing concrete form rather than the brief's 4-adjective tail). **Hybrid resolution**:

  > *"If you had a magic wand, what ONE thing would you change to make the next run easier, safer, faster, or higher quality? Be concrete — name a command, flag, output field, fixture, diagnostic, template, or workflow change."*

  This preserves the brief's enumeration of *what counts as a magic-wand suggestion* (valuable for agents who don't know the universe of possible changes) while matching the real-world "ONE thing, be concrete" framing observed in both production schemas. Single source of truth: `templates/magic-wand-prompt.md`. Schema enforcement: `templates/retrospective-schema.json` (see FR-NEW-1 below).

- **FR-01: HARNESS.md location**. The brief says HARNESS.md at the repo root; both minih and chainglass use `docs/project-rules/harness.md`. **Resolution**: v0.1 default is **root** (greenfield bias — most discoverable for fresh teams and fresh agents). Inspection branches:
  - **Neither location occupied** → write `HARNESS.md` at root without prompting.
  - **Only `docs/project-rules/harness.md` exists** → ask user to choose: replace, merge, or skip.
  - **Only `HARNESS.md` (root) exists** → ask user to choose: replace, merge, or skip.
  - **Both exist (H17 fix — previously undefined)** → surface the duplication, recommend consolidation, ask which to keep canonical (the other becomes a one-line pointer: `> See <other-path> for the engineering-harness contract.`).
  - The alternative placement is documented as a known mature-repo convention in the SKILL.md philosophy section.

- **FR-02: CLI implementation default**. Brief specifies stdlib Python or stdlib Node CLI; both real-world repos wrap existing tooling instead. **Resolution**: v0.1 default is **install new stdlib CLI** (greenfield bias). Inspection step:
  1. The skill detects host tooling (`justfile`, `package.json` with `scripts`, `Makefile`, `pyproject.toml` with `[tool.poetry.scripts]` / `[project.scripts]`).
  2. The decision question is offered **only if** at least one host tool is detected: *"Install new CLI at `harness/bin/`, OR wrap existing tooling (justfile, package.json scripts, Makefile)?"* If no host tool is detected, the skill defaults to install-new without asking.
  3. If the user requests wrap-existing **and** no host tooling is detected (H18 fix — previously undefined), the skill falls back to install-new, names the missing-host condition in the install report (`Wrap-existing requested but no detectable host tool; defaulting to install-new`), and logs a friction entry ("User asked for wrap-existing without a host tool; v0.2 should detect and warn earlier").
  4. If wrap-existing is selected and viable, the skill writes either `harness/bin/harness.sh` (POSIX shell wrapper) **or** a justfile target named `harness` (if a justfile already exists); the wrapper delegates to existing commands and emits the standard envelope per the `wrapper-recipe.template` skeleton (see Group C below).
  - v0.1 must support both branches; only POSIX shell wrapper for v0.1 (no Python-shim variant).

- **FR-03: AGENTS.md equivalence table**. Brief §10's snippet is anemic compared to the production pattern (minih opens AGENTS.md with a dogfood rule + 13-row equivalence table). **Resolution**: rewrite `templates/agents-md-snippet.md` to include:
  - Title: *"The engineering harness is non-negotiable."*
  - One-paragraph dogfood rule.
  - A 2-column **equivalence-table scaffold** the skill populates during install. Each row maps a target-relative direct-file-access command (`❌ cat foo`) to the harness's CLI equivalent (`✅ <CLI> bar`).
  - Self-check footer: *"Ask: 'Could `<CLI> X` answer this?' If yes, use that. If no, the gap is the answer — file it as a magic-wand."*

  **Equivalence-row catalogue** (H10 fix — v0.1 minimum mapping rules; anything outside is friction-log fodder):

  | Detected signal | Forbidden command | Required equivalent |
  |---|---|---|
  | `package.json` `scripts.test` | `pnpm test` / `npm test` / `yarn test` | `<CLI> test --tier fast` |
  | `package.json` `scripts.build` | `pnpm build` / `npm run build` | `<CLI> build` |
  | `justfile` recipe `test` | `just test` | `<CLI> test --tier fast` |
  | `justfile` recipe `build` | `just build` | `<CLI> build` |
  | `pyproject.toml` + `[tool.pytest]` / `[tool.poetry]` | `pytest` / `uv run pytest` | `<CLI> test --tier fast` |
  | `Makefile` target `test` | `make test` | `<CLI> test --tier fast` |
  | `harness/proofs/` exists | `cat harness/proofs/<file>` | `<CLI> proofs show <name>` |

  AC-10 requires at least 3 rows reflecting detected commands; the catalogue must produce ≥3 from any non-empty target. Sentinels (`<!-- USER CONTENT START -->` / `<!-- USER CONTENT END -->`) bracket the editable region so users can add rows that survive re-runs.

- **FR-04: Exit-code granularity**. Brief uses 0/1/2 as exit codes; chainglass uses `E100–E126` semantic codes. **Resolution**: keep `0` (success) / `1` (failure) / `2` (unconfigured) at the **process exit-code level** (so existing shell pipelines, CI tools, and the brief §13/§14 skeletons remain valid). Additionally, add an **`error.code` enum field inside the JSON envelope**. Initial enum values for v0.1:
  - `OK` (status: pass)
  - `UNCONFIGURED` (status: unconfigured) — corresponds to exit 2
  - `AUTH_MISSING`
  - `TIMEOUT`
  - `INVALID_ARGS`
  - `DEPENDENCY_MISSING`
  - `HEALTH_CHECK_FAILED`
  - `BUILD_FAILED`
  - `TEST_FAILED`
  - `PLACEHOLDER_LEAK` (H7 fix — self-check failure on lingering `{{...}}` markers)
  - `UNKNOWN` (fallback)
  
  Documented in `templates/cli-command-contract.md`. Each CLI subcommand declares which subset of codes it can return. The envelope itself is specified by `templates/cli-envelope.schema.json` (H11): `{command: string, status: enum, data?: object, error?: {code: enum, message: string, next_action?: string}, messages?: string[]}`.

### Additions surfaced by field research (NEW templates / sections)

- **FR-NEW-1: `templates/retrospective-schema.json`** (NEW file). JSON Schema Draft 2020-12, modelled on minih's `src/schemas/retrospective.json` (re-authored with neutral language). Required fields: `workedWell` (minLength 10), `confusing` (minLength 10), `magicWand` (minLength 20). Optional: `magicWandTarget` enum: `project | harness | agent`. The skill installs this at `harness/templates/retrospective-schema.json`. The CLI's `magic-wand` subcommand prints `templates/magic-wand-prompt.md` and lists the schema fields the next agent should populate.

- **FR-NEW-2: HTML-comment user-content sentinels**. Adopt verbatim from minih:
  ```
  <!-- USER CONTENT START -->
  <!-- Project-specific harness notes, custom boot sequences, domain-specific setup -->
  <!-- USER CONTENT END -->
  ```
  Used in `templates/root-HARNESS.md`, `templates/agents-md-snippet.md`, and `templates/harness-friction-log.md`. The skill's idempotent re-run logic preserves everything inside these blocks verbatim.

- **FR-NEW-3: Maturity ladder L0–L4** (not the source-notes L0–L6). Frontmatter line in `templates/root-HARNESS.md`: `**Maturity Level**: L1` (the default after first install). History table includes a `Maturity Before → After` column. Levels (lifted from minih, neutralised):
  - L0: no harness (skill exits before reaching L0 — the install elevates from L0 to L1)
  - L1: manual boot + CLI present
  - L2: auto boot + CLI health check
  - L3: full interaction + structured evidence
  - L4: self-healing
  
  Note that L5 / L6 (in source-notes' richer ladder) are not part of the template.

- **FR-NEW-4: Phase Gates table** (new optional section in `templates/root-HARNESS.md`). Domain × Boot/Interact/Observe/Narrow-Gate matrix; the skill writes an empty scaffold with 3 example rows (`docs / planning`, `cli`, `tests`) for the team to fill in.

- **FR-NEW-5: `<CLI> fft` alias** (NEW subcommand). "Fast feedback test" — alias for the proof tier (`validate --tier proof`). Memorable, action-oriented; matches minih's idiom. Documented in `templates/cli-command-contract.md`.

- **FR-NEW-6: `<CLI> doctor --wait [<seconds>]`** (NEW flag). Tolerates cold-boot windows by polling the health check until ready or timeout. Default timeout 300s. Documented in `templates/cli-command-contract.md`.

- **FR-NEW-7: Worked-example anchor in SKILL.md philosophy section**. Cite a sanitised worked example of the feedback loop closing — a generic version of chainglass FX007: *"A team observed that a class of bundler bug was bypassing all existing gates. The agent's retrospective surfaced the gap. The team encoded a single new validation recipe that catches the bug generically, not per-incident. That recipe joined the harness command surface and now runs for every future agent. The loop closed in hours."* Public-safe, no naming.

---

## Complexity

**Score**: CS-3 (medium)

**Breakdown**:
- **Surface Area (S)**: 2 — ~20 files to create in `skills/engineering-harness-setup/` plus one paragraph edit in `README.md`. Cross-cutting across new directory + repo-level surface.
- **Integration (I)**: 1 — depends on the pi skill-package runtime (multi-file packaging, frontmatter schema). Well-understood; install-hve-core-rpiv is precedent.
- **Data/State (D)**: 1 — two JSON Schemas to author (`harness-config.schema.json`, `retrospective-schema.json`). No migrations, no persistent state.
- **Novelty (N)**: 1 — design largely locked by 3 phases of research; some implementation novelty in the field-research-driven additions (equivalence-table scaffold, wrap-existing CLI branch).
- **Non-Functional (F)**: 0 — no performance/security/compliance pressure.
- **Testing/Rollout (T)**: 0 — Simple Mode, no automated tests, dogfood-once validation.

**Total P = 5 → CS-3 (medium)**.

**Confidence**: 0.85. The research is exhaustive (lenses + dossier + decisions + field research); the only sources of residual uncertainty are (a) the pi runtime's multi-file skill behaviour at first dogfood and (b) whether the equivalence-table population logic at install-time handles all common target-repo shapes.

**Assumptions**:
1. Python ≥ 3.10 or Node ≥ 18 is present in target repos. (Documented limitation in `SKILL.md`; if neither is available the skill writes the templates, marks the CLI as unconfigured, and logs it as the first friction entry.)
2. pi runtime supports multi-file skill packages with sibling reads (precedent: `install-hve-core-rpiv/references/`).
3. The user authoring this skill has filesystem write access to `skills/` and `README.md` in this repo.
4. The dogfood target repo (one) will be a small Node or Python project with real scripts.
5. The boundary sentence pre-commit grep can run on commits to this repo (a one-time check during authoring, not a permanent CI gate).

**Dependencies**:
- pi skill-package contract (read-only constraint).
- This repo's existing `harness-foundations/` files (referenced in templates' citation comments, not in shipped prose).
- A target repo for the single dogfood run (selected by the user during implementation).

**Risks**:
1. **pi runtime rejects multi-file skill load** at first dogfood. *Mitigation*: precedent of `~/.pi/agent/skills/install-hve-core-rpiv/references/` proves multi-file packaging is runtime-supported. **v0.1 fallback artefact**: `check.sh --inline-fallback` is a real v0.1 deliverable (H19 fix); it concatenates every template into a single-file `SKILL.md` variant. Triggered only if the dogfood run reveals multi-file rejection. Log as first friction entry.
2. **Dogfood reveals brief CLI bugs** (notably: brief §13/§14 `validate` hardcodes the step list and ignores `config.json.validation`; `onboard()` prints hardcoded text instead of reading the file). *Mitigation*: spec explicitly requires both bugs to be fixed during template authoring (see Acceptance Criteria **AC-9 (`onboard()` reads file)** and **AC-11 (`validate` honours `config.json.validation`)**) (H8 fix — AC IDs corrected).
3. **Wrap-existing CLI branch produces inconsistent envelope output** between targets that have justfile / package.json / Makefile. *Mitigation*: v0.1 ships a thin wrapper-recipe template that calls the existing command and pipes its output into the standard JSON envelope shape; the envelope is generated by a small shell helper, not by reimplementing the CLI.
4. **Idempotent re-run loses user content** in HARNESS.md or AGENTS.md. *Mitigation*: USER-CONTENT sentinel blocks (FR-NEW-2) are the canonical merge boundary; the skill's merge logic preserves everything inside them verbatim.
5. **Magic-wand wording drifts** between `templates/magic-wand-prompt.md`, the prose in `templates/root-HARNESS.md`, the CLI's `magic-wand` subcommand output, and `retrospective-schema.json` description fields. *Mitigation*: all six canonical surfaces (per AC-14 — H4 fix) read or echo from `templates/magic-wand-prompt.md`; `check.sh` runs the magic-wand grep across all 6 surfaces and asserts byte-identity.

**Phases**: Single phase (Simple Mode). See §Implementation Outline below.

---

## Acceptance Criteria

Numbered, testable, framed as observable outcomes. v0.1 ships when all 12 are satisfied.

1. **Skill package exists with valid frontmatter.** `skills/engineering-harness-setup/SKILL.md` exists. Frontmatter contains **exactly `name` and `description`** (matches pi skill-package contract per `~/.pi/agent/skills/install-hve-core-rpiv/references/generated-skill-contract.md`). The skill **version** is declared in SKILL.md body as a `**Version**: 0.1.0` line (H20 — frontmatter `version` key would contradict the pi convention). No forbidden frontmatter keys (`agent`, `agents`, `handoffs`, `disable-model-invocation`).
2. **Templates folder is complete.** `skills/engineering-harness-setup/templates/` contains all required files (H5 corrected):
   - **13 brief-derived templates** lifted from `source-prompt.md` §§9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 24: `root-HARNESS.md`, `agents-md-snippet.md`, `harness-README.md`, `harness-config.json`, `cli-python-harness.py`, `cli-node-harness.mjs`, `harness-onboard-agent-session.md`, `harness-known-difficulties.md`, `harness-friction-log.md`, `harness-proof-note.md`, `friction-entry.md`, `cli-command-contract.md`, `install-report.md`.
   - **1 NEW template** sourced from §Decisions CF-06: `magic-wand-prompt.md`.
   - **4 FR-NEW templates**: `retrospective-schema.json` (FR-NEW-1), `harness-config.schema.json` (C1 — field list below), `canonical-boundary.txt`, `wrapper-recipe.template` (H12 — skeleton below).
   - **Total**: 18 files in `templates/`.
   - `cli-command-contract.md` is **required** for v0.1 (hosts FR-NEW-4 Phase Gates section, FR-NEW-5 `fft` alias documentation, FR-NEW-6 `--wait` flag documentation, FR-04 error-code enum).
3. **Boundary sentence is byte-identical** across `SKILL.md` preamble, `templates/root-HARNESS.md`, `templates/agents-md-snippet.md`, `templates/harness-onboard-agent-session.md`, and `templates/install-report.md`. `templates/canonical-boundary.txt` contains **exactly** the canonical sentence followed by a single trailing newline, with no commentary, metadata, or BOM. `check.sh` runs two assertions: (a) `grep -rcF "The agent harness drives. The engineering harness proves." skills/engineering-harness-setup/` returns counts of 1 each in at least 5 files (M6/MEDIUM-3 fix — `-c` counts, `-F` fixed-string forbids accidental substring match); (b) `diff <(printf '%s\n' 'The agent harness drives. The engineering harness proves.') skills/engineering-harness-setup/templates/canonical-boundary.txt` exits 0.
4. **No private-source contamination.** A pre-commit `grep -rE 'harness-foundations/|docs/plans/|scratch/|source-notes/|S00[1-4]|N2-S00|M00' skills/engineering-harness-setup/` (MEDIUM-4 fix: alternation needs `-E`) returns zero matches. Additionally, `grep -rE '(^|[^<])(minih|chainglass)' skills/engineering-harness-setup/templates/` returns zero matches outside HTML comments (Issue 9 fix: substrate-name leaks blocked in shipped prose; allowed only in HTML-comment citations).
5. **README.md in this repo gains a "Skills authored here" paragraph** pointing at `skills/engineering-harness-setup/`. The paragraph names the skill, describes it in ≤3 sentences, and links to the skill's `SKILL.md`.
6. **The skill is invokable end-to-end** against a real greenfield target repo (one dogfood run). Observable signals (H15 fix — replaces vague "completes the interactive flow"):
   - The skill exits with process code 0.
   - Each required question (CLI-language-or-wrap-existing branch per FR-02; HARNESS.md-location per FR-01; permission grants; build/test/run/health commands per brief §6; AGENTS.md-patch permission) returned a non-null answer; answers logged in the install report.
   - The skill writes the target files per the manifest (M1 fix): **required** = `AGENTS.md`, `HARNESS.md` (or `docs/project-rules/harness.md`), `harness/README.md`, `harness/config.json`, exactly one of `harness/bin/harness.{py,mjs,sh}`, `harness/skills/onboard-agent-session.md`, `harness/state/{known-difficulties.md,friction-log.md}`, `harness/templates/{proof-note.md,friction-entry.md,retrospective-schema.json}` — **11 required files**; **optional** = `harness/proofs/.gitkeep`, `harness/templates/cli-command-contract.md` — **up to 13 total**.
   - Install report contains a populated `Ran` / `Outcome` row per CLI subcommand the skill invoked.
   - The dogfood run is the only validation; no automated test asserts this.
7. **Placeholder self-check passes.** After the dogfood run, the skill's final step runs `grep -rE '\{\{[A-Z_a-z][A-Za-z0-9_]*\}\}'` over every file it wrote, and the result is empty. If non-empty, the skill exits with `error.code: PLACEHOLDER_LEAK` and `next_action` listing the offending files.
8. **HARNESS.md location branch works.** When the dogfood target has no `docs/project-rules/harness.md`, the skill writes `HARNESS.md` to the repo root without prompting. When the target already has `docs/project-rules/harness.md`, the skill asks the user to choose between replace / merge / skip, and respects the answer.
9. **CLI implementation branch works.** When the user opts for "install new CLI", `harness/bin/harness.{py,mjs}` is installed and `<CLI> --help`, `<CLI> doctor`, `<CLI> validate --dry-run`, `<CLI> onboard`, and `<CLI> magic-wand` all return JSON envelopes conforming to `templates/cli-envelope.schema.json` on stdout (H11 fix — schema mandated; envelope: `{command, status, data?, error: {code, message, next_action?}?, messages?: string[]}`, `status ∈ {pass, fail, unconfigured, degraded, dry-run, running, skipped, unknown}`). When the user opts for "wrap existing tooling", `harness/bin/harness.sh` is installed as a thin POSIX-shell wrapper that conforms to the same envelope schema by piping target-command stdout/stderr/exit-code through a small helper. The `.mjs-shim` variant from prior drafts is dropped (M3 fix — POSIX shell-only for v0.1; Python-shim variant deferred to v0.2 friction-log). The `onboard()` function reads `harness/skills/onboard-agent-session.md` and prints its content; it does NOT contain a hardcoded checklist. When `harness/skills/onboard-agent-session.md` is absent, `<CLI> onboard` exits 2 with envelope `{error.code: UNCONFIGURED, next_action: "Run engineering-harness-setup to materialise the onboarding guide."}` (M4 fix — error branch ACed).
10. **AGENTS.md equivalence table scaffold is populated.** After the dogfood run, `AGENTS.md` in the target repo contains the *"The engineering harness is non-negotiable."* section with an equivalence table that has at least 3 rows reflecting the target's detected commands (e.g. `❌ pnpm test directly` → `✅ <CLI> test --tier fast`). The HTML-comment sentinels (`<!-- USER CONTENT START -->` / `<!-- USER CONTENT END -->`) bracket the editable region.
11. **`<CLI> validate` honours `harness/config.json.validation`.** The brief skeletons hardcoded `["build", "test"]`; the implemented templates read the step list from `config.json.validation.{fast,quick,proof}` and execute the configured tier. `<CLI> fft` is an alias for `<CLI> validate --tier proof`.
12. **Idempotent re-run is safe.** A second invocation of the skill against the same dogfood target with no changes leaves every file per the **per-file merge policy table** below (H3 fix — algorithm specified):

    | File | First-install policy | Re-run policy (no user edits) | Re-run policy (user edited) |
    |---|---|---|---|
    | `HARNESS.md` | overwrite | no-op (mtime unchanged) | preserve USER-CONTENT-sentinel regions verbatim; refresh outside-sentinel content; surface diff for confirmation |
    | `AGENTS.md` | append section bracketed by sentinels | no-op | preserve sentinel-bracketed user content; refresh equivalence-table rows additively (never delete user rows) |
    | `harness/config.json` | write substituted template | no-op | **merge**: preserve user-set values; add newly-detected commands; never delete a populated value automatically; surface diff |
    | `harness/state/friction-log.md` | write substituted template | no-op | **never overwrite** (preserve byte-for-byte) |
    | `harness/state/known-difficulties.md` | write substituted template | no-op | **never overwrite** |
    | `harness/bin/harness.{py,mjs,sh}` | write template | no-op (mtime unchanged) | diff and ask: refresh or keep edits |
    | `harness/templates/retrospective-schema.json` | write template | no-op | refresh on schema change; preserve user-added optional fields |
    | `harness/templates/{proof-note,friction-entry}.md` | write template | no-op | preserve user customisations |
    | `harness/skills/onboard-agent-session.md` | write template | no-op | preserve user customisations |
    | `harness/README.md` | write template | no-op | refresh on template change; surface diff |

    **Sentinel detection algorithm**: exact-string match on the two literal lines `<!-- USER CONTENT START -->` and `<!-- USER CONTENT END -->`. Each appearance must be paired; an unmatched sentinel is a parse error (skill aborts with `error.code: INVALID_ARGS` and `next_action: "User-content sentinels are malformed in <file>; please fix or remove the file before re-running."`). Content between paired sentinels is preserved verbatim.

    The install report explicitly says no files were rewritten when re-run is a no-op.

13. **Neither-runtime degradation (NEW — H16/H-5 fix).** When neither Python ≥ 3.10 nor Node ≥ 18 is available in the target, the skill writes all template files, sets `harness/config.json.harness.cli_language = ""` (empty), creates `harness/state/friction-log.md` with a seed entry citing the missing-runtime condition, and the install report's CLI row reads `Ran: no / Outcome: unconfigured / Reason: no supported runtime detected`. The skill exits 0 (degraded, not failed).

14. **Magic-wand wording is byte-identical (NEW — H4 fix).** Across **6 surfaces**: `templates/magic-wand-prompt.md` (source of truth), `templates/root-HARNESS.md` Rule 5, `templates/harness-friction-log.md`, `templates/harness-proof-note.md`, `templates/install-report.md` (magic-wand prompt section), and `templates/retrospective-schema.json` (`magicWand.description` field). `check.sh` runs `grep -rcF "If you had a magic wand, what ONE thing would you change" skills/engineering-harness-setup/templates/` and expects ≥6 matches with zero variants.

15. **Long-running-boot safety (NEW — M-4 fix).** `<CLI> validate --tier proof` does not invoke the `run` subcommand under any tier. `<CLI> run` without `--execute` returns `status: dry-run` and does not spawn a child process. Verified by dogfood-target observation: after `<CLI> validate --tier proof` exits, no `next`/`vite`/`uvicorn`/`runserver`/`dotnet run` child processes remain (`pgrep -f` returns empty for each).

---

## Risks & Assumptions

(See §Complexity above for the formal list; this section adds operational notes.)

- **Risk: dogfood target selection.** The choice of dogfood target materially affects what friction is captured. Recommendation: select a target with both `package.json` *and* `pyproject.toml` (or pick two adjacent targets) so both CLI branches get exercised in v0.1.
- **Risk: equivalence-table population logic is naive.** v0.1 ships a minimal heuristic (detect package.json scripts; detect justfile recipes; detect pytest config). It will miss exotic tooling (Bazel, Buck, Nx); that's acceptable for v0.1 and goes in the friction log.
- **Assumption: Foundation citation discipline is one-time.** During authoring, every template paraphrasing a foundation principle carries an HTML-comment citation: `<!-- foundations: first-principles#27, patterns-that-work#P7 -->`. These survive into shipped templates as invisible (HTML-comment) traceability anchors. The pre-commit grep does NOT enforce them; they're a quality signal for future maintainers.
- **Risk: pre-commit grep enforcement.** The boundary-sentence and no-private-content greps are run as one-time checks during authoring, not as a permanent git hook. If a future authoring session forgets to run them, drift can happen silently. *Mitigation*: include a one-line script at `skills/engineering-harness-setup/check.sh` that runs both greps; document in `AUTHORING.md`.

---

## Implementation Outline

Simple Mode → single phase, inline task groups. Each group is roughly one focused commit.

### Phase 1 — Skill package authoring (one phase)

**Group A — Scaffold the package** (~7 files, ~30 minutes)
1. Create `skills/engineering-harness-setup/` directory.
2. Write `SKILL.md` **shell only** (H14 fix): frontmatter (`name`, `description` — NO `version` key per AC-1/H20) plus a `**Version**: 0.1.0` body line and a placeholder comment `<!-- Group D writes Sections 0–4 here -->`. Group D fills in the body.
3. Write `AUTHORING.md` (LOW-2 fix — scope specified). Sections:
   - **Why this skill exists** (3–5 sentences linking to `harness-foundations/` and `decisions.md`)
   - **Foundation citation discipline**: every template paraphrasing a foundation principle carries `<!-- foundations: first-principles#NN, patterns-that-work#PNN, directives#DN -->` HTML comments (M7 fix)
   - **How to run `check.sh`**: usage line for each check (boundary, no-private-content, magic-wand byte-identity, canonical-boundary.txt content diff, placeholder leak)
   - **Drift checklist for v0.2**: known evolution paths (single-file fallback, richer exit codes, wrap-existing improvements, portability beyond pi, `harness/profiles/` for multi-environment per field-research Pattern F (LOW-5 fix))
   - Not materialised at install time.
4. Write `templates/canonical-boundary.txt` containing **exactly** the canonical boundary sentence followed by a single trailing newline (no comments, no BOM — see AC-3).
5. Write `templates/magic-wand-prompt.md` containing the hybrid magic-wand wording from §Decisions CF-06 (single source of truth for AC-14).
6. Write `templates/cli-envelope.schema.json` (H11 fix — v0.1 deliverable). JSON Schema Draft 2020-12 for the envelope `{command, status, data?, error?: {code, message, next_action?}, messages?}`. See FR-04 enum for `status` and `error.code`.
7. Write `check.sh` (M10 fix — full scope enumerated). One shell script with subcommands:
   - `check.sh boundary` — boundary-sentence grep per AC-3 (`grep -rcF` + canonical-boundary.txt diff)
   - `check.sh privacy` — no-private-content grep per AC-4 (`grep -rE` for source IDs + scratch/foundation paths + substrate names outside HTML comments)
   - `check.sh magic-wand` — magic-wand byte-identity per AC-14 (`grep -rcF` of the hybrid sentence in ≥6 files)
   - `check.sh placeholders` — grep for unsubstituted `{{...}}` in templates (catches template-authoring typos pre-install)
   - `check.sh all` — runs all four (used in Group G)
   - `check.sh --inline-fallback` — H19 fallback: concatenate templates into a single-file SKILL.md variant

**Group B — Lift the brief's 13 templates** (~13 files, ~2.5 hours)

For each row below: open the named brief section, copy the body into the target file, apply the **drift fixes** in the rightmost column (substitute decisions/FR resolutions), then add the listed **HTML-comment foundation citation** at the top.

| # | Source | Output filename | Drift fixes to apply | FR interactions | Foundation citation |
|---|---|---|---|---|---|
| 1 | brief §9 | `templates/root-HARNESS.md` | Add USER-CONTENT sentinels around the user-customisation block (FR-NEW-2); add `**Maturity Level**: L1` frontmatter (FR-NEW-3); add the Phase Gates scaffold table with 3 example rows (FR-NEW-4); add the hybrid magic-wand line at Rule 5 (CF-06); add the L0–L4 maturity-ladder note explaining the distinction from the L0–L6 proof-level ladder (M6 fix — disambiguate the two ladders) | FR-NEW-2, FR-NEW-3, FR-NEW-4, CF-06 | `<!-- foundations: first-principles#10, #27, patterns-that-work#P3, #P10–P14, directives#D1–D6 -->` |
| 2 | brief §10 | `templates/agents-md-snippet.md` | Rewrite per FR-03 — title (*"The engineering harness is non-negotiable."*), dogfood paragraph, equivalence-table scaffold, self-check footer; bracket the editable region with USER-CONTENT sentinels | FR-03, FR-NEW-2 | `<!-- foundations: directives#D1, first-principles#27, patterns-that-work#P11 -->` |
| 3 | brief §11 | `templates/harness-README.md` | Substitute all 10 placeholders strictly per FR-CF-07; no template-section deletions | CF-07 | `<!-- foundations: directives#D2, first-principles#10 -->` |
| 4 | brief §12 | `templates/harness-config.json` | Conform to `harness-config.schema.json` (Group C #2); add `validation.{fast, quick, proof}` step lists (AC-11); ensure all empty values are `""` not `{{...}}` (CF-07) | CF-07, AC-11 | (none — it's data, not prose) |
| 5 | brief §13 | `templates/cli-python-harness.py` | Fix `validate()` to read `config.json.validation.{tier}` instead of hardcoded `["build", "test"]` (AC-11); fix `onboard()` to read `harness/skills/onboard-agent-session.md` and print it (AC-9); add `fft` alias for `validate --tier proof` (FR-NEW-5); add `doctor --wait [<sec>]` (FR-NEW-6); ensure `run` is dry-run by default and `validate` never invokes `run` (AC-15); emit envelopes via `print_result()` conforming to `cli-envelope.schema.json` (H11); add `error.code: PLACEHOLDER_LEAK` final self-check (AC-7) | AC-7, AC-9, AC-11, AC-15, FR-NEW-5, FR-NEW-6 | `<!-- foundations: first-principles#15, #21, #22, patterns-that-work#P11–P14 -->` (top-of-file comment) |
| 6 | brief §14 | `templates/cli-node-harness.mjs` | Same drift fixes as #5, in Node 18+ stdlib (`node:child_process`, `node:fs`, etc.) | same as #5 | same as #5 |
| 7 | brief §15 | `templates/harness-onboard-agent-session.md` | Keep all 7 steps verbatim (including friction-layer classification per brief §1.6); add the canonical boundary sentence near the top so AC-3 passes | CF-03 | `<!-- foundations: directives#D1, first-principles#27 -->` |
| 8 | brief §16 | `templates/harness-known-difficulties.md` | Empty seed; add USER-CONTENT sentinels around the entries list | FR-NEW-2 | `<!-- foundations: first-principles#37, patterns-that-work#P10 -->` |
| 9 | brief §17 | `templates/harness-friction-log.md` | Add the hybrid magic-wand line (CF-06/AC-14); add USER-CONTENT sentinels; entry template enforces structure (severity/recurrence/layer/candidate fix per PL-11) | CF-06, FR-NEW-2, AC-14 | `<!-- foundations: patterns-that-work#P10, first-principles#48, #51 -->` |
| 10 | brief §18 | `templates/harness-proof-note.md` | Add the hybrid magic-wand line (AC-14); use the QT-04 sharpened verdict columns (`Ran` / `Outcome`) | CF-06, AC-14, QT-04 | `<!-- foundations: first-principles#28, #36, patterns-that-work#P21 -->` |
| 11 | brief §19 | `templates/friction-entry.md` | Match the friction-log entry template structure | (none) | `<!-- foundations: patterns-that-work#P10 -->` |
| 12 | brief §20 | `templates/cli-command-contract.md` | Add full FR-04 enum table; add FR-NEW-5 (`fft` alias) and FR-NEW-6 (`--wait`) documentation; declare per-subcommand error.code subset; reference `cli-envelope.schema.json` | FR-04, FR-NEW-5, FR-NEW-6, H11 | `<!-- foundations: first-principles#15, #21, #22, patterns-that-work#P11–P14 -->` |
| 13 | brief §24 | `templates/install-report.md` | **Owned exclusively by Group C** (H13 fix — do NOT lift in Group B). Group C rewrites this from scratch with QT-04 verdict columns + QT-06 proof-level ceiling sentence + neither-runtime row template (AC-13) | (skip in Group B) | (see Group C) |

*Note*: brief §21–§23 contain implementation notes and safety contract, not template bodies; consult them as background but do not produce template files from them.

**Group C — Add the 5 FR-NEW templates** (~5 files, ~1 hour)

1. **`templates/retrospective-schema.json`** (FR-NEW-1). JSON Schema Draft 2020-12 modelled on `~/substrate/minih/src/schemas/retrospective.json` (re-authored with neutral language).
   - Required: `workedWell` (string, minLength 10), `confusing` (string, minLength 10), `magicWand` (string, minLength 20).
   - Optional: `magicWandTarget` (enum: `project | harness | agent`).
   - The `magicWand.description` field contains the canonical hybrid wording (AC-14).

2. **`templates/harness-config.schema.json`** (C1 fix — field-level spec). JSON Schema Draft 2020-12 for `harness/config.json`. Required top-level keys:
   - `version` (string; e.g. `"0.1"`) — schema version, separate from skill version
   - `harness` (object): `name` (string), `cli_language` (enum: `python | node | wrap | ""`), `cli_path` (string; e.g. `harness/bin/harness.py`)
   - `commands` (object): `install`, `build`, `test`, `lint`, `format_check`, `run`, `smoke` — each a string (the shell command, possibly empty `""`)
   - `health` (object): `url` (string, optional), `expected_status` (integer, default 200)
   - `validation` (object): `fast`, `quick`, `proof` — each an array of step names drawn from `commands` keys (AC-11 reads these)
   - `paths` (object): `proofs` (string, default `harness/proofs`), `state` (string, default `harness/state`), `templates` (string, default `harness/templates`)
   - `permissions` (object): `allow_run` (boolean, default false), `allow_health_probe` (boolean, default true) — governs AC-15 long-running-boot lockdown
   - All string keys allow empty string `""`; no `{{...}}` literals (CF-07).

3. **`templates/wrapper-recipe.template`** (FR-02 wrap-existing branch; H12 fix — skeleton specified). A POSIX-shell template the skill materialises as `harness/bin/harness.sh` when wrap-existing is selected. Placeholder set: `{{TARGET_COMMAND}}` (the wrapped command e.g. `pnpm test`), `{{COMMAND_NAME}}` (the wrapper subcommand e.g. `test`), `{{ENVELOPE_STATUS_SUCCESS}}` / `{{ENVELOPE_STATUS_FAILURE}}` (envelope statuses). Skeleton (~30 lines):
   ```sh
   #!/usr/bin/env sh
   # Wrap-existing harness CLI shim — v0.1
   set -e
   subcommand="$1"; shift || true
   case "$subcommand" in
     {{COMMAND_NAME}})
       output=$({{TARGET_COMMAND}} "$@" 2>&1) && exit_code=0 || exit_code=$?
       if [ $exit_code -eq 0 ]; then status={{ENVELOPE_STATUS_SUCCESS}}; else status={{ENVELOPE_STATUS_FAILURE}}; fi
       printf '{"command":"%s","status":"%s","data":{"output":%s},"messages":[]}\n' \
         "$subcommand" "$status" "$(printf '%s' "$output" | json-escape)"
       exit $exit_code
       ;;
     # ... additional subcommands generated per detected host tool
   esac
   ```
   The skill substitutes one block per detected host command. `json-escape` is a tiny helper function included in the template (sed-based, no jq dependency).

4. **`templates/canonical-boundary.txt`** — already created in Group A item 4; not re-created here.

5. **`templates/install-report.md`** (H13 fix — exclusive Group C ownership). Rewrite from scratch with:
   - QT-04 sharpened verdict columns: `Step | Ran | Outcome | Reason | Evidence` (replaces brief §24's single `Result` column)
   - `Ran ∈ {yes, no, dry-run, unconfigured}`; `Outcome ∈ {pass, fail, degraded, n/a}`
   - QT-06 proof-level ceiling sentence verbatim: *"This setup proves at most L2 (harness commands ran and any approved build/test passed). It does not and cannot prove L3+ (product runtime behaviour). Use the harness loop — Boot → Interact → Observe → Validate — to reach higher proof levels in subsequent sessions."*
   - Neither-runtime row template (AC-13): `CLI | no | unconfigured | no supported runtime detected | install-report:cli-row`
   - The hybrid magic-wand line at the close-out section (AC-14)
   - USER-CONTENT sentinels around the "team additions" area

**Group D — Write SKILL.md body** (~1 file, ~1.5 hours)

Overwrites the placeholder body left by Group A item 2. Five sections (H14 partition clarified):

- **Section 0 — Preamble** (~10 lines):
  - `**Version**: 0.1.0`
  - One-paragraph *"When to use"* (positive framing: invoke on a fresh greenfield target; or on a brownfield target where you want to establish a front door).
  - Canonical boundary sentence verbatim (AC-3).
  - Worked-example anchor (FR-NEW-7): the sanitised chainglass-FX007-style paragraph about a team encoding a single new validation recipe after a class of bug bypassed all existing gates.

- **Section 1 — Principles** (~8 paragraphs):
  - Adapt brief §1.1–§1.8 into installed-skill voice (M9 fix — paraphrase imperative-to-author into descriptive third-person). E.g. brief's *"Do not collapse the agent harness and the engineering harness into one vague thing"* becomes *"The skill keeps the agent-harness vs engineering-harness boundary crisp."*
  - One paragraph per principle. HTML-comment foundation citations per the table in Group B.

- **Section 2 — Install flow** (~14 numbered steps; H9/M-1 fix — explicit reconciliation). The skill performs these steps in order:

  | # | Step | Purpose | Inputs read | Questions asked (verbatim) | Files written | Failure mode |
  |---|---|---|---|---|---|---|
  | 1 | Orient | Confirm target repo path and load prior install state if present | `pwd`, `git rev-parse --show-toplevel`, existing `harness/config.json` if any | none | (none) | exit 1 if no git repo and `--no-git-ok` flag absent |
  | 2 | Inspect | Detect host tooling, runtimes, existing harness artifacts | `package.json`, `pyproject.toml`, `Makefile`, `Justfile`, `Dockerfile`, root `HARNESS.md`, `docs/project-rules/harness.md`, `AGENTS.md` | none | (none) | (read-only step; never fails) |
  | 3 | Decisions | Resolve FR-01 (HARNESS.md location), FR-02 (CLI implementation), permission grants | (none) | *"Where should HARNESS.md live: repo root (recommended) or `docs/project-rules/harness.md`?"* (FR-01); *"Install new CLI at `harness/bin/`, OR wrap existing tooling (justfile, package.json scripts, Makefile)?"* (FR-02, only if host tooling detected); *"Grant permission to write 11–13 files in this repo?"*; *"Grant permission to patch `AGENTS.md`?"* | (none) | exit 1 if user denies write permission |
  | 4 | Propose | Show candidate-command table (build/test/lint/format/run/health) detected from inspection; user confirms or edits | (results of step 2) | per-command confirm prompts | (none) | (never fails; unconfirmed commands become empty strings) |
  | 5 | Substitute | Resolve all 10 placeholders strictly per CF-07; abort if any literal `{{...}}` remains | per step 4 | (none) | (in-memory) | exit 1 with `error.code: INVALID_ARGS` if a required placeholder cannot be resolved |
  | 6 | Create harness skeleton | Materialise `harness/{README.md, config.json, state/, templates/, proofs/, skills/}` | (template files) | (none) | `harness/README.md`, `harness/config.json`, `harness/state/{known-difficulties.md, friction-log.md}`, `harness/templates/{proof-note.md, friction-entry.md, retrospective-schema.json}`, `harness/proofs/.gitkeep`, `harness/skills/onboard-agent-session.md` | abort if any file already exists with non-empty USER-CONTENT region and user chose skip |
  | 7 | Install CLI | Either install new stdlib CLI (`harness/bin/harness.{py,mjs}`) or wrap-existing (`harness/bin/harness.sh`) | (chosen branch from step 3) | (none) | one of `harness/bin/harness.{py,mjs,sh}` | exit 1 if write fails |
  | 8 | Write HARNESS.md | Place at root (default) or `docs/project-rules/harness.md` per FR-01; both-locations branch per AC-8b | (template + step 5 substitutions) | (none in normal branch; consolidation prompt in both-exist branch) | `HARNESS.md` OR `docs/project-rules/harness.md` | abort if both-exist and user declines consolidation |
  | 9 | Patch AGENTS.md | Append the engineering-harness section with FR-03 equivalence-table scaffold and detected rows | existing `AGENTS.md` if present | (none) | `AGENTS.md` (append-only; sentinel-bracketed) | log a warning if `AGENTS.md` already contains the boundary sentence (L-3 fix — dedup via pointer comment) |
  | 10 | Validate | Invoke `<CLI> --help`, `<CLI> doctor`, `<CLI> validate --dry-run` and capture verdicts | the newly installed CLI | (none) | (in-memory — captured for install report) | non-blocking: any failure becomes a row in the install report; skill does not exit on validate failure |
  | 11 | Self-check placeholders | Grep every written file for unsubstituted `{{...}}` per AC-7 | written files | (none) | (none) | exit 1 with `error.code: PLACEHOLDER_LEAK` if any literal remains |
  | 12 | Seed friction | Write one entry to `harness/state/friction-log.md` per detected install-time gap (unconfigured command, missing runtime, no-tool-for-wrap, etc.) per M-8 fix | (results of steps 4, 10) | (none) | append to `harness/state/friction-log.md` | (never fails; friction-log seeding is best-effort) |
  | 13 | Emit install report | Write the QT-04-style report with verdict columns + QT-06 ceiling sentence | (captured verdicts from steps 4, 10) | (none) | `harness/proofs/install-report-<timestamp>.md` | (never fails) |
  | 14 | Magic-wand close-out | Print the hybrid magic-wand prompt; optionally append answer to friction-log | (none) | the hybrid wording from `magic-wand-prompt.md` (AC-14); *"Would you like to append your answer to `harness/state/friction-log.md`?"* | append to friction-log if user agrees | (never fails) |

- **Section 3 — Non-goals** (~15 items): lift from §Non-Goals of this spec, in the same order, slightly tightened for installed-skill voice.

- **Section 4 — Known limitations** (~5 paragraphs):
  - Python ≥ 3.10 OR Node ≥ 18 assumption (Assumption 1); Python 3.9 detected behaviour per M-5 fix.
  - pi-only for v0.1; portability beyond pi is a known v0.2 evolution path.
  - Equivalence-table heuristic catalogue is naive; exotic tooling falls through.
  - `harness/profiles/` for multi-environment targets is a v0.2 evolution path (field-research Pattern F).
  - Partial-install recovery is not in v0.1 scope (L-2 fix).

**Group E — Repo-level housekeeping** (~1 file edit, ~10 minutes)
- Append a *"Skills authored here"* section to `README.md` at the end of the file (LOW-3 fix — location pinned). ≤3 sentences naming the skill, summarising what it does, linking to `skills/engineering-harness-setup/SKILL.md`.

**Group F — Dogfood validation** (~2 dogfood runs, ~60 minutes)
- Select **two** dogfood targets to exercise both CLI branches (L-5 fix — upgrade from "either-or" to "both required for v0.1"). One small Node greenfield, one small Python greenfield. Or a single repo with both `package.json` and `pyproject.toml`.
- Run the skill against the first target (install-new branch). Verify AC-6 through AC-12, AC-13 (if applicable), AC-14, AC-15.
- Run the skill against the second target (wrap-existing branch). Verify AC-9 wrap-existing clause, AC-13 (if applicable).
- Run the skill a **second time against the first target** with no changes; verify AC-12 idempotence (no-op observed).
- Capture friction in each dogfood target's `harness/state/friction-log.md` (eating-the-dogfood). Append one summary sentence to this plan's `decisions.md` pointing at each entry (L-2 fix — single location: target's friction-log is canonical; decisions.md just references).

**Group G — Final pre-commit checks** (~5 minutes)
- Run `skills/engineering-harness-setup/check.sh all`. All four sub-checks must pass.
- `git status --short` shows only intended files; `scratch/` remains ignored.
- Commit as `feat: add engineering-harness-setup skill (v0.1)`.

**Estimated total**: 5–7 focused hours of authoring + two dogfood runs (Issue 5 fix — revised upward from 4–5h to reflect Group B's expanded scope and Group F's two-target requirement).

---

## Workshop Opportunities

Per user instruction *"spec will go straight to implementation"* — none. Three rounds of research (dossier + decisions + field research) and this spec resolve all design questions.

The two `/deepresearch` opportunities surfaced by the dossier (`external-research/skill-package-schemas.md`, `target-repo-language-availability.md`) remain nice-to-have for v0.2 portability work; deferred.

---

## Open Questions

None. Every prior open question has been resolved in `decisions.md`, the field-research findings, or this spec's §Decisions section.

If implementation surfaces a new question, it should be logged as a friction entry in the dogfood target's `friction-log.md` (eating the dogfood) and rolled into v0.2 — not into this spec.

---

## Compound Integration

This repo has no `docs/compound/` directory and no compound system. The compound integration section in `plan-1b-v2-specify` calls for `compound-1-track` and `compound-2-bubble` calls; per the user's standalone-only direction and the absence of any `docs/compound/_buffers/` location to read or write, all compound calls are **silently skipped**. Consistent with `decisions.md` CF-05 (standalone scope).

---

## Flight Plan

The skill description for `plan-1b-v2-specify` includes Step 6: auto-generate a plan-level flight plan via `/plan-5b-flightplan`. That command is not invokable as a tool in this assistant context. **Deferred to user**: if a flight plan is wanted, run `/plan-5b-flightplan --plan docs/plans/002-engineering-harness-setup-skill/engineering-harness-setup-skill-spec.md` manually. Otherwise this spec is sufficient for implementation in Simple Mode.

---

## Files this spec authorises

**To create in this repo**:
- `skills/engineering-harness-setup/` (new directory)
- `skills/engineering-harness-setup/SKILL.md`
- `skills/engineering-harness-setup/AUTHORING.md`
- `skills/engineering-harness-setup/check.sh`
- `skills/engineering-harness-setup/templates/` (new subdirectory)
- ~18 files inside `templates/` (14 brief + 4 FR-NEW)

**To edit in this repo**:
- `README.md` — append one paragraph (Group E)

**Out of scope for this spec**:
- `AGENTS.md` — explicitly not edited (decisions.md Q3).
- `harness-foundations/` — explicitly not edited.
- `simple-mode.md` magic-wand wording drift — separate foundation-housekeeping plan (decisions.md Q5 implications).

---

## Sign-off checklist (run by implementer before claiming v0.1 done)

- [ ] AC-1 through AC-12 verified.
- [ ] `check.sh` returns exit 0 for both boundary-sentence and no-private-content greps.
- [ ] One dogfood run completed; install report captured for inclusion in `decisions.md` as an audit trail.
- [ ] One friction entry filed (against THIS plan, in the dogfood target, or in `decisions.md`) — proves the loop was exercised end-to-end.
- [ ] README.md paragraph appended; link works.
- [ ] No literal `{{…}}` markers remain in any committed file.
- [ ] Conventional Commit: `feat: add engineering-harness-setup skill (v0.1)`.

---

**Spec ready for implementation.** No further clarification, workshop, or research is required. Implementer can proceed directly to Phase 1 Group A.

---

## Validation Record (2026-05-22)

### Validation Thesis

- **Raison d'être**: Translate ~80 research findings + 7 critical-finding decisions + 8 field-research patterns into a single implementation-ready document, honouring the user's directive *"spec will go straight to implementation."*
- **Value claim**: An implementer reading the spec can author the skill package (~20 files + README edit) and dogfood it once, with minimal further clarification.
- **Artifact promise**: All 7 CFs + 4 field-research challenges resolved inline; no `[NEEDS CLARIFICATION]`; observable AC; concrete file-level Implementation Outline.
- **Intended beneficiaries**: Implementer (user or next-session agent); reviewers; plan-folder maintainers.
- **Proof target**: Implementation.
- **Evidence standard**: 15 testable AC; one-phase outline with file-level groups; explicit decision log; risks with mitigations.
- **Thesis source**: User message verbatim — *"spec will go straight to implementation."*
- **Thesis verdict (post-fix)**: Advanced (pre-fix: Partially advanced — Contract not Implementation).
- **Main thesis risk (pre-fix, now resolved)**: *"The implementer cannot author the 14 brief-derived templates or the SKILL.md install-flow from this spec alone — they must load source-prompt.md (2236 lines)."* Resolved by adding the Group B template-mapping table (per-template drift fixes inline) and the Group D Section 2 install-flow enumeration (14 steps with verbatim questions + per-step file writes).

### Validation agents and lens coverage

| Agent | Lenses covered | Thesis axes covered | Issues found | Verdict |
|---|---|---|---|---|
| Clarity (flowspace-research-v2) | Clarity · Hidden Assumptions · Concept Documentation | Implementation Readiness | 4 HIGH · 9 MEDIUM · 5 LOW | ⚠️ → ✅ (post-fix) |
| Completeness (flowspace-research-v2) | Edge Cases · System Behavior · Domain Boundaries · Integration & Ripple | Evidence Sufficiency | 6 HIGH · 10 MEDIUM · 6 LOW | ⚠️ → ✅ (post-fix) |
| Thesis Alignment (flowspace-research-v2) | Thesis Alignment · Evidence Sufficiency · Proof-Level Fit | Implementation Readiness | 1 CRITICAL · 2 HIGH · 4 MEDIUM · 3 LOW | ❌ → ✅ (post-fix) |
| Forward-Compatibility (flowspace-research-v2) | Forward-Compatibility · Technical Constraints · Deployment & Ops | Integration & Ripple | 1 CRITICAL · 6 HIGH · 4 MEDIUM · 5 LOW | ⚠️ → ✅ (post-fix) |

**Lens coverage**: 12/15 lenses (Performance & Scale, Security & Privacy, User Experience deliberately skipped — not material for a docs/skills-authoring artefact). Thesis Alignment + Forward-Compatibility both mandatory — both engaged (not STANDALONE; downstream consumers exist in Implementation Groups A–G).

### Forward-Compatibility Matrix (post-fix)

| Consumer | Requirement | Failure Mode | Verdict (pre-fix) | Verdict (post-fix) | Evidence |
|---|---|---|---|---|---|
| Implementation Group A (Scaffold) | File list; SKILL.md frontmatter; AUTHORING.md scope; check.sh content | Encapsulation lockout + Lifecycle ownership | ⚠️ | ✅ | AUTHORING.md scope specified (Group A item 3); SKILL.md A/D partition explicit (item 2); check.sh subcommands enumerated (item 7) |
| Implementation Group B (Lift 13 templates) | Drift-fix list per template; foundation citations; FR interactions | Contract drift (range typo) + Lifecycle ownership (install-report) | ⚠️ | ✅ | 13-row mapping table added; AC-2 range typo fixed; install-report ownership moved entirely to Group C |
| Implementation Group C (5 FR-NEW templates) | Schema field lists; wrapper-recipe body; install-report shape | Encapsulation lockout (schema + wrapper) | ❌ | ✅ | C1 schema field list added; H12 wrapper-recipe skeleton added; H13 install-report rewrite spec inlined |
| Implementation Group D (SKILL.md install flow) | 14-step flow with verbatim questions; FR branches resolved | Encapsulation lockout (steps not enumerated) + Lifecycle ownership (SKILL.md split) | ⚠️ | ✅ | 14-step table added with verbatim question wording, inputs, outputs, failure modes |
| Implementation Group E (README edit) | Paragraph location + content guidance | Encapsulation lockout (location implicit) | ✅ | ✅ | Location pinned to EOF (LOW-3 fix); ≤3-sentence content rule preserved |
| Implementation Group F (Dogfood) | AC observable; target-selection guidance | Shape mismatch (AC-6 vague) | ⚠️ | ✅ | AC-6 rewritten with observable signals (H15 fix); two-target requirement (L-5 fix); idempotence re-run sub-step added |
| Implementation Group G (Pre-commit checks) | check.sh contract; grep patterns explicit | Test boundary (greps unanchored) | ⚠️ | ✅ | check.sh subcommands enumerated; grep flags pinned (`-rcF`, `-rE`); diff for canonical-boundary.txt |
| Dogfood run | AC-6..AC-15 observable; install report template | Shape mismatch + Encapsulation lockout | ⚠️ | ✅ | All ACs observable post-fix; install report template inlined into Group C; idempotence verified by second run |
| `skills/engineering-harness-setup/` package | Stable layout matching pi runtime; frontmatter schema; templates loadable from sibling dir | Contract drift (`version` key) | ⚠️ | ✅ | `version` moved from frontmatter to SKILL.md body line (H20 fix); frontmatter now `name` + `description` only per generated-skill-contract.md |
| Future v0.2 work | Documented evolution paths | Lifecycle ownership (Pattern F deferral) | ✅ | ✅ | LOW-5 fix — `harness/profiles/` path noted in Group A AUTHORING.md and Section 4 of SKILL.md body |

**Outcome alignment**: *The spec materially advances the OUTCOME — "A fresh team — or a fresh agent in a fresh target repo — can install the first useful version of a repo-local engineering harness in one invocation" — and now reaches Implementation proof-level for all named downstream consumers after the post-validation fix pass closed the Group B/C/D encapsulation lockouts.*

### CRITICAL + HIGH fixes applied

| # | Issue | Fix location in spec |
|---|---|---|
| C1 | harness-config.schema.json field-level spec missing | Group C item 2 (field list inlined) |
| H1 | Group B defers template content to brief | Group B (13-row mapping table with drift fixes) |
| H2 | Group D specifies SKILL.md by section list | Group D Section 2 (14-step table with verbatim questions) |
| H3 | AC-12 idempotent-merge algorithm under-specified | AC-12 (per-file merge policy table + sentinel detection algorithm) |
| H4 | Magic-wand byte-identical lint scope mismatch | AC-14 (new); Risk #5 rewritten; check.sh subcommand added |
| H5 | AC-2 range typo | AC-2 rewritten (13 brief templates + 1 NEW + 4 FR-NEW = 18) |
| H6 | CF-06 hybrid not back-merged into decisions.md | `decisions.md` 2026-05-22 entry appended |
| H7 | PLACEHOLDER_LEAK not in FR-04 enum | FR-04 enum extended |
| H8 | Risk #2 cites wrong AC IDs | Risk #2 rewritten with AC-9 + AC-11 |
| H9 | Group D step count drift | 14 steps explicit; Step 1 (Orient) added; brief §8's 11 steps preserved + 3 spec additions |
| H10 | AGENTS.md equivalence-table row catalogue not enumerated | FR-03 (5-row v0.1 catalogue inlined) |
| H11 | AC-9 wrap-existing envelope shape undefined | AC-9 references `templates/cli-envelope.schema.json` (Group A item 6) |
| H12 | wrapper-recipe.template body undefined | Group C item 3 (skeleton with placeholder set inlined) |
| H13 | install-report.md ownership conflict | Group B row 13 (skip); Group C item 5 (exclusive owner) |
| H14 | SKILL.md A/D partition | Group A item 2 (shell only); Group D (body owns Sections 0–4) |
| H15 | AC-6 not observable | AC-6 rewritten with concrete signals (exit 0, populated questions, file manifest, populated verdict rows) |
| H16 | "Neither runtime" no AC gate | AC-13 added |
| H17 | Both-HARNESS.md edge case undefined | FR-01 third branch added (consolidation prompt) |
| H18 | Wrap-existing-no-tool edge case undefined | FR-02 4-step inspection algorithm |
| H19 | Risk #1 assertion (no v0.1 fallback) | `check.sh --inline-fallback` made a v0.1 deliverable |
| H20 | `version` key contradicts pi contract | `version` moved to SKILL.md body line; AC-1 updated |

### MEDIUM + LOW issues NOT applied (deferred to in-flight implementation as friction-log fodder)

| ID | Issue | Status |
|---|---|---|
| M2 | Two onboarding sources of truth (CLI hardcoded vs file) | Already resolved by CF-03 — file is source |
| M5 | Python 3.9 detected behaviour (below floor) | Deferred to v0.2 friction-log |
| M-7 (Completeness) | Idempotence sub-cases beyond 7 | Covered by AC-12 per-file table; edge cases beyond table go to friction-log |
| M-9 | QT-07 rejection rules as mechanical gates | Accepted as v0.2 work; v0.1 ships with author self-police |
| L-1 | Global `harness` binary collision | Existing path-qualified invocation pattern is sufficient; not explicitly ACed |
| L-2 | Partial-install recovery | Documented in SKILL.md Section 4 as v0.2 path |
| L-3 | Existing AGENTS.md boundary-sentence dedup | Group D Step 9 logs a warning if duplicate detected; explicit dedup deferred to v0.2 |
| L-4 | Brief §2 Step 13 friction-capture during install | Covered by Step 12 of Group D Section 2 (M-8 fix) |
| L-6 | CLAUDE.md / .cursorrules collision | v0.1 AGENTS.md-only is documented in §Non-Goals; explicit detection deferred to v0.2 |
| LOW-4 | Placeholder regex character-class ordering | Cosmetic; not fixed in this pass |

### Validation verdict

**Pre-fix**: ❌ NEEDS ATTENTION (proof mismatch — Implementation claimed, Contract actual; Groups B/C/D had encapsulation lockouts requiring source-prompt.md archaeology).

**Post-fix**: ⚠️ VALIDATED WITH FIXES — 1 CRITICAL + 20 HIGH issues addressed in this commit. Remaining MEDIUM/LOW issues are recoverable as friction-log entries during dogfood (Group F) and do not block implementation. Implementer can proceed directly to Phase 1 Group A.

**Thesis alignment (post-fix)**: Value claim advanced to Implementation proof-level; the implementer can author Groups A–G without round-tripping to source-prompt.md, decisions.md, or field-research-minih-chainglass.md beyond consulting them as background reference. Main thesis risk closed.

**Outcome alignment**: The spec materially advances the OUTCOME — "A fresh team — or a fresh agent in a fresh target repo — can install the first useful version of a repo-local engineering harness in one invocation" — and now reaches Implementation proof-level for all named downstream consumers after the post-validation fix pass closed the Group B/C/D encapsulation lockouts.

**Standalone?**: No — downstream consumers (Implementation Groups A–G + dogfood + resulting skill package + future v0.2) exist in the plan tree.

**Overall**: ⚠️ VALIDATED WITH FIXES.

**Raw agent outputs**: `/tmp/validate-002-spec/{clarity,completeness,thesis,forward-compat}.md` (ephemeral; the audit trail above is the durable record).
