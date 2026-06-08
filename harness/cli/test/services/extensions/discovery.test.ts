import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { discoverExtensions } from '../../../src/services/extensions/discovery.js';

const BASE = '/repo/.harness/extensions';

describe('discoverExtensions', () => {
  it('given_no_extensions_dir_when_discover_then_returns_empty (absent is not an error)', () => {
    /*
    Test Doc:
    - Why: a developer repo with no .harness/extensions/ must yield an honest empty registry,
      never a hard error (WS-A Decision 4, plan AC-6).
    - Contract: discoverExtensions scans <cwd>/.harness/extensions/ one level via FsPort.readdir
      + ProcessPort.cwd and returns sorted, deduped candidate absolute paths; absent/empty → [].
    - Usage Notes: cwd comes from the process port; the dir listing + file probes from the fs port.
    - Quality Contribution: pins the discovery rules the loader + doctor depend on.
    - Worked Example: empty fs → [].
    */
    const fs = new FakeFs();
    const proc = new FakeProcess({}, '/repo');
    expect(discoverExtensions(fs, proc)).toEqual([]);
  });

  it('returns [] for an empty extensions dir', () => {
    const fs = new FakeFs({}, { [BASE]: [] });
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo'))).toEqual([]);
  });

  it('discovers direct .ts/.tsx/.js/.mjs/.cjs files, sorted (first wins)', () => {
    const fs = new FakeFs({}, { [BASE]: ['hello.ts', 'build.js', 'a.tsx', 'z.mjs', 'm.cjs'] });
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo'))).toEqual([
      `${BASE}/a.tsx`,
      `${BASE}/build.js`,
      `${BASE}/hello.ts`,
      `${BASE}/m.cjs`,
      `${BASE}/z.mjs`,
    ]);
  });

  it('resolves a subdir via index.ts then index.js', () => {
    const fs = new FakeFs(
      {
        [`${BASE}/seed/index.ts`]: '// seed',
        [`${BASE}/tools/index.js`]: '// tools',
      },
      { [BASE]: ['seed', 'tools'] },
    );
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo'))).toEqual([
      `${BASE}/seed/index.ts`,
      `${BASE}/tools/index.js`,
    ]);
  });

  it('resolves a subdir via a package.json harness.extensions manifest', () => {
    const fs = new FakeFs(
      {
        [`${BASE}/lint/package.json`]: JSON.stringify({ harness: { extensions: ['main.ts'] } }),
        [`${BASE}/lint/main.ts`]: '// lint',
      },
      { [BASE]: ['lint'] },
    );
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo'))).toEqual([`${BASE}/lint/main.ts`]);
  });

  it('ignores non-extension files and subdirs with no index/manifest', () => {
    const fs = new FakeFs(
      { [`${BASE}/empty-sub/README.md`]: '# nope' },
      { [BASE]: ['notes.md', 'README', 'empty-sub', 'hello.ts'] },
    );
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo'))).toEqual([`${BASE}/hello.ts`]);
  });

  it('dedupes repeated manifest entries by resolved absolute path', () => {
    const fs = new FakeFs(
      {
        [`${BASE}/lint/package.json`]: JSON.stringify({
          harness: { extensions: ['main.ts', './main.ts', 'main.ts'] },
        }),
        [`${BASE}/lint/main.ts`]: '// lint',
      },
      { [BASE]: ['lint'] },
    );
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo'))).toEqual([`${BASE}/lint/main.ts`]);
  });

  it('rejects manifest entries that escape the extension subdir (path traversal) (F004)', () => {
    /*
    Test Doc:
    - Why: a package.json manifest must not be able to point the loader at files OUTSIDE its own
      extension subdir (`../escape.ts`, or a sibling-prefix like `../lint-evil/x.ts`) (F004).
    - Contract: manifest entries that resolve outside the subdir are dropped; in-subdir entries kept.
    - Quality Contribution: pins lexical containment of manifest-resolved candidates.
    - Worked Example: extensions ['../escape.ts','../lint-evil/x.ts','ok.ts'] → only ok.ts survives.
    */
    const fs = new FakeFs(
      {
        [`${BASE}/lint/package.json`]: JSON.stringify({
          harness: { extensions: ['../escape.ts', '../lint-evil/x.ts', 'ok.ts'] },
        }),
        [`${BASE}/lint/ok.ts`]: '// ok',
      },
      { [BASE]: ['lint'] },
    );
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo'))).toEqual([`${BASE}/lint/ok.ts`]);
  });

  it('resolves the base against the process cwd', () => {
    const fs = new FakeFs({}, { '/other/.harness/extensions': ['x.ts'] });
    expect(discoverExtensions(fs, new FakeProcess({}, '/other'))).toEqual([
      '/other/.harness/extensions/x.ts',
    ]);
  });
});
