# Execution log — 016 arch-conformance-extension (single phase, T000–T012)

**Skill**: `/plan-6-v2-implement-phase-companion` · **Mode**: Simple (tasks inline in plan)
**Companion**: `code-review-companion` run `2026-06-10T17-53-04-600Z-0c63` (minih 0.1.7; [protocol](https://github.com/AI-Substrate/minih/blob/main/docs/how/companion-mode.md))
**Started**: 2026-06-10T07:53Z

Companion briefing sent 07:53:58Z (`01KTR8C6A5RM473KGSQ2105M36`) — hazards: vitest glob two-levels-up, bare-npx 0-modules, warn-launch posture (warn severities are NOT a bug), mapping purity `mapToDecision(parsed, rules)`, deterministic sort from→to→rule, CI step final-after-Test.

---

## T000 — Harness boot pre-flight (Boot→Interact→Observe)

**Verdict: ✅ HEALTHY**

| Stage | Check | Result | Duration |
|---|---|---|---|
| Boot | `just test` | 374/374 tests pass, coverage 91.69% stmts | 731ms (warm) |
| Interact | `npx --no-install harness doctor --json` | `status: ok`, exit 0 | ~2s |
| Observe | doctor envelope `data.layers.extensions` | `"2 loaded, 0 failed, 0 conflict(s)"` — matches pre-change expectation (T010 flips the governance doc to 3) | — |

Baseline commit: plan artifacts (8 files) landed before any code change so per-task diffs stay clean (precedent: 013/015 plan folders are fully committed, incl. `.the-flow-state.json`).

---

## T001 — dependency-cruiser devDependency (`9f3b7ab`)

`npm install -D dependency-cruiser` → ^17.4.3, lockfile-pinned, 0 vulnerabilities; `./node_modules/.bin/depcruise --version` → 17.4.3. Companion pinged.

## T002 — root `.dependency-cruiser.cjs` (`8d72545`)

PoC rules verbatim, sole divergence severities `error`→`warn` (warn-launch); gotchas #1/#2 + rule-change discipline in header. Raw-run sanity: **66 modules / 112 deps / 0 violations, exit 0** — matches the PoC exactly. Companion pinged.

## T003 — RED: fixtures + mapping.test.ts + vitest widening (`963ac53`)

Fixtures generated from REAL 17.4.3 captures (seed → capture under both warn + error configs → revert; tree verified clean after). **Discovery (gotcha #3): depcruise 17.4.3 exits 0 from `--output-type json` even with error-severity violations** — parse-first is the only honest detection; encoded in the malformed-fixture test. Also discovered: `summary.ruleSetUsed.forbidden[]` carries the full rule set *including comments*, so the comment join needs no config re-read — `mapToDecision(parsed, rules)` gets rules from the same parsed document. vitest include widened two-levels-up (`'../../.harness/extensions/**/*.test.ts'` — Finding 02 honored). RED proven from both cwds (suite collects, fails on missing `./mapping.js`). Companion pinged.

## T004 — GREEN: pure `mapping.ts` (`9fe9a28`)

`mapToDecision(parsed, rules)` + `parseDepcruiseJson(stdout)` — pure, zero imports, locale-independent `<`/`>` sort. One honest test correction along the way: the warn-only fixture is the *seeded*-tree capture, so it carries 113 deps (seed import = +1), not 112. **378/378 green from both cwds.** Companion pinged; inbox checked — no findings so far.

---

## T005 — extension.ts shell (`f6b3752`)

Preflight bin+config at `ctx.cwd` → `unconfigured`; local-bin exec; parse-first (gotcha #3); rules for the comment join from the same parsed document; never-throws backstop. **Deviation (logged, deliberate)**: the error-violation state returns a literal `VerbResult` instead of `ctx.error` — the error factory has no `data` slot and the spec pins `data.violations` for every state where depcruise ran (CI's jq path depends on it). Live smoke: `ok`/0, 66/112. Suite 378/378.

## T006 — instructions.md briefing (`7c03bfd`)

Proof boundary (incl. empirical rule authority + `test/architecture/` complement), 6-state outcome table + error codes, warn-launch, fix-the-import-not-the-rule, rule-change discipline, 3 gotchas, P9 evidence note. `harness instructions arch-check` prints it.

## T007 — E2E state walk (verification only, no code)

| Contract row | How proven | Observed |
|---|---|---|
| 1 ok/0 | LIVE | `ok`, exit 0, 66 modules / 112 deps, `violations: []` |
| 2 error-violation/1 | unit fixtures (AC-10) | `error-violation.json` → `E_ARCH_VIOLATION`, exit-intent 1, sorted, comment joined |
| 3 warn-only degraded/0 | LIVE (seeded `help-service.ts` → `../../adapters/fs/node-fs.js`) | `degraded`, exit 0, names `services-only-adapter-ports`, comment quoted, promote guidance; revert → `ok`, tree clean (0 dirty files) |
| 4 tool missing unconfigured/2 | LIVE (bin stashed) | `unconfigured`, exit 2, next_action = exact install command |
| 5 config missing unconfigured/2 | LIVE (config stashed) | `unconfigured`, exit 2, next_action = restore guidance |
| 6 crash/malformed error/1 | unit fixtures (AC-10) | `parseDepcruiseJson` failure path → `E_DEPCRUISE_OUTPUT` |

doctor: `ok`, **"3 loaded, 0 failed, 0 conflict(s)"** — arch-check loaded with zero complaints. AC-3/4/5/8 satisfied (rows 2/6 honestly fixture-proven, per plan).

---

## Companion findings ledger

| # | ackOf (review-request) | Severity | Finding | Disposition |
|---|---|---|---|---|
| _none yet_ | | | | |
