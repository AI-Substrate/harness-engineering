import { describe, expect, it } from 'vitest';
import {
  SEGMENT_RECORD_TEMPLATE,
  segmentRecordType,
} from '../../../src/services/record/core-types/segment.js';
import {
  type ProvenanceFields,
  spliceProvenance,
} from '../../../src/services/record/provenance.js';
import { buildRecordRegistry, coreRecordTypes } from '../../../src/services/record/registry.js';

/**
 * T003 (plan 1.3 · PL-02/06/14 · F5) — the `segment` CORE record type.
 *
 * Orthogonal to the `services/telemetry/segment.ts` buffer contract: this test
 * pins the record-system citizen — the 4-field type, the template-owned
 * `schema_version`, the CLI-spliced 7-key provenance header, and registry
 * membership. Mirrors `retro-template.test.ts`.
 */

/** Top-level YAML keys (column-0 `key:` lines) — a key check without a YAML dep. */
function topLevelKeys(md: string): Set<string> {
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) throw new Error('template has no --- frontmatter fence');
  const keys = new Set<string>();
  for (const line of fm[1].split('\n')) {
    const m = line.match(/^([a-z_][a-z0-9_]*):/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

describe('T003 — segment core record type', () => {
  it('declares the 4-field record contract for type "segment"', () => {
    expect(segmentRecordType.kind).toBe('record');
    expect(segmentRecordType.type).toBe('segment');
    expect(segmentRecordType.description.length).toBeGreaterThan(0);
    expect(segmentRecordType.template).toBe(SEGMENT_RECORD_TEMPLATE);
  });

  it('ships only the template-owned schema_version in frontmatter (provenance is CLI-spliced)', () => {
    expect(topLevelKeys(SEGMENT_RECORD_TEMPLATE)).toEqual(new Set(['schema_version']));
  });

  it('carries no content fields in the template body (counts-only payload placeholder)', () => {
    // The body holds an EMPTY json fence — never any prompt/message text.
    expect(SEGMENT_RECORD_TEMPLATE).toContain('```json\n{}\n```');
  });
});

describe('T003 — provenance splice stamps the 7 CLI keys', () => {
  it('a written segment record carries all 7 provenance keys exactly once', () => {
    const fields: ProvenanceFields = {
      record_kind: 'segment',
      harness_version: '0.5.0',
      branch: '034-harness-telemetry-collection',
      repo: 'github.com/AI-Substrate/harness-engineering',
      created_at: '2026-06-23T07:00:00.000Z',
      agent: null,
      plan_id: '034-harness-telemetry-collection',
    };
    const spliced = spliceProvenance(SEGMENT_RECORD_TEMPLATE, fields);
    for (const key of Object.keys(fields)) {
      const count = spliced.split('\n').filter((l) => l.startsWith(`${key}:`)).length;
      expect(count, `provenance key "${key}" stamped exactly once`).toBe(1);
    }
    // template-owned schema_version survives the splice (never duplicated/touched)
    expect(spliced.split('\n').filter((l) => l.startsWith('schema_version:'))).toHaveLength(1);
  });
});

describe('T003 — registry membership', () => {
  it('enumerates segment as a core type (no entryPath)', () => {
    const reg = buildRecordRegistry();
    const entry = reg.types.find((t) => t.type === 'segment');
    expect(entry?.source).toBe('core');
    expect(entry?.entryPath).toBeUndefined();
    expect(coreRecordTypes.map((t) => t.type)).toContain('segment');
  });
});
