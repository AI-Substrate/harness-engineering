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
});

describe('NodeFs', () => {
  it('reports a real existing file and reads its text', () => {
    // cwd is harness/cli (vitest runs there); tsconfig.json lives here.
    const fs = new NodeFs();
    expect(fs.exists('tsconfig.json')).toBe(true);
    expect(fs.readText('tsconfig.json')).toContain('compilerOptions');
  });

  it('returns false/null for a non-existent path without throwing', () => {
    const fs = new NodeFs();
    expect(fs.exists('definitely/not/here.xyz')).toBe(false);
    expect(fs.readText('definitely/not/here.xyz')).toBeNull();
  });

  it('readdir lists a real directory and returns [] for a missing one (no throw)', () => {
    // cwd is harness/cli (vitest runs there); the `src` directory exists.
    const fs = new NodeFs();
    expect(fs.readdir('src')).toContain('app.ts');
    expect(fs.readdir('definitely/not/here')).toEqual([]);
  });
});
