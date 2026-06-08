# Execution Log — 008 harness-setup-flow (Simple, companion mode)

**Companion**: `code-review-companion` (minih) · run `2026-06-09T08-41-51-347Z-f8e3` · briefed at start.
**Harness pre-flight**: 🔴 UNAVAILABLE — this repo has no `docs/project-rules/engineering-harness.md`; fall back to standard testing (manual + e2e agent). Not an error.
**Testing**: Manual verification (T006) + `install-and-validate-test-extension` e2e agent (T007). Prompt+docs skill — no vitest.

## Companion findings reconciliation

| Finding | ackOf (review-request) | Severity | Disposition |
|---------|------------------------|----------|-------------|
| _(none yet)_ | | | |

## Task log

### T001 — Rewrite SKILL.md as the lean 3-step flow ✅
- Replaced the 621-line generative SKILL.md with a 159-line orchestration flow: mermaid DAG + Step 1 install (npx + future `harness init` w/ graceful fallback + troubleshooting table) + Step 2 conditional harnessability-assessment (sentinel `.harness/reports/harnessability/latest.json`) + Step 3 basic `boot` via add-extension (verdict + orientation; boot-shape table by repo type) + verify (doctor/boot/help).
- Removed CREATE/VALIDATE/STATUS modes, project-type detection, governance/CLI/docs-harness generation.
- Kept the canonical boundary line "The agent harness drives. The engineering harness proves."
- Guardrails: orchestrate-not-generate, wrap-don't-rebuild, don't-boil-the-ocean, public-safe, envelope-only (AC8).
- Self-check: no stale mode refs (only the explicit "does not generate" line); no private identifiers (the `AI-Substrate` URL is the public repo); mermaid + sentinel + #11/#12 framing present.
- ACs advanced: AC1, AC2, AC3, AC5, AC5a, AC8 (+AC6 framing). Findings 01,02,03,05 addressed in prose.

### T002 — Rewrite README.md with the mermaid DAG ✅
- Replaced the 147-line layered-harness/generation README with a 61-line lean view: same flow mermaid DAG, When to use, What it does (3 terse steps), What it does NOT do, Where it fits (setup -> assessment -> add-extension(boot) -> runtime loop), and the kept agent-vs-engineering-harness boundary diagram + sentence.
- References `.harness/reports/harnessability/latest.json`; no generated-governance/CLI/template prose remains.
- Companion: T001 acked on inside lane (oriented + ack); no findings yet.
- ACs advanced: AC7, AC1.

### T003 — Update AUTHORING.md to orchestration-only ✅
- Replaced the 91-line template-invariant authoring notes (byte-identity / magic-wand / placeholder-syntax / CLI-envelope-schema invariants) with 34 lines of orchestration-era invariants: orchestrate-don't-generate, chain-the-siblings, report-sentinel contract, boot-stays-basic, public-safe, envelope-only, canonical boundary, `harness init` forward dependency.
- Removed the private codename reference that was in the old Sources list (P12).
- ACs advanced: AC6, AC7.

### T004 — Delete all 19 templates ✅
- `git rm -r skills/engineering-harness-setup/templates/` — 19 files removed (cli-python-harness.py, cli-node-harness.mjs, root-HARNESS.md, harness-config{.json,.schema.json}, cli-{command-contract.md,envelope.schema.json}, agents-md-snippet.md, magic-wand-prompt.md, retrospective-schema.json, harness-{known-difficulties,friction-log,proof-note,README,onboard-agent-session}.md, friction-entry.md, docs-harness-backpressure-README.md, install-report.md, canonical-boundary.txt).
- The skill now ships only SKILL.md + README.md (+ repo-internal AUTHORING.md). Reference sweep is T005.
- ACs advanced: AC6.
