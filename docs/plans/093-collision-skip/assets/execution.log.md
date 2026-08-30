# Execution log

## Collision reproduction and fix

- RED: the real-jiti fixture `repo-core-conflict` registered extension verb `convo`; Commander aborted composition with `cannot add command 'convo' as already have command 'convo'` (`artifact://11`).
- Fix: reserved every currently registered core command, including `convo`, and added a composition-root parity test so future core verbs cannot omit reservation silently.
- Diagnostic: E142 now distinguishes core-command collisions from earlier-extension collisions and names the losing extension directory without inferring any cause beyond the collision.
- Sibling behavior: the fixture's `healthy` extension still loads and runs; the core `convo` command remains registered.
- Ordering: discovery already supplies sorted candidates; the existing alpha/beta fixture proves first-loaded wins, now also asserting the losing directory is named.

## Evidence

- Targeted GREEN: 2 files, 51 tests passed (`artifact://31`).
- Skip mutation RED: removing `convo` from the reserved set restored Commander's fatal duplicate-command error (`artifact://15`).
- Diagnostic mutation RED: removing the directory from E142 made the degraded-row assertion fail with the exact missing directory (`artifact://17`).
- `just fix`: completed; three unrelated pre-existing unsafe unused-import warnings remain (`artifact://31`).
- `just checks`: tests, Biome, typecheck, generated-doc/flow/telemetry drift, doctrine parity, root smoke, and skills checks passed; established warn-launch architecture/markdown/Windows findings kept the envelope degraded (`artifact://29`).
- Full suite: all changed-path tests passed, but six unrelated `test/sensors/tui/pty-input.test.ts` readiness/input assertions failed twice in this environment (`artifact://24`, `artifact://26`); captured as harness observation `DL-001`.

## Discoveries & learnings

| Tag | Finding |
|---|---|
| Noteworthy | The manual reserved-name set had drifted from the composition root. A parity test now derives the actual Commander surface and fails on future drift. |
| Deferred | Six pre-existing/unrelated PTY sensor tests do not observe TUI readiness or input in this environment; outside packet scope and recorded as `DL-001`. |
