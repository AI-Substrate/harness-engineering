import { describe, expect, it } from 'vitest';
import {
  SEGMENT_FIELD_KEYS,
  SEGMENT_SCHEMA_VERSION,
  type SegmentInput,
  serializeSegment,
} from '../../../src/services/telemetry/segment.js';

/**
 * T001 (plan 1.1 · AC-04) — the serializer's counts-only guarantee, with the
 * **serializer-allowlist negative control** (grill-agent-done Done Contract).
 *
 * The load-bearing claim: a serialized segment carries ONLY allowlisted
 * counts/identifiers — never message/prompt text, file contents, free-form
 * tool-arg strings, or absolute `/Users/...` paths. The serializer is an
 * allowlist BY CONSTRUCTION (it picks each field explicitly, never spreads its
 * input), so a planted secret in a non-allowlisted field is structurally
 * unable to reach the output. These tests fail if that construction regresses.
 */

const REPO = '/repo';

/** A minimal, valid counts-only input (every capability null/empty). */
function baseInput(): SegmentInput {
  return {
    command: 'flow',
    harness: 'claude-code',
    harness_session_id: 'sess-abc',
    timecode: '2026-06-23T04:58:00Z',
    window: { since: 'last-command', from: 100, to: 240 },
    branch: '034-harness-telemetry-collection',
    branch_changed: false,
  };
}

describe('T001 — serializeSegment: key-set is the allowlist', () => {
  it('emits exactly the enumerated field set (no more, no less)', () => {
    const seg = serializeSegment(baseInput(), REPO);
    expect(Object.keys(seg).sort()).toEqual([...SEGMENT_FIELD_KEYS].sort());
  });

  it('pins schema_version to "1.0"', () => {
    const seg = serializeSegment(baseInput(), REPO);
    expect(seg.schema_version).toBe(SEGMENT_SCHEMA_VERSION);
    expect(seg.schema_version).toBe('1.0');
  });

  it('defaults unimplemented capabilities to null / empty (never absent, never estimated)', () => {
    const seg = serializeSegment(baseInput(), REPO);
    expect(seg.tokens).toBeNull();
    expect(seg.effort).toBeNull();
    expect(seg.thinking).toBeNull();
    expect(seg.models).toEqual({});
    expect(seg.skills).toEqual({});
    expect(seg.tools).toEqual({});
    expect(seg.subagents).toEqual([]);
    expect(seg.plans_touched).toEqual([]);
    expect(seg.files).toEqual({ written: [], edited: [] });
    expect(seg.events).toEqual({ compactions: [], api_errors: 0, local_commands: 0 });
  });
});

describe('T001 — PRIVACY: planted-secret negative control (AC-04)', () => {
  it('drops a secret planted in a non-allowlisted field', () => {
    const SECRET = 'SUPER_SECRET_sk-ant-api03-LEAKED';
    const tainted = {
      ...baseInput(),
      // None of these are allowlisted segment fields — they model an adapter or
      // caller accidentally handing the serializer raw content.
      secret: SECRET,
      promptText: 'the user said: my password is hunter2',
      rawToolArgs: { command: `curl -H "Authorization: ${SECRET}"` },
    } as unknown as SegmentInput;

    const seg = serializeSegment(tainted, REPO);
    const json = JSON.stringify(seg);

    expect(json).not.toContain(SECRET);
    expect(json).not.toContain('hunter2');
    expect(json).not.toContain('Authorization');
    expect(Object.keys(seg)).not.toContain('secret');
    expect(Object.keys(seg)).not.toContain('promptText');
    expect(Object.keys(seg)).not.toContain('rawToolArgs');
  });

  it('relativizes in-repo paths and never leaks an absolute /Users/ path', () => {
    const input: SegmentInput = {
      ...baseInput(),
      files: {
        written: ['/repo/src/services/telemetry/segment.ts', '/Users/jordan/secrets/keys.env'],
        edited: ['/repo/harness/cli/package.json', 'already/relative/x.ts'],
      },
    };

    const seg = serializeSegment(input, REPO);
    const json = JSON.stringify(seg);

    expect(json).not.toContain('/Users/');
    // in-repo absolute → repo-relative
    expect(seg.files.written).toContain('src/services/telemetry/segment.ts');
    expect(seg.files.edited).toContain('harness/cli/package.json');
    // out-of-repo absolute → basename only (the dir, incl. /Users/, is dropped)
    expect(seg.files.written).toContain('keys.env');
    expect(seg.files.written).not.toContain('/Users/jordan/secrets/keys.env');
    // an already-relative path is preserved as-is
    expect(seg.files.edited).toContain('already/relative/x.ts');
  });

  it('reduces a ../ traversal that climbs outside the repo to a basename (F001)', () => {
    const input: SegmentInput = {
      ...baseInput(),
      files: {
        written: ['../../Users/jordan/secret.txt', '../sibling-repo/x.ts'],
        edited: ['src/inside.ts'],
      },
    };

    const seg = serializeSegment(input, REPO);
    const json = JSON.stringify(seg);

    // no traversal segment, no absolute leak survives
    expect(json).not.toContain('..');
    expect(json).not.toContain('/Users/');
    expect(seg.files.written).toContain('secret.txt');
    expect(seg.files.written).toContain('x.ts');
    // an in-repo relative path is still preserved
    expect(seg.files.edited).toContain('src/inside.ts');
  });

  it('preserves counts and identifiers verbatim (the signal we DO keep)', () => {
    const input: SegmentInput = {
      ...baseInput(),
      tokens: {
        input: 10,
        output: 20,
        cache_create: 1,
        cache_read: 2,
        total: 30,
        subagent_tokens: 5,
        grand_total: 35,
      },
      skills: { 'the-flow': 2, 'eng-harness-flow': 1 },
      tools: { Bash: 4, Read: 9 },
      plans_touched: ['034-harness-telemetry-collection', '034-harness-telemetry-collection'],
    };

    const seg = serializeSegment(input, REPO);
    expect(seg.tokens?.grand_total).toBe(35);
    expect(seg.skills['the-flow']).toBe(2);
    expect(seg.tools.Bash).toBe(4);
    // plans_touched is deduped
    expect(seg.plans_touched).toEqual(['034-harness-telemetry-collection']);
  });
});
