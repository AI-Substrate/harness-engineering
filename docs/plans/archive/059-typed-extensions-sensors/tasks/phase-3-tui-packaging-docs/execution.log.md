# Phase 3: TUI + packaging + docs — Execution Log

## T001 — Ink/terminal/import-graph spike — NO-GO

**Timestamp**: `2026-07-15T02:04:29Z`

- Verified the binding parent before starting: branch `feat/059-typed-extensions-sensors`, HEAD `cccc605ddef37352356f93f5b2d0cc6ebca2c87d`, staged files `0`.
- Confirmed `ink` and `react` are absent from the current root manifest, lock, and install. Confirmed `.harness/temp/` is gitignored.
- Verified npm `11.10.0`, satisfying the npm ≥11.10 floor.
- Recorded the effective scratch-install configuration before resolution: registry `https://<sfi-proxy-host>/npm/`, npm's seven-day release cutoff as `before = 2026-07-08T02:03:49.864Z`, `prefer-online = true`, `replace-registry-host = always`, and a fresh ignored scratch cache.
- Attempted a scratch-only, scripts-disabled install of pinned `ink@5.2.1` and `react@18.3.1`. Every observed HTTP request targeted the required Microsoft proxy; there was no fallback or contact with `registry.npmjs.org`.
- The proxy served package metadata with HTTP 200 but returned HTTP 404 for its own tarball URLs, including `.../ink/-/ink-5.2.1.tgz`, `.../react/-/react-18.3.1.tgz`, and transitive tarballs. npm exited with `E404`.
- Per the binding rule “Proxy inconsistency → fail closed, STOP and report; never fall back,” T001 is a **NO-GO**. ESM import, alt-screen/raw-mode restoration, absent-Ink failure shape, and core import-graph probes were not attempted because the required package could not be obtained through the sole authorized registry.
- Removed the failed install and fresh npm cache from `.harness/temp/`. Root `package.json` and `package-lock.json` remain unchanged; staged files remain `0`. No T002+ work started.

## T001 Amendment 1 correction — append-only

**Ruling received**: `2026-07-15`

- The prior entry's “proxy inconsistency” diagnosis is superseded. The retry failed because the spike added the unmandated setting `replace-registry-host=always`; npm grafted the configured proxy host onto Microsoft feed tarball paths advertised by the proxy, producing invalid proxy URLs and HTTP 404 responses.
- Prime authorized retry #2 with explicit `replace-registry-host=npmjs`, unchanged proxy registry, seven-day release floor, and `prefer-online=true`. The `npmjs` value is a replacement mode, not permission to contact `registry.npmjs.org`.
- Retry #2 must capture effective npm configuration and the complete outbound host/redirect chain. Only the configured proxy and exact proxy-advertised Microsoft feed/CDN hosts are allowed; any actual `registry.npmjs.org` or unknown-host connection fails closed.

## T001 retry #2 — GO

**Timestamp**: `2026-07-15T02:20:14Z`

### SFI and dependency evidence

- npm remains `11.10.0`. Effective retry configuration was: registry `https://<sfi-proxy-host>/npm/`; npm's seven-day cutoff surfaced as `before = 2026-07-08T02:14:17.655Z`; `prefer-online = true`; explicit `replace-registry-host = npmjs`; fresh ignored cache; local fail-closed CONNECT audit proxy. The `npmjs` value was a mode only.
- Scratch-only, scripts-disabled installation of pinned `ink@5.2.1` and `react@18.3.1` succeeded: 41 packages added. Ink's installed manifest declares `"type": "module"`.
- The CONNECT audit recorded 96 outbound TLS connections, all `ALLOW`, with no `DENY`, unknown host, or `registry.npmjs.org` connection. npm's HTTP trace showed metadata from the configured proxy, proxy-advertised Microsoft feed redirects, then HTTP 200 tarball downloads from the CDN.
- Complete exact host chain/inventory (repeated connections collapsed, ordering preserved by tier):
  1. Registry: `<sfi-proxy-host>`.
  2. Proxy-advertised feeds: `<internal-feed-host>`, `<internal-feed-host>`, `<internal-feed-host>`.
  3. Redirect CDN hosts: `grdvsblobprodsea164<internal-blob-host>`, `ywsvsblobprodsea15<internal-blob-host>`, `x9cvsblobprodsea186<internal-blob-host>`, `3s5vsblobprodcus458<internal-blob-host>`, `79pvsblobprodcus44<internal-blob-host>`, `ftkvsblobprodcus483<internal-blob-host>`, `1p4vsblobprodcus466<internal-blob-host>`, `r30vsblobprodcus451<internal-blob-host>`, `mlcvsblobcin1d0s88<internal-blob-host>`, `oq2vsblobprodcus469<internal-blob-host>`, `6p9vsblobcin1d0s16<internal-blob-host>`, `4gpvsblobprodcus446<internal-blob-host>`, `9wgvsblobprodsea126<internal-blob-host>`, `bsovsblobprodcus457<internal-blob-host>`, `4k6vsblobcin1d0s78<internal-blob-host>`, `jzpvsblobprodcus470<internal-blob-host>`, `ar4vsblobcin1d0s62<internal-blob-host>`, `zhhvsblobcin1d0s20<internal-blob-host>`, `u4hvsblobprodcus433<internal-blob-host>`, `f8svsblobprodsea146<internal-blob-host>`, `89tvsblobprodsea18<internal-blob-host>`, `da5vsblobprodsea175<internal-blob-host>`, `rt9vsblobcin1d0s45<internal-blob-host>`, `2w9vsblobprodsea127<internal-blob-host>`, `6ynvsblobprodcus443<internal-blob-host>`, `qjfvsblobprodsea116<internal-blob-host>`, `4uyvsblobprodcus425<internal-blob-host>`, `36xvsblobcin1d0s24<internal-blob-host>`, `fs5vsblobcin1d0s48<internal-blob-host>`, `qd3vsblobcin1d0s51<internal-blob-host>`, `9mevsblobcin1d0s28<internal-blob-host>`, `jvhvsblobcin1d0s41<internal-blob-host>`, `peavsblobcin1d0s66<internal-blob-host>`, `aqnvsblobprodcus431<internal-blob-host>`, `8wivsblobprodcus487<internal-blob-host>`, `pyfvsblobprodcus422<internal-blob-host>`.

### Compiled ESM and terminal evidence

- Compiled the throwaway TypeScript probe with the harness build's `module: ESNext`, `moduleResolution: Bundler`, `target: ES2022` shape, then loaded Ink exclusively with `await import('ink')`. Every real-PTY path emitted `T001_INK_IMPORT_OK render=function`.
- Real pseudo-terminal results (each required Ink import, raw mode at ready, alt-screen enter and leave bytes, and exact before/after termios equality):
  - normal/exit cleanup: exit `0`, all checks true;
  - SIGINT cleanup: exit `130`, all checks true;
  - uncaught `T001_THROW`: exit `1`, throw observed and all cleanup checks true.
- The PTY harness was corrected to drain terminal output while awaiting the child; this matters because cooked-mode restoration may wait for terminal output drain. The corrected harness then proved all three paths deterministically.
- With only the scratch `node_modules/ink` directory temporarily moved under an automatic restore trap, the compiled absent-package probe returned `{ name: "Error", code: "ERR_MODULE_NOT_FOUND", identifiable: true, mentionsInk: true }`; the directory was restored immediately.
- Core graph proof used Node 24's synchronous module hooks from `node -e` while running the compiled `help --json` command. The command succeeded and reported `resolve_count=388`, `react_or_ink_count=0`, `tracked=[]`; no core command loaded Ink or React.

**Decision**: **GO** for the T001 module-system, terminal-safety, absence, and import-graph questions. T001 is complete; T006/T009's dependency gate is open subject to their own task constraints.

- Deleted all T001 retry code, installed packages, and npm cache from `.harness/temp/`. Root `package.json`/`package-lock.json` remain unchanged and staged files remain `0`.

## T002 — `reading.report` additive contract and corpus

- Added optional author-written `SensorReading.report?: string`; runtime readings require no validator/normalizer copy because the registered `run` function returns the reading directly.
- Appended `report-sensor.ts` to the frozen api-2 corpus at SHA-256 `93f331aef688c7b666da45c24c588c9195e5f27711a8e302764e1c90b9fa15a8`; all prior fixture bytes remain guarded unchanged.
- The sensor scaffold now demonstrates authored `details` plus multi-line `report` derived from bounded exit-code facts and repeats the S12 prohibition on copying raw stdout/stderr.
- Proof covers v2 registration/pass-through and run → atomic state → JSON reader preservation of both fields.
- Focused validation: 4 files / 30 tests passed (`corpus-guard`, `api-2-corpus`, scaffold templates, sensors act).

## T003 — history ring, clear, and mtime port

- `SensorStateStore.write()` now atomically rewrites `history/<name>.jsonl` beside each state commit. Files remain newest-last, in-memory reads are newest-first, malformed lines are skipped with an honest degradation note, and retention is fixed at 50 records.
- Tests pin append order, 50-record trimming, mixed corrupt-line tolerance, missing-history degradation, temp-write/rename atomicity, and persistence for ok/error/timeout records.
- Added `clearAll()` over `FsPort.removeDir` for `state/` plus `history/`; `snapshot.json` is deliberately preserved.
- Added `FsPort.mtimeMs(path): number | null`, real `NodeFs.statSync` handling, and recording/mutable fake support. Real and fake adapters both prove null-on-missing.
- Focused validation: state/store + sensors/scaffold 3 files / 67 tests passed; adapter/store 2 files / 56 tests passed; standalone TypeScript passed.

## T004 — pure TUI view-model

- Added an Ink-free `tui/view-model.ts` covering D2 columns, humanized age/duration text, detail truncation, fail-streak/stale suffixes, full/reduced/minimal width tiers, and banner collapse.
- Pinned every D7 color and NO_COLOR glyph pair, including mechanically distinct crash (`✖`/`E`) versus failing reading (`●`/`✗`) and single-code-point guards.
- Table rows derive trend from the same `SensorTrend` value emitted by `computeTrend`; the AC-11 test pins the computed JSON value and rendered glyph together.
- Added pure detail/playback modeling with report, guidance precedence, snapshot delta/baseline, newest-first history selection, and honest missing-history state.
- Focused validation: 1 file / 13 tests passed; standalone TypeScript passed.

## T005 — shared status assembly and TTY split

- Extracted exported `readSensorStatus()` plus `sensorStatusEnvelope()`; JSON and TUI paths consume the same `SensorStatusData`, now additively carrying declaration watch/timeout and the persisted record needed for detail view.
- The entrypoint resolves `CliIo.interactive` once from `isTTY && TERM !== 'dumb'`; the sensors act never probes process streams.
- Bare sensors launches only when mode is human and `interactive === true`. Production uses a variable-path dynamic import; tests inject a recording launcher and load no real Ink.
- JSON mode always bypasses TUI, including an interactive carrier. The non-TTY bare and forced-JSON test outputs are byte-identical on identical state.
- A missing optional UI module maps to a helpful degraded fallback over the same status data; unknown import/runtime errors remain catastrophic rather than being mislabeled as dependency absence.
- Focused validation: sensors act + view-model 2 files / 22 tests passed; standalone TypeScript passed.

## T009 interim — differential lock proof (real transplant held)

The real `package.json` and `package-lock.json` remain untouched while the p061 differential ruling is pending. All artifacts below are under gitignored `.harness/temp/t009-lock/` and must remain through phase end.

### Resolution and deterministic canonicalizer

- npm `11.10.0`; fresh-resolution config: registry `https://<sfi-proxy-host>/npm/`, seven-day cutoff (`before = 2026-07-08T02:42:58.667Z`), `prefer-online=true`, `replace-registry-host=npmjs`, fresh isolated cache, fail-closed CONNECT audit. Scratch `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` succeeded using 16/16 allowed proxy connections and no npmjs/unknown host.
- Raw npm normalization added 46 nodes plus the root optional edge, but also proposed 18 old-node changes. The canonicalizer rejects/discards all 14 forbidden `libc` removals and permits only the p061 carve-out below:

| Existing node | Before | After |
|---|---|---|
| `node_modules/ansi-regex@6.2.2` | `"dev": true` | `"devOptional": true` |
| `node_modules/es-toolkit@1.47.1` | `"dev": true` | `"devOptional": true` |
| `node_modules/get-east-asian-width@1.6.0` | `"dev": true` | `"devOptional": true` |
| `node_modules/strip-ansi@7.2.0` | `"dev": true` | `"devOptional": true` |

- Canonicalizer SHA-256: `05cf728f3d523b5f77ff7a0e27900cf6bdba138e50260db4965c044f499f8be9`. Its bounded algorithm: require the original lock to equal canonical two-space JSON bytes; require exactly the 46 audited additions; classify the raw 18-entry drift against fixed 14+4 allowlists; preserve every original node except the exact four flips; derive each added URL as `https://registry.npmjs.org/<name>/-/<unscoped-name>-<version>.tgz`; copy each audited `sha1`/`sha512` integrity verbatim; insert only the root `optionalDependencies` edge; sort the union of package keys; compare raw entry slices so every other existing entry stays byte-identical; reject internal URLs or any unexpected change.
- Two independent canonicalizer runs produced the identical candidate SHA-256 `2c900ce36a8c1d00852edc1a0fe612d459118f941c6b6076689daeef9408b0f4`. Report: 46 added nodes, exactly four approved existing-node byte changes, 14 forbidden libc changes discarded, root has no other change, internal URL count `0`.

### Production shape and mutation sensitivity

- Final candidate cold replay: `npm ci --omit=dev --ignore-scripts --no-audit --no-fund --min-release-age=null`, proxy + `prefer-online=true` + `replace-registry-host=npmjs`, fresh cache. Result: 53 packages installed; lock diff `0`.
- `ansi-regex`, `es-toolkit`, `get-east-asian-width`, and `strip-ansi` each resolved inside the isolated production `node_modules` and imported successfully (namespace counts `1`, `188`, `4`, `1`). True dev roots `vitest`, `typescript`, and `@biomejs/biome` were absent. A real Ink render emitted `T009_INK_PRODUCTION_OK`.
- Real PTY re-proof against that install: normal exit `0`, SIGINT `130`, uncaught throw `1`; all three dynamically imported Ink (`render=function`), entered/left alt-screen, enabled raw mode, and restored exact termios state.
- Production replay host audit: 65 connections, 47 exact hosts, all proxy or `<internal-blob-host>`; denied `0`, actual npmjs `0`, unknown `0`.
- Non-vacuity mutant changed only the four lines back to `dev:true`: candidate SHA `2c900c…` → mutant SHA `577419f724a9dca41b2245ef1b443519ded7ce99a432e99c3d5e8630a3d3f8af`. The same omit-dev install dropped from 53 to 49 packages; all four required modules resolved only by escaping to the repo's dev tree, so the isolation check reported `local:false` four times and exited `1`. True dev roots remained absent. Restoring the four flips returned byte-identically to `2c900c…`, and the full production proof returned green.

### Untouched-lock differential for the normal replay blocker

Candidate and baseline used the identical command `npm ci --ignore-scripts --no-audit --no-fund --min-release-age=null`, npm 11.10, proxy registry, `prefer-online=true`, `replace-registry-host=npmjs`, no proxy bypass, scripts disabled, and separate fresh isolated caches. Both used the same fail-closed CONNECT audit.

| Replay | Exit | Connections | Proxy | CDN | Denied/npmjs/unknown | First and sole terminal failure |
|---|---:|---:|---:|---:|---:|---|
| untouched original manifest+lock | 1 | 292 | 16 | 276 | 0 / 0 / 0 | `E404 https://<sfi-proxy-host>/npm/vite/-/vite-8.1.4.tgz` |
| canonical candidate | 1 | 292 | 16 | 276 | 0 / 0 / 0 | `E404 https://<sfi-proxy-host>/npm/vite/-/vite-8.1.4.tgz` |

Both errors say: `Cannot find the file vite-8.1.4.tgz in package 'vite 8.1.4' in feed 'npm-public'`. Equal connection counts/categories and the identical Vite-only terminal error prove the candidate reaches no earlier or new failure; the blocker is pre-existing and repo-wide. No Vite edit or registry fallback was attempted.

### Final transplant and post-apply differential

- Prime accepted the differential basis and authorized the real transplant. The canonicalizer (final script SHA-256 `f8ed386e0c9c18eb52ee14cac27fda7181ee5a674cb85b77f6b43575b742aecb`) wrote the real lock from the audited original+proxy topology. First invocation reported `transplantState=original`; the immediate second invocation reported `transplantState=candidate`. Both real-lock hashes were `2c900ce36a8c1d00852edc1a0fe612d459118f941c6b6076689daeef9408b0f4`.
- Real manifest adds only optional `ink:^5.2.1` and `react:^18.3.1`. Real lock equals the candidate byte-for-byte, contains 46 added nodes + the root edge + exactly the four approved flips, preserves every other old entry including all 14 libc arrays, and contains zero internal feed-host, blob-host, SAS, or proxy URLs.
- Post-apply A/B used fresh caches and the exact same command/config again. Original ran `2026-07-15T03:02:10Z`–`03:02:25Z`, candidate `03:02:37Z`–`03:02:53Z`; both exited 1 at the same sole Vite E404, with no earlier/new candidate failure. Original host audit: 287 total / 16 proxy / 271 CDN / 0 denied / 0 npmjs / 0 unknown. Candidate: 292 total / 16 proxy / 276 CDN / 0 denied / 0 npmjs / 0 unknown.
- **Interpretation ruling (verbatim substance)**: the class reading is correct and the differential is a PASS. The binding allowlist is class-shaped — configured proxy plus exact proxy-advertised Microsoft feed/CDN hosts. Exact hostname-set equality is empirically unsatisfiable because Azure `vsblob` shard names are per-request ephemera (the original itself had 25 shard names the candidate lacked). Security holds bilaterally: `DENY=0`, actual npmjs `=0`, unknown/unapproved `=0`; every host is within `{proxy, <internal-feed-host>, <internal-blob-host>}`; the sole Vite fingerprint is identical; there is no earlier/new candidate error; and the extra approved-CDN volume (`+5` total, `+9` unique) is exactly the added Ink/React fetch set.
- Root `files` already includes `harness/cli/dist`, so compiled TUI output is covered. The lazy absence path emits a degraded envelope naming `npm install ink react` and preserves the shared JSON data path.

**T009 status**: complete by prime ruling. Packed-install launch/absence smoke is retained in T012 after the TUI build exists.

**Binding caveat (INC-009 inherited blocker)**: the differential PASS does NOT make repository cold replay, full gates, ship, or merge 'green'; the vite@8.1.4 proxy feed gap remains an inherited open blocker outside p059/p061 scope (no vite change, no downgrade, no fallback — human portfolio ruling pending).

## T006 — lazy Ink shell and terminal safety

- Enabled `react-jsx`; added the lazy-only launch module, `FullScreen`, hand-authored banner, memoized fixed-width table rows, sole mode-routed input owner, coalesced 1s mtime poll, and 120ms active-only braille spinner.
- Terminal ownership is idempotent and centralized across React cleanup plus `exit`/`SIGINT`/`uncaughtException`; cleanup restores prior raw state, pauses stdin, and leaves alt-screen. Unknown exceptions are rethrown after cleanup.
- Build succeeded with the SFI configuration recorded (`npm run build`; no resolution). Focused fake tests pin terminal session, input routing, poll coalescing, and spinner cadence.
- Compiled CLI real-PTY proof at 120×30: `w` close exit `0` and SIGINT exit `130` both rendered, entered+left alt-screen, and restored exact termios. ASCII close also exited `0`, restored terminal state, and omitted the box-glyph wordmark. Non-TTY `TERM=dumb --json` emitted one JSON envelope and zero ANSI bytes.

## T007 — detail overlay and playback

- Added a full-width detail overlay with status/trend, summary, globs/timeout, run stats, snapshot delta, details, reading-over-declaration guidance, verbatim multi-line report, and history strip.
- Playback uses newest-first history with live index 0, bounded older/newer scrubbing, `⏪ viewing run N of M` banner, and live-tail resume. Missing/corrupt history keeps the current record visible with `history unavailable`.
- A five-record fake history proves every selected run's state/details/report; focused detail model: 1 file / 3 tests passed.

## T008 — keys through shared engine services

- Extracted shared run/snapshot/check callbacks in the sensors act; CLI subcommands and TUI actions now invoke the same code paths.
- `1-9`/`r` use `manual-run`; `s` surfaces degraded no-reading `next_action` without an E-code; `c` clears state+history, preserves snapshot, then check-runs all; `w` closes only; double-`q` calls `ProcessPort.kill(pid, 'SIGTERM')` and keeps the UI alive with an honest flash when the pid is gone.
- Added minimal recording `ProcessPort.kill` implementations. Fake tests prove rerun/snapshot/clear/kill intent and persistence outcomes; context footer moved to `footer.tsx`.

## T010 — resize and visual degradation

- Added fake-clock 150ms generation debounce over `stdout.resize`; one latest size update survives a burst.
- Width tiers remain full ≥100, reduced ≥84 (Run+Trend absent), and minimal below 84; minimal renders only the selected sensor summary. `--ascii` is resolved once from argv, while `CliIo.useColor` carries NO_COLOR behavior into the shape-distinct glyph set.
- Final focused TUI/act/app validation: 5 files / 60 tests passed; standalone TypeScript passed.

## T011 — public docs

- Reworked `docs/how/harness-sensors.md` into the complete human+agent guide: launch/fallback rules, keys, color and shape-distinct glyph legends, width tiers, NO_COLOR/ASCII, detail/report guidance, playback, JSON parity, history layout, and degraded modes.
- Added a README “Live repository sensors” new-way section and documentation-table route, preserving the advisory-vs-explicit-check posture.
- Verified `harness/cli/docs/authoring-verbs.md` already begins “v1 — still supported,” promises indefinite compatibility, and points new work to v2; it was not changed.
- `markdownlint-cli2` on both touched public files: 0 errors. `remark --frail --use remark-validate-links`: both files report no issues.

### Adjudicated single retry — still NO-GO

- Retried exactly once under the orchestrator ruling, from `2026-07-15T02:07:08Z` to the observed failure at `2026-07-15T02:07:41Z`, with the same pinned scratch manifest, same mandated registry/config, and another fresh ignored cache. Effective configuration recorded `before = 2026-07-08T02:07:09.055Z`, `prefer-online = true`, `registry = https://<sfi-proxy-host>/npm/`, and `replace-registry-host = always`.
- Metadata again returned HTTP 200 exclusively from the Microsoft proxy. Tarball requests again returned HTTP 404. Every failing URL used the exact base `https://<sfi-proxy-host>/npm/1es-public/_packaging/npm-public/npm/registry/`; the observed exact suffixes were: `onetime/-/onetime-5.1.2.tgz`, `ansi-regex/-/ansi-regex-6.2.2.tgz`, `ws/-/ws-8.21.0.tgz`, `loose-envify/-/loose-envify-1.4.0.tgz`, `js-tokens/-/js-tokens-4.0.0.tgz`, `mimic-fn/-/mimic-fn-2.1.0.tgz`, `get-east-asian-width/-/get-east-asian-width-1.6.0.tgz`, `yoga-layout/-/yoga-layout-3.2.1.tgz`, `escape-string-regexp/-/escape-string-regexp-2.0.0.tgz`, `convert-to-spaces/-/convert-to-spaces-2.0.1.tgz`, `restore-cursor/-/restore-cursor-4.0.0.tgz`, `environment/-/environment-1.1.0.tgz`, `string-width/-/string-width-7.2.0.tgz`, `type-fest/-/type-fest-4.41.0.tgz`, `wrap-ansi/-/wrap-ansi-9.0.2.tgz`, `es-toolkit/-/es-toolkit-1.49.0.tgz`, `is-fullwidth-code-point/-/is-fullwidth-code-point-4.0.0.tgz`, `is-in-ci/-/is-in-ci-1.0.0.tgz`, `scheduler/-/scheduler-0.23.2.tgz`, `slice-ansi/-/slice-ansi-7.1.2.tgz`, `stack-utils/-/stack-utils-2.0.6.tgz`, `code-excerpt/-/code-excerpt-4.0.0.tgz`, `cli-truncate/-/cli-truncate-4.0.0.tgz`, `react-reconciler/-/react-reconciler-0.29.2.tgz`, `patch-console/-/patch-console-2.0.0.tgz`, `indent-string/-/indent-string-5.0.0.tgz`, `@alcalzone/ansi-tokenize/-/ansi-tokenize-0.1.3.tgz`, `strip-ansi/-/strip-ansi-7.2.0.tgz`, `emoji-regex/-/emoji-regex-10.6.0.tgz`, `signal-exit/-/signal-exit-3.0.7.tgz`, `cli-cursor/-/cli-cursor-4.0.0.tgz`, `ansi-escapes/-/ansi-escapes-7.3.0.tgz`, `react/-/react-18.3.1.tgz`, `widest-line/-/widest-line-5.0.0.tgz`, `slice-ansi/-/slice-ansi-5.0.0.tgz`, `auto-bind/-/auto-bind-5.0.1.tgz`, `ink/-/ink-5.2.1.tgz`, `is-fullwidth-code-point/-/is-fullwidth-code-point-5.1.0.tgz`, `cli-boxes/-/cli-boxes-3.0.0.tgz`, `ansi-styles/-/ansi-styles-6.2.3.tgz`, and `chalk/-/chalk-5.6.2.tgz`.
- npm terminated on `ansi-regex-6.2.2.tgz` with `E404`. No fallback/contact occurred. Per the ruling, there was no third attempt and no configuration change. Retry scratch/cache were removed; root manifest/lock remain unchanged, staged files remain `0`, and T002+ remain untouched.

## T001 chronology and supersession index

The append-only entries above are intentionally preserved even though their file order is not chronological. Read them in this order:

1. **Initial always-mode NO-GO** (`02:04Z`): unmandated `replace-registry-host=always` produced grafted proxy tarball URLs and 404s.
2. **Adjudicated single retry, still NO-GO** (`02:07Z`): repeated the same always-mode configuration exactly once and reproduced the 404.
3. **Diagnosis corrected** (Amendment 1): prime identified `replace-registry-host=always` as the cause; the earlier “proxy inconsistency” diagnosis was superseded.
4. **npmjs-mode retry #2 GO** (`02:20Z`): explicit `replace-registry-host=npmjs` passed SFI host audit, ESM import, terminal restoration, absence-shape, and clean core import-graph proofs.

**Final T001 verdict: GO.** The later T009 Vite feed gap is a separate inherited replay blocker and does not change the T001 result.

## T009 packed-package closure

- Final tarball SHA-256 `b0eb9bd0d69a878e6da5ac56a55a378e870779edf1a934f4b70c29acbd3307ff`, 592 files. Required compiled TUI files (`app.js`, `launch.js`, `view-model.js`) are present under `harness/cli/dist/services/sensors/tui/`.
- Fresh `--omit=optional` install added 4 packages. `ink`/`react` were absent locally; `sensors --json` returned degraded/exit 0 with zero ANSI; real TTY bare sensors emitted the install hint, returned degraded/exit 0, never entered alt-screen, and left termios unchanged.
- Fresh default install added 45 packages. Ink and React resolved from that install; a real 120×30 PTY rendered the live TUI, `w` exited 0, alt-screen entered/left, and termios restored exactly. Both install host audits had zero denied, actual-npmjs, or unknown connections.
- Full lock topology list (all additions mechanically normalized to public npmjs URL form with audited integrity):
  - `node_modules/@alcalzone/ansi-tokenize`
  - `node_modules/@alcalzone/ansi-tokenize/node_modules/ansi-styles`
  - `node_modules/@alcalzone/ansi-tokenize/node_modules/is-fullwidth-code-point`
  - `node_modules/ansi-escapes`
  - `node_modules/auto-bind`
  - `node_modules/cli-boxes`
  - `node_modules/cli-cursor`
  - `node_modules/cli-truncate`
  - `node_modules/cli-truncate/node_modules/ansi-styles`
  - `node_modules/cli-truncate/node_modules/emoji-regex`
  - `node_modules/cli-truncate/node_modules/is-fullwidth-code-point`
  - `node_modules/cli-truncate/node_modules/slice-ansi`
  - `node_modules/cli-truncate/node_modules/string-width`
  - `node_modules/code-excerpt`
  - `node_modules/convert-to-spaces`
  - `node_modules/environment`
  - `node_modules/escape-string-regexp`
  - `node_modules/indent-string`
  - `node_modules/ink`
  - `node_modules/ink/node_modules/ansi-styles`
  - `node_modules/ink/node_modules/chalk`
  - `node_modules/ink/node_modules/emoji-regex`
  - `node_modules/ink/node_modules/signal-exit`
  - `node_modules/ink/node_modules/string-width`
  - `node_modules/ink/node_modules/type-fest`
  - `node_modules/ink/node_modules/wrap-ansi`
  - `node_modules/is-in-ci`
  - `node_modules/loose-envify`
  - `node_modules/loose-envify/node_modules/js-tokens`
  - `node_modules/mimic-fn`
  - `node_modules/onetime`
  - `node_modules/patch-console`
  - `node_modules/react`
  - `node_modules/react-reconciler`
  - `node_modules/restore-cursor`
  - `node_modules/restore-cursor/node_modules/signal-exit`
  - `node_modules/scheduler`
  - `node_modules/slice-ansi`
  - `node_modules/slice-ansi/node_modules/ansi-styles`
  - `node_modules/slice-ansi/node_modules/is-fullwidth-code-point`
  - `node_modules/stack-utils`
  - `node_modules/widest-line`
  - `node_modules/widest-line/node_modules/emoji-regex`
  - `node_modules/widest-line/node_modules/string-width`
  - `node_modules/ws`
  - `node_modules/yoga-layout`
- Other lock hunks are exactly the root optional edge and the four documented `dev:true` → `devOptional:true` changes. No other existing node changed; all 14 libc arrays remain byte-identical. Final real lock SHA-256: `2c900ce36a8c1d00852edc1a0fe612d459118f941c6b6076689daeef9408b0f4`; internal-host/SAS scan: zero.

## T012 — D9 sweep and phase gate

| D9 | Rule | Proving test or recorded manual proof |
|---:|---|---|
| 1 | Alt-screen cleanup on mount, normal exit, SIGINT, and exception | `shell.test.ts` idempotent terminal session; T001 real-PTY normal/SIGINT/throw; compiled T006 PTY `w` and SIGINT both captured enter+leave bytes. |
| 2 | Raw mode restored by the same centralized path | `shell.test.ts` records raw restoration; T001/T006 and packed-install PTYs compare exact before/after termios. |
| 3 | One mode-routed `useInput` owner | `shell.test.ts` route matrix; source audit finds the sole call in `tui/input.tsx:64`. |
| 4 | Memoized rows and stable callbacks | `shell.test.ts` proves `SensorRow.$$typeof === Symbol.for('react.memo')`; source inspection records all row/action callbacks through `useCallback`. |
| 5 | One coalesced update per 1s mtime poll | `shell.test.ts` changes daemon+state mtimes in one FakeClock tick and observes exactly one read/update. |
| 6 | 120ms spinner only while work is in flight | `shell.test.ts` pins cadence/frames and `spinnerShouldRun(0) === false`, `spinnerShouldRun(1) === true`; hook creates no sleep loop when false. |
| 7 | Shallow fixed-column layout with one flex Details tail | Recorded source inspection of `table.tsx`: fixed widths, at most three nested flex levels, Details is the terminal unconstrained text node. |
| 8 | No `<Static>` for mutable rows | Scoped source search over `services/sensors/tui/*.tsx` returned zero `Static` uses. |
| 9 | Never color-only; NO_COLOR/TERM dumb/ASCII honored | `view-model.test.ts` pins every color/fallback pair; compiled ASCII PTY omits wordmark; TERM-dumb JSON manual proof has zero ANSI. |
| 10 | Single-width glyphs, no emoji | `view-model.test.ts` checks every status glyph/fallback is one code point; spinner test pins single-code-point braille frames; source inspection found no emoji vocabulary. |
| 11 | 150ms debounced resize and three tiers | FakeClock resize burst produces one latest update; tier tests pin ≥100/≥84/minimal and minimal selected-only; 120×30 and ASCII PTYs verify instantiated widths. |
| 12 | TUI only for interactive non-dumb stdout; JSON parity elsewhere | `sensors.test.ts` byte-compares non-TTY bare vs forced JSON and proves JSON bypasses injected TUI; packed ink-less/TERM-dumb runs have zero alt-screen/ANSI. |
| 13 | Ink/React loaded only by lazy ESM import | T001 compiled `await import('ink')` proof; final Node module-hook audit at `2026-07-15T03:45:36Z`: `resolve_count=388`, `react_or_ink_count=0`, `tracked=[]` for compiled `help --json`. |
| 14 | Full-width detail overlay and context footer | `detail-model.test.ts` scrubs five records plus missing history; `detail.tsx` is one `width="100%"` column; `footer.tsx` swaps table/detail hints. |

D9 sweep result: 14/14 rows have concrete automated or captured manual proof.

### Final validation

- Final build passed under recorded npm 11.10 SFI config.
- Root suite: **209 files / 2,512 tests passed**. Coverage: 89.39% statements, 79.07% branches, 90.96% functions, 91.83% lines.
- Corpus-focused rerun: 2 files / 16 tests passed; existing fixture bytes remain frozen and `report-sensor.ts` is append-only.
- Worktree compiled doctor: ok, 10 loaded / 0 failed / 0 conflicts. Read-only `<external-read-only-repo>` doctor: ok, 9 loaded / 0 failed / 0 conflicts, all v1; Git status exactly unchanged before/after.
- Authoritative `HARNESS_NO_TELEMETRY=1 node harness/cli/bin/harness.js checks --json` at `2026-07-15T03:46:58.304Z`: every hard gate passed. Overall `degraded` only for the accepted architecture (2) and markdown (199) warn-launch findings.
- Final safety: `git diff --check` clean; staged files `0`; `harness/cli/src/acts/verb.ts` differs from HEAD by 0; forbidden `.the-flow-state.json`/`.flow-pair/` status empty; orchestrator-owned `the-flow.json`/`.md` retain their pre-existing modifications only; T001 retry scratch absent.

**Binding caveat (INC-009 inherited blocker)**: the differential PASS does NOT make repository cold replay, full gates, ship, or merge 'green'; the vite@8.1.4 proxy feed gap remains an inherited open blocker outside p059/p061 scope (no vite change, no downgrade, no fallback — human portfolio ruling pending).

---

## SUPERSESSION — INC-009 RESOLVED by FX002 (appended 2026-07-15, orchestrator)

**Both "Binding caveat (INC-009 inherited blocker)" notes above** (at the T009 status line and this final T012 line) are **SUPERSEDED and CLOSED**. They were true when written — cold replay was blocked and a human portfolio ruling was pending — but that ruling has since been made and executed:

- **Human ruling (Jordan, via o-prime, 2026-07-15)**: proxy/router truth is authoritative; then generalized ("fix them all") into an iterative per-package cold-replay remediation loop. See `../../fixes/FX002-vite-lock-remediation.md` § Source 1 + Source 2.
- **FX002 COMPLETE — GREEN**: absolute cold `npm ci` through the proxy now PASSES end-to-end (exit 0, 0×404, 0 npmjs/unknown/denied). Five packages remediated lock-only (vite 8.1.4→8.1.2; rolldown 1.1.5→1.1.4 + @oxc-project/types 0.139.0→0.138.0; postcss 8.5.18→8.5.16; nanoid 3.3.16→3.3.15; @biomejs/biome 2.5.3→2.5.2 + platform optionals); final lock `d12653fb…`; 591 nodes/add0/remove0; T009 invariants byte-preserved; zero internal/signed URLs. Orchestrator independently re-verified the final lock.
- **Net**: repository cold replay is **no longer blocked**; INC-009 is resolved. Full remediation ledger + evidence in the FX002 dossier. Append-only per execution-log discipline; the historical caveats are left in place, marked superseded by this note.
