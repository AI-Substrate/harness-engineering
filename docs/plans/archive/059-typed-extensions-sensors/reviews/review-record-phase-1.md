# Review Record — Plan 059 Phase 1 (Authoring v2 substrate)

**Run**: 2026-07-14T06-55-22Z-github.com-AI-Substr
**Coder**: the coder seat — pi harness, `github-copilot/gpt-5.6-sol` effort **max**
**Reviewer**: the reviewer seat — pi harness, `github-copilot/gpt-5.6-sol` effort **high** (cross-effort; spawned by the transport seat per INC-002, canary PASS: distinct pid 34463, model/effort/cwd verified, structurally linked to orchestrator the orchestrator seat)
**Orchestrator**: the orchestrator seat
**Delegations**: dlg-0001 (implement, T001–T010) → FIX_REQUIRED → dlg-0002 (fix) → **APPROVE**

---

## Round 1 — dlg-0001 verdict: FIX_REQUIRED (2 HIGH + 2 MEDIUM)

Dim-0 gate (mandatory, satisfied): all four named guards mutated RED→GREEN, restored byte-identical.
- api-gate: `api > CORE` → `<` → `v2-api-gate.test.ts` RED (E147 case) → restore → GREEN 6/6.
- classify: `'extension'` → `'extension-mutated'` → `v2-classification.test.ts` RED (2 failed) → restore → GREEN 8/8.
- normalize: `?? 2` → `?? 3` → `v2-normalize.test.ts` RED → restore → GREEN 2/2.
- corpus-guard: one fixture byte changed → guard RED (factory.ts hash drift) → restore → GREEN 3/3.

| # | Sev | Location | Finding |
|---|-----|----------|---------|
| HIGH-1 | HIGH | `v2/api-gate.ts:27,46` | `api = rawApi ?? CORE_EXTENSION_API` conflates omitted-declaration (contract-pinned api 2) with the running core; only accidentally correct while CORE=2. On a future api-3 core, an omitted-api extension gates as 3 but normalizes as 2; and `vocabularyFor(api)` gives E148 for an api-2 extension using a core-known section instead of the E4-required load+advisory. |
| HIGH-2 | HIGH | `v2/normalize.ts:86-88` | `{ kind:'record', type, ...declaration }` — spread order lets a record declaration's own `kind`/`type` overwrite the normalizer-stamped identity (empirically: `records.decision={…,kind:'extension',type:'other'}` loaded as `{kind:'extension',type:'other'}`). |
| MEDIUM-3 | MED | `acts/verb-v2.ts:99-100,118` | Subverb-only parent declaring a positional consumes an unknown child token as a parent arg → `unconfigured` instead of the required unknown-subverb error (E108). Variadic parent hard-codes unknown→undefined. |
| MEDIUM-4 | MED | `v2/normalize.ts:10-14` | Folder-mismatch warning derives package name from the entry filename → false "folder is index/main" warnings for `index.*` and manifest-selected entries. |

**Orchestrator adjudication (round 1)**: both HIGH findings independently confirmed at source before dispatching the fix (did not rubber-stamp) — api-gate.ts:27 `rawApi ?? CORE_EXTENSION_API` and normalize.ts:86 post-`type` spread both verified real. Fix packet dlg-0002 dispatched with required approaches.

---

## Round 2 — dlg-0002 re-review verdict: **APPROVE** (all 4 RESOLVED)

- **HIGH-1 RESOLVED** — `declaredApi = rawApi ?? 2` now independent of injected `coreApi` (via `ApiGateEnvironment`); the core-3 / api-2 `workflows` case loads + emits the api-bump advisory (E4), not E148. **Final Dim-0 (empirical, non-vacuous proof)**: reviewer applied a semantically-valid split-reversion mutant (`rawApi ?? coreApi`) → `v2-api-gate.test.ts` went **RED exactly on the future-core assertion** (expected api 2, received api 3; 1 failed/8 passed) → exact restore → **GREEN 9/9**. This proves the future-core tests are not vacuous.
- **HIGH-2 RESOLVED** — records reconstruct from known fields only (`kind`/`type`/`description`/`template`, no `...declaration` spread); empty keys rejected. Repro now normalizes to `{"kind":"record","type":"decision",…}`; identity test GREEN 1/1, would fail under the former spread-overwrite.
- **MEDIUM-3 RESOLVED** — `db destroy` with parent `<value>` AND `<values...>` both yield E108/exit 1; table test GREEN 2/2.
- **MEDIUM-4 RESOLVED** — dirname-based derivation; `database/index.ts` + manifest `database/main.ts` produce no mismatch info; GREEN 2/2.
- **No regression** — scoped suite GREEN 5 files/29 tests incl. corpus guard; `acts/verb.ts` diff-empty; `harness checks` tests/biome/typecheck + hard gates ok, only the 2 handed-down baseline degradations (arch-check ×2 `services-ports-type-only`, markdown-lint). Mutation restored, `git diff --check` clean.

---

## Orchestrator sanity pass (the last gate before APPROVE — not a re-review)

Per pair doctrine, the reviewer's APPROVE is the *input* to approval, not a substitute. Confirmed the verdict survives an independent glance:

- **Re-read the highest-severity hunk myself** — `api-gate.ts` (post-fix), lines 24–60: verified `const declaredApi = rawApi ?? 2` (permanent, never core), `const { coreApi, vocabulary } = environment` (injectable), `if (declaredApi > coreApi) → EXTENSION_API_ABOVE_CORE (E147)`, and `minimumKnownApi(section, coreApi, vocabulary)` computing the E4 advisory level. The fix matches the required approach exactly.
- **Confirmed Dim-0 was really exercised** — the reviewer's RED evidence names the exact test file + the future-core assertion + pass/fail counts; not an assertion of "non-vacuous" without a mutation.
- **Ran the load-bearing suites locally** — `npx vitest run v2-api-gate.test.ts v2-normalize.test.ts` → **14/14 passed**; grep-confirmed the future-core tests exist (`coreApi: 3` + `futureVocabulary`, cases "keeps omitted at api 2 on core 3" and "loads core-3-known section + advises").
- **Verified HIGH-2 fix at source** — `normalize.ts:85-90` reconstructs records from named fields; no spread.
- **Final full `harness checks`** — green + only the 2 baseline degradations.

**Verdict recorded: APPROVE.** No rubber-stamp — both HIGH fixes verified at source, suites run locally, Dim-0 RED evidence confirmed concrete.

---

## Final state
- 2412 tests pass. Load-proofs: worktree 10/0/0 (all v1), private-consumer 9/0/0 (all v1).
- v1 `acts/verb.ts` diff-empty; frozen corpus bytes unchanged (guard green).
- Key file hashes (sha256/12): api-gate.ts `f85e36816100` · normalize.ts `5d07673c3513`.
- Root untouched (`M .gitignore` only); private-consumer untouched.
