import { describe, expect, it } from 'vitest';
import type { SchemaFs } from '../../../../src/services/dd/schema/model.js';
import { DD_SUFFIX, scanCorpus } from '../../../../src/services/dd/links/scan.js';
import { FixtureFs, REPO } from './helpers.js';

describe('dd links corpus scan', () => {
  const scan = () => scanCorpus(new FixtureFs(), REPO);

  it('enumerates every dd document beneath the root, sorted', () => {
    const { paths, issues } = scan();
    expect(issues).toEqual([]);
    expect(paths.every((path) => path.endsWith(DD_SUFFIX))).toBe(true);
    expect([...paths].sort()).toEqual(paths);
    expect(paths.length).toBeGreaterThanOrEqual(23);
  });

  it('recurses into subfolders and enumerates nothing else', () => {
    const { paths } = scan();
    expect(paths).toContain(`${REPO}/docs/nested/child.dd.json`);
    expect(paths).toContain(`${REPO}/docs/plan.dd.json`);
    expect(paths.some((path) => path.endsWith('notes.md'))).toBe(false);
  });

  it('prunes skip-listed directories', () => {
    const { paths } = scan();
    expect(paths.some((path) => path.includes('node_modules'))).toBe(false);
  });

  it('reports a discovery failure instead of an empty corpus', () => {
    // The distinction P2 F002 paid for: a port that cannot look must not be read
    // as a root that holds nothing.
    const failing: SchemaFs = {
      readdir() {
        const error = new Error('ELOOP: too many symbolic links') as NodeJS.ErrnoException;
        error.code = 'ELOOP';
        throw error;
      },
      exists: () => true,
      readText: () => null,
    };
    const { paths, issues } = scanCorpus(failing, REPO);
    expect(paths).toEqual([]);
    expect(issues).toEqual([
      expect.objectContaining({ class: 'link-scan-failed', severity: 'ERROR' }),
    ]);
    expect(issues[0]?.message).toContain('ELOOP');
  });
});
