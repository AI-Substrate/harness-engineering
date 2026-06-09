# Fix FX002: `harness new --wrap` scaffold emits a sparse boot Envelope

**Created**: 2026-06-10
**Status**: Proposed
**Plan**: [013-dogfood-harness-flow](../dogfood-harness-flow-plan.md)
**Source**: Plan 013 dogfood finding FIND-3 (`scratch/handover-013-surfaced-findings.md` §Finding 3)
**Domain(s)**: harness-cli (scaffold templates — internal, no contract change)

---

## Problem

A `harness new <name> --wrap "<cmd>"` scaffold's `run()` returns a thin success Envelope — `ctx.ok({ command })` drops `r.stdout` and any timing — and its verb `summary` is a literal `TODO` (`templates.ts:51,55,91,95`). Boot extensions authored this way under-report: boot "passes" with no observable evidence (no stdout, no duration), which is the exact signal the harness exists to provide. The repo's **own** promoted wrap example (`harness/cli/examples/extensions/build.ts`, `harness/cli/docs/authoring-verbs.md`) is already richer (uses the `evidence` channel) — the scaffold lags the pattern it's supposed to teach.

## Proposed Fix

Enrich `wrapTs` + `wrapJs` only (minimal/record templates untouched):

1. **Verb summary** — replace `'TODO: summary (wraps \`${command}\`).'` with an honest generated one-liner `'Wraps \`${command}\`.'` (no `TODO`).
2. **Success Envelope** — self-time the exec and include real observable data:
   ```ts
   async run(ctx) {
     const started = Date.now();
     const r = await ctx.exec('${argv0}', ${argsLiteral});
     const durationMs = Date.now() - started;
     const tail = r.stdout.trimEnd().split('\n').slice(-20).join('\n');
     return r.ok
       ? ctx.ok({ command: '${command}', durationMs, stdout: tail })
       : ctx.error('E1', `${command} failed (exit ${r.code})`, {
           details: r.stderr,
           next_action: 'Fix the failure above, then re-run `harness ${name}`.',
         });
   }
   ```
   `durationMs` is real (template self-times — no `ExecResult`/exec-port change); `stdout` is a bounded **last-20-lines tail** (honest proof-of-life without flooding the Envelope). The error branch is unchanged.

**Why `data`, not the `evidence` channel**: `Evidence` (`envelope.ts:6-13`) is `{ label, path?, none? }` — a pointer to a *durable artifact* (a written file). A wrapped command's stdout and duration are ephemeral, not files, so they honestly belong in `data`. The repo's `harness/cli/examples/extensions/build.ts` (a **hand-authored example**, NOT scaffold output) uses the `evidence` channel with `none:true` to signal "ran, wrote no durable file" — a different and valid use of a separate example; it stays untouched.

Explicit scope guards (the war-and-peace traps):
- ✗ **No parsed test/line counts** — the finding's "where detectable" part is honesty-risky and balloons scope; out for this fix.
- ✗ **No `ExecResult`/exec-port change** — template self-times with `Date.now()`.
- ✗ **No change** to `minimalTs/minimalJs/recordTs`, the `Envelope`/`Evidence` contract, or `examples/extensions/build.ts` + `authoring-verbs.md`.

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| harness-cli | owner | `wrapTs`/`wrapJs` string builders + their byte-exact test fixtures + the workshop §4b/§4d source blocks. No `Envelope`/`ExecResult` contract change, no new ports. |

## Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | FX002-1 | Enrich `wrapTs` + `wrapJs`: honest `summary` (no TODO), self-timed exec, success Envelope `ctx.ok({ command, durationMs, stdout: <20-line tail> })`; error branch byte-identical | harness-cli | /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/scaffold/templates.ts | Both builders emit the enriched body; `summary` contains no `TODO`; success `ok()` carries `durationMs` + `stdout` | wrapTs ~44-65, wrapJs ~85-105. Keep `splitCommand`/`argsLiteral` usage as-is |
| [ ] | FX002-2 | Update the byte-exact fixtures + workshop source to match: `WRAP_TS_TEST` (`templates.test.ts:36-53`), `WRAP_JS_TEST` (`:68-84`), and workshop §4b (ts) + §4d (js) blocks | harness-cli | /Users/jordanknight/substrate/harness-engineering/harness/cli/test/services/scaffold/templates.test.ts · /Users/jordanknight/substrate/harness-engineering/docs/plans/006-add-extension-skill/workshops/001-scaffold-template-set-and-layout.md | `wrapTs`/`wrapJs` verbatim tests pass against new bytes; workshop "emit §4a–4d verbatim" claim stays true | The partial-match test (`templates.test.ts:111-116`, asserts the `ctx.exec('just',['ci-smoke'])` + `re-run` substrings) is UNAFFECTED — those substrings survive. Don't over-edit it |
| [ ] | FX002-3 | Build + full suite + commit | harness-cli | — | `npm run build` exit 0; vitest all pass; conventional commit `feat(scaffold): …` referencing FIND-3 | Repo conventions: `-c commit.gpgsign=false`, Copilot co-author trailer |

## Workshops Consumed

`docs/plans/006-add-extension-skill/workshops/001-scaffold-template-set-and-layout.md` (§4b/§4d are the byte-source the template test mirrors — kept in sync by FX002-2).

## Acceptance

- [ ] `wrapTs('test','npm test')` / `wrapJs('test','npm test')` success Envelope is `ctx.ok({ command: 'npm test', durationMs, stdout: <tail> })`, and the verb `summary` is exactly `` 'Wraps `npm test`.' `` (general form `` 'Wraps `${command}`.' `` — no `TODO`).
- [ ] `durationMs` comes from a real `Date.now()` delta around `ctx.exec`; `stdout` is the trimmed last-≤20-lines tail.
- [ ] Byte-exact fixtures updated; full vitest suite green; the multi-token-split partial-match test still passes untouched.
- [ ] No change to `ExecResult`/exec port, the `Envelope`/`Evidence` contract, or the minimal/record templates.
- [ ] Workshop §4b/§4d blocks match the new template bytes.

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|

---

## Validation Record (2026-06-10)

### Validation Thesis

**Raison d'être**: Turn plan-013 dogfood finding FIND-3 (sparse `--wrap` boot Envelope: TODO summary, no stdout/duration) into a lean, implementable brief for plan-6, honoring the surfaced-not-auto-implemented guardrail and the user's "not war and peace" ask.

**Value claim**: plan-6 implements with minimal clarification; boot extensions stop under-reporting; no `Envelope`/`ExecResult` contract change; byte-exact fixtures + workshop stay honest.

**Artifact promise**: factual claims match source; ripple set complete; the mechanism (self-timed exec, data enrichment) is contract-correct; non-goals hold the scope line.

**Intended beneficiaries**: plan-6 implementer (primary), `harness new --wrap` boot-extension authors, the validate-harness-flow worker, human approver.

**Proof target**: Implementation. **Evidence standard**: source-code match, full ripple enumeration, repo conventions.

**Thesis source**: `scratch/handover-013-surfaced-findings.md` §Finding 3 + user instruction "simple task for finding 3 … fix task, not war and peace".

**Thesis verdict**: Advanced (after fixes — pre-fix: Adequate, summary text under-pinned).

**Main thesis risk**: was "plan-6 guesses the exact `summary` wording → byte-exact fixtures drift → cascade failure"; eliminated by pinning `` 'Wraps `${command}`.' `` in the acceptance criterion.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| Source Truth + Cross-Reference | Evidence Sufficiency, Integration & Ripple, Technical Constraints, Hidden Assumptions, Concept Documentation | Evidence Sufficiency, Implementation Readiness | 1 MEDIUM fixed, 1 LOW fixed, 2 LOW no-op | ⚠️ → ✅ |
| Thesis + Forward-Compatibility + Proof-Level | Thesis Alignment, Forward-Compatibility, Proof-Level Fit, User Experience, Hidden Assumptions | Thesis Alignment, Proof-Level Fit, Downstream Usefulness | 1 MEDIUM fixed | ⚠️ → ✅ |

**Deduped issues**: 1 MEDIUM (summary text not pinned in acceptance → pinned exact string `` 'Wraps `npm test`.' ``); 1 MEDIUM (Evidence/`data` rationale could misread `build.ts` as scaffold output → reworded to mark it a hand-authored example); 1 LOW (wrapJs line range `~84-105` → `~85-105`). All fixed in this dossier. Confirmed clean: ripple set complete (templates.ts + templates.test.ts + workshop 001 §4b/§4d only — no other pin), `Evidence` is artifact-pointer, `ExecResult` has no duration (self-time sound), partial-match test survives, conventions accurate.

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| plan-6 implementer (`--fix FX002`) | Unambiguous executable tasks | shape mismatch | ✅ (post-fix) | Exact `summary` string pinned; code block + fixture ranges given |
| `templates.test.ts` byte fixtures | Verbatim match after enrichment | shape mismatch | ✅ | FX002-2 owns WRAP_TS_TEST/WRAP_JS_TEST update; partial-match test untouched |
| workshop 001 §4b/§4d | Source blocks stay verbatim | contract drift | ✅ | FX002-2 owns the doc-sync so the "emit §4 verbatim" claim stays true |
| `--wrap` authors + validate-harness-flow worker | `data` enrichment safe for downstream | lifecycle ownership | ✅ | grep of agents/ + harness/cli/test found NO assertions on wrap-Envelope `data` shape — enrichment is additive/opaque; worker checks `bootRuns` (does it run), not data shape |

**Thesis alignment**: Value claim advanced at Implementation proof level (post-fix); residual risk is only the deliberately-accepted non-goal (no parsed test-count).

**Outcome alignment** (from the Forward-Compatibility agent): The Outcome — "The flow's boot extension is the proof-of-life artifact; a sparse Envelope means boot 'passes' without showing stdout/duration/test-count, weakening the signal the whole harness exists to provide." — this dossier puts the work on a correct trajectory to fix it by enriching the boot Envelope with real `durationMs`/`stdout`, making the bootstrap observable without side-effect inspection.

**Standalone?**: No — downstream consumers enumerated above.

Overall: ⚠️ VALIDATED WITH FIXES
