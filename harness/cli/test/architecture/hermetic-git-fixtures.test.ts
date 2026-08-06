import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
Test Doc:
- Why: P2 of the plan 073 phase-1 review. Two separate machine-level
  contaminations (ambient `GIT_CONFIG_*`, and git-ai's global
  `trace2.eventTarget`) reached this suite, and BOTH were fixed one fixture at a
  time. That is the actual defect: hermeticity had to be opted into, so every new
  real-git fixture was exposed again until someone noticed.
- Contract: the trace2 disables are declared ONCE for the whole run in
  `vitest.config.ts` — so a fixture written tomorrow inherits them without
  knowing they exist — and the only other definition of those keys is the shared
  helper `test/support/hermetic-git.ts`.
- Quality: this is a structural control, not a behaviour test. It fails when
  someone copy-pastes a trace2 disable into a fixture (the pattern that let the
  class of bug recur) or deletes the run-wide default (which would silently
  re-expose all eleven real-git fixtures at once).
*/

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..');
const TEST_ROOT = join(CLI_ROOT, 'test');
const SHARED_HELPER = join(TEST_ROOT, 'support', 'hermetic-git.ts');

const TRACE2_KEYS = ['GIT_TRACE2', 'GIT_TRACE2_EVENT', 'GIT_TRACE2_PERF'] as const;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile() && path.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('real-git fixtures are hermetic by inheritance, not by memory', () => {
  it('declares the trace2 disables ONCE for the whole run in vitest.config.ts', () => {
    // Delete this and every real-git fixture in the suite is re-exposed to an
    // installed git-ai daemon at once — silently, and only under load.
    const config = readFileSync(join(CLI_ROOT, 'vitest.config.ts'), 'utf8');
    for (const key of TRACE2_KEYS) {
      expect(config).toMatch(new RegExp(`${key}:\\s*'0'`));
    }
  });

  it('keeps the shared helper as the only OTHER place those keys are set', () => {
    // A copy-pasted disable is how this bug class survived: each fixture that
    // opted in looked fixed, and the next one written was not.
    const offenders = walk(TEST_ROOT)
      .filter((path) => path !== SHARED_HELPER)
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return TRACE2_KEYS.some((key) => new RegExp(`${key}\\s*[:=]`).test(source));
      })
      .map((path) => relative(CLI_ROOT, path));

    expect(offenders).toEqual([]);
  });

  it('offers global-config isolation from the shared helper, on by default', () => {
    const helper = readFileSync(SHARED_HELPER, 'utf8');

    expect(helper).toContain('GIT_CONFIG_GLOBAL');
    expect(helper).toContain('GIT_CONFIG_NOSYSTEM');
    // Opt-OUT, not opt-in: a fixture must say so explicitly to keep the
    // developer's global config in play, and only one currently does (it
    // exercises global-config handling as its subject).
    expect(helper).toContain('isolateGlobalConfig !== false');
  });

  it('the named disposable-repo fixtures route their git through the shared helper', () => {
    // The four the reviewer identified. New fixtures are covered by the run-wide
    // default above; these four additionally need config isolation, so they are
    // named rather than detected.
    const fixtures = [
      'test/adapters/git/exec-remote-telemetry-git.int.test.ts',
      'test/adapters/git/fake-git.test.ts',
      'test/adapters/git/cat-file-batch.int.test.ts',
      'test/services/telemetry/git-read.test.ts',
    ];
    for (const fixture of fixtures) {
      const source = readFileSync(join(CLI_ROOT, fixture), 'utf8');
      expect(source, `${fixture} must import the shared hermetic git env`).toContain(
        'support/hermetic-git.js',
      );
    }
  });
});
