# Lens PS — Pattern & Convention Scout

**Lens role**: identify the conventions the *Engineering Harness Setup* skill must embody and follow.
**Deliverable framing assumed**: portable skill package (single `SKILL.md` plus optional `templates/` and `references/` subfolders, per ecosystem evidence in `~/.pi/agent/skills/`).
**Primary sources**: `harness-foundations/patterns-that-work.md` (22 patterns), `harness-foundations/first-principles.md` (58 principles), `harness-foundations/directives.md` (6 directives), `harness-foundations/simple-mode.md` (5 rules), `AGENTS.md`, brief at `docs/plans/002-engineering-harness-setup-skill/source-prompt.md` (2236 lines), plus skill-package exemplars under `~/.pi/agent/skills/`.

---

### Finding PS-01: Tracked-vs-scratch boundary + tone discipline are template wording constraints
**Pattern Source**: `AGENTS.md` "Source handling and research workflow"; brief §32.3 "Tone requirements"; patterns-that-work.md cadence (each pattern has *Minimal version* + *Watch for:*).
**Evidence**:
- `AGENTS.md:21-26` — *“Public/tracked content must use neutral language such as ‘a legacy platform,’ ‘a private source,’ ‘the team,’ or ‘the experiment.’ Do not quote private sources directly in tracked files unless the quote has been explicitly approved for publication.”*
- `AGENTS.md:20` — *“Never commit raw source documents, private notes, customer-specific details, person names, internal codewords, employer/client names, or unreleased platform details.”*
- brief §32.3 (lines 1995-2012) — tone must be *“direct; practical; educational; non-invasive; precise about evidence; skeptical of agent confidence; biased toward executable fixes; respectful of human decision points.”*
- brief §32.3 lines 2002-2009 — preferred phrasing: *“first useful version,” “candidate command,” “configured/unconfigured,” “proven/unproven,” “encode the fix,” “harness improvement candidate.”*
- Modelled in `patterns-that-work.md` — every pattern body opens with the rule, then *Minimal version* (one sentence), then *Watch for:* (anti-patterns). Same shape applies to `directives.md` (one directive = one short imperative paragraph).
- Anti-pattern: `simple-mode.md` is intentionally conversational (*“There’s been a lot of chatter…”* line 3) — that voice is appropriate for a public blog but **not** for skill prose that lands in arbitrary target repos.

**Description**: The skill ships templates (`HARNESS.md`, `harness/README.md`, `harness/skills/onboard-agent-session.md`, friction-log examples, known-difficulties seeds) that get materialised inside the *user’s* repository. Those templates therefore carry this repo’s public-language hygiene into other codebases. They cannot include named customers, persons, employer/client identifiers, internal codewords, or quoted private sources. Example friction entries and seeded difficulties must use neutral framing (“a legacy service”, “the team”, “a previous migration”) — never anonymised-but-recognisable details. The skill’s own prose must mirror the `patterns-that-work.md` cadence — terse imperative + minimal version + anti-pattern — not the chatty register of `simple-mode.md`.

**Why it matters for authoring**: A skill is a public-facing artefact by construction; once installed, every template it emits propagates its language norms. Drift here is invisible at authoring time but visible the moment a user runs the skill in a regulated/enterprise repo and finds their own friction log seeded with another team’s names.

**Recommendation**:
- Audit every template literal for proper nouns; replace with generic placeholders or remove.
- All example friction entries in `harness-known-difficulties.md`, `harness-friction-log.md`, `harness-proof-note.md` templates should use neutral examples (e.g. *“The dev server occasionally requires a one-off database reset after a schema change”*, not company-specific anecdotes).
- Adopt the patterns-that-work cadence inside `SKILL.md`: each setup step gets one imperative + one *Minimal version* sentence + a *Watch for* line where useful.
- Reserve the conversational tone of `simple-mode.md` for educational mini-explanations at decision points (per brief §25), not for the structural/normative sections of the skill.

---

### Finding PS-02: Pattern P3 — keep the common loop fast and the proof loop trustworthy
**Pattern Source**: `patterns-that-work.md` Pattern 3 (lines 24-32); brief §29 (lines 1817-1831).
**Evidence**:
- `patterns-that-work.md:24-32` — *“The common loop is the quick path used while developing… The proof loop is the stronger path used before accepting work… If the common loop is too slow, people and agents bypass the harness. If the proof loop is too weak, the team accepts plausible work instead of proven behaviour.”*
- `patterns-that-work.md:32` — *Minimal version: name one fast command for iteration and one stronger command for acceptance.*
- brief §12 (line 707): `harness/config.json` already includes `"validation": { "quick": [...], "proof": [...] }`.
- brief §29 (lines 1825-1831) — recommends adding a `fast` key once commands are encoded:
  ```json
  "validation": { "fast": ["test"], "quick": ["doctor","build","test"], "proof": ["doctor","build","test","health","smoke"] }
  ```
- `first-principles.md:#17` — *“Loop time is a first-class metric.”*

**Description**: The skill must embody the fast/proof distinction in its first emitted config, not leave it as a follow-up suggestion. The validation block in `harness/config.json` should ship with named lanes, and the CLI’s `validate` subcommand should accept (or at least name) which lane it ran.

**Why it matters for authoring**: Without the lanes visible from day 1, the first thing teams write is *“just run validate”* — which collapses correctness into convenience and trains agents to treat one signal as sufficient. The brief addresses this in §29 but treats it as optional; the underlying pattern (`patterns-that-work.md` P3) is non-negotiable.

**Recommendation**:
- Ship `harness/config.json` with all three keys (`fast`, `quick`, `proof`) populated with sensible defaults even when most are empty arrays.
- In `HARNESS.md` template §“Current command map”, name both *fast* and *proof* invocations.
- The CLI `validate` should default to `quick` and accept a lane argument (`--lane fast|quick|proof`) so the agent can choose explicitly.
- Add a one-liner to `SKILL.md` Principles: *“Name a fast command and a proof command. Do not let one masquerade as the other.”*

---

### Finding PS-03: Pattern P4 — `AGENTS.md` is a router, not a dumping ground
**Pattern Source**: `patterns-that-work.md` Pattern 4 (lines 36-44); brief §8 Step 8 (lines 526-530); brief §10 template (lines 615-635).
**Evidence**:
- `patterns-that-work.md:36-44` — *“The root instruction file should act like a router… It should not try to hold every historical lesson the team has ever learned… keep the entry file short enough that a fresh agent can read it at startup and know where to go next.”*
- `patterns-that-work.md:44` *Watch for: instruction bloat, lost-in-the-middle effects, duplicated rules, and old warnings that nobody knows how to remove.*
- brief §8 Step 8 (line 528): *“Do not duplicate the entire harness manual inside `AGENTS.md`. The root agent file should be a router, not a dumping ground.”*
- brief §10 (lines 615-635): the AGENTS.md patch template is intentionally a short pointer (~20 lines) to `HARNESS.md`, not a copy of it.
- `first-principles.md:#39` — *“Give a map, not a manual.”*

**Description**: The skill must enforce a strict size/scope budget on the `AGENTS.md` patch and keep durable detail inside `HARNESS.md` and the executable surface (`harness/config.json`, CLI). The patch is a routing snippet — it tells future agents the harness exists, names the front-door invocation, and points to where the real instructions live.

**Why it matters for authoring**: Many setup skills are tempted to “make sure agents see everything” by inlining the whole HARNESS into AGENTS.md. That immediately violates Pattern 4 and creates two sources of truth — guaranteed drift. The brief is already correct on this; the skill must operationalise it by treating the AGENTS.md patch as a fixed-shape append (idempotent, fingerprinted) rather than free-form prose.

**Recommendation**:
- The AGENTS.md patch template should remain ~20-30 lines max and reference `HARNESS.md` for everything load-bearing.
- The skill should check for an existing equivalent section (e.g. by sentinel comment `<!-- engineering-harness-setup-skill: router -->`) and either update in place or skip cleanly. Idempotency is required because P22 (garbage-collect stale assumptions) says duplicated rules accumulate.
- Add a *Watch for* note in `SKILL.md` Safety section: *“Do not inline HARNESS.md content into AGENTS.md. The root agent file is a router; durable detail lives in HARNESS.md and in `harness/`.”*
- If the target repo has alternate agent files (`CLAUDE.md`, `.cursorrules`, `GEMINI.md`), the skill should patch *all* of them with the same routing snippet, not duplicate content into each (brief §30, line 1834 already says this).

---

### Finding PS-04: Patterns P11 + P12 — explorable CLI returning structured evidence (exit-code contract)
**Pattern Source**: `patterns-that-work.md` Pattern 11 (lines 95-106), Pattern 12 (lines 110-119); brief §20 (lines 1592-1626).
**Evidence**:
- `patterns-that-work.md:95-106` (P11): *“A good CLI documents what is possible without forcing the agent to load a large manual into context. Command names, help text, subcommands, flags, examples, exit codes, and non-interactive modes let an agent discover the safe path incrementally… Minimal version: provide one top-level command with useful help text, obvious subcommands, and examples for boot, validate, doctor, seed, and status.”*
- `patterns-that-work.md:110-119` (P12): *“Useful harness commands return clear status, stable exit codes, structured data where appropriate, typed errors, and remediation guidance. They distinguish hard failure from degraded-but-usable states… every important command should say what it checked, whether it passed, what failed, and what to do next.”*
- `patterns-that-work.md:119` *Watch for: agents scraping brittle log text, or commands that fail loudly without explaining the failed layer.*
- brief §20 (lines 1604-1626) — explicit exit-code contract:
  - `0`: passed or completed successfully
  - `1`: failed
  - `2`: unconfigured or not applicable
- brief §13 lines 869-870 (Python skeleton) and §14 (Node skeleton) — every command returns `print_result({status, title, messages, next_action})` and exits with a meaningful code; `--json` already plumbed.
- `first-principles.md:#20` *“CLIs are natural harness surfaces”* + `#21` *“The CLI is the API.”*

**Description**: Exit code 2 (“unconfigured”) is a *load-bearing* distinction. It encodes pattern P3’s rule that an unset command isn’t a failure by itself, while still being machine-readable. Without it, agents either crash on `unconfigured` or pretend success when nothing ran. The CLI skeletons in the brief already implement this — the skill must preserve it verbatim and call it out as a contract, not an implementation detail.

**Why it matters for authoring**: The contract `0=pass / 1=fail / 2=unconfigured` is the single most important machine surface the skill creates. Any drift (e.g. returning 0 for unconfigured “to be friendly”, returning 1 for unconfigured “to be safe”) breaks downstream automation: CI guards, agent `validate` loops, and the `doctor` command’s own classification. Sample CLIs in `~/.pi/agent/skills/engineering-harness-v2/SKILL.md` use the same three-way verdict (`✅ HEALTHY / ⚠️ SLOW / ❌ UNHEALTHY / 🔴 UNAVAILABLE`) for the same reason.

**Recommendation**:
- Promote the exit-code table from brief §20 into both `SKILL.md` (Safety/Contract section) and the materialised `harness/templates/cli-command-contract.md` template — exact bytes, no paraphrase.
- Every CLI subcommand in the Python/Node skeletons must adhere to the same `{status, title, messages, next_action}` payload shape — already done in brief §13/§14, the skill just needs to flag this as the *contract*, not an example.
- Add an authoring guard: when the skill emits the CLI skeleton, validate that `unconfigured → exit 2` is preserved in the rendered file (a unit-test-shaped property the skill can self-check post-render).
- `--help` and `--json` are non-negotiable surfaces. P11 minimal version names exactly these.

---

### Finding PS-05: Pattern P13 — diagnostics should fix-forward (doctor command)
**Pattern Source**: `patterns-that-work.md` Pattern 13 (lines 123-131); brief §13 `doctor()` (lines 933-967) + §14 `doctor()` (lines 1199-1233).
**Evidence**:
- `patterns-that-work.md:123-131`: *“A good doctor command is executable orientation… It should check the layers in the order an operator would need them: prerequisites, environment variables, dependencies, ports, services, product startup, health endpoint, seed data, and validation surface. It should stop at the most useful failing layer and prescribe the next action. Diagnostics should not merely say red. They should explain what was expected, what happened, why that layer matters, and which command or file is likely to fix it.”*
- `patterns-that-work.md:131` *Watch for: dumping raw stack traces without guidance, or hiding the command that would repair the problem.*
- brief §13 (lines 933-967): `doctor()` already enumerates configured/unconfigured commands and ends with a `next_action` field — the right shape, but minimal content.
- `first-principles.md:#22` *“Diagnostics should prescribe the fix.”* + `#35` *“Error messages should teach repair.”*
- brief §6.1 question 4 (line 247): the skill must ask about a health check, because *“without a health or smoke check… the harness can prove the product booted, not merely that commands exist.”* (paraphrased from §21:1665)

**Description**: The brief’s `doctor` skeleton is correct in shape but minimal in content — it lists configured/unconfigured commands and returns a generic `next_action`. P13 requires layered checks (prereqs → env → deps → services → product → health → seed) where each layer stops at the most useful failing point and prescribes the next concrete action. The skill should encode this layering as a documented contract even if v1 of the doctor only implements the top layers.

**Why it matters for authoring**: A doctor that just says *“config missing”* trains agents to treat doctor output as noise. A doctor that says *“config missing at `harness/config.json` — re-run `engineering-harness-setup-skill` or copy the example from `harness/templates/`”* trains agents to read it. This is the gateway diagnostic; if it fails the fix-forward contract, P9 (promote repeated review feedback) cascades into a flood of agent-side workarounds.

**Recommendation**:
- The materialised `doctor` should iterate explicit layers in order: (1) `harness/config.json` exists/parses, (2) declared commands resolve (binary on PATH), (3) optional health URL parsed, (4) optional smoke command parsed. Each layer that fails returns a *layer-specific* `next_action`, not a generic one.
- Include in the CLI contract template: *“Doctor must stop at the most useful failing layer and prescribe the next action. Do not list everything that’s wrong — list the next thing to fix.”*
- Add to `SKILL.md` Principles section a one-liner from P13: *“Diagnostics must prescribe the fix, not merely report red.”*
- Add to the friction-log template a row for *“doctor said red but didn’t say what to do”* as a canonical encoding candidate.

---

### Finding PS-06: Pattern P14 — seed the first real scenario (smoke/health placeholder, not silent skip)
**Pattern Source**: `patterns-that-work.md` Pattern 14 (lines 135-143); brief §21 (lines 1650-1671), §22 (lines 1675-1693), §28 #1 (line 1801).
**Evidence**:
- `patterns-that-work.md:135-143`: *“A product that boots empty is still hard to understand. Seed data is part of the harness because it makes meaningful interaction possible… The first real scenario should exercise a behaviour the team cares about, not merely prove that a server process exists… Minimal version: provide one command that creates or resets a safe development fixture, then document one interaction that proves the seeded state works.”*
- `patterns-that-work.md:143` *Watch for: demo data that rots, fixtures that require tribal setup, or seed commands that cannot be rerun safely.*
- brief §21 (lines 1665-1671): when the user gives no health endpoint, *“keep `health.url` empty and create an explicit next action: ‘Next harness improvement candidate: encode a first health or smoke check…’”* — i.e. surface the gap, don’t skip silently.
- brief §28 (line 1801) — recommended first improvement: *“Add or confirm a health endpoint or smoke route.”*
- brief §22 (lines 1675-1693): long-running boot is acceptable to defer, but the run command should still be encoded and explicitly marked as such.
- `first-principles.md:#23` *“Seed data is part of the product surface.”*

**Description**: A repo without a health/smoke surface is the common case. The skill must not skip the question — it must encode the gap as a first-class entry in the friction log + known-difficulties + final report. P14 also requires that any seed/fixture command the skill encodes is *idempotent* (rerun-safe), which becomes an explicit field in the config template.

**Why it matters for authoring**: This is where the skill earns its claim to “make incompleteness visible” (brief §31). If the skill silently emits `"health": { "url": "" }` and moves on, the gap disappears and never gets encoded. P14’s *Watch for* (“demo data that rots, fixtures that require tribal setup, or seed commands that cannot be rerun safely”) is exactly the failure mode the skill must guard against in target repos.

**Recommendation**:
- When `health.url` and `smoke.command` are both empty after Step 3, the skill **must** add the gap as a pre-seeded entry in `harness/state/known-difficulties.md` (status `active`, candidate encoded fix `add a health URL or smoke route to harness/config.json`).
- The Step 4 final report must list `health: unconfigured` and `smoke: unconfigured` with the magic-wand recommendation already populated, not as boilerplate.
- The `smoke` command spec in `harness/config.json` should include an idempotency note: *“This command should be safe to rerun. Set `idempotent: true` once verified.”*
- Add to `SKILL.md` Decision-points section (per brief §25): *“If there is no health or smoke check yet, we will mark it as a harness improvement candidate rather than pretending startup is proven.”* (verbatim from brief §25:1746).

---

### Finding PS-07: Patterns P10 + P22 — friction lifecycle + garbage collection installed by the skill
**Pattern Source**: `patterns-that-work.md` Pattern 10 (lines 81-91), Pattern 22 (lines 269-275); brief §1.7 (lines 110-122), §27 (lines 1772-1790), §28 #10 (line 1810).
**Evidence**:
- `patterns-that-work.md:81-91` (P10): *“A practical lifecycle is capture, bubble, harvest, prioritise, encode, and validate… The magic-wand question is a simple trigger… Minimal version: ask the magic-wand question at the end of meaningful agent runs and convert the best answers into small harness tasks.”*
- `patterns-that-work.md:91` *Watch for: retrospectives becoming diaries. The value is not the number of notes. The value is how many recurring frictions become encoded fixes.*
- `patterns-that-work.md:269-275` (P22): *“Harnesses decay because projects, teams, models, dependencies, and workflows change. Periodically scan for stale instructions, duplicated rules, dead fixtures, flaky checks, obsolete commands, drifted docs… Some items should be deleted. Some should be promoted into executable checks.”*
- brief §27 (lines 1782-1788) — six-stage lifecycle: capture → bubble at natural pauses → magic-wand at session end → maintenance review → encode/promote/delete → measure encoded improvements.
- brief §28 #10 (line 1810) — recommended first improvement: *“Garbage-collect stale instructions that have become executable commands.”*
- `first-principles.md:#47` *“Retrospectives need a lifecycle”*; `#48` *“Ledgers are improvement backlogs, not diaries”*; `#49` *“Measure encoded improvement, not activity volume.”*
- Modelled in the wider ecosystem: `~/.pi/agent/skills/harness-is-the-product-v2/SKILL.md` describes the same lifecycle as `compound-1-track → compound-2-bubble → compound-3-harvest`, and `engineering-harness-v2/SKILL.md` Step 4a auto-seeds `## Known Difficulties` from `docs/compound/`.

**Description**: The skill must install both halves of the loop:
1. **Capture surface** — `harness/state/friction-log.md` and `harness/templates/friction-entry.md` with a structured entry shape (status / severity / recurrence / layer / what happened / candidate encoded fix / next action).
2. **Anti-bloat surface** — explicit rules in `HARNESS.md` Rule 5 that the log is *“an improvement backlog, not a diary”* (brief §9 line 596) and that maintenance should periodically promote, delete, or encode entries (brief §27 maintenance loop).

Without P22 framing, P10 inevitably produces a graveyard log nobody reads.

**Why it matters for authoring**: The most common failure mode of friction-tracking systems is exactly what P22 warns against — they become append-only. The skill must ship the discipline alongside the surface; the friction-log template must include a “maintenance review” checklist, not just an entry schema.

**Recommendation**:
- Friction-log template (brief §17) is correct; add a “Maintenance review” section at the bottom with a small checklist: *“For each open entry: dismiss / keep open / convert to task / encode now / promote into known-difficulties / delete as obsolete”* (paraphrased from brief §27:1788).
- `HARNESS.md` template Rule 5 already says *“The friction log is an improvement backlog, not a diary. Prioritise recurring, severe, or old issues.”* — keep verbatim.
- Add an authoring measurement principle in `SKILL.md`: *“Measure by encoded improvements, not by entry count.”* (paraphrased from `patterns-that-work.md:91` + `first-principles.md:#49`).
- The skill itself should not emit pre-seeded friction entries with phantom content; the example friction entries belong in `harness/templates/friction-entry.md` (a template, not an active log entry).

---

### Finding PS-08: `Boot → Interact → Observe → Validate → Improve` — canonical phrasing and wording drift to reconcile
**Pattern Source**: brief §1.2 (line 36), brief §9 HARNESS.md template (line 582), brief §33 SKILL.md outline (line 2067); `first-principles.md:45`, `directives.md:17`; drift in `simple-mode.md:31`.
**Evidence**:
- brief §1.2:36 — *“Boot → Interact → Observe → Validate → Improve”* (canonical, in a fenced code block).
- brief §9:582 — *“Boot → Interact → Observe → Validate → Improve”* (same wording in HARNESS.md template).
- brief §33:2067 — *“the repo needs a basic Boot → Interact → Observe → Validate → Improve loop.”* (same wording in proposed SKILL.md outline).
- `first-principles.md:45` — *“…move a human or agent from intent to evidence through Boot → Interact → Observe → Validate → Improve.”* ✓ identical wording (no bolding).
- `directives.md:17` — *“…through **Boot → Interact → Observe → Validate → Improve**.”* ✓ identical (with bold markdown).
- `patterns-that-work.md` — does **not** contain the exact 5-stage string. The closest is the *Pattern 11* minimal version (line 106): *“…obvious subcommands, and examples for boot, validate, doctor, seed, and status.”* This is a CLI-surface list, not the loop.
- **Drift A**: `simple-mode.md:31` — *“…helps the agent prove the software works: build, boot, seed, run, observe, validate, improve.”* This is a 7-verb expansion (adds `build`, `seed`, `run`; folds `interact` into `run`; drops the `→` arrows). It is a related but *different* phrasing and must not be used verbatim in the skill.
- **Drift B**: `AGENTS.md:14` (this repo) — *“boot/build/test/run/health/observe/verify flows”* — yet another verb list (7 stages, different ordering). Also not the canonical operating loop.

**Description**: The brief is internally consistent (3 occurrences, all identical). `first-principles.md` and `directives.md` match. **`simple-mode.md` and `AGENTS.md` use longer, ad-hoc verb lists** that conflate the operating loop with the substrate command map. This is benign in the public blog and repo-framing files but would be a tone/contract bug in skill prose — the skill must reserve `Boot → Interact → Observe → Validate → Improve` as the named operating loop and use separate, clearly-marked vocabulary when listing substrate verbs (`build / test / run / health / smoke`).

**Why it matters for authoring**: The 5-stage loop is the *thesis* of the brief (§1.2 calls it the *“target operating loop”*). If the skill drifts to the 7-stage variant from `simple-mode.md`, it (a) renames the most important concept the harness teaches, (b) blurs the substrate/overlay distinction (`harness-is-the-product-v2/SKILL.md` is explicit that the engineering harness has *both* substrate and overlay layers), and (c) produces target-repo HARNESS.md files that look different from the brief’s template.

**Recommendation**:
- In every materialised file (HARNESS.md, harness/README.md, onboard-agent-session.md, SKILL.md Principles section), use exactly `Boot → Interact → Observe → Validate → Improve` with the Unicode arrow `→` (U+2192). No bolding inside the code block, optional bolding in prose, matching the brief.
- Where substrate verbs (`build / test / run / lint / health / smoke / doctor / seed / validate`) appear, label them clearly as the *command map* — not the operating loop. The HARNESS.md template already does this correctly (§9 *Current command map* is separate from §9 *Operating loop*).
- Add to `SKILL.md` Principles section a single normative line: *“This skill names the operating loop as `Boot → Interact → Observe → Validate → Improve`. Substrate command lists (`build`, `test`, `run`, `health`, …) are not the loop.”*
- Open a small follow-up to align `simple-mode.md` and `AGENTS.md` wording on a future pass — but this is **out of scope for the skill itself**; the skill should not “fix” foundation drift, only avoid propagating it.

---

### Finding PS-09: Magic-wand prompt — canonical phrasing and variants to harmonise
**Pattern Source**: brief §1.7 (line 116), §9 HARNESS.md template (line 636), §17 friction-log (line 1518), §24 final report (line 1762), §34 example (line 2165); `patterns-that-work.md:125` (P10); `first-principles.md:#46`; `simple-mode.md:132`; brief §8 Step 11 (line 537).
**Evidence** — five distinct variants exist across the corpus:

| Source | Wording | Notes |
|---|---|---|
| **brief §1.7:116** | *“If you had a magic wand, what one command, flag, output field, fixture, diagnostic, template, or workflow change would make the next run easier, safer, faster, or higher quality?”* | **Canonical**. Echoed at §9:636, §17:1518, §24:1762, §34:2165 — identical bytes. |
| brief §8 Step 11:537 | *“If you had a magic wand, what one command, check, fixture, diagnostic, output field, or workflow change would make this harness more useful for the next session?”* | Variant inside the skill flow itself: drops `flag` and `template`, adds `check`; replaces the four-adverb tail with *“more useful for the next session”*. |
| `patterns-that-work.md:125` (P10) | *“What one concrete command, flag, output field, fixture, diagnostic, template, or workflow change would make the next run easier?”* | Adds *“concrete”*; trims to one adverb (`easier`). |
| `first-principles.md:#46:208-209` | *“Asking what one concrete command, flag, output field, fixture, diagnostic, or workflow change would help turns usage into improvement signal.”* | Drops `template`; drops the four-adverb tail. |
| `simple-mode.md:132` | *“If you had a magic wand, what one command, flag, output field, fixture, diagnostic, template, or workflow change would make the next run easier, safer, or higher quality?”* | Drops `faster` from the four-adverb tail. |
| `simple-mode.md:48` | *“if you had a magic wand, what would you improve about your environment”* | Casual paraphrase, lowercase. Not for skill use. |

The Python and Node CLI skeletons (brief §13:1059-1063, §14:1330-1334) both print the canonical wording from §1.7 inside the `magic-wand` subcommand — so the CLI surface already locks in the canonical version.

**Description**: The variants are minor on their own, but the skill is the artefact most users will encounter (CLI invocation, HARNESS.md, friction-log template, final report), and **every one of those materialised surfaces in the brief already uses the same canonical string**. The non-canonical variants live in foundation prose and the brief’s *Step 11* flow description (which is not itself a materialised template). The skill should pick one canonical string and use it everywhere it materialises — including its own CLI’s `magic-wand` subcommand.

**Why it matters for authoring**: Once the magic-wand reflex becomes a habit, the *exact wording* anchors the cue. Drift between the CLI’s wording, the HARNESS.md wording, and the friction-log template trains agents to treat them as different prompts.

**Recommendation**:
- **Canonical version (use verbatim in the skill)**:
  > *“If you had a magic wand, what one command, flag, output field, fixture, diagnostic, template, or workflow change would make the next run easier, safer, faster, or higher quality?”*
- Use this exact wording in:
  - `harness/bin/harness.{py,mjs}` `magic-wand` subcommand output (already matches in brief §13/§14).
  - `HARNESS.md` Rule 5.
  - `harness/state/friction-log.md` *Magic-wand prompt* section.
  - `harness/templates/proof-note.md` *Magic-wand improvement candidate* line.
  - `SKILL.md` setup-flow Step 11 closeout (replacing the §8 Step 11 variant).
  - The final setup report template (§24).
- Note in `SKILL.md` Principles section: *“The magic-wand prompt is a fixed string. Different wording across surfaces dilutes the cue.”*
- Leave the foundation-prose variants alone — they’re context-specific (P10 talks about the *trigger*, #46 talks about why it works) and trying to align them belongs to a different change.

---

### Finding PS-10: Skill-package conventions in the wider ecosystem (frontmatter + multi-file shape)
**Pattern Source**: empirical scan of `~/.pi/agent/skills/` (38 installed skills); brief §4 (lines 188-216); skill-contract reference at `~/.pi/agent/skills/install-hve-core-rpiv/references/generated-skill-contract.md`.
**Evidence** — ecosystem evidence from `~/.pi/agent/skills/`:

**Frontmatter pattern (single-file `SKILL.md`)**:
```yaml
---
name: <skill-slug>
description: <one-paragraph description>
[version: 1.0.0]   # optional, present in some skills (e.g. install-hve-core-rpiv, sdd-tutorial)
---
```
Examples:
- `engineering-harness-v2/SKILL.md`: `name`, `description` only.
- `install-hve-core-rpiv/SKILL.md`: `name`, `description`, `version`.
- `compound-0-setup/SKILL.md`: `name`, `description` (description is a YAML block scalar `|` because it’s long).
- `harness-is-the-product-v2/SKILL.md`: `name`, `description` only.

**Forbidden keys** (from `install-hve-core-rpiv/references/generated-skill-contract.md:46-50`):
- `agent`, `agents`, `handoffs`, `disable-model-invocation` — these are agent-system keys, not skill keys.

**Package shapes**:
- **Single file**: `engineering-harness-v2/SKILL.md` (341 lines, no subfolders) — works fine for prose-heavy skills.
- **SKILL.md + `references/`**: `install-hve-core-rpiv/{SKILL.md, references/{source-acquisition.md, generated-skill-contract.md, manifest-and-drift.md}}` — used when the skill has multiple contract documents the agent reads at specific steps.
- **SKILL.md only**: most skills (`compound-0-setup`, `harness-is-the-product-v2`, `plan-1a-v2-explore`, etc.).
- **No examples** of `templates/` as a separate subfolder in the installed ecosystem — but brief §4 proposes exactly this shape, and `engineering-harness-v2/SKILL.md` inlines template literals inside the SKILL.md body. Both approaches are valid; multi-file is preferable when templates are large or numerous (which is the case here — brief lists 10+ templates).

**Description**: The brief’s proposed package shape (§4: `SKILL.md` + `templates/` with named template files) is a valid skill-package layout. It is **not the most common** in the user’s installed ecosystem (most skills are single-file), but it’s a sensible choice given the volume of materialised templates (HARNESS.md, AGENTS.md snippet, harness-README.md, harness-config.json, two CLI skeletons, onboarding guide, two state files, two entry templates, CLI contract, install report — ~12 templates). Inlining all of those inside a single `SKILL.md` would push the file well past 800 lines and hurt scannability.

The brief is correct that for runtimes supporting multi-file skills, templates belong in `templates/`. For single-file runtimes, the brief instructs to embed and materialise at run time (§4:213). Both modes need to be supported by the skill author.

**Why it matters for authoring**:
- **Frontmatter strictness**: getting the frontmatter wrong (e.g. adding `agent:` or omitting `description`) silently breaks discoverability in some runtimes.
- **Multi-file vs single-file**: the choice determines how the skill loads templates. Single-file = heredoc/string literals + `write_file` calls. Multi-file = `read_file` from `templates/` + token replacement.
- **No external research needed** — the path was accessible. The brief’s proposed shape (`SKILL.md` + `templates/`) is consistent with ecosystem patterns (`install-hve-core-rpiv/references/`), just using `templates/` as the subfolder name. The skill author can confidently follow §4.

**Recommendation**:
- Adopt the **multi-file shape** from brief §4:
  ```
  engineering-harness-setup-skill/
    SKILL.md
    templates/
      root-HARNESS.md
      agents-md-snippet.md
      harness-README.md
      harness-config.json
      harness-known-difficulties.md
      harness-friction-log.md
      harness-proof-note.md
      harness-onboard-agent-session.md
      cli-python-harness.py
      cli-node-harness.mjs
      cli-command-contract.md
      install-report.md
    references/    # optional — see below
      cli-contract.md
      lifecycle-contract.md
  ```
- **Frontmatter** must be exactly:
  ```yaml
  ---
  name: engineering-harness-setup-skill
  description: <one paragraph naming what gets created and the BIOVI loop installed>
  version: 0.1.0
  ---
  ```
  Do not add `agent`, `agents`, `handoffs`, or `disable-model-invocation`.
- **Templates** should use `{{PLACEHOLDER}}` syntax (already specified in brief §32.2) — Python/Node CLI skeletons use Mustache-style; safer than `${...}` because the latter collides with shell/JS string interpolation in the materialised files.
- **References folder** is optional. Use it only if a separate contract document (e.g. the CLI exit-code contract from PS-04) gets long enough that the agent should jump to it directly. Otherwise inline in `SKILL.md`.
- **Self-check the skill package**: after authoring, the skill itself should be installable via the same skills directory and respond to `--help` at the agent runtime — this is the *“dogfood the supported surface”* test from `first-principles.md:#25`.

---

## Summary

The *Engineering Harness Setup* skill must embody the foundation patterns it teaches: a `Boot → Interact → Observe → Validate → Improve` loop preserved verbatim (PS-08), an explorable CLI with a hard exit-code contract (`0/1/2`, PS-04) and fix-forward doctor diagnostics (PS-05), an AGENTS.md patch that routes rather than dumps (PS-03), separate fast vs proof validation lanes in `config.json` (PS-02), a seed/health placeholder that surfaces gaps instead of hiding them (PS-06), and a friction-lifecycle surface that includes the garbage-collection discipline so the log doesn’t become a diary (PS-07). The magic-wand prompt has five extant variants across the foundations; the skill should lock in the brief’s §1.7/§9 canonical wording everywhere it materialises (PS-09). Public-safe language rules from `AGENTS.md` propagate from this repo into target-repo templates — example friction entries, known-difficulties seeds, and proof notes must use neutral framing and mirror the terse `patterns-that-work.md` cadence rather than the conversational `simple-mode.md` register (PS-01). The proposed multi-file package shape (`SKILL.md` + `templates/`) is consistent with ecosystem precedent at `~/.pi/agent/skills/`; frontmatter is `name` + `description` (+ optional `version`), with `agent`/`agents`/`handoffs`/`disable-model-invocation` forbidden (PS-10). No external research gap remains — the user’s installed skills directory was readable and gave enough convention evidence to author confidently.
