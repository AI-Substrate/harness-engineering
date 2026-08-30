import { describe, expect, it } from 'vitest';
import { runConvoAfterCommit } from '../../src/acts/commit.js';
import { runConvoAfterBoot } from '../../src/acts/convo.js';

describe('silent conversation sync seams', () => {
  it('runs once after an actual successful commit, not a no-op or failure', () => {
    let calls = 0;
    const sync = () => calls++;

    runConvoAfterCommit({ ok: true, staged: ['a.ts'] }, sync);
    expect(calls).toBe(1);
    runConvoAfterCommit({ ok: true, staged: [] }, sync);
    runConvoAfterCommit({ ok: false, staged: ['a.ts'] }, sync);
    expect(calls).toBe(1);
  });

  it('runs once after boot and never for another command', () => {
    let calls = 0;
    const sync = () => calls++;

    runConvoAfterBoot({ command: 'boot' }, sync);
    expect(calls).toBe(1);
    runConvoAfterBoot({ command: 'checks' }, sync);
    expect(calls).toBe(1);
  });

  it('never lets conversation sync change commit or boot control flow', () => {
    const throws = () => {
      throw new Error('private failure');
    };
    expect(() => runConvoAfterCommit({ ok: true, staged: ['a.ts'] }, throws)).not.toThrow();
    expect(() => runConvoAfterBoot({ command: 'boot' }, throws)).not.toThrow();
  });
});
