# Phase 3 — Execution Log

**Plan**: `telemetry-fixture-corpus-plan.md` · **Phase**: 3 (Operability + regeneration) · **Mode**: Full · **Companion**: `code-review-companion` run `2026-06-25T10-52-23-999Z-aa6f`

---

## T001 — `scripts/telemetry-fixtures.mjs` regen + `--check` drift guard (AC-07)

**Decision (the dossier's flagged fork — resolved)**: the script **orchestrates the existing golden suites** rather than re-importing `dist/` and duplicating the 4 per-surface segment builders.
- The raw→segment construction (FakeFs/FakeEnv/FakeDb wiring + the throwaway `node:sqlite` rebuild that proves the copilot-vscode SQL round-trip) lives **once**, in `real-capture.e2e.test.ts` (claude/copilot-cli/cursor) + `copilot-vscode-sqlite.int.test.ts` (copilot-vscode). Both mint golden + `invariants.json` under `REGEN_GOLDEN=1`.
- Duplicating those builders in a `.mjs` (esp. the sqlite dance) is the exact drift hazard AC-07 exists to prevent. The script reuses them: `gen` runs the suites with `REGEN_GOLDEN=1`; `--check` runs them plainly (their deep-equal golden/invariants assertions exit non-zero on drift).
- **Deviation from plan 3.1's literal "import the built `dist/` modules" wording** — flagged to the companion in the briefing. AC-07's substance (a `--check` drift guard that fails on divergence + a CI gate) is fully met. Single source of truth honored over the literal mechanism.
- Mechanics mirror `flow-fixtures.mjs`: repo-root via `fileURLToPath`; runs the repo-hoisted `node_modules/vitest/vitest.mjs` directly via `process.execPath` (no `.bin` shim — cross-platform, deterministic across npm majors), cwd = `harness/cli` so `vitest.config.ts` resolves. No prior `npm run build` needed (suites import from `src/` via vitest's TS pipeline).

**Done-When — all proven**:
- `--check` clean on HEAD → `Test Files 2 passed (14)`, exit 0.
- Perturbed the claude golden (`"command":"flow"`→`"DRIFTED"`) → `--check` exit **1** (drift caught); `git checkout` restored → exit 0; tree clean.
- `gen` (default) → rewrote all goldens with **no `git diff`** (machine-independent / deterministic, per the plan's cross-machine-determinism risk).

**Evidence**:
```
$ node scripts/telemetry-fixtures.mjs --check   →  Test Files 2 passed (2) · Tests 14 passed · exit 0
$ (perturb golden) node scripts/telemetry-fixtures.mjs --check  →  exit 1
$ (git checkout) node scripts/telemetry-fixtures.mjs --check    →  exit 0
$ node scripts/telemetry-fixtures.mjs           →  exit 0, git status fixtures/ = clean
```

**Files**: `scripts/telemetry-fixtures.mjs` (new).

---

## T002 — `just`/npm/CI wiring (AC-07)

- `package.json`: added `gen:telemetry-fixtures` (`node scripts/telemetry-fixtures.mjs`) next to `gen:flow-fixtures`, and `check:telemetry-fixtures` (`… --check`) next to `check:flows`.
- `.github/workflows/ci.yml`: added a **"Telemetry fixtures drift guard"** step running `npm run check:telemetry-fixtures`, immediately after the flows drift guard (after the build step). Named, fast (~160ms), with a clear "re-run gen" remediation message on drift — a deliberate explicit gate even though the goldens also run in the full coverage step.
- `justfile`: thin `gen-telemetry-fixtures` + `check-telemetry-fixtures` passthroughs to the npm scripts (matching the repo's recipe-comment style).

**Done-When — proven**: `package.json` valid JSON; `npm run check:telemetry-fixtures` → exit 0 (`checked 2 golden suite(s)`); `just --list` shows both recipes; CI step present (`ci.yml:87`). Mirrors the `check:flows` shape.

**Files**: `package.json`, `.github/workflows/ci.yml`, `justfile`.

---

## T003 — `docs/how/telemetry-fixtures.md` runbook (AC-08/AC-05)

Capture → scrub → gitignored `scratch/` → **non-skippable manual "anything bad" review** → promote → commit, for all four surfaces. Written in the `docs/how/` house style (standalone, the "where docs live" note). Covers:
- The `harness capture-fixtures` verb surface + the **per-surface `--session` table** (claude optional · copilot-cli/cursor required · copilot-vscode cwd-resolved).
- **Cursor's on-disk path** `~/.cursor/projects/<mangle>/agent-transcripts/<conv>/<conv>.jsonl` + the mangle rule + transcript-verbatim vs bubble-projected asymmetry (AC-05).
- The **two-guard model** (scrub + auto-globbing byte-scan) and what each protects.
- The **git-handle lesson** (`--names`) called out as its own warning — the home-derived username misses git handles (the real `example-handle` leak).
- The manual-review checklist (leak scan targets + content sanity incl. the self-referential-session trap), marked non-skippable in a top banner.
- A regen section pointing at `gen`/`check:telemetry-fixtures`.

**Done-When — proven**: runbook present; manual review explicit + flagged non-skippable; cursor path documented; cross-refs (`README.md`, `instructions.md`, `rules.md` §9) resolve; `markdown-lint` shows **no findings** against the new doc (all 11 repo findings are pre-existing in other files; 24/24 mermaid fences parse incl. the new flow fence).

**Files**: `docs/how/telemetry-fixtures.md` (new).

---

## T004 — expand extension `instructions.md` (AC-06)

Replaced the Phase-1 "runbook lands in Phase 3" stub tail with: a sharpened **two-guard** note (scrub + byte-scan, plus the git-handle caveat), a **"goldens are derived"** section pointing at `gen`/`check:telemetry-fixtures`, and a **"Full runbook + governance"** section linking the new runbook and the `rules.md` § 9 Deviation Ledger.

**Done-When — proven**: present + expanded; both relative links (`../../../docs/how/telemetry-fixtures.md`, `../../../docs/project-rules/rules.md`) resolve from the extension dir.

**Files**: `.harness/extensions/telemetry-fixtures/instructions.md`.

---

## T005 — Deviation Ledger row in `rules.md` § 9 (AC-09)

Appended a second row to the § 9 table: principle violated = sanitized-tracked-docs / no-private-content-in-git (§ 8 SHOULD; Constitution P12); why = adapters need real session bytes; alternative rejected = synthetic-only; mitigation = the three layered controls (scrub + CI byte-scan + non-skippable manual review, gitignored `scratch/` first) with a link to the runbook. `rules.md` is hand-edited (no generator) — appended, not regenerated.

**Done-When — proven**: row present in the § 9 table; the `../how/telemetry-fixtures.md` link resolves; G2 (Constitution gate) satisfied — the plan's knowing P12 deviation now has its ledger entry.

**Files**: `docs/project-rules/rules.md`.

---

## T006 — confirm `.gitignore` covers `scratch/` (Finding 02)

Verified `git check-ignore -v scratch/telemetry-fixtures/claude/2026-06-25-x/raw.jsonl` → matched by `.gitignore:148:scratch/`. Extended the existing comment to explicitly name the telemetry-fixture capture staging + link the runbook (the plan's "add a one-line comment if absent").

**Done-When — proven**: `git check-ignore` confirms the capture staging path is ignored.

**Files**: `.gitignore`.

---

## Phase 3 complete — summary

All six tasks `[x]`. AC coverage: **AC-07** (T001 `--check` drift guard + T002 npm/CI/just wiring — proven: clean check, drift→exit 1, deterministic regen) · **AC-08/AC-05** (T003 runbook, non-skippable manual review + cursor path) · **AC-06** (T004 instructions.md) · **AC-09** (T005 Deviation Ledger row). No new fixtures, no adapter/serializer changes (Non-Goals held). The corpus is now regenerable, documented, and governance-clean.

**Deferred & Noteworthy**:
- *Noteworthy* — T001 deviates from plan 3.1's literal "import the `dist/` modules" wording: the script orchestrates the golden suites instead (single source of truth for segment construction; avoids the AC-07 drift hazard). Flagged to the companion; rationale in the T001 entry.
- *Noteworthy* — the dedicated `check:telemetry-fixtures` CI step partially overlaps the full coverage run; kept as an explicit, named, fast drift gate with a clear remediation message.
- No skipped/blocked tasks, no unmet ACs, no new `TODO`/`FIXME`/`HACK`.

---

## Companion reconciliation (run `…-aa6f`)

Reviewed every commit (verdicts via the run's `inbox/inside/messages.ndjson` — `minih status` `lastAckOf` flaked to null again, the recurring inbox-list delivery gap; the findings WERE delivered). T001 APPROVE · T002 APPROVE · T003 **REQUEST_CHANGES (F001 HIGH)** · T004 APPROVE_WITH_NOTES (F002 MED) · T005-T006 APPROVE_WITH_NOTES (F003 MED).

**All 3 findings real, one root cause, all fixed in the follow-up commit:**

| ID | Sev | Issue | Fix |
|----|-----|-------|-----|
| F001 | HIGH | Runbook said "re-run without `--dry-run` to promote the **reviewed** scratch instance", but the extension's non-dry-run path **re-resolves live sources + re-scrubs** into `corpusDir/` (a fresh capture, not a copy of scratch) — so the reviewed bytes can differ from the committed bytes for appendable logs, weakening the privacy gate | Restructured the runbook: scratch review is the **early** pass (step 3); promote re-captures (step 4); the **binding** non-skippable review is on the promoted `corpusDir/` bytes before `git add` (step 5). Matches `extension.ts:159-164`'s own `next_action`. Diagram + banner updated |
| F002 | MED | `instructions.md` **Usage block** still Phase-1/claude-only ("only claude", "most recent session"), omitted `--log`/`--note` | Rewrote Usage to all four surfaces + per-surface `--session` semantics + `--log`/`--note`; carried the corpus-bytes-review correction into the privacy-discipline list |
| F003 | MED | Deviation Ledger mitigation said review happens "before promotion" — same control-shape overstatement as F001 | Changed to "review of the **promoted corpus bytes** before `git add`/commit/publication" |

**Decision the companion was asked to scrutinise (T001 orchestrate-vs-dist-import)**: accepted — T001 + T002 both APPROVE, no pushback on the orchestration shape. **No code changes** were needed — the extension already behaves correctly (and prints the correct `next_action`); only the docs/governance had drifted from it (Phase 3 stays operability-only).

---

## Full-plan review-fix cycle (the-flow `7 review`, entire plan → REQUEST_CHANGES)

A whole-plan review (Phase 1+2+3) returned **REQUEST_CHANGES** with 3 HIGH, 3 MED, 2 LOW. All eight were verified against source before acting. Resolutions:

| ID | Sev | Verdict | Resolution |
|----|-----|---------|------------|
| **F001** | HIGH | Real — `--instance` flowed into `stageDir`/`corpusDir` write paths with no validation; `../`/`/`/`\` could write **unscrubbed** `raw.unscrubbed.*` outside the gitignored `scratch/` root | Added `isSafeInstanceId` (basename slug `^[A-Za-z0-9][A-Za-z0-9._-]*$`, no `..`) in `capture-logic.ts`; `extension.ts` rejects a bad `--instance` with `E_INSTANCE` **before any write**. 4 new unit tests (accept default/slug; reject empty/sep/`..`/leading-dot). |
| **F002** | HIGH | Real — real identity (`<handle>`/`<name>`/`<email>`/`/Users/<user>`) was committed in tracked tests/docs/logs **outside** the `fixtures/real` byte-scan boundary | Sanitized all 10 plan-037-introduced artifacts to synthetic placeholders (`alice` / `Alice Example` / `alice@example.com` / `example-handle` / `/Users/alice`), lesson preserved. Tests stay green (input + assertion moved together). **Scoping note:** the same tokens exist in ~30 pre-existing non-037 files (plans 002–035, `.minih.json`, guides) — a repo-wide pre-existing condition, **out of scope** for this plan (fixing it would rewrite other plans' frozen review records); flagged for a separate sweep. |
| **F003** | HIGH | Real — absolute local `runDir` home paths in `docs/retros/code-review-companion.md` | **Resolved.** The file is not concurrent human work — it is the **code-review-companion's own retro records** (minih auto-appends one per run; our 037 + a 034-P6 run sat undrained). Sanitized **all 40** `/Users/<user>/…` occurrences to repo-relative (`agents/.../runs/<id>`) / `$REPO_ROOT` and committed it as a records drain. (Prior committed history still holds the old paths — same bounded condition as the F002 pre-existing sweep; not history-rewritten.) |
| **F004** | MED | Real — copilot-cli capture promoted with only `raw.events.jsonl` when no `assistant_usage` records were found, silently missing AC-03 token correlation | `resolveCopilotCli` now returns `ctx.unconfigured(...)` (next_action: pass `--log` / choose a session with usage) when the filtered process log is empty. |
| **F005** | MED | Real — the drift guard delegated to two suites that hardcode the current instances, so a future `fixtures/real/<surface>/<instance>/` could be committed uncovered | `telemetry-fixtures.mjs` now **enumerates every committed instance** and fails if any lacks both a golden and a suite reference. Proven: clean (4/4 covered) → orphan instance → exit 1 → restored clean. |
| **F006** | MED | Real (known) — AC-07 / task 3.1 still said "import the built `dist/` modules"; the impl orchestrates the golden suites | Aligned AC-07 + task 3.1 plan text to bless suite orchestration (single source of truth; supersedes the literal `dist/`-import wording) + note the instance enumeration. |
| **F007** | LOW | Real, already logged as **DL-001** (dogfood `_tooling`→telemetry imports) | Deferred — documented deviation; reclassification/contract is a larger architectural call, not a publication-safety blocker. |
| **F008** | LOW | Real, pre-existing mixed-suite condition (not all promoted tests carry the exact §6.3 Test Doc fields) | Deferred — not introduced by plan 037; regularize-or-amend is its own doctrine task. |

**Proof**: 71/71 affected vitest tests pass (new F001 tests + sanitized F002 tests); `check:telemetry-fixtures` clean with instance enumeration; biome clean on all 037 files; `capture-logic.ts`/`extension.ts` typecheck clean. Also committed: biome line-wrap formatting of five Phase-1/2 telemetry suites (latent format drift; tokens unchanged). **F003 will keep surfacing on re-review until the concurrent session sanitizes its own file** — it is not a plan-037 defect.
