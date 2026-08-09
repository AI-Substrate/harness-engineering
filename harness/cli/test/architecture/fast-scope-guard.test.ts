import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SLOW_TESTS } from '../../vitest.config.js';

/**
 * The fast scope's own guard.
 *
 * The fast/slow split buys its speed by NOT running things, which makes it the
 * kind of mechanism that decays silently: a path in `SLOW_TESTS` that no longer
 * exists excludes nothing, and nobody finds out, because the symptom of a stale
 * exclusion is a suite that still passes.
 *
 * It deliberately does NOT assert wall-clock times. Every timing behind this
 * split was taken on a box whose load moved the same file 1.4x run to run, so a
 * duration threshold would be a flake generator — and a flaky guard gets
 * deleted, which costs more than it ever caught. Composition is checkable;
 * speed on shared hardware is not.
 */
const CLI_ROOT = path.resolve(__dirname, '../..');

describe('fast-scope guard', () => {
  it('every SLOW_TESTS entry names a file that exists', () => {
    // A stale entry silently stops excluding anything, and the fast scope grows
    // back toward the full suite with no failure anywhere to announce it.
    const missing = SLOW_TESTS.filter((rel) => !existsSync(path.join(CLI_ROOT, rel)));
    expect(
      missing,
      `SLOW_TESTS names ${missing.length} file(s) that no longer exist. A stale entry excludes ` +
        'nothing, so the fast scope silently gets slower. Update SLOW_TESTS in ' +
        'harness/cli/vitest.config.ts — delete the entry, or fix the path if the file moved.',
    ).toEqual([]);
  });

  it('has no duplicate entries', () => {
    const dupes = SLOW_TESTS.filter((v, i) => SLOW_TESTS.indexOf(v) !== i);
    expect(dupes, `SLOW_TESTS contains duplicate entries: ${dupes.join(', ')}`).toEqual([]);
  });

  it('every entry is a file the default include would actually have collected', () => {
    // The banner reports SLOW_TESTS.length as "12 slow file(s) SKIPPED", so the
    // list IS the denominator shown to a human. An entry that exists but was
    // never in the suite's population (wrong dir, wrong suffix) would be counted
    // as "skipped" while excluding nothing — a denominator that counts the wrong
    // population, which is a more confident way of being wrong than saying
    // nothing. Ties the list to `include: ['test/**/*.test.ts', …]`.
    const stray = SLOW_TESTS.filter((p) => !(p.startsWith('test/') && p.endsWith('.test.ts')));
    expect(
      stray,
      `SLOW_TESTS entries that the default include would never have collected, so excluding them ` +
        `skips nothing while still being counted in the banner: ${stray.join(', ')}`,
    ).toEqual([]);
  });

  it('does not exclude this guard itself', () => {
    // In the slow set, the guard would stop running in the fast scope — i.e.
    // exactly the scope it exists to protect.
    expect(
      SLOW_TESTS.includes('test/architecture/fast-scope-guard.test.ts'),
      'The fast-scope guard must never be in SLOW_TESTS — it would stop guarding the scope it guards.',
    ).toBe(false);
  });
});
