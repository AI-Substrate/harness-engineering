import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { cursorPathFor, readCursor, writeCursor } from '../../../src/services/telemetry/cursor.js';

/**
 * T005 (plan 1.4) — the session cursor read/write units. Crash-safety (temp+
 * rename, no-corrupt-watermark) is proven separately in cursor-safety.test.ts (T007).
 */

const REPO = '/repo';

describe('T005 — readCursor', () => {
  it('returns null when the cursor file is missing (→ session-start)', () => {
    expect(readCursor(new FakeFs(), '/repo/.harness/temp/telemetry/x.cursor')).toBeNull();
  });

  it('parses a valid non-negative watermark', () => {
    const fs = new FakeFs({ '/c': '240' });
    expect(readCursor(fs, '/c')).toBe(240);
  });

  it('returns null for a corrupt (non-numeric / negative) watermark (→ reset)', () => {
    expect(readCursor(new FakeFs({ '/c': 'garbage' }), '/c')).toBeNull();
    expect(readCursor(new FakeFs({ '/c': '-5' }), '/c')).toBeNull();
    expect(readCursor(new FakeFs({ '/c': '' }), '/c')).toBeNull();
  });
});

describe('T005 — writeCursor + cursorPathFor', () => {
  it('round-trips a watermark through write→read', () => {
    const fs = new FakeFs();
    const path = cursorPathFor(REPO, 'sess1');
    writeCursor(fs, path, 512);
    expect(readCursor(fs, path)).toBe(512);
  });

  it('sanitizes the session id into a safe cursor path', () => {
    const path = cursorPathFor(REPO, 'sess/../../etc');
    expect(path.startsWith('/repo/.harness/temp/telemetry/')).toBe(true);
    expect(path).not.toContain('..');
  });
});
