# Fix Tasks: Plan 037 Telemetry Fixture Corpus

Apply in order. Re-run review after fixes.

## Critical / High Fixes

### FT-001: Confine `--instance` before any capture writes

- **Severity**: HIGH
- **File(s)**: `.harness/extensions/telemetry-fixtures/extension.ts`, `.harness/extensions/telemetry-fixtures/capture-logic.ts`, `.harness/extensions/telemetry-fixtures/capture-logic.test.ts`
- **Issue**: The capture extension uses `ctx.options.instance` directly in scratch and corpus write paths.
- **Fix**: Add a safe instance-id validator/helper and reject empty, path-like, dot-segment, leading-dot, slash, and backslash values before `mkdirp`/`writeText`.
- **Patch hint**:
  ```diff
  +export function isSafeInstanceId(id: string | undefined): id is string {
  +  return typeof id === 'string' &&
  +    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) &&
  +    !id.includes('..');
  +}
  ```

### FT-002: Remove real local identity/path examples from tracked artifacts

- **Severity**: HIGH
- **File(s)**: `harness/cli/test/services/telemetry/fixture-scrub.test.ts`, `.harness/extensions/telemetry-fixtures/capture-logic.test.ts`, `docs/how/telemetry-fixtures.md`, `.harness/records/retro/2026-06-25/002-037-telemetry-fixture-corpus.md`, `docs/plans/037-telemetry-fixture-corpus/tasks/**/execution.log.md`
- **Issue**: Tracked tests/docs/logs include real local usernames, handles, names, emails, and/or home paths outside the fixture byte-scan boundary.
- **Fix**: Replace with synthetic examples such as `/Users/alice`, `alice`, `example-handle`, `Example Person`, and `person@example.test`. Preserve the lesson without real identifiers.
- **Patch hint**:
  ```diff
  -homeDir: '/Users/<real-user>'
  -username: '<real-user>'
  -names: ['<real-person-name>']
  +homeDir: '/Users/alice'
  +username: 'alice'
  +names: ['Example Person']
  ```

### FT-003: Sanitize companion-retro absolute local paths

- **Severity**: HIGH
- **File(s)**: `docs/retros/code-review-companion.md`
- **Issue**: The uncommitted retro update records local absolute `runDir` and workaround paths.
- **Fix**: Rewrite these as repo-relative `agents/.../runs/<id>` paths or `$REPO_ROOT/...` placeholders before committing.
- **Patch hint**:
  ```diff
  -- runDir: /local/home/path/.../agents/code-review-companion/runs/<id>
  +- runDir: agents/code-review-companion/runs/<id>
  ```

## Medium / Low Fixes

### FT-004: Require copilot-cli process-log usage records by default

- **Severity**: MEDIUM
- **File(s)**: `.harness/extensions/telemetry-fixtures/extension.ts`, related tests
- **Issue**: copilot-cli capture can promote `raw.events.jsonl` without `raw.process.log`, missing AC-03 token correlation.
- **Fix**: If no matching `assistant_usage` records are found, return `unconfigured` with a `next_action` to pass `--log` or choose another session. Add a test for missing process-log data.

### FT-005: Make the telemetry drift guard cover every real fixture instance

- **Severity**: MEDIUM
- **File(s)**: `scripts/telemetry-fixtures.mjs`, `harness/cli/test/services/telemetry/real-capture.e2e.test.ts`, `harness/cli/test/services/telemetry/copilot-vscode-sqlite.int.test.ts`
- **Issue**: The script runs hardcoded suites whose test cases hardcode the current instances.
- **Fix**: Discover `fixtures/real/<surface>/<instance>` directories and either generate parameterized test cases for every instance or fail if any instance lacks a corresponding golden-check path.

### FT-006: Resolve AC-07 mechanism drift

- **Severity**: MEDIUM
- **File(s)**: `scripts/telemetry-fixtures.mjs`, `docs/plans/037-telemetry-fixture-corpus/telemetry-fixture-corpus-plan.md`
- **Issue**: The plan says the guard imports built `dist/` modules and follows the flow-fixture regenerate/git-clean contract; the implementation runs Vitest suites over `src`.
- **Fix**: Either update the plan to record suite orchestration as the accepted mechanism or refactor the script to match the original mechanism.

### FT-007: Formalize the extension/telemetry boundary

- **Severity**: LOW
- **File(s)**: `.harness/extensions/telemetry-fixtures/extension.ts`, `harness/cli/src/services/telemetry/*`
- **Issue**: The dogfood extension imports telemetry internals directly.
- **Fix**: Reclassify the extension as telemetry support in the plan/docs or expose a small capture contract for extension imports.

### FT-008: Regularize Test Doc coverage or update the rule

- **Severity**: LOW
- **File(s)**: new plan-037 tests, `docs/project-rules/rules.md`
- **Issue**: New tests have useful suite comments, but not every promoted test has the exact per-test Test Doc fields required by rules.md §6.3.
- **Fix**: Add the required fields where practical, or amend the doctrine if suite-level Test Docs are now the accepted standard.

## Re-Review Checklist

- [ ] `--instance` traversal cases are rejected before any write.
- [ ] No real local identity/path examples remain in tracked tests/docs/logs added by plan 037.
- [ ] copilot-cli capture cannot silently omit `raw.process.log`.
- [ ] `npm run check:telemetry-fixtures` covers every committed real fixture instance.
- [ ] AC-07 plan text and script behavior agree.
- [ ] Re-run this review and achieve zero HIGH findings.
