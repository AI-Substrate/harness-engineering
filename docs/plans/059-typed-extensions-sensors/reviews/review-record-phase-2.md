# Review Record — Plan 059 Phase 2 (Sensors engine, headless) · dlg-0002

**Final verdict**: **APPROVE** (round 6 scoped final, 2026-07-14T~23:0xZ) — supersedes the round-4 APPROVE_WITH_NOTES, which prime verification HELD (see § Prime-hold closure cascade below)
**Coder**: the coder seat (github-copilot/gpt-5.6-sol, effort max) · **Reviewer**: the reviewer seat (gpt-5.6-sol, effort high, cross-effort) · **Orchestrator**: the orchestrator seat · **Transport**: the transport seat (canary relay only)
**Scope reviewed**: uncommitted worktree implementation of T002–T011 (`tasks/phase-2-sensors-engine-headless/tasks.md`) against workshop 002 decisions S1–S13.
**Baton**: phase-2-build-059 / lease-ec73fa2e (granted by prime the prime seat).

## Cycle summary — 4 rounds, strictly narrowing

| Round | Verdict | Findings | Scope |
|---|---|---|---|
| r1 | FIX_REQUIRED | 1 HIGH (runner hard-timeout unenforced on pending run()) · 2 MEDIUM (stale queue loses latest burst; appended fixtures unfrozen) | whole phase |
| r2 | FIX_REQUIRED | 1 HIGH (FakeClock deadline race time-travels — fix1 regression) · 1 MEDIUM (running-state dedup bypass, no-op rerun lane — fix1 regression, root-caused to orchestrator packet over-spec, owned + superseded) | fix1 diff (9 files) |
| r3 | FIX_REQUIRED | 1 HIGH (plain/signal fake sleeps not temporally composable) — F2 fully accepted with beyond-packet probes | fix2 diff (6 files) |
| r4 | APPROVE_WITH_NOTES | none behavioral · 1 nonblocking prose note | fix3 diff (5 files) |
| — | **PRIME HOLD** | 2 closure defects (lock not picomatch-minimal — orchestrator's r0 adjudication wrong; prose note lands in-phase) + 1 HIGH arch breach (scheduler node:crypto in services layer) all found by prime, missed by 4 rounds | prime source scan |
| r5 | FIX_REQUIRED | 1 MEDIUM (Dim-0 SURVIVING MUTANT: pinned canonical test pre-sorted, drop-sort survived suite — S10 order-independence unguarded) — all 12 closure files otherwise accepted with independent digest-compat proof | fix5 closure diff (12 files) |
| r6 | **APPROVE** (scoped final) | none — the reviewer's own drop-sort mutant now RED (1F/7P, exact reverse-arrival string), byte-restore cmp=0, hash = r5 accepted | fix6 test-only (1 file) |

Every finding in every round was **adjudicated at source by the orchestrator before dispatch** (r2-F1, r3-F1, and the fix3 acceptance additionally reproduced empirically via orchestrator-owned tsx repros, both directions on r4).

## Dim-0 mutation gate — enforced all four rounds

12 mutations total across scheduler quiescence/dedup, state-store atomic rename, stats skip/failStreak, runner race, fake-clock deferral/waiter-release, scheduler conditional table, frozen fixture bytes. Every one RED→GREEN with named failing tests and byte-identical restores (`cmp`=0 + SHA-256; final round's restore hash `89a2dc53…` re-verified by orchestrator shasum).

## Final state of the code

- **Runner**: `run()` settlement races an abortable injected-clock deadline (E212 on budget exhaustion incl. never-settling handlers); late rejection defused at wrap; child-exec 124 mapping retained; sync returns bypass the race.
- **Scheduler**: 1s quiescence with re-arm; persisted content-hash dedup; per-sensor serialization; depth-one queue with conditional newest-wins (pure A→A inert; A→B→A keeps final A; A→B→B and A→B→A→B probed correct); completion always runs queued stale.
- **FakeClock**: plain sleeps advance next event-loop turn (runnable microtasks first, exact-ms, crossed-waiter release); signal sleeps waiter-based (advance/set/abort resolved, leak-free, backward-set-safe). SystemClock abort path clean. `Clock.sleep(ms, signal?)` widening adjudicated + reviewer-accepted.
- **Corpus**: 11 frozen fixtures (9 original bytes untouched + 2 Phase-2 additions) with non-vacuous directory-completeness guard.
- **Compat wrapper** (frozen `sensor-bearing.ts` legacy shape): accepted r1 — narrow predicate, E216 preserved, loud doctor line, docs strict-S1-only.
- Cleared across rounds: B3 three-way runStatus, AC-13 exit posture, S13 degraded-not-unconfigured (empirically proven), S12 secrets guard, E210–E217 fence, no Phase-3 TTY/Ink leakage.

## Prime-hold closure cascade (post-r4)

Prime (the prime seat) held acceptance after r4 on independent verification; leases: lease-48092260 (narrow, returned after a STOP/dispatch delivery race — disclosed, adjudicated as race not concealment) → lease-f5c22177 (expanded).

1. **Lock repair** (fix4-closure, executed under the race window; bytes ratified into the expanded lease): package-lock.json restored from base + surgical 4-hunk picomatch topology (root dep; 4.0.4 under dependency-cruiser; 4.0.5 hoisted minus dev; vite nesting removed) — base-metadata reuse, no regeneration/network. Final SHA `e65aac85…`. Root cause of the original churn: npm-version lock regeneration (libc arrays + URL normalization). **Orchestrator's r0 "picomatch-only delta" adjudication was wrong** — prime caught it; owned in-record.
2. **Prose fix**: `fake-clock.test.ts:40` title/Test Doc reworded to the truthful next-event-loop contract (assertions unchanged) — the reviewer's r4 note closed in-phase per prime.
3. **HIGH arch breach** (fix5-archport): `scheduler.ts:1` imported `node:crypto` directly — services ports-only rule; missed by all four rounds and both orchestrator passes. Fix: generic `HashPort` (`sha256Hex(string|Uint8Array): string`) + `NodeHash` (sole crypto coupling) + `FakeHash` (recording deterministic fake) in `src/adapters/hash/`; scheduler type-only port dependency; `app.ts:305` sole composition-root construction; canonical S10 layout unchanged. the reviewer independently proved digest compatibility (old `createHash` ≡ NodeHash on the canonical batch `e5fbfa34…`; old persisted digest + reverse events ⇒ 0 reruns).
4. **Mid-cascade STOP honored**: coder refused fix5's over-broad grep proof (services-wide) because `services/observe/observe-service.ts:1` carries a **pre-existing** plan-056 crypto import; orchestrator narrowed the proof to `services/sensors/` (conforming packet to lease), prime ratified; observe-service recorded as follow-up **SUGG-001** (migrate to HashPort — separate work, not baseline excuse, not s060 scope, byte-untouched here).
5. **Sort-guard** (fix6): r5's surviving mutant closed by reversing test emission order (b.ts before a.ts, sorted expectation retained); mutant proof RED→restore→GREEN by coder AND reviewer independently; production scheduler byte-identical throughout (`1d448241…`).

Final counts: 206 files / **2472** tests (orchestrator self-run at fix5; coder-run at fix6); all hard gates ok; 2 accepted warn gates. INC-003 alias pattern continued through the cascade (fix4 boundary ack, fix5 STOP, fix5/fix6 completions — all correlated canonical, zero alias replies).

## Nonblocking note — CLOSED

The r4 carry-forward (`fake-clock.test.ts:40` stale prose) was closed in-phase by prime direction (cascade item 2). No open notes remain.

## Evidence trail

- Verdicts: `verdict-dlg-0002-p2-r1.md` · `-r2.md` · `-r3.md` · r4 verdict inline in this record's cycle table (the reviewer message 22:2x, acceptance evidence: macrotask exec probe ok/0 + duration path ok/5, interleaved sleeps exact-sum with single waiter release, unawaited sleep deferred, 7 call sites all awaited, docs truthful).
- Packets: `prompts/dlg-0002.md` · `dlg-0002-p2-fix1.md` · `-fix2.md` · `-fix3.md`; requests `review-request-dlg-0002-p2{,-r2,-r3,-r4}.md`.
- Orchestrator full-suite self-runs: 2461 → 2465 → 2469 → **2470/2470** (205 files). Final gates (coder authoritative 2026-07-14T22:11:35Z + orchestrator re-run): build/typecheck/Biome/diff-check clean; two accepted warn gates (arch 2, markdown 199).
- INC-003: all four coder completion reports surfaced via quarantined the quarantined duplicate-session alias alias; each correlated to the canonical the coder seat transcript (21:02:29 / 21:33:36 / 21:55:31 / 22:13:49) and never replied to.
- Fences held throughout: staged=0, no commits, the-flow files CLI-only, root repo + private-consumer untouched.
