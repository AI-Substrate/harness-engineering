# Execution Log — Phase 3: Scenario #1 (md→PDF) + orchestration + docs

**Built via**: /flow-pair (control-plane) · **Coder**: Claude Opus 4.8 xhigh (pij-1s7r0mw) · **Reviewer**: codex GPT-5.5 xhigh (pij-15ij99o, cross-model) · **Branch**: feat/041-flow-conformance-eval · **Run**: 2026-06-29T04-47-44Z

## Outcome: ✅ COMPLETE + APPROVED (after A7 + verbatim fixes)

| Task | Status | Notes |
|------|--------|-------|
| T001 | [x] | `scenario.json` — from `scaffold`, pinned `base.ref=v0.6.0` (real tag), subject defaults claude/opus, Simple-flow choreography |
| T002 | [x] | `prompts/subject.md` — BLIND packet + reviewer-only forbidden-content checklist. **Blind audit PASSED** (reviewer + orchestrator independent scans: only worktree/markdown/PDF/mermaid WHAT above the gate; zero method/flow/measurement/backpressure leakage) |
| T003 | [x] | `prompts/orchestrator.md` — full choreography incl. `plan --simple` + compact-before-implement; resolves `SUBJECT_PDF_VALIDATOR` (A8) + `SUBJECT_EXTENSION_HELP` (A7, post-fix) tokens before scoring |
| T004 | [x] | `assertions.json` — A1..A11; valid registry types/lanes; A11 judged (backpressure-checker offered). **A7 corrected** (see review) |
| T005 | [x] | `e2e-md-to-pdf.test.ts` — scoring over synthetic evidence + fake worktree (no live spawn); strengthened to script command rows + a negative A7 mutation |
| T006 | [x] | `docs/how/flow-conformance-eval.md` — guide (24 mermaid fences parse, markdown-lint 0 findings) |

## Review (cross-model)
- **P3 review** → FIX_REQUIRED. **Blind audit PASSED** (headline). **Dim-0 SATISFIED** (evidence `checks:[ok→error]` mutation flipped the A9 score row red @ e2e:111). Findings:
  - **CRITICAL A7 false-pass**: A7 used `node …/doctor` exit-0 to prove the subject extension loaded — but `doctor` **always exits 0** (`doctor.ts:22`), reporting `degraded` for a failed extension. A required assertion that can't fail. → **Fixed**: A7 → a `SUBJECT_EXTENSION_HELP` placeholder the runbook resolves to `<new-verb> --help` (exits nonzero if the verb didn't register); e2e strengthened (FakeExec scripts command rows + a negative A7 mutation).
  - **CRITICAL exec log missing** → **this file** (orchestrator-owned; coder forbidden from `docs/plans/**`).
  - **MEDIUM verbatim**: subject.md task text was semantically (not literally) equal to scenario.json → **fixed**: exact copy (one source of truth).

## Gates
- vitest 1647→ (e2e strengthened); tsc clean; markdown-lint 0 findings (24 mermaid fences parse); windows-check ok; engine frozen (no `.harness/extensions/flow-eval/*.ts` changed).
- Orchestrator fix: `.harness/live-testing/` added to `.gitignore` (the LOW report-noise finding).

## Carry-forward (the live eval — operator-driven, NOT in this plan)
The deterministic build is complete. Actually running a live eval (spawn a blind subject → drive through the-flow on the md→PDF task → `flow-eval score`) is the operator-driven payoff, surfaced to the user as a decision point.
