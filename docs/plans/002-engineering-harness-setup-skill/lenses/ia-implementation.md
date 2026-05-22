# Lens IA — Implementation Archaeology

**Plan**: `docs/plans/002-engineering-harness-setup-skill/`
**Lens**: IA (Implementation Archaeologist) — 1 of 8 parallel research lenses
**Brief**: `docs/plans/002-engineering-harness-setup-skill/source-prompt.md` (2236 lines)
**Deliverable framing**: portable skill package, authored in this repo (`harness-engineering`), installable into target repos.
**Generated**: 2026-05-22

## Scope of this lens

Map the implementation landscape: where the skill artifact lives in the authoring repo, what file tree it must produce in target repos, what existing content can be reused, what CLI surface it ships, what tensions and gaps exist between the brief and the conventions present (or absent) in this repo.

## Summary

10 findings, IA-01 through IA-10. No blockers, but two real tensions to surface to the parent synthesis step:

1. The brief calls the artifact "portable" yet ships **both** a Python and a Node CLI template — the portability claim only holds at install time, not at runtime in the target repo (IA-07).
2. The brief assumes a skill-package convention (`SKILL.md`, sibling `templates/`, placeholder substitution) but does not specify which agent-harness runtime's schema it conforms to — the authoring agent will need to pick one and document the install path (IA-08, IA-09).

---

### Finding IA-01: Placement options for the skill package in this authoring repo
**Evidence**:
- `ls -la /Users/jordanknight/substrate/harness-engineering` → top-level dirs are `harness-foundations/`, `docs/`, `scratch/`, plus `AGENTS.md`, `README.md`, `LICENSE`, `justfile`. No `skills/`, `agents/`, `templates/`, or `dist/` folder exists.
- `docs/plans/001-backpressure-harness-foundations/` contains only `research-dossier.md` — the `docs/plans/NNN-slug/` convention is for **research + planning artefacts**, not deliverables.
- `.gitignore` line `scratch/` → anything under `scratch/` is excluded from tracking.
- `AGENTS.md:7` frames the repo as a "public-facing engineering-harness first-principles and tutorial project."

**Description**: There are three plausible homes for the authored skill package. Each has different implications:

| Option | Path | Pros | Cons |
|---|---|---|---|
| **A. Top-level `skills/`** | `skills/engineering-harness-setup/` | Mirrors target-repo install location, easy to package/copy as a unit, signals "this is a shipped artefact," clean separation from foundations text. | Adds a new top-level concept (`skills/`) that AGENTS.md does not currently describe; needs an AGENTS.md framing update. |
| **B. Under `harness-foundations/`** | `harness-foundations/setup-skill/` | Already-recognised folder; co-located with the philosophy text the skill embodies. | Mixes durable conceptual prose with executable templates and CLI skeletons; muddies "foundations are tutorial text" boundary; awkward when the skill is later extracted for install. |
| **C. Under `scratch/`, promote later** | `scratch/skills/engineering-harness-setup/` | Safe for iteration without committing half-baked content. | `scratch/` is gitignored — the skill would be invisible to anyone reading the public repo; contradicts "authoring home" framing; promotion path is undefined. |

Option A is the clearest fit for the AGENTS.md framing ("tutorial project" + "Prefer practical, agent-readable guidance: commands, checks, examples, templates").

**Why it matters for authoring**: Choice cascades into how the skill is referenced from README.md, how AGENTS.md describes the repo, and whether `docs/plans/002-…/` is just plan/research or also contains the in-progress skill. Picking the wrong home now means a rename or move during the spec-to-implementation handoff.

**Recommendation**: Place the artefact at top-level `skills/engineering-harness-setup/`. Reserve `docs/plans/002-engineering-harness-setup-skill/` for plan/research/spec/retro only — matching the precedent set by `001-backpressure-harness-foundations/`. Add a one-line `skills/README.md` index so future skills sit alongside this one.

---

### Finding IA-02: File tree the skill must produce, with reusable-content map
**Evidence**:
- Source brief Section 4 (skill package shape) and Section 5 (target-repo file tree).
- `harness-foundations/directives.md` lines 5–53 (six directives, neutral public phrasing).
- `harness-foundations/simple-mode.md` lines 71–139 ("The five rules" — already publication-safe).
- `harness-foundations/first-principles.md` map shows sections: "Boundary and ontology", "The operating loop", "Encoding and interface design", "Verification and completion control", "Feedback, retrospection, and compounding".
- `harness-foundations/patterns-that-work.md` has 23 patterns including Pattern 1 (classify failure), Pattern 3 (fast loop / proof loop), Pattern 7 (route done to checks).
- `README.md` lines 9–35 (engineering vs agent harness table, Boot→Improve loop).

**Description**: The brief defines two file sets — the skill package itself (Section 4) and what the skill creates in a target repo (Section 5). Most templates have donor content already in this repo:

| Target-repo file (Section 5) | Template in skill (Section 4) | Donor content in this repo |
|---|---|---|
| `HARNESS.md` (root) | `templates/root-HARNESS.md` | **High reuse.** `simple-mode.md:71–139` ("the five rules"), `directives.md:1–53` (all six directives), `first-principles.md:41–86` (operating loop), `README.md:13–35` (boundary table). |
| `AGENTS.md` patch | `templates/agents-md-snippet.md` | `simple-mode.md:73–80` (CLI as front door routing); `directives.md` Directive 3 (paved path). |
| `harness/README.md` | `templates/harness-README.md` | `README.md:35–55` (improvement-loop framing); `first-principles.md` "Encoding and interface design". |
| `harness/config.json` | `templates/harness-config.json` | None — this is mechanical structure; brief Section 12 is canonical. |
| `harness/bin/harness.py` | `templates/cli-python-harness.py` | None — brief Section 13 is canonical. |
| `harness/bin/harness.mjs` | `templates/cli-node-harness.mjs` | None — brief Section 14 is canonical. |
| `harness/skills/onboard-agent-session.md` | `templates/harness-onboard-agent-session.md` | `simple-mode.md:51–69` (why a CLI is the front door); `patterns-that-work.md` Pattern 4 (instruction routing). |
| `harness/state/known-difficulties.md` | `templates/harness-known-difficulties.md` | `patterns-that-work.md` Pattern 9 (promote review feedback into harness). |
| `harness/state/friction-log.md` | `templates/harness-friction-log.md` | `simple-mode.md:117–135` (Rule 4); `directives.md` Directive 5; `patterns-that-work.md` friction lifecycle (per 001 dossier). |
| `harness/templates/proof-note.md` | `templates/harness-proof-note.md` | 001 dossier "Backpressure Surface Types" table; `first-principles.md` "Verification and completion control". |
| `harness/templates/friction-entry.md` | (sibling) | Same donors as friction-log. |
| `harness/proofs/.gitkeep` | n/a | n/a |
| Setup report | `templates/install-report.md` | None — brief Section 24 is canonical. |
| CLI contract | `templates/cli-command-contract.md` | `patterns-that-work.md` Pattern 3 (fast/proof loop), Pattern 7 (route done to checks); 001 dossier "Backpressure Quality Criteria". |

**Why it matters for authoring**: Roughly 6 of 12 templates can be substantially synthesised from existing publication-safe text in `harness-foundations/`. The skill author should not paraphrase from scratch where neutral wording already exists — doing so risks drift from AGENTS.md publication-boundary rules and from the 001 dossier's "backpressure" vocabulary.

**Recommendation**: Build a donor-mapping table inside the skill spec (next plan step) that names exact source lines for each template's core paragraphs. Treat the brief's literal template bodies (Sections 9, 10, 11, 15, 16, 17) as the canonical wording with one round of harmonisation against `directives.md` and `simple-mode.md` vocabulary so the skill's output matches the rest of the repo's voice.

---

### Finding IA-03: Natural flow from prompt → foundations → 001 dossier → 002 plan → skill package
**Evidence**:
- `docs/plans/001-backpressure-harness-foundations/research-dossier.md:1–13` (dossier metadata format and "60 subagent findings synthesised from 6 focused research passes").
- `docs/plans/002-engineering-harness-setup-skill/source-prompt.md` exists (2236 lines, this brief).
- `docs/plans/002-engineering-harness-setup-skill/lenses/` is empty (this lens is one of the 8 to populate it).
- `harness-foundations/source-notes/notes.md`, `notes2.md`, `notes3.md` are the sanitised research syntheses feeding the public foundations.
- Source brief Section 33 outlines the SKILL.md the authoring agent will produce.

**Description**: The conceptual flow this repo embodies, traced from source to artefact:

```
private sources (referenced in scratch/sources/, not tracked)
  ↓ sanitise
harness-foundations/source-notes/{notes,notes2,notes3}.md
  ↓ promote to public foundations
harness-foundations/{first-principles,patterns-that-work,directives,simple-mode}.md
  ↓ first concept research
docs/plans/001-backpressure-harness-foundations/research-dossier.md
  ↓ adds "backpressure" vocabulary to the foundations
[follow-on edits to foundations — pending]
  ↓ next deliverable framing
docs/plans/002-engineering-harness-setup-skill/source-prompt.md   ← brief
  ↓ 8-lens research fan-out (this file is lens IA)
docs/plans/002-engineering-harness-setup-skill/lenses/*.md
  ↓ synthesis
docs/plans/002-engineering-harness-setup-skill/research-dossier.md (to be authored)
  ↓ spec
docs/plans/002-engineering-harness-setup-skill/spec.md (to be authored)
  ↓ implementation
skills/engineering-harness-setup/              ← the portable artefact
  SKILL.md
  templates/...
  ↓ install (out of repo)
~/.pi/agent/skills/engineering-harness-setup/  ← agent-harness install location
  ↓ invocation against any target repo
target-repo/{HARNESS.md, AGENTS.md (patched), harness/...}
```

The entry point the agent invokes (per Section 33) is the skill's `SKILL.md`. The user invokes it through whatever the host agent runtime calls "use this skill" (pi: skill slug; Claude Code: agent; Cursor: rule). This is the boundary where "portable" becomes "host-specific" (see IA-08, IA-09).

**Why it matters for authoring**: The skill author needs to be clear that the **plan plus research dossier lives in `docs/plans/002-…/`**, while the **shippable artefact lives in `skills/engineering-harness-setup/`**. Conflating these two is the single most likely structural mistake when the implementation phase begins. The 001 plan does not have an artefact yet — only research — so 002 is the first to need both.

**Recommendation**: Document the split explicitly in the spec phase. Add one paragraph in `skills/README.md` (when created) noting "the plan/research/spec for this skill lives at `docs/plans/002-engineering-harness-setup-skill/`; this folder is the shippable artefact."

---

### Finding IA-04: CLI skeleton surface (Python and Node) — subcommands, exit codes, flags
**Evidence**:
- Source brief Section 13 (Python CLI, ~190 lines) and Section 14 (Node CLI, ~210 lines).
- Section 20 (CLI command contract): exit codes `0`/`1`/`2`, `--dry-run`, `--json`.
- Section 13 subcommand list (Python `argparse` setup): `doctor`, `install`, `build`, `test`, `lint`, `format_check`, `run`, `smoke`, `health`, `validate`, `onboard`, `magic-wand`.
- Section 14 mirror in Node (same names, same flags).

**Description**: Both CLI skeletons are deliberately small but share a fixed surface that the skill must materialise verbatim into the target repo:

**Subcommands (12, with parity between Python and Node)**:
- `doctor` — read config, report configured/unconfigured, exit `0` if config found, `1` otherwise.
- `install`, `build`, `test`, `lint`, `format_check`, `run`, `smoke` — wrappers over `config.json` entries; exit `2` if unconfigured, `0/1` if run.
- `health` — HTTP GET (urllib in Python, fetch in Node) against configured URL with timeout.
- `validate` — layered: build → test → health; degraded-tolerant for unconfigured optional steps.
- `onboard` — prints the 6-step onboarding checklist.
- `magic-wand` — prints the magic-wand question + reminder to log to `friction-log.md`.

**Global flags**: `--json` (structured output where supported), `--help` (auto from argparse / hand-written banner in Node).

**Per-command flag**: `--dry-run` (on `install`/`build`/`test`/`lint`/`format_check`/`run`/`smoke`/`health`/`validate`).

**Exit codes**:
- `0` — passed or completed successfully.
- `1` — failed.
- `2` — unconfigured or not applicable (treated as non-fatal by `validate`).

**Output contract** (`printResult`/`print_result`):
- `status` (string), `title` or `command` (string), `messages` (array), `next_action` (string|null).

**Repository location**: Both CLIs land in **target-repo** `harness/bin/harness.py` or `harness/bin/harness.mjs`. The **skill-package** templates live in `skills/engineering-harness-setup/templates/cli-python-harness.py` and `templates/cli-node-harness.mjs`.

Both skeletons compute `ROOT` as `parents[2]` of the script file, i.e. they assume `harness/bin/harness.{py,mjs}` and read `<ROOT>/harness/config.json`. This locks the install path — the CLI templates cannot be relocated without editing those constants.

**Why it matters for authoring**: The CLI surface is fully specified in the brief and the skill should treat Sections 13 and 14 as canonical. The risk is divergence between Python and Node: the brief currently has the same shape, but any future edit (e.g., adding `--json` to `onboard`) must be applied to both templates simultaneously or the "language choice is cosmetic" claim breaks.

**Recommendation**: Treat Sections 13 and 14 as a single contract with two implementations. Add a "CLI parity checklist" in `skills/engineering-harness-setup/templates/cli-command-contract.md` listing every subcommand, flag, exit code, and output field that must match across both. Reference this checklist from the SKILL.md so future skill maintainers know to update both files in lockstep.

---

### Finding IA-05: Existing files in this repo that need changes to host the skill
**Evidence**:
- `README.md` currently ends at "What this repo contains" (lines 53–64) listing only foundations files — no skill section.
- `AGENTS.md:5–13` describes the repo as a foundations/tutorial project with no mention of authored skills.
- `justfile` has only the `compact` recipe (lines 6–22). No `package`, `release`, `lint-skills`, or `install-skill` recipes.
- No tracker file exists for "which skills this repo authors" — `ctx_shell ls` confirms no `skills/`, `agents/`, or `dist/` folder.

**Description**: To host the new skill cleanly, four existing files want updates:

1. **`README.md`** — add a short "Skills authored here" section pointing at `skills/engineering-harness-setup/` and explaining the install pattern. Without this, a reader has no surface clue the skill exists.
2. **`AGENTS.md`** — extend "Repo framing" to acknowledge that this repo authors installable skills alongside foundations text. Currently the framing is "first-principles and tutorial project" only. Per the repo's Change-safety preference, this is a real framing change that should be confirmed before edit, not silently encoded.
3. **`skills/README.md`** (new file, not an edit) — top-level index listing each authored skill with one-line description, install hint, and a link to its plan in `docs/plans/`.
4. **`justfile`** (optional) — a `just skill-package <slug>` recipe that tars or zips a skill folder for distribution; a `just skill-lint <slug>` recipe that checks placeholder syntax and template completeness. Not required for v0.1 but useful once the skill needs releases.

`.gitignore` does **not** need changes — top-level `skills/` is not ignored (only `scratch/` and `.chainglass/` are private).

**Why it matters for authoring**: A skill that exists on disk but is unreferenced from `README.md`, `AGENTS.md`, and any directory index is effectively invisible. The authoring agent should produce the new file plus the three updates as a single coherent change-set, or the repo ships a skill nobody can find without grep.

**Recommendation**: During the spec phase, include a "Repo-level integration" subsection listing exactly what changes in `README.md`, `AGENTS.md`, and the new `skills/README.md`. Defer the `justfile` recipe to a follow-on improvement (record it in this plan's friction log if/when the skill is moved out for install).

---

### Finding IA-06: End-to-end execution trace — what files get touched in what order in a fresh target repo
**Evidence**:
- Source brief Section 8 (install flow, steps 1–11).
- Section 5 (target file tree).
- Section 6 (decision points).
- Section 23 (definition of successful setup).
- Section 24 (final report).

**Description**: One run of the skill in a fresh target repo touches files in this order:

| # | Action | Files touched (read=R, written=W, patched=P) |
|---|---|---|
| 1 | Inspect target repo signals | R: `package.json`, `pnpm-lock.yaml`, `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`, `Makefile`, `Justfile`, `README.md`, existing `AGENTS.md` (Section 7.1 list) |
| 2 | Present candidate command table; ask Section 6.1 decisions | (none) |
| 3 | Create root harness instructions | W: `HARNESS.md` (Section 9 template, placeholders filled) |
| 4 | Patch or create routing in agent file | P: `AGENTS.md` (append Section 10 snippet) **or** W: `AGENTS.md` if absent |
| 5 | Create harness folder skeleton | W: `harness/README.md`, `harness/proofs/.gitkeep`, `harness/state/known-difficulties.md`, `harness/state/friction-log.md`, `harness/templates/proof-note.md`, `harness/templates/friction-entry.md`, `harness/skills/onboard-agent-session.md` |
| 6 | Populate config | W: `harness/config.json` (Section 12 template with confirmed commands; unset slots left as empty strings) |
| 7 | Materialise CLI skeleton | W: `harness/bin/harness.py` **or** `harness/bin/harness.mjs` (exactly one, based on user choice) |
| 8 | Optionally chmod CLI | (filesystem permission change, not file content) |
| 9 | Run CLI help | R: nothing; emits to stdout |
| 10 | Run `doctor` | R: `harness/config.json` |
| 11 | Run `validate --dry-run` (if approved) | R: `harness/config.json` |
| 12 | Optionally run real `build`/`test`/`health` (if approved) | R: project source; W: build outputs in project's normal locations |
| 13 | Emit setup report | (stdout only — Section 24 template; optionally W: `harness/proofs/setup-<timestamp>.md` if user opts in) |
| 14 | Ask magic-wand question, optionally append to friction log | P: `harness/state/friction-log.md` if user records candidate |

**Total writes for the smallest acceptable run** (Section 36 minimum): 7 files + 1 patch.

**Why it matters for authoring**: This trace is the **single source of truth** for the SKILL.md's "Setup flow" section. Any divergence — for example, writing the CLI before asking the language question — produces irreversible state in the target repo that the user did not consent to. The trace also informs the dry-run / rollback story: by step 7 the skeleton is materialised and removing it cleanly requires deleting `harness/`, restoring or removing `AGENTS.md` changes, and removing `HARNESS.md`.

**Recommendation**: Encode this trace as a numbered procedure in `SKILL.md`. For each step, include a one-line precondition (what must be true) and one-line postcondition (what is now true). The skill should refuse to proceed past any step whose precondition fails (e.g., refuse to write `harness/bin/harness.py` if the user did not confirm Python).

---

### Finding IA-07: Tension between "portable skill" and language-specific CLI templates
**Evidence**:
- Brief Section 4 lists `templates/cli-python-harness.py` **and** `templates/cli-node-harness.mjs` as siblings — both ship inside the skill package.
- Section 6.1.1 ("CLI implementation language"): "Should the repo-local harness CLI be Python or Node?" — a per-target decision made at install time.
- Section 13 (Python) and Section 14 (Node) are full templates, ~200 lines each, with feature parity.
- Section 5 file tree shows the target repo gets exactly one of `harness/bin/harness.py` **or** `harness/bin/harness.mjs`, never both.
- Section 25 user message at "CLI language" decision: "This only chooses the harness CLI implementation language. The product itself can be any stack."

**Description**: The brief's "portable skill" claim is ambiguous across two axes:

1. **Portable across host agent harnesses** (Claude Code, pi, Copilot CLI, Cursor) — the skill is markdown + templates, so this is mostly free, modulo each host's SKILL.md schema (see IA-08, IA-09).
2. **Portable across target repos with different toolchains** — this is where the tension lives. The skill ships **two** CLI implementations to satisfy a per-target language decision. The skill package is bilingual at rest, but every install picks one and discards the other.

Implications:
- The skill package must always contain both templates, even though any single install uses ~50%. Removing the unused template is the install agent's job, not the package's.
- If the target repo has neither Python 3 nor Node available, **no template fits**. The brief does not specify a third option (shell-only? Just/Make wrapper?). Section 22 hints at this by saying "the CLI itself can be Python or Node" — the brief assumes one is always present.
- If both Python and Node are present and the project itself is e.g. Go, the user is asked to make an irrelevant aesthetic choice. The educational nudge in Section 25 ("more comfortable with simple scripts" vs "already has Node available") addresses this, but does not fully resolve it.
- Future expansion to a third language (e.g., a Deno or Bun CLI, or a Rust binary) requires editing every place the language choice is encoded: SKILL.md decision question, file tree, install report, CLI parity checklist (IA-04).

**Why it matters for authoring**: The skill should be honest about the portability scope. "Portable skill" in this brief means **"language-agnostic at the skill level, but produces a language-bound artefact in the target repo."** That nuance affects how the SKILL.md frames the language question and how install reports describe what was created.

**Recommendation**: Add a one-line clarifier near the top of `SKILL.md` distinguishing the two portabilities. In the language-decision prompt (Section 25 educational note), explicitly call out the third case: "If you have neither Python nor Node, record this as the first friction-log entry — installing one is itself a candidate harness improvement." This stays honest without bloating the skill.

**External Research Gap**: Whether common target repos (especially monorepos with only a single toolchain like Cargo or Go) actually have Python or Node available is empirical; needs validation against a small sample of real repos during dogfooding.

---

### Finding IA-08: External research gaps on skill-package conventions
**Evidence**:
- Brief Section 4: "The exact format can be adapted to the agent runtime, but the skill must retain these conceptual pieces." → the brief is explicitly agnostic about the host runtime's schema.
- Brief Section 4 alternative: "If the skill runtime only supports a single instruction file, embed the templates inside `SKILL.md`." → two packaging modes are possible.
- Brief Section 32.2: parameterisation placeholders are given as `{{HARNESS_CLI_INVOCATION}}` etc. — the brief does not say which engine performs the substitution.
- No `~/.pi/agent/skills/` example in this repo; no Claude Code agent, no Cursor rule, no Copilot CLI prompt file present.
- The task description mentions `~/.pi/agent/skills/engineering-harness-setup/` as one install target but does not pin the schema.

**Description**: Three conventions the brief assumes but does not pin down:

| Convention | What's assumed | What's missing |
|---|---|---|
| **SKILL.md frontmatter / schema** | A `SKILL.md` file is the entry point; brief Section 33 outlines its body. | No YAML frontmatter, no `name`/`description`/`triggers`/`tools` fields — yet most host runtimes (Claude Code agents, Cursor rules, OpenAI assistant skills) want at least minimal metadata. |
| **Template materialisation** | The running agent reads `templates/foo.md`, substitutes `{{PLACEHOLDERS}}`, writes to target paths. | The brief does not say whether placeholder substitution is mechanical (e.g., string replace) or agent-driven (LLM rewrites). Edge cases: nested placeholders, conditional sections (Python vs Node), partial substitution failures. |
| **Install path / discovery** | Skill lives at some `<agent-harness-root>/skills/<slug>/`. | No standard path given. pi: probably `~/.pi/agent/skills/`. Claude Code: `.claude/agents/` or `~/.claude/agents/`. Copilot CLI: TBD. Cursor: not a "skill" concept, uses `.cursor/rules/`. |

The brief is intentionally agnostic ("the exact format can be adapted to the agent runtime"), but the authoring agent has to pick **one canonical packaging** to actually ship. The most defensible default is "filesystem-flat, markdown SKILL.md plus sibling `templates/`, no frontmatter" — this is the lowest common denominator and works in every host that lets the agent read files.

**Why it matters for authoring**: Without picking a canonical packaging, the skill cannot be installed anywhere — it stays an aspirational folder. The choice also determines whether the SKILL.md is parseable by the host (for auto-discovery / triggers) or only readable as instructions for the running agent.

**Recommendation**: Adopt the "filesystem-flat, no frontmatter, agent-reads-and-materialises" packaging as the v0.1 default. Document this assumption in `skills/engineering-harness-setup/SKILL.md` under "How this skill is packaged." Add a follow-on plan or friction-log entry: "Convert to host-specific schemas (pi, Claude Code, Cursor) as those conventions stabilise."

**External Research Gap**: Concrete SKILL.md schemas for at least pi (`~/.pi/agent/skills/`), Claude Code subagents (`.claude/agents/`), and Cursor rules — needed before any host-specific install adapter is written. Likely answerable via the parent's deep-research lens, not this IA lens.

---

### Finding IA-09: Skill identity, naming, and the authoring-home vs install-home distinction
**Evidence**:
- Brief Section 4 names the package "engineering-harness-setup-skill" but Section 33 names the skill "Engineering Harness Setup" (no "-skill" suffix).
- Plan folder is `002-engineering-harness-setup-skill` — the `-skill` suffix is present here.
- Task description: "installable into a target repo (e.g., `~/.pi/agent/skills/engineering-harness-setup/`)" — without the `-skill` suffix.
- No `AGENTS.md` or `README.md` entry currently mentions a slug convention.

**Description**: Three naming surfaces are in play and they don't currently agree:

| Surface | Current value | Notes |
|---|---|---|
| Plan folder | `002-engineering-harness-setup-skill` | Numbered prefix from plan-folder convention. |
| Skill package folder (proposed authoring home) | `skills/engineering-harness-setup/` (no `-skill` suffix, no number) | Mirrors install location. |
| Install location | `~/.pi/agent/skills/engineering-harness-setup/` (or analogue) | No number, no suffix. |
| Skill title in SKILL.md | "Engineering Harness Setup" | Title Case, no slug. |
| Brief's package name | "engineering-harness-setup-skill" (Section 4) | Conflicts with install location. |

If the authoring folder is `skills/engineering-harness-setup-skill/` (with `-skill`) and the install location is `skills/engineering-harness-setup/` (without), then the install step has to rename — error-prone. Conversely, the brief's `engineering-harness-setup-skill/` reads slightly redundant: `skills/engineering-harness-setup-skill/` doubles the word "skill."

**Why it matters for authoring**: Mismatched names create install bugs (wrong directory) and documentation drift (multiple ways to refer to the same thing). The authoring agent will write the slug into HARNESS.md, AGENTS.md, install reports, and the SKILL.md title — getting it consistent now is cheap, getting it consistent later requires repo-wide find-and-replace.

**Recommendation**: Pick `engineering-harness-setup` (no `-skill` suffix) as the canonical slug. Use it for:
- Authoring folder: `skills/engineering-harness-setup/`
- Install location: `~/.pi/agent/skills/engineering-harness-setup/` (or `<host>/skills/engineering-harness-setup/`)
- Plan folder keeps its `-skill` suffix for plan-numbering consistency (`002-engineering-harness-setup-skill/` is fine — it's a plan slug, not a skill slug).
- SKILL.md title remains "Engineering Harness Setup" (human-readable).
- Section 4 of the brief should be reconciled in the spec phase to drop the `-skill` from the package folder name.

---

### Finding IA-10: Minimum viable v0.1 — what to ship first vs defer
**Evidence**:
- Brief Section 36 ("The shortest acceptable version of the setup") lists 7 target-repo files.
- Brief Section 23 (definition of successful setup) lists 8 conditions.
- Brief Section 28 lists 10 follow-on improvements that are explicitly post-v0.1.
- This repo has no test infrastructure yet for skills, no `just skill-lint`, no canary repo for dogfooding.

**Description**: The brief separates "v0.1 must" from "v0.2+ might" reasonably cleanly. Mapping that against this repo's capacity (no test harness, no canary target repo), the realistic v0.1 scope is:

**Must ship in skills/engineering-harness-setup/ for v0.1**:
1. `SKILL.md` — purpose, when-to-use, flow (Section 33 outline), safety, final report.
2. `templates/root-HARNESS.md` — Section 9 verbatim with placeholders.
3. `templates/agents-md-snippet.md` — Section 10 verbatim.
4. `templates/harness-README.md` — Section 11 verbatim.
5. `templates/harness-config.json` — Section 12 verbatim.
6. `templates/cli-python-harness.py` — Section 13 verbatim.
7. `templates/cli-node-harness.mjs` — Section 14 verbatim.
8. `templates/harness-onboard-agent-session.md` — Section 15 verbatim.
9. `templates/harness-known-difficulties.md` — Section 16 verbatim.
10. `templates/harness-friction-log.md` — Section 17 verbatim.
11. `templates/harness-proof-note.md` — Section 18 verbatim.
12. `templates/friction-entry.md` — Section 19 verbatim.
13. `templates/cli-command-contract.md` — Section 20 + parity checklist (IA-04).
14. `templates/install-report.md` — Section 24 verbatim.

**Defer to v0.2+**:
- Boot orchestration (Section 22) — leave run as encoded-but-not-executed.
- Fast-loop / proof-loop split in config (Section 29) — single `validation` block is fine for v0.1.
- Layered architecture checks (Section 28 #5).
- `harness/` proof-note auto-generation (Section 28 #6).
- Host-specific install adapters (pi, Claude Code, Cursor — see IA-08 gap).
- `just skill-package` and `just skill-lint` recipes (see IA-05).

**Repo-level changes that must accompany v0.1** (from IA-05):
- `skills/README.md` (new, one-paragraph index).
- `README.md` "Skills authored here" section (one paragraph + link).
- `AGENTS.md` "Repo framing" extended to mention authored skills.

**Why it matters for authoring**: Without a clear v0.1 cut, the skill grows by accretion and never ships. The brief's Section 23 + Section 36 give a defensible minimum; the implementation phase should resist temptation to add the Section 28 follow-ons before the v0.1 baseline ships and gets one real dogfooding run in a target repo.

**Recommendation**: In the upcoming spec, write an explicit "v0.1 scope / v0.2+ deferred" table mirroring the lists above. Make "one successful dogfooding run in a target repo" the v0.1 acceptance gate — not "all Section 28 items addressed." Record the deferred items as the first entries in this plan's own friction/improvement log so they are not forgotten.

---

## Lens IA summary for parent synthesis

**Strongest concrete recommendations** (likely to be acted on by the spec/impl phases):
1. **Path**: `skills/engineering-harness-setup/` (no `-skill` suffix) — IA-01, IA-09.
2. **Reuse aggressively**: 6 of 12 template bodies have donor content in `harness-foundations/` — IA-02.
3. **Treat CLI Python+Node as one contract** with a parity checklist — IA-04, IA-07.
4. **Repo-level integration**: `skills/README.md` + `README.md` section + `AGENTS.md` framing extension — IA-05.
5. **v0.1 acceptance**: one successful dogfood run, not full Section 28 coverage — IA-10.

**Open questions the parent should route elsewhere**:
- SKILL.md schema across pi / Claude Code / Cursor — needs a deep-research lens (IA-08).
- Realistic target-repo language availability (Python+Node both present? neither?) — needs empirical validation later (IA-07).
- Whether placeholder substitution is mechanical or agent-driven — design decision for spec (IA-08).

**Blockers**: none for the dossier-synthesis step. All open questions are answerable in the spec phase or as v0.2 work.
