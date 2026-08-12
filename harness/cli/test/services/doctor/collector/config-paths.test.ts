import { describe, expect, it } from 'vitest';
import { AGENT_MARKERS, configPathsFor } from '../../../../src/services/doctor/collector/agents.js';

/**
 * THE HOME-RELATIVE CONFIG KEY, ON BOTH PATH SHAPES (plan 083).
 *
 * `configPathsFor` returns KEYS, not paths to use. They are unioned through a
 * `Set` with `AGENT_MARKERS[].configs` — logical, forward-slashed literals like
 * `.cursor/hooks.json` — and the result drives the backup copy list and the
 * evidence digest.
 *
 * THE DEFECT THIS FILE WAS WRITTEN FOR was invisible because it was CORRECT BY
 * COINCIDENCE. The strip asked `abs.startsWith(`${home}/`)` with a hard-coded
 * forward slash, and it worked on Windows only because the resolver happened to
 * emit a mixed `C:\Users\dev/.cursor/hooks.json`. The moment that resolver was
 * fixed to emit a native path — the correct fix — this strip would have fallen
 * through and returned an ABSOLUTE path where a home-relative key was expected.
 * Two spellings of one file then enter the set: the backup copies it twice, and
 * the digest reports a file with no second copy on disk.
 *
 * NO PLATFORM BRANCH AND NO `skipIf`, because there is nothing to branch on: a
 * logical path is the SAME on every OS by design, so a Windows-shaped `home` is
 * just an input and any host can assert the exact literal. That is what makes this
 * runnable on the gate that runs on every push, rather than on a VM nobody blocks
 * on — the defect class this whole plan exists to remove.
 */

const marker = (id: string) => {
  const found = AGENT_MARKERS.find((m) => m.id === id);
  if (found === undefined) throw new Error(`${id} missing from AGENT_MARKERS`);
  return found;
};

describe('configPathsFor returns HOME-RELATIVE, forward-slashed keys on every platform', () => {
  it('strips a NATIVE (Windows-shaped) home prefix and emits a logical key', () => {
    /*
    Test Doc:
    - Why: on Windows both sides of the strip are backslashed. A forward-slash-only
      comparison fails, and the fall-through is silent — an absolute path is a
      perfectly good string, it just is not the key anyone downstream expects.
    - Contract: the key is `.cursor/hooks.json`, identical to the POSIX answer and
      to the literal in AGENT_MARKERS.
    - Quality Contribution: asserts the exact key rather than "is relative", so a
      strip that returned `.cursor\hooks.json` — relative, and still a second
      spelling in the Set — goes red.
    */
    expect(configPathsFor(marker('cursor'), 'C:\\Users\\dev', {})).toEqual(['.cursor/hooks.json']);
  });

  it('DEDUPES against the literal table rather than adding a second spelling', () => {
    /*
    Test Doc:
    - Why: this is the consequence the strip actually has. `windsurf` declares both
      of its files in AGENT_MARKERS AND resolves both through the matrix, so a
      mis-shaped key does not look like an error — it looks like four files.
    - Contract: two entries, not four.
    */
    const paths = configPathsFor(marker('windsurf'), 'C:\\Users\\dev', {});
    expect(paths).toEqual(['.codeium/hooks.json', '.codeium/windsurf/hooks.json']);
  });

  it('a POSIX home is unchanged — the counter-row', () => {
    /*
    Test Doc:
    - Why: every shipped macOS and Linux install resolves through this function; a
      Windows fix that moved the POSIX answer would be a regression traded for a fix.
    */
    expect(configPathsFor(marker('cursor'), '/home/dev', {})).toEqual(['.cursor/hooks.json']);
    expect(configPathsFor(marker('windsurf'), '/home/dev', {})).toEqual([
      '.codeium/hooks.json',
      '.codeium/windsurf/hooks.json',
    ]);
  });

  it('an override pointing OUTSIDE the home stays absolute — the honest fall-through', () => {
    /*
    Test Doc:
    - Why: the fall-through branch is not dead code, and it must stay reachable. A
      config moved to another drive has no home-relative spelling, and inventing one
      would be worse than returning the absolute path.
    - Contract: a `D:` config under a `C:` home comes back absolute, in logical
      shape so it is still one spelling.
    */
    expect(
      configPathsFor(marker('claude'), 'C:\\Users\\dev', { CLAUDE_CONFIG_DIR: 'D:\\cfg' }),
    ).toEqual(['.claude/settings.json', 'D:/cfg/settings.json']);
  });
});
