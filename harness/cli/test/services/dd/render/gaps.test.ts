import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NodeSchemaFs } from '../../../../src/acts/dd/schema-fs.js';
import { JitiLoader } from '../../../../src/adapters/loader/jiti-loader.js';
import {
  adapterGapSource,
  collectAdapterGaps,
  type DdRenderAdapterGap,
  type SchemaRecordLike,
} from '../../../../src/services/dd/render/gaps.js';
import { parseSchemaDeclaration } from '../../../../src/services/dd/schema/declarations.js';

const REPO = fileURLToPath(new URL('./fixtures/adapters/repo/', import.meta.url));
const DOC = `${REPO}docs/adapters.dd.json`;
const SCHEMA_PATH = `${REPO}.dd/schemas/render/adapters/schema.json`;

function record(): SchemaRecordLike {
  const declaration = parseSchemaDeclaration(
    readFileSync(SCHEMA_PATH, 'utf8'),
    'render/adapters',
    SCHEMA_PATH,
  );
  if (!declaration.ok) throw new Error('fixture schema failed to parse');
  return {
    name: 'render/adapters',
    path: SCHEMA_PATH,
    schema: declaration.declaration.schema,
    gateTerminal: declaration.declaration.gateTerminal,
  };
}

async function gapsFor(
  paths: readonly string[],
  resolve: (ref: string, from: string) => SchemaRecordLike | null = () => record(),
): Promise<DdRenderAdapterGap[]> {
  return await collectAdapterGaps({
    paths,
    fs: new NodeSchemaFs(),
    loader: new JitiLoader(),
    resolveSchema: resolve,
  });
}

function kindOf(gaps: readonly DdRenderAdapterGap[], type: string) {
  return gaps.find((gap) => gap.type === type)?.kind;
}

describe('dd render — adapter-gap collection (the P3 export the doctor consumes)', () => {
  it('reports every failure class, including the two that only exist at render time', async () => {
    const gaps = await gapsFor([DOC]);

    // Load-time classes: answered by resolving the adapter file.
    expect(kindOf(gaps, 'missing')).toBe('not-found');
    expect(kindOf(gaps, 'broken')).toBe('load-failed');
    expect(kindOf(gaps, 'shapeless')).toBe('load-failed');

    // Render-time classes: only a real call can find these, which is why the
    // collector renders rather than merely loading (AC-04 — the doctor repeats a
    // degraded render, all of it).
    expect(kindOf(gaps, 'boom')).toBe('runtime-failed');
    expect(kindOf(gaps, 'numeric')).toBe('output-invalid');

    // The adapter that works is not a finding.
    expect(kindOf(gaps, 'good')).toBeUndefined();
  });

  it('carries the document path and schema name on every gap', async () => {
    const gaps = await gapsFor([DOC]);
    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) {
      expect(gap.path).toBe(DOC);
      expect(gap.schema).toBe('render/adapters');
      expect(gap.message.length).toBeGreaterThan(0);
    }
  });

  it('yields nothing for a document whose schema does not resolve', async () => {
    expect(await gapsFor([DOC], () => null)).toEqual([]);
  });

  it('yields nothing for an unreadable or unparseable document', async () => {
    expect(await gapsFor([`${REPO}docs/does-not-exist.dd.json`])).toEqual([]);
    expect(await gapsFor([SCHEMA_PATH])).toEqual([]);
  });

  it('never renders a document that populates no custom type', async () => {
    // The guard that makes the render affordable: the schema here declares only
    // built-ins, so the document is skipped before any adapter work happens.
    const plain: SchemaRecordLike = {
      name: 'render/plain',
      path: SCHEMA_PATH,
      schema: {
        name: 'render/plain',
        sections: { meta: { shape: { type: 'object', fields: { title: { type: 'string' } } } } },
      },
    };
    expect(await gapsFor([DOC], () => plain)).toEqual([]);
  });
});

describe('dd render — adapterGapSource', () => {
  const gaps: DdRenderAdapterGap[] = [
    { path: '/repo/a.dd.json', kind: 'not-found', message: 'a' },
    { path: '/repo/b.dd.json', kind: 'runtime-failed', message: 'b' },
  ];

  it('returns only the gaps for the documents the sweep asked about', () => {
    expect(adapterGapSource(gaps).adapterGaps(['/repo/b.dd.json'])).toEqual([gaps[1]]);
  });

  it('returns nothing for a document it never collected', () => {
    // Honest by construction: a document outside the collected set gets silence,
    // not a clean bill of health it was never asked to earn.
    expect(adapterGapSource(gaps).adapterGaps(['/repo/never-seen.dd.json'])).toEqual([]);
  });
});
