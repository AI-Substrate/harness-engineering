import { describe, expect, it } from 'vitest';
import { BUILTIN_RELS, DEFAULT_REL } from '../../../../src/services/dd/core/constants.js';
import type { ResolvedDdSchema } from '../../../../src/services/dd/core/model.js';
import {
  collectDeclaredRels,
  effectiveRel,
  isBuiltinRel,
  relOf,
} from '../../../../src/services/dd/core/rel.js';

describe('dd core — link relations', () => {
  it('freezes exactly the five built-ins', () => {
    expect([...BUILTIN_RELS]).toStrictEqual([
      'pressure',
      'proven_by',
      'satisfies',
      'derives',
      'ref',
    ]);
    expect(DEFAULT_REL).toBe('ref');
  });

  it('answers `ref` for an undeclared, blank or absent rel', () => {
    expect(relOf(undefined)).toBe('ref');
    expect(relOf({ type: 'link' })).toBe('ref');
    expect(relOf({ type: 'link', rel: '   ' })).toBe('ref');
  });

  it('keeps an unknown rel VISIBLE but treats it as ref (dw-0113)', () => {
    // Both halves matter. The declared string survives, so a schema can say
    // something dd does not understand; the SEMANTICS collapse to `ref`, so no
    // consumer has to ask "is this one of ours?" before it can walk the edge.
    expect(relOf({ type: 'link', rel: 'blesses' })).toBe('blesses');
    expect(isBuiltinRel('blesses')).toBe(false);
    expect(effectiveRel('blesses')).toBe('ref');
    expect(effectiveRel('satisfies')).toBe('satisfies');
  });

  it('collects every declared link field with its relation and depth', () => {
    const schema: ResolvedDdSchema = {
      name: 'test/rels',
      sections: {
        tasks: {
          shape: {
            type: 'array',
            items: {
              type: 'object',
              fields: {
                done: { type: 'link', rel: 'derives', target: 'test/rels/section/done_when' },
                satisfies: { type: 'array', items: { type: 'link', rel: 'satisfies' } },
                plain: { type: 'link' },
                title: { type: 'string' },
              },
            },
          },
        },
        done_when: {
          shape: {
            type: 'object',
            fields: {},
            valuesShape: {
              type: 'array',
              items: {
                type: 'object',
                fields: { pressure: { type: 'link', rel: 'pressure' } },
              },
            },
          },
        },
      },
    };
    expect(collectDeclaredRels(schema)).toStrictEqual([
      {
        field: 'tasks[].done',
        rel: 'derives',
        target: 'test/rels/section/done_when',
        builtin: true,
      },
      { field: 'tasks[].satisfies[]', rel: 'satisfies', builtin: true },
      { field: 'tasks[].plain', rel: 'ref', builtin: true },
      { field: 'done_when.*[].pressure', rel: 'pressure', builtin: true },
    ]);
  });
});
