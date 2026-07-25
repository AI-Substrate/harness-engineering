import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EVENT_KINDS } from '../../../src/services/telemetry/events.js';
import {
  SEGMENT_FIELD_KEYS,
  SEGMENT_REQUIRED_KEYS,
  SEGMENT_SCHEMA_VERSION,
  type SegmentInput,
  serializeSegment,
} from '../../../src/services/telemetry/segment.js';

/**
 * T002 (plan 1.2 · AC-12 · C4/F3) — the `segment.schema.json` contract.
 *
 * The schema is the cross-tool / cross-repo consumer contract; the TS type +
 * allowlist are the producer side. These tests pin the schema PROPERTY set
 * key-set-equal to SEGMENT_FIELD_KEYS (so a field can never appear on one side
 * only) and pin the schema `required` set to SEGMENT_REQUIRED_KEYS (the
 * always-present headline + v2 substrate fields; the v1-compat view is optional,
 * omitted when empty). The field set is frozen against the schema_version so a
 * silent contract change is impossible.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(HERE, '../../../src/services/telemetry/segment.schema.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as {
  type: string;
  additionalProperties: boolean;
  required: string[];
  properties: Record<
    string,
    {
      const?: string;
      additionalProperties?: boolean;
      properties?: Record<string, { pattern?: string; enum?: string[] }>;
    }
  >;
};

const REPO = '/repo';

describe('T002 — segment.schema.json key-set EQUALITY with the allowlist', () => {
  it('schema property set equals SEGMENT_FIELD_KEYS exactly', () => {
    expect(Object.keys(schema.properties).sort()).toEqual([...SEGMENT_FIELD_KEYS].sort());
  });

  it('the required set is exactly the always-present (headline + substrate) keys', () => {
    expect([...schema.required].sort()).toEqual([...SEGMENT_REQUIRED_KEYS].sort());
  });

  it('required is a strict subset of the allowlist (the v1-compat view is optional)', () => {
    for (const k of SEGMENT_REQUIRED_KEYS) expect(SEGMENT_FIELD_KEYS).toContain(k);
    expect(SEGMENT_REQUIRED_KEYS.length).toBeLessThan(SEGMENT_FIELD_KEYS.length);
  });

  it('forbids additional top-level properties (no smuggled fields)', () => {
    expect(schema.additionalProperties).toBe(false);
  });

  it('pins schema_version const to "2.6"', () => {
    expect(schema.properties.schema_version?.const).toBe('2.6');
    expect(SEGMENT_SCHEMA_VERSION).toBe('2.6');
  });

  it('closes current captured_env to the exact eight Segment-2.6 keys', () => {
    const capturedEnv = schema.properties.captured_env;
    expect(capturedEnv?.additionalProperties).toBe(false);
    expect(Object.keys(capturedEnv?.properties ?? {}).sort()).toEqual(
      [
        'PIJ_SESSION_ID',
        'PIJ_PARENT_ID',
        'PIJ_HARNESS',
        'PIJ_ROLE',
        'PIJ_ANNOUNCE_TO',
        'PIJ_SPAWN_ID',
        'PIJ_SPAWN_MODEL',
        'PIJ_SPAWN_EFFORT',
      ].sort(),
    );
  });

  it('pins positive current-env schema grammars rather than credential-prefix exclusions', () => {
    const properties = schema.properties.captured_env?.properties ?? {};
    const accepts = (key: string, value: string): boolean => {
      const contract = properties[key];
      if (contract?.enum !== undefined) return contract.enum.includes(value);
      return contract?.pattern !== undefined && new RegExp(contract.pattern).test(value);
    };
    const valid = {
      PIJ_SESSION_ID: 'pij-static-mockingbird',
      PIJ_PARENT_ID: 'pij-thirsty-panda',
      PIJ_HARNESS: 'pi',
      PIJ_ROLE: 'coder',
      PIJ_ANNOUNCE_TO: 'pij-thirsty-panda',
      PIJ_SPAWN_ID: 'spawn-0007',
      PIJ_SPAWN_MODEL: 'github-copilot/gpt-5.6-sol:xhigh',
      PIJ_SPAWN_EFFORT: 'xhigh',
    };
    for (const [key, value] of Object.entries(valid)) expect(accepts(key, value), key).toBe(true);

    const invalid = {
      PIJ_SESSION_ID: 'session-not-pij',
      PIJ_PARENT_ID: `sk_live_${'a'.repeat(32)}`,
      PIJ_HARNESS: 'shell',
      PIJ_ROLE: 'admin',
      PIJ_ANNOUNCE_TO: `AIza${'b'.repeat(35)}`,
      PIJ_SPAWN_ID: 'correlation-0007',
      PIJ_SPAWN_MODEL: `provider/${'x'.repeat(64)}`,
      PIJ_SPAWN_EFFORT: 'ultra',
    };
    for (const [key, value] of Object.entries(invalid))
      expect(accepts(key, value), key).toBe(false);
  });

  it('$id tracks the schema version (no stale $id drift — companion LOW finding)', () => {
    expect((schema as unknown as { $id: string }).$id).toContain('segment-2.6');
  });

  it('the event_stream kind enum mirrors EVENT_KINDS exactly (a new kind can never appear on one side only)', () => {
    const schemaKinds = (
      schema.properties.event_stream as unknown as {
        items: { properties: { kind: { enum: string[] } } };
      }
    ).items.properties.kind.enum;
    expect([...schemaKinds].sort()).toEqual([...EVENT_KINDS].sort());
    // plan 053: `mark` is now a member of the closed union.
    expect(schemaKinds).toContain('mark');
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
      user_prompts: [12, 4],
      files: { written: ['/repo/a.ts'], edited: ['/repo/b.ts'] },
      plans_touched: ['034-harness-telemetry-collection'],
      events: {
        compactions: [{ trigger: 'auto', pre_tokens: 1000, post_tokens: 200 }],
        api_errors: 0,
        local_commands: 1,
      },
      thinking: { blocks: 7 },
      captured_env: { PIJ_SESSION_ID: 'pij-golden', PIJ_ROLE: 'coder' },
      product_commit: 'A'.repeat(40),
      // a non-empty stream ⇒ event_stream populated + rollup derived (both present)
      event_stream: [{ t: '2026-06-23T04:58:00Z', kind: 'prompt', words: 5 }],
    };

    const seg = serializeSegment(golden, REPO) as Record<string, unknown>;
    // A fully-populated input emits EVERY allowlisted field (nothing omitted).
    for (const key of SEGMENT_FIELD_KEYS) {
      expect(seg[key], `field "${key}" must be present`).toBeDefined();
    }
    // capability fields stay non-null here because the golden populates them
    expect(seg.tokens).not.toBeNull();
    expect(seg.thinking).not.toBeNull();
    expect(seg.product_commit).toBe('a'.repeat(40));
  });
});

describe('T002 — version freeze (field-set change MUST bump schema_version)', () => {
  it('the frozen field set is paired with schema_version 2.6', () => {
    // FROZEN SNAPSHOT — 2.6 adds optional product_commit; required keys stay fixed.
    const FROZEN_V2_6_FIELDS = [
      'schema_version',
      'command',
      'harness',
      'harness_version',
      'harness_session_id',
      'timecode',
      'window',
      'branch',
      'tokens',
      'effort',
      'event_stream',
      'rollup',
      'models',
      'skills',
      'tools',
      'user_prompts',
      'subagents',
      'files',
      'plans_touched',
      'events',
      'thinking',
      'captured_env',
      'product_commit',
    ];
    expect(SEGMENT_SCHEMA_VERSION).toBe('2.6');
    expect([...SEGMENT_FIELD_KEYS].sort()).toEqual([...FROZEN_V2_6_FIELDS].sort());
    expect(SEGMENT_REQUIRED_KEYS).not.toContain('product_commit');
  });

  it('omits unavailable/invalid provenance and accepts both 40- and 64-hex OIDs', () => {
    const base: SegmentInput = {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 's',
      timecode: '2026-07-16T00:00:00Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: null,
    };
    expect(
      serializeSegment({ ...base, product_commit: 'not-an-oid' }, REPO).product_commit,
    ).toBeUndefined();
    expect(serializeSegment({ ...base, product_commit: 'B'.repeat(64) }, REPO).product_commit).toBe(
      'b'.repeat(64),
    );
  });
});

const USAGE_OBSERVATION_KINDS = [
  'message_output',
  'cumulative_checkpoint',
  'partial_compaction',
  'final_shutdown',
] as const;

type RequiredKeys = { required: string[] };
type UsageConditionalRule = {
  if: { properties: { kind: { const: string } } };
  then: RequiredKeys & { anyOf: RequiredKeys[] };
  else: { not: { anyOf: RequiredKeys[] } };
};

describe('P063 T008 — closed typed usage event schema', () => {
  const items = (
    schema.properties.event_stream as unknown as {
      items: {
        additionalProperties: boolean;
        required: string[];
        properties: Record<
          string,
          { type?: string; enum?: string[]; minimum?: number; additionalProperties?: boolean }
        >;
        allOf: UsageConditionalRule[];
      };
    }
  ).items;
  const usageRule = items.allOf[0];
  const hasRequired = (event: Record<string, unknown>, shape: RequiredKeys): boolean =>
    shape.required.every((key) => key in event);
  const acceptsUsageRule = (event: Record<string, unknown>): boolean =>
    event.kind === usageRule.if.properties.kind.const
      ? hasRequired(event, usageRule.then) &&
        usageRule.then.anyOf.some((shape) => hasRequired(event, shape))
      : !usageRule.else.not.anyOf.some((shape) => hasRequired(event, shape));

  it('adds one closed usage event kind and one closed observation-kind enum', () => {
    expect(items.properties.kind?.enum).toContain('usage');
    expect(items.properties.observation_kind?.enum).toEqual([...USAGE_OBSERVATION_KINDS]);
    expect(items.additionalProperties).toBe(false);
  });

  it('keeps every usage bucket numeric, non-negative, and optional', () => {
    for (const field of ['in', 'out', 'cache_read', 'cache_create', 'nano_aiu']) {
      expect(items.properties[field], field).toMatchObject({ type: 'integer', minimum: 0 });
      expect(items.required, field).not.toContain(field);
    }
  });

  it('rejects malformed usage shapes and usage-only fields on other events', () => {
    expect(acceptsUsageRule({ t: '0', kind: 'usage' })).toBe(false);
    expect(acceptsUsageRule({ t: '0', kind: 'usage', observation_kind: 'final_shutdown' })).toBe(
      false,
    );
    expect(
      acceptsUsageRule({ t: '0', kind: 'usage', observation_kind: 'final_shutdown', out: 1 }),
    ).toBe(true);
    expect(acceptsUsageRule({ t: '0', kind: 'turn', observation_kind: 'final_shutdown' })).toBe(
      false,
    );
    expect(acceptsUsageRule({ t: '0', kind: 'turn', nano_aiu: 1 })).toBe(false);
    expect(acceptsUsageRule({ t: '0', kind: 'turn', in: 1, out: 1 })).toBe(true);
  });

  it('advances the closed wire version for the additive usage kind', () => {
    expect(SEGMENT_SCHEMA_VERSION).toBe('2.6');
    expect(schema.properties.schema_version?.const).toBe('2.6');
    expect((schema as unknown as { $id: string }).$id).toContain('segment-2.6');
  });
});
