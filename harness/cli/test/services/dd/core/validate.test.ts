import { describe, expect, it } from 'vitest';
import type { DdDoc } from '../../../../src/services/dd/core/model.js';
import { type DdIssue, validateDocument } from '../../../../src/services/dd/core/validate.js';
import { FixtureSchemaResolver, fixtureDoc } from '../helpers.js';

const resolver = new FixtureSchemaResolver();

function issues(relative: string): DdIssue[] {
  return validateDocument(fixtureDoc(relative), `/repo/${relative}`, resolver, '/repo');
}

function expectIssue(
  relative: string,
  issueClass: DdIssue['class'],
  severity: DdIssue['severity'],
) {
  expect(issues(relative)).toEqual(
    expect.arrayContaining([expect.objectContaining({ class: issueClass, severity })]),
  );
}

describe('dd-core depth-zero validation', () => {
  it.each([
    ['invalid/duplicate-id.dd.json', 'duplicate-id'],
    ['invalid/malformed-address.dd.json', 'address-malformed'],
    ['invalid/unresolvable-schema.dd.json', 'schema-unresolvable'],
    ['invalid/blocked-note-missing.dd.json', 'state-note-required'],
    ['invalid/na-note-missing.dd.json', 'state-note-required'],
    ['invalid/human-skipped-receipt-missing.dd.json', 'human-skipped-receipt-required'],
    ['invalid/bad-enum.dd.json', 'enum-invalid'],
    ['invalid/link-type-mismatch.dd.json', 'link-type-mismatch'],
  ] as const)('%s reports exact ERROR class %s', (relative, issueClass) => {
    expectIssue(relative, issueClass, 'ERROR');
  });

  it.each([
    'valid/base.dd.json',
    'valid/state-notes.dd.json',
    'valid/custom-enum.dd.json',
  ])('%s has no ERROR findings', (relative) => {
    expect(issues(relative).filter((issue) => issue.severity === 'ERROR')).toEqual([]);
  });

  it.each([
    ['warn/absolute-path.dd.json', 'address-path-absolute'],
    ['warn/non-posix-path.dd.json', 'address-path-non-posix'],
    ['warn/path-escape.dd.json', 'address-path-escape'],
  ] as const)('%s reports WARN, never ERROR, for %s', (relative, issueClass) => {
    const result = issues(relative);
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ class: issueClass, severity: 'WARN' })]),
    );
    expect(
      result.filter((issue) => issue.class === issueClass && issue.severity === 'ERROR'),
    ).toEqual([]);
  });

  it('hand-rolls required-field shape conformance', () => {
    const doc: DdDoc = {
      dd: { schema: 'test/plan' },
      sections: [{ name: 'tasks', value: [{ id: 'tk-a1b2', state: 'checked' }] }],
      references: [],
    };
    expect(validateDocument(doc, '/repo/shape.dd.json', resolver, '/repo')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          class: 'schema-shape',
          severity: 'ERROR',
          location: '$.sections[tasks].value[0].title',
          owner: '/repo/shape.dd.json',
        }),
      ]),
    );
  });

  it('accepts custom field types that have no declared validation vocabulary', () => {
    const doc: DdDoc = {
      dd: { schema: 'test/custom' },
      sections: [{ name: 'content', value: { payload: { arbitrary: true } } }],
      references: [],
    };
    const customResolver = {
      resolve: () => ({
        ok: true as const,
        schema: {
          name: 'test/custom',
          sections: {
            content: {
              shape: {
                type: 'object',
                required: ['payload'],
                fields: { payload: { type: 'custom-card' } },
              },
            },
          },
        },
      }),
    };
    expect(validateDocument(doc, '/repo/custom.dd.json', customResolver, '/repo')).toEqual([]);
  });
});
