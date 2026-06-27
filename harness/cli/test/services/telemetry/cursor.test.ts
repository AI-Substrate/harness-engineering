import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  cursorPathFor,
  readCursor,
  sanitizeSessionId,
  writeCursor,
} from '../../../src/services/telemetry/cursor.js';

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

describe('sanitizeSessionId — H4 collision-resistance (plan 038, telemetry-otel)', () => {
  it('leaves a clean (alnum/_/-) id unchanged — UUIDs / normal session ids keep full entropy', () => {
    expect(sanitizeSessionId('b67cd3ce-e0ee-4048-831e-7f4591f20a60')).toBe(
      'b67cd3ce-e0ee-4048-831e-7f4591f20a60',
    );
    expect(sanitizeSessionId('sess-claude-1')).toBe('sess-claude-1');
    expect(sanitizeSessionId('static_site')).toBe('static_site');
  });

  it('keeps ids that sanitize-collapse to the same base globally distinct (no ref collision → no NFF)', () => {
    // Both would clean to a "user-host-a-b"-ish base; the lossy one gets a stable
    // hash suffix so the per-(date,session) ref can never collide across writers.
    const lossy = sanitizeSessionId('user@host:/a/b');
    const clean = sanitizeSessionId('user-host-a-b');
    expect(lossy).not.toBe(clean);
    expect(sanitizeSessionId('a/b')).not.toBe(sanitizeSessionId('a-b'));
  });

  it('never yields an empty or colliding segment for a degenerate all-symbol id', () => {
    expect(sanitizeSessionId('///')).not.toBe('');
    expect(sanitizeSessionId('@@@')).not.toBe('');
    expect(sanitizeSessionId('@@@')).not.toBe(sanitizeSessionId('###'));
  });

  it('is deterministic — the same raw id always maps to the same segment (stable ref name)', () => {
    expect(sanitizeSessionId('user@host:/a/b')).toBe(sanitizeSessionId('user@host:/a/b'));
  });
});
