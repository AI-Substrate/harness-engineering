import { describe, expect, it } from 'vitest';
import { segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import {
  RES_BRANCH,
  RES_COMMAND,
  RES_ENV,
  RES_HARNESS,
  RES_SCHEMA_VERSION,
  RES_SERVICE,
  RES_SERVICE_VERSION,
  RES_SESSION,
} from '../../../src/services/telemetry/otlp/semconv.js';
import { attrMap } from '../../../src/services/telemetry/otlp/types.js';
import {
  SEGMENT_FIELD_KEYS,
  SEGMENT_REQUIRED_KEYS,
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
  it('an empty input emits exactly the always-present (required) key set', () => {
    // v2.0: the v1-compat collections are OMITTED when empty (budget), so an
    // all-empty input serializes only the headline + substrate fields.
    const seg = serializeSegment(baseInput(), REPO);
    expect(Object.keys(seg).sort()).toEqual([...SEGMENT_REQUIRED_KEYS].sort());
  });

  it('every emitted key is in the allowlist — a subset, never a smuggled field', () => {
    const seg = serializeSegment(
      { ...baseInput(), skills: { 'the-flow': 1 }, user_prompts: [3], thinking: { blocks: 2 } },
      REPO,
    );
    for (const k of Object.keys(seg)) expect(SEGMENT_FIELD_KEYS).toContain(k);
  });

  it('pins schema_version to "2.3"', () => {
    const seg = serializeSegment(baseInput(), REPO);
    expect(seg.schema_version).toBe(SEGMENT_SCHEMA_VERSION);
    expect(seg.schema_version).toBe('2.3');
  });

  it('headline capabilities stay present-but-null; empty v1-compat collections are OMITTED', () => {
    const seg = serializeSegment(baseInput(), REPO) as Record<string, unknown>;
    // Headline fields are always present (null when unimplemented, never estimated).
    expect(seg.tokens).toBeNull();
    expect(seg.effort).toBeNull();
    // v2.0 — no events supplied ⇒ empty stream + null rollup (never estimated)
    expect(seg.event_stream).toEqual([]);
    expect(seg.rollup).toBeNull();
    // Empty v1-compat collections are dropped entirely (not carried as {}/[]).
    for (const k of [
      'models',
      'skills',
      'tools',
      'user_prompts',
      'subagents',
      'files',
      'plans_touched',
      'events',
      'thinking',
    ]) {
      expect(Object.keys(seg)).not.toContain(k);
    }
    // bash_commands / harness_commands were removed from the contract entirely.
    expect(Object.keys(seg)).not.toContain('bash_commands');
    expect(Object.keys(seg)).not.toContain('harness_commands');
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

describe('T001 — v1-compat view: prompt array + grouped subagents', () => {
  it('keeps the user-prompt word-count array in order (no dedupe) when populated', () => {
    const seg = serializeSegment({ ...baseInput(), user_prompts: [42, 7, 15] }, REPO);
    expect(seg.user_prompts).toEqual([42, 7, 15]);
  });

  it('groups identical subagents into one entry with a count, omitting null fields', () => {
    const seg = serializeSegment(
      {
        ...baseInput(),
        subagents: [
          { type: 'Explore', agent_name: null, model: null, status: null },
          { type: 'Explore', agent_name: null, model: null, status: null },
          { type: 'general-purpose' },
        ],
      },
      REPO,
    );
    expect(seg.subagents).toEqual([
      { type: 'Explore', count: 2 }, // collapsed, nulls omitted (no agent_name/model/status/tokens keys)
      { type: 'general-purpose', count: 1 },
    ]);
  });

  it('sums tokens/tool_uses across a group; distinct identities stay separate', () => {
    const seg = serializeSegment(
      {
        ...baseInput(),
        subagents: [
          { type: 'reviewer', tokens: 100, tool_uses: 4 },
          { type: 'reviewer', tokens: 50, tool_uses: 2 },
          { type: 'reviewer', model: 'claude-opus-4-8', tokens: 10 }, // different identity (model set)
        ],
      },
      REPO,
    );
    expect(seg.subagents).toEqual([
      { type: 'reviewer', count: 2, tokens: 150, tool_uses: 6 },
      { type: 'reviewer', model: 'claude-opus-4-8', count: 1, tokens: 10 },
    ]);
  });
});

describe('v2.2 — captured_env (allowlisted env snapshot)', () => {
  it('emits captured_env when present, with keys in sorted order', () => {
    const seg = serializeSegment(
      { ...baseInput(), captured_env: { PIJ_ROLE: 'coder', PIJ_ID: 'orch-7' } },
      REPO,
    ) as Record<string, unknown>;
    expect(seg.captured_env).toEqual({ PIJ_ID: 'orch-7', PIJ_ROLE: 'coder' });
    expect(Object.keys(seg.captured_env as object)).toEqual(['PIJ_ID', 'PIJ_ROLE']); // sorted
  });

  it('omits captured_env entirely when empty (the dominant host case)', () => {
    const a = serializeSegment(baseInput(), REPO) as Record<string, unknown>;
    const b = serializeSegment({ ...baseInput(), captured_env: {} }, REPO) as Record<
      string,
      unknown
    >;
    expect('captured_env' in a).toBe(false);
    expect('captured_env' in b).toBe(false);
  });

  it('projects captured_env to a single harness.env kvlist resource attribute', () => {
    const seg = serializeSegment(
      {
        ...baseInput(),
        captured_env: { PIJ_ID: 'orch-7', PIJ_ROLE: 'coder' },
        event_stream: [{ t: '2026-06-23T04:58:00Z', kind: 'prompt', words: 5 }],
      },
      REPO,
    );
    const attrs = attrMap(segmentToOtlpLogs(seg).resourceLogs[0].resource.attributes);
    const env = attrs.get(RES_ENV);
    const pairs = (env?.kvlistValue?.values ?? []).map((v) => [v.key, v.value.stringValue]);
    expect(pairs).toEqual([
      ['PIJ_ID', 'orch-7'],
      ['PIJ_ROLE', 'coder'],
    ]);
  });

  it('omits harness.env when no env was captured (no empty attr)', () => {
    const seg = serializeSegment(
      { ...baseInput(), event_stream: [{ t: '2026-06-23T04:58:00Z', kind: 'prompt', words: 5 }] },
      REPO,
    );
    const keys = new Set(
      attrMap(segmentToOtlpLogs(seg).resourceLogs[0].resource.attributes).keys(),
    );
    expect(keys.has(RES_ENV)).toBe(false);
  });
});

describe('T014 — the segment → OTLP resource mapping uses the frozen harness.* contract', () => {
  it('emits exactly the frozen resource attribute set (identity written once, harness.* names)', () => {
    // A populated, branch-bearing segment → OTLP Logs; the ResourceLogs resource
    // must carry precisely the seven frozen resource attributes, no more, no less.
    const seg = serializeSegment(
      { ...baseInput(), event_stream: [{ t: '2026-06-23T04:58:00Z', kind: 'prompt', words: 5 }] },
      REPO,
    );
    const logs = segmentToOtlpLogs(seg);
    const keys = new Set(attrMap(logs.resourceLogs[0].resource.attributes).keys());
    expect(keys).toEqual(
      new Set([
        RES_SERVICE,
        RES_SERVICE_VERSION,
        RES_SESSION,
        RES_HARNESS,
        RES_COMMAND,
        RES_SCHEMA_VERSION,
        RES_BRANCH,
      ]),
    );
  });

  it('omits harness.branch when the segment has no branch (no empty/identifying attr)', () => {
    const seg = serializeSegment(
      {
        ...baseInput(),
        branch: null,
        event_stream: [{ t: '2026-06-23T04:58:00Z', kind: 'prompt', words: 5 }],
      },
      REPO,
    );
    const keys = new Set(
      attrMap(segmentToOtlpLogs(seg).resourceLogs[0].resource.attributes).keys(),
    );
    expect(keys.has(RES_BRANCH)).toBe(false);
    expect(keys).toEqual(
      new Set([
        RES_SERVICE,
        RES_SERVICE_VERSION,
        RES_SESSION,
        RES_HARNESS,
        RES_COMMAND,
        RES_SCHEMA_VERSION,
      ]),
    );
  });
});
