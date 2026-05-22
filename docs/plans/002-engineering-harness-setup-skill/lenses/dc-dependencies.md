# Lens DC — Dependency Cartographer

**Lens role**: Map the dependency graph for the yet-to-be-authored `engineering-harness-setup` skill — what it consumes, what consumes it, what it overlaps with, and what external/configuration surfaces it must respect.

**Deliverable framing (reconfirmed)**: portable skill package. Authoring home is this repo (`harness-engineering`). The eventual artifact installs into a target repo's skills folder (e.g. `~/.pi/agent/skills/engineering-harness-setup/`) and operates on arbitrary target repos.

**Inputs surveyed**:

- `docs/plans/002-engineering-harness-setup-skill/source-prompt.md` (sections 1, 4, 5, 7, 8, 12, 13, 14, 26, 30, 32)
- `harness-foundations/{first-principles.md, patterns-that-work.md, directives.md, simple-mode.md}`
- `harness-foundations/source-notes/{notes.md, notes2.md, notes3.md}` (presence only)
- `AGENTS.md`, `justfile`
- `~/.pi/agent/skills/` (full listing, plus full reads of `engineering-harness-v2`, `agent-harness-v2`, `harness-is-the-product-v2`, partial reads of `compound-0-setup`, `compound-1-track`, `plan-1a-v2-explore`)
- Runtime probes: `which python3`, `which node`, `which harness`, `which fs2`

---

### Finding DC-01: Source-prompt principles map 1:1 to `harness-foundations/` — every Section 1.x rule already has a sanctioned prose source

**Evidence**:
- `source-prompt.md:13-141` (Sections 1.1–1.8)
- `harness-foundations/directives.md:7-53` (Directives 1–6)
- `harness-foundations/first-principles.md:5-32` (Principles 1–9, 10)
- `harness-foundations/simple-mode.md:67-141` (Five Rules section)
- `harness-foundations/patterns-that-work.md` (Pattern 1, 10, 11, 12, 13, 22)

**Description**: Every principle the skill must preserve has a public, repo-tracked prose source. Mapping:

| Brief section | Title | Foundation source(s) |
|---|---|---|
| 1.1 Keep the harness boundary clear | directives.md Directive 1; first-principles.md Principles 1–3; simple-mode.md "The idea" |
| 1.2 Productise the development loop | first-principles.md Principle 10 + 58; directives.md Directive 2; simple-mode.md "The idea" |
| 1.3 Make the paved path easier than the shortcut | first-principles.md Principle 19; directives.md Directive 3; simple-mode.md Rule 1 |
| 1.4 Encode the fix, not the memory | first-principles.md Principle 18; directives.md Directive 4; simple-mode.md Rule 2 |
| 1.5 Prefer deterministic validation over agent inference | first-principles.md Principles 27–29, 33; patterns-that-work.md Pattern 7, 18; simple-mode.md Rule 3 |
| 1.6 Treat agent friction as harness feedback | first-principles.md Principles 44–45; directives.md Directive 5; simple-mode.md Rule 4; patterns-that-work.md Pattern 1 |
| 1.7 Ask the magic-wand question | first-principles.md Principle 46; patterns-that-work.md Pattern 10; simple-mode.md Rule 5 |
| 1.8 Keep the initial harness practical / low ceremony | first-principles.md Principle 51 + 55; patterns-that-work.md Pattern 22 |

**Dependency direction**: upstream.

**Why it matters for authoring**: The skill author does NOT need to invent new prose for principles. They can paraphrase or quote-with-attribution. Authoring should explicitly cite these files so this repo (the authoring home) becomes the canonical citation surface — that maximises trust and avoids drift between the skill and the foundations.

**Recommendation**: Add a `SKILL.md` section "Source mapping" (or hidden authoring note) that lists the same table above and a one-liner: *"When this skill is updated, re-verify against `harness-foundations/`."* In the portable installed copy, reduce this to a short pointer line so the skill stays self-contained when installed without the foundations.

---

### Finding DC-02: Verbatim phrases the skill must keep stable across foundations, brief, and emitted templates

**Evidence**:
- `source-prompt.md:25` "The agent harness drives. The engineering harness proves."
- `source-prompt.md:36` `Boot → Interact → Observe → Validate → Improve`
- `source-prompt.md:557-558` (HARNESS.md template) — same two sentences emitted verbatim
- `source-prompt.md:582` — same loop emitted verbatim into HARNESS.md
- `harness-foundations/first-principles.md:21` (Principle 10) — `Boot → Interact → Observe → Validate → Improve`
- `harness-foundations/directives.md:19` — same loop, same arrow style
- `harness-foundations/simple-mode.md:42` — "The agent harness drives. The engineering harness proves."

**Description**: Four phrases must appear verbatim across (a) the foundations, (b) the brief, (c) every template the skill emits, and (d) any onward documentation. Confirmed verbatim:

1. `Boot → Interact → Observe → Validate → Improve` (Unicode arrow `→`, capitalised verbs)
2. `The agent harness drives. The engineering harness proves.` (two sentences, this order)
3. Magic-wand question (see DC-03 — drift exists; flag below)
4. `engineering harness` and `agent harness` as the two layer names (NOT "project harness" / "model harness")

**Cross-check on the task framing's note**: the task prompt warned that the brief might say "engineering harness proves, agent harness drives." The brief actually says, in `source-prompt.md:25`, `The agent harness drives. The engineering harness proves.` — i.e. the *sentence order* is "agent first, engineering second" while the *semantic mapping* is "agent→drives, engineering→proves." Both phrasings the prompt offered preserve the mapping; what matters is that the emitted templates do not swap which side does which.

**Dependency direction**: upstream (foundations → brief → skill → emitted target-repo files).

**Why it matters for authoring**: Wording drift in any emitted template (especially `HARNESS.md` and `AGENTS.md` patch) would split the canonical phrasing across repos and erode the boundary discipline the foundations work hard to establish. The skill is the *replication mechanism* for the verbatim phrases — if the skill drifts, every repo that runs it drifts with it.

**Recommendation**: In the skill's `SKILL.md`, add a "Verbatim Strings" section listing these phrases with an instruction: "Do not paraphrase the following in any emitted file." Have the skill's self-test (or a CI lint in this authoring repo) grep templates for the exact strings before the skill is published.

---

### Finding DC-03: Wording drift on the magic-wand question between foundations and brief — needs reconciliation before authoring

**Evidence**:
- `source-prompt.md:116` (Section 1.7): *"...make the next run **easier, safer, faster, or higher quality**?"*
- `source-prompt.md:636` (HARNESS.md template Rule 5): same — `easier, safer, faster, or higher quality`
- `source-prompt.md:732, 769, 1061-1062, 537`: all use the four-adjective form (with "faster")
- `harness-foundations/simple-mode.md:132` (Rule 5): *"...next run **easier, safer, or higher quality**?"* — three adjectives, **no "faster"**
- `harness-foundations/first-principles.md` (Principle 46) — does not quote the phrase verbatim, so no drift there
- `harness-foundations/patterns-that-work.md:125` — paraphrases without the full adjective list

**Description**: The brief always uses the four-adjective magic-wand question ("easier, safer, faster, or higher quality"). The canonical foundation prose (`simple-mode.md`, the public-facing simple version) uses the three-adjective form ("easier, safer, or higher quality"). The skill emits this question into at least five places (`HARNESS.md`, `AGENTS.md` patch, `harness/state/friction-log.md`, `harness/templates/proof-note.md`, the CLI `magic-wand` subcommand).

**Dependency direction**: upstream (drift between two upstream sources).

**Why it matters for authoring**: If the authoring agent silently copies the brief, every repo that runs the skill will end up with the four-adjective version, which then disagrees with the public `simple-mode.md` post that the foundations point users to. Either the foundation needs updating to add "faster", or the skill needs to emit the three-adjective version. This is a decision that belongs in the clarification round, not in the skill author's head.

**Recommendation**: Surface this as a clarifying question in the round that follows this dossier: *"Magic-wand wording — adopt the brief's four-adjective form (`easier, safer, faster, or higher quality`) and update `simple-mode.md` to match, or adopt the foundations' three-adjective form and update the brief?"* My recommendation: adopt the four-adjective form (loop time / fast feedback is a first-class metric per first-principles.md Principle 17) and patch `simple-mode.md` in the same plan.

---

### Finding DC-04: Reusable lift candidates already in `harness-foundations/` — the skill can paraphrase or import rather than re-author

**Evidence**:
- `harness-foundations/directives.md:7-53` — six directives, each ~80–120 words, already in the exact "principle + one-sentence rationale" shape that suits a `HARNESS.md` Core Rules section
- `harness-foundations/simple-mode.md:90-141` — "The Five Rules" section, already in template-ready prose, very close in structure to brief Section 9 HARNESS.md template Rules 1–5
- `harness-foundations/first-principles.md:34-46` — Principle 10 + 11abc gives a ready-made "Boot is the first proof / initialisation contract / boot-and-validate command" block usable in the onboarding skill (Section 15 of brief)
- `harness-foundations/patterns-that-work.md` Patterns 11, 12, 13 — explorable CLI / structured evidence / fix-forward diagnostics — these are the prose source for brief Section 20 "CLI command contract"

**Description**: The brief asks the skill to emit ~10 template files. At least three of them (HARNESS.md root template, harness/README.md, CLI command contract) can be ~70% built by lifting prose from `simple-mode.md` (Rules 1–5), `directives.md` (Directives 1–6), and `patterns-that-work.md` (Patterns 11–13). The friction-log template can lift Pattern 10's lifecycle vocabulary (capture, bubble, harvest, prioritise, encode, validate). The known-difficulties template can lift first-principles.md Principle 42 wording.

**Dependency direction**: upstream.

**Why it matters for authoring**: This shortens authoring time AND keeps wording aligned. But it also creates a question: should the installed skill copy the prose into its templates (self-contained), or reference back to the foundations URL (always-current but requires network/dependency)?

**Recommendation**: The portable skill package should embed the prose **verbatim** in templates (self-contained — target repos may not have `harness-foundations/` available). The skill's `SKILL.md` should carry a top-line "Provenance" footer pointing to the foundations source(s) so users can verify and so the authoring repo retains traceability. When the foundations change, this skill needs a version bump in lockstep — that is a maintenance dependency the plan must own.

---

### Finding DC-05: CRITICAL overlap analysis with `engineering-harness-v2` — complementary, not a duplicate, but the artifact taxonomy must be made explicit

**Evidence**:
- Full read of `~/.pi/agent/skills/engineering-harness-v2/SKILL.md` (341 lines)
- Full read of `~/.pi/agent/skills/agent-harness-v2/SKILL.md` (307 lines)
- `source-prompt.md` Sections 4 (file tree), 5 (target-repo file tree), 9 (HARNESS.md template)

**Description**: Both skills exist in the user's `~/.pi/agent/skills/` and both touch "the engineering harness." Comparing artifact surface area:

| Artifact / behaviour | `engineering-harness-v2` (installed) | New `engineering-harness-setup` |
|---|---|---|
| Primary output | `docs/project-rules/engineering-harness.md` (single governance doc) | `HARNESS.md` (root) + `harness/` folder tree (~10 files) + CLI |
| Creates a CLI? | No | Yes — Python or Node, user choice (`harness/bin/harness.{py,mjs}`) |
| Creates a config file? | No | Yes — `harness/config.json` with placeholder schema |
| Patches `AGENTS.md`? | No (governance doc is the discovery surface for downstream pipeline skills) | Yes — appends a router section |
| Detects project type / boot command? | Yes — explicit Subagent 1 + Subagent 2 in CREATE mode | Yes — Section 7 of brief (similar heuristics, less formalised) |
| Maturity model (L0–L4)? | Yes — explicit and graded | No — the brief uses "configured / unconfigured" + "proven / unproven" instead |
| Validation mode? | Yes — 3-stage Boot/Interact/Observe with verdicts | Yes — `harness doctor` + `harness validate --dry-run` |
| Seeds Known Difficulties from compound ledger? | Yes — auto-seeds top 10 clusters | No — the brief uses a manual `harness/state/known-difficulties.md` |
| Assumes the engineering substrate already exists? | Yes — "If `boot_candidates` is empty, raise a finding" | No — designed to *create* the first substrate when none exists |
| Idempotent re-run? | Yes (explicit) | Implied via Section 26.1 ("never silently overwrite") |
| Migration advisory for legacy paths? | Yes — handles `agent-harness.md` and `harness.md` fallbacks | No corresponding behaviour specified |

**Verdict**: **Complementary, not duplicate.** The two skills sit at different lifecycle positions:

- `engineering-harness-setup` (NEW) = **bootstrap** when nothing exists. Produces the *executable substrate* (CLI + config + folder).
- `engineering-harness-v2` (EXISTING) = **govern + validate** what exists. Produces a *governance and maturity-tracking doc* that assumes a substrate exists.

But there are real frictions to call out:

1. **Naming overlap** — both call themselves "engineering harness". A repo that runs both ends up with `HARNESS.md` (root), `docs/project-rules/engineering-harness.md`, and `harness/` — three places that look like the front door. Unless explicitly chained, downstream agents will get confused which to read first.
2. **Boot command duplication** — `engineering-harness-v2` records the Boot command in its `## Boot` section; the new skill records it in `harness/config.json`. Without explicit reference between them they can drift.
3. **Difficulty-tracking duplication** — `engineering-harness-v2` auto-seeds from `docs/compound/`; new skill writes to `harness/state/known-difficulties.md` (a different file). See DC-06.

**Dependency direction**: lateral (sibling installed skills) — but treat the relationship as **upstream/downstream** if a target repo runs them in sequence.

**Why it matters for authoring**: The skill must declare its position in the lifecycle. The simplest framing: *"This is the bootstrap step. After the harness exists, `engineering-harness-v2` is the right tool to keep its governance/maturity record fresh."* That sentence needs to be in `SKILL.md`'s "When to use" section.

**Recommendation**:

1. Add to the new skill's `SKILL.md` an explicit "When NOT to use" clause: *"If `docs/project-rules/engineering-harness.md` already exists, run `engineering-harness-v2 --validate` instead — this skill is bootstrap, not maintenance."*
2. Have the new skill, on first run, write a one-line pointer into `docs/project-rules/engineering-harness.md` (creating the file if absent) saying *"See `../../HARNESS.md` for runtime rules; see `harness/config.json` for the current command map."* This makes the two skills hand off cleanly without conflicting writes.
3. Add a clarifying question to the next round: *"Should the new skill stay strictly bootstrap (no overlap with `engineering-harness-v2`), or should it eventually subsume it?"* — this is a roadmap decision, not an authoring decision.

---

### Finding DC-06: Friction-log / known-difficulties surface overlaps with the `compound-*` skill family

**Evidence**:
- `~/.pi/agent/skills/compound-0-setup/SKILL.md` — scaffolds `docs/compound/` with `_buffers/` and `agents/<slug>/<date>/*.retro.md`
- `~/.pi/agent/skills/compound-1-track/SKILL.md` — silent producer; logs friction entries with `kind: difficulty | magic-wand | gift | insight | …`; runs the magic-wand reflex
- `~/.pi/agent/skills/compound-2-bubble/SKILL.md` — session-end consumer; soft-prompts user to triage
- `~/.pi/agent/skills/compound-3-harvest/SKILL.md` — long-horizon dashboard
- `~/.pi/agent/skills/engineering-harness-v2/SKILL.md` Step 4a — already wires `docs/compound/` → `## Known Difficulties` table
- `source-prompt.md:259-265` (Section 17 — friction-log template); `source-prompt.md` Sections 16, 27 — improvement loop

**Description**: A compound-family install already provides:
- a friction-capture mechanism (`compound-1-track`, silent)
- a session-end triage prompt (`compound-2-bubble`)
- a harvest/dashboard view (`compound-3-harvest`)
- automatic surfacing into the governance doc (`engineering-harness-v2` Step 4a)

The new skill proposes:
- `harness/state/friction-log.md` (manually edited improvement backlog)
- `harness/state/known-difficulties.md` (manually edited)
- a `harness/templates/friction-entry.md` template
- a `harness magic-wand` CLI subcommand that prints the prompt

If both are installed in the same repo, friction can end up captured in two unrelated locations (`docs/compound/_buffers/...` vs `harness/state/friction-log.md`) and neither will see the other's entries.

**Dependency direction**: lateral (with possible conflict).

**Why it matters for authoring**: The brief was written without awareness of the `compound-*` family. Left as-is, the new skill creates a second, parallel friction-tracking surface. For a portable skill that may run in repos with or without the compound family, the skill should:

1. **Detect** whether `docs/compound/` exists.
2. If present → the new skill should *route* friction entries into the existing compound mechanism (or at minimum, document the relationship in `HARNESS.md`) rather than creating a competing surface.
3. If absent → the new skill's `friction-log.md` is the simple fallback.

**Recommendation**: Add a clarifying question to the next round: *"In repos that already have `docs/compound/`, should the new skill (a) skip creating `harness/state/friction-log.md` and route to compound, (b) create it as a thin pointer to `docs/compound/`, or (c) create both and accept the duplication?"* Lean toward (b): create a 5-line `friction-log.md` that says *"This repo uses `docs/compound/` for friction tracking — see `compound-2-bubble` at session end."* That preserves the brief's file tree while avoiding the parallel-surface trap.

---

### Finding DC-07: `harness-is-the-product-v2` is a philosophical companion — should be referenced, not duplicated

**Evidence**:
- `~/.pi/agent/skills/harness-is-the-product-v2/SKILL.md:1-143` (full read)
- `source-prompt.md` Section 1.4 ("Encode the fix, not the memory") + Section 32.3 (tone requirements)

**Description**: `harness-is-the-product-v2` is explicitly a *philosophy* skill — it grounds a session on WHY harness work matters and asks the agent to commit to "every difficulty gets tracked / every workaround becomes an infrastructure fix / compounding value gets measured / infrastructure gets better." Its principles (1–5) overlap heavily with `source-prompt.md` Sections 1.1–1.7 but it does not produce executable artifacts — it produces *commitments* and a *state report*.

**Dependency direction**: lateral (sibling), with a sensible chain: *"Run `harness-is-the-product` first to ground; then run `engineering-harness-setup` to build."*

**Why it matters for authoring**: The new skill should not re-litigate the philosophy — that would be a duplicate skill. Instead it should *operate* on the philosophy and reference the companion. If `harness-is-the-product-v2` is installed, the new skill can suggest running it first; if not, the new skill's `SKILL.md` should carry a short "Why this matters" block (3–5 bullets), not a 100-line essay.

**Recommendation**: In the new skill's `SKILL.md` "Principles" section, keep the prose tight (~6 short bullets aligned with brief Section 33's outline) and add a line: *"For deeper grounding, run `harness-is-the-product-v2` first (if installed)."* Do not embed a full philosophy lecture.

---

### Finding DC-08: Downstream consumers — `AGENTS.md` patch is the contract surface; plan-* pipeline skills are auto-discoverers

**Evidence**:
- `source-prompt.md:567-589` (Section 10 — AGENTS.md patch template)
- `source-prompt.md:514-518` (Step 9 — onboarding guide)
- `~/.pi/agent/skills/engineering-harness-v2/SKILL.md:271` — "Pipeline commands (plan-1a, plan-5, plan-6) will auto-discover this file"
- `~/.pi/agent/skills/plan-1a-v2-explore/SKILL.md` header — "Domain-aware v2"; references AGENTS.md routing

**Description**: Identified downstream consumers of the new skill's output:

1. **`AGENTS.md`** in the target repo — patched to point at `HARNESS.md`. This is the primary discovery contract for *all* future agent sessions, regardless of which agent harness drives them.
2. **`harness/skills/onboard-agent-session.md`** — a project-local guide that future agent sessions read at startup. Brief Section 15 specifies the steps.
3. **Future `engineering-harness-v2 --validate` runs** — the validator reads `## Boot`, `## Interact`, `## Observe` from the governance doc. If the new skill mirrors its `harness/config.json` into the governance doc (or vice versa), validation works without rewriting.
4. **`plan-1a-v2-explore` and other v2 pipeline skills** — they read `AGENTS.md` for project routing. As long as the new skill's `AGENTS.md` patch follows the same router pattern, these skills continue to work.
5. **In THIS repo**: future tutorial plans (e.g. plan 003+) and the public README. The skill being authored here is itself a tutorial artifact — the skill package doubles as documentation.

**Dependency direction**: downstream.

**Why it matters for authoring**: The `AGENTS.md` patch is small but it is *the* most important contract emitted by this skill. Get the wording wrong and every downstream agent gets bad routing. The brief's Section 10 template is good but must be defended against merge collisions (see DC-10).

**Recommendation**: Treat `source-prompt.md` Section 10 as the canonical patch. Add a self-test to the authoring repo's CI (a `just` recipe) that runs the skill against a fixture repo and asserts the resulting `AGENTS.md` contains the exact router phrases. The patch should be *additive* (append a new `## Engineering harness` section if `AGENTS.md` exists) rather than rewriting.

---

### Finding DC-09: External dependencies — runtime ambiguity, no library deps, but `harness` is not a global binary on most systems

**Evidence**:
- Runtime probes: `which python3` → `/opt/homebrew/bin/python3`; `which node` → `/opt/homebrew/bin/node`; `which harness` → `/Users/jordanknight/substrate/084-random-enhancements-3/node_modules/.bin/harness` (i.e. a *local* package binary in an unrelated repo)
- `source-prompt.md:991-1095` (Python CLI skeleton — imports only `argparse`, `json`, `os`, `subprocess`, `sys`, `time`, `urllib.request`, `pathlib` — all stdlib)
- `source-prompt.md:1108-1280` (Node CLI skeleton — imports only `node:child_process`, `node:fs`, `node:path`, `node:url` — all stdlib; uses global `fetch`, requires Node 18+)
- `source-prompt.md:213-218` (Section 5 — example invocations include `./harness/bin/harness.py`, `node ./harness/bin/harness.mjs`, `npm run harness -- doctor`, `uv run python harness/bin/harness.py`)
- `source-prompt.md:218` *"The skill should avoid assuming a global binary named `harness` exists."*

**Description**:

- **Runtime requirement**: target repo must have *either* `python3` (3.10+ implied by `from __future__ import annotations` + `dict[str, Any]` syntax in the Python skeleton, `source-prompt.md:1006`) or `node` (18+ for top-level `await` on `process.exit(await main())` and global `fetch`, `source-prompt.md:1271, 1224`).
- **No library deps**: confirmed by reading both skeletons end-to-end. Pure stdlib. This is a deliberate brief choice and a load-bearing one — it means the skill never needs to write a `requirements.txt`, `pyproject.toml`, or `package.json` change.
- **Binary name conflict risk**: a global `harness` binary does exist in at least one other ecosystem (it surfaced via `which harness` on this dev machine — a Node package). The brief already mitigates by saying never assume a global `harness` binary. The skill must emit invocations that always include the path or the runtime: `python3 harness/bin/harness.py`, `node harness/bin/harness.mjs`, or via a `just` recipe / npm script.
- **Optional integrations**: `just`/`make`/`npm`/`uv` wrappers (brief Section 5) are *user-elected*, not required.

**Dependency direction**: external.

**Why it matters for authoring**: The Python version bound matters — `dict[str, Any]` (PEP 585 generic syntax) is 3.9+, and the `from __future__ import annotations` covers earlier interpreters for the annotations themselves, but the dict subscript at runtime only works on 3.9+. The Node 18+ requirement (for global `fetch`) is the load-bearing constraint on the Node path. The skill's `doctor` command should print the detected runtime version so target-repo agents can diagnose env mismatches.

**Recommendation**:

1. Have the skill's `doctor` subcommand print runtime version on first line of output (`Python 3.11.4` or `Node v20.11.0`). Cheap diagnostic; high value.
2. In `SKILL.md` "Prerequisites", document the version floors explicitly: **Python ≥ 3.10** (recommended) or **Node ≥ 18.0**.
3. Add a clarification: *"When neither runtime is available in the target repo, what should the skill do — install a wrapper, refuse, or write the templates without a runnable CLI?"* — recommended answer: write templates with placeholders, mark the CLI as `unconfigured`, log it as the first friction entry. The harness should be honest about not being runnable.

---

### Finding DC-10: Configuration & placeholder surface; backward-compatibility risk for repos that already have `HARNESS.md`, `harness/`, or `AGENTS.md`

**Evidence**:
- `source-prompt.md:842-906` (Section 12 — `harness/config.json` schema, including the 7 named placeholders from the task brief)
- `source-prompt.md` Section 32.2 — placeholder list (`{{HARNESS_CLI_INVOCATION}}`, `{{python_or_node}}`, `{{BUILD_COMMAND}}`, `{{TEST_COMMAND}}`, `{{RUN_COMMAND}}`, `{{HEALTH_URL}}`, `{{SMOKE_COMMAND}}`)
- `source-prompt.md` Step 4 (lines 462-471) — "If files already exist: never silently overwrite; read and merge where appropriate; create a backup only if the environment and user conventions support it; otherwise show a patch-style summary before modifying."
- `source-prompt.md` Section 26.1 — file modification safety contract

**Description**:

**Placeholder surface (must all be substituted before file write)**: 7 named placeholders defined in Section 32.2, plus 4 derived ones I found in the templates:

| Placeholder | Used in template(s) | Substitution source |
|---|---|---|
| `{{HARNESS_CLI_INVOCATION}}` | HARNESS.md, AGENTS.md patch, harness/README.md, onboard-agent-session.md | derived from `{{python_or_node}}` choice |
| `{{python_or_node}}` | harness/config.json | user decision (brief Section 6.1, Q1) |
| `{{BUILD_COMMAND}}` | harness/config.json | inspection + user confirmation |
| `{{TEST_COMMAND}}` | harness/config.json | inspection + user confirmation |
| `{{RUN_COMMAND}}` | harness/config.json | inspection + user confirmation |
| `{{HEALTH_URL}}` | harness/config.json | user decision (brief Section 6.1, Q4) |
| `{{SMOKE_COMMAND}}` | harness/config.json | user decision |
| `{{LINT_COMMAND}}` *(derived)* | harness/config.json (Section 12 line ~872) | inspection (Section 7.2) |
| `{{FORMAT_CHECK_COMMAND}}` *(derived)* | harness/config.json | inspection |
| `{{harness_cli_file}}` *(derived)* | install-report template (Section 24) | derived from `{{python_or_node}}` choice |

Section 32.2 lists 7 but the templates use ~10. **Authoring drift risk** — the authoring agent might substitute only the listed 7 and leave the derived placeholders as `{{LINT_COMMAND}}` literals in the emitted config.

**Backward-compatibility matrix (target repo may already contain…):**

| Existing artifact | Brief behaviour | Risk |
|---|---|---|
| `AGENTS.md` exists | Section 8 Step 8 / Section 26.1: append; never silently overwrite; show patch summary | Low if router section is appended cleanly |
| `HARNESS.md` exists | Step 4: read first; don't overwrite; merge or show patch | Medium — what counts as "merge" is undefined |
| `harness/` directory exists | Step 4: same merge rule | Medium — file-by-file decision is needed |
| `harness/config.json` exists with conflicting schema | Not explicitly addressed | High — silent overwrite would lose the user's existing command map |
| Global `harness` binary on PATH | Brief Section 5: avoid assuming it exists | Low — already mitigated by Section 5 |
| `docs/project-rules/engineering-harness.md` exists (from `engineering-harness-v2`) | Not explicitly addressed | Medium — see DC-05 |
| `docs/compound/` exists | Not explicitly addressed | Medium — see DC-06 |

**Dependency direction**: external (config) + downstream/lateral (back-compat with prior installs).

**Why it matters for authoring**: The brief's safety guardrails (Section 26) are good general-purpose ("never silently overwrite", "show patch summary first"), but they leave the schema-merge problem unresolved. If a user re-runs the skill (e.g. to add a new command), the skill must:

1. Detect existing `harness/config.json`.
2. Diff schema against the template (note: schema_version is in the template at `"schema_version": 1`).
3. Merge command map (preserving user values), upgrade schema if needed.
4. Never silently clear a populated command field.

**Recommendation**:

1. Resolve the placeholder count drift — either expand Section 32.2 to list all ~10 placeholders, or shrink the templates to only the 7 listed.
2. Add a "Re-run safety" subsection to the skill: explicit behaviour for each of the 7 existing-artifact cases in the matrix above. Default policy: **merge command map; preserve user values; surface diffs for user approval; never delete a populated value automatically.**
3. Add a clarifying question: *"On re-run with an existing `harness/config.json`, should the skill (a) refuse and direct user to `engineering-harness-v2 --validate`, (b) merge-and-confirm, or (c) treat re-run as `doctor`-only?"* — recommended (b).
4. The skill should write a tiny `harness/.skill-version` file or include a top-line comment in `config.json` recording which version of the skill generated which file, enabling future migration logic.

---

### Finding DC-11 (bonus): External research gaps — install-path conventions and what counts as a "skill package" portable artifact

**Evidence**:
- `source-prompt.md:175-189` (Section 4 — skill package structure, with the caveat "If the skill runtime supports multi-file skills, keep the templates in separate files. If the skill runtime only supports a single instruction file, embed the templates inside `SKILL.md`")
- `~/.pi/agent/skills/*/SKILL.md` — every existing installed skill in this user's pi runtime uses a single `SKILL.md` (no `templates/` subdirectory). Sampled 5 skills; none has additional files.
- Task framing: "installable into a target repo (e.g., `~/.pi/agent/skills/engineering-harness-setup/`)"

**Description**: Two things are not knowable from the brief alone:

1. **Does pi's skill runtime support multi-file skills?** The brief proposes a `templates/` subfolder. Every installed pi skill I sampled is a *single* `SKILL.md`. If pi's runtime only resolves `SKILL.md`, the templates must be embedded inline (the brief's fallback path). If multi-file is supported, the brief's preferred path works.
2. **What does "install into `~/.pi/agent/skills/engineering-harness-setup/`" mean operationally?** Is there an installer, or is it a manual git-clone / symlink? No installer convention surfaced from the file system probe.

These are *real* external dependencies the skill author can't resolve from reading the brief.

**Dependency direction**: external (runtime documentation / pi installer conventions).

**Why it matters for authoring**: The skill's directory layout is constrained by the runtime that installs it. If pi only supports single-file skills, the brief's `templates/` subfolder convention won't survive installation, and the skill must inline-encode all templates with explicit "materialise on invocation" instructions.

**Recommendation**: Surface as a clarifying question: *"Does the pi skill runtime support multi-file skills (`SKILL.md` + sibling files), or must all templates be embedded inside `SKILL.md` with instructions to materialise them at runtime?"* If the answer is single-file: the skill is one large `SKILL.md` with all 10 templates inlined inside fenced code blocks, plus a short "materialisation procedure" the running agent follows. If multi-file: the brief's Section 4 layout is correct. This is the single most important install-portability decision in the whole skill.

---

## Summary

**Findings count**: 11 (DC-01 through DC-11; DC-11 is a bonus on install-path conventions).

**`engineering-harness-v2` overlap verdict**: **complementary, not duplicate.** The new skill is bootstrap (creates the substrate: CLI + `HARNESS.md` + `harness/`); `engineering-harness-v2` is governance + maturity validation (creates `docs/project-rules/engineering-harness.md` on top of an existing substrate). The two skills should chain: new skill first (when nothing exists), then `engineering-harness-v2 --validate` for ongoing health. The skill's `SKILL.md` must explicitly declare this lifecycle position to prevent confusion when both are installed in the same repo. Three real frictions to call out in the next clarification round: (1) naming overlap — three places look like "the harness" front door; (2) DC-06's friction-log duplication with the `compound-*` family; (3) DC-10's silent-overwrite risk on re-run.

**Blockers** (must answer before the skill is authored):

1. **DC-03**: Magic-wand wording drift — brief has four adjectives, foundations have three. Pick one.
2. **DC-06**: Friction-log surface conflict with `compound-*` family — route or duplicate?
3. **DC-10**: Placeholder count drift (7 named vs ~10 used) and existing-config merge policy.
4. **DC-11**: Single-file vs multi-file skill package — pi runtime constraint must be confirmed before file layout is finalised.

None of these block this dossier; all of them should be batched into the next clarification round.
