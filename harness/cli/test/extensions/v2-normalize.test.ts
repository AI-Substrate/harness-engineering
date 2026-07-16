import { describe, expect, it } from 'vitest';
import type { ExtensionDefinition } from '../../src/services/extensions/contract.js';
import {
  normalizeV1Extension,
  normalizeV2Extension,
} from '../../src/services/extensions/v2/normalize.js';

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

describe('extension normalizers', () => {
  it('normalizes v1 entries to the current versionless shape', () => {
    const normalized = normalizeV1Extension(
      '/repo/.harness/extensions/legacy/extension.ts',
      [v1Verb],
      [v1Record],
    );

    expect(normalized).toMatchObject({
      name: 'legacy',
      source: 'v1',
      api: 1,
      entryPath: '/repo/.harness/extensions/legacy/extension.ts',
      sensors: [],
      customItems: [],
      info: [],
    });
    expect(normalized.verbs).toHaveLength(1);
    expect(normalized.verbs[0]).toMatchObject({ name: 'build', summary: 'Build the project' });
    expect(normalized.verbs[0]?.run).toBe(v1Verb.run);
    expect(normalized.recordTypes).toEqual([v1Record]);
  });

  it('normalizes a v2 definition, keyed records, nested verbs, sensors, and custom items', () => {
    const reset = () => ({ status: 'ok' as const });
    const sensor = {
      summary: 'Lint sensor',
      watch: ['src/**/*.ts'],
      run: () => ({ state: 'pass' as const }),
    };
    const custom = { summary: 'Migrate users', order: 1 };
    const normalized = normalizeV2Extension(
      '/repo/.harness/extensions/database/extension.ts',
      {
        kind: 'extension',
        name: 'database',
        summary: 'Database loop',
        verbs: {
          db: {
            summary: 'Database commands',
            options: [{ flags: '--profile <name>', description: 'Shared profile' }],
            sub: {
              reset: {
                summary: 'Reset database',
                args: [{ name: '<files...>', description: 'Seed files' }],
                run: reset,
              },
            },
          },
        },
        records: {
          decision: {
            description: 'Decision record',
            template: '---\nrecord_type: decision\n---\n',
          },
        },
        sensors: { lint: sensor },
        custom: { migration: { users: custom } },
      },
      ['sensors declared, handler not yet active'],
    );

    expect(normalized).toMatchObject({
      name: 'database',
      source: 'v2',
      api: 2,
      entryPath: '/repo/.harness/extensions/database/extension.ts',
      info: ['sensors declared, handler not yet active'],
    });
    expect(normalized.verbs[0]).toMatchObject({
      name: 'db',
      summary: 'Database commands',
      subverbs: [{ name: 'reset', summary: 'Reset database', run: reset }],
    });
    expect(normalized.recordTypes).toEqual([
      {
        kind: 'record',
        type: 'decision',
        description: 'Decision record',
        template: '---\nrecord_type: decision\n---\n',
      },
    ]);
    expect(normalized.sensors).toEqual([
      {
        name: 'lint',
        declaration: { ...sensor, trigger: 'watch', timeoutMs: 30_000 },
      },
    ]);
    expect(normalized.customItems).toEqual([
      { type: 'migration', name: 'users', declaration: custom },
    ]);
  });

  it('prevents tolerated fields from overwriting keyed record or custom identity', () => {
    const normalized = normalizeV2Extension('/repo/.harness/extensions/database/extension.js', {
      ...({
        kind: 'extension',
        name: 'database',
        summary: 'Database loop',
        records: {
          decision: {
            description: 'Decision record',
            template: '---\nrecord_type: decision\n---\n',
            kind: 'extension',
            type: 'other',
          },
        },
        custom: {
          migration: {
            users: { summary: 'Migrate users', type: 'other', name: 'other' },
          },
        },
      } as unknown as ExtensionDefinition),
    });

    expect(normalized.recordTypes).toEqual([
      {
        kind: 'record',
        type: 'decision',
        description: 'Decision record',
        template: '---\nrecord_type: decision\n---\n',
      },
    ]);
    expect(normalized.customItems[0]).toMatchObject({
      type: 'migration',
      name: 'users',
      declaration: { type: 'other', name: 'other' },
    });
  });

  it.each([
    ['/repo/.harness/extensions/database/index.ts', 'index entry'],
    ['/repo/.harness/extensions/database/main.ts', 'manifest-selected entry'],
  ])('derives the extension folder from dirname for a %s (%s)', (entryPath) => {
    const normalized = normalizeV2Extension(entryPath, {
      kind: 'extension',
      name: 'database',
      summary: 'Database loop',
    });

    expect(normalized.info).not.toEqual(
      expect.arrayContaining([expect.stringContaining('differs from extension folder')]),
    );
  });
});
