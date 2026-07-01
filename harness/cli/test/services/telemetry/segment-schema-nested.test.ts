import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';

/**
 * FX003 fix — nested `event_stream` schema-guard (cross-model review HIGH).
 *
 * `segment-schema.test.ts` only pins the TOP-LEVEL key set, so it silently
 * missed that `segment.ts` serializes `result_tokens` on `tools` events while
 * `segment.schema.json` — `event_stream.items` (which is `additionalProperties:
 * false`) — did not list it. Any emitted segment carrying `result_tokens` was
 * therefore INVALID against the published schema.
 *
 * The repo carries no JSON-schema validator (ajv — KF-05), so this enforces the
 * `additionalProperties: false` contract structurally: it runs a REAL
 * `serializeSegment` output whose `event_stream` carries a `tools` event WITH
 * `result_tokens` and asserts no emitted event-key falls outside the schema's
 * declared `event_stream.items` property set.
 *
 * NON-VACUOUS MUTATION: delete the `"result_tokens": { "type": "integer" }`
 * line from `segment.schema.json` → the serialized `tools` event's
 * `result_tokens` key becomes an unlisted additional property → the
 * "no event-key escapes ... additionalProperties:false" assertion flips RED.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(HERE, '../../../src/services/telemetry/segment.schema.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as {
  properties: {
    event_stream: {
      items: {
        additionalProperties: boolean;
        properties: Record<string, { type?: string | string[] }>;
      };
    };
  };
};

const ITEM_SCHEMA = schema.properties.event_stream.items;
const ALLOWED_ITEM_KEYS = new Set(Object.keys(ITEM_SCHEMA.properties));
const REPO = '/repo';

/** Minimal `additionalProperties: false` check: keys present on the object that
 * the schema does NOT declare. (Mirrors segment-schema.test.ts's ajv-free style.) */
function additionalKeys(obj: Record<string, unknown>, allowed: Set<string>): string[] {
  return Object.keys(obj).filter((k) => !allowed.has(k));
}

describe('FX003 — segment.schema.json event_stream.items nested contract', () => {
  it('the item schema stays additionalProperties:false (the guard has teeth)', () => {
    expect(ITEM_SCHEMA.additionalProperties).toBe(false);
  });

  it('declares result_tokens as an integer alongside signature/arg', () => {
    expect(ALLOWED_ITEM_KEYS.has('result_tokens')).toBe(true);
    expect(ITEM_SCHEMA.properties.result_tokens?.type).toBe('integer');
    // sibling FX001 fields must remain declared too (no accidental removal)
    expect(ALLOWED_ITEM_KEYS.has('signature')).toBe(true);
    expect(ALLOWED_ITEM_KEYS.has('arg')).toBe(true);
  });

  it('control — the additionalKeys check actually catches an unlisted key', () => {
    // proves the guard below is non-vacuous: an off-contract key IS reported.
    expect(additionalKeys({ kind: 'tools', bogus_field: 1 }, ALLOWED_ITEM_KEYS)).toEqual([
      'bogus_field',
    ]);
  });

  it('a REAL sized tools event has NO event-key outside additionalProperties:false', () => {
    // MUTATION: removing `result_tokens` from segment.schema.json's
    // event_stream.items.properties makes `result_tokens` an additional property
    // here → this expectation flips RED (was the exact break the reviewer flagged).
    const input: SegmentInput = {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'fx003-nested',
      timecode: '2026-06-24T09:00:00Z',
      window: { since: 'session-start', from: 0, to: 2 },
      branch: null,
      event_stream: [
        {
          t: '2026-06-24T09:00:00Z',
          kind: 'tools',
          name: 'Bash',
          count: 3,
          span_s: 0,
          signature: 'rg',
          result_tokens: 4242,
        },
        // an unsized tools event (honest absence) — must also stay in-contract
        { t: '2026-06-24T09:00:01Z', kind: 'tools', name: 'Read', count: 1, span_s: 0 },
      ],
    };

    const seg = serializeSegment(input, REPO) as { event_stream: Array<Record<string, unknown>> };
    const sized = seg.event_stream.find((e) => e.name === 'Bash');
    // guard-of-the-guard: the sized event really carries result_tokens (else vacuous).
    expect(sized?.result_tokens).toBe(4242);

    for (const ev of seg.event_stream) {
      expect(
        additionalKeys(ev, ALLOWED_ITEM_KEYS),
        `event ${JSON.stringify(ev)} carries key(s) not declared in event_stream.items`,
      ).toEqual([]);
    }
  });
});
