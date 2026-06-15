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
- Commit: `04db38b`.

### T006 — envelope field + banner at the exit chokepoint ✅
- **Design deviation from the literal plan, faithful to KF-09:** instead of threading a `banner?` 3rd param through all 43 `exitWithEnvelope` sites (churn + miss-risk — exactly what T006B would have to audit), registered a module-level **`setBannerDecorator`** the kernel consults *inside* `exitWithEnvelope`. This reaches EVERY exit — including the ~24 bespoke human `{ emit }` ports — with **zero per-site edits** and no possibility of missing a site. It is the stronger realization of "decorate at the one universal chokepoint."
- `output/exit.ts`: `BannerDecorator` type + `setBannerDecorator(null-able)` + consult-before-emit (JSON serializes the field; human banner precedes the act's own output). `process.exit` still the only one (arch test green).
- `services/update/banner.ts`: `formatUpdateBanner` (exact AC8 line, em-dash) + `buildBannerDecorator` — ONE sync cache read (no network, AC9); sets the additive field always (AC7), writes the stderr line only in human mode (AC8). Returns structural `(env)=>void` so the exit kernel never imports the service layer.
- Contract doc: the additive / MCP-stable note is the `UpdateAvailable` JSDoc in `output/envelope.ts` (the plan's pointer to `services/docs/contract.ts` was imprecise — that file is the docs-tool seam, unrelated to the envelope).
- Tests: `banner.test.ts` (fakes — human sets field+stderr, json sets field only, no-update silent) + `exit.test.ts` (decorator consulted before emit; no-op when unset) + envelope `toEqual` still green — **19 pass**.
- **Composition wiring is T007; the bespoke-port conformance test is T006B (done after T007, which it depends on).**
- Commit: `293a10d`.

### T007 — wire the banner into the composition root ✅
- `buildProgram` now calls `setBannerDecorator(buildBannerDecorator({fs, env, installed: version, mode, writers}))` ONCE, before registering acts. Both `main()` and the integration harness assemble through `buildProgram`, so every command's exit gets the banner; a single sync cache read on the hot path (no await).
- **Deviation from plan:** the plan also said "NodeVersionLookup in defaultDeps + extend VerbActDeps". The banner doesn't need the lookup (cache-only). The async lookup is built from `deps.exec` inside the update act (T008), so `VerbActDeps` is untouched (zero churn to every test's deps helper). `NodeEnv.home()` is already in `defaultDeps` via `new NodeEnv()`.
- **Full suite green: 60 files / 576 tests** (existing tests' `FakeEnv` has no home ⇒ banner never fires there).
- Commit: `b6e01aa`.

### T006B — banner reaches every emit path ✅
- **Audit:** the `no-direct-exit` arch test guarantees `process.exit` lives ONLY in `output/exit.ts`, i.e. EVERY command terminates through `exitWithEnvelope`. The decorator sits there, so it structurally reaches all 43 exit sites **and** all ~24 bespoke human `{ emit }` ports — no site can bypass it. (The naive "decorate `createOutputPort`" fix would have missed every bespoke human port.)
- **Conformance test** (`test/integration/update-banner.test.ts`, full `buildProgram` wiring, installed 9.9.9 vs cached 9.9.10): banner on `doctor` human (the bespoke `{emit}` path — the critical KF-09 case) + on the bare orientation (shared `createOutputPort` human path) + as the additive `update_available` JSON field on `doctor --json`; stderr-only (never stdout); absent when cache is equal/older/missing. 4 pass.
