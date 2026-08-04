import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deriveState } from '../../../../src/services/dd/core/derive.js';
import type { DdDoc, ResolvedDdSchema } from '../../../../src/services/dd/core/model.js';
import { parse } from '../../../../src/services/dd/core/parse.js';
import type {
  DdAdapterContext,
  DdAdapterIssue,
  DdAdapterSet,
} from '../../../../src/services/dd/render/contract.js';
import {
  headingSlug,
  MAX_CELL_DEPTH,
  RENDER_BANNER,
  renderDd,
} from '../../../../src/services/dd/render/renderer.js';
import { parseSchemaDeclaration } from '../../../../src/services/dd/schema/declarations.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

function read(relative: string): string {
  return readFileSync(`${FIXTURES}${relative}`, 'utf8');
}

function doc(relative: string): DdDoc {
  const parsed = parse(read(relative));
  if (Array.isArray(parsed)) throw new Error(`fixture is not a dd document: ${relative}`);
  return parsed;
}

function schema(
  relative: string,
  name: string,
): { schema: ResolvedDdSchema; gateTerminal: readonly string[] } {
  const declaration = parseSchemaDeclaration(read(relative), name, `${FIXTURES}${relative}`);
  if (!declaration.ok) {
    throw new Error(`fixture schema failed to parse: ${JSON.stringify(declaration.issues)}`);
  }
  return {
    schema: declaration.declaration.schema,
    gateTerminal: declaration.declaration.gateTerminal,
  };
}

/**
 * Fake adapter set (house rule: fakes, never `vi.mock`). T002 proves the renderer
 * honours the W1 contract; T004 re-proves this same golden through the REAL
 * jiti-loaded fixture adapters, so the golden is never left resting on a fake.
 */
class FakeAdapters implements DdAdapterSet {
  readonly issues: DdAdapterIssue[] = [];
  readonly calls: DdAdapterContext[] = [];

  constructor(private readonly handlers: Record<string, (value: unknown) => string | null> = {}) {}

  render(value: unknown, ctx: DdAdapterContext): string | null {
    this.calls.push(ctx);
    const handler = this.handlers[ctx.type];
    if (!handler) {
      this.issues.push({
        class: 'adapter-not-found',
        severity: 'WARN',
        type: ctx.type,
        message: `no adapter for "${ctx.type}"`,
        location: ctx.location,
      });
      return null;
    }
    return handler(value);
  }
}

function durationAdapters(): FakeAdapters {
  return new FakeAdapters({
    duration: (value) => {
      const minutes = Number(value);
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return hours > 0 ? `**${hours}h ${rest}m**` : `**${rest}m**`;
    },
  });
}

describe('renderDd — golden corpus', () => {
  it('renders the showcase document byte-for-byte', () => {
    const path = 'showcase/repo/docs/showcase.dd.json';
    const resolved = schema(
      'showcase/repo/.dd/schemas/render/showcase/schema.json',
      'render/showcase',
    );
    const output = renderDd(doc(path), {
      path: `/absolute/and/irrelevant/${path}`,
      schema: resolved.schema,
      gateTerminal: resolved.gateTerminal,
      adapters: durationAdapters(),
    });
    expect(output).toEqual(read('showcase/repo/docs/showcase.dd.md'));
  });

  it('renders the drift fixture to its correct (not hand-edited) form', () => {
    const resolved = schema('drift/repo/.dd/schemas/render/simple/schema.json', 'render/simple');
    const output = renderDd(doc('drift/repo/docs/drift.dd.json'), {
      path: 'drift.dd.json',
      schema: resolved.schema,
      gateTerminal: resolved.gateTerminal,
    });
    expect(output).toEqual(read('drift/repo/docs/drift.expected.md'));
    expect(output).not.toEqual(read('drift/repo/docs/drift.dd.md'));
  });

  it('renders the transclusion chain, taking the cross-file summary as a precomputed input', () => {
    const resolved = schema('chain/repo/.dd/schemas/render/chain/schema.json', 'render/chain');
    const source = doc('chain/repo/docs/source.dd.json');
    expect(
      renderDd(source, {
        path: 'chain/repo/docs/source.dd.json',
        schema: resolved.schema,
        gateTerminal: resolved.gateTerminal,
      }),
    ).toEqual(read('chain/repo/docs/source.dd.md'));

    const items = source.sections.find((section) => section.name === 'items');
    if (!items) throw new Error('source fixture lost its items section');
    const output = renderDd(doc('chain/repo/docs/consumer.dd.json'), {
      path: 'chain/repo/docs/consumer.dd.json',
      schema: resolved.schema,
      gateTerminal: resolved.gateTerminal,
      derived: new Map([['source.dd.json#items', deriveState(items, resolved.gateTerminal)]]),
    });
    expect(output).toEqual(read('chain/repo/docs/consumer.dd.md'));
  });

  it('collapses a nested cell exactly at MAX_CELL_DEPTH and no sooner', () => {
    const resolved = schema('limits/repo/.dd/schemas/render/limits/schema.json', 'render/limits');
    const output = renderDd(doc('limits/repo/docs/limits.dd.json'), {
      path: 'limits/repo/docs/limits.dd.json',
      schema: resolved.schema,
      gateTerminal: resolved.gateTerminal,
    });
    expect(output).toEqual(read('limits/repo/docs/limits.dd.md'));
    expect(MAX_CELL_DEPTH).toBe(2);
    // The bound is real, not decorative: one row sits at it, the next crosses it.
    expect(output).toContain('nested: (b: 2) |');
    expect(output).toContain('deeper: ⟨…⟩');
  });
});

describe('renderDd — determinism and purity of output', () => {
  it('produces identical bytes across runs and ignores everything but the path basename', () => {
    const resolved = schema('drift/repo/.dd/schemas/render/simple/schema.json', 'render/simple');
    const source = doc('drift/repo/docs/drift.dd.json');
    const first = renderDd(source, { path: '/one/place/drift.dd.json', schema: resolved.schema });
    const second = renderDd(source, {
      path: 'C:\\another\\place\\drift.dd.json',
      schema: resolved.schema,
    });
    expect(first).toEqual(second);
    expect(first).toContain('**Source**: drift.dd.json');
    expect(first.startsWith(`${RENDER_BANNER}\n`)).toBe(true);
    expect(first.endsWith('\n')).toBe(true);
  });
});

describe('renderDd — render rules', () => {
  const simple = () => schema('drift/repo/.dd/schemas/render/simple/schema.json', 'render/simple');

  function renderSections(sections: DdDoc['sections'], override: Partial<ResolvedDdSchema> = {}) {
    const base = simple();
    return renderDd(
      { dd: { schema: 'render/simple' }, sections, references: [] },
      { path: 'doc.dd.json', schema: { ...base.schema, ...override } },
    );
  }

  it('titles the document from the first section carrying a title, else the filename', () => {
    expect(renderSections([{ name: 'meta', value: { title: 'From meta' } }])).toContain(
      '# From meta',
    );
    expect(renderSections([{ name: 'items', value: [] }])).toContain('# doc.dd.json');
  });

  it('pips a gate-terminal enum but leaves a plain vocabulary enum unpipped', () => {
    const output = renderSections([{ name: 'meta', value: { grade: 'shipped', mood: 'calm' } }], {
      enums: {
        grade: { values: ['draft', 'shipped'], gate_terminal: ['shipped'] },
        mood: { values: ['calm', 'tense'] },
      },
      sections: {
        meta: {
          shape: {
            type: 'object',
            fields: {
              grade: { type: 'enum', enum: 'grade' },
              mood: { type: 'enum', enum: 'mood' },
            },
          },
        },
      },
    });
    expect(output).toContain('| grade | [x] shipped |');
    expect(output).toContain('| mood | calm |');
  });

  it('renders an undeclared interior, pipping a structurally-named state field (A3)', () => {
    const output = renderSections([
      { name: 'evidence', value: { 'tk-1': [{ id: 'dw-1', state: 'blocked', why: 'no proof' }] } },
    ]);
    expect(output).toContain('### tk-1');
    expect(output).toContain('| id | state | why |');
    expect(output).toContain('| dw-1 | [-] blocked | no proof |');
  });

  it('titles a section by document, then schema, then derivation from its name', () => {
    // Tier 3 — nothing declared anywhere: the machine key becomes a heading a
    // human wants to read, so a schema gets decent headings for free.
    expect(renderSections([{ name: 'non_goals', value: ['a'] }])).toContain('## Non goals');
    expect(renderSections([{ name: 'acceptance_criteria', value: [] }])).toContain(
      '## Acceptance criteria',
    );

    // Tier 2 — the SCHEMA names it, so every document of this kind inherits it.
    // NOTE: this proves the renderer READS a schema title; it does NOT prove the
    // schema parser carries one, because `renderSections` hands renderDd a
    // hand-built ResolvedDdSchema and never runs that parser. Deleting the
    // parser's allow-list entry leaves this assertion green — a mutation run
    // showed exactly that. The parser side is pinned in
    // test/services/dd/schema/declarations.test.ts instead.
    expect(
      renderSections([{ name: 'non_goals', value: ['a'] }], {
        sections: { non_goals: { shape: { type: 'array' }, title: 'Non-goals' } },
      }),
    ).toContain('## Non-goals');

    // Tier 1 — the DOCUMENT overrides its schema for this one section.
    expect(
      renderSections(
        [{ name: 'non_goals', title: 'What we are deliberately not doing', value: [] }],
        {
          sections: { non_goals: { shape: { type: 'array' }, title: 'Non-goals' } },
        },
      ),
    ).toContain('## What we are deliberately not doing');
  });

  it('keeps a section address pinned to its NAME however the title is written', () => {
    // The load-bearing invariant of FU-2. A title is display; the anchor is
    // identity. If the address were derived from the heading TEXT, retitling a
    // section would silently move `#non-goals` and strand every inbound link —
    // so the explicit anchor must read the same for all three tiers.
    const derived = renderSections([{ name: 'non_goals', value: [] }]);
    const schemaTitled = renderSections([{ name: 'non_goals', value: [] }], {
      sections: { non_goals: { shape: { type: 'array' }, title: 'Non-goals' } },
    });
    const docTitled = renderSections([
      { name: 'non_goals', title: 'Wildly different words', value: [] },
    ]);

    for (const output of [derived, schemaTitled, docTitled]) {
      expect(output).toContain('<a id="non-goals"></a>');
    }
    // ...and the headings really are different, so the assertion above is not
    // passing merely because all three rendered identically.
    expect(schemaTitled).not.toEqual(derived);
    expect(docTitled).not.toEqual(schemaTitled);
  });

  it('renders every address in an array-of-link cell as a real link, declared or inferred', () => {
    // The execution-log shape: one row, many outbound addresses. A cell that
    // holds a LIST of addresses must be as clickable as a cell that holds one —
    // rendering it as plain text strands exactly the links dd exists to make
    // navigable. Both routes are covered: the DECLARED `array of link` shape,
    // and the undeclared interior that falls back to address inference (A3).
    // The declared case deliberately targets a NON-.dd.json file: address
    // inference refuses those (`looksLikeAddress`), so this assertion can only
    // pass by honouring the declared `link` shape. Using a .dd.json target here
    // would let inference carry the test and prove nothing about declaration.
    const declared = renderSections(
      [
        {
          name: 'entries',
          value: [{ id: 'lg-1', links: ['notes.md#section/detail', '#entries'] }],
        },
      ],
      {
        sections: {
          entries: {
            shape: {
              type: 'array',
              items: {
                type: 'object',
                fields: { links: { type: 'array', items: { type: 'link' } } },
              },
            },
          },
        },
      },
    );
    expect(declared).toContain('[detail](notes.md#section)');
    expect(declared).toContain('[entries](#entries)');

    const inferred = renderSections([
      { name: 'entries', value: [{ id: 'lg-1', links: ['plan.dd.json#phases/ph-0001'] }] },
    ]);
    expect(inferred).toContain('[ph-0001](plan.dd.md#phases)');
  });

  it('escapes a cell but never block prose', () => {
    const output = renderSections([
      { name: 'items', value: [{ id: 'a', label: 'x | y <z>' }] },
      { name: 'notes', value: 'prose | with `pipes` and <tags>' },
    ]);
    expect(output).toContain('| a | x \\| y &lt;z&gt; | — |');
    expect(output).toContain('prose | with `pipes` and <tags>');
  });

  it('anchors an instance link on the nearest heading with the id visible', () => {
    const output = renderSections(
      [
        { name: 'items', value: [{ id: 'a', label: 'l', state: 'checked' }] },
        { name: 'meta', value: { title: 'T', link: '#items/a', away: 'other.dd.json#items/b' } },
      ],
      {
        sections: {
          meta: {
            shape: {
              type: 'object',
              fields: { title: { type: 'string' }, link: { type: 'link' } },
            },
          },
        },
      },
    );
    // `link` is declared; `away` is not, and is recovered by the address inference.
    expect(output).toContain('[a](#items)');
    expect(output).toContain('[b](other.dd.md#items)');
    expect(headingSlug('Some Heading')).toBe('some-heading');
  });

  it('reads an undeclared address as a link, but never mistakes prose for one', () => {
    const output = renderSections([
      {
        name: 'evidence',
        value: { 'tk-1': [{ id: 'dw-1', proof: '#items/a', note: 'See #items' }] },
      },
    ]);
    expect(output).toContain('| dw-1 | [a](#items) | See #items |');
  });

  it('says so honestly when a section is empty rather than emitting a headless table', () => {
    const output = renderSections([
      { name: 'items', value: [] },
      { name: 'undeclared', value: {} },
      { name: 'notes', value: '' },
    ]);
    expect(output).toContain('_No entries._');
    expect(output).toContain('_No fields._');
    expect(output).toContain('_Empty._');
  });

  it('shows a declared-but-absent field as an empty cell rather than hiding it', () => {
    expect(renderSections([{ name: 'meta', value: { title: 'T' } }])).toContain('| status | — |');
  });

  it('keeps a malformed address readable instead of throwing', () => {
    const output = renderSections([
      { name: 'meta', value: { title: 'T', link: 'no-boundary-here' } },
    ]);
    expect(output).toContain('no-boundary-here');
  });
});
