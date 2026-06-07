import { describe, expect, it } from 'vitest';
import type { Envelope, Status } from '../../src/output/envelope.js';
import { exitCodeFor } from '../../src/output/exit.js';

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
