# FX001 execution log: repository real sensors

**Date**: 2026-07-15  
**Status**: Complete  
**Scope**: FX001-1 through FX001-4

## Contract preflight

The existing API-2 sensor contract was sufficient. `SensorRunContext.exec`
provides bounded, shell-free access to every existing local script/verb and to
Git for the two derived text counts. No filesystem write, registry, network, or
new engine capability was needed; no harness engine file changed.

Binding clarifications were applied as follows:

1. `coverage-branch` executes its own bounded `npm test`, parses that invocation's
   branch summary, and returns `skip` if the summary is absent. It has no run-order
   or artifact dependency on `tests`.
2. AGENTS.md states the real T005 branch: supported TTY plus Ink uses the TUI;
   non-TTY or `--json` uses JSON; missing Ink/unsupported terminal uses the honest
   degraded fallback. Agents are told never to parse TUI output.
3. Every sensor invokes only `npm` scripts, `node` plus checked-in/local source,
   or `git`. Wrapper audit and tests find zero `npx`, install, audit, or exec-based
   package resolution. The draft's `just test` wording was superseded by this
   binding rule because this branch's `just test` recipe contains `npx`; the
   sensor uses root `npm test`, which runs the same local suite without that
   resolution surface.
4. Merge risk: this branch predates main `0c2c4841`. That commit adds
   `### Skills installs are local-source only (ruling, 2026-07-15)` immediately
   after the AGENTS.md introduction. The new
   `## Sensors: one truth, two views` section is deliberately separate, after
   `## Local checks`. At reconciliation, restore main's local-source install
   section at its original anchor **byte-for-byte** and keep the Sensors section
   distinct; do not blend the two sections.

## FX001-1 — shipped sensor set

`.harness/extensions/repo-sensors/extension.ts` declares one v2 extension with
12 sensors. Every persisted detail/report is authored and bounded; raw child
stdout/stderr is used only to derive a decision.

Final fresh `harness sensors check --json` result: `status:ok`, exit 0, 12
records, 9 pass, 3 warn, 0 fail, 0 error/timeout.

| Sensor | Reading | Score | Wallclock | Timeout |
|--------|---------|------:|----------:|--------:|
| `tests` | pass | — | 7,551 ms | 60,000 ms |
| `skills-check` | pass | — | 219 ms | 30,000 ms |
| `typecheck` | pass | — | 844 ms | 30,000 ms |
| `lint` | pass | — | 412 ms | 30,000 ms |
| `arch-check` | warn (existing warn-launch findings) | — | 1,206 ms | 30,000 ms |
| `docs-drift` | pass | — | 199 ms | 30,000 ms |
| `flows-drift` | pass | — | 1,297 ms | 30,000 ms |
| `doctrine-parity` | pass | — | 271 ms | 30,000 ms |
| `windows-check` | pass | — | 226 ms | 30,000 ms |
| `coverage-branch` | warn | 79.07% higher, target 80% | 7,954 ms | 60,000 ms |
| `todo-debt` | warn | 164 lower, target 20 | 194 ms | 30,000 ms |
| `lock-hygiene` | pass | 0 lower, target 0 | 19 ms | 30,000 ms |

All are seconds-class and below their declared bounds. The extension briefing
publishes this table and the binding budget: target seconds; tolerate about
2–3 minutes, never longer; above 180 seconds is a design smell; if a sensor
needs 20 minutes, it is not a sensor.

The extension-local contract suite proves:

- exact 12-name set, non-empty source globs, and every timeout ≤180,000 ms;
- coverage's independent command and missing-summary `skip` behavior;
- envelope-status mapping without copying downstream prose;
- score decisions for coverage/debt/lock hygiene;
- no raw output persistence and zero `npx`/package-resolution calls;
- direct scan of the untracked new extension with the existing Windows rules:
  zero findings. This closes the pre-stage visibility gap in `windows-check`,
  whose production enumerator correctly uses tracked `git ls-files`.

Focused result: 1 file / 6 tests passed.

## FX001-2 and FX001-3 — two views and public guidance

Updated:

- `AGENTS.md` with the binding human/agent split, TTY/fallback semantics, keys,
  JSON/check/watch agent commands, and runtime budget;
- `README.md` with all 12 measurements and watch globs;
- `docs/how/harness-sensors.md` with the same exact set, coverage independence,
  local-only wrapper rule, cross-link to AGENTS.md, and authoring budget;
- `.harness/extensions/repo-sensors/instructions.md` with commands, readings,
  measured wallclocks, and timeout budgets.

Validation:

- targeted markdownlint: 3 in-scope authored docs, 0 findings;
- remark link validation: AGENTS.md, README.md, and the sensors guide all report
  `no issues found`;
- the `.harness/` briefing is outside the repository's configured Biome and
  markdown scopes; its code/contract is instead loaded by doctor and exercised
  by the extension-local suite.

## FX001-4 — real operation proofs

### Doctor

Final compiled doctor:

```json
{"status":"ok","total":11,"loaded":11,"failed":0,"conflicts":0,"repoSensorCount":12,"repoFormat":"v2 (api 2)"}
```

### Watch, quiescence, and dedup

The compiled watcher ran as a real headless process. A temporary watched TypeScript
probe under the new extension exercised `tests`, `coverage-branch`,
`windows-check`, and `todo-debt`.

An initial proof found that `todo-debt`'s broad `**/*.js`-style glob observed
compiled `dist` output written by the suite's PTY test, causing one self-induced
rerun. This was a userland watch-scope issue, not an engine dedup defect. The
watch list was narrowed to authored source/test/extension/skill/script/doc paths
and a regression assertion excludes generated `dist` paths.

Final proof:

| Point | tests | windows | coverage | debt |
|-------|------:|--------:|---------:|-----:|
| initial | 3 | 3 | 3 | 4 |
| after one content change | 4 | 4 | 4 | 5 |
| after a three-write burst | 5 | 5 | 5 | 6 |
| after mtime-only duplicate | 5 | 5 | 5 | 6 |

- daemon heartbeat/pid became readable;
- all final records have `trigger:"watch"`, `stale:false`, and one shared final
  trigger hash;
- the three-write burst produced exactly one run per matching sensor;
- the same-content mtime event produced zero runs;
- concurrent suite-backed watch runs measured 10,694 ms (`tests`) and 10,678 ms
  (`coverage-branch`), still seconds-class and below 60 seconds.

### Real TUI

A 160×40 real PTY launched the compiled bare `sensors` command against the real
set. Evidence: all 12 sensor names/prefixes rendered, the block-element banner
rendered, stdin entered raw mode, alt-screen enter/leave bytes were present,
`w` exited 0, and termios matched exactly before/after.

### Repository gate

- Root suite: **212 files / 2,523 tests passed**.
- Build: generated docs/flows and TypeScript compilation passed.
- Authoritative checks at `2026-07-15T04:38:42.193Z`: every hard gate passed.
  Overall `degraded` remains only the accepted architecture (2) and markdown
  (199) warn-launch findings; skills and Windows checks are ok.
- Final safety audit: tracked diff check clean, staged files 0, temporary watch
  probe absent, and the FX path status is exactly AGENTS.md, README.md, the
  sensors guide, `.harness/extensions/repo-sensors/`, and this log. No file was
  staged or committed.

## Discoveries and learnings

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
| 2026-07-15 | FX001-1 | Contract | The drafted `just test` wrapper would traverse this branch's `npx` recipe, conflicting with the later zero-npx ruling. | Wrap root `npm test`, the same installed local suite script. |
| 2026-07-15 | FX001-1 | Validation | `windows-check` enumerates tracked files, so an unstaged extension is not visible to its production scan. | Extension-local test invokes the existing pure scanner directly on `extension.ts`; zero findings, no staging. |
| 2026-07-15 | FX001-4 | Dogfood | A repository-wide debt glob observed generated JS from a test-local compile and caused feedback reruns. | Scope watch globs to authored directories and pin generated-output exclusion. |
| 2026-07-15 | FX001-4 | Evidence | Real direct and TUI surfaces both consume the same 12 persisted records without running sensors on read. | Retain the one-truth/two-renderers documentation and state-only reader posture. |
