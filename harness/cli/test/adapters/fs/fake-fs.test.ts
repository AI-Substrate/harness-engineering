import { mkdtempSync, rmSync } from 'node:fs';
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
    expect(fs.readdir('\\\\server\\share\\repo\\.harness\\extensions')).toEqual([
      'hello',
      'world',
    ]);
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
});
