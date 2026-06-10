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

## T008 — CI step (`0fb8325`)

Final step of `build-test` (after Audit): verb-invoked, `out=$(…) || code=$?` capture, `::warning::` + count on `degraded`, `exit ${code:-0}` propagation. Both paths dry-run locally under `bash -e`: clean → exit 0; seeded → annotation + exit 0; tree reverted clean. Live CI reading lands on the PR.

## T009 — how-guide + README pointer (`6a0cbf1`), reframed (`a289697`)

All 7 AC-11 items; `check:docs` green (gen-docs bundles from a curated manifest — the contingency never triggered). **Mid-build user direction**: frame the guide + briefing against `docs/harness-basics/intro-to-harness.md` and `harness-foundations/simple-mode.md` — reframe commit adds the Rule 3 epigraph, inferred-world→deterministic-world framing, encode-the-fix-not-the-memory (rules as executable team memory), and the "what did you have to infer that the harness should have proved?" loop-closer.

## T010 — governance doc (`80fc1f2`)

`.harness/engineering-harness.md`: healthy reading 2→3 loaded; arch-check in the Interact verb list; hexagonal-conformance sensor row (warn-launch noted); CI inventory row. Doctor re-verified `ok`.

## T011 — regression sweep (verification only)

`just fft` exit 0, no dirty files; 378/378 from repo root AND `harness/cli`; doctor `ok`; CI-mirror extras: `tsc --noEmit` ok, `npm run build` ok. AC-12 satisfied.

## T012 — retro drain

`harness record retro` scaffolded `.harness/records/retro/2026-06-10/005-016-arch-check-build-drain.md`; all 10 buffered SUGGs + this build's GFT-001 (seed→capture→revert fixture pattern) + INS-001 (depcruise exit-0 gotcha, status `encoded`) materialised with `bubble_action: all-save`; **SUGG-010 P12-sanitized on the way out** (private exemplar identifier in the gitignored buffer → committed record carries only the `scratch/` path). `harness observe --clear` → 10 cleared, 0 pending.

---

## Acceptance criteria — final status

All 12 ACs met — see the plan's checked § Acceptance Criteria for per-AC evidence. Honest scope notes: AC-5 rows 2/6 are unit-fixture-proven (per plan); AC-9's live CI reading lands when this branch goes to PR (both paths dry-run proven locally under `bash -e` semantics).

---

## Companion findings ledger (rebuilt post-farewell — see debrief note below)

> **Channel failure, then correction (F005/F007 context)**: every inbox poll
> during the phase returned zero inbound messages, so in-phase records honestly
> reported "no findings so far" — but the farewell revealed the companion HAD
> sent 7 findings (each carrying a real `ackOf` id); they never appeared in the
> `minih outside inbox list` output. The in-phase "0 findings" reads were
> observations of a broken channel, not of a clean review. Filed as an observe
> entry (minih bug candidate) and corrected here, per the
> never-ignore-a-finding rule.

| # | Severity | Finding (condensed) | Disposition |
|---|---|---|---|
| F001 | HIGH | Machine-specific `/Users/<user>/…` absolute paths committed in `.the-flow-state.json` `pending_command` + `the-flow.json` build `command` — reintroduced a previously-sanitized leak class | **ADDRESSED** (fix commit): both now repo-relative; flow-writer pattern noted for future sessions |
| F002 | HIGH | Claimed T001 narrowed `engines.node` >=20 → >=22 without a decision | **DISAGREE (refuted with evidence)**: `package.json` engines was already `>=22` before T001 — set deliberately by `74c0f37` ("Node 22 floor", prior plan). T001's `npm install` only synced the lockfile's *stale root metadata* to the existing committed contract. No support change occurred in 016 |
| F003 | MEDIUM | Stale "exit 1" claims in PoC header/spec vs measured json-reporter exit-0 | **ADDRESSED (partial)**: `poc-arch-rules.cjs` header now carries the build-time correction (err-reporter vs json-reporter exits). Spec's Research Context left as-is — it is a historical record of the PoC-time reading; the correction lives in every operative doc (guide gotcha #3, briefing, mapping.ts comment, this log) |
| F004 | HIGH | `parseDepcruiseJson` accepted any JSON with a `summary` key — parseable schema drift could yield `ok` with undefined counts; missing rule comments joined as blank guidance | **ADDRESSED** (fix commit): schema guards (violations must be array; counts must be numeric) route drift to the loud error path; comment join falls back to a non-empty config pointer; 2 new Test-Doc'd tests (suite 380/380) |
| F005 | HIGH | T007 record claimed no companion findings while F001–F004 had been sent | **ADDRESSED**: ledger rebuilt (this table); channel-failure root cause documented above; in-phase claims annotated rather than silently rewritten |
| F006 | MEDIUM | Governance doc: hard-coded "315 tests" stale; CI row implied a non-existent non-blocking doctor step | **ADDRESSED** (fix commit): count un-hard-coded (+ extension-tests note); CI row now matches the real workflow shape (build-test steps + package-smoke doctor fixtures) |
| F007 | HIGH | Final phase record claimed zero findings + all ACs met while HIGH issues were observable | **ADDRESSED**: all corrections in the fix commit; ACs re-verified post-fix (380/380 both cwds, doctor `ok`, arch-check `ok`/0). AC table stands with this ledger as its companion record |

**Verdict reconciliation**: the companion's farewell verdict was REQUEST_CHANGES on two grounds — unresolved findings in the tree and a false zero-findings record. Both grounds are now resolved (F001/F004/F006 fixed; F003 partially fixed with reasoned deferral; F002 refuted with evidence; F005/F007 corrected by this ledger). Post-fix regression: 380/380 both cwds, doctor `ok`, live verb `ok`/0.
