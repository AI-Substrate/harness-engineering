# Research Dossier — flow-eval loop (ledger, hardened scoring & the peer-driven test cycle)

**Plan**: 046-flow-eval-loop · **Branch**: `feat/041-flow-conformance-eval` (same branch / same PR — no new branch)
**Created**: 2026-07-01
**Intent**: Implement the eval-hardening + run-ledger + comparison capability that workshops 003–006 designed, and wire the whole thing to be **proven by running the peer-eval loop against it** (build → run a peer → observe from both sides → improve → continue). Turn the flow-conformance eval from a single-run scorer into a **looping, comparison-ready, regression-catching** instrument.

> **Design north star (the user's framing):** "we will loop using the peer system to test it all out back and forth." The peer-eval loop (workshop 005) is both the *thing we harden* and the *way we validate the hardening*. Every phase is provable by a real peer run.

---

## 1. Why this work exists

The flow-conformance eval (plan 041) shipped and was dogfooded over runs 001–003. Those runs + a Perplexity research pass ([041 research doc](../041-flow-conformance-eval/research/eval-methodology-perplexity-2026-07-01.md)) surfaced that the **core design is sound** (it IS the tau-bench/WebArena SOTA pattern) but has three statistical/validity gaps and no longitudinal memory. Workshops 003–006 turned that into locked decisions. This plan **builds** them.

## 2. What we're building (from the workshops — authoritative design)

| Source workshop | Decision | What it becomes in code |
|---|---|---|
| [003](../041-flow-conformance-eval/workshops/003-eval-hardening-applied-decisions.md) D1 | **Two-axis scorecard** | scorer.ts emits `process` + `capability` scores; required-fail cap fires only from capability+safety lanes |
| 003 D2 | **Per-seam match-modes** | `match_mode` (strict/superset/subset/unordered) + per-arg overrides on sequence assertions |
| 003 D8 | **Forbidden-state required lane** | a new safety-axis assertion type (no out-of-scope edits / report-contract present) |
| 003 D4 | **Judge hardening** | `judged` lane decomposed into named sub-criteria; different-family/artifact-only/calibration scaffolding |
| 003 D3/D5 | **`pass^k` + Wilson CIs** | computed at *read* time over the ledger (not a scorer change) |
| [004](../041-flow-conformance-eval/workshops/004-run-storage-and-comparison.md) | **Run ledger + comparison** | append-only `ledger.jsonl` on every `score`; `flow-eval ledger` read verb with first-class `--compare` (cross-model: gpt-5.5 vs sonnet-5) |
| [005](../041-flow-conformance-eval/workshops/005-the-eval-improve-loop.md) | **The eval→improve loop** | the dogfood process; both actors observe; harvest→encode; regression + model-compare |
| [006](../041-flow-conformance-eval/workshops/006-telling-the-story-docs-how.md) | **The story doc** | a `docs/how` page (run peers → watch two ways → evaluate → feed back) + a small README section |
| 041 F13 | **Telemetry duration/span** | add a span field to `SessionEvidence` so the ledger can record run duration |

## 3. The existing system — hook-point map (from a read-only inventory)

The extension lives at `.harness/extensions/flow-eval/` (loaded **from source** by the discovery loader — **editing the `.ts` needs no rebuild to run live**; `harness/cli/dist/` is the live runtime for the *core* only).

| File | Current responsibility | Hook point for this plan |
|---|---|---|
| `scenario.ts` | loads/validates the scenario bundle; **`ASSERTION_TYPES` registry (L66–84)** maps `type`→proof-source | add an **axis** classification (process/capability/safety) alongside type; `validateAssertion` (L174–230) gains `match_mode` validation; `Assertion` interface (L19–34) gains the field |
| `resolvers.ts` | `type`→verdict dispatch; **`skillSequence` (L181–201)** is the only sequence resolver (hard-codes a binary `ordered` flag) | `match_mode` replaces the `ordered` branch; **`SessionEvidence` is re-declared here (L40–53) and MUST stay byte-identical with the CLI copy** |
| `scorer.ts` | folds verdicts → score + `RunVerdict` + required-fail cap | **the two-axis split**: partition `passWeight/failWeight/requiredFailed` by axis in the loop (L100–127); cap (L131–132) consults only capability+safety; `DeterministicScore` (L46–54) gains two scores |
| `report.ts` | writes `report.{json,md}` in `writeReport` (L153–160) | **append a `RunRecord` to `.harness/live-testing/<slug>/ledger.jsonl`** right after the writes — note `ReportFsWrite` exposes only `writeText`/`mkdirp`, so append = read-then-write or a new primitive |
| `extension.ts` | single action-dispatched verb (`score`/`scaffold`, L292–300) | add a **`ledger`** action branch + `runLedger(ctx)`; reuse `fetchEvidence`/`makeRunId` |
| `harness/cli/src/services/telemetry/session-evidence.ts` | `SessionEvidence` (L41–66), counts-only; `fold` (L176–252) discards `ev.t` | **F13**: track min/max `ev.t` (or sum `dur_s`/`span_s`) in `fold`; add a span field in BOTH `SessionEvidence` declarations |
| `README.md` | top-level sections incl. `## The loop` (L82), `## The layers` (L98) | add a small **"How we evaluate this system"** section (after `## The loop` or `## The layers`) |

Current assertion `type`→lane table and the lock-step invariants (`ASSERTION_TYPES`↔`RESOLVERS`, the dual `SessionEvidence`) are captured in the inventory; tests assert them.

## 4. Build / test facts

- **Build**: `just build` (`npm run build` = gen:docs + gen:flows + `tsc`) + `npm link`. **Extension `.ts` edits run live without rebuild** (jiti source-load); only core-CLI (`harness/cli/src/...`, e.g. the F13 telemetry change) needs `just build`.
- **Test**: `just test` → `cd harness/cli && npx vitest run --coverage`; flow-eval tests are colocated `*.test.ts`. Gates: `just fft`, `just checks`. Run `just fix` before pushing (CI gates on biome — per repo memory).
- **Mutated-fixture discipline** (from 041): each resolver test must include a case that flips pass→fail when the evidence is mutated (non-vacuity).

## 5. Constraints & gotchas (must respect)

1. **Dual `SessionEvidence`** — extension can't import CLI src; the F13 span field lands in both `session-evidence.ts` (L41–66) and `resolvers.ts` (L40–53), kept identical (a test asserts lock-step).
2. **`ASSERTION_TYPES`↔`RESOLVERS` lock-step** — adding the forbidden-state type touches both + the test.
3. **Append primitive** — `ReportFsWrite` has no append; the ledger append is read-then-write (atomic-enough for JSONL) or a new fs capability. Prior lines must stay byte-stable (AC).
4. **"Seed" = reproducibility tuple, not an int** (004) — temp-0 ≠ deterministic; record model+version+harness+effort+base_ref+scenario_hash+prompt_hash.
5. **Same branch / same PR** — all commits land on `feat/041-flow-conformance-eval`; no new branch, no separate PR.
6. **Two-axis is an ORTHOGONAL classification** — today "lane" == proof source (telemetry/fs/judged); the process/capability/safety **axis** is new and independent. Don't conflate them.
7. **Teardown hygiene (F12 + new wrinkle)** — a peer's e2e can leave a puppeteer/chromium process holding the worktree; kill processes referencing the worktree path before `git worktree remove`.

## 6. The peer-loop validation strategy (the design north star, made concrete)

Each phase is **proven by a peer-eval run**, not just unit tests — the dogfood loop (005) is the acceptance vehicle:

- **Unit layer** (every phase): vitest over the changed resolver/scorer/report code, incl. mutated-fixture non-vacuity.
- **Loop layer** (per phase + a final pass): spawn a blind peer, drive it through the md→PDF task, score it with the **new** code, and confirm the new capability shows up in the report/ledger. Run ≥2 models for the comparison phase (gpt-5.5 vs sonnet-5) to exercise `--compare`.
- **Regression layer** (Pattern 21): re-running the loop after each phase must not flip a previously-passing lane within the same `seed_tuple`; the ledger makes that readable.

## 7. Open questions (carried into plan / flagged)

- **Q1 (deep, from 003):** does the orchestrator confound the measurement (are we scoring the subject or the orchestration)? Not a blocker for building the instrument; gates cross-model *claims*. Surface in the plan's risks, don't try to solve here.
- **Q2:** judge hardening (D4) depth — full calibration set vs scaffolding-only this plan? Lean: scaffolding + decomposition now, calibration set as a follow-up.
- **Q3:** how automated is the harvest (collating both actors' observations)? Leave manual this plan; note a possible future `harness` verb (005 Q2).
- **Q4:** `pass^k`'s K for our task — needs a pilot (a few ledger runs) before any model-vs-model claim; the ledger is the instrument that answers it.

## 8. Proposed shape (direction for the plan stage — not binding)

A **Full** (multi-phase) plan, CS≈4, ordered cheap-high-validity-first per workshop 003's value÷effort ranking:

1. **Hardened scoring** — two-axis split (D1) + match-modes (D2) + forbidden-state lane (D8). Pure scorer/resolver/scenario change; high validity, low effort.
2. **The run ledger** — RunRecord + append-only `ledger.jsonl` + `flow-eval ledger` verb with `--compare` (cross-model) + `pass^k`/Wilson at read (D3/D5) + F13 duration into evidence.
3. **Judge hardening** — decompose `judged`, different-family/artifact-only scaffolding (D4).
4. **Docs + dogfood** — the `docs/how` story page (006) + README "how we evaluate" section (005) + a real peer-loop dogfood that produces the first cross-model ledger comparison (the plan validating itself).
