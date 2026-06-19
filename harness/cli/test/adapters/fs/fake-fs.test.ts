import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';

describe('FakeFs', () => {
  it('given_seeded_file_when_probed_then_returns_content_and_records_reads', () => {
    /*
    Test Doc:
    - Why: services (doctor/config) must be unit-testable with zero real fs (Finding 04, R6).
    - Contract: FakeFs.exists/readText answer from the seed map and push every path to reads[].
    - Usage Notes: construct with a {path: contents} map; assert on `reads` for call history.
    - Quality Contribution: proves the fake records calls — the seam the service tests rely on.
    - Worked Example: new FakeFs({'a': 'x'}).readText('a') === 'x'.
    */
    const fs = new FakeFs({ 'harness/cli/dist/index.js': '// built' });
    expect(fs.exists('harness/cli/dist/index.js')).toBe(true);
    expect(fs.readText('harness/cli/dist/index.js')).toBe('// built');
    expect(fs.reads).toEqual(['harness/cli/dist/index.js', 'harness/cli/dist/index.js']);
  });

  it('returns false/null for unseeded paths (no throw)', () => {
    const fs = new FakeFs();
    expect(fs.exists('missing')).toBe(false);
    expect(fs.readText('missing')).toBeNull();
    expect(fs.reads).toContain('missing');
  });

  it('readdir returns seeded entry names and records the probed dir', () => {
    /*
    Test Doc:
    - Why: discovery scans `.harness/extensions/` one level — it needs a directory listing
      behind the FsPort so the service stays unit-testable (WS-A Decision 4, plan T007/T008).
    - Contract: FakeFs.readdir returns the seeded entry-name list for a directory and pushes
      the probed path to reads[]; an unseeded directory yields [] (never throws).
    - Usage Notes: seed directories via a second `{dir: string[]}` constructor map.
    - Quality Contribution: pins the readdir seam discovery relies on with zero real fs.
    - Worked Example: new FakeFs({}, {'.harness/extensions': ['a.ts','b.ts']}).readdir(...) → names.
    */
    const fs = new FakeFs({}, { '.harness/extensions': ['hello.ts', 'build.js'] });
    expect(fs.readdir('.harness/extensions')).toEqual(['hello.ts', 'build.js']);
    expect(fs.reads).toContain('.harness/extensions');
  });

  it('readdir returns [] for an unseeded directory (no throw)', () => {
    const fs = new FakeFs();
    expect(fs.readdir('.harness/extensions')).toEqual([]);
    expect(fs.reads).toContain('.harness/extensions');
  });

  it('readdir lists immediate child dirs created via mkdirp during the test (NodeFs fidelity)', () => {
    /*
    Test Doc:
    - Why: plan 015 — `harness observe` mkdirps a bucket dir at capture; a later `--list`
      sweep readdirs the parent. NodeFs sees the new dir; the fake must too, or
      write-then-list integration flows falsely come back empty.
    - Contract: mkdirp('<parent>/<child>/…') makes '<child>' appear in readdir('<parent>'),
      deduped against seeded names; only the immediate segment is listed.
    */
    const fs = new FakeFs({}, { '/repo/.harness/temp': ['seeded'] });
    fs.mkdirp('/repo/.harness/temp/agent');
    fs.mkdirp('/repo/.harness/temp/seeded'); // dedup against the seeded name
    expect(fs.readdir('/repo/.harness/temp')).toEqual(['seeded', 'agent']);
    expect(fs.readdir('/repo/.harness')).toContain('temp');
  });

  it('writeText stores content (readable back) and records the write', () => {
    /*
    Test Doc:
    - Why: the scaffolder (plan 006 T011) writes a new extension file; the service must be
      unit-testable with zero real fs (Constitution P3 — fakes over mocks).
    - Contract: FakeFs.writeText stores `{path: contents}` so a later exists/readText sees it,
      and pushes the path to `writes[]` for call-history assertions.
    - Usage Notes: assert on `writes` for what was written; on `exists`/`readText` for content.
    - Quality Contribution: pins the write seam the scaffold-service tests depend on.
    - Worked Example: fs.writeText('a.ts', 'x'); fs.readText('a.ts') === 'x'.
    */
    const fs = new FakeFs();
    fs.writeText('.harness/extensions/greet.ts', '// stub');
    expect(fs.writes).toEqual(['.harness/extensions/greet.ts']);
    expect(fs.exists('.harness/extensions/greet.ts')).toBe(true);
    expect(fs.readText('.harness/extensions/greet.ts')).toBe('// stub');
  });

  it('mkdirp registers the directory, is idempotent, and records each call', () => {
    /*
    Test Doc:
    - Why: scaffolding the first extension must create `.harness/extensions/` if absent
      (plan 006 Finding 01); a no-op when it already exists.
    - Contract: FakeFs.mkdirp records the path on `mkdirs[]` and makes `exists(dir)` true;
      calling twice does not throw and records twice (idempotent behavior, honest history).
    - Quality Contribution: pins the recursive-create seam with zero real fs.
    - Worked Example: fs.mkdirp('a/b'); fs.exists('a/b') === true.
    */
    const fs = new FakeFs();
    fs.mkdirp('.harness/extensions');
    fs.mkdirp('.harness/extensions');
    expect(fs.mkdirs).toEqual(['.harness/extensions', '.harness/extensions']);
    expect(fs.exists('.harness/extensions')).toBe(true);
    // recursive: the parent segment is created too (F001 — matches NodeFs recursive mkdir)
    expect(fs.exists('.harness')).toBe(true);
  });

  it('mkdirp tolerates Windows-shaped input — ancestors registered in canonical POSIX form', () => {
    /*
    Test Doc:
    - Why: the Windows-shape sensor (plan 017 AC-4/AC-8) seeds FakeProcess.cwd()='C:\\repo';
      until the service converts at the boundary, a Windows-shaped path may reach mkdirp.
      The fake must register the same canonical POSIX state for either separator shape,
      or write-then-probe flows falsely diverge between the two shapes.
    - Contract: mkdirp splits on / and \\ equivalently; exists() answers true for the
      canonical POSIX form of every ancestor.
    - Worked Example: mkdirp('C:\\repo\\.harness') → exists('C:/repo/.harness') === true.
    */
    const fs = new FakeFs();
    fs.mkdirp('C:\\repo\\.harness\\extensions');
    expect(fs.exists('C:/repo')).toBe(true);
    expect(fs.exists('C:/repo/.harness')).toBe(true);
    expect(fs.exists('C:/repo/.harness/extensions')).toBe(true);
  });

  it('mkdirp registers identical state for / and \\ input shapes', () => {
    const fromBackslash = new FakeFs();
    fromBackslash.mkdirp('C:\\repo\\x');
    const fromSlash = new FakeFs();
    fromSlash.mkdirp('C:/repo/x');
    expect(fromBackslash.exists('C:/repo/x')).toBe(true);
    expect(fromSlash.exists('C:/repo/x')).toBe(true);
  });

  it('mkdirp tolerates UNC-shaped input (both separator forms)', () => {
    const fs = new FakeFs();
    fs.mkdirp('\\\\server\\share\\repo\\.harness');
    expect(fs.exists('//server/share')).toBe(true);
    expect(fs.exists('//server/share/repo/.harness')).toBe(true);
    fs.mkdirp('//server/share/repo/.harness/extensions');
    expect(fs.exists('//server/share/repo/.harness/extensions')).toBe(true);
  });

  it('readdir tolerates a Windows-shaped probe of a POSIX-seeded dir', () => {
    /*
    Test Doc:
    - Why: plan 017 Cat B — readdir child-name extraction split on '/' only, so
      Windows-shaped probes (or mkdirp-registered children) vanished from listings.
    - Contract: probing with \\ or / yields the same listing; mkdirp-created children
      appear under either probe shape; UNC dirs work end-to-end.
    */
    const fs = new FakeFs({}, { 'C:/repo/.harness/extensions': ['hello'] });
    expect(fs.readdir('C:\\repo\\.harness\\extensions')).toEqual(['hello']);
    expect(fs.readdir('C:/repo/.harness/extensions')).toEqual(['hello']);
  });

  it('readdir lists mkdirp-created children when probed with either separator shape', () => {
    const fs = new FakeFs();
    fs.mkdirp('C:\\repo\\.harness\\temp\\agent');
    expect(fs.readdir('C:/repo/.harness/temp')).toEqual(['agent']);
    expect(fs.readdir('C:\\repo\\.harness\\temp')).toEqual(['agent']);
  });

  it('readdir handles UNC-shaped dirs end-to-end', () => {
    const fs = new FakeFs({}, { '//server/share/repo/.harness/extensions': ['hello'] });
    fs.mkdirp('//server/share/repo/.harness/extensions/world');
    expect(fs.readdir('\\\\server\\share\\repo\\.harness\\extensions')).toEqual(['hello', 'world']);
  });

  it('mkdirp on an ABSOLUTE path registers every ancestor with the leading slash preserved', () => {
    /*
    Test Doc:
    - Why: scaffold-service calls mkdirp(join(proc.cwd(), '.harness', 'extensions')) — an ABSOLUTE
      path. The fake must model recursive create for that exact shape (F004 guard — confirms the
      leading slash is preserved, matching NodeFs.mkdirSync({recursive:true})).
    - Worked Example: mkdirp('/repo/.harness/extensions') → /repo, /repo/.harness, and the leaf exist.
    */
    const fs = new FakeFs();
    fs.mkdirp('/repo/.harness/extensions');
    expect(fs.exists('/repo')).toBe(true);
    expect(fs.exists('/repo/.harness')).toBe(true);
    expect(fs.exists('/repo/.harness/extensions')).toBe(true);
  });

  it('realpath returns the path for a seeded/made entry and null for a missing one (plan 031)', () => {
    /*
    Test Doc:
    - Why: ctx.fs.realpath is the in-contract substitute for a POSIX `realpath` shell-out
      (CWE-59 confine guard). The fake has no symlinks, so realpath is identity for an
      existing path and null otherwise — mirroring NodeFs returning null for a missing path.
    - Contract: realpath('<seeded>') === '<seeded>'; realpath('<missing>') === null; probe recorded.
    */
    const fs = new FakeFs({ '/repo/x.json': '{}' });
    fs.mkdirp('/repo/.harness');
    expect(fs.realpath('/repo/x.json')).toBe('/repo/x.json');
    expect(fs.realpath('/repo/.harness')).toBe('/repo/.harness');
    expect(fs.realpath('/repo/missing')).toBeNull();
    expect(fs.reads).toContain('/repo/x.json');
  });

  it('copy records the logical intent, models a successful copy, and carries confineRoot (plan 031)', () => {
    /*
    Test Doc:
    - Why: a verb test asserts INTENT — that the verb called ctx.fsWrite.copy with the right
      src/destDir/confineRoot — while real symlink confinement lives in NodeFs (asserted there
      with a planted symlink). The fake never escapes; it records and models success.
    - Contract: copy pushes {src,destDir,confineRoot?} to copies[]; mkdirs destDir; the dest file
      (destDir/<basename src>) becomes readable; returns true.
    - Worked Example: copy('/clone/.harness/x.json','/out',{confineRoot:'/clone'}) → /out/x.json exists.
    */
    const fs = new FakeFs({ '/clone/.harness/reports/x.json': 'PAYLOAD' });
    const ok = fs.copy('/clone/.harness/reports/x.json', '/out/dir', { confineRoot: '/clone' });
    expect(ok).toBe(true);
    expect(fs.copies).toEqual([
      { src: '/clone/.harness/reports/x.json', destDir: '/out/dir', confineRoot: '/clone' },
    ]);
    expect(fs.exists('/out/dir/x.json')).toBe(true);
    expect(fs.readText('/out/dir/x.json')).toBe('PAYLOAD');
  });

  it('copy without confineRoot omits it from the ops log', () => {
    const fs = new FakeFs({ '/a/b.txt': 'hi' });
    fs.copy('/a/b.txt', '/dest');
    expect(fs.copies).toEqual([{ src: '/a/b.txt', destDir: '/dest' }]);
    expect(fs.exists('/dest/b.txt')).toBe(true);
  });
});

describe('NodeFs', () => {
  // Resolve real-tree probes from THIS file's location, not cwd — the suite must
  // read true from any invocation directory (plan 014 orchestrator retro OH-001).
  const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

  it('reports a real existing file and reads its text', () => {
    const fs = new NodeFs();
    expect(fs.exists(join(CLI_ROOT, 'tsconfig.json'))).toBe(true);
    expect(fs.readText(join(CLI_ROOT, 'tsconfig.json'))).toContain('compilerOptions');
  });

  it('returns false/null for a non-existent path without throwing', () => {
    const fs = new NodeFs();
    expect(fs.exists('definitely/not/here.xyz')).toBe(false);
    expect(fs.readText('definitely/not/here.xyz')).toBeNull();
  });

  it('readdir lists a real directory and returns [] for a missing one (no throw)', () => {
    const fs = new NodeFs();
    expect(fs.readdir(join(CLI_ROOT, 'src'))).toContain('app.ts');
    expect(fs.readdir('definitely/not/here')).toEqual([]);
  });

  it('mkdirp + writeText create nested dirs and a readable file on the real fs', () => {
    // Writes under the OS temp dir, then cleans up — proves the real adapter path.
    const fs = new NodeFs();
    const base = mkdtempSync(join(tmpdir(), 'harness-fs-'));
    try {
      const target = join(base, 'nested', 'deep', 'greet.ts');
      fs.mkdirp(join(base, 'nested', 'deep'));
      fs.writeText(target, '// real');
      expect(fs.exists(target)).toBe(true);
      expect(fs.readText(target)).toBe('// real');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('realpath resolves a real file and returns null for a missing path (plan 031)', () => {
    const fs = new NodeFs();
    const real = fs.realpath(join(CLI_ROOT, 'tsconfig.json'));
    expect(real).not.toBeNull();
    expect(real).toContain('tsconfig.json');
    expect(fs.realpath(join(CLI_ROOT, 'definitely-not-here.xyz'))).toBeNull();
  });

  it('copy (no confineRoot) copies a file into destDir, basename preserved (plan 031)', () => {
    const fs = new NodeFs();
    const base = mkdtempSync(join(tmpdir(), 'harness-copy-'));
    try {
      writeFileSync(join(base, 'src.json'), 'PAYLOAD');
      const dest = join(base, 'out');
      expect(fs.copy(join(base, 'src.json'), dest)).toBe(true);
      expect(fs.readText(join(dest, 'src.json'))).toBe('PAYLOAD');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('confined copy ALLOWS a source genuinely inside the clone subtree (plan 031 AC-03)', () => {
    const fs = new NodeFs();
    const base = mkdtempSync(join(tmpdir(), 'harness-confine-'));
    try {
      const clone = join(base, 'clone');
      mkdirSync(join(clone, '.harness', 'reports'), { recursive: true });
      writeFileSync(join(clone, '.harness', 'reports', 'latest.json'), 'INSIDE');
      const dest = join(base, 'out');
      const ok = fs.copy(join(clone, '.harness', 'reports', 'latest.json'), dest, {
        confineRoot: clone,
      });
      expect(ok).toBe(true);
      expect(fs.readText(join(dest, 'latest.json'))).toBe('INSIDE');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('confined copy REFUSES an out-of-tree symlink — CWE-59 exfil guard, one op (plan 031 AC-03)', () => {
    /*
    Test Doc:
    - Why: a malicious clone can commit a fixed artifact path (e.g.
      `.harness/reports/harnessability/latest.json`) as a SYMLINK to an absolute
      host file (~/.ssh/id_rsa, cloud creds). A plain `cp` dereferences it and
      exfiltrates the contents into the operator's tree (CWE-59). The portable
      confined copy must REFUSE it — and do so in ONE op (resolve + contain + copy),
      with no silent skip-all and no check-then-copy TOCTOU window.
    - Contract: copy(symlinkInsideClone → outsideFile, dest, {confineRoot: clone}) === false,
      and NOTHING is written to dest. A non-confined copy of the same symlink WOULD
      copy it (proves the guard, not the absence of a symlink, is what refuses).
    - Runs on ubuntu/macOS (real symlinks); the ruled-out windows-latest leg is covered
      by-construction elsewhere (plan 017).
    */
    const fs = new NodeFs();
    const base = mkdtempSync(join(tmpdir(), 'harness-exfil-'));
    try {
      const secret = join(base, 'secret.txt');
      writeFileSync(secret, 'TOP-SECRET');
      const clone = join(base, 'clone');
      mkdirSync(join(clone, '.harness', 'reports'), { recursive: true });
      // The committed artifact path is a symlink escaping the clone to the secret.
      const planted = join(clone, '.harness', 'reports', 'latest.json');
      symlinkSync(secret, planted);
      const dest = join(base, 'out');

      // Guard refuses (one op): returns false, nothing written.
      expect(fs.copy(planted, dest, { confineRoot: clone })).toBe(false);
      expect(fs.exists(join(dest, 'latest.json'))).toBe(false);

      // Control: WITHOUT the confineRoot the same symlink copies — so it is the
      // guard that refuses, not a missing/broken symlink.
      expect(fs.copy(planted, dest)).toBe(true);
      expect(fs.readText(join(dest, 'latest.json'))).toBe('TOP-SECRET');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('confined copy refuses a missing source (no silent skip-all distinction) (plan 031)', () => {
    const fs = new NodeFs();
    const base = mkdtempSync(join(tmpdir(), 'harness-missing-'));
    try {
      const clone = join(base, 'clone');
      mkdirSync(clone, { recursive: true });
      expect(fs.copy(join(clone, 'nope.json'), join(base, 'out'), { confineRoot: clone })).toBe(
        false,
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('confined copy ALLOWS an in-tree path whose first segment starts with ".." (F003 — no over-rejection)', () => {
    // A real dir literally named `..foo` is INSIDE the clone — its relative path
    // `..foo/x.json` merely starts with the chars `..` but is not an escape. The
    // separator-aware containment check must permit it (the old startsWith('..')
    // over-rejected it; fail-closed, but wrong).
    const fs = new NodeFs();
    const base = mkdtempSync(join(tmpdir(), 'harness-dotdot-'));
    try {
      const clone = join(base, 'clone');
      mkdirSync(join(clone, '..foo'), { recursive: true });
      writeFileSync(join(clone, '..foo', 'x.json'), 'INSIDE');
      const dest = join(base, 'out');
      expect(fs.copy(join(clone, '..foo', 'x.json'), dest, { confineRoot: clone })).toBe(true);
      expect(fs.readText(join(dest, 'x.json'))).toBe('INSIDE');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
