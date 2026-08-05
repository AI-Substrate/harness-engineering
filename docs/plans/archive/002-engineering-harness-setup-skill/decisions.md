# Plan Decisions

Decisions made by the human about scope, framing, and direction. Append-only log; spec authors and reviewers should treat the latest matching entry as authoritative.

---

## 2026-05-22 — Standalone deliverable, no sibling-skill coordination

**Decision**: This skill (`engineering-harness-setup`) ships standalone. It does **not** coordinate with, depend on, or reference any other skill — including `engineering-harness-v2`, `agent-harness-v2`, `harness-is-the-product-v2`, or the `compound-*` family.

**Implications for the spec**:

| Research finding | Status | What changes |
|---|---|---|
| CF-01 (lifecycle position vs `engineering-harness-v2` — bootstrap vs govern+validate, DC-05) | ✅ **Resolved by scope decision** | Skill does not write a pointer into `docs/project-rules/engineering-harness.md`. No "after this, run …" hint in `SKILL.md`. The "When NOT to use" framing collapses — the skill is the only tool. |
| CF-05 (friction-log overlap with `compound-*`, DC-06) | ✅ **Resolved by scope decision** | No detection of `docs/compound/`. `harness/state/friction-log.md` is always created as the canonical friction surface. No conditional "if compound present, write a pointer" logic. |
| DC-07 (`harness-is-the-product-v2` philosophical companion reference) | ✅ **Resolved by scope decision** | No "for deeper grounding, run …" line in `SKILL.md`. The skill carries its own short philosophy block (per DC-07 recommendation: ~6 bullets, not a 100-line essay). |

**Implications NOT changed by this decision**:
- DB-07 (AGENTS.md ↔ HARNESS.md ↔ config.json routing contract) — still applies; it's *internal* to the skill's output.
- The 4 ecosystem-coordination findings above had been the strongest source of optional complexity. Removing them simplifies CF-02, CF-03, CF-04, CF-06, CF-07 to a single skill with no host-coordination story.

**Spec-level guidance**:
- `SKILL.md` "When to use" section: positive framing only ("Use this skill when you want the first useful version of a repo-local engineering harness"). No "When NOT to use" branch coordinating with other skills.
- Templates contain no references to compound, governance docs, or sibling agents.
- The 5 critical findings still open (CF-02 boundary lint, CF-03 onboarding source-of-truth, CF-04 packaging, CF-06 magic-wand wording, CF-07 placeholder count) are unchanged and remain the spec's gating decisions.

**Source**: User direction, this session.

---

## 2026-05-22 — Clarification session (Q1–Q8)

Running `/plan-2-v2-clarify` adapted to pre-spec state: answers logged here; downstream `/plan-1b-v2-specify` picks them up.

### Q1: Workflow Mode

**Answer**: **Simple Mode**.

**Implications** (per plan-2-v2-clarify skill):
- Single-phase plan, inline tasks.
- `plan-4-v2-complete-the-plan` and `plan-5-v2-phase-tasks-and-brief` are optional.
- Testing defaults to **Lightweight** (Q2 will confirm or override).
- Spec header gets `**Mode**: Simple`.
- Lower ceremony: the 4×4 test matrix proposed in research (QT-02, QT-03) may be trimmed at Q2.

---

### Q2: Testing Strategy

**Answer (free text)**: “testing needed its not code” → interpreted as **“testing is not needed; the artefact is content (markdown + templates + stdlib CLI skeletons), not novel application code.”**

**Implications**:
- No `tests/` folder in the skill package.
- No 4×4 fixture matrix (QT-02, QT-03 collapse).
- No regression set (QT-10 acknowledged but not built).
- No tracked acceptance checklist or rejection-rules file (QT-01, QT-07 collapse).
- **Q3 “Mock Usage” is moot** → skipped (no tests to mock for).
- `tests/foundation-citations.md` sync check (QT-08) also dropped.
- Validation pattern becomes **dogfood once during authoring** — the skill author runs the skill against one real target repo and trusts the manual run as proof. Friction observed during that run becomes the first entry in this plan's friction record.

**What survives as content rules** (not tests):
- Sharpened §24 setup-report template with `Ran` / `Outcome` verdict columns (QT-04).
- Proof-level ceiling sentence in the report (“This setup proves at most L2…”, QT-06).
- Boundary-sentence and routing-sentence stability — still required, but enforced by author discipline + a one-time pre-commit grep, not a test suite.

**Remaining question budget**: 5 (skipping Q3 Mock Usage) → will batch to fit `ask_user_question`'s 4-per-call limit.

---

### Q3: Documentation Strategy

**Answer**: **+ root README mention** — SKILL.md + a one-paragraph 'Skills authored here' section in this repo's `README.md`. No `skills/README.md` index, no `AGENTS.md` framing update, no `docs/how/` tutorial.

**Implications**:
- Spec adds one task: append a 'Skills authored here' section to `README.md`.
- **AGENTS.md is NOT updated** — PL-06's recommended framing paragraph is declined. The repo intent shift (foundations-only → foundations + installable scaffolding) is signaled only by the README mention. Acceptable trade-off for Simple Mode; if friction arises later (e.g. confusion about whether this repo ships artefacts), revisit as a separate change.
- No `skills/README.md` index file. If a second skill is ever authored in this repo, that index is a candidate v0.2 improvement.

---

### Q4 (CF-04): Skill Package Layout

**Answer**: **Multi-file** — brief §4 layout (`SKILL.md` at root with sibling `templates/` folder; one file per template).

**Implications**:
- Spec adopts brief §4 file tree.
- Assumption: pi runtime supports filesystem-relative reads from inside a skill package (precedent: `~/.pi/agent/skills/install-hve-core-rpiv/references/`). If empirical use reveals the pi runtime cannot load sibling files, this becomes a v0.1 friction-log entry and the skill is repacked as single-file with inlined templates.
- Templates folder contains ~14 files (per IA-10 list, less the `tests/` subtree which Q2 collapsed).
- No fallback artefact is maintained — if multi-file fails, fix it forward.

---

### Q5 (CF-06): Magic-Wand Canonical Wording

**Answer**: **4-adjective canonical** — *“If you had a magic wand, what one command, flag, output field, fixture, diagnostic, template, or workflow change would make the next run easier, safer, faster, or higher quality?”*

**Implications**:
- Ships as `templates/magic-wand-prompt.md` (single source of truth).
- HARNESS.md template Rule 5, `harness/state/friction-log.md` template, `harness/templates/proof-note.md`, install report, and both CLI skeletons' `magic-wand` subcommand all echo this exact string.
- **Known drift accepted**: `harness-foundations/simple-mode.md` Rule 5 uses the 3-adjective form (no “faster”). The discrepancy is documented but **not fixed in this plan** — patching simple-mode.md would be a foundation edit, separate scope. If desired, log as a future foundation-housekeeping plan.
- Brief §8 Step 11's variant wording is rejected; standardise on the canonical phrasing wherever the brief shows the prompt.

---

### Q6 (CF-07): Placeholder Substitution Rule

**Answer**: **Strict — always resolve + self-check**.

**Implications**:
- Rules:
  1. Prose files (`HARNESS.md`, `AGENTS.md` snippet, README, onboarding guide, install report): the skill resolves every `{{…}}` to its final string. No literal markers in shipped prose.
  2. `harness/config.json`: always resolved; unknown values become empty strings `""`, never literal `{{…}}` (the CLI would otherwise execute `{{BUILD_COMMAND}}` as a shell command).
  3. Final self-check: before declaring success, the skill greps every file it wrote for `{{...}}` and fails with a clear `next_action` if any literal remains.
- Spec §32.2 enumeration is expanded to all 10 tokens: the 7 already listed plus `{{LINT_COMMAND}}`, `{{FORMAT_CHECK_COMMAND}}`, `{{harness_cli_file}}`.
- Naming convention: UPPER_SNAKE for shell-command and URL substitutions; lower_snake for runtime identifiers (`python_or_node`, `harness_cli_file`).
- The brief §32.2 “leave visibly empty” rule is superseded by this strict policy.

---

### Q7 (CF-03): Onboarding Source-of-Truth

**Answer**: **File is source; CLI reads & prints it.**

**Implications**:
- `harness/skills/onboard-agent-session.md` (brief §15 verbatim) is the canonical onboarding checklist for future agent sessions, including the 7th step (friction-layer classification per brief §1.6).
- Both CLI skeletons' `onboard` subcommand replaces its hardcoded checklist with: read `harness/skills/onboard-agent-session.md` from the resolved harness root and print it. If the file is missing, exit `2` (unconfigured) with `next_action = "Run engineering-harness-setup to materialise the onboarding guide."`
- Edit the brief §13 (Python skeleton) and §14 (Node skeleton) `onboard()` functions during template authoring — they currently print hardcoded lines, must be replaced with a `read_text_file(…)` call.
- Future maintainers update one file; the CLI follows automatically. No drift risk.

---

### CF-02 (commitment, not a question): Canonical Boundary Sentence Lint

**Decision**: Adopted as a non-negotiable authoring commitment, without a question.

**Rule**: The sentence *“The agent harness drives. The engineering harness proves.”* must appear byte-identical in every template that references the boundary (`templates/root-HARNESS.md`, `templates/agents-md-snippet.md`, `templates/harness-onboard-agent-session.md`, the SKILL.md preamble, and the install-report template).

**Enforcement** (consistent with Q2's “dogfood once” posture):
- One pre-commit grep during authoring — not a permanent CI check, not a test suite.
- The grep also verifies templates contain no references to `harness-foundations/`, `docs/plans/`, `scratch/`, `source-notes/`, or source IDs `S001`–`S004` / `N2-S00x` / `M00x` (per PL-04, DB-02, DB-03, DB-05).
- Recorded as one task in the spec's task list.

---

## Coverage summary

**Questions asked**: 7 of 8-cap (Q3 Mock Usage skipped — Q2 collapsed it).
**Critical findings status**: 7 of 7 resolved.

| ID | Topic | Status | Decision |
|---|---|---|---|
| CF-01 | Lifecycle position vs sibling skills | ✅ | Standalone (opening of session) |
| CF-02 | Canonical boundary sentence lint | ✅ | Adopted as authoring commitment |
| CF-03 | Onboarding source-of-truth | ✅ | File is source; CLI reads & prints (Q7) |
| CF-04 | Skill packaging | ✅ | Multi-file (Q4) |
| CF-05 | Friction-log overlap with compound-* | ✅ | Standalone (opening of session) |
| CF-06 | Magic-wand wording | ✅ | 4-adjective canonical (Q5) |
| CF-07 | Placeholder substitution | ✅ | Strict + self-check (Q6) |

| Standard plan-2 topic | Status | Decision |
|---|---|---|
| Q1 Workflow Mode | ✅ | Simple |
| Q2 Testing Strategy | ✅ | None — not code |
| Q3 Mock Usage | ⏭️ | Skipped (no tests) |
| Q4 Documentation Strategy | ✅ | + root README mention |
| Domain Review | ⏭️ | No `docs/domains/` registry in this repo |
| Agent-Harness Readiness | ⏭️ | This repo is a docs/skill-authoring repo — not applicable |

**No critical ambiguities remaining**. Ready for `/plan-1b-v2-specify`.

---

## 2026-05-22 — Post-field-research re-resolution of CF-06

**Decision**: Q5's 4-adjective canonical wording is **superseded** by the hybrid wording adopted in the spec (see `engineering-harness-setup-skill-spec.md` §Decisions → Re-resolved by field research → CF-06).

**Canonical hybrid wording**:

> *"If you had a magic wand, what ONE thing would you change to make the next run easier, safer, faster, or higher quality? Be concrete — name a command, flag, output field, fixture, diagnostic, template, or workflow change."*

**Trigger**: `field-research-minih-chainglass.md` Issue 2 demonstrated both production schemas (`~/substrate/minih/src/schemas/retrospective.json` and `~/substrate/chainglass/harness/agents/smoke-test/output-schema.json`) use a 1-thing concrete form (no 4-adjective tail) — *"If you had a magic wand, what ONE thing would you change? Be concrete."* The hybrid form preserves the brief's enumeration of *what counts as a magic-wand suggestion* while matching real-world framing.

**Authority**: Spec is now authoritative for the canonical string; this entry exists so future readers of `decisions.md` alone do not regress to the 4-adjective form. Append-only log contract preserved.

**Related**: The 3-adjective drift in `harness-foundations/simple-mode.md` Rule 5 (Q5 implications block) remains out of scope for this plan; candidate for a future foundation-housekeeping change.

---

## 2026-05-22 — Validation record reference

The spec was validated by `/validate-v2` (4 parallel `flowspace-research-v2` agents covering Clarity, Completeness, Thesis Alignment, Forward-Compatibility). Results: 1 CRITICAL + ~20 HIGH issues; all CRITICAL/HIGH fixes applied in a follow-up edit pass. Full Validation Record appended to the spec at §Validation Record (2026-05-22). Raw agent outputs preserved at `/tmp/validate-002-spec/{clarity,completeness,thesis,forward-compat}.md` (ephemeral).

---

---
