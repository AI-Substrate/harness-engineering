# Execution Log — 010-harness-skills-install

**Mode**: Simple · **Plan**: harness-skills-install-plan.md (v1.1.0) · **Branch**: feat/harness-cli-core
**Companion**: code-review-companion · run `2026-06-09T13-48-38-077Z-bc4a` (Power-On-Mode)
**Baseline**: build OK; 36 test files / 213 tests green; coverage ~93%.

minih self-onboarding: https://github.com/AI-Substrate/minih/blob/main/AGENTS_README.md · companion-mode: https://github.com/AI-Substrate/minih/blob/main/docs/how/companion-mode.md

No `docs/project-rules/engineering-harness.md` → no agent-harness pre-flight; standard testing (Lightweight).

## Companion findings disposition

Companion `code-review-companion` run `2026-06-09T13-48-38-077Z-bc4a` — 11 tasks reviewed, **7 findings** (surfaced in the farewell envelope; final verdict REQUEST_CHANGES). All resolved post-phase in a `fix:` commit:

| Finding | ackOf (task) | Severity | Disposition |
|---------|--------------|----------|-------------|
| F001 — schema_version contract drift (T003 sed wrongly rewrote `harnessability-assessment.v0.2` → `eng-harness-0-…` in assessment SKILL/README prose, breaking match with the shipped schema + example) | T003 | HIGH | **FIXED** — reverted the 3 prose occurrences to `harnessability-assessment.v0.2`; verified consistent with `assessment-report.schema.json` const + `assessment-latest.json`. |
| F002 — `.minih.json` `path:skills` does not recurse the new 2-level layout; `minih skills doctor` discovered 0 (E211 ×7) | T004 | HIGH | **FIXED** — sources now `path:skills/eng-harness-setup` + `path:skills/eng-harness-loop`; `minih skills doctor` → status ok, 7 discovered/selected, no diagnostics. |
| F003 — `extend-the-harness.md` intro still said `add-extension` | T004 | MEDIUM | **FIXED** — intro → `eng-harness-0-add-extension`; gen:docs re-run. |
| F004 — `buildInstallArgv` `yes:false` opt-out could omit `-y` (violates AC3) | T006 | HIGH | **FIXED** — removed `yes` from the contract; `-y` is now appended unconditionally (builder cannot construct a blocking invocation). |
| F005 — live docs (`extend-the-harness.md`, `authoring-verbs.md`) still listed core set as help/doctor/new/docs only | T008 | MEDIUM | **FIXED** — added `skills` to the built-in/reserved lists in both; gen:docs re-run. |
| F006 — `skills.test.ts` locked in the `-y` opt-out (contradicts AC3) | T009 | HIGH | **FIXED** — replaced with an invariant test asserting `-y` is always present. |
| F007 — execution-log disposition table still `(none yet)` while findings were open | — | MEDIUM | **FIXED** — this table. |

### Companion debrief (farewell envelope)
- Verdict at stop: REQUEST_CHANGES (7 open findings) → **all 7 now fixed + re-verified** (build/lint/227 tests/check:docs green; `minih skills doctor` ok; real install still lands 7 skills).
- Worked well: inbox `ackOf` correlation tied each finding to its task; the final drain gave a clean re-audit point.
- Companion **magic-wand** (target: coordination): "Add a companion-mode findings-ledger command that renders all inside findings + their ackOf + disposition + whether they appear in the plan execution log — to prevent final logs saying 'none yet' while findings are open." → candidate follow-up.
- Companion difficulties: MH-001 `MINIH_PROJECT_ROOT` resolved to the run dir not repo root (used `git rev-parse --show-toplevel`); MH-002 `minih skills doctor` exits 0 while status degraded (read the envelope, not exit code); MH-003 large `git show` output truncation (bounded checks).


## Per-task log

### T004 — live docs + configs rename (G2)
- Updated: `.minih.json` (include → 7 new nested slugs), root `README.md` (install section + two-group skill listing), `INSTALL.md` (title + skills table → 7 slugs + `-s` examples), `docs/how/extend-the-harness.md` (add-extension path/slug), `skills/README.md` (full rewrite: two categories, `harness skills install`, loop now hosted here), `docs/.../docs-manifest.json` summary, regenerated `docs-content.ts` (`npm run gen:docs`).
- **Dogfood agents** (`agents/validate-harnessability-assessment-skill/`, `agents/install-and-validate-test-extension/`): fixed the *hard wiring* in live definition files (non-`runs/`) — broken skill PATHs (`skills/<oldslug>/` → relocated), `--skill <slug>`, and `.minih.json include` examples now point at the new slugs/paths. **Intentional scope boundary**: their conceptual prose, agent NAMEs, and output-schema enum *labels* still say the old slug — these are not dangling filesystem links, and a full identity migration of these plan-006/009 agents is a follow-up (parallel to the accepted external `the-flow`/`plan-6` slug follow-up). `runs/**` history left untouched.
### T011-T013 — G5: build/install/docs
- **T011**: `npm run build` OK · `npm run lint` OK · 37 files / 227 tests green · `check:docs` clean.
- **T012 (real install proof)**: `npx skills add <repo> -l` → **Found 7 skills** (nested `eng-harness-{setup,loop}/<slug>/` layout discovered — discovery-depth risk resolved). Then `harness skills install --target claude-code --source <repo>` from inside a `mktemp -d` repo → clean `ok` envelope (exit 0), `data.command` echoed the exact npx line; all **7 `eng-harness-*` skills** landed in `<tmp>/.claude/skills/` (project-local). Temp dir removed. Proves AC2/AC3/AC11/AC12. (Installer deploys by leaf slug — confirms why the self-describing `eng-harness-*` prefix matters.)
- **T013**: documented `harness skills install` in `harness/cli/README.md` (command table + reserved list + usage example); regenerated `docs-content.ts`; `check:docs` clean.
