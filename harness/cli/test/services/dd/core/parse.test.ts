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

  // FU-2 tier 1. Proven HERE and not in the renderer suite: that suite builds
  // DdSection objects by hand and never runs this parser, so a `title` dropped
  // on the way in would still render there. Same blind spot the schema-side
  // title has, in the other parser.
  it('carries an optional document-level section title, and refuses a malformed one', () => {
    const parsed = parse({
      dd: { schema: 'test/plan' },
      sections: [{ name: 'non_goals', title: 'What we are not doing', value: [] }],
      references: [],
    });
    expect(Array.isArray(parsed)).toBe(false);
    expect((parsed as DdDoc).sections[0]?.title).toBe('What we are not doing');

    // Absent stays absent — the renderer's derivation tier depends on this being
    // undefined rather than an empty string.
    const bare = parse({
      dd: { schema: 'test/plan' },
      sections: [{ name: 'non_goals', value: [] }],
      references: [],
    });
    expect((bare as DdDoc).sections[0]?.title).toBeUndefined();

    for (const title of [42, '', '  ']) {
      expect(
        failures(
          parse({
            dd: { schema: 'test/plan' },
            sections: [{ name: 'non_goals', title, value: [] }],
            references: [],
          }),
        ),
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ location: '$.sections[0].title' })]),
      );
    }
  });
});
