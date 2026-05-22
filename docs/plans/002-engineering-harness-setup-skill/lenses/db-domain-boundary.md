# Lens DB — Domain & Boundary Scout

**Mode**: Standard (no `docs/domains/registry.md` exists in this repo — verified `MISSING`).
**Scope**: Identify the natural conceptual boundaries the *Engineering Harness Setup* skill MUST respect, plus contract opportunities to formalize. The skill ships as a portable skill package; both its authoring surface (this repo) and its runtime output (target repo) need clean boundaries.
**Source-prompt anchor**: `docs/plans/002-engineering-harness-setup-skill/source-prompt.md` (2236 lines, version 0.1).

---

## Summary

The most load-bearing boundary this skill must encode is the **engineering harness vs agent harness** distinction — it is restated as Directive 1 of `harness-foundations/directives.md`, as principles #1–3 of `harness-foundations/first-principles.md`, in `AGENTS.md` "Harness layer definitions", and as Section 1.1 of the source-prompt. A single careless verb in any template (e.g., "the harness drives") would invert this. Four further boundaries also need protection: **tracked vs `scratch/`** (`.gitignore:146`, `AGENTS.md:21–27`), **authoring repo vs target repo** (the skill creates output in *someone else's* tree), **skill package tree vs harness package tree** (Sections 4 vs 5 of the source-prompt), and **public-safe neutral wording** (`AGENTS.md:25`). One legitimate grey zone exists: friction-log / magic-wand practices are *engineering*-harness practices even though *agent* harnesses help collect them (`AGENTS.md:19`) — the skill must name this nuance rather than pretend either side owns it. Finally, there are two cheap contract opportunities: a one-line **AGENTS.md ↔ HARNESS.md ↔ config.json** routing contract, and a **JSON Schema** for `harness/config.json` (Section 12) so future tools — including the skill's own `doctor` — can validate it.

---

### Finding DB-01: The engineering-harness ↔ agent-harness boundary is the #1 invariant of the skill
**Category**: Existing Boundary
**Evidence**:
- `harness-foundations/directives.md:5–13` (Directive 1: "Keep the harness boundary clear … The agent harness can drive the engineering harness, but it cannot replace it.")
- `harness-foundations/first-principles.md:7–15` (principles #1–3 under "Boundary and ontology")
- `AGENTS.md:14–19` ("Engineering harness … Agent harness … The agent harness invokes and benefits from the engineering harness, but does not replace it.")
- `harness-foundations/simple-mode.md:31–35` ("The agent harness drives. The engineering harness proves.")
- `docs/plans/002-engineering-harness-setup-skill/source-prompt.md` §1.1 (lines 14–26), §9 (HARNESS.md template re-encodes the line), §10 (AGENTS.md patch re-encodes it), §32.3 ("biased toward executable fixes")

**Finding**: This single distinction is the load-bearing concept of the entire foundation. Every other directive, every template, and every prompt downstream presupposes it. Any wording slip — "the harness drives", "the agent proves", "the harness is the runtime" — silently inverts the model and undermines the rest of the skill. The boundary already appears verbatim in at least five tracked locations because the repo treats it as the canonical first sentence.

**Recommendation**: The skill must encode this boundary as a **single canonical sentence** ("The agent harness drives. The engineering harness proves.") and reuse it byte-identical in:
- `SKILL.md` purpose/principles section,
- `HARNESS.md` template header,
- `AGENTS.md` patch snippet,
- the `onboard-agent-session.md` orientation step,
- and the final setup report's opening paragraph.

Add an explicit **lint rule** (or at minimum a SKILL.md checklist item) to the skill: when materialising any template, the boundary sentence must appear unchanged. Treat any author edit to that sentence as a breaking change to the skill contract. Also include a short anti-example block ("Wording to avoid: 'the harness drives the model', 'the agent harness proves the product'") so future maintainers see the failure mode before they cause it.

---

### Finding DB-02: Tracked content vs `scratch/` — templates ship publicly, source-notes do not
**Category**: Existing Boundary
**Evidence**:
- `AGENTS.md:21–27` ("`scratch/` is a private research workspace and is gitignored … Never commit raw source documents, private notes, customer-specific details, person names, internal codewords, employer/client names, or unreleased platform details.")
- `.gitignore:146` (`scratch/`)
- `harness-foundations/source-notes/notes.md:1–5` ("This is a public-safe synthesis of early research notes. Source IDs are retained for traceability") — sanitized but still source-tagged (S001–S004 in the registry block).
- `AGENTS.md:31–35` (workflow: copy raw material into `scratch/` only when allowed; promote only generalised, publication-safe synthesis into tracked content).

**Finding**: The skill's templates are tracked content. They ship in the public-facing skill package and ultimately into arbitrary user repos. Even though `harness-foundations/source-notes/` is already sanitised, it remains *source-tagged* (S001–S004) and exists for traceability, not for reuse. A future skill author lifting prose from those notes — or worse, from `scratch/` — into a template would punch a hole through the publication boundary, and the breach would propagate to every repo that installs the skill.

**Recommendation**: Add a "Sources" subsection to the skill's authoring `README.md` (the one that lives next to `SKILL.md` in this repo, not the harness `README.md` template the skill emits) that names two rules:
1. **Template prose must paraphrase generalised principles from `harness-foundations/first-principles.md` and `directives.md` only.** Those two files are the publication-approved primary source; everything else in `harness-foundations/` is secondary and may carry source provenance.
2. **No source IDs (S001…), no `scratch/` content, no direct quotes from `source-notes/` are permitted in any template under `templates/`.** If a phrase is needed, rewrite from principles.

Also add a pre-commit check (or at minimum a manual review checklist) that greps templates for the strings `S001`, `S002`, `S003`, `S004`, `scratch/`, and `source-notes/`. None should appear in `templates/*` files. This is cheap to encode and matches the repo's own Directive 4 ("Encode the fix, not just the memory").

---

### Finding DB-03: Authoring repo (skill definition) vs target repo (skill output) — two artifacts, two evolution cycles
**Category**: Existing Boundary
**Evidence**:
- `source-prompt.md` §4 (lines ~289–305): the **skill package** structure (`engineering-harness-setup-skill/SKILL.md`, `templates/…`) — what lives in this authoring repo and gets installed under `~/.pi/agent/skills/<slug>/`.
- `source-prompt.md` §5 (lines ~308–340): the **target repository** file tree (`HARNESS.md`, `harness/README.md`, `harness/config.json`, `harness/bin/harness.{py,mjs}`, `harness/skills/onboard-agent-session.md`, `harness/state/*`) — what the skill creates when invoked inside *some other* repo.
- `source-prompt.md` §32.1 (`SKILL.md` requirements) vs §9 (root `HARNESS.md` template).
- `source-prompt.md` §35 ("Strong defaults") cleanly separates the two trees.

**Finding**: There are two completely different file trees and two completely different consumers. The **skill package** lives in this repo (and downstream agent runtimes' skill directories) and changes when the skill itself is improved. The **harness package** lives in a target repo and changes when *that* repo's harness evolves. They have independent release cadences and audiences. A template (in this repo) that says "see `docs/plans/002-engineering-harness-setup-skill/source-prompt.md`" or references the path `harness-foundations/…` would leak the authoring repo's internals into every consumer's harness. Conversely, a `SKILL.md` instruction that hard-codes "create `harness/bin/harness.mjs` at `/Users/.../harness-engineering/harness/bin/`" would be nonsense.

**Recommendation**:
- All template files under `templates/` must reference **only target-repo-relative paths**: `HARNESS.md`, `harness/config.json`, `harness/state/friction-log.md`, etc. They must not reference `harness-foundations/`, `docs/plans/`, `scratch/`, or any path specific to this authoring repo.
- The `SKILL.md` is allowed to reference authoring-repo locations only inside an "Authoring notes" section that the running skill *does not materialise into the target repo*. Better: keep authoring notes in a sibling `AUTHORING.md` and have `SKILL.md` contain runtime instructions only.
- Add a checklist item: when a template is updated, verify no path under `templates/` resolves into this authoring repo's tree. Pre-commit grep for `harness-foundations/`, `docs/plans/`, `source-notes/`, `scratch/` inside `templates/*` (a stricter version of the DB-02 check).

---

### Finding DB-04: Skill package file tree vs harness package file tree — name them distinctly to prevent conflation
**Category**: Boundary Risk
**Evidence**:
- `source-prompt.md` §4 names the **skill** tree (`engineering-harness-setup-skill/SKILL.md`, `templates/cli-python-harness.py`, `templates/cli-node-harness.mjs`, etc.).
- `source-prompt.md` §5 names the **harness** tree (`harness/bin/harness.py`, `harness/bin/harness.mjs`, `harness/templates/proof-note.md`, etc.).
- Note the collision risk: both trees contain a `templates/` directory and both contain CLI files. A careless reader can easily think `templates/cli-python-harness.py` (skill side) and `harness/bin/harness.py` (target side) are the same file at different paths. They are not — one is the *source template with placeholders*, the other is the *materialised CLI in the user's repo*.

**Finding**: The brief is internally consistent, but the naming similarity (`templates/` in both trees, "harness" used as both a noun and an adjective) creates a real risk of conflation by future readers — including agents running the skill. If an agent reads the skill and writes `harness/templates/cli-python-harness.py` into the target repo instead of `harness/bin/harness.py`, the harness CLI won't be at the path that `HARNESS.md` and `AGENTS.md` point to.

**Recommendation**:
- Adopt distinct vocabulary in the skill's documentation:
  - **"skill package"** for the tree under `engineering-harness-setup-skill/`.
  - **"harness package"** for the tree the skill creates under `<target-repo>/harness/`.
  - Avoid the bare word "templates" — say "skill templates" (placeholders) vs "harness templates" (proof-note.md, friction-entry.md in the materialised harness).
- Add a one-page diagram to `SKILL.md` (or an `AUTHORING.md` companion) that shows the **input tree** (skill package, with `templates/*.md` containing `{{HARNESS_CLI_INVOCATION}}` placeholders) → **runtime transformation** (placeholder substitution + path mapping) → **output tree** (harness package in target repo). Explicit input/output framing is hard to read as conflated.
- In the file-creation step (source-prompt §4 Step 4 and §5), include a mini "path map" table: every skill-template filename → exact target-repo destination path. This removes ambiguity for the running agent.

---

### Finding DB-05: Public-safe neutral wording is mandatory in every template
**Category**: Existing Boundary
**Evidence**:
- `AGENTS.md:25` ("Public/tracked content must use neutral language such as 'a legacy platform,' 'a private source,' 'the team,' or 'the experiment.'")
- `AGENTS.md:23–24` (no person names, no internal codewords, no employer/client names, no unreleased platform details).
- `harness-foundations/source-notes/notes.md:1–5` already demonstrates the neutral-language pattern in practice.
- `source-prompt.md` §32.3 ("Tone requirements: direct, practical, educational, … Avoid hype.").

**Finding**: The skill is public-facing. Its templates land in arbitrary repos owned by arbitrary teams. Any template that bakes in non-neutral wording — vendor names, internal product codewords, anecdotes from a specific case study — both breaches this repo's publication rules and produces awkward artefacts in target repos. The source-prompt's example brand list ("Copilot, Claude Code, Codex, Cursor, Cline") is fine because those are public products being used as *examples of the agent-harness category*; deeper specifics from `harness-foundations/source-notes/` (S001 legacy platform, S002 case-study repo, etc.) must never bleed through.

**Recommendation**:
- Codify a **template vocabulary checklist** inside `SKILL.md` (and reuse the wording exactly):
  - Allowed neutral nouns: "a legacy platform", "a private source", "the team", "the experiment", "the product", "a target repository".
  - Allowed example brand mentions (used only as category illustrations, not endorsements): the list from `source-prompt.md` §1.1 — Copilot, Claude Code, Codex, Cursor, Cline.
  - Disallowed: any name, codeword, metric, or anecdote sourced from `harness-foundations/source-notes/` or `scratch/`.
- Reuse `harness-foundations/source-notes/notes.md:1–5` as a worked example of acceptable sanitisation, but reference the *principles* it embodies, not its text.
- This boundary is the natural pair of DB-02: DB-02 says "no source tags in templates"; DB-05 says "and when you write replacement prose, here's the vocabulary".

---

### Finding DB-06: Substrate discovery vs overlay installation — the skill legitimately does both, name it explicitly
**Category**: Boundary Risk
**Evidence**:
- `source-prompt.md` §7 (lines ~370–460) — repository inspection / candidate command heuristics → this is **substrate discovery**: find the existing build/test/run commands in the target repo.
- `source-prompt.md` §8 (Steps 1–11) and §9–§17 (HARNESS.md, AGENTS.md patch, harness/ folder, CLI skeletons, onboard guide, friction-log, known-difficulties) → this is **overlay installation**: write a new front door over whatever was discovered.
- `source-prompt.md` §1.3 ("The harness should therefore create a repo-local front door, usually a CLI, and route the agent toward that front door") — the overlay framing.
- `source-prompt.md` §30 ("The harness is a façade over trusted project operations, not a rewrite of the toolchain.") — explicit substrate-vs-overlay framing.
- `harness-foundations/first-principles.md:21` ("The harness can wrap existing scripts and tools rather than reimplementing them; its value is often the focused façade that makes the supported path obvious.")
- The `plan-1a-v2-explore` skill spec referenced in the task framing splits research into a Part 1 (substrate) and Part 2 (overlay).

**Finding**: The skill does two genuinely different jobs in one run: (1) **discover** what the target repo already has (npm scripts, pytest, justfile entries) and (2) **install** a thin, agent-operable overlay over that substrate (HARNESS.md, harness/ CLI, AGENTS.md routing). The brief is consistent about this — it's not a bug — but the two jobs have different failure modes and different evidence standards. Substrate discovery should produce *candidates* with confidence levels, never invent. Overlay installation should produce *files* with placeholders for the candidates the human confirmed. Conflating them produces the worst failure mode: the skill invents a `pnpm build` command that doesn't exist in the target repo and writes it into `harness/config.json` as fact.

**Recommendation**:
- Structure `SKILL.md` and the install-report template around the two stages explicitly: **"Stage A — Substrate discovery"** (outputs a candidate table, requires user confirmation) and **"Stage B — Overlay installation"** (outputs files, only after Stage A is confirmed).
- The candidate table from `source-prompt.md` §8 Step 2 and §21 is the natural Stage A artefact; make it mandatory before any file is written.
- Use the language already in §30 — "façade over trusted project operations" — to remind both human and agent that overlay never replaces substrate.
- Add a Stage A invariant: detected candidates must include a `source` column (which file they came from, e.g., `package.json scripts.build`) and a `confidence` column. Empty/low-confidence rows are explicit gaps, not made-up commands. This matches the source-prompt's repeated rule that "detection produces candidates for user confirmation" (§7).
- This is "name the nuance, don't hide it" rather than "fix a bug". The skill is healthier when the two jobs are visibly two jobs.

---

### Finding DB-07: Contract opportunity — formalize the AGENTS.md ↔ HARNESS.md ↔ config.json routing
**Category**: Contract Opportunity
**Evidence**:
- `source-prompt.md` §8 Step 8 ("Do not duplicate the entire harness manual inside `AGENTS.md`. The root agent file should be a router, not a dumping ground.")
- `source-prompt.md` §9 (HARNESS.md template — authoritative operating rules)
- `source-prompt.md` §10 (AGENTS.md snippet — points to HARNESS.md and the CLI)
- `source-prompt.md` §12 (`harness/config.json` schema — executable command map)
- `source-prompt.md` §11 (`harness/README.md` template references all three)
- `harness-foundations/directives.md:31–37` (Directive 3 "Make the paved path easier than bypassing it" and Directive 6 "Prefer discoverable, agent-operable interfaces") — both depend on agents finding the front door reliably.

**Finding**: Three files form an implicit routing contract:
1. **`AGENTS.md`** is the **router** — short, points agents at `HARNESS.md`.
2. **`HARNESS.md`** is the **source of truth** — operating rules, boundary statement, command map prose.
3. **`harness/config.json`** is the **executable encoding** — the actual commands `harness doctor` reads.

The skill creates all three and assumes they stay in sync, but it never states the contract. A future agent maintaining the harness could legitimately think `AGENTS.md` should grow to contain all harness instructions, or that `HARNESS.md` should hard-code commands instead of pointing at `config.json`. Either drift breaks the model.

**Recommendation**:
- Add a single canonical sentence to `SKILL.md`, `HARNESS.md`, and `harness/README.md`:
  > "AGENTS.md routes. HARNESS.md is the source of truth. `harness/config.json` is the executable encoding. When they disagree, `config.json` wins for commands; `HARNESS.md` wins for rules; `AGENTS.md` only routes."
- This pairs naturally with DB-01's canonical "agent harness drives, engineering harness proves" sentence — both are short, both are reusable, both are easy to lint for.
- The setup-report template (`source-prompt.md` §24) should include a "Routing check" row: AGENTS.md mentions HARNESS.md (yes/no), HARNESS.md points at `harness/config.json` (yes/no), `config.json` parses (yes/no). This is cheap and turns the implicit contract into evidence.
- Bonus: the `doctor` command can encode the routing check directly. That's "Directive 4 — encode the fix" applied to the skill's own contract.

---

### Finding DB-08: Contract opportunity — publish `harness/config.json` as a JSON Schema
**Category**: Contract Opportunity
**Evidence**:
- `source-prompt.md` §12 (full proposed `harness/config.json` shape with `schema_version: 1`, `commands.{install,build,test,lint,format_check,run,smoke}`, `health.{url,timeout_seconds,description}`, `validation.{quick,proof}`, `notes`).
- `source-prompt.md` §13 (Python CLI: `load_config`, `command_config(name)`) and §14 (Node CLI: `loadConfig`, `commandConfig(name)`) — both implementations read the same shape but have no shared schema; drift between the two would be silent.
- `source-prompt.md` §29 ("fast loop vs proof loop") proposes adding `validation.fast` later — i.e., the schema is expected to evolve.
- `source-prompt.md` §32.4 success criteria item: "`doctor` can read config and report configured/unconfigured commands" — depends on the shape.

**Finding**: The brief proposes a schema in prose but never publishes it as machine-readable. Two CLI implementations (Python and Node) parse the same JSON independently. Future tools — `doctor`, IDE tooling, the skill's own validation step, downstream skills that extend the harness — would benefit from a single declarative shape they can validate against. The `schema_version: 1` field hints this was already anticipated.

**Recommendation**:
- Ship `templates/harness-config.schema.json` (JSON Schema draft 2020-12 fragment) alongside the prose `templates/harness-config.json`. Bind the schema with `"$schema"` and `"$id"`. Cover at minimum: `schema_version` (const 1), `commands.*` (each `{command: string, description: string}`), `health.{url: string, timeout_seconds: number, description: string}`, `validation.*` (array of command names referencing keys under `commands`), and `notes` (free-form object).
- Have the Python and Node CLI skeletons each include a `validate-config` subcommand (or fold it into `doctor`) that loads the schema and reports schema errors with a useful next action. This matches Directive 22 ("Diagnostics should prescribe the fix").
- Allow forward-compatible extension: `additionalProperties: true` on the root, `additionalProperties: false` on individual command objects (so unknown command-level keys fail loudly).
- When §29's fast/proof split is added, bump `schema_version` to 2 and document the migration. This makes the "schema evolves" expectation explicit instead of implicit.
- This finding is the cheapest formalisation in this lens and pays back every time a user (or downstream skill) writes a malformed `config.json`.

---

## Cross-lens note for synthesis

The DB lens recommends three artefacts that other lenses (templating, validation, authoring-process) should treat as inputs:
1. The **canonical boundary sentence** (DB-01) — must be byte-identical wherever it appears.
2. The **routing contract sentence** (DB-07) — same property.
3. The **`harness/config.json` JSON Schema** (DB-08) — referenced by the validation lens and by the CLI-skeleton lens.

The DB lens also flags one genuine grey zone the skill must *name rather than resolve*: friction-log and magic-wand workflows are engineering-harness practices even though they are usually surfaced by agent-harness session prompts. `AGENTS.md:19` already accepts this framing — "Practices like magic-wand retrospectives, difficulty ledgers, and self-improving feedback loops are engineering-harness practices when they improve the project/product development loop, even if an agent harness helps collect or enforce them." The skill should reuse that sentence verbatim in `HARNESS.md` so future readers don't try to draw an artificial line through a working workflow.
