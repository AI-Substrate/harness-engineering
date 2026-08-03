import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DdDoc, DdFailure } from '../../../../src/services/dd/core/model.js';
import { parse } from '../../../../src/services/dd/core/parse.js';

function fixture(relative: string): string {
  return readFileSync(new URL(`../fixtures/${relative}`, import.meta.url), 'utf8');
}

function failures(result: DdDoc | DdFailure[]): DdFailure[] {
  expect(Array.isArray(result)).toBe(true);
  return result as DdFailure[];
}

describe('dd-core parse', () => {
  it('parses the good fixture envelope and references ledger', () => {
    const result = parse(fixture('valid/base.dd.json'));
    expect(Array.isArray(result)).toBe(false);
    const doc = result as DdDoc;
    expect(doc.dd.schema).toBe('test/plan');
    expect(doc.sections[0]?.name).toBe('tasks');
    expect(doc.references).toEqual([]);
  });

  it('accepts validator-bad documents because parse and validate are separate layers', () => {
    for (const name of [
      'invalid/duplicate-id.dd.json',
      'invalid/bad-enum.dd.json',
      'invalid/malformed-address.dd.json',
    ]) {
      expect(Array.isArray(parse(fixture(name)))).toBe(false);
    }
  });

  it('returns structured failures for malformed JSON without throwing', () => {
    const result = failures(parse('{'));
    expect(result).toEqual([
      {
        class: 'json-invalid',
        location: '$',
        message: 'document is not valid JSON',
      },
    ]);
  });

  it('does not accept arbitrary class-bearing arrays as parser failures', () => {
    const result = failures(parse([{ class: 'garbage', location: '$', message: 'not a failure' }]));
    expect(result).toEqual([
      {
        class: 'document-invalid',
        location: '$',
        message: 'document must be an object',
      },
    ]);
  });

  it('collects document-shape failures with precise locations', () => {
    const result = failures(
      parse({
        dd: { schema: '', sweep_exclude: 'yes' },
        sections: [{ name: '' }, null],
        references: [{ path: '', sha: 3, mode: 'floating' }],
      }),
    );
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ class: 'document-invalid', location: '$.dd.schema' }),
        expect.objectContaining({ class: 'document-invalid', location: '$.dd.sweep_exclude' }),
        expect.objectContaining({ class: 'document-invalid', location: '$.sections[0].name' }),
        expect.objectContaining({ class: 'document-invalid', location: '$.sections[0].value' }),
        expect.objectContaining({ class: 'document-invalid', location: '$.sections[1]' }),
        expect.objectContaining({ class: 'document-invalid', location: '$.references[0].path' }),
        expect.objectContaining({ class: 'document-invalid', location: '$.references[0].sha' }),
        expect.objectContaining({ class: 'document-invalid', location: '$.references[0].mode' }),
      ]),
    );
  });
});
