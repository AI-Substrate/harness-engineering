# Validation — typed-extensions-sensors-plan.md

**Validated**: 2026-07-15 · **Validator**: independent Opus critic (read-only) + lead adjudication · **Revision**: post workshop-002 fold (supersedes the 2026-07-14 plan-v1.0.0 validation — that record is in git history)

## Verdict

✅ **VALIDATED WITH FIXES** — 1 critical, 1 high, 1 medium, 1 low; all verified at source by the lead, fixed across the affected artifacts, re-verified.

- **Target**: `typed-extensions-sensors-plan.md` (with workshop 002 decisions folded in) + its consumption seams (workshop 002, spine annotations, phase-2 tasks dossier)
- **Proof**: critic cross-checked all four documents plus the real repo: E210–E217 genuinely free; `sensors` in api-2 vocabulary (contract.ts:254); FsPort.rename atomicity real; runtime deps exactly commander+jiti; `.gitignore:168` covers `.harness/temp/`; RESERVED_NAMES = 10 names without `sensors`; **private-consumer evidence claims verified verbatim in the private-consumer source** (skip-safe gitleaks `pass|fail|skipped`, secrets HARD GUARD, only-error-exits-non-zero); spine E1/E3/E5 genuinely closed; S1–S12 internal soundness (trigger split, failStreak-vs-skip, heartbeat math) holds.
- **Consumers**: implement verb (Phase 2), Phase 3 TUI (same state files), CI (`check` posture) — all named needs addressed post-fix.

## Findings

| # | Severity | Finding | Fix applied |
|---|----------|---------|-------------|
| F1 | CRITICAL | The daemon-down/fresh-repo reader path was specified as `unconfigured` — which **exits 2** by the core status contract (`exit.ts` `EXIT_BY_STATUS`), falsifying AC-13's "only `sensors check` exits non-zero" on every first-touch repo. the private consumer's `checks` extension hit and documented this exact trap (dlg-0003-fix1) — the workshop cited that file without applying its lesson | New decision **S13** (reader paths emit `degraded`, never `unconfigured`) added to workshop 002; daemon-down paragraph rewritten with the exit-contract rationale; AC-09 reworded; tasks T009 + Context-Brief sequence diagram updated; spine D2 annotated as superseded on this path |
| F2 | HIGH | Workshop 002's `--json` worked example — explicitly "the agent contract" — showed a timed-out sensor as `runStatus: "error"` with `error.code: E212`, collapsing the three-way `ok\|error\|timeout` S3 deliberately created | Example corrected to `runStatus: "timeout"` |
| F3 | MEDIUM | The justified `skip` widening of `SensorReading.state` (002 S2/Q1) was not propagated to what the coder reads: spine B2 still said `pass/warn/fail`, tasks T001 text likewise, and T002's red lane named no skip-semantics tests (failStreak no-move, trend-excluded, check-not-failed — the semantics most likely to regress silently) | T002 extended with explicit skip-state coverage; T001 text updated; spine B2 annotated with the 002 S2/Q1 widening |
| F4 | LOW | picomatch (002 S8, third runtime dep) had no mechanical landing step: plan Dependencies line still said "none external", and no task carried `package.json` | Plan Dependencies line updated; plan task 2.5 and tasks T008 now carry `package.json` + "declare picomatch" |

## Notes

- F1 is the standout: a cross-artifact contradiction between the workshop's surface spec and a core contract file (`exit.ts`) that no single-document read would catch — and the corrective evidence was already sitting in the wild-extension file the workshop itself cited. Independent validation with repo access earns its cost here.
- All groundedness spot-checks passed on first read this cycle (second consecutive artifact where the "verified by read" discipline survived independent re-verification).
