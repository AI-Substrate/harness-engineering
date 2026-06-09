# Retro — Plan 009 Harnessability Assessment v0.2 (survey the existing engineering environment)

**Date**: 2026-06-09 · **Mode**: Simple, single phase (companion build) · **Verdict**: clean after fixes (companion HIGH finding F004 fixed + verified; F002 fixed; F001 dispositioned; F003 already resolved)

## Companion (code-review-companion) — run 2026-06-09T12-00-15-857Z-e2a9

- **Reviewed**: 10 commit-boundary task pings (T001–T018 + T016b), one per commit, with a per-commit summary verdict.
- **Findings**: 4 sent, all dispositioned:
  - **F004** (Implementation Quality, **HIGH**) — the G5 dogfood verb backgrounded `minih` via a `bash -c` string with unquoted, user-controlled `dest`/`model`/`logPath` (shell-injection + temp-escape via a malformed `--repo`/`--model`). → **FIXED**: rewrote the fire to a positional-arg wrapper (`bash -c 'log="$1"; shift; nohup "$@" > "$log" 2>&1 & echo $!' …`) so no user value is shell-parsed, plus a sanitized/de-duped `repoName()`. Verified the injection payload stays literal and an e2e re-fire still captures the runId.
  - **F002** (Testing & Evidence, MEDIUM) — `manualOperationSignal.influences` validated any `^[AB][0-9]+$`, looser than the prose rule (A4/A5/A7/A8/A9/B5/B10 only). → **FIXED**: schema enum tightened + a step-6b population bullet added.
  - **F001** (Contract Drift, MEDIUM) — tracked plan docs still carried current-state "producer still writes `harness/assessment/`" wording after T004 landed. → **PARTIAL (accepted)**: resolved-markers added to the two authoritative docs (spec + plan); raw research-dossier/original-ask left as point-in-time historical capture.
  - **F003** (Contract Drift, MEDIUM) — AUTHORING.md still described the v0.1 contract. → **Already resolved** by T014; companion confirmed in its T014 summary.
- **Phase verdict**: REQUEST_CHANGES until F004 fixed → now fixed + verified.

## Orchestrator (me)

- **Worked well**: the companion caught a **real HIGH security bug I missed** — I hand-built the background-fire as an interpolated `bash -c` string and never considered that a `--repo`/`--model`/`dest` value could carry shell metacharacters. A second pair of eyes flagged it at commit time, when the fix was a cheap, local refactor to positional-arg passing. Earlier, `validate-v2` had already caught the **run-ID-capture impossibility** (minih `run.json` doesn't persist params) during the *spec* phase — two different review tiers each caught a distinct class of defect before it shipped. The schema-first discipline held: every commit re-validated `assessment-latest.json` against the evolving schema, so the 12 additive arrays + A–F + the example never drifted out of contract.
- **Friction**:
  - **OH-009-01 — shelling out from an extension is an injection hazard by default.** Building a background command as an interpolated `bash -c` string is the obvious path and the wrong one; the safe pattern is passing every user value as a literal argv (`… "$@"`). There's no compiler or lint to catch this for `.harness/extensions/*` (it's outside biome's scope), so the companion was the only backstop.
  - **OH-009-02 — encode constraints in the schema, not just prose.** I wrote the manual-signal influence whitelist (A4/A5/A7/A8/A9/B5/B10) into SKILL.md prose but left the JSON schema accepting any dimension. The authoritative contract was looser than the documented rule until F002.
  - **OH-009-03 — plan-doc current-state wording goes stale the moment the work lands.** "The producer still writes X" was true at spec time and false after T004; a future reader of the spec/plan would be misled. Motivating findings should be phrased in past/conditional tense or carry a resolved-marker.
- **Magic wand** (project / harness CLI): give extension authors a **safe backgrounding affordance** so nobody hand-rolls `nohup`/`bash -c` — e.g. a `ctx.execDetached(cmd, args, { logPath })` helper on the VerbContext that does the positional-arg wrapper + PID capture correctly, eliminating the F004 class of bug at the contract level.

## Cross-agent / cross-plan signal

- **The `minih` project-root coordination gap recurs.** The G5 worker agent relies on `cd $MINIH_PROJECT_ROOT` (the SDK session starts in the run dir, not the repo root) — the same env/coordination gap flagged in the 006/007/008 retros. High-confidence upstream item for minih.
- **Docs/JSON reworks have no compiler.** As in 008, the dominant friction in a skill-package rework is surface drift with no type-checker to catch it; the schema-as-contract + the companion (or a deterministic propagation check) are the only backstops. Here the schema caught regrades/validity automatically, but the *prose-vs-schema* gap (F002) and *shell-string* gap (F004) needed the second reviewer.

## Follow-ups

- **FU-009-01** (harness CLI): add a safe-detached-exec affordance to `VerbContext` (or document the positional-arg `"$@"` pattern in `add-extension`/AUTHORING) so extensions that background a process can't hand-roll an injectable `bash -c` string. (Companion F004 magic wand.)
- **FU-009-02** (minih, coordination): `MINIH_PROJECT_ROOT` should point to the git root in every run (recurring across 006/007/008/009).
- **FU-009-03** (skill-authoring): when a skill's prose states a constraint (an allowed-value whitelist, a required relationship), encode it in the JSON schema too — the schema is the authoritative contract, prose is not enforced.
- **Dogfood evidence (the point of G5)**: the verb fired two real worker runs against `spf13/pflag` (`validate-harnessability-assessment-skill` runs `2026-06-09T12-28-12-132Z-d68d`, `2026-06-09T12-37-48-485Z-4c7d`). Review their completed `output/report.json` (verdict + magic-wand retro) with `minih status validate-harnessability-assessment-skill` and fold any skill-targeted magic wands into a future v0.3. This is the self-improving loop the dogfood verb exists to drive.
