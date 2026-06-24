import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { readCursor, writeCursor } from '../../../src/services/telemetry/cursor.js';

/**
 * T007 (plan 1.6 · AC-01 · C2 redefinition) — cursor crash-safety against the
 * SYNCHRONOUS FsPort.
 *
 * The original "two parallel captures" test was unfalsifiable: FsPort is sync,
 * so a read-then-write is atomic within one tick — intra-process interleaving is
 * a NON-THREAT. What IS a real threat is a crash mid-write leaving a corrupt /
 * empty watermark. This proves the temp+rename discipline: a write goes through
 * a sibling `.tmp` then a `rename`, and a crash BEFORE the rename leaves the
 * prior watermark intact and readable.
 */

const CURSOR = '/repo/.harness/temp/telemetry/sess.cursor';

describe('T007 — writeCursor uses temp + rename (crash-safe)', () => {
  it('writes a sibling .tmp then renames it over the target', () => {
    const fs = new FakeFs();
    writeCursor(fs, CURSOR, 240);

    // a .tmp sibling was written, then renamed over the target
    expect(fs.writes).toContain(`${CURSOR}.tmp`);
    expect(fs.renames).toContain(`${CURSOR}.tmp->${CURSOR}`);
    // the target is never written directly (only via rename)
    expect(fs.writes).not.toContain(CURSOR);
    expect(readCursor(fs, CURSOR)).toBe(240);
  });

  it('a crash AFTER the temp write but BEFORE the rename leaves the prior watermark intact', () => {
    // Prior good watermark on disk.
    const fs = new FakeFs({ [CURSOR]: '100' });

    // Simulate the crash: the temp is written, but the process dies before rename.
    fs.writeText(`${CURSOR}.tmp`, '240');
    // (no rename)

    // The committed watermark is still the prior value — never corrupt/empty.
    expect(readCursor(fs, CURSOR)).toBe(100);
  });

  it('last-writer-wins: a completed write replaces the prior watermark', () => {
    const fs = new FakeFs({ [CURSOR]: '100' });
    writeCursor(fs, CURSOR, 360);
    expect(readCursor(fs, CURSOR)).toBe(360);
  });
});
