import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SEGMENT_FIELD_KEYS,
  SEGMENT_SCHEMA_VERSION,
  type SegmentInput,
  serializeSegment,
} from '../../../src/services/telemetry/segment.js';

/**
 * T002 (plan 1.2 · AC-12 · C4/F3) — the `segment.schema.json` contract.
 *
 * The schema is the cross-tool / cross-repo consumer contract; the TS type +
 * allowlist are the producer side. These tests pin them KEY-SET-EQUAL (not
 * subset) so a field can never appear on one side only, and freeze the field
 * set against the schema_version so a silent contract change is impossible.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(HERE, '../../../src/services/telemetry/segment.schema.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as {
  type: string;
  additionalProperties: boolean;
  required: string[];
  properties: Record<string, { const?: string }>;
};

const REPO = '/repo';

describe('T002 — segment.schema.json key-set EQUALITY with the allowlist', () => {
  it('schema property set equals SEGMENT_FIELD_KEYS exactly', () => {
    expect(Object.keys(schema.properties).sort()).toEqual([...SEGMENT_FIELD_KEYS].sort());
  });

  it('every field is required (no optional top-level field)', () => {
    expect([...schema.required].sort()).toEqual([...SEGMENT_FIELD_KEYS].sort());
  });

  it('forbids additional top-level properties (no smuggled fields)', () => {
    expect(schema.additionalProperties).toBe(false);
  });

  it('pins schema_version const to "2.0"', () => {
    expect(schema.properties.schema_version?.const).toBe('2.0');
    expect(SEGMENT_SCHEMA_VERSION).toBe('2.0');
  });

  it('$id tracks the schema version (no stale $id drift — companion LOW finding)', () => {
    expect((schema as unknown as { $id: string }).$id).toContain('segment-2.0');
  });
});

describe('T002 — a golden segment populates EVERY top-level field', () => {
  it('serializes a fully-populated input with no undefined top-level field', () => {
    const golden: SegmentInput = {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'sess-golden',
      timecode: '2026-06-23T04:58:00Z',
      window: { since: 'last-command', from: 0, to: 512 },
      branch: '034-harness-telemetry-collection',
      branch_changed: true,
      tokens: {
        input: 1,
        output: 2,
        cache_create: 3,
        cache_read: 4,
        total: 3,
        subagent_tokens: 5,
        grand_total: 8,
      },
      models: { 'claude-opus-4-8': { turns: 2, output_tokens: 2 } },
      effort: 'high',
      skills: { 'the-flow': 1 },
      tools: { Bash: 3 },
      subagents: [
        {
          type: 'code-review-companion',
          agent_name: 'reviewer',
          model: 'claude-opus-4-8',
          status: 'done',
          tokens: 100,
          tool_uses: 4,
        },
      ],
      files: { written: ['/repo/a.ts'], edited: ['/repo/b.ts'] },
      plans_touched: ['034-harness-telemetry-collection'],
      events: {
        compactions: [{ trigger: 'auto', pre_tokens: 1000, post_tokens: 200 }],
        api_errors: 0,
        local_commands: 1,
      },
      thinking: { blocks: 7 },
    };

    const seg = serializeSegment(golden, REPO) as Record<string, unknown>;
    for (const key of SEGMENT_FIELD_KEYS) {
      expect(seg[key], `field "${key}" must be present`).toBeDefined();
    }
    // capability fields stay non-null here because the golden populates them
    expect(seg.tokens).not.toBeNull();
    expect(seg.thinking).not.toBeNull();
  });
});

describe('T002 — version freeze (field-set change MUST bump schema_version)', () => {
  it('the frozen field set is paired with schema_version 2.0', () => {
    // FROZEN SNAPSHOT — if you change the segment field set, you MUST bump
    // SEGMENT_SCHEMA_VERSION and update this snapshot in the same change. This
    // test makes a silent contract drift impossible. (2.0 added event_stream +
    // the derived rollup — the v1 count fields remain as a compatibility view.)
    const FROZEN_V2_0_FIELDS = [
      'schema_version',
      'command',
      'harness',
      'harness_session_id',
      'timecode',
      'window',
      'branch',
      'branch_changed',
      'tokens',
      'models',
      'effort',
      'skills',
      'tools',
      'bash_commands',
      'harness_commands',
      'user_prompts',
      'subagents',
      'files',
      'plans_touched',
      'events',
      'thinking',
      'event_stream',
      'rollup',
    ];
    if (SEGMENT_SCHEMA_VERSION === '2.0') {
      expect([...SEGMENT_FIELD_KEYS].sort()).toEqual([...FROZEN_V2_0_FIELDS].sort());
    }
  });
});
