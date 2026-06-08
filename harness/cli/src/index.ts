#!/usr/bin/env node
import { main } from './app.js';

// Pipe-friendly raw output (`harness docs <id> | head`) can have stdout closed
// by the reader before we finish writing, which Node surfaces as EPIPE. Treat a
// broken pipe as a normal early-close (not a failure) so the raw-dump path never
// prints a stack trace; re-surface any other stream error unchanged. Uses
// process.exitCode (never process.exit) so the single-exit architecture holds.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') {
    process.exitCode = 0;
    return;
  }
  throw err;
});

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
