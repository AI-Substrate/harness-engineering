import { describe, expect, it } from 'vitest';
import type { DdDoc, ResolvedDdSchema } from '../../../../src/services/dd/core/model.js';
import {
  collectLinkCells,
  type DdIssue,
  validateDocument,
} from '../../../../src/services/dd/core/validate.js';
import { EVIDENCE_SCHEMA, FixtureSchemaResolver, fixtureDoc, TEST_SCHEMA } from '../helpers.js';

const resolver = new FixtureSchemaResolver();

function issues(relative: string): DdIssue[] {
  return validateDocument(fixtureDoc(relative), `/repo/${relative}`, resolver, '/repo');
}

function classesAt(relative: string, location: string): string[] {
  return issues(relative)
    .filter((issue) => issue.location === location)
    .map((issue) => issue.class);
}

describe('OD-8 valuesShape — dynamic-key map interiors', () => {
  it('accepts a well-formed evidence map', () => {
    expect(issues('map/evidence-valid.dd.json')).toEqual([]);
  });

  it('catches an out-of-vocabulary state INSIDE a map interior', () => {
    expect(
      classesAt('map/evidence-typo-state.dd.json', '$.sections[evidence].value.tk-1a2b[0].state'),
    ).toEqual(['enum-invalid']);
  });

  it('requires the human receipt INSIDE a map interior', () => {
    expect(
      classesAt(
        'map/evidence-skip-no-receipt.dd.json',
        '$.sections[evidence].value.tk-1a2b[0].receipt',
      ),
    ).toEqual(['human-skipped-receipt-required']);
  });

  it('type-checks a link declared inside a map interior', () => {
    expect(
      classesAt(
        'map/evidence-wrong-link-target.dd.json',
        '$.sections[evidence].value.tk-1a2b[0].proven_by',
      ),
    ).toEqual(['link-type-mismatch']);
  });

  it('collects interior links as real link cells, so the walk can follow them', () => {
    const cells = collectLinkCells(fixtureDoc('map/evidence-valid.dd.json'), EVIDENCE_SCHEMA);
    expect(cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          raw: '#tasks/tk-1a2b',
          location: '$.sections[evidence].value.tk-1a2b[0].proven_by',
          target: 'test/evidence-plan/section/tasks',
        }),
      ]),
    );
  });

  it('lets a DECLARED field win over valuesShape for its own key', () => {
    // `mixed.owner` is a declared string; `mixed.row-a` is not, so only the
    // latter is measured against valuesShape. A declared field that also matched
    // valuesShape would report a spurious shape error — it does not.
    expect(classesAt('map/evidence-valid.dd.json', '$.sections[mixed].value.owner')).toEqual([]);
  });

  it('reports an unmatched key that violates valuesShape', () => {
    const doc: DdDoc = {
      dd: { schema: 'test/evidence-plan' },
      sections: [
        { name: 'tasks', value: [{ id: 'tk-1a2b', title: 'x', state: 'unchecked' }] },
        { name: 'mixed', value: { owner: 'jordan', 'row-a': { note: 'no state here' } } },
      ],
      references: [],
    };
    expect(
      validateDocument(doc, '/repo/mixed.dd.json', resolver, '/repo').map((issue) => ({
        class: issue.class,
        location: issue.location,
      })),
    ).toEqual([{ class: 'schema-shape', location: '$.sections[mixed].value.row-a.state' }]);
  });

  it('REGRESSION PIN: a schema without valuesShape behaves exactly as before', () => {
    // The additive claim in fact, not just in intent: `test/plan` declares no
    // valuesShape, so an undeclared interior stays unvalidated — the pre-OD-8
    // behaviour, unchanged.
    expect(TEST_SCHEMA.sections.tasks?.shape.valuesShape).toBeUndefined();
    const doc: DdDoc = {
      dd: { schema: 'test/plan' },
      sections: [
        {
          name: 'tasks',
          value: [{ id: 'tk-a1b2', title: 'x', state: 'unchecked', extra: { state: 'chekced' } }],
        },
      ],
      references: [],
    };
    expect(validateDocument(doc, '/repo/legacy.dd.json', resolver, '/repo')).toEqual([]);
  });

  it('keeps allowAdditional:false meaningful when valuesShape is absent', () => {
    const closed: ResolvedDdSchema = {
      name: 'test/closed',
      sections: {
        meta: {
          shape: {
            type: 'object',
            allowAdditional: false,
            fields: { title: { type: 'string' } },
          },
        },
      },
    };
    const doc: DdDoc = {
      dd: { schema: 'test/closed' },
      sections: [{ name: 'meta', value: { title: 'x', stray: 1 } }],
      references: [],
    };
    expect(
      validateDocument(
        doc,
        '/repo/closed.dd.json',
        { resolve: () => ({ ok: true, schema: closed }) },
        '/repo',
      ),
    ).toEqual([
      expect.objectContaining({ class: 'schema-shape', location: '$.sections[meta].value.stray' }),
    ]);
  });
});
