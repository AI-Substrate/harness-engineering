import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JitiLoader } from '../../../src/adapters/loader/jiti-loader.js';
import { buildExtensionRegistry } from '../../../src/services/extensions/registry.js';

const corpus = join(dirname(fileURLToPath(import.meta.url)), 'api-2');

async function load(name: string) {
  const entryPath = join(corpus, name);
  return buildExtensionRegistry([entryPath], new JitiLoader());
}

describe('frozen api-2 extension corpus', () => {
  it.each([
    ['factory.ts', 'factory'],
    ['bare-literal.js', 'bare'],
  ])('loads the %s authoring form', async (fixture, verbName) => {
    const registry = await load(fixture);
    expect(registry.records[0]).toMatchObject({ status: 'loaded', format: 'v2 (api 2)' });
    expect(registry.verbs.map((verb) => verb.name)).toContain(verbName);
  });

  it('carries one-level subverbs, scoped params, and a variadic declaration', async () => {
    const registry = await load('subverbs.ts');
    expect(registry.records[0]?.status).toBe('loaded');
    expect(registry.verbs[0]).toMatchObject({
      name: 'files',
      options: [{ flags: '--profile <name>' }],
      subverbs: [
        {
          name: 'print',
          options: [{ flags: '--numbered' }],
          args: [{ name: '<files...>' }],
        },
      ],
    });
  });

  it('routes every mixed-array member independently', async () => {
    const registry = await load('mixed.ts');
    expect(registry.verbs.map((verb) => verb.name)).toEqual(['legacy-mixed', 'modernMixed']);
    expect(registry.recordTypes.map(({ recordType }) => recordType.type)).toEqual(['mixed-note']);
    expect(registry.records[0]).toMatchObject({
      status: 'loaded',
      format: 'v1 + v2 (api 2)',
    });
  });

  it('freezes the E147 above-core outcome', async () => {
    const registry = await load('api-above-core.ts');
    expect(registry.records[0]).toMatchObject({ status: 'failed', code: 'E147' });
    expect(registry.records[0]?.next_action).toContain('harness update');
  });

  it('freezes the E148 unknown-section outcome', async () => {
    const registry = await load('unknown-section.js');
    expect(registry.records[0]).toMatchObject({ status: 'failed', code: 'E148' });
    expect(registry.records[0]?.error).toContain('monitors');
  });

  it('tolerates an unknown nested field and reports it', async () => {
    const registry = await load('unknown-field.js');
    expect(registry.records[0]?.status).toBe('loaded');
    expect(registry.records[0]?.info).toEqual(
      expect.arrayContaining([expect.stringContaining('verbs.inspect.futureField')]),
    );
  });

  it('activates the frozen Phase-1 sensor declaration through its compatibility wrapper', async () => {
    const registry = await load('sensor-bearing.ts');
    expect(registry.records[0]?.status).toBe('loaded');
    expect(registry.sensors).toMatchObject([{ name: 'lint' }]);
    expect(registry.records[0]?.info).toEqual(
      expect.arrayContaining([expect.stringContaining('compatibility wrapper')]),
    );
    expect(registry.verbs).toEqual([]);
  });

  it('registers a custom item for ctx.registry discovery', async () => {
    const registry = await load('custom-bearing.ts');
    expect(registry.records[0]?.status).toBe('loaded');
    expect(registry.customItems).toMatchObject([{ type: 'migration', name: 'users' }]);
    expect(registry.records[0]?.info?.join('\n') ?? '').not.toContain('handler not yet active');
  });

  it('registers an appended manual-trigger sensor fixture', async () => {
    const registry = await load('manual-sensor.ts');
    expect(registry.records[0]?.status).toBe('loaded');
    expect(registry.sensors).toMatchObject([
      { name: 'audit', declaration: { trigger: 'manual', timeoutMs: 30_000 } },
    ]);
  });

  it('passes an authored multi-line report through v2 validation and normalization', async () => {
    const registry = await load('report-sensor.ts');
    expect(registry.records[0]?.status).toBe('loaded');
    const reading = await registry.sensors[0]?.declaration.run({
      cwd: '/repo',
      exec: async () => {
        throw new Error('fixture does not execute child commands');
      },
    });
    expect(reading).toMatchObject({
      state: 'pass',
      details: '80.7% branch coverage (target 80%)',
      report: 'Statements: 91.1%\nBranches: 80.7%\nUncovered: scheduler.ts:118-124',
    });
  });

  it('rejects an appended invalid sensor fixture with E216', async () => {
    const registry = await load('invalid-sensor.js');
    expect(registry.records[0]).toMatchObject({ status: 'failed', code: 'E216' });
  });
});
