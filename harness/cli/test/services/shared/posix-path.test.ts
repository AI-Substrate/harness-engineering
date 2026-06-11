import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dedupeKey,
  IS_WIN32,
  isWithin,
  posixDirname,
  posixJoin,
  posixNormalize,
  posixRelative,
  toPosix,
} from '../../../src/services/shared/posix-path.js';

/*
Test Doc:

The Phase-0 sensor for "logical paths are POSIX on every OS" (plan 017 T001).
These tests are written with Windows-shaped STRING inputs and run on every OS —
they are the deterministic replacement for a Windows CI executor (spec AC-3/AC-8).

Pinned hazards (plan 017 Findings 03/04 + validate-v2):
- `posix.resolve` must never touch logical paths: a drive-letter path
  (`C:/repo`) does not start with `/`, so resolve would treat it as RELATIVE
  and prepend the host cwd, silently corrupting keys. The helper exposes
  normalize/join-based forms only.
- Node's `posix.normalize` collapses a leading `//` (`//server/share` →
  `/server/share`) — empirically pinned below — so every normalize-based
  helper op must guard/reattach the UNC root.
- Case-folding is an EXPLICIT parameter (`dedupeKey(p, caseInsensitive)`),
  defaulting from the module-level `IS_WIN32` constant. Tests pass it both
  ways explicitly — no patched `process.platform` (constitution P3).
*/

describe('toPosix', () => {
  it('converts backslashes to forward slashes', () => {
    expect(toPosix('C:\\repo\\.harness\\extensions')).toBe('C:/repo/.harness/extensions');
  });

  it('upper-cases a lower-case drive letter (backslash form)', () => {
    expect(toPosix('c:\\repo')).toBe('C:/repo');
  });

  it('upper-cases a lower-case drive letter (already forward-slash form)', () => {
    expect(toPosix('c:/repo')).toBe('C:/repo');
  });

  it('converts a UNC root to the //server/share form', () => {
    expect(toPosix('\\\\server\\share\\repo')).toBe('//server/share/repo');
  });

  it('handles mixed separators in one path', () => {
    expect(toPosix('C:\\repo/.harness\\extensions/hello')).toBe(
      'C:/repo/.harness/extensions/hello',
    );
  });

  it('leaves POSIX absolute paths untouched', () => {
    expect(toPosix('/repo/.harness/extensions')).toBe('/repo/.harness/extensions');
  });

  it('leaves relative POSIX paths untouched', () => {
    expect(toPosix('.harness/extensions')).toBe('.harness/extensions');
  });
});

describe('posixNormalize (UNC-guarded)', () => {
  it('pins the raw Node hazard: posix.normalize collapses a leading //', () => {
    // The empirical fact that makes the guard necessary (validate-v2 pin).
    expect(posix.normalize('//server/share')).toBe('/server/share');
  });

  it('preserves the UNC root where raw posix.normalize would collapse it', () => {
    expect(posixNormalize('//server/share')).toBe('//server/share');
  });

  it('preserves the UNC root through .. collapsing', () => {
    expect(posixNormalize('//server/share/repo/../repo2')).toBe('//server/share/repo2');
  });

  it('normalizes drive-letter paths lexically (no host-cwd prepending)', () => {
    expect(posixNormalize('C:/repo/ext/../x.ts')).toBe('C:/repo/x.ts');
  });

  it('leaves a plain absolute POSIX path stable', () => {
    expect(posixNormalize('/repo/a/./b')).toBe('/repo/a/b');
  });
});

describe('posixJoin', () => {
  it('joins in POSIX space', () => {
    expect(posixJoin('/repo', '.harness', 'extensions')).toBe('/repo/.harness/extensions');
  });

  it('joins drive-letter bases without corrupting them', () => {
    expect(posixJoin('C:/repo', '.harness', 'extensions')).toBe('C:/repo/.harness/extensions');
  });

  it('converts Windows-shaped segments on the way in', () => {
    expect(posixJoin('C:\\repo', '.harness\\extensions', 'hello')).toBe(
      'C:/repo/.harness/extensions/hello',
    );
  });

  it('preserves the UNC root through a join', () => {
    expect(posixJoin('//server/share', 'repo', '.harness')).toBe('//server/share/repo/.harness');
  });
});

describe('posixDirname', () => {
  it('returns the POSIX parent of a drive-letter path', () => {
    expect(posixDirname('C:/repo/ext/extension.ts')).toBe('C:/repo/ext');
  });

  it('converts Windows-shaped input before taking dirname', () => {
    expect(posixDirname('C:\\repo\\ext\\extension.ts')).toBe('C:/repo/ext');
  });

  it('preserves the UNC root through dirname', () => {
    expect(posixDirname('//server/share/ext/extension.ts')).toBe('//server/share/ext');
  });
});

describe('posixRelative', () => {
  it('computes repo-internal relatives for drive-letter paths', () => {
    expect(posixRelative('C:/repo', 'C:/repo/.harness/extensions/hello/extension.ts')).toBe(
      '.harness/extensions/hello/extension.ts',
    );
  });

  it('signals an escape with a leading ..', () => {
    expect(posixRelative('C:/repo/ext', 'C:/repo/other')).toBe('../other');
  });

  it('converts Windows-shaped inputs before comparing', () => {
    expect(posixRelative('C:\\repo', 'C:\\repo\\.harness\\records\\note.md')).toBe(
      '.harness/records/note.md',
    );
  });
});

describe('isWithin', () => {
  it('accepts a direct child', () => {
    expect(isWithin('/repo/ext/a', '/repo/ext/a/extension.ts')).toBe(true);
  });

  it('accepts the directory itself', () => {
    expect(isWithin('/repo/ext/a', '/repo/ext/a')).toBe(true);
  });

  it('rejects a ../ traversal escape', () => {
    expect(isWithin('/repo/ext/a', '/repo/ext/a/../escape.ts')).toBe(false);
  });

  it('rejects the bare parent', () => {
    expect(isWithin('/repo/ext/a', '/repo/ext')).toBe(false);
  });

  it('rejects a sibling', () => {
    expect(isWithin('/repo/ext/a', '/repo/ext/b/entry.ts')).toBe(false);
  });

  it('accepts drive-letter descendants without host-cwd corruption', () => {
    expect(isWithin('C:/repo/ext/a', 'C:/repo/ext/a/sub/entry.ts')).toBe(true);
  });

  it('rejects drive-letter escapes', () => {
    expect(isWithin('C:/repo/ext/a', 'C:/repo/ext/b/entry.ts')).toBe(false);
  });

  it('accepts Windows-shaped (backslash) inputs', () => {
    expect(isWithin('C:\\repo\\ext\\a', 'C:\\repo\\ext\\a\\extension.ts')).toBe(true);
  });

  it('rejects Windows-shaped traversal escapes', () => {
    expect(isWithin('C:\\repo\\ext\\a', 'C:\\repo\\ext\\a\\..\\escape.ts')).toBe(false);
  });

  it('rejects an unrelated absolute path', () => {
    expect(isWithin('/repo/ext/a', '/etc/passwd')).toBe(false);
  });

  it('accepts UNC descendants', () => {
    expect(isWithin('//server/share/ext/a', '//server/share/ext/a/extension.ts')).toBe(true);
  });

  it('rejects UNC traversal escapes', () => {
    expect(isWithin('//server/share/ext/a', '//server/share/ext/a/../escape.ts')).toBe(false);
  });

  it('rejects a UNC-vs-single-slash root-kind mismatch (either direction)', () => {
    // Without the root-kind guard, relative() collapses '//' and conflates
    // the two trees (companion F001).
    expect(isWithin('//server/share/a', '/server/share/a/x.ts')).toBe(false);
    expect(isWithin('/server/share/a', '//server/share/a/x.ts')).toBe(false);
  });
});

describe('dedupeKey', () => {
  it('normalizes separators and dot segments (case-sensitive)', () => {
    expect(dedupeKey('C:\\repo\\ext\\..\\X.ts', false)).toBe('C:/repo/X.ts');
  });

  it('preserves case when caseInsensitive is false', () => {
    expect(dedupeKey('C:/repo/X.ts', false)).not.toBe(dedupeKey('C:/repo/x.ts', false));
  });

  it('folds case when caseInsensitive is true', () => {
    expect(dedupeKey('c:\\repo\\A.ts', true)).toBe(dedupeKey('C:/REPO/a.ts', true));
  });

  it('keys equal exactly when only separators differ', () => {
    expect(dedupeKey('C:\\repo\\a.ts', false)).toBe(dedupeKey('C:/repo/a.ts', false));
  });

  it('defaults the case-folding parameter from IS_WIN32', () => {
    const p = 'C:/Repo/Mixed.ts';
    expect(dedupeKey(p)).toBe(dedupeKey(p, IS_WIN32));
  });
});
