# Execution Log — 008 harness-setup-flow (Simple, companion mode)

**Companion**: `code-review-companion` (minih) · run `2026-06-09T08-41-51-347Z-f8e3` · briefed at start.
**Harness pre-flight**: 🔴 UNAVAILABLE — this repo has no `docs/project-rules/engineering-harness.md`; fall back to standard testing (manual + e2e agent). Not an error.
**Testing**: Manual verification (T006) + `install-and-validate-test-extension` e2e agent (T007). Prompt+docs skill — no vitest.

## Companion findings reconciliation

| Finding | ackOf (review-request) | Severity | Disposition |
|---------|------------------------|----------|-------------|
| F001 | review-request: T001 3c9bcbc | MEDIUM | FIXED — Step 2 now documents the AC4 directory fallback (sentinel `latest.json` OR any file under `.harness/reports/harnessability/`). |
| F002 | review-request: T001 3c9bcbc | MEDIUM | FIXED — copyable commands now use `npx harness …` (matches the e2e recipe; bin not always on PATH after npm install). |
| F003 | review-request: fix-T001-F001-F002 38a9975 | MEDIUM | FIXED — README "What it does" realigned to the post-fix contract (`npx harness init`/`doctor`, directory fallback, doctor-degraded note). |
| F004 | review-request: T006 7c2b5f9 | MEDIUM | RESOLVED — AC7 PASS is now honest after the F003 README fix; verification.md AC7 row annotated. |

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

### T005 — Catalog update + reference sweep + leak guard ✅
- Updated `skills/README.md`: the `engineering-harness-setup` rows (situation/why, "set up" section, foundation→affordance rows, operating rule) now describe the lean install→assess→boot flow that generates nothing; report-location references updated to `.harness/reports/harnessability/`.
- Guards: `engineering-harness-setup/templates` refs in `skills/` = CLEAN; CREATE/VALIDATE/STATUS in the skill = CLEAN; private-identifier leak guard in the published skill = CLEAN.
- **Scope boundary (deviation note)**: `harness/assessment` still appears in `skills/harnessability-assessment/{README,SKILL}.md` — those are that skill's OWN current output paths and are the user's PARALLEL work (R2). Left untouched intentionally; the catalog now points at the agreed `.harness/reports/harnessability/` contract.
- **Archival refs left as history**: `docs/plans/002-*` and `docs/plans/003-*` reference the deleted templates as they existed then — historical plan records, out of the `skills/`-scoped sweep; not rewritten.
- ACs advanced: AC7; R3/R5 guards green.

### fix(T001 findings) — F001 + F002 ✅
- F001 (Contract Drift, MEDIUM): SKILL Step 2 check now `test -f latest.json || ls .../* ` and prose names the directory fallback — aligns with AC4/R2.
- F002 (Impl Quality, MEDIUM): all copyable command blocks use `npx harness …` (init/doctor/new/help/boot), with a one-line note that bare `harness` is fine if on PATH. Matches the install-and-validate-test-extension recipe.
- Companion T002/T003/T004 = APPROVE (0 issues).

### T006 — Manual verification walkthrough ✅
- Wrote `verification.md`: AC1–AC9 table (each AC → concrete check → PASS), an explicit AC8 envelope-only confirmation, and a lockstep table showing the skill's install+verify recipe matches the `install-and-validate-test-extension` e2e agent (`npm install github:AI-Substrate/...`, `npx harness doctor --json`, drives add-extension, verifies via doctor/help/verb).
- AC1–AC8 PASS by inspection; AC9 deferred to T007 (the e2e run).
- ACs advanced: AC8, AC9 (setup).

### T007 — e2e acceptance proof ✅ PASS
- Ran `install-and-validate-test-extension` (verbName=boot, variant=wrap, harnessSource=local), run `2026-06-09T08-54-42-126Z-7d46` → **verdict PASS**.
- Proof: in a throwaway repo the `add-extension` skill scaffolded `.harness/extensions/boot.ts` (wraps `npm run demo`) via `harness new`; independent checks: `doctor` loaded it, `help` listed `boot`, `boot --help` rendered usage, `npx harness boot --json` = status ok / exit 0. Temp repo cleaned up.
- This proves the install → add-extension(boot) → verify chain the SKILL orchestrates (AC9).
- Folded learning into SKILL Step 1.4: `harness doctor` is `degraded` in a fresh consumer repo (cli-build layer) — gate on "CLI runs + returns envelope (exit 0)" and read data.layers/extensions, not top-level `ok`.
- Friction (harness-CLI, out of scope here): local-source install packaged no `dist` (agent built a copy); the documented github path builds via `prepare`, so unaffected.
- ACs advanced: AC9. **All 9 ACs PASS.**
