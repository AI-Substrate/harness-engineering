import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { pendingTelemetry } from '../../../src/services/telemetry/sync-service.js';

/**
 * The read-only `pendingTelemetry` probe (plan 034 follow-on) — counts
 * buffered-but-unpushed segments WITHOUT touching git or the buffer, for the
 * boot/checks housekeeping decorator. Pins: counts only seq past each session's
 * watermark, an empty/missing buffer → zero, and fail-safe on a throwing fs.
 */

const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';

function seg(): string {
  return `${JSON.stringify({ command: 'flow', timecode: '2026-03-23T10:00:00.000Z' })}\n`;
}

function probe(files: Record<string, string>, dirs: Record<string, string[]>) {
  return pendingTelemetry({ fs: new FakeFs(files, dirs), proc: new FakeProcess({}, REPO) });
}

describe('pendingTelemetry — read-only unpushed-buffer probe', () => {
  it('is zero when there is no buffer', () => {
    expect(probe({}, {})).toEqual({ segments: 0, sessions: 0 });
  });

  it('counts only segments past each session watermark', () => {
    const r = probe(
      {
        [`${TEL}/sessA/1.json`]: seg(),
        [`${TEL}/sessA/2.json`]: seg(),
        [`${TEL}/sessA.flushed`]: '1', // seq 1 already pushed → only seq 2 pending
        [`${TEL}/sessB/1.json`]: seg(),
        [`${TEL}/sessB/2.json`]: seg(),
      },
      {
        [TEL]: ['sessA', 'sessB'],
        [`${TEL}/sessA`]: ['1.json', '2.json'],
        [`${TEL}/sessB`]: ['1.json', '2.json'],
      },
    );
    expect(r).toEqual({ segments: 3, sessions: 2 }); // sessA:1 + sessB:2
  });

  it('a fully-flushed session contributes nothing', () => {
    const r = probe(
      { [`${TEL}/sessA/1.json`]: seg(), [`${TEL}/sessA.flushed`]: '1' },
      { [TEL]: ['sessA'], [`${TEL}/sessA`]: ['1.json'] },
    );
    expect(r).toEqual({ segments: 0, sessions: 0 });
  });

  it('is fail-safe — a throwing fs yields zero, never throws', () => {
    const throwingFs = {
      readdir: () => {
        throw new Error('boom');
      },
      readText: () => null,
    } as never;
    expect(() =>
      pendingTelemetry({ fs: throwingFs, proc: new FakeProcess({}, REPO) }),
    ).not.toThrow();
    expect(pendingTelemetry({ fs: throwingFs, proc: new FakeProcess({}, REPO) })).toEqual({
      segments: 0,
      sessions: 0,
    });
  });
});
