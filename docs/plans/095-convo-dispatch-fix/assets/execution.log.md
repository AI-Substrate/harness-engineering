# Execution log — 095 conversation dispatch hotfix

## Implementation

- Removed `--pij` from `flowspace3 conversation ingest` argv once identity resolves to native `--harness` + `--session`; `--folder` remains.
- Added a 250 ms bounded grace race after detached spawn. Exit code 0 and a still-running child return `fired`; a nonzero or signalled/error exit returns `dispatch-failed` with its `logPath`.
- Propagated the dispatch result through the background-process port, conversation port, sync service, CLI envelope, and fakes.

## Receipts

- RED: `npx vitest run test/acts/convo.test.ts` — 5 expected failures covered the old `--pij` identity leak, absent DOA result, and missing degraded envelope.
- GREEN: targeted conversation suite — 22/22 passed.
- Mutation, argv: reintroduced `--pij pij-seat`; `maps native identity to the accepted flowspace3 grammar without --pij` failed on the exact extra pair; mutation reverted.
- Mutation, DOA: replaced the dispatch classification with unconditional `fired`; `reports a nonzero child exit within the bounded grace period` failed; mutation reverted.
- LIVE false-red correction: the prime measured read-back delta `+51` and `accepted:true` while the first grace implementation returned `dispatch-failed`. The first bug reported success on failure; that draft reported failure on success — the same instrument lying in opposite directions, exposed only by read-back.
- RED, fast success: a fake detached child exiting 0 at 50 ms reproduced the false-red; the liveness-only implementation returned `dispatch-failed`.
- GREEN, exit-aware grace: targeted conversation + background adapter suite — 29/29 passed; exit 0, nonzero exit, and still-running paths are distinct.
- Mutation, exit zero: classified every early exit as failure; `keeps a fast successful child classified as fired` failed; mutation reverted.
- `npx tsc -p harness/cli/tsconfig.json --noEmit` — passed.
- `npm run build` — passed.
- `just fix` — completed; only pre-existing unused-import warnings outside this packet's scope.
- `just test-all` — conversation changes passed; 6 known pre-existing `test/sensors/tui/pty-input.test.ts` PTY failures (backlog 19 family), excluded by prime ruling.
- `node harness/cli/bin/harness.js checks` — product gates passed; overall degraded only on existing advisory architecture/markdown/windows checks.

## Live receipt

The prime's real-daemon run measured read-back delta `+51`; the ingest log reported `accepted:true`. This proves the corrected argv delivers. That receipt also exposed and rejected the first liveness-only DOA implementation before merge.
