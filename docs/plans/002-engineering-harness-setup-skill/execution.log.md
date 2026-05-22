# Execution log — engineering-harness-setup-skill (plan 002)

**Plan**: `engineering-harness-setup-skill-spec.md`
**Mode**: Simple Mode
**Testing strategy**: Manual (one dogfood run; no automated tests)
**Started**: 2026-05-22
**Compound**: skipped (no `docs/compound/`)
**Agent-harness pre-phase validation**: skipped (no `docs/project-rules/engineering-harness.md`)
**Flight plan**: deferred (per user)

## Task tracker

| # | Task | Status | Files touched | Notes |
|---|---|---|---|---|
| A | Scaffold the package | [x] | `skills/engineering-harness-setup/{SKILL.md (shell), AUTHORING.md, check.sh, templates/{canonical-boundary.txt, magic-wand-prompt.md, cli-envelope.schema.json}}` | Done. 6 files + dir. `check.sh` is POSIX, 5 subcommands. |
| B | Lift 13 brief-derived templates | [x] | `templates/{root-HARNESS.md, agents-md-snippet.md, harness-README.md, harness-config.json, cli-python-harness.py, cli-node-harness.mjs, harness-onboard-agent-session.md, harness-known-difficulties.md, harness-friction-log.md, harness-proof-note.md, friction-entry.md, cli-command-contract.md}` | 12 templates lifted; install-report.md exclusively Group C per H13 |
| C | Add 5 FR-NEW templates | [x] | `templates/{retrospective-schema.json, harness-config.schema.json, wrapper-recipe.template, install-report.md}` (canonical-boundary.txt done in A) | All FR-NEW templates landed; install-report has QT-04 verdict columns + QT-06 ceiling sentence + AC-13 neither-runtime row |
| D | Write SKILL.md body (Sections 0–4) | [x] | `SKILL.md` (full rewrite) | 18KB; Section 0 preamble + worked-example anchor, Section 1 eight principles with foundation citations, Section 2 14-step table + per-file merge policy, Section 3 21 non-goals, Section 4 5 known-limitations |
| E | Append README skills paragraph | [x] | `README.md` (EOF, 1 new section) | 3-sentence section linking to SKILL.md + AUTHORING.md |
| F | Dogfood against two greenfield targets | [—] | (deferred) | **User will dogfood separately in a new repo**; install-flow coherence validated structurally by `check.sh` + spec review |
| G | Run `check.sh all` + commit | [x] | 36 files staged in commit `5a097cf` | Commit message Conventional-Commits style; `.fs2/` excluded |

## Discoveries & learnings

| # | What | When | Severity | Notes |
|---|---|---|---|---|
| D1 | `check.sh privacy` was scoped too broadly | Group C self-check | medium | The check originally grep'd the whole package, but `AUTHORING.md` is repo-internal (legitimately references foundation paths in prose) and `check.sh` itself contains the patterns as data. Fixed by scoping to `SKILL.md` + `templates/` (the shipped surfaces). Spec AC-4 needs the same scope qualifier. |
| D2 | Pre-commit `check.sh placeholders` was conceptually wrong | Group C self-check | medium | Templates SHOULD contain `{{XXX}}` markers — they're install-time substitution targets. The runtime placeholder-leak check is correctly in the CLI (`assert_no_placeholder_leaks()` runs as the final step of `validate`). Replaced the pre-commit check with `placeholder-syntax`, which only verifies well-formedness (no `{X}}` or `{{X}` typos). |

## Per-task log

### Group A — Scaffold (completed)

- Created `skills/engineering-harness-setup/` package directory + `templates/` subdir.
- **A2 SKILL.md (shell)**: frontmatter `name` + `description` only (no `version` key, per H20). Body line `**Version**: 0.1.0`. Placeholder comment for Group D.
- **A3 AUTHORING.md**: repo-internal notes covering why-this-exists, source citations, foundation citation discipline, 5 load-bearing invariants with `check.sh` usage, v0.2 drift checklist (9 evolution paths).
- **A4 canonical-boundary.txt**: 58 bytes (sentence + single trailing newline, no commentary).
- **A5 magic-wand-prompt.md**: canonical wording + the six surfaces echoing it + what-counts-as-a-good-answer block.
- **A6 cli-envelope.schema.json**: JSON Schema Draft 2020-12; required `{command, status}`, optional `{data, error: {code, message, next_action?}, messages?}`; status and error.code enums per FR-04.
- **A7 check.sh**: POSIX shell; 5 subcommands (`boundary`, `privacy`, `magic-wand`, `placeholders`, `all`) + `--inline-fallback`; `chmod +x` set.
- No issues. Boundary and magic-wand greps will be re-validated after all templates land.

### Group C — FR-NEW templates (completed)

- **C1 retrospective-schema.json**: JSON Schema Draft 2020-12. Required: workedWell, confusing, magicWand (with byte-identical hybrid prompt as `magicWand.description`). Optional: magicWandTarget enum (project|harness|agent), proofLevel int 0–6, harnessCommandsRun array.
- **C2 harness-config.schema.json**: full field-level spec (the C1 fix from validation). Required keys: version, harness{name, cli_language, cli_path}, commands{install, build, test, lint, format_check, run, smoke}, health, validation{fast, quick, proof}, paths, permissions{allow_run, allow_health_probe}. `cli_language` enum allows `""` for the neither-runtime degraded path (AC-13).
- **C3 wrapper-recipe.template**: POSIX-shell skeleton with `{{COMMAND_NAME}}` / `{{TARGET_COMMAND}}` / `{{ENVELOPE_STATUS_SUCCESS}}` / `{{ENVELOPE_STATUS_FAILURE}}` placeholders. Tiny sed-based `json_escape` helper (no jq dependency).
- **C4 install-report.md**: rewritten from scratch with QT-04 sharpened verdict columns (`Ran` / `Outcome` enums), QT-06 proof-level ceiling sentence verbatim, AC-13 neither-runtime CLI row template, hybrid magic-wand close-out, USER-CONTENT sentinels for team additions.
- **Self-check fixes** (D1, D2): scoped `check.sh privacy` to shipped surfaces; replaced `placeholders` with `placeholder-syntax` (well-formedness only). Fixed two false-positive `{{…}}` mentions in cli-command-contract.md (replaced with `{{NAME}}` example). All 4 invariants now pass via `check.sh all`.

### Group D — SKILL.md body (completed)

- 18KB total. Section 0 (preamble) opens with when-to-use, the boundary sentence, and a worked-example anchor (sanitised FX007-style paragraph about encoding a single verify recipe after a class of bug bypassed all gates).
- Section 1: 8 principles (P1–P8), each with an HTML-comment foundation citation. Translated from imperative authoring voice to descriptive installed-skill voice per M9 fix.
- Section 2: 14-step install-flow table with verbatim question wording for FR-01, FR-02, FR-03, plus per-file merge policy table (per AC-12) with sentinel detection algorithm.
- Section 3: 21 non-goals.
- Section 4: 5 known limitations.
- `check.sh all` continues to pass (boundary count 7→8).

### Group E — README append (completed)

- Appended "Skills authored here" section to `README.md` EOF (LOW-3 fix — location pinned).
- 3 sentences (well within the ≤3-sentence rule).
- Links to `SKILL.md` and `AUTHORING.md`.

### Group F — Dogfood (deferred at user request)

- User opted to dogfood the skill separately in a new repo (i.e. outside this session). The structural invariants (`check.sh all`) all pass, but the install-flow's run-time coherence — the actual 14-step execution against a real target — is intentionally unverified in this session.
- **Sign-off impact**: 12 of 15 ACs structurally verified by `check.sh` + spec review; AC-6 (end-to-end invokable), AC-9 wrap-existing branch, AC-13 (neither-runtime degradation), AC-15 (long-running-boot lockdown) cannot be verified without a real install run.
- **Friction-log placeholder**: when the user dogfoods, the seed friction entry should land in the dogfood target's `harness/state/friction-log.md`, with a one-line back-reference appended to this plan's `decisions.md`.

### Group G — Pre-commit checks + commit (completed)

- `check.sh all` exit 0; all four invariants pass.
- Staged 36 files: the skill package (21 files), README.md modification, plan folder artifacts (14 files including 8 lenses).
- Excluded `.fs2/` (flowspace state, untracked artefact; should be added to .gitignore later — friction-log fodder).
- Commit `5a097cf` landed: `feat: add engineering-harness-setup skill (v0.1)`.
- Commit message documents Group F deferral and lists which ACs are structurally vs runtime-verified.

## Phase 1 complete

All 7 groups in their final states:

| Group | Status |
|---|---|
| A Scaffold | ✅ done |
| B Lift brief templates | ✅ done |
| C FR-NEW templates | ✅ done |
| D SKILL.md body | ✅ done |
| E README append | ✅ done |
| F Dogfood | ⏸️ deferred (user-driven, separately) |
| G Pre-commit + commit | ✅ done |

**Sign-off**:
- 4/4 invariants pass via `check.sh all`.
- Structural ACs 1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 14 verified by `check.sh` + spec review.
- Runtime ACs 6, 9 (wrap-existing branch), 13, 15 await user dogfood.
- One commit (`5a097cf`); `scratch/` remains ignored.

<!-- Phase 1 complete. -->
