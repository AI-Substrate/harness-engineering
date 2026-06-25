# Execution Log — Phase 1: Foundation + claude proof

**Plan**: `../../telemetry-fixture-corpus-plan.md` · **Mode**: Full · **Companion**: `code-review-companion` run `2026-06-25T06-58-15-524Z-8621` (Power On Mode)

> Facts + evidence per task. Companion findings logged inline with their `ackOf` review-request mapping.

---

## T001 — fixture-library layout + per-instance convention ✅

- Added `test/services/telemetry/fixtures/real/README.md` — documents `fixtures/real/<surface>/<instance>/` layout (`raw.*` input, `expected-segment.json` golden, `meta.json` with hand-pinned invariants), the per-surface `raw.*` naming for all four surfaces, the two-guard privacy model, and the scratch→scrub→manual-review→promote discipline.
- Scaffolded `fixtures/real/claude/` (`.gitkeep`); additive — existing synthetic fixtures untouched (AC-10).
- **Evidence**: `ls fixtures/real/` → `README.md`, `claude/`.


## T002 — fixture-scrub.test.ts (test-first, RED) ✅

- Wrote `test/services/telemetry/fixture-scrub.test.ts` defining the scrub contract: `scrubText(text, cfg)` + exported placeholders (`HOME_PLACEHOLDER`/`REPO_PLACEHOLDER`/`USER_PLACEHOLDER`) + `ScrubConfig {homeDir, repoRoot, username, names?}`.
- Cases: POSIX home path, repo-root rebase (more-specific-wins), Windows `C:\Users\`, the claude `-Users-<user>-` mangle, bare username, secret shapes (sk-/ghp_/AKIA/Bearer), email, configured name → all scrubbed; **verbatim preservation** of prose/commands/flags; JSONL stays valid JSON post-scrub.
- Config is explicit (P3 — no process.env/platform probing).
- **Evidence**: `vitest run fixture-scrub.test.ts` → 1 failed (module not found) = expected RED.

## T003 — fixture-scrub.ts (impl, GREEN) ✅

- Implemented `src/services/telemetry/fixture-scrub.ts` — pure; imports only `../shared/posix-path` (`toPosix`). No `node:*`, no `process` probing.
- Order: repoRoot (most specific) → homeDir → generic `/Users//home//C:\Users` catch-all → secrets (sk-/gh[posru]_/github_pat_/AKIA/xox/Bearer) → emails → configured names → bare username.
- Defense-in-depth: the GENERIC_HOME catch-all neutralizes ANY home-shaped path, not just the configured one (a real transcript can hold unexpected paths) — strengthens the sole-guard (F01).
- Secret sweep is targeted (prefix + Bearer), deliberately NOT a blunt high-entropy sweep, to avoid eating verbatim command content.
- **Evidence**: `vitest run fixture-scrub.test.ts` → 15 passed (15). `grep node: fixture-scrub.ts` → only the comment.

## T004 — capture-fixtures extension skeleton ✅

- `.harness/extensions/telemetry-fixtures/`: `extension.ts` (verb shell / composition root), `capture-logic.ts` (pure orchestration), `capture-logic.test.ts` (8/8), `instructions.md` (stub; full runbook = Phase 3).
- Verb `capture-fixtures` — name confirmed NOT in the reserved set (help/doctor/new/docs/skills/record/instructions/observe/init/flow). Options: `--surface/--instance/--session/--names/--dry-run`.
- **Topology decision (resolves the flagged Workshop Opportunity)**: the privacy-critical SCRUB stays single-source in core telemetry (`fixture-scrub.ts`, imported by the shell in T005); only extension-specific path/config orchestration is vendored locally + tested locally (arch-check style). One source of truth for the security control. `ctx.fs/fsWrite/env` ARE the injected Node ports — no `node:*` in the extension.
- **Evidence**: `vitest capture-logic.test.ts` → 8/8; `harness capture-fixtures --help` resolves; `grep node: .harness/extensions/telemetry-fixtures` → clean.

### Discoveries
| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-25 | T004 | Noteworthy | Capture-tool topology (the plan's flagged Workshop Opportunity) | Resolved: scrub single-source in core; extension imports it; only orchestration is local. No vendored copy of the security control. | AC-06; plan § Workshop Opportunities |

## T005 — claude capture path ✅

- Implemented the claude branch of `run()`: resolve claude project dir → pick session (`--session` → `CLAUDE_CODE_SESSION_ID` → sole) → read transcript via `ctx.fs` → `scrubText` (core, single-source) → stage UNSCRUBBED original + SCRUBBED candidate + meta to gitignored `scratch/` (P12) → `--dry-run` stops at scratch; else promote SCRUBBED to the corpus dir (uncommitted; commit is the human-gated publication boundary).
- Core scrub imported into the extension via relative path (`../../../harness/cli/src/services/telemetry/fixture-scrub.js`); jiti resolves it at load — confirmed by a live capture.
- **Evidence**: live `harness capture-fixtures --surface claude --dry-run` → ok envelope; staged scrubbed bytes had `jordanknight`→0, `jakkaj@`→0 (down from 9543); `git status` shows `scratch/` ignored. capture-logic 11/11.

### Discoveries
| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-25 | T005 | Noteworthy | **The live session is a PATHOLOGICAL fixture.** It's 41MB AND *about* scrubbing — so the scrubbed bytes still contain 73×`/Users/`, 56×`C:\`, 2×`@gmail.com` as literal DISCUSSION content (`.not.toContain('/Users/')`, `C:\Users\jane` doc examples), none of them real leaks (real identity scrubbed to 0). | Choose a different fixture. Profiled all 24 repo sessions; selected **c8bc0c68** (211KB/95 lines, "set up static html publishing", 5 human prompts, 14 tools, 38 token turns, 71 timestamps, META_lines=0). | T006 |
| 2026-06-25 | T005 | Noteworthy | A byte-scan that bans literal `/Users/`/`C:\` will (correctly) flag a session that *discusses* those tokens, even with no real leak. | Fixture selection must avoid self-referential/meta sessions; documented for the runbook (Phase 3). The scan stays strict (no weakening). | AC-02; T007 |

## T009 — SQLite mechanism spike (Phase-1 exit gate) ✅

- `sqlite-spike.test.ts`: build a throwaway `node:sqlite` db WRITABLE, seed the copilot-vscode `sessions`/`turns` shape, read back through the read-only `NodeDb` running the actual privacy-projecting SQL.
- Proves both halves of AC-04's risk: (a) writable-build → read-only-read round-trip; (b) the privacy boundary — word count + presence flag computed in SQLite, raw message text NEVER selected (asserted absent from the result set).
- **Evidence**: `vitest run sqlite-spike.test.ts` → 3 passed. Phase-2 AC-04 mechanism de-risked before fixture work depends on it. **Phase-1 exit gate: PASS.**

## T006 — capture + manual "anything bad" review ✅

- Captured real session **c8bc0c68** ("set up static HTML publishing via GitHub Pages") → `fixtures/real/claude/2026-06-25-static-site/` (raw.jsonl 207KB / 95 lines + meta.json).
- **Manual review outcome (the non-skippable human gate)**: byte-scan clean (`/Users/`,`C:\`,`jordanknight`,`jakkaj`,`@gmail.com`,key-shapes all 0); 95/95 valid JSON. Reviewed the full human surface — 5 natural prompts (GitHub Pages setup), 10 git/gh commands against the PUBLIC repo `AI-Substrate/harness-engineering`, no tokens printed.
- **Caught by the human review (what the mechanical scrub missed)**: `jakkaj` (the GitHub handle, surfaced in `gh auth status` output) — not covered by the home-derived `username=jordanknight`. Re-captured with `--names "jakkaj,Jordan Knight"` → 0. Lesson logged for the runbook: pass git handles via `--names`.
- **Kept verbatim (confirmed acceptable)**: the 5 prompts as typed; the public project identity `AI-Substrate/harness-engineering` + `ai-substrate.github.io`.
- **Sign-off**: user reviewed storage locations + scan, answered **Approve & commit**.

### Discoveries
| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-25 | T006 | Noteworthy | The home-derived username misses other identity aliases (git handles). The MANUAL review caught `jakkaj` the automated scrub didn't. | Re-captured with `--names`. Runbook (Phase 3) must tell capturers to pass git handles. Validates WHY the manual review is non-skippable. | AC-08; runbook |
| 2026-06-25 | T006 | Noteworthy | Live review companion ended (verdict `completed`) after T005; reviewed T001–T005 with no findings. | Re-booted a fresh companion for T008/T007 (non-gating). Deviation logged; phase-end debrief reads the prior farewell. | companion-mode |

## T008 — real-capture.e2e.test.ts + golden (AC-01) ✅

- `real-capture.e2e.test.ts` drives the fixture through `claudeAdapter.extract` → `serializeSegment`; committed `expected-segment.json` golden (4.6KB, 30 events). Regen: `REGEN_GOLDEN=1 vitest run real-capture.e2e`.
- Hand-pinned invariants (verified vs the real session): `tokens.grand_total=1_019_867`, `total=1_019_867`, `subagent_tokens=0`; `user_prompts=[33,3,21,7,37,24,3]` (7 prompts); `event_stream.length=30`; rollup non-null.
- **Evidence**: `vitest run real-capture.e2e.test.ts` → 3 passed. The fixture IS consumed by a test and it passes.

### Discoveries
| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-25 | T008 | Noteworthy | **Plan AC-01 mis-derived the invariant.** It expected `t_precision==='anchored'`, but the claude transcript carries REAL per-line timestamps → events are EXACT (no t_precision tag). `anchored` is for APPROXIMATED stamps (cursor untimed transcript, synthetic branch/harness events). | Corrected the invariant to "event_stream present + exact ISO timestamps" in the test, plan AC-01, and tasks T008. No adapter change (adapter is correct). | AC-01; segment.ts:278; capture-service.ts:246 |

## T007 — fixture-privacy-scan.test.ts (byte-scan, AC-02) ✅

- Byte-scans the committed bytes of **every** `raw.*` + `expected-segment.json` under `fixtures/real/` for: `/Users/`, JSON-doubled Windows paths, emails, secret shapes (sk-/gh*_/AKIA/Bearer), and **runtime-derived** identity tokens (`USER`/`HOME` basename — scanned, never committed).
- Negative control: a FAKE known-bad string in TEST CODE (`/Users/alice`, `C:\\Windows`, `sk-…`, `bob@example.com`) asserted FLAGGED — the absence assertions can't pass vacuously. No banned token committed to the corpus (validator Finding 2).
- **Evidence**: `vitest run fixture-privacy-scan.test.ts` → 4 passed. Full telemetry suite 287/287 (AC-10 — synthetics untouched). biome clean.

### Discoveries
| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-06-25 | T007 | Noteworthy | A naive `[A-Za-z]:\\` Windows-path scan flags JSON-escaped YAML keys (`on:\n`, `steps:\n`) — letter+colon+`\n`. | In JSON a real backslash is byte-DOUBLED (`C:\\`) vs a single-backslash escape; matched the doubled form. Documented that plain-text Phase-2 process logs need the single-backslash variant. | AC-02 |

---

## ✅ PHASE 1 COMPLETE — Foundation + claude proof

**All 9 tasks done (T001–T009).** The full capture→scrub→review→pin→scan pipeline is proven end-to-end on one real claude session.

**Delivered:**
- Pure `fixture-scrub.ts` service (reuses posix-path; no `node:*`) — 15/15.
- `capture-fixtures` `.harness` extension (composition root + pure orchestration) — 8 more tests; `--help` resolves; scrub single-sourced from core.
- One real, human-reviewed, scrubbed claude fixture (`fixtures/real/claude/2026-06-25-static-site/`) + `expected-segment.json` golden.
- AC-01 e2e golden + hand-pinned invariants (exact-timestamped event_stream) — 3/3.
- AC-02 byte-scan privacy guard over raw + golden with live negative control — 4/4.
- AC-04 SQLite mechanism de-risked (Phase-1 exit gate) — 3/3.

**Verification:** full telemetry suite **287/287** (AC-10 — synthetics untouched); biome clean; `just build` green.

**Deferred & Noteworthy (for the go-decision):**
- *Plan AC-01 corrected* — claude carries exact per-line timestamps; events are NOT `anchored` (that's for approximated stamps). Test + plan + tasks corrected; **adapter unchanged (it was correct)**.
- *Capture-tool topology workshop resolved* — scrub single-source in core; extension imports it (no vendored copy of the security control).
- *Manual review caught `jakkaj`* (git handle) the home-derived username missed → re-scrubbed via `--names`. Runbook (Phase 3) must instruct passing git handles.
- *Phase-2 scan note* — the Windows byte-scan rule matches the JSON doubled-backslash form; plain-text Phase-2 process logs need the single-backslash variant.
- *Companion* — first run lapsed after T005 (no findings); re-booted for T006–T009 (no findings). Live review on every commit.

**Phase-1 exit gate (T009 SQLite spike): PASS** → Phase 2 unblocked.

---

## Companion findings reconciliation (run 2026-06-25T07-33-34Z-4cb5)

The re-booted companion's farewell carried 4 findings (its structured `finding` posts failed schema validation — missing `id` — so they surfaced only in the farewell envelope, recovered from the run transcript). All verified against source and **addressed** in commit `fix(037 telemetry): address companion findings`:

| # | Sev | Finding | Verified? | Fix |
|---|-----|---------|-----------|-----|
| F001 | MED | `anchored` invariant still documented outside the corrected test (README:39 meta example, plan:177/189, validation sidecar, test docstring) — split public contract | ✅ real | Swept all stale `anchored` → "exact ISO timestamps" in README, plan, sidecar, e2e docstring. |
| F002 | MED | Committed `meta.json` omits the hand-pinned invariants the T001 convention promises; test duplicates them as `HAND` constants | ✅ real | Added a committed, human-reviewed **`invariants.json`** per instance (REGEN mints it); the e2e reads it (removed `HAND`). README convention updated (meta=provenance, invariants.json=source of truth). |
| F003 | HIGH | The sole byte-scan is narrower than the scrub: only JSON-doubled Windows paths (misses plain-text `raw.process.log` for AC-03), and omits `github_pat_`/slack secret families | ✅ real | Scan is now artifact-kind-aware (JSON doubled vs plain-text single backslash); **reuses `SECRET_DETECTORS` exported from `fixture-scrub`** (one source of truth — cannot drift); liveness asserts EVERY label; added a plain-text-Windows test. |
| F004 | HIGH | Runtime identity scan (USER/HOME) isn't durable — CI/another reviewer has a different USER, so a capture-time username/name could survive | ✅ real | Honest durability contract documented: generic markers durable on CI; identity scanned via runtime **and** an explicit never-committed `HARNESS_FIXTURE_SCRUB_TOKENS` denylist; plus a non-sensitive `scrub_categories` attestation in `meta.json`. |

**Companion magicWand** (filed as a follow-up candidate): "a companion-mode helper that prints all unacknowledged review requests + prior findings + ackOf as a compact ledger before farewell." → backlog (would have surfaced these 4 findings to me without transcript archaeology).

**Result:** all 4 addressed; full telemetry suite **290/290**, build + biome clean.
