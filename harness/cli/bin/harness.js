#!/usr/bin/env node
// Committed executable bin wrapper (plan 017 — T014 CI repair).
//
// `package.json#bin` used to point straight at the tsc output
// (`harness/cli/dist/index.js`), which tsc emits WITHOUT the execute bit and
// git does not track. Whether `npx --no-install harness` then works depends
// entirely on npm's install-time bin fixup having chmodded the build output —
// observed to be unreliable in CI (same npm 10.9.8, green at 08:36, "sh: 1:
// harness: Permission denied" at 10:12). This wrapper is tracked with git
// mode 100755, so the execute bit survives every checkout deterministically
// and the bin needs no install-time chmod at all.
import '../dist/index.js';
