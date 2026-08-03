import { describe, expect, it } from 'vitest';
import type { DdDoc } from '../../../../src/services/dd/core/model.js';
import {
  type DocLoader,
  type DocLoadResult,
  shouldExcludeFromSweep,
  validateWalk,
} from '../../../../src/services/dd/core/walk.js';
import { FixtureSchemaResolver, fixtureDoc } from '../helpers.js';

const SHA_BY_NAME: Record<string, string> = {
  'chain-a.dd.json': 'sha-a',
  'chain-b.dd.json': 'sha-b',
  'chain-c.dd.json': 'sha-c',
  'chain-d-invalid.dd.json': 'sha-d-invalid',
  'cycle-a.dd.json': 'sha-cycle-a',
  'cycle-b.dd.json': 'sha-cycle-b',
  'untracked.dd.json': 'sha-untracked',
};

class FixtureDocLoader implements DocLoader {
  readonly calls: string[] = [];

  load(path: string): DocLoadResult {
    this.calls.push(path);
    const name = path.split('/').at(-1);
    const sha = name ? SHA_BY_NAME[name] : undefined;
    if (!name || name === 'missing.dd.json' || !sha) {
      return { ok: false, path, reason: 'missing', message: `missing: ${path}` };
    }
    const folder = name.startsWith('chain-') || name.startsWith('cycle-') ? 'graph' : 'warn';
    return {
      ok: true,
      path,
      doc: fixtureDoc(`${folder}/${name}`),
      sha,
      tracked: name !== 'untracked.dd.json',
    };
  }
}

const resolver = new FixtureSchemaResolver();

function walk(relative: string, depth: number, loader = new FixtureDocLoader()) {
  return {
    loader,
    issues: validateWalk(
      fixtureDoc(relative),
      `/repo/${relative}`,
      { schemaResolver: resolver, docLoader: loader },
      { repoRoot: '/repo', depth, mode: 'direct' },
    ),
  };
}

describe('dd-core validate walk', () => {
  it('distinguishes depth 2 from depth 3 on the three-hop chain', () => {
    const depth2 = walk('graph/chain-a.dd.json', 2).issues;
    const depth3 = walk('graph/chain-a.dd.json', 3).issues;
    expect(depth2).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          class: 'basis-stale',
          owner: '/repo/graph/chain-b.dd.json',
        }),
      ]),
    );
    expect(depth2.some((issue) => issue.owner.endsWith('chain-d-invalid.dd.json'))).toBe(false);
    expect(depth3).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          class: 'enum-invalid',
          owner: '/repo/graph/chain-d-invalid.dd.json',
        }),
      ]),
    );
  });

  it('terminates a cyclic graph at infinite radius', () => {
    const { issues, loader } = walk('graph/cycle-a.dd.json', Number.POSITIVE_INFINITY);
    expect(issues.filter((issue) => issue.severity === 'ERROR')).toEqual([]);
    expect(loader.calls).toHaveLength(2);
  });

  it.each([
    ['warn/untracked-target.dd.json', 'address-target-untracked'],
    ['warn/missing-target.dd.json', 'address-target-missing'],
  ] as const)('%s maps target state to WARN class %s', (relative, issueClass) => {
    const result = walk(relative, 1).issues;
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ class: issueClass, severity: 'WARN' })]),
    );
    expect(result.some((issue) => issue.class === issueClass && issue.severity === 'ERROR')).toBe(
      false,
    );
  });

  it('skips test fixture roots and sweep_exclude docs only in sweep mode', () => {
    const excluded = fixtureDoc('excluded/sweep-excluded.dd.json');
    const path = '/repo/test/services/dd/fixtures/excluded/sweep-excluded.dd.json';
    expect(shouldExcludeFromSweep(path, excluded)).toBe(true);
    expect(
      validateWalk(
        excluded,
        path,
        { schemaResolver: resolver, docLoader: new FixtureDocLoader() },
        { repoRoot: '/repo', depth: 0, mode: 'sweep' },
      ),
    ).toEqual([]);
    expect(
      validateWalk(
        excluded,
        path,
        { schemaResolver: resolver, docLoader: new FixtureDocLoader() },
        { repoRoot: '/repo', depth: 0, mode: 'direct' },
      ),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ class: 'enum-invalid' })]));
  });

  it('honours sweep_exclude outside fixture paths while direct invocation still validates', () => {
    const excluded: DdDoc = {
      ...fixtureDoc('invalid/bad-enum.dd.json'),
      dd: { schema: 'test/plan', sweep_exclude: true },
    };
    expect(shouldExcludeFromSweep('/repo/docs/excluded.dd.json', excluded)).toBe(true);
    expect(
      validateWalk(
        excluded,
        '/repo/docs/excluded.dd.json',
        { schemaResolver: resolver, docLoader: new FixtureDocLoader() },
        { repoRoot: '/repo', depth: 0, mode: 'sweep' },
      ),
    ).toEqual([]);
    expect(
      validateWalk(
        excluded,
        '/repo/docs/excluded.dd.json',
        { schemaResolver: resolver, docLoader: new FixtureDocLoader() },
        { repoRoot: '/repo', depth: 0, mode: 'direct' },
      ),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ class: 'enum-invalid' })]));
  });
});
