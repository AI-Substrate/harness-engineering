import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NodeSchemaFs } from '../../../../src/acts/dd/schema-fs.js';
import { JitiLoader } from '../../../../src/adapters/loader/jiti-loader.js';
import type { DdDoc, ResolvedDdSchema } from '../../../../src/services/dd/core/model.js';
import { parse } from '../../../../src/services/dd/core/parse.js';
import {
  adapterPath,
  collectCustomTypes,
  type DdAdapterFs,
  type DdAdapterModuleLoader,
  LoadedAdapterSet,
  loadAdapters,
} from '../../../../src/services/dd/render/adapters.js';
import type {
  DdAdapterContext,
  DdAdapterIssue,
} from '../../../../src/services/dd/render/contract.js';
import { renderDd } from '../../../../src/services/dd/render/renderer.js';
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

function schemaAt(
  relative: string,
  name: string,
): { schema: ResolvedDdSchema; gateTerminal: readonly string[]; path: string } {
  const path = `${FIXTURES}${relative}`;
  const declaration = parseSchemaDeclaration(read(relative), name, path);
  if (!declaration.ok)
    throw new Error(`fixture schema failed: ${JSON.stringify(declaration.issues)}`);
  return {
    schema: declaration.declaration.schema,
    gateTerminal: declaration.declaration.gateTerminal,
    path,
  };
}

function byClass(issues: readonly DdAdapterIssue[], type: string): string | undefined {
  return issues.find((issue) => issue.type === type)?.class;
}

function ctx(type: string): DdAdapterContext {
  return {
    type,
    field: type,
    shape: { type },
    path: 'doc.dd.json',
    location: `$.sections[meta].${type}`,
  };
}

const ADAPTERS_SCHEMA = 'adapters/repo/.dd/schemas/render/adapters/schema.json';

describe('adapter pipeline — real jiti loading over every failure class', () => {
  it('discovers only the custom types the document actually populates', () => {
    const resolved = schemaAt(ADAPTERS_SCHEMA, 'render/adapters');
    expect(collectCustomTypes(doc('adapters/repo/docs/adapters.dd.json'), resolved.schema)).toEqual(
      ['boom', 'broken', 'good', 'missing', 'numeric', 'shapeless'],
    );
  });

  it('resolves adapters beside the winning schema file, by presence alone', () => {
    expect(adapterPath('/root/schemas/render/adapters/schema.json', 'good')).toBe(
      '/root/schemas/render/adapters/adapters/good.ts',
    );
  });

  it('renders the golden with the fallback, and names every failure class in the envelope', async () => {
    const resolved = schemaAt(ADAPTERS_SCHEMA, 'render/adapters');
    const document = doc('adapters/repo/docs/adapters.dd.json');
    const adapters = await loadAdapters({
      types: collectCustomTypes(document, resolved.schema),
      schemaPath: resolved.path,
      fs: new NodeSchemaFs(),
      loader: new JitiLoader(),
    });

    const output = renderDd(document, {
      path: 'adapters/repo/docs/adapters.dd.json',
      schema: resolved.schema,
      gateTerminal: resolved.gateTerminal,
      adapters,
    });

    // Never crashed, never blank: the whole document rendered (W1 rule 4).
    expect(output).toEqual(read('adapters/repo/docs/adapters.dd.md'));

    // ...and never silent: every failure is in the envelope (W1 rule 5).
    expect(byClass(adapters.issues, 'missing')).toBe('adapter-not-found');
    expect(byClass(adapters.issues, 'broken')).toBe('adapter-load-failed');
    expect(byClass(adapters.issues, 'shapeless')).toBe('adapter-load-failed');
    expect(byClass(adapters.issues, 'boom')).toBe('adapter-runtime-failed');
    expect(byClass(adapters.issues, 'numeric')).toBe('adapter-output-invalid');
    expect(adapters.issues.find((issue) => issue.type === 'good')).toBeUndefined();
    expect(new Set(adapters.issues.map((issue) => issue.class)).size).toBe(4);
    for (const issue of adapters.issues) {
      expect(issue.severity).toBe('WARN');
      expect(issue.location).toBeDefined();
    }
  });

  it('drives the showcase golden through the REAL adapter, not the renderer suite fake', async () => {
    const resolved = schemaAt(
      'showcase/repo/.dd/schemas/render/showcase/schema.json',
      'render/showcase',
    );
    const document = doc('showcase/repo/docs/showcase.dd.json');
    const adapters = await loadAdapters({
      types: collectCustomTypes(document, resolved.schema),
      schemaPath: resolved.path,
      fs: new NodeSchemaFs(),
      loader: new JitiLoader(),
    });
    const output = renderDd(document, {
      path: 'showcase/repo/docs/showcase.dd.json',
      schema: resolved.schema,
      gateTerminal: resolved.gateTerminal,
      adapters,
    });
    expect(output).toEqual(read('showcase/repo/docs/showcase.dd.md'));
    expect(adapters.issues).toEqual([]);
  });

  it('hands the adapter its column declaration and doc path (the W1 ctx contract)', async () => {
    const seen: DdAdapterContext[] = [];
    const fs: DdAdapterFs = { exists: () => true };
    const loader: DdAdapterModuleLoader = {
      load: () =>
        Promise.resolve((value: unknown, context: DdAdapterContext) => {
          seen.push(context);
          return `<${String(value)}>`;
        }),
    };
    const adapters = await loadAdapters({
      types: ['duration'],
      schemaPath: '/root/schemas/render/showcase/schema.json',
      fs,
      loader,
    });

    const output = renderDd(
      {
        dd: { schema: 'render/showcase' },
        sections: [{ name: 'meta', value: { title: 'T', spent: 90 } }],
        references: [],
      },
      {
        path: '/repo/docs/thing.dd.json',
        schema: {
          name: 'render/showcase',
          sections: {
            meta: {
              shape: {
                type: 'object',
                fields: { title: { type: 'string' }, spent: { type: 'duration' } },
              },
            },
          },
        },
        adapters,
      },
    );

    expect(output).toContain('| spent | <90> |');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      type: 'duration',
      field: 'spent',
      shape: { type: 'duration' },
      path: '/repo/docs/thing.dd.json',
      location: '$.sections[meta].spent',
    });
  });
});

describe('adapter pipeline — aggregation contract', () => {
  it('exposes the same findings through the WARN interface P4 doctor consumes', () => {
    const set = new LoadedAdapterSet(new Map());
    set.record('adapter-not-found', 'duration', 'no adapter', { path: '/a/duration.ts' });
    expect(set.adapterWarnings()).toEqual(set.issues);
    expect(set.adapterWarnings()).toEqual([
      {
        class: 'adapter-not-found',
        severity: 'WARN',
        type: 'duration',
        message: 'no adapter',
        path: '/a/duration.ts',
      },
    ]);
  });

  it('reports each failure once per type, however many cells hit it', () => {
    const set = new LoadedAdapterSet(new Map());
    set.record('adapter-not-found', 'duration', 'no adapter');
    for (let cell = 0; cell < 20; cell += 1) set.render(cell, ctx('duration'));
    expect(set.issues).toHaveLength(1);
    // Deduplicated, but not anonymous: the first cell that hit it is named.
    expect(set.issues[0]?.location).toBe('$.sections[meta].duration');
  });

  it('keeps a runtime failure and an output failure as distinct classes for one type', () => {
    const throwing = new LoadedAdapterSet(
      new Map([
        [
          'a',
          () => {
            throw new Error('nope');
          },
        ],
      ]),
    );
    expect(throwing.render(1, ctx('a'))).toBeNull();
    expect(throwing.issues[0]?.class).toBe('adapter-runtime-failed');
    expect(throwing.issues[0]?.message).toContain('nope');

    const invalid = new LoadedAdapterSet(new Map([['a', (() => 42) as never]]));
    expect(invalid.render(1, ctx('a'))).toBeNull();
    expect(invalid.issues[0]?.class).toBe('adapter-output-invalid');
    expect(invalid.issues[0]?.message).toContain('number');
  });

  it('never lets a missing adapter file become a thrown error', async () => {
    const adapters = await loadAdapters({
      types: ['ghost'],
      schemaPath: '/root/schemas/render/x/schema.json',
      fs: { exists: () => false },
      loader: {
        load: () => Promise.reject(new Error('must never be called')),
      },
    });
    expect(adapters.issues).toHaveLength(1);
    expect(adapters.issues[0]?.class).toBe('adapter-not-found');
    expect(adapters.issues[0]?.path).toBe('/root/schemas/render/x/adapters/ghost.ts');
  });
});
