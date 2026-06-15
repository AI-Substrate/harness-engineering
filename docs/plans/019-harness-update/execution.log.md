# Execution Log — 019 harness-update (Implementation, Simple mode)

**Branch**: `019-harness-update` (off `documentation-updates` HEAD; the other agent's WIP preserved untouched — scoped commits only, never `git add -A`)
**Mode**: Simple · single phase · companion: `code-review-companion` (Power On Mode)
**Testing**: Hybrid — full-TDD for the deterministic core; lightweight for thin exec pass-throughs. Fakes only (P3).

---

## T000 — Pre-implement harness seam

- Router (`/eng-harness-flow --event pre-implement`) → re-run boot. This repo's boot = the CLI vitest suite (`just test`).
- **Verdict: HEALTHY** — 55 test files / **535 tests pass**, ~1s warm, coverage 91.3% stmts. Baseline green before any code.
- Companion booted: `code-review-companion`, run `2026-06-15T12-33-03-542Z-8339`, briefed with hazards + domains.

---

## Per-task entries

<!-- appended as each task completes -->

### T001 — EnvPort.home() ✅
- `EnvPort` gains `home(): string | undefined`. `NodeEnv` resolves `$HOME` → `%USERPROFILE%` → `os.homedir()` (empty ⇒ undefined). `FakeEnv` returns an injected home and counts `homeCalls`.
- Verified only `NodeEnv`/`FakeEnv` implement the port; all `new FakeEnv()` call sites unaffected (optional 2nd ctor arg).
- Tests: `test/adapters/env` — 3 pass.
- Commit: `c62f30b`.

### T002 — VersionLookupPort ✅
- New port `latest(): Promise<string|null>`. `NodeVersionLookup` composes `ExecPort` → `npm view <pkg> version --json`, parses a JSON string or array (last entry), and maps any non-ok exit / parse failure to `null` (degrade silently, AC9). `FakeVersionLookup` scripts result-or-throw and counts calls.
- No `node:*` in the adapter (spawning stays in `NodeExec`); `pkg` is injected so there's no service→adapter import.
- Tests: `test/adapters/version-lookup` — 6 pass.
- Commit: `6295c34`.

### T003 — semver is-newer compare ✅
- Pure `isNewer(latest, installed)` in `services/update/semver.ts`: numeric core compare, SemVer §11.4 pre-release precedence (release > `-canary.N`), tolerates leading `v`, ignores `+build`. Malformed either side ⇒ `false` (no phantom update).
- No `node:*` (pure). Tests: `test/services/update/semver.test.ts` — 6 pass (29 assertions across core/equal/older/v-prefix/prerelease/malformed).
