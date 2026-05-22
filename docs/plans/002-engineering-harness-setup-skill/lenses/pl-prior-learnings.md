# Lens PL — Prior Learnings Scout

**Skill under design**: Engineering Harness Setup (portable skill package)
**Source-prompt**: `docs/plans/002-engineering-harness-setup-skill/source-prompt.md` (2236 lines)
**Lens role**: Mine prior learnings — discoveries, gotchas, decisions, warnings — that the new skill MUST respect.
**Scan coverage**:
- `docs/plans/001-backpressure-harness-foundations/research-dossier.md` (488L) — only prior plan.
- `harness-foundations/source-notes/notes.md`, `notes2.md`, `notes3.md` (full).
- `harness-foundations/first-principles.md` (58 numbered principles), `directives.md`, `patterns-that-work.md` (P1–P22 + "Watch for:" lines).
- `AGENTS.md` (repo-level source-handling and maintenance rules).
- Skill source-prompt (`source-prompt.md`) for grounding intent.
- No `docs/compound/` system in this repo — skipped per scope instructions.

The findings below name learnings that already exist in this repo (foundation principles, source-handling rules, prior dossier discoveries, pattern warnings) and translate each one into a concrete constraint or template behaviour for the new skill package.

---

### Finding PL-01: Setup must be idempotent — re-runs are normal

**Source**: `harness-foundations/first-principles.md:167` (F37 "Cleanup must be idempotent"); reinforced by `harness-foundations/source-notes/notes2.md:113` (N2 §14 "Idempotence, reversibility, and opt-out are harness qualities") and source-prompt §26.1 ("Do not overwrite existing files without reading them first").
**Type**: constraint
**Original discovery**: "Setup and cleanup paths should be safe to rerun because repeated runs are normal harness behaviour." Notes2 strengthens this: setup safe to rerun, migration reversible, repos able to opt out — properties that "make the harness feel trustworthy rather than invasive."
**Why this matters for THIS skill**: A setup skill is *exactly* the kind of thing that will be re-run — by a user who interrupted setup, by an agent retrying after a failure, by a teammate sanity-checking what was created. If the skill's second invocation clobbers a hand-edited `HARNESS.md`, overwrites a friction log with content, or duplicates an `AGENTS.md` patch, it violates the very principle it is installing.
**Action for the new skill**:
- Every file-writing step in `SKILL.md` MUST be guarded by a "read first, then merge or skip" rule. Document this guard in the SKILL flow and in the install-report template.
- `AGENTS.md` patching: search for the harness section heading; if present, refresh in place, don't re-append.
- `harness/config.json`: if it exists, load it, treat existing commands as authoritative, and only fill *unset* slots unless the user confirms overwrite.
- `harness/state/friction-log.md` and `known-difficulties.md`: never overwrite content; only ensure the template scaffolding exists.
- Add an explicit "re-run safety" check to the install-report ("Detected existing harness; merged X, preserved Y, asked about Z").

---

### Finding PL-02: Final report must not say "done" because the skill ran

**Source**: `harness-foundations/first-principles.md:131` (F28 "Agent confidence is not completion evidence") and `:163` (F36 "Clean state is part of done"); echoed in source-prompt §26.3 "Claim safety" ("Never claim the product is validated unless commands actually ran and passed"); also `docs/plans/001-backpressure-harness-foundations/research-dossier.md` PL-02 ("Validation must produce a verdict, not vibes").
**Type**: constraint
**Original discovery**: "The harness must close the verification gap between what the agent claims and what the system actually does"; "A session is not complete unless build, tests, progress, artefacts, and startup are all left in a usable state."
**Why this matters for THIS skill**: The setup skill creates a CLI named `harness` and templates named `proof-note.md` — i.e. it is *teaching* the rule that confidence ≠ evidence. If its own install report ends with "✅ Setup complete!" while build/test/run were dry-run only and health is unconfigured, the skill contradicts its own teaching on the very first interaction with the user.
**Action for the new skill**:
- The `install-report.md` template must use explicit verdict columns: `configured | unconfigured`, `pass | fail | dry-run | not-run`, `proven | unproven`. No bare "complete" / "success" verbs at the report root.
- The skill's exit summary should state: created files, commands configured, commands run, what is *proven*, what is *unproven*, what next harness improvement is recommended — in that order, in the source-prompt §24 structure.
- Forbid checkmark or "✅" language in templates unless tied to a specific command exit code.
- If only `--help` and `doctor` ran (the safe default), the report must say "harness scaffold proven; product behaviour not proven."

---

### Finding PL-03: Dogfood — the skill must run the harness it just installed

**Source**: `harness-foundations/first-principles.md:117` (F25 "Dogfood the supported surface"); `harness-foundations/source-notes/notes.md:189`.
**Type**: precedent
**Original discovery**: "Bypassing the harness hides exactly the UX gaps that humans and agents need the harness to reveal."
**Why this matters for THIS skill**: The skill creates a CLI front door, then has a choice for its own validation step: (a) run shell commands directly, or (b) call the freshly-created `harness` CLI. If the skill validates via raw `npm test` instead of `harness test`, it has installed a paved path it does not itself use, and the very first session demonstrates that the shortcut wins.
**Action for the new skill**:
- Step 10 "Validate the setup" (source-prompt §8 Step 10) MUST invoke the new CLI by its chosen invocation string (`python harness/bin/harness.py …` or `node harness/bin/harness.mjs …`), not the underlying tools.
- The install-report should record the exact invocation used, so future sessions copy that pattern.
- If the chosen CLI cannot run (Python missing, Node missing, etc.), that is a finding, not a fallback — report it honestly and stop, do not silently bypass to raw commands.

---

### Finding PL-04: Templates must never hard-code private terminology, names, or examples

**Source**: `AGENTS.md:18-24` (source-handling block); `harness-foundations/source-notes/notes.md:218-244` (S001–S004 Handling notes); `notes2.md:188-205` (N2-S001..N2-S007 Handling notes); `notes3.md:285-298` (M001–M003 Handling notes).
**Type**: constraint
**Original discovery**: Every registered source has a "Handling" entry that forbids: identifying names, internal codewords, person names, company names, direct private quotes, exact private metrics, customer-specific examples, local paths, internal plan numbers, project-specific commands, source excerpts, raw paths, generated sample identifiers. Public/tracked content must use neutral language ("a legacy platform", "a private source", "the team", "the experiment").
**Why this matters for THIS skill**: The skill ships a *portable skill package* — its templates will be copied into other repositories that this repo's authors don't control. Any private-source language baked into a template becomes a publication-boundary leak each time the skill runs elsewhere. Worse: a template that references a private project name or a private metric will not just leak inside this repo — it leaks into every downstream repo that adopts the skill.
**Action for the new skill**:
- Every template in `templates/` (root-HARNESS.md, agents-md-snippet.md, harness-README.md, harness-config.json, known-difficulties.md, friction-log.md, proof-note.md, onboard-agent-session.md, install-report.md) must use only neutral language and example values: "the product", "the team", "the next session", `{{HARNESS_CLI_INVOCATION}}`, `{{BUILD_COMMAND}}`.
- No worked example in templates may name a real company, person, codeword, customer, or product. Examples should use generic stack names (Node, Python, Go, .NET) or stand-ins ("a legacy platform", "the example service").
- Add a `SKILL.md` author-rule section: "Templates ship to other repos. They must be safe to publish standalone."
- Add a lightweight self-check item to the install-report or the SKILL's own pre-publish list: a grep for known-private-terminology placeholders in the templates folder before any release.

---

### Finding PL-05: Skill must respect `scratch/` and `git status` boundary

**Source**: `AGENTS.md:18-25` ("`scratch/` is a private research workspace and is gitignored… Before committing, run `git status --short` and verify that `scratch/` remains ignored").
**Type**: constraint
**Original discovery**: Raw sources, notes, excerpts, evidence drafts live only in gitignored `scratch/`. Public/tracked content must be sanitised. Pre-commit verification is part of the workflow.
**Why this matters for THIS skill**: The setup skill operates on a target repo's working tree and is invoked by an agent that may or may not respect gitignore semantics. Two specific risks:
1. The skill could be invoked inside *this* repo (harness-engineering) by an author dogfooding it, and it would create `harness/` at the repo root — a tracked location — possibly committing template scaffolding that conflicts with the existing foundations content.
2. The skill could be tempted to write logs, scratch notes, or "session memory" into the target repo's working tree without regard for that repo's gitignore conventions.
**Action for the new skill**:
- `harness/proofs/`, `harness/state/friction-log.md`, `harness/state/known-difficulties.md`: source-prompt §6.2 already asks whether `harness/proofs/` should be committed or ignored. Make this decision explicit in the SKILL flow, default to *ask the user*, and propose `.gitignore` entries when "ignored" is chosen.
- Never write to a path containing `scratch/` or `.git/`.
- The SKILL.md "non-goals" section must include: "Do not write transient logs, scratch notes, or session memory into the target repo — friction belongs in the structured friction log only."
- The install-report's "Created or updated" section is the only file list the skill produces. No silent side-files.

---

### Finding PL-06: This skill changes the public publication boundary — AGENTS.md may need updating

**Source**: `AGENTS.md:37-39` ("Update this file whenever the repo's intent, publication boundary, or research workflow changes.").
**Type**: decision
**Original discovery**: AGENTS.md is the canonical statement of repo intent, source-handling, and research workflow. Its maintenance note explicitly requires updates when those change.
**Why this matters for THIS skill**: Until now this repo has been a *foundations and tutorial project* — public-safe synthesis of principles. Shipping a `engineering-harness-setup-skill/` package means the repo is also now a *distribution surface* for an installable artefact. That is a publication-boundary change. The skill itself ships templates that other repos will copy, which means the repo's intent expands from "explain harness engineering" to "explain *and ship runnable scaffolding for* harness engineering."
**Action for the new skill**:
- Plan synthesis (parent orchestrator) should treat "does AGENTS.md need a paragraph?" as a decision point, not an afterthought. Candidate paragraph: name the `engineering-harness-setup-skill/` package, state that it ships templates intended for other repos, and reaffirm the "no private terminology in templates" rule.
- If the answer is yes, the AGENTS.md edit is a *deliverable of the skill-authoring plan*, not a follow-up.

---

### Finding PL-07: Not "more gates everywhere" — anti-bloat is a first-class requirement

**Source**: `docs/plans/001-backpressure-harness-foundations/research-dossier.md` Critical Finding 03 ("Good backpressure is not more gates everywhere"); `patterns-that-work.md` P4 ("Watch for: instruction bloat, lost-in-the-middle effects, duplicated rules, and old warnings that nobody knows how to remove") and P22 ("Watch for: treating every accumulated lesson as permanent law. A harness should compound value, not compound clutter").
**Type**: warning
**Original discovery**: A gate can become harmful if slow, vague, flaky, overbroad, or placed in the wrong loop. Instruction files become a source of context pressure and contradiction. Every accumulated lesson is not permanent law.
**Why this matters for THIS skill**: A setup skill is naturally prone to enthusiasm — every template wants to grow, every rule wants to be in `HARNESS.md`, every detected file wants its own CLI subcommand. The 001 dossier explicitly recommended *one* new pattern and *one* sentence in a directive, not a sweeping rewrite. The setup skill should follow the same discipline: ship the *minimum useful* harness, with explicit improvement candidates left as `next_action`, not pre-encoded.
**Action for the new skill**:
- `HARNESS.md` template must stay short enough to fit a single fresh-agent context read (source-prompt §1.8 already says "minimum useful version"). Add a max-length guideline in `SKILL.md` author notes (e.g. ~150 lines).
- Resist auto-adding CLI subcommands beyond the source-prompt §6 set (doctor, build, test, lint, format_check, run, smoke, health, validate, onboard, magic-wand). Anything else is `next_action`, not v1 surface.
- The skill must *not* pre-seed `known-difficulties.md` or `friction-log.md` with placeholder lessons that look like real entries. Empty-with-template is correct; pre-filled-with-generic-warnings is bloat.
- Add an explicit "non-goal" in `SKILL.md`: "Do not encode every preference as a gate. Encode repeated pain, material risk, or clear team decisions." (Lift wording from P9.)

---

### Finding PL-08: Don't measure by file count — measure by failures caught

**Source**: `patterns-that-work.md` P21 ("Watch for: measuring harness value by the number of files or checks instead of whether it catches meaningful failures"); first-principles.md F49 "Measure encoded improvement, not activity volume."
**Type**: warning
**Original discovery**: "A harness is not good because it exists. It is good when it catches known risks and improves future runs."
**Why this matters for THIS skill**: The default success summary for a setup skill is the file tree it created — and source-prompt §24 ("Final setup report template") leads with `Created or updated:` followed by a 10-item file list. That list is honest provenance but it is also a trap: a reader who skims will see a long bullet list and conclude the harness is "real". The report must immediately follow the file list with a verdict about what those files *prove*, not just that they exist.
**Action for the new skill**:
- Re-shape `install-report.md` so the *first* substantive section after "Created" is "What is proven / What remains unproven / Recommended next harness improvement" — not the file inventory.
- In the configured-commands table, add a `verified` column distinct from `configured`. A command can be configured (encoded in `config.json`) without yet being verified (actually executed successfully).
- The skill's own success criterion (source-prompt §23) reads "files exist + CLI prints help + doctor reports config." That is acceptable as scaffolding proof but must be labelled as scaffolding proof, not product proof.

---

### Finding PL-09: Verdicts not vibes — every CLI command must produce a verdict

**Source**: `docs/plans/001-backpressure-harness-foundations/research-dossier.md` PL-02 ("Validation needs verdicts, not vibes"); first-principles.md F15 ("Validation must produce a verdict"), F21 ("The CLI is the API"), F22 ("Diagnostics should prescribe the fix").
**Type**: precedent
**Original discovery**: A red signal without a next step is friction, not good backpressure. Every CLI must say what it checked, whether it passed, what failed, and what to do next.
**Why this matters for THIS skill**: The Python and Node CLI skeletons in source-prompt §13 and §14 already implement a `print_result(payload)` shape with `status`, `messages`, `next_action`. The risk is that template authors will copy the skeleton but soften the rule — adding stdout text that doesn't fit the envelope, or letting commands exit 0 with vague "ok" messages.
**Action for the new skill**:
- `harness/templates/cli-command-contract.md` (source-prompt §20) must enumerate the verdict envelope: `status ∈ {pass, fail, degraded, dry-run, unconfigured, running}`, `messages: list`, `next_action: string | null`.
- Both CLI skeletons should treat `unconfigured` as a *first-class verdict* with exit code 2 — not a silent skip and not an error. (Skeletons in source-prompt already do this; the SKILL should call this out as a deliberate contract.)
- Add a CLI-contract author-rule: "If a command cannot prescribe a `next_action` on failure, the diagnostic is incomplete and should be improved before shipping." (P13 Watch for: "dumping raw stack traces without guidance.")

---

### Finding PL-10: Project-side framing — avoid "agent harness" / runtime language drift

**Source**: `docs/plans/001-backpressure-harness-foundations/research-dossier.md` Critical Finding 02 ("Backpressure must stay project-side") and PL-01 ("Product proof belongs to the project-side loop"); `AGENTS.md` "Harness layer definitions" block.
**Type**: constraint
**Original discovery**: The boundary between *engineering harness* (project-side, proves the product) and *agent harness* (runtime around the model, drives the model) is the most-protected concept in the repo. Public agent writing constantly blurs it; this repo deliberately does not.
**Why this matters for THIS skill**: The setup skill is invoked *from inside* an agent harness (Claude Code, Codex, Cursor, pi, etc.), so the natural framing for an author is "the agent does this, then the agent does that." Template language can subtly drift into agent-runtime vocabulary — talking about "agent state," "session memory," "permissions" — when what it should say is "harness state lives in the repo," "the next session reads the repo," "command execution requires user permission."
**Action for the new skill**:
- The `root-HARNESS.md` template's opening lines must restate the boundary (source-prompt §9 already does this — verify it survives).
- All templates must use language like "the next session", "fresh human or agent", "the repo", "harness state" — not "the agent's memory" or "the agent's context".
- `AGENTS.md` snippet template must route the agent to `HARNESS.md` *as project-side substrate*, not as agent configuration.
- Avoid the phrase "agent backpressure" anywhere in templates; use "harness feedback" or "structural feedback" (per 001 PL-01 action).

---

### Finding PL-11: Friction-loop hygiene — backlog, not diary

**Source**: `harness-foundations/source-notes/notes2.md:64-81` (N2 §7 "Retrospectives need a lifecycle", §8 "Silent capture"); `patterns-that-work.md` P10 ("Watch for: retrospectives becoming diaries"); first-principles.md F48 ("Ledgers are improvement backlogs, not diaries"), F51 ("The improvement system must stay low ceremony"); source-prompt §27.
**Type**: precedent
**Original discovery**: "A retrospective without a closing workflow is just another log file." Capture should be silent, bubble at natural pauses, harvest is on-demand. Recurrence × severity × age are the curation axes. Auto-applying fixes is risky; staged review preserves trust.
**Why this matters for THIS skill**: `harness/state/friction-log.md` and the magic-wand prompt are the load-bearing improvement primitives the skill installs. If the template encourages free-form prose entries, or if the skill itself writes *every* setup observation into the log unprompted, the log will become a diary on day one and be ignored thereafter.
**Action for the new skill**:
- `friction-log.md` template must lead with: "This is an improvement backlog, not a diary" — source-prompt §17 already has this; preserve verbatim.
- Entry template must enforce structure: severity (blocker/degrading/annoying), recurrence (first-seen/repeated/frequent), layer (instructions/tools/environment/state/feedback/validation/product), candidate encoded fix. (Source-prompt §17 already encodes this; the SKILL must preserve the structured-only contract.)
- At setup end, the skill should propose *at most one* concrete improvement candidate for the user to review, and ask whether to record it. Not "I noticed seven issues."
- `SKILL.md` author-rule: "Do not auto-apply magic-wand suggestions. Staged review is the contract."

---

### Finding PL-12: Proof levels — don't overclaim what build/test/help actually prove

**Source**: `docs/plans/001-backpressure-harness-foundations/research-dossier.md` PL-04 ("Proof levels are the measurement bridge"); `harness-foundations/source-notes/notes3.md:101-114` (L0–L6 proof ladder).
**Type**: precedent
**Original discovery**: Proof levels distinguish L0 claim, L1 command output, L2 static/build/test, L3 runtime interaction, L4 interaction + side effect, L5 reproducible clean rerun, L6 production/customer outcome. For AI-assisted product-behaviour claims, at least L3 or L4 is favoured.
**Why this matters for THIS skill**: The default safe setup path produces L1 evidence (CLI ran, doctor reported config). Build/test, if executed, produce L2. Run/health/smoke, if executed, produce L3. The setup skill must not let an L1 outcome read like an L3 outcome — especially in the install-report and especially when the user has only approved dry-runs.
**Action for the new skill**:
- The install-report template should optionally tag verified items with proof level (`L1`, `L2`, `L3`) so the report is honest about what was *actually* proven by each command. Even a single-line legend ("doctor = L1, build/test = L2, health/smoke = L3") meaningfully shifts the framing.
- The "What is proven" section must distinguish "harness scaffold runs" (L1) from "product builds and tests pass" (L2) from "product boots and responds to a real interaction" (L3).
- Forbid generic claims like "the product is validated" in any template language. Use "the build command exited 0" / "the test command exited 0" / "the health URL responded with HTTP 200 in Xms" instead.

---

### Finding PL-13: Plan-directory convention — `docs/plans/NNN-slug/` is the established location

**Source**: existence and shape of `docs/plans/001-backpressure-harness-foundations/research-dossier.md`; this plan is `docs/plans/002-engineering-harness-setup-skill/source-prompt.md`.
**Type**: precedent
**Original discovery**: The 001 plan established `docs/plans/NNN-slug/research-dossier.md` as the location, used `Mode: Pre-Plan`, and reported `Findings: 60 subagent findings synthesised from 6 focused research passes`.
**Why this matters for THIS skill**: This is *meta-precedent* — it doesn't constrain the skill's deliverables directly, it constrains the plan that produces the skill. Two specific implications: (a) the parent orchestrator should write the synthesis to `docs/plans/002-engineering-harness-setup-skill/research-dossier.md`, mirroring the 001 layout exactly; (b) the 8-lens parallel research is an *evolution* of the 6-pass approach in 001, not a replacement — the synthesis format (Executive Summary, How It Currently Works, Source Analysis, Working Definition, Prior Learnings, Critical Discoveries, Candidate Foundation Changes / in this case Candidate Skill Components, Recommendations, External Research Opportunities, Appendix: File Inventory) is a known working template.
**Action for the new skill (and for the parent synthesis)**:
- Synthesis output path: `docs/plans/002-engineering-harness-setup-skill/research-dossier.md` (matches 001).
- Reuse the 001 dossier's section layout for the 002 synthesis. Sections like "Modification Considerations: Safe to Modify / Modify with Caution / Danger Zones" map well onto setup-skill decisions (what the skill freely creates vs. what it touches with caution vs. what it must never touch).
- Lens outputs live under `docs/plans/002-engineering-harness-setup-skill/lenses/<lens>.md` (current location of this file) and feed the dossier, not the skill package directly.

---

### Finding PL-14: Brownfield reality — partial setup is the norm, not the exception

**Source**: source-prompt §31 ("Brownfield and partial setup behaviour"); `harness-foundations/source-notes/notes.md:75-79` ("Accessibility beats rewrite-or-freeze. For difficult legacy systems, the first move is often to make the system accessible to experimentation rather than to rewrite it"); `docs/plans/001-backpressure-harness-foundations/research-dossier.md` Modification Considerations.
**Type**: precedent
**Original discovery**: "Some products, especially brownfield systems, must be changed before they can be operated effectively through a harness" (first-principles F6 "Harnessability is a property of the codebase"). The 001 dossier explicitly carved out "Safe to Modify / Modify with Caution / Danger Zones" rather than treating the foundation as a green field.
**Why this matters for THIS skill**: A setup skill that only works on clean greenfield repos is useless. Most real targets will have *some* existing harness-shaped artefact: a `Makefile`, a `Justfile`, a `package.json` with scattered scripts, an existing `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, or a partial `harness/` left by an earlier attempt. The skill's value is making the existing setup *legible*, not pretending the existing setup isn't there.
**Action for the new skill**:
- Repository inspection (source-prompt §7) is not just for choosing commands — it is also for detecting partial existing harness state. Add explicit checks for: existing `HARNESS.md`, existing `harness/` directory, existing `AGENTS.md` / `CLAUDE.md` / `.cursorrules`, existing `Makefile` / `Justfile`.
- For each detected artefact, the skill must propose merge/route rather than overwrite. Specifically: an existing `Makefile` or `Justfile` becomes the *wrapped target* of harness commands, not a competitor.
- The install-report must include a "Pre-existing artefacts detected and preserved" section when relevant — this builds trust and demonstrates idempotence (PL-01) in the same report.
- The "Recommended next harness improvement" should bias toward filling the *visible gap* in the existing setup (e.g. "Makefile has build and test but no boot; encode a `run` command next") rather than imposing a uniform template.

---

### Finding PL-15: Let it cook — the skill itself is iterative

**Source**: `harness-foundations/first-principles.md` F8 "Harness engineering is iterative — let it cook"; `docs/plans/001-backpressure-harness-foundations/research-dossier.md` Recommendations ("Start with a small source-note addition… Add one pattern before adding a new first principle"); evolution from 6-pass (plan 001) to 8-lens (plan 002) research itself.
**Type**: decision
**Original discovery**: "The right harness emerges through repeated runs, observed failures, and encoded improvements, not from a finished playbook." 001 deliberately recommended *minimum* foundation changes rather than a sweeping rewrite.
**Why this matters for THIS skill**: The setup skill is a *first version* of a skill that will itself accumulate friction, magic-wand requests, and improvement candidates from real use. Templates that try to anticipate every future need become bloat (PL-07). The right v1 is the smallest skill that installs a coherent loop and a friction-capture mechanism so v2 can be designed from real feedback rather than imagined feedback.
**Action for the new skill**:
- `SKILL.md` should explicitly state "This skill installs a first useful version. Subsequent harness improvements come from real use, not from this template." (Wording aligns with source-prompt §35 and §37.)
- The skill should ship a friction-log entry *about itself* in its own development, capturing what the skill author found awkward — this is the dogfood loop (PL-03) applied to the skill itself.
- Resist scope creep into adjacent skills (a separate "Encode Magic-Wand Suggestion" skill, a separate "Onboard Agent Session" skill) as part of v1. Templates left for future skills to build on are sufficient.
- The skill's success criterion should explicitly include "future sessions reported friction back into `harness/state/friction-log.md`" as the deferred-validation signal — but that signal arrives later, not at setup time.

---

## Summary

The new Engineering Harness Setup skill enters a repo whose foundations already contain a remarkable amount of relevant guidance, and whose prior plan (001 backpressure) modelled the disciplined "small change, well-traced, watch for over-claiming" approach that 002 should follow. The strongest constraints land in four clusters: **source-handling** (PL-04, PL-05, PL-06 — templates ship to other repos, so private terminology, scratch artefacts, and AGENTS.md drift are all release-quality concerns), **idempotence & honesty** (PL-01, PL-02, PL-08, PL-12, PL-14 — re-runs are normal, file count is not proof, proof levels matter, brownfield is the default), **dogfooding & verdicts** (PL-03, PL-09, PL-10 — the skill must run its own CLI, every command must produce a structured verdict with a `next_action`, and project-side framing must not drift into agent-runtime language), and **anti-bloat** (PL-07, PL-11, PL-15 — minimum useful surface, structured friction-log not diary, let v2 emerge from real use). Together these 15 findings argue for a skill package whose templates are short, whose CLI emits verdicts not vibes, whose install-report leads with what was proven (not what was created), whose friction log is empty-with-structure on day one, and whose own existence triggers a one-paragraph update to `AGENTS.md` recording that this repo now ships installable scaffolding alongside the foundations text.
