import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { readRetroRecords } from '../../../src/services/retro/record-reader.js';
import { dirs, files } from './fixtures.js';

const read = (filters: Parameters<typeof readRetroRecords>[0]['filters'] = {}) =>
  readRetroRecords({ fs: new FakeFs({ ...files }, { ...dirs }), repoRoot: '/repo', filters });

describe('readRetroRecords', () => {
  it('parses frontmatter record fields and the entries block tolerantly', () => {
    const result = read();
    const alpha = result.records.find(
      (record) => record.retro_id === '2026-05-01T10:00:00Z-alpha-a001',
    );
    expect(alpha).toMatchObject({
      schema_version: '1.0',
      agent: 'alpha',
      plan_id: 'plan-one',
      started_at: '2026-05-01T09:00:00Z',
      source: 'canonical',
      record_path: '.harness/records/retro/2026-05-01/001-alpha.md',
    });
    expect(alpha?.entries[0]).toMatchObject({
      id: 'DL-001',
      kind: 'difficulty',
      target: 'tooling',
      severity: 'degrading',
      disposition: 'declined',
      status: 'open',
      first_seen_at: '2026-05-01T09:15:00Z',
    });

    const inline = result.records.find(
      (record) => record.retro_id === '2026-05-15T10:00:00Z-alpha-d00d',
    );
    expect(inline?.entries[0]).toMatchObject({
      fp: 'abcdef123456',
      status: 'suggested',
      first_seen_at: '2026-05-15T09:10:00Z',
    });
  });

  it('walks all source roots, skips *.legacy.md, and reports per-source counts', () => {
    const result = read();
    expect(result.sources).toEqual({
      canonical: { scanned: 6, parsed: 4, included: 4, deduped: 0 },
      agents: { scanned: 2, parsed: 2, included: 1, deduped: 1 },
      retros: { scanned: 2, parsed: 2, included: 2, deduped: 0 },
    });
    expect(result.records).toHaveLength(7);
    expect(result.records.some((record) => record.record_path.endsWith('.legacy.md'))).toBe(false);
  });

  it('counts malformed and unsupported-major records without throwing; minor skew is silent', () => {
    const result = read();
    expect(result.malformed_skipped).toBe(1);
    expect(result.unsupported_versions).toEqual([
      {
        path: '.harness/records/retro/2026-06-04/001-future-major.md',
        schema_version: '2.0',
      },
    ]);
    expect(
      result.records.find((record) => record.retro_id === '2026-06-02T10:00:00Z-beta-b009')
        ?.schema_version,
    ).toBe('1.9');
  });

  it('treats unterminated quoted scalars as malformed instead of swallowing later structure', () => {
    const malformedFiles = {
      '/repo/.harness/records/retro/001-top-level.md': [
        '---',
        'schema_version: "1.2"',
        'retro_id: "2026-06-01T10:00:00Z-agent-a001"',
        'agent: agent',
        'started_at: "2026-06-01T09:00:00Z"',
        'summary: "never closes',
        'entries:',
        '  - id: DL-001',
        '    kind: difficulty',
        '    description: "This entry must not be silently swallowed."',
        '---',
      ].join('\n'),
      '/repo/.harness/records/retro/002-entry.md': [
        '---',
        'schema_version: "1.2"',
        'retro_id: "2026-06-01T10:00:00Z-agent-a002"',
        'agent: agent',
        'started_at: "2026-06-01T09:00:00Z"',
        'entries:',
        '  - id: DL-002',
        '    kind: difficulty',
        '    description: "never closes',
        '    target: schema',
        '    system:',
        '      compound:',
        '        status: open',
        '---',
      ].join('\n'),
    };
    const result = readRetroRecords({
      fs: new FakeFs(malformedFiles, {
        '/repo/.harness/records/retro': ['001-top-level.md', '002-entry.md'],
      }),
      repoRoot: '/repo',
    });
    expect(result.records).toEqual([]);
    expect(result.malformed_skipped).toBe(2);
  });

  it('prefers system.compound lifecycle fields over other system namespaces', () => {
    const result = readRetroRecords({
      fs: new FakeFs(
        {
          '/repo/.harness/records/retro/001-namespaces.md': [
            '---',
            'schema_version: "1.2"',
            'retro_id: "2026-06-01T10:00:00Z-agent-a003"',
            'agent: agent',
            'started_at: "2026-06-01T09:00:00Z"',
            'entries:',
            '  - id: DL-003',
            '    kind: difficulty',
            '    description: "Lifecycle status belongs to the compound namespace."',
            '    system:',
            '      producer:',
            '        status: encoded',
            '      compound:',
            '        status: open',
            '---',
          ].join('\n'),
        },
        { '/repo/.harness/records/retro': ['001-namespaces.md'] },
      ),
      repoRoot: '/repo',
    });
    expect(result.records[0]?.entries[0]?.status).toBe('open');
  });

  it('parses quoted and unquoted scalars with trailing YAML comments', () => {
    const commentedRecord = (retroId: string, schemaVersion: string) =>
      [
        '---',
        `schema_version: ${schemaVersion} # current`,
        `retro_id: "${retroId}"`,
        'agent: agent',
        'started_at: "2026-06-01T09:00:00Z"',
        'entries:',
        '  - id: DL-004',
        '    kind: difficulty',
        '    description: "Comments outside quoted values are not scalar content."',
        '    system:',
        '      compound:',
        '        status: open',
        '---',
      ].join('\n');
    const result = readRetroRecords({
      fs: new FakeFs(
        {
          '/repo/.harness/records/retro/001-quoted.md': commentedRecord(
            '2026-06-01T10:00:00Z-agent-a004',
            '"1.2"',
          ),
          '/repo/.harness/records/retro/002-unquoted.md': commentedRecord(
            '2026-06-01T10:00:00Z-agent-a005',
            '1.2',
          ),
        },
        { '/repo/.harness/records/retro': ['001-quoted.md', '002-unquoted.md'] },
      ),
      repoRoot: '/repo',
    });
    expect(result.records.map((record) => record.schema_version)).toEqual(['1.2', '1.2']);
    expect(result.malformed_skipped).toBe(0);
  });

  it('deduplicates retro_id by canonical → agents → docs/retros precedence', () => {
    const result = read();
    const duplicate = result.records.filter(
      (record) => record.retro_id === '2026-05-15T10:00:00Z-alpha-d00d',
    );
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0]?.source).toBe('canonical');
    expect(duplicate[0]?.entries.map((entry) => entry.id)).toEqual(['DL-002']);
  });

  it('passes non-standard kinds through raw so the engine can surface an other bucket', () => {
    const result = read();
    const deviant = result.records.find(
      (record) => record.retro_id === '2026-05-20T10:00:00Z-beta-b004',
    );
    expect(deviant?.entries[0]?.kind).toBe('worker-harvest');
  });

  it('composes plan, date, kind, and agent filters over the parsed corpus', () => {
    const result = read({
      plans: ['plan-one'],
      since: '2026-05-20T00:00:00Z',
      kinds: ['difficulty'],
      agents: ['delta'],
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      plan_id: 'plan-one',
      agent: 'delta',
      record_path: 'docs/retros/plan-one-followup.md',
    });
    expect(result.records[0]?.entries.map((entry) => entry.id)).toEqual(['DL-003']);
  });
});
