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
- Commit: `2645fb9`.

### T004 — update-check cache ✅
- `services/update/cache.ts`: `cachePath/readCache/writeCache` over `~/.harness/update-check.json` (user-global via `EnvPort.home()` — **never** repo `cwd()/.harness`). Reads are total (missing/corrupt/wrong-shape/home-unresolved ⇒ null, no throw); writes mkdirp the dir, no-op if home unresolved.
- Path via shared `posixJoin` + `HARNESS_DIR`; no `node:*`. Tests: `test/services/update/cache.test.ts` — 8 pass (incl. round-trip + null-home no-op + reads-nothing-when-home-unresolved).
- Commit: `9c66c67`.

### T005 — throttle + check orchestration ✅
- `services/update/update-service.ts`: `bannerFromCache` (sync hot-path source — one cache read, no network), `isDue` (24h window; clock-backwards⇒fresh; corrupt-ts⇒due), `runCheck` (force/window → exactly one lookup; success advances cache; **failure/empty keeps cache so a known update survives — AC9**), `toUpdateAvailable` (pins `command:"harness update"`).
- `services/update/constants.ts`: `PACKAGE_NAME`, `UPDATE_COMMAND`.
- **Envelope groundwork** (additive, harmless now): added `UpdateAvailable` interface + optional `Envelope.update_available?` to `output/envelope.ts`. format* constructors never set it → the 4 `toEqual` snapshots still pass (verified). T006 wires the exit-chokepoint emission.
- No `node:*` in services. Tests: `test/services/update/update-service.test.ts` — 14 pass; re-ran `output/envelope` + `output/output-port` (27 total green).
