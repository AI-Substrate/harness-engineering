import { describe, expect, it } from 'vitest';
import type { ExtensionDefinition } from '../../src/services/extensions/contract.js';
import { gateExtensionDefinition } from '../../src/services/extensions/v2/api-gate.js';
import { normalizeV2Extension } from '../../src/services/extensions/v2/normalize.js';
import { validateV2Extension } from '../../src/services/extensions/v2/validate.js';

const base = {
  kind: 'extension' as const,
  name: 'sample',
  summary: 'Sample extension',
};

const futureVocabulary = {
  2: ['verbs', 'sensors', 'records', 'custom'],
  3: ['workflows'],
} as const;

describe('v2 api gate', () => {
  it('fails an extension above the core api with E147 and an update action', () => {
    const result = gateExtensionDefinition({ ...base, api: 3 });
    expect(result).toMatchObject({ ok: false, code: 'E147' });
    if (!result.ok) {
      expect(result.message).toContain('api 3');
      expect(result.next_action).toContain('harness update');
    }
  });

  it('fails an unknown top-level section with E148 rather than silently dropping it', () => {
    const result = gateExtensionDefinition({ ...base, monitors: { drift: {} } });
    expect(result).toMatchObject({ ok: false, code: 'E148' });
    if (!result.ok) {
      expect(result.message).toContain('monitors');
      expect(result.next_action).toContain('declare the api level');
    }
  });

  it('keeps an omitted declaration at api 2 when the running core is api 3', () => {
    const result = gateExtensionDefinition(base, {
      coreApi: 3,
      vocabulary: futureVocabulary,
    });

    expect(result).toMatchObject({ ok: true, api: 2, info: [] });
    if (!result.ok) throw new Error('expected omitted api to load');
    expect(
      normalizeV2Extension('/repo/.harness/extensions/sample/extension.ts', base, result.info),
    ).toMatchObject({ api: 2 });
  });

  it('loads an api-2 declaration using a core-3-known section and advises an api bump', () => {
    const definition = {
      ...base,
      api: 2,
      workflows: { release: { summary: 'Release' } },
    } as ExtensionDefinition;
    const result = gateExtensionDefinition(definition, {
      coreApi: 3,
      vocabulary: futureVocabulary,
    });

    expect(result).toMatchObject({ ok: true, api: 2 });
    if (!result.ok) throw new Error('expected core-known section to load');
    expect(result.info).toEqual([
      expect.stringMatching(/workflows.*introduced in api 3.*bump `api` from 2 to 3/),
    ]);
  });

  it('rejects an api-3 declaration when the running core is api 2', () => {
    const result = gateExtensionDefinition(
      { ...base, api: 3 },
      { coreApi: 2, vocabulary: futureVocabulary },
    );
    expect(result).toMatchObject({ ok: false, code: 'E147' });
  });
});

describe('v2 tolerant fields and typed item sections', () => {
  it('tolerates an unknown field inside a known verb structure and reports doctor info', () => {
    const result = validateV2Extension({
      ...base,
      verbs: {
        build: {
          summary: 'Build',
          run: () => ({ status: 'ok' as const }),
          futureField: true,
        },
      },
    });
    expect(result.issues).toEqual([]);
    expect(result.info.join('\n')).toContain('verbs.build.futureField');
    expect(result.info.join('\n')).toContain('tolerated');
  });

  it('rejects an empty keyed record type', () => {
    const result = validateV2Extension({
      ...base,
      records: {
        '': { description: 'Invalid record', template: '---\nrecord_type: invalid\n---\n' },
      },
    });
    expect(result.issues).toContain('records has an empty type key');
  });

  it('validates active sensors and reports an empty watch list as never watch-fired', () => {
    const result = validateV2Extension({
      ...base,
      sensors: {
        lint: { summary: 'Lint sensor', watch: [], run: () => ({ state: 'pass' }) },
      },
      custom: { migration: { users: { summary: 'Migrate users', order: 1 } } },
    });
    expect(result.issues).toEqual([]);
    expect(result.info).toEqual(
      expect.arrayContaining([expect.stringContaining('never watch-fired')]),
    );
    expect(result.info.join('\n')).not.toContain('handler not yet active');
  });

  it('rejects nested subverbs beyond one level while allowing v2 variadics', () => {
    const result = validateV2Extension({
      ...base,
      verbs: {
        files: {
          summary: 'Files',
          sub: {
            print: {
              summary: 'Print files',
              args: [{ name: '<files...>', description: 'Files to print' }],
              run: () => ({ status: 'ok' as const }),
              sub: { illegal: { summary: 'Too deep' } },
            },
          },
        },
      },
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('one level');
    expect(result.issues.join('\n')).not.toContain('variadic');
  });
});
