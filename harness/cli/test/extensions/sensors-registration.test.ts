import { describe, expect, it } from 'vitest';
import { FakeModuleLoader } from '../../src/adapters/loader/fake-loader.js';
import { buildExtensionRegistry, RESERVED_NAMES } from '../../src/services/extensions/registry.js';

const pass = () => ({ state: 'pass' as const, score: 0, direction: 'lower' as const });

describe('sensor registration (workshop 002 S1/S9)', () => {
  it('registers typed sensors outside the verb namespace and reserves the core name', async () => {
    const path = '/repo/.harness/extensions/quality/extension.ts';
    const registry = await buildExtensionRegistry(
      [path],
      new FakeModuleLoader({
        [path]: {
          kind: 'extension',
          name: 'quality',
          summary: 'Quality sensors',
          sensors: {
            lint: {
              summary: 'Lint status',
              watch: ['src/**/*.ts'],
              timeoutMs: 2_000,
              guidance: 'Run npm run lint.',
              run: pass,
            },
            audit: { summary: 'Manual audit', trigger: 'manual', run: pass },
          },
        },
      }),
    );

    expect(RESERVED_NAMES.has('sensors')).toBe(true);
    expect(registry.verbs).toEqual([]);
    expect(registry.sensors.map((sensor) => sensor.name)).toEqual(['lint', 'audit']);
    expect(registry.sensors[0]).toMatchObject({
      name: 'lint',
      entryPath: path,
      declaration: {
        summary: 'Lint status',
        watch: ['src/**/*.ts'],
        trigger: 'watch',
        timeoutMs: 2_000,
      },
    });
    expect(registry.records[0]).toMatchObject({ status: 'loaded', format: 'v2 (api 2)' });
    expect(registry.records[0]?.info ?? []).not.toEqual(
      expect.arrayContaining([expect.stringContaining('handler not yet active')]),
    );
  });

  it('rebuilds declarations from known fields and tolerates unknown fields as doctor info', async () => {
    const path = '/repo/.harness/extensions/runtime/extension.js';
    const registry = await buildExtensionRegistry(
      [path],
      new FakeModuleLoader({
        [path]: {
          kind: 'extension',
          name: 'runtime',
          summary: 'Runtime-shaped extension',
          sensors: {
            lint: {
              summary: 'Lint',
              run: pass,
              name: 'overwrite-attempt',
              entryPath: '/evil',
              futureField: true,
            },
          },
        },
      }),
    );

    expect(registry.sensors[0]).toMatchObject({ name: 'lint', entryPath: path });
    expect(registry.sensors[0]?.declaration).not.toHaveProperty('name');
    expect(registry.sensors[0]?.declaration).not.toHaveProperty('entryPath');
    expect(registry.records[0]?.info).toEqual(
      expect.arrayContaining([expect.stringContaining('sensors.lint.futureField')]),
    );
  });

  it('rejects invalid declarations with E216 and duplicate names first-wins with E217', async () => {
    const first = '/repo/.harness/extensions/first/extension.ts';
    const duplicate = '/repo/.harness/extensions/duplicate/extension.ts';
    const invalid = '/repo/.harness/extensions/invalid/extension.ts';
    const registry = await buildExtensionRegistry(
      [first, duplicate, invalid],
      new FakeModuleLoader({
        [first]: {
          kind: 'extension',
          name: 'first',
          summary: 'First',
          sensors: { lint: { summary: 'First lint', run: pass } },
        },
        [duplicate]: {
          kind: 'extension',
          name: 'duplicate',
          summary: 'Duplicate',
          sensors: { lint: { summary: 'Second lint', run: pass } },
        },
        [invalid]: {
          kind: 'extension',
          name: 'invalid',
          summary: 'Invalid',
          sensors: {
            'Bad Name': { summary: '', run: 'not-a-function' },
          },
        },
      }),
    );

    expect(registry.sensors).toHaveLength(1);
    expect(registry.sensors[0]).toMatchObject({ name: 'lint', entryPath: first });
    expect(registry.records[1]).toMatchObject({ status: 'failed', code: 'E217' });
    expect(registry.records[1]?.next_action).toMatch(/rename/i);
    expect(registry.records[2]).toMatchObject({ status: 'failed', code: 'E216' });
    expect(registry.records[2]?.error).toMatch(/name|summary|run/);
  });
});
