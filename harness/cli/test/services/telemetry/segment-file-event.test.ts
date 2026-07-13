import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FileEvent } from '../../../src/services/telemetry/events.js';
import {
  FILE_EXTERNAL,
  type SegmentInput,
  serializeEvent,
  serializeSegment,
} from '../../../src/services/telemetry/segment.js';

/**
 * plan 056 · T003 — the `file` event serializer + `segment.schema.json` mirror.
 *
 * Two guarantees: (1) path CONFINEMENT — repo-relative inside the repo, the literal
 * `<external>` sentinel outside (NOT the basename, the leak `relativizePath` would
 * cause); (2) ALLOWLIST BY CONSTRUCTION — a planted free-text field on the input
 * event never reaches the serialized output.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(HERE, '../../../src/services/telemetry/segment.schema.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as {
  properties: { event_stream: { items: { properties: Record<string, unknown> } } };
};

const REPO = '/repo/app';

const baseFile: FileEvent = {
  t: '2026-07-07T09:00:00Z',
  kind: 'file',
  path: 'src/x.ts',
  change: 'edited',
  delta: { lines_added: 2, lines_removed: 1, bytes_added: 20, bytes_removed: 8 },
};

describe('serializeEvent(file) — confinement + allowlist (T003)', () => {
  it('keeps an in-repo relative path relative and carries the delta', () => {
    const out = serializeEvent(baseFile, REPO) as FileEvent;
    expect(out).toEqual(baseFile);
  });

  it('relativizes an in-repo ABSOLUTE path against repoRoot', () => {
    const out = serializeEvent({ ...baseFile, path: '/repo/app/src/x.ts' }, REPO) as FileEvent;
    expect(out.path).toBe('src/x.ts');
  });

  it('AC-03: an out-of-repo absolute path becomes <external> (NOT the basename)', () => {
    const out = serializeEvent(
      { ...baseFile, path: '/Users/someone/secrets/creds.env' },
      REPO,
    ) as FileEvent;
    expect(out.path).toBe(FILE_EXTERNAL);
    expect(out.path).not.toContain('creds');
    expect(out.path).not.toContain('secrets');
  });

  it('AC-03: a ..-climbing relative path resolves out-of-repo → <external>', () => {
    const out = serializeEvent({ ...baseFile, path: '../../etc/passwd' }, REPO) as FileEvent;
    expect(out.path).toBe(FILE_EXTERNAL);
    expect(out.path).not.toContain('passwd');
  });

  it('AC-04: a planted free-text field on the input is DROPPED (allowlist)', () => {
    const tainted = {
      ...baseFile,
      secret: 'the file body should never travel',
    } as unknown as FileEvent;
    const out = serializeEvent(tainted, REPO) as Record<string, unknown>;
    expect(out.secret).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(['change', 'delta', 'kind', 'path', 't']);
  });

  it('AC-04: a non-finite delta value degrades to 0 (never NaN on the wire)', () => {
    const bad = {
      ...baseFile,
      delta: { lines_added: Number.NaN, lines_removed: 3, bytes_added: 9, bytes_removed: 4 },
    } as FileEvent;
    const out = serializeEvent(bad, REPO) as FileEvent;
    expect(out.delta.lines_added).toBe(0);
    expect(out.delta.lines_removed).toBe(3);
  });

  it('the schema declares change + delta as event_stream.items properties', () => {
    const props = schema.properties.event_stream.items.properties;
    expect(props.change).toBeDefined();
    expect(props.delta).toBeDefined();
  });

  it('a serialized file event carries no key outside the schema item property set', () => {
    const allowed = new Set(Object.keys(schema.properties.event_stream.items.properties));
    allowed.add('t');
    allowed.add('kind');
    const input: SegmentInput = {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'file-t003',
      timecode: '2026-07-07T09:00:00Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: null,
      event_stream: [{ ...baseFile, path: '/repo/app/src/x.ts' }],
    };
    const seg = serializeSegment(input, REPO) as { event_stream: Array<Record<string, unknown>> };
    const fileEv = seg.event_stream.find((e) => e.kind === 'file');
    expect(fileEv?.path).toBe('src/x.ts');
    for (const ev of seg.event_stream) {
      expect(Object.keys(ev).filter((k) => !allowed.has(k))).toEqual([]);
    }
  });
});
