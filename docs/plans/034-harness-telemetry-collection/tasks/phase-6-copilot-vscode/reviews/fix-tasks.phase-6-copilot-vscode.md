# Fix Tasks: Phase 6 — Copilot-VS-Code telemetry (+ Amendment A4)

Apply in order. Re-run review after fixes. Source review: `review.phase-6-copilot-vscode.md`.
Implementation logic is sound — these are governance, publication-hygiene, test-coverage, and one design fix. None require reworking adapter or git-plumbing behavior.

## Critical / High Fixes

### FT-001: Record the `rules §9` governance trail for Amendment A4 (F001)
- **Severity**: HIGH
- **File(s)**:
  - `/Users/jordanknight/substrate/harness-engineering/docs/project-rules/constitution.md` (+ `rules.md`, `idioms.md`, `architecture.md` as applicable)
  - `/Users/jordanknight/substrate/harness-engineering/docs/plans/034-harness-telemetry-collection/harness-telemetry-collection-plan.md` § Amendment A4
- **Issue**: A4 is a breaking reversal of the documented telemetry-attribution stance, but the four core rule docs were not version-bumped and there is no Deviation-Ledger / explicit-ratification entry; `rules §9` makes both a MUST. The plan still records an *unresolved* open question on whether the broader team/repo-only usage norm is relaxed.
- **Fix**:
  1. Decide the lightest correct path: since the reversed constraint lived in `harness-value-measures.md` doctrine (not a numbered Constitution principle), a Deviation-Ledger / ratification entry **plus** a version note may suffice — but per `rules §9`'s first bullet, route it as a doctrine change with a version bump touching `constitution.md`/`rules.md`/`idioms.md`/`architecture.md` together if any of them encode the prior stance.
  2. Add a `rules.md` Deviation-Ledger row (Principle / Why Needed / Simpler Alternative Rejected / Risk Mitigation) capturing the storage-attributable-but-usage-team-grain decision.
  3. Resolve the plan's "Open question for the user" — record the decision (keep P12 usage norm vs relax) so no open governance question ships.
- **Patch hint** (ledger row):
  ```md
  | P12 / value-measures team-grain norm | Telemetry refs must be traceable to who pushed | Keep forced non-individual author | Storage attributable; usage stays team/repo-grain (value-measures § Team-level only) |
  ```

## Medium Fixes

### FT-002: Redact the live VS Code Copilot session id from tracked files (F002)
- **Severity**: MEDIUM
- **File(s)**:
  - `/Users/jordanknight/substrate/harness-engineering/.harness/records/retro/2026-06-25/001-034-copilot-vscode-telemetry.md:64`
  - `/Users/jordanknight/substrate/harness-engineering/docs/plans/034-harness-telemetry-collection/harness-telemetry-collection-plan.md:325`
  - `/Users/jordanknight/substrate/harness-engineering/docs/plans/034-harness-telemetry-collection/the-flow.json:1084,1093,1108,1113` (then regenerate `the-flow.md`)
- **Issue**: The live session id `7fb3a97f` is committed to tracked files; Constitution P12 forbids private identifiers in tracked content (public repo).
- **Fix**: Replace each occurrence with a neutral placeholder (e.g. `<session id>` or `a real session`). For `the-flow.json`, edit the source and regenerate `the-flow.md` (do not hand-edit the rendered `.md`). Keep the structural proof claim ("a real VS Code Copilot session, cwd-matched, 7 turns") — only the id string is the problem.
- **Patch hint**:
  ```diff
  - Proven live on session 7fb3a97f (branch 036-copilot-vscode-telemetry).
  + Proven live on a real VS Code Copilot session (branch 036-copilot-vscode-telemetry).
  ```

### FT-003: Resolve the copilot-vscode session id once and thread it (F003)
- **Severity**: MEDIUM
- **File(s)**:
  - `/Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/telemetry/capture-service.ts`
  - `/Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/telemetry/adapters/copilot-vscode-adapter.ts:142-145`
  - `…/adapters/harness-adapter.ts` (the `HarnessSource`/`HarnessContext` types)
- **Issue**: The session id is re-resolved 3× through a *mutable* `ORDER BY updated_at DESC LIMIT 1` query (in `captureUnsafe`, `currentPosition`, `extract`). Under two same-repo VS Code windows (or an `updated_at` tie), the reads can disagree → the buffer keyed on session S is watermarked from turn-count(S′) and carries events from S″. Also couples `capture-service` to the concrete adapter, bypassing the DI seam.
- **Fix**: Resolve the id once in `captureUnsafe` (already done for buffer keying) and carry it on `HarnessSource`/`HarnessContext` (e.g. `resolvedSessionId`); have `sessionIdFor` read that instead of re-querying. This makes all reads consistent and removes the concrete import from the hot path.
- **Patch hint**:
  ```diff
  - function sessionIdFor(src: HarnessSource): string | null {
  -   return src.db === undefined ? null : resolveCopilotVscodeSessionId(src.db, src.env, src.repoRoot);
  - }
  + function sessionIdFor(src: HarnessSource): string | null {
  +   return src.resolvedSessionId ?? null; // resolved once in captureUnsafe, threaded here
  + }
  ```

### FT-004: Test AC-13's generic-fallback branch (F004)
- **Severity**: MEDIUM
- **File(s)**: `/Users/jordanknight/substrate/harness-engineering/harness/cli/test/adapters/git/exec-git-write.int.test.ts`
- **Issue**: Only the configured-identity branch is asserted; the "no `user.name`/`user.email` → `TELEMETRY_FALLBACK_AUTHOR`" branch of `fallbackIdentityEnv()` is untested, though AC-13 names this file as its proof.
- **Fix**: Add a case that creates the throwaway repo **without** `user.name`/`user.email` (or unsets them), runs `commitTree`, and asserts author+committer email = `TELEMETRY_FALLBACK_AUTHOR.email` and name = `TELEMETRY_FALLBACK_AUTHOR.name`.
- **Patch hint**:
  ```ts
  it('falls back to the generic identity when git has no configured user (AC-13)', () => {
    g('config', '--unset', 'user.email'); g('config', '--unset', 'user.name');
    // …commitTree…; expect %ae/%ce === TELEMETRY_FALLBACK_AUTHOR.email
  });
  ```

### FT-005: Assert the copilot-vscode `working_ratio` (F005)
- **Severity**: MEDIUM
- **File(s)**: `/Users/jordanknight/substrate/harness-engineering/harness/cli/test/services/telemetry/copilot-vscode-events.test.ts`
- **Issue**: AC-22 promises a derived working-ratio, but the test asserts only `tokens`/`rollup.tokens` null.
- **Fix**: Serialize the segment from the fixture and assert `rollup.activity.working_ratio` is present and matches the expected value from the turn-gap timeline.

## Low Fixes (notes — not ship-blocking)

### FT-006: Neutralize the person name in the fake test (F006)
- **Severity**: LOW
- **File**: `/Users/jordanknight/substrate/harness-engineering/harness/cli/test/adapters/git/fake-git-write.test.ts:104`
- **Fix**: `name: 'Jordan Knight'` → `name: 'Example Engineer'` (email `jordan@example.com` is fine — `example.com` is reserved/neutral).

### FT-007: Neutral fallback-identity domain (F007)
- **Severity**: LOW
- **File**: `/Users/jordanknight/substrate/harness-engineering/harness/cli/src/adapters/git/git-write-port.ts:70`
- **Fix**: `noreply@anthropic.com` → a neutral project-controlled value (e.g. `noreply@harness-telemetry.local`). Pre-existing; in-scope now that A4 renamed the const. Update the two tests that assert the fallback email if changed.

### FT-008: Both-env precedence test (F008)
- **Severity**: LOW
- **File**: `/Users/jordanknight/substrate/harness-engineering/harness/cli/test/services/telemetry/capture-service.test.ts`
- **Fix**: Add a case with both `COPILOT_AGENT_SESSION_ID` and `AI_AGENT=github_copilot_vscode_agent` set, expecting `copilot-cli` (the env chain wins before the `AI_AGENT` check — locks the documented precedence).

### FT-009: Cite the schema-freeze test in the exec log (F009)
- **Severity**: LOW
- **File**: `/Users/jordanknight/substrate/harness-engineering/docs/plans/034-harness-telemetry-collection/tasks/phase-6-copilot-vscode/execution.log.md:26`
- **Fix**: Reference `segment-schema.test.ts` (pins `schema_version` 2.0 / frozen field set) next to the AC-revert ✅ claim.

## Re-Review Checklist

- [ ] FT-001 governance trail recorded; plan open-question resolved
- [ ] FT-002 session id redacted in all 5 tracked files; `the-flow.md` regenerated from `the-flow.json`
- [ ] FT-003 sessionId resolved once and threaded; concrete import off the hot path
- [ ] FT-004 fallback-branch test added and green
- [ ] FT-005 working_ratio asserted
- [ ] FT-006–009 applied (or consciously deferred)
- [ ] Suite green (`cd harness/cli && npx vitest run`) and `tsc` clean
- [ ] Re-run the **review** verb and achieve zero HIGH (and no MEDIUM publication-boundary breach)
