#!/usr/bin/env node
import { main } from './app.js';

// Thin bin entry — always runs. All composition logic lives in app.ts (testable,
// never auto-runs). Called unconditionally so the npm/npx bin symlink works
// regardless of how the symlink resolves (companion F005).
//
// main() routes every expected failure through the exit kernel; this .catch() is
// a CATASTROPHIC-only net so the async bin can never float an unhandled promise
// rejection (which would bypass the kernel + the Envelope contract). KF-04.
main().catch((err: unknown) => {
  process.exitCode = 1;
  process.stderr.write(
    `harness: unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
});
