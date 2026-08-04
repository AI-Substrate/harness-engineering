import { describe, expect, it } from 'vitest';
import { parseSchemaDeclaration } from '../../../../src/services/dd/schema/declarations.js';

const PATH = '/repo/.dd/schemas/builder/plan/schema.json';

function parse(body: unknown) {
  return parseSchemaDeclaration(JSON.stringify(body), 'builder/plan', PATH);
}

function firstIssue(result: ReturnType<typeof parse>) {
  const issue = result.issues[0];
  if (!issue) throw new Error('expected at least one issue');
  return issue;
}

const MINIMAL = {
  dd_schema: 1,
  description: 'minimal',
  sections: { body: { shape: { type: 'string' } } },
};

describe('dd schema declarations', () => {
  it('takes its name from the folder path, never from the file', () => {
    const result = parseSchemaDeclaration(
      JSON.stringify({ ...MINIMAL, name: 'someone/else' }),
      'builder/plan',
      PATH,
    );
    expect(result.ok && result.declaration.schema.name).toBe('builder/plan');
  });

  it('reports unparseable JSON as a package failure rather than throwing', () => {
    const result = parseSchemaDeclaration('{ not json', 'builder/plan', PATH);
    expect(result.ok).toBe(false);
    expect(firstIssue(result)).toMatchObject({
      class: 'package-invalid',
      severity: 'ERROR',
      location: '$',
      schema: 'builder/plan',
      path: PATH,
    });
  });

  it.each([
    [{ description: 'no version', sections: MINIMAL.sections }, '$.dd_schema'],
    [{ dd_schema: 1, sections: {} }, '$.sections'],
    [{ dd_schema: 1, sections: { body: {} } }, '$.sections.body.shape'],
    [
      { dd_schema: 1, sections: { body: { shape: { type: 'array' } } } },
      '$.sections.body.shape.items',
    ],
    [
      {
        dd_schema: 1,
        sections: { body: { shape: { type: 'object', required: ['x'], fields: {} } } },
      },
      '$.sections.body.shape.required',
    ],
    [
      {
        dd_schema: 1,
        sections: { body: { shape: { type: 'string', fields: { a: { type: 'int' } } } } },
      },
      '$.sections.body.shape.fields',
    ],
    [{ dd_schema: 1, description: 5, sections: MINIMAL.sections }, '$.description'],
  ])('rejects a structurally invalid package at %#', (body, location) => {
    const result = parse(body);
    expect(result.ok).toBe(false);
    expect(firstIssue(result).class).toBe('package-invalid');
    expect(firstIssue(result).location).toBe(location);
  });

  it('keeps gate_terminal on the enum, refusing it on a field', () => {
    const result = parse({
      dd_schema: 1,
      sections: { body: { shape: { type: 'state', gate_terminal: ['checked'] } } },
    });
    expect(result.ok).toBe(false);
    expect(firstIssue(result)).toMatchObject({
      class: 'enum-invalid',
      message: 'gate_terminal is declared on the enum, not on the field',
    });
  });

  it('requires an enum field to name values somewhere', () => {
    const result = parse({ dd_schema: 1, sections: { body: { shape: { type: 'enum' } } } });
    expect(result.ok).toBe(false);
    expect(firstIssue(result).class).toBe('enum-invalid');
  });

  it('defaults to the built-in terminal set when nothing is declared', () => {
    const result = parse({
      dd_schema: 1,
      sections: { tasks: { shape: { type: 'object', fields: { state: { type: 'state' } } } } },
    });
    expect(result.ok && result.declaration.gateTerminal).toEqual([
      'checked',
      'human-skipped',
      'na',
    ]);
  });

  it('lets one declared enum move the terminal set for the whole schema', () => {
    const result = parse({
      dd_schema: 1,
      enums: { review: { values: ['open', 'approved'], gate_terminal: ['approved'] } },
      sections: {
        left: { shape: { type: 'object', fields: { state: { type: 'state', enum: 'review' } } } },
        right: { shape: { type: 'object', fields: { state: { type: 'state', enum: 'review' } } } },
      },
    });
    expect(result.ok && result.declaration.gateTerminal).toEqual(['approved']);
  });

  it('treats a plain state field alongside a declared one as no conflict', () => {
    const result = parse({
      dd_schema: 1,
      enums: { review: { values: ['open', 'approved'], gate_terminal: ['approved'] } },
      sections: {
        left: { shape: { type: 'object', fields: { state: { type: 'state', enum: 'review' } } } },
        right: { shape: { type: 'object', fields: { state: { type: 'state' } } } },
      },
    });
    expect(result.ok && result.declaration.gateTerminal).toEqual(['approved']);
  });

  it('carries an unrecognised type through untouched — adapters render it', () => {
    const result = parse({
      dd_schema: 1,
      sections: { chart: { shape: { type: 'burndown' } } },
    });
    expect(result.ok && result.declaration.schema.sections.chart?.shape.type).toBe('burndown');
  });

  it('rejects a repeated enum value', () => {
    const result = parse({
      dd_schema: 1,
      enums: { review: { values: ['open', 'open'] } },
      sections: MINIMAL.sections,
    });
    expect(result.ok).toBe(false);
    expect(firstIssue(result).class).toBe('enum-invalid');
  });

  // OD-8. The parser builds each shape key-by-key, so a key it does not read is
  // silently DROPPED — a ratified declaration that never reaches the validator is
  // the same failure class as P2's F002 silence. These two rows prove the drop is
  // gone: the key survives the parse, and a misplaced one is a loud package error.
  it('carries valuesShape through to the validator', () => {
    const result = parse({
      dd_schema: 1,
      sections: {
        evidence: {
          shape: {
            type: 'object',
            allowAdditional: true,
            fields: {},
            valuesShape: {
              type: 'array',
              items: { type: 'object', required: ['state'], fields: { state: { type: 'state' } } },
            },
          },
        },
      },
    });
    const shape = result.ok ? result.declaration.schema.sections.evidence?.shape : undefined;
    expect(shape?.valuesShape?.type).toBe('array');
    expect(shape?.valuesShape?.items?.fields?.state?.type).toBe('state');
  });

  // FU-2, and the SAME allow-list as valuesShape above — the section-level
  // constructor is a second, separate allow-list from the shape one, so a new
  // section key drops just as silently. Proven here rather than in the renderer
  // suite because that suite hands `renderDd` a hand-built ResolvedDdSchema and
  // never runs this parser at all: a renderer-side assertion cannot see this
  // regression, and a mutation run is what exposed that.
  it('carries a section title through to the resolved schema', () => {
    const result = parse({
      dd_schema: 1,
      sections: {
        non_goals: { title: 'Non-goals', shape: { type: 'array', items: { type: 'string' } } },
      },
    });
    // Asserted separately: a `result.ok ? … : undefined` ternary reports a parse
    // FAILURE as an absent title, which reads like a dropped key and hides the
    // real cause. (It did exactly that here — the first draft used an `array`
    // shape with no `items`, which is itself invalid.)
    expect(result.ok).toBe(true);
    expect(result.ok && result.declaration.schema.sections.non_goals?.title).toBe('Non-goals');
  });

  it('refuses a section title that is not a non-empty string', () => {
    for (const title of [42, '', '   ']) {
      const result = parse({
        dd_schema: 1,
        sections: {
          non_goals: { title, shape: { type: 'array', items: { type: 'string' } } },
        },
      });
      expect(result.ok).toBe(false);
      expect(firstIssue(result).message).toContain('section title must be a non-empty string');
    }
  });

  it('rejects valuesShape on a non-object type', () => {
    const result = parse({
      dd_schema: 1,
      sections: { body: { shape: { type: 'string', valuesShape: { type: 'string' } } } },
    });
    expect(result.ok).toBe(false);
    expect(firstIssue(result).message).toContain('valuesShape is only meaningful on an object');
  });

  it('rejects a malformed valuesShape', () => {
    const result = parse({
      dd_schema: 1,
      sections: { evidence: { shape: { type: 'object', valuesShape: { type: 'array' } } } },
    });
    expect(result.ok).toBe(false);
    expect(firstIssue(result).class).toBe('package-invalid');
  });
});

/**
 * The OD-8 pin the key finding demanded (tk-7011 / dw-0112).
 *
 * `parseShape` is an ALLOW-LIST: a key it does not name is silently discarded,
 * which is exactly how `valuesShape` was lost once before. So `rel` is pinned
 * HERE, at the parse layer, and not in the renderer suite — a renderer test
 * passes just as happily against a shape whose relation never survived
 * declaration, and the contradiction engine would then ship inert on every real
 * plan with a green build.
 */
describe('dd schema declarations — link relations', () => {
  const withShape = (shape: unknown) => parse({ ...MINIMAL, sections: { body: { shape } } });

  it('round-trips a rel on a single link shape', () => {
    const result = withShape({ type: 'link', rel: 'proven_by', target: 'builder/log/section/e' });
    expect(result.ok && result.declaration.schema.sections.body?.shape.rel).toBe('proven_by');
  });

  it('round-trips a rel on an ARRAY of links, declared on items', () => {
    const result = withShape({
      type: 'array',
      items: { type: 'link', rel: 'satisfies', target: 'builder/plan/section/acceptance_criteria' },
    });
    expect(result.ok && result.declaration.schema.sections.body?.shape.items?.rel).toBe(
      'satisfies',
    );
  });

  it('round-trips a rel on a link nested inside an object and a valuesShape map', () => {
    const result = withShape({
      type: 'object',
      fields: { pressure: { type: 'link', rel: 'pressure' } },
      valuesShape: { type: 'link', rel: 'derives' },
    });
    expect(result.ok && result.declaration.schema.sections.body?.shape.fields?.pressure?.rel).toBe(
      'pressure',
    );
    expect(result.ok && result.declaration.schema.sections.body?.shape.valuesShape?.rel).toBe(
      'derives',
    );
  });

  it('accepts an UNKNOWN rel — the built-in set is frozen, the namespace is open', () => {
    const result = withShape({ type: 'link', rel: 'blesses' });
    expect(result.ok).toBe(true);
    expect(result.ok && result.declaration.schema.sections.body?.shape.rel).toBe('blesses');
  });

  it('refuses a rel that is not a non-empty string', () => {
    for (const rel of [3, '', '   ', null]) {
      const result = withShape({ type: 'link', rel });
      expect(result.ok).toBe(false);
      expect(firstIssue(result)).toMatchObject({
        class: 'rel-invalid',
        location: '$.sections.body.shape.rel',
      });
    }
  });

  it('refuses a rel on a shape that is not a link', () => {
    const result = withShape({ type: 'string', rel: 'satisfies' });
    expect(result.ok).toBe(false);
    expect(firstIssue(result)).toMatchObject({ class: 'rel-invalid' });
    expect(firstIssue(result).message).toContain('only meaningful on a link');
  });

  it('leaves a link with no rel undeclared, so `relOf` can answer for it', () => {
    const result = withShape({ type: 'link' });
    expect(result.ok && result.declaration.schema.sections.body?.shape.rel).toBeUndefined();
  });
});
