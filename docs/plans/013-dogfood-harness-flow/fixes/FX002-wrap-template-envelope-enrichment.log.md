# Execution Log — FX002: `harness new --wrap` sparse boot Envelope

_Created by plan-5 fix mode; populated by plan-6-companion during implementation._

## Session — 2026-06-10 (plan-6-v2-implement-phase-companion)

**Companion**: `code-review-companion`, run `2026-06-10T08-17-07-782Z-1e56` (Power-On-Mode, booted fresh this session).

### Pre-flight
- Confirmed `ExecResult` (`harness/cli/src/adapters/exec/exec-port.ts:9`) is `{ code, stdout, stderr, ok }` — `stdout` already present, so the success-branch enrichment needs **no** exec-port/contract change (dossier non-goal held).
- Re-confirmed (FX001 carry-over) the CLI builds from the **root** package — there is no `harness/cli/package.json`; build = `npm run build` at root, suite = `cd harness/cli && vitest run`. Running vitest from the repo root mis-resolves the `NodeFs` real-fs tests (4 cwd-environmental failures) — not regressions; from `harness/cli` cwd all 277 pass.

### FX002-1/2/3 — enrich wrap templates (single coupled commit `0aad609`)
- `templates.ts`: `wrapTs` + `wrapJs` — summary `TODO: summary (wraps …)` → `Wraps \`<command>\`.`; success branch now self-times (`const started = Date.now()` … `const durationMs = Date.now() - started`) and returns `ctx.ok({ command, durationMs, stdout: tail })` where `tail = r.stdout.trimEnd().split('\n').slice(-20).join('\n')`. **Error branch byte-identical**; `splitCommand`/`argsLiteral` untouched; minimal/record templates untouched.
- **Escaping note**: in the builder template literals the tail line is written `.split('\\n')…join('\\n')` so the *generated* extension source contains literal `\n`; the byte-exact fixtures (`WRAP_TS_TEST`/`WRAP_JS_TEST`) mirror the same double-escape. Verbatim tests passing proves builder↔fixture byte-equality held.
- `templates.test.ts`: both wrap fixtures updated to the enriched bytes. The multi-token-split **partial-match** test (`~111-116`, asserts `ctx.exec('just', ['ci-smoke'])` + `re-run \`harness ci-smoke\``) was left untouched — those substrings survive the enrichment.
- Workshop `006/.../001-…md` §4b (the full ts code block) synced to the new bytes; §4d is prose ("Same body as 4b…") with no separate block — correctly left as-is.
- Coupling: FX002-1 (builder) and FX002-2 (fixtures) cannot land independently green — the verbatim tests would fail — so all three tasks landed as one commit, which is also the FX002-3 commit boundary.

### Verification
- `npm run build` (root): exit 0 (incl. `gen:docs` — regenerated `docs-content.ts` byte-identical, nothing to commit).
- `cd harness/cli && npx vitest run`: **277/277** pass (no new tests — the existing byte-exact fixtures are the contract; they now assert the enriched output).

### Companion timeline
- 22:18:23Z — briefing sent (msg `01KTQ7E7ZXJWT3RKCY6PJ2C0T5`); included the FX001 retro lesson (MH-003): I will drain the inbox before `control:stop` and reflect real finding history.
- 22:18:30Z — review-request `FX002-1/2/3 0aad609` sent (msg `01KTQ7JEEFTEJZ33RBXE18TA58`, peer listening; fire-and-forget).
- 22:20:52→22:22:52Z — companion read commit `0aad609`, transitioned reading→reviewing ("auditing FX002 diff for contract and fixture drift"), ran drift `rg` sweeps for the old `TODO: summary` / `ctx.ok({ command })` patterns, inspected `0aad609` + `d58ce54` + the dossier, then sent a `summary`.
- 22:28:57Z — `control:stop` honoured; farewell `report.json` written (`exitReason: stop_requested`).

### Companion verdict (drained) — APPROVE, 0 findings
- **Verdict** (msg `01KTQ7PFHK5E5KVR7FX9K5DH3V`): "**APPROVE. Findings: 0.** The commit changes only the intended scaffold builder, byte fixtures, and workshop §4b code block; wrapTs/wrapJs now emit the exact requested summary, Date.now() duration, and bounded stdout tail while preserving the error branch, partial-match substrings, and minimal/record templates. Drift scan found the old sparse-envelope wording only in intentional FX002 problem/history context, not live scaffold docs; the scaffold template test passes when run with the correct vitest-root-relative filter."
- Session counts: 1 task received, **0 findings**, 1 summary (APPROVE), 0 questions.
- **MH-003 lesson applied (and confirmed)**: I drained the inbox and sent a `control:stop` body reflecting the *real* finding history (1 task / 0 findings / APPROVE), not a blanket "clean". The companion's farewell `workedWell` explicitly credits this: *"the outside peer sent an accurate stop message with the real finding history."*

### Companion retrospective (harvested → `docs/retros/code-review-companion.md`)
- **Worked well**: precise hazard briefing; **accurate stop message with real finding history**; coordination inbox/state tools made it easy to correlate the APPROVE summary back to the review request.
- **Confusing / difficulty MH-001 (test)**: the root `npm test` script does `cd harness/cli && vitest run`, so a filter path of `harness/cli/test/...` matches **no** files yet still exits 0 — the same cwd nuance I hit. Workaround: filter relative to the vitest root (`npm test -- --run test/services/scaffold/templates.test.ts`). _Carry-forward: this cwd/filter trap has now bitten two consecutive runs — a candidate harness papercut (see FX001 log's analogous cwd note)._
- **Magic wand** (target: coordination): a farewell helper that auto-summarizes tasks/findings/summaries/unresolved-inbox for the run, so counts aren't reconstructed from memory at stop time.

### Closure
FX002 is **CLOSED**: code committed `0aad609` (build clean, 277/277 green), companion **APPROVE with zero findings**, farewell drained + auto-harvested. No follow-ups spun off.
