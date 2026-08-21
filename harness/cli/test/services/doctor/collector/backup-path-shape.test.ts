import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../../src/adapters/fs/fake-fs.js';
import {
  backupAgentConfigs,
  storedPathFor,
} from '../../../../src/services/doctor/collector/backup.js';

/**
 * THE BACKUP'S PATH MATH, ON WINDOWS-SHAPED INPUT (plan 083).
 *
 * TWO DEFECTS IN ONE FAMILY, both a POSIX-shaped assumption about what an absolute
 * path looks like, and both reached by the SAME ordinary case: a config that lives
 * outside the home because an env override (`CLAUDE_CONFIG_DIR`, `GEMINI_CLI_HOME`)
 * put it there.
 *
 *   1. `rel.startsWith('/')` decided whether a config path was already absolute. A
 *      logical Windows absolute is `C:/…`, which does not start with `/`, so an
 *      off-home config was anchored ONTO the home and resolved to a path that does
 *      not exist. It was then recorded ABSENT — and absent is a restore INSTRUCTION
 *      meaning *delete this file*.
 *   2. `files/abs/` kept the source verbatim, producing `files/abs/C:/Users/…`. A
 *      `:` is RESERVED in a Windows path segment, so the copy cannot be written
 *      there at all.
 *
 * NO PLATFORM BRANCH AND NO `skipIf`: these are pure functions over logical paths,
 * which are identical on every OS, so a Windows-shaped string is just an input and
 * any host can assert the literal. That is what puts this on the gate that runs on
 * every push instead of on a VM nobody blocks on.
 */
describe('storedPathFor keeps the copy inside the backup on Windows-shaped paths', () => {
  const HOME = 'C:/Users/dev/home';

  it('NEVER emits a drive-letter colon — the segment Windows cannot create', () => {
    /*
    Test Doc:
    - Why: `files/abs/C:/Users/dev/cfg/settings.json` is not a path. `:` is the drive
      separator and NTFS's alternate-data-stream marker, so `mkdirp` either fails or
      resolves `C:` as a drive-relative reference and drops the copy somewhere
      outside the backup entirely — a backup that reports success and holds nothing.
    - Contract: no segment after the namespace prefix contains a colon.
    - Quality Contribution: asserts the CHARACTER CLASS as well as the literal, so
      any future namespace that reintroduces a colon by another route goes red.
    */
    const stored = storedPathFor('C:/Users/dev/cfg__a/settings.json', HOME);
    expect(stored).toBe('files/abs/C/Users/dev/cfg__a/settings.json');
    expect(stored).not.toContain(':');
  });

  it('files a home-relative config under files/home, with a NATIVE home too', () => {
    /*
    Test Doc:
    - Why: the two namespaces are what make the map injective, and picking the wrong
      one puts the copy where restore will not look for it. `home` may still arrive
      native from a caller, so both sides must cross the boundary before comparison.
    - Contract: identical answer for a logical and a native spelling of one home.
    */
    expect(storedPathFor('C:/Users/dev/home/.cursor/hooks.json', HOME)).toBe(
      'files/home/.cursor/hooks.json',
    );
    expect(storedPathFor('C:/Users/dev/home/.cursor/hooks.json', 'C:\\Users\\dev\\home')).toBe(
      'files/home/.cursor/hooks.json',
    );
  });

  it('stays INJECTIVE across the two namespaces and the drive rewrite', () => {
    /*
    Test Doc:
    - Why: the whole reason the namespaces exist. Two sources sharing one stored path
      means the second copy overwrites the first and the restore hands a user the
      wrong file's bytes — the failure mode dw-0003 was written for.
    - Contract: four distinct sources, four distinct stored paths.
    - Quality Contribution: includes the pair the drive rewrite could collapse — an
      off-home `C:/x` and a same-named path under the home.
    */
    const stored = [
      storedPathFor('C:/Users/dev/home/.claude/settings.json', HOME),
      storedPathFor('C:/Users/dev/cfg__a/settings.json', HOME),
      storedPathFor('D:/cfg__a/settings.json', HOME),
      storedPathFor('C:/Users/dev/cfg__a/other.json', HOME),
    ];
    expect(new Set(stored).size).toBe(stored.length);
  });

  it('a POSIX absolute is UNCHANGED — the counter-row', () => {
    /*
    Test Doc:
    - Why: every shipped macOS and Linux backup goes through this function; a Windows
      fix that moved the POSIX answer would trade one platform's defect for another's,
      and would silently invalidate every backup already on disk.
    */
    expect(storedPathFor('/var/tmp/cfg__a/settings.json', '/var/tmp/home')).toBe(
      'files/abs/var/tmp/cfg__a/settings.json',
    );
    expect(storedPathFor('/var/tmp/home/.cursor/hooks.json', '/var/tmp/home')).toBe(
      'files/home/.cursor/hooks.json',
    );
  });
});

describe('an OFF-HOME config is resolved, not anchored onto the home', () => {
  const backupWith = (home: string, envOverrides: Record<string, string>, seed: FakeFs) =>
    backupAgentConfigs({
      fs: seed,
      clock: { nowIso: () => '2026-08-10T00:00:00.000Z', now: () => 0 },
      host: { platform: 'win32', arch: 'x64', home, envOverrides },
    } as never);

  it('COPIES a drive-rooted override instead of recording it ABSENT', () => {
    /*
    Test Doc:
    - Why: this is the whole defect, and its consequence is worse than a missed
      backup. `rel.startsWith('/')` answered FALSE for `C:/…`, so the override path
      was anchored onto the home, resolved to a path that does not exist, and was
      recorded ABSENT. An absent entry is a restore INSTRUCTION meaning *delete this
      file* — so the backup would have told a later restore to remove the user's real
      config, having never copied it.
    - Contract: the drive-rooted override is COPIED, and appears in no absence list.
    - Quality Contribution: asserts `absent` as well as `copied`. Asserting only
      `copied` would pass for a build that copied the file AND still recorded the
      delete instruction, which is the dangerous half.
    */
    const home = 'C:/Users/dev/home';
    const override = 'C:/Users/dev/cfg__a';
    const fs = new FakeFs();
    fs.mkdirp(`${home}/.claude`); // detection marker
    fs.mkdirp(override);
    fs.writeText(`${override}/settings.json`, '{"hooks":{}}\n');

    const backup = backupWith(home, { CLAUDE_CONFIG_DIR: override }, fs);

    expect(backup.failed).toEqual([]);
    expect(backup.copied).toContain(`${override}/settings.json`);
    expect(backup.absent).not.toContain(`${override}/settings.json`);
    expect(backup.absent.some((a) => a.includes('cfg__a'))).toBe(false);
  });

  it('still anchors an ordinary home-RELATIVE key onto the home — the counter-row', () => {
    /*
    Test Doc:
    - Why: the fix must not become "treat everything as absolute". Every config
      without an override arrives as a home-relative key and must still be joined.
    - Contract: `.claude/settings.json` is copied from under the home.
    */
    const home = 'C:/Users/dev/home';
    const fs = new FakeFs();
    fs.mkdirp(`${home}/.claude`);
    fs.writeText(`${home}/.claude/settings.json`, '{"hooks":{}}\n');

    const backup = backupWith(home, {}, fs);

    expect(backup.failed).toEqual([]);
    expect(backup.copied).toContain('.claude/settings.json');
  });
});
