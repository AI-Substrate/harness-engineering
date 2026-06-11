import { describe, expect, it } from 'vitest';
import type { Envelope, Status } from '../../src/output/envelope.js';
import { emitRawAndExit, exitCodeFor } from '../../src/output/exit.js';
import type { Writers } from '../../src/output/output-port.js';

const env = (status: Status): Envelope => ({
  command: 'x',
  status,
  timestamp: '2026-06-08T07:20:00.000Z',
});

describe('exitCodeFor (status -> exit code, authoritative map)', () => {
  it.each([
    ['ok', 0],
    ['degraded', 0],
    ['unconfigured', 2],
    ['error', 1],
  ] as const)('%s -> exit %i', (status, code) => {
    /*
    Test Doc:
    - Why: scripts/CI distinguish "not built" (2) from "broke" (1) from "fine" (0) (workshop 001).
    - Contract: ok=0, degraded=0, unconfigured=2, error=1.
    - Usage Notes: degraded is 0 by default; unconfigured is ALWAYS 2.
    - Quality Contribution: prevents the minih/chainglass trap of unconfigured->0 hiding unbuilt slots.
    - Worked Example: exitCodeFor({status:'unconfigured'}) === 2.
    */
    expect(exitCodeFor(env(status))).toBe(code);
  });

  it('unconfigured is 2, never 0 (honest "not built")', () => {
    expect(exitCodeFor(env('unconfigured'))).toBe(2);
  });
});

describe('emitRawAndExit (verbatim passthrough, flush-safe)', () => {
  it('writes the raw text and sets process.exitCode WITHOUT calling process.exit (F002)', () => {
    /*
    Test Doc:
    - Why: a large raw payload (harness docs <id>) piped/redirected must not be truncated by an
      early process.exit that races the stdout flush; the kernel sets exitCode and returns instead.
    - Contract: emitRawAndExit writes the text to stdout and sets process.exitCode (default 0).
    - Quality Contribution: pins the truncation-safe exit path the docs raw-dump relies on.
    - Worked Example: emitRawAndExit('# Doc\n', writers) -> writers.out got '# Doc\n', exitCode 0.
    */
    let written = '';
    const writers: Writers = {
      out: (t) => {
        written += t;
      },
      err: () => {},
    };
    const prev = process.exitCode;
    emitRawAndExit('# Doc\n\nbody', writers);
    expect(written).toBe('# Doc\n\nbody');
    expect(process.exitCode).toBe(0);
    process.exitCode = prev;
  });
});
