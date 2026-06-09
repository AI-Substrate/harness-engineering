# Execution Log — 010-harness-skills-install

**Mode**: Simple · **Plan**: harness-skills-install-plan.md (v1.1.0) · **Branch**: feat/harness-cli-core
**Companion**: code-review-companion · run `2026-06-09T13-48-38-077Z-bc4a` (Power-On-Mode)
**Baseline**: build OK; 36 test files / 213 tests green; coverage ~93%.

minih self-onboarding: https://github.com/AI-Substrate/minih/blob/main/AGENTS_README.md · companion-mode: https://github.com/AI-Substrate/minih/blob/main/docs/how/companion-mode.md

No `docs/project-rules/engineering-harness.md` → no agent-harness pre-flight; standard testing (Lightweight).

## Companion findings disposition

| Finding | ackOf (task/sha) | Severity | Disposition |
|---------|------------------|----------|-------------|
| _(none yet)_ | | | |

## Per-task log

### T004 — live docs + configs rename (G2)
- Updated: `.minih.json` (include → 7 new nested slugs), root `README.md` (install section + two-group skill listing), `INSTALL.md` (title + skills table → 7 slugs + `-s` examples), `docs/how/extend-the-harness.md` (add-extension path/slug), `skills/README.md` (full rewrite: two categories, `harness skills install`, loop now hosted here), `docs/.../docs-manifest.json` summary, regenerated `docs-content.ts` (`npm run gen:docs`).
- **Dogfood agents** (`agents/validate-harnessability-assessment-skill/`, `agents/install-and-validate-test-extension/`): fixed the *hard wiring* in live definition files (non-`runs/`) — broken skill PATHs (`skills/<oldslug>/` → relocated), `--skill <slug>`, and `.minih.json include` examples now point at the new slugs/paths. **Intentional scope boundary**: their conceptual prose, agent NAMEs, and output-schema enum *labels* still say the old slug — these are not dangling filesystem links, and a full identity migration of these plan-006/009 agents is a follow-up (parallel to the accepted external `the-flow`/`plan-6` slug follow-up). `runs/**` history left untouched.
### T011-T013 — G5: build/install/docs
- **T011**: `npm run build` OK · `npm run lint` OK · 37 files / 227 tests green · `check:docs` clean.
- **T012 (real install proof)**: `npx skills add <repo> -l` → **Found 7 skills** (nested `eng-harness-{setup,loop}/<slug>/` layout discovered — discovery-depth risk resolved). Then `harness skills install --target claude-code --source <repo>` from inside a `mktemp -d` repo → clean `ok` envelope (exit 0), `data.command` echoed the exact npx line; all **7 `eng-harness-*` skills** landed in `<tmp>/.claude/skills/` (project-local). Temp dir removed. Proves AC2/AC3/AC11/AC12. (Installer deploys by leaf slug — confirms why the self-describing `eng-harness-*` prefix matters.)
- **T013**: documented `harness skills install` in `harness/cli/README.md` (command table + reserved list + usage example); regenerated `docs-content.ts`; `check:docs` clean.
