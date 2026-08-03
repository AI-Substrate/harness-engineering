import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as ddLinks from '../../../src/services/dd/links/index.js';
import * as ddSchema from '../../../src/services/dd/schema/index.js';

/**
 * The flow→dd SDK-seam boundary (P6 review F001).
 *
 * The flow spine is an EXTERNAL consumer of dd. It may import dd's two published
 * barrels and nothing else; a module path under `dd/core/`, `dd/links/*` or
 * `dd/schema/*` is an internal, and reaching past a barrel for one is how an SDK
 * silently decays into a shared folder — the export list stops describing the
 * contract, and dd can no longer move an internal without breaking the flow.
 *
 * `.dependency-cruiser.cjs`'s `flow-consumes-dd-sdk-only` rule is the authoritative
 * enforcement (it sees the whole reachable graph). This test is its fast, always-run
 * sibling: `harness arch-check` runs in `checks`, but the unit suite runs on every
 * save, and a boundary that is only checked at the end of the loop is a boundary
 * that gets crossed in the middle of one.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FLOW_SRC = join(HERE, '..', '..', '..', 'src', 'services', 'flow');

/** The ONLY dd specifiers the flow layer may name. Adding a third is a design decision. */
const PERMITTED_DD_SPECIFIERS: readonly string[] = [
  '../dd/links/index.js',
  '../dd/schema/index.js',
];

/** Every `from '...'` / `import('...')` specifier in a source file. */
function specifiersOf(source: string): string[] {
  return [...source.matchAll(/from\s+'([^']+)'|import\('([^']+)'\)/g)].map(
    (m) => m[1] ?? m[2] ?? '',
  );
}

function flowSources(): { file: string; text: string }[] {
  return readdirSync(FLOW_SRC)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ file: f, text: readFileSync(join(FLOW_SRC, f), 'utf8') }));
}

describe('flow → dd: published SDK seams only (F001)', () => {
  it('every dd import in services/flow names a barrel, never a module path', () => {
    const offences: string[] = [];
    for (const { file, text } of flowSources()) {
      for (const spec of specifiersOf(text)) {
        if (!spec.includes('/dd/')) continue;
        if (!PERMITTED_DD_SPECIFIERS.includes(spec)) offences.push(`${file}: ${spec}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('the gate reaches dd through exactly the two barrels', () => {
    const gate = readFileSync(join(FLOW_SRC, 'flow-dd-gate.ts'), 'utf8');
    const dd = specifiersOf(gate).filter((s) => s.includes('/dd/'));
    expect([...new Set(dd)].sort()).toEqual([...PERMITTED_DD_SPECIFIERS].sort());
  });

  it('the barrels export every value seam the gate consumes', () => {
    // By value, not by shape: a barrel that stops exporting one of these is a
    // BREAKING change to an external consumer, and should fail here loudly rather
    // than at whichever call site happens to be typechecked first.
    expect(typeof ddLinks.resolveLink).toBe('function');
    expect(typeof ddLinks.verifyBasis).toBe('function');
    expect(typeof ddSchema.deriveSchemaState).toBe('function');
    expect(typeof ddSchema.deriveSchemaItems).toBe('function');
    expect(typeof ddSchema.ConventionSchemaResolver).toBe('function');
  });

  it('deriveSchemaItems and deriveSchemaState project the SAME collector', () => {
    // The reason `deriveSchemaItems` was exposed rather than reconstructed in the
    // flow: one walker, two views. If they ever disagreed about what an item is,
    // the gate's refusal list and its own n/m count would contradict each other.
    const record = {
      name: 'test.schema',
      description: '',
      version: 1,
      path: '/repo/schemas/test/schema.json',
      root: 'gitroot' as const,
      schema: { sections: {} } as unknown as ddSchema.SchemaRecord['schema'],
      gateTerminal: ['done'] as readonly string[],
      shadows: [],
    };
    const section = {
      name: 'tasks',
      value: [
        { id: 'tk-1', state: 'done' },
        { id: 'tk-2', state: 'blocked' },
        { id: 'tk-3', state: 'unchecked' },
      ],
    };
    const state = ddSchema.deriveSchemaState(record, section);
    const items = ddSchema.deriveSchemaItems(record, section);

    expect(items.map((i) => i.id)).toEqual(['tk-1', 'tk-2', 'tk-3']);
    expect(items.length).toBe(state.total);
    expect(items.filter((i) => i.terminal).length).toBe(state.terminal);
    expect(items.filter((i) => !i.terminal).map((i) => i.id)).toEqual(state.incomplete);
    // And the states are NAMED, which is the whole reason the seam exists.
    expect(items.map((i) => i.state)).toEqual(['done', 'blocked', 'unchecked']);
  });
});
