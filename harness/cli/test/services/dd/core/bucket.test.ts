import { describe, expect, it } from 'vitest';
import { hasLinksBucket, readLinksBucket } from '../../../../src/services/dd/core/bucket.js';
import type { DdDoc, ResolvedDdSchema } from '../../../../src/services/dd/core/model.js';
import { collectLinkCells } from '../../../../src/services/dd/core/validate.js';
import { renderDd } from '../../../../src/services/dd/render/renderer.js';

const SCHEMA: ResolvedDdSchema = {
  name: 'test/bucket',
  sections: {
    rows: {
      shape: {
        type: 'array',
        items: {
          type: 'object',
          allowAdditional: false,
          fields: { id: { type: 'string' }, label: { type: 'string' } },
        },
      },
    },
  },
};

function doc(rows: unknown[]): DdDoc {
  return {
    dd: { schema: 'test/bucket' },
    sections: [{ name: 'rows', value: rows }],
    references: [],
  };
}

function render(rows: unknown[]): string {
  return renderDd(doc(rows), { path: '/repo/docs/x.dd.json', schema: SCHEMA });
}

describe('dd links bucket — reading', () => {
  it('accepts a bare address as the ref-relation shorthand', () => {
    const reading = readLinksBucket(['plan.dd.json#phases/ph-0001'], '$.links');
    expect(reading.problems).toStrictEqual([]);
    expect(reading.entries).toStrictEqual([
      { index: 0, rel: 'ref', ref: 'plan.dd.json#phases/ph-0001' },
    ]);
  });

  it('carries the relation in the DATA, because there is no shape to hang it on', () => {
    const reading = readLinksBucket(
      [{ rel: 'satisfies', ref: '#acceptance_criteria/ac-0001', label: 'claim' }],
      '$.links',
    );
    expect(reading.entries[0]).toStrictEqual({
      index: 0,
      rel: 'satisfies',
      ref: '#acceptance_criteria/ac-0001',
      label: 'claim',
    });
  });

  it('reports every malformed entry rather than silently dropping it', () => {
    const reading = readLinksBucket(
      [{ rel: 'satisfies' }, { ref: '' }, { ref: '#a', rel: 3 }, 7, ''],
      '$.links',
    );
    expect(reading.entries).toStrictEqual([]);
    expect(reading.problems.map((problem) => problem.location)).toStrictEqual([
      '$.links[0].ref',
      '$.links[1].ref',
      '$.links[2].rel',
      '$.links[3]',
      '$.links[4]',
    ]);
    expect(readLinksBucket({ not: 'an array' }, '$.links').problems).toHaveLength(1);
  });

  it('knows a populated bucket from an absent or empty one', () => {
    expect(hasLinksBucket({ links: [{ ref: '#a' }] })).toBe(true);
    expect(hasLinksBucket({ links: [] })).toBe(false);
    expect(hasLinksBucket({})).toBe(false);
  });
});

describe('dd links bucket — traversal and validation', () => {
  it('collects bucket edges as first-class link cells, with their relation', () => {
    const cells = collectLinkCells(
      doc([
        { id: 'a', links: [{ rel: 'satisfies', ref: 'plan.dd.json#acceptance_criteria/ac-0001' }] },
      ]),
      SCHEMA,
    );
    expect(cells).toStrictEqual([
      {
        raw: 'plan.dd.json#acceptance_criteria/ac-0001',
        location: '$.sections[rows].value[0].links[0].ref',
        rel: 'satisfies',
      },
    ]);
  });

  it('survives a CLOSED shape — the bucket is reserved, not an undeclared field', () => {
    // `allowAdditional: false` must not reject the one field every row is allowed
    // to carry; if it did, the bucket would be unusable on exactly the strict
    // schemas that most want it.
    const cells = collectLinkCells(doc([{ id: 'a', links: ['#rows/a'] }]), SCHEMA);
    expect(cells).toHaveLength(1);
    expect(cells[0]?.rel).toBe('ref');
  });
});

describe('dd links bucket — rendering (dw-0131 / dw-0132)', () => {
  it('renders a final Links column only when a row actually carries entries', () => {
    const populated = render([
      { id: 'a', label: 'first', links: [{ rel: 'satisfies', ref: '#rows/b' }] },
      { id: 'b', label: 'second' },
    ]);
    const header = populated.split('\n').find((line) => line.startsWith('| id'));
    expect(header).toBe('| id | label | Links |');
    expect(populated).toContain('satisfies: [b](#rows)');
    // A row with no bucket still gets a cell, so the table stays rectangular.
    expect(populated).toContain('| b | second | — |');
  });

  it('renders byte-identical output when NO row carries a bucket (golden pin)', () => {
    const withoutField = render([
      { id: 'a', label: 'first' },
      { id: 'b', label: 'second' },
    ]);
    const withEmptyBucket = render([
      { id: 'a', label: 'first', links: [] },
      { id: 'b', label: 'second' },
    ]);
    expect(withEmptyBucket).toBe(withoutField);
    expect(withoutField).toContain('| id | label |');
    expect(withoutField).not.toContain('Links');
  });

  it('keeps a schema that DECLARES its own links field in charge of it', () => {
    const declared: ResolvedDdSchema = {
      name: 'test/bucket',
      sections: {
        rows: {
          shape: {
            type: 'array',
            items: {
              type: 'object',
              fields: {
                id: { type: 'string' },
                links: { type: 'array', items: { type: 'link' } },
              },
            },
          },
        },
      },
    };
    const output = renderDd(doc([{ id: 'a', links: ['#rows/a'] }]), {
      path: '/repo/docs/x.dd.json',
      schema: declared,
    });
    // Declared wins: the column keeps its declared position and its own name.
    expect(output).toContain('| id | links |');
    expect(output).not.toContain('| Links |');
  });

  it('labels each entry with its relation, one per line', () => {
    const output = render([
      {
        id: 'a',
        links: [
          { rel: 'satisfies', ref: '#rows/b' },
          { rel: 'blesses', ref: '#rows/b', label: 'odd' },
          '#rows/b',
        ],
      },
    ]);
    expect(output).toContain('satisfies: [b](#rows)<br>blesses: odd [b](#rows)<br>ref: [b](#rows)');
  });
});
