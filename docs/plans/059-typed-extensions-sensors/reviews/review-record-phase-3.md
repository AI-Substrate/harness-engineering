# Review Record — Plan 059 Phase 3 (TUI + packaging + docs)

**Final verdict**: **APPROVE** — the review opened FIX_REQUIRED with a single finding (F001, below), which was fixed in a targeted cycle, orchestrator-verified, and cleared by a targeted reviewer re-verdict.
**Coder**: the coder seat (github-copilot/gpt-5.6-sol, effort max) · **Reviewer**: the cross-model reviewer seat (gpt-5.6-sol, effort high, cross-effort) · **Orchestrator**: the orchestrator seat
**Scope reviewed**: all uncommitted Phase-3 changes vs the committed Phase-1+2 HEAD — the TUI + packaging + docs implementation (`tasks/phase-3-tui-packaging-docs/tasks.md`, T001–T012), the operator-finding fixes (banner, input/`^C`/`q`, the ops batch, parallel run-all, boot black-screen), the repo real-sensors fix (`FX001`), and the proxy cold-replay lock remediation (`FX002`, the inherited proxy-availability blocker) — against Workshop 003 (D1–D9) and the fix dossiers.

## Cycle summary

| Stage | Verdict | Findings |
|---|---|---|
| Full cold review | FIX_REQUIRED | 1 HIGH (F001 — default parallel `sensors check` flaky, shared-`dist` race) + 4 doc/log coherence issues (found by the reviewer, fixed by the orchestrator, closed in-review) |
| Targeted re-verify (F001 fix) | **APPROVE** (F001 CLEARED) | none |

Every finding was **adjudicated at source by the orchestrator** before any fix dispatch; the load-bearing claims (the lock audit, the boot-frame ordering, the parallel-run flake, and the F001 fix) were independently re-verified by the orchestrator.

## Dim-0 mutation gate — 6 islands, all RED→GREEN with byte-identical restores

Every mutant produced a named failing test, then restored byte-identically (`cmp`=0 + SHA-256 before=after):

| Island | Mutant | Named RED test | Restore SHA-256 (before=after) |
|---|---|---|---|
| TUI input routing | `q` route → `x` | `routes all global keys…` | `dc965ad5…d1f` |
| FX001 sensor wrapper | full-suite command `npm` → `npx` | `uses only local commands…` | `7e50d5a2…b29d` |
| Stale-row boundary | `>` → `>=` at 15 min | `marks rows stale only…` | `4d0caeeb…2988` |
| Run-all pool | default concurrency 4 → 1 | `defaults to four in flight…` | `047d533d…73d8` |
| History ring | cap 50 → 49 | `caps history at 50…` | `9c5bad01…1973` |
| Boot ordering | remove pre-render alt-screen entry | `paints initial frame after alternate-screen entry…` | `17de6e57…8086` |

Focused baseline: 5 files / 55 tests green; final hashes re-verified identical; working index clean; no commits.

## The finding — F001 (HIGH), and its resolution

**F001 — default parallel `sensors check` was flaky (shared-`dist` race).** Both the `tests` and `coverage-branch` sensors run the full Vitest suite, whose PTY test compiled the CLI into the shared build directory as a `beforeAll` side effect; concurrently the `flows-drift` sensor executed that same build via the CLI bin. When the run-all pool ran the two full-suite sensors in parallel, the concurrent compiles raced the flows consumer, yielding a transient false "drift" failure. Proof: a real parallel check reproduced fail→immediate-pass, and a controlled stress (concurrent compiles vs concurrent flows-checks) produced 6/10 false failures. The earlier per-sensor coverage-directory isolation isolated coverage output only, not the build directory. Independently confirmed by the orchestrator against the source graph.

**Resolution (targeted fix cycle, in-fence to the PTY test only).** The PTY test now compiles into a unique temporary output directory and launches the CLI from that isolated build (never the shared build dir), cleaning it up afterward; a deterministic regression snapshots the shared build's size+mtime across the suite and fails if anything rewrites it. No pool/scheduler/bin/tsconfig/extension source changed. Default-4 concurrency and the measured ~33% run-all speedup are preserved (concurrency-1 ≈ 22 s vs default-4 ≈ 12.5–13.3 s).

**Verification.** Orchestrator: 7 real parallel checks, every one `ok`, `flows-drift` pass, 12 records in declaration order, shared-build fingerprint unchanged before/after, no leftover temp dirs. Reviewer targeted re-verdict: fresh source read confirms the temp-build isolation and cleanup; external shared-build fingerprint (`b04ba79…`, size 1253) constant across the focused suites; 9/9 real parallel checks clean (persisted `flows-drift` runs all `ok`/`pass`); the run-all pool and its default-4 behavior untouched. **F001 CLEARED.**

## Closed during review (found by the reviewer, fixed by the orchestrator)

- **Stale proxy-blocker caveats in the Phase-3 execution log** — an append-only supersession note now records that the inherited proxy-availability blocker was resolved by FX002 (cold install passes), superseding the two historical "blocked" caveats.
- **Public-doc coherence (4 items)** — the sensors guide's stale-warning rule (now `record.stale || age>15m`, header owns watcher-down), the reduced-width tier (keeps the Run column, drops Trend), an authoring example timeout (brought within the ≤3-minute budget the next paragraph states), and the AGENTS key summary (now lists the run-all key). Markdownlint + link validation clean.

## Mandatory dimensions — all APPROVE-quality

- **Real-terminal input**: 6/6 PTY cases green (direct + shell-wrapped real `q` and `0x03`; exit, alt-screen leave, raw-mode engage, exact termios restore). `^C` routes to quit-confirm and can never reach the plain-`c` clear handler. Boot frame paints onto the alt buffer with no input. The previously-unexplained `w` boot/close was exercised 5/5 and did not reproduce.
- **One truth**: non-TTY bare output byte-equals `--json`; the TUI consumes the exported status reader; rendered trend uses the envelope's trend computation.
- **FX001 sensors**: exactly 12 sensors; extension source has zero `npx`/network; bounded authored persistence (no raw child output); the two full-suite sensors write independent absolute coverage directories with an own-score regression; measured runtimes are seconds-class within budget; the AGENTS two-view section matches shipped behavior with a merge-risk note for the current main tip.
- **Lock audit (T009 + FX002)**: independent recompute vs the committed HEAD — node count 545→591 (46 additions, 0 removals); the 34 changed existing entries are exactly the root optional edge + 4 approved dev→devOptional flips + the 29 remediated FX002 nodes, with no unclassified delta; all six remediated package versions plus their platform-optional sets exact; zero internal/proxy/feed/CDN/signed URLs; final lock SHA `d12653fb…`; the persisted policy-compliant cold install passes end-to-end (exit 0, all tarballs 200, zero denied/npmjs/unknown/404, lock byte-idempotent).
- **Doctor**: telemetry-disabled healthy; normal-mode degraded solely on the advisory telemetry-flush-hook layer; extensions 11 loaded / 0 failed / 0 conflicts.
- **Architecture/purity**: no `node:*` imports in the TUI layer; no eager Ink/React from core; only the sensor error-code block; the frozen API corpus is append-only.
- **Full-plan docs**: README / AGENTS / the sensors guide align with shipped behavior after the in-review fixes; the proxy-blocker supersession is explicit.
- **Composite gate**: exit 0 (status degraded only on the two accepted warn-launch gates); all hard gates green.

## Disposition

All dimensions APPROVE; the single finding (F001) is fixed, orchestrator-verified, and reviewer-cleared. Phase 3 is landing-ready pending the publication-safety scan (against the final main-relative diff), the retro drain, and the landing ceremony (rebase onto the current main tip, full gates, human-authorized push). No raw prompts or intermediate packets are part of this record; all mutations during review were read-only experiments with proven byte-identical restores; the working index stayed clean with no commits.
