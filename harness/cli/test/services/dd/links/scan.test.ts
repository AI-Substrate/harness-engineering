import { describe, expect, it } from 'vitest';
import { DD_SUFFIX, scanCorpus } from '../../../../src/services/dd/links/scan.js';
import type { SchemaFs } from '../../../../src/services/dd/schema/model.js';
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

  it('skips the harness scratch directory by POSITION, not by name', () => {
    // The distinction the constant exists for: `temp` is an ordinary word, and a
    // source tree may hold a real one. Only `.harness/temp` is scratch.
    const { paths } = scan();
    expect(paths).not.toContain(`${REPO}/.harness/temp/scratch.dd.json`);
    expect(paths).toContain(`${REPO}/docs/temp/kept.dd.json`);
    expect(paths).toContain(`${REPO}/docs/temp-utils/kept.dd.json`);
  });

  it('yields to an EXPLICIT root inside the scratch directory (OD-1 symmetry)', () => {
    // Pointing the sweep into scratch is saying what you mean, exactly as
    // pointing `dd validate` at a known-bad fixture is.
    const { paths } = scanCorpus(new FixtureFs(), `${REPO}/.harness/temp`);
    expect(paths).toEqual([`${REPO}/.harness/temp/scratch.dd.json`]);
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
