import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

function cases(): string[] {
  return readdirSync(FIXTURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function filesUnder(relativeDir: string): string[] {
  return readdirSync(`${FIXTURES}${relativeDir}`, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${relativeDir}${entry.name}`;
    return entry.isDirectory() ? filesUnder(`${relative}/`) : [relative];
  });
}

describe('dd schema fixture corpus', () => {
  it('enumerates one world per resolution case, every file real and parseable', () => {
    expect(cases()).toEqual([
      'beyond-cap',
      'chain',
      'custom-enum',
      'deep-scan',
      'duplicate-in-root',
      'exemplar',
      'invalid-enum',
      'malformed-package',
      'precedence-chain',
      'single-root',
      'unsupported-version',
    ]);
    for (const file of filesUnder('')) {
      if (!file.endsWith('.json')) continue;
      expect(() => JSON.parse(readFileSync(`${FIXTURES}${file}`, 'utf8'))).not.toThrow();
    }
  });

  it('covers every schema-layer failure class with a bad case and a good twin', () => {
    const readme = readFileSync(`${FIXTURES}README.md`, 'utf8');
    for (const code of ['E410', 'E411', 'E412', 'E413', 'E414', 'E415', 'E416', 'E417']) {
      expect(readme).toContain(`| ${code} |`);
    }
    for (const world of cases()) {
      expect(readme).toContain(world);
    }
  });

  it('lays the precedence chain across all four roots with distinguishable copies', () => {
    const roots = [
      'repo/docs/schemas',
      'repo/.dd/schemas',
      'repo/.harness/.dd/schemas',
      'home/.dd/schemas',
    ];
    const descriptions = roots.map((root) => {
      const raw = readFileSync(
        `${FIXTURES}precedence-chain/${root}/builder/plan/schema.json`,
        'utf8',
      );
      return (JSON.parse(raw) as { description: string }).description;
    });
    expect(new Set(descriptions).size).toBe(4);
  });
});
