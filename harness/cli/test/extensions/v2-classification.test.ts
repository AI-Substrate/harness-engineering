import { describe, expect, it } from 'vitest';
import { classifyExtensionExport } from '../../src/services/extensions/v2/classify.js';

const v1Verb = {
  name: 'build',
  summary: 'Build the project',
  run: () => ({ status: 'ok' as const }),
};
const v1Record = {
  kind: 'record' as const,
  type: 'decision',
  description: 'Decision record',
  template: '---\nrecord_type: decision\n---\n',
};
const v2Definition = {
  kind: 'extension' as const,
  name: 'database',
  summary: 'Database development loop',
  verbs: {},
};

describe('v2 extension export classification', () => {
  it.each([
    ['a v1 verb', v1Verb, ['v1-verb']],
    ['a v1 record', v1Record, ['v1-record']],
    ['a v2 definition', v2Definition, ['v2']],
  ] as const)('classifies %s by shape', (_label, exported, expected) => {
    const classified = classifyExtensionExport(exported);
    expect(classified?.map((entry) => entry.kind)).toEqual(expected);
  });

  it('routes every member of a mixed array independently', () => {
    const classified = classifyExtensionExport([v1Verb, v2Definition, v1Record]);
    expect(classified?.map((entry) => entry.kind)).toEqual(['v1-verb', 'v2', 'v1-record']);
    expect(classified?.map((entry) => entry.value)).toEqual([v1Verb, v2Definition, v1Record]);
  });

  it.each([
    null,
    undefined,
    [],
    ['not-an-object'],
  ])('rejects a malformed default export without guessing: %j', (exported) => {
    expect(classifyExtensionExport(exported)).toBeNull();
  });
});
