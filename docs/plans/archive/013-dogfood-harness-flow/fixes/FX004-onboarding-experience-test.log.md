# Execution log — Fix FX004: onboarding-experience test

**Fix dossier**: [FX004-onboarding-experience-test.md](FX004-onboarding-experience-test.md)
**Mode**: `/plan-6` fix mode, no companion (user-directed: "lets not do code reviews, lets dogfood it") — FX004-8's E2E smoke is the verification pass.
**Pre-flight**: no `docs/project-rules/engineering-harness.md` → agent-harness validation 🔴 UNAVAILABLE → standard testing. Baseline `npm test` green (exit 0, lines 92.16%).
**Deviation (logged)**: session buffer held SUGG-001/SUGG-002 at phase start; the drain prompt is interactive, so the drain is deferred to the end-of-fix seam rather than blocking an autonomous run. FX004 itself encodes both entries.

## Stage 1 — FX004-1 + FX004-6 (`5fa96b0`)

- `prompt.md`: 256-line S0–S6 runbook → goal brief (−226/+61 across the change set). Kept (plumbing): `$PROJECT_ROOT` fallback block, parameters, throwaway rule, abandonment-is-valid, generic router rail, report path + schema pointer, dual-layer friction framing, the user's de-bias magic-wand wording. Dropped: the recipe, skill wiring, skill names, grade bands, BIO/governance, `latest.json`, envelope/exit semantics, FX001 caveat, `--prefix`.
- `agent.json`: description + `files[]` rewritten to onboarding-probe framing; version bumped 0.1.0 → 0.2.0.
- `eng-harness-0-setup` SKILL.md install step 2: gained the no-`package.json` guard (`[ -f package.json ] || npm init -y`, `--prefix` pin alternative) — same change set as the prompt drop.
- **Evidence**: drop-list greps CLEAN on prompt + agent.json; `--prefix` lives only in the setup skill (the `agents/*/runs/` hits are frozen historical snapshots); `minih run … --dry-run` previews the goal brief.

## Stage 2 — FX004-2 (`469fc6b`)

- Worker rules de-leaked: 8 rails counted present; skill enumeration, `eng-harness-flow` slug, D/E/F bands, governance exception, exit-code enumeration all gone; pinned honest-statuses wording in place.
- **Evidence**: rules grep CLEAN (`eng-harness-|grade [A-F]|D/E/F|governance|exit [0-9]`); full assembled dry-run prompt grep CLEAN.

## Stage 3 — FX004-3 (`154dddc`)

- `output-schema.json`: `governanceWritten` (required + property) and `governancePath` removed; four description strings de-leaked (see Discoveries — judgment call: the schema is composed into the worker context). Experiential layer untouched.
- **Evidence**: `minih check validate-harness-flow --file <sample>` → `valid: true` for governance-free PASS and ABANDONED samples; `grep -i governance` → no key.

## Stage 4 — FX004-4 + FX004-5 (`9074a62`)

- `SKILL_FLAGS` → 7 skills, programmatically verified EXACT parity with `.minih.json` `include`.
- Probes: `probeClone()` runs per DONE clone via `<clone>/node_modules/.bin/harness` (no npx fallthrough to the npm `harness` package). Graded: assessed, doctor-conventions-clean, boot-envelope-honest (with the `command === "boot"` guard — see Discoveries), retro-record-frontmatter, drained, temp-ignore, temp-clean, skills-local (both groups, mount doesn't count). INFO: pending/recorded counts. Discrepancy cross-check on `bootRuns`/`retroRecorded`.
- Rollup: Gov column removed; probes table + fail-notes + ⚠️ discrepancies section + asymmetry/mount-suppression legend; `engineering-harness.md` copy expectation dropped; per-state applicability (PASS/FAIL full · ABANDONED assessed-only · others `—`).
- **Evidence**: fixture clone (local install + 1 undrained capture + no boot/retro + over-claiming report) → drain ✗ "1 pending undrained", boot ✗ "no boot verb", `bootRuns` + `retroRecorded` discrepancy rows, no Gov column, Observe INFO "1 pending / 0 recorded". Extension `loaded` in doctor.

## Stage 5 — FX004-7 (`7d705eb`)

- Operator briefing + how-to guide refreshed rich: governance gone, goal-brief framing, probes-first review order, graded-vs-INFO rationale, mount-suppression caveat, dual-retro separation preserved, see-also paths fixed.
- **Evidence**: governance grep CLEAN across both files.

## Stage 6 — FX004-8 (E2E smoke)

- Fired: `harness validate-harness-flow --repo https://github.com/chalk/chalk.git --keep` → runId `2026-06-10T15-03-58-372Z-07c4`, clone at `/tmp/harness-flow-selftest-2026-06-10T05-03-54-224Z/chalk`.
- **Terminal in ~12.7 min** (760s watcher; 86+ tool calls). `--collect`: DONE 1, 4 files copied, report **schema-valid** (`minih check` green, no `governanceWritten`).
- **Journey (goal brief only — no recipe)**: product README → installed CLI into clone → assessment skill (grade B, axis C/B, "workable, not abandoned") → `harness new boot --wrap "npm test"` via the add-extension flow → independent verification (`doctor`/`help`/`instructions boot`/`boot --json`) → **discovered `harness observe` unaided, captured 3 entries, drained them into a retro record** via `harness record retro`.
- **Probes: 7/8 ✓, 0 discrepancies.** Boot extension judged real, not echo (chalk's actual xo/c8-AVA/tsd lane + orientation + coverage evidence). In-clone retro: 3 frontmatter-valid entries with workarounds + suggested encodings, self-derived magic wand. Buffer drained (0 pending / 3 recorded INFO).
- **Skills-local ✗ — the run's headline finding.** Not classic mount-suppression: the worker read INSTALL.md/README/setup Step 4 (22 doc-read mentions in events) and obeyed the product's own guardrail — Step 4 is *opt-in* ("offer, never force; only with the user's explicit go-ahead"), and a headless worker has no user to ask. The clone-stands-alone requirement and the human-gated install step are in tension → SUGG-005, user decision.
- **Findings surfaced (never auto-implemented), captured via our own `harness observe`**: SUGG-003 local-source install ran the harness `prepare` script inside chalk's dep graph (worker isolated-build + `--ignore-scripts` workaround; magic wand = deterministic pack-artifact install) · SUGG-004 `harness init` emits generic E108 vs the documented graceful init-unavailable fallback · SUGG-005 skills-install opt-in vs autonomous onboarding (above) · SUGG-006 minor pair: `instructions` auto-JSON on non-TTY pipes; observe doc examples should single-quote backtick-bearing text.

## Verdict

FX004 acceptance: **10/10 ticked**. The test now measures onboarding: the worker navigated by the product's own docs/skills with zero recipe, the extension graded the clone deterministically, and the one probe failure produced exactly the kind of product-design finding the rework exists to surface.

## Regression

- Baseline before edits: green. Full suite re-run after FX004-1…7: **47 files, 374/374 passed** (no CLI surface touched; extension loads `loaded` in doctor).
