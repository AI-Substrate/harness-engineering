# Execution log — 095 conversation dispatch hotfix

## Implementation

- Removed `--pij` from `flowspace3 conversation ingest` argv once identity resolves to native `--harness` + `--session`; `--folder` remains.
- Added a 250 ms bounded grace check after detached spawn. A child absent after the grace returns `dispatch-failed` with its `logPath`; a live child remains `fired` and explicitly unverified.
- Propagated the dispatch result through the conversation port, sync service, CLI envelope, and fakes.

## Receipts

- RED: `npx vitest run test/acts/convo.test.ts` — 5 expected failures covered the old `--pij` identity leak, absent DOA result, and missing degraded envelope.
- GREEN: targeted conversation suite — 22/22 passed.
- Mutation, argv: reintroduced `--pij pij-seat`; `maps native identity to the accepted flowspace3 grammar without --pij` failed on the exact extra pair; mutation reverted.
- Mutation, DOA: replaced liveness branch with unconditional `fired`; `reports a dead-on-arrival child after one bounded grace period` failed; mutation reverted.
- `npx tsc -p harness/cli/tsconfig.json --noEmit` — passed.
- `npm run build` — passed.
- `just fix` — completed; only pre-existing unused-import warnings outside this packet's scope.
- `just test-all` — conversation changes passed; 6 known pre-existing `test/sensors/tui/pty-input.test.ts` PTY failures (backlog 19 family), excluded by prime ruling.
- `node harness/cli/bin/harness.js checks` — product gates passed; overall degraded only on existing advisory architecture/markdown/windows checks.

## Live receipt handoff

`flowspace3 conversation list --json` returned `FS3-E-DAEMON-UNAVAILABLE`. Per prime ruling, the prime owns the read-back delta > 0 receipt after the operator restores the daemon and before merge. No daemon lifecycle action was taken in this worktree.
