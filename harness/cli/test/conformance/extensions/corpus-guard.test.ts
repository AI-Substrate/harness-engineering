import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const corpus = join(dirname(fileURLToPath(import.meta.url)), 'api-2');

/** Existing entries are immutable. Future api-2 fixtures are appended, never substituted. */
const FROZEN_API_2: Readonly<Record<string, string>> = {
  'api-above-core.ts': 'e3a9f936bb40d424a3a79499334e5f4a4fb965814e7a2a9bcb4dd567813636ab',
  'bare-literal.js': 'ccc9178abb9d244706cbb7af784ea71b96846d8ca6880d66ee2ba2b9ae96b53b',
  'custom-bearing.ts': '44182df4c1376039f15b7009725c30dc1b83dca408da45d25ce91e66ed4d39ce',
  'factory.ts': '23da27816ba260ac874cac1dde578ecc612645bab055d57927884d9d560c1b4f',
  'mixed.ts': '0d0b64f192f12bb3a1767192a07d21232595bd0a12c21f1b8beb3995219a59d7',
  'sensor-bearing.ts': '07d83387ebd98b9054e6333d511a3f37d025a6fa8786b50b86e0e75f5ccf1eb0',
  'subverbs.ts': '90231cd9cd64f50db7f632eeebd5bda74cd997f495985915d57be100c3b8aa86',
  'unknown-field.js': '694929379e1576db7a690a02f736fef103d730dbb38f0499f127d36fd58ac693',
  'unknown-section.js': '1115ac630ff2e281cf865570c9f9636707abb0bb0150376aacae540f5df8b082',
  'manual-sensor.ts': 'c70fd818aac1511acc9db0ad8571e9934d5b4ce470b38006bf844cf841cb2d44',
  'invalid-sensor.js': '904b4a89e7b81e3902389a7c40abecc492136a0e8e4862dd1262d94f56c1ca8a',
  'report-sensor.ts': '93f331aef688c7b666da45c24c588c9195e5f27711a8e302764e1c90b9fa15a8',
};

type CorpusReader = (name: string) => Uint8Array;

function digest(contents: Uint8Array): string {
  return createHash('sha256').update(contents).digest('hex');
}

function frozenDrift(read: CorpusReader): string[] {
  const drift: string[] = [];
  for (const [name, expected] of Object.entries(FROZEN_API_2)) {
    try {
      const actual = digest(read(name));
      if (actual !== expected) drift.push(`${name}: ${expected} -> ${actual}`);
    } catch {
      drift.push(`${name}: missing`);
    }
  }
  return drift;
}

const diskReader: CorpusReader = (name) => readFileSync(join(corpus, name));

describe('api-2 conformance corpus append-only guard', () => {
  it('keeps every shipped fixture byte-for-byte frozen', () => {
    expect(frozenDrift(diskReader)).toEqual([]);
  });

  it('freezes every fixture shipped in the api-2 corpus directory', () => {
    const shipped = readdirSync(corpus)
      .filter((name) => name.endsWith('.ts') || name.endsWith('.js'))
      .sort();
    expect(Object.keys(FROZEN_API_2).sort()).toEqual(shipped);
  });

  it('detects an edit to any existing fixture', () => {
    const changed: CorpusReader = (name) =>
      name === 'factory.ts'
        ? Buffer.concat([diskReader(name), Buffer.from('// edited\n')])
        : diskReader(name);
    expect(frozenDrift(changed)).toEqual([
      expect.stringMatching(/^factory\.ts: [a-f0-9]{64} -> [a-f0-9]{64}$/),
    ]);
  });

  it('allows append-only additions without changing an existing hash', () => {
    const appended = new Map<string, Uint8Array>([
      ...Object.keys(FROZEN_API_2).map((name) => [name, diskReader(name)] as const),
      ['future-addition.ts', Buffer.from('export default {};\n')],
    ]);
    expect(appended.has('future-addition.ts')).toBe(true);
    expect(
      frozenDrift((name) => {
        const contents = appended.get(name);
        if (contents === undefined) throw new Error('missing');
        return contents;
      }),
    ).toEqual([]);
  });
});
