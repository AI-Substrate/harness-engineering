import { describe, expect, it } from 'vitest';
import { FakeModuleLoader } from '../../src/adapters/loader/fake-loader.js';
import { buildExtensionRegistry } from '../../src/services/extensions/registry.js';

const ok = () => ({ status: 'ok' as const });

describe('v2 registry pipeline', () => {
  it('gates, validates, normalizes, and registers a v2 definition', async () => {
    const loader = new FakeModuleLoader({
      '/repo/.harness/extensions/sample/extension.ts': {
        kind: 'extension',
        name: 'sample',
        summary: 'Sample extension',
        verbs: {
          build: { summary: 'Build', run: ok, futureField: 'tolerated' },
        },
        records: {
          decision: { description: 'Decision', template: '---\nrecord_type: decision\n---\n' },
        },
        sensors: { lint: { summary: 'Lint', run: () => ({ state: 'pass' }) } },
        custom: { migration: { users: { summary: 'Users' } } },
      },
    });

    const registry = await buildExtensionRegistry(
      ['/repo/.harness/extensions/sample/extension.ts'],
      loader,
    );
    expect(registry.verbs.map((verb) => verb.name)).toEqual(['build']);
    expect(registry.recordTypes.map(({ recordType }) => recordType.type)).toEqual(['decision']);
    expect(registry.sensors.map((sensor) => sensor.name)).toEqual(['lint']);
    expect(registry.customItems.map((item) => `${item.type}.${item.name}`)).toEqual([
      'migration.users',
    ]);
    expect(registry.extensions).toHaveLength(1);
    expect(registry.extensions[0]).toMatchObject({
      source: 'v2',
      api: 2,
      name: 'sample',
      sensors: [{ name: 'lint' }],
      customItems: [{ type: 'migration', name: 'users' }],
    });
    expect(registry.records[0]).toMatchObject({ status: 'loaded', format: 'v2 (api 2)' });
    expect(registry.records[0]?.info).toEqual(
      expect.arrayContaining([
        expect.stringContaining('verbs.build.futureField'),
        expect.stringContaining('never watch-fired'),
      ]),
    );
  });

  it('records E147 with a next_action and isolates the newer extension', async () => {
    const path = '/repo/.harness/extensions/future/extension.ts';
    const registry = await buildExtensionRegistry(
      [path],
      new FakeModuleLoader({
        [path]: { kind: 'extension', api: 3, name: 'future', summary: 'Future' },
      }),
    );
    expect(registry.verbs).toEqual([]);
    expect(registry.records[0]).toMatchObject({
      status: 'failed',
      code: 'E147',
      format: 'v2 (api 3)',
    });
    expect(registry.records[0]?.next_action).toContain('harness update');
  });

  it('records E148 for an unknown top-level section', async () => {
    const path = '/repo/.harness/extensions/typo/extension.ts';
    const registry = await buildExtensionRegistry(
      [path],
      new FakeModuleLoader({
        [path]: { kind: 'extension', name: 'typo', summary: 'Typo', verbz: {} },
      }),
    );
    expect(registry.records[0]).toMatchObject({ status: 'failed', code: 'E148' });
    expect(registry.records[0]?.error).toContain('verbz');
    expect(registry.records[0]?.next_action).toContain('declare the api level');
  });

  it('routes a mixed v1/v2 array independently and reports its formats', async () => {
    const path = '/repo/.harness/extensions/mixed/extension.ts';
    const registry = await buildExtensionRegistry(
      [path],
      new FakeModuleLoader({
        [path]: [
          { name: 'legacy', summary: 'Legacy', run: ok },
          {
            kind: 'extension',
            name: 'mixed',
            summary: 'Modern',
            verbs: { modern: { summary: 'Modern', run: ok } },
          },
          {
            kind: 'record',
            type: 'note',
            description: 'Note',
            template: '---\nrecord_type: note\n---\n',
          },
        ],
      }),
    );
    expect(registry.verbs.map((verb) => verb.name)).toEqual(['legacy', 'modern']);
    expect(registry.recordTypes.map(({ recordType }) => recordType.type)).toEqual(['note']);
    expect(registry.records[0]?.format).toBe('v1 + v2 (api 2)');
    expect(registry.records[0]?.info).toContain(
      'mixed v1/v2 default export routed independently (tolerated)',
    );
  });
});
