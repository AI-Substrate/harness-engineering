import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { discoverExtensions } from '../../../src/services/extensions/discovery.js';

const BASE = '/repo/.harness/extensions';

describe('discoverExtensions (folder-only, plan 014 D1)', () => {
  it('given_no_extensions_dir_when_discover_then_returns_empty (absent is not an error)', () => {
    /*
    Test Doc:
    - Why: a developer repo with no .harness/extensions/ must yield an honest empty result,
      never a hard error (WS-A Decision 4, plan 014 AC-6).
    - Contract: discoverExtensions scans <cwd>/.harness/extensions/ one level via FsPort.readdir
      + ProcessPort.cwd and returns { candidates, rejected }; absent/empty → both [].
    - Usage Notes: cwd comes from the process port; the dir listing + file probes from the fs port.
    - Quality Contribution: pins the D1 return shape the registry + doctor depend on.
    - Worked Example: empty fs → { candidates: [], rejected: [] }.
    */
    const fs = new FakeFs();
    const proc = new FakeProcess({}, '/repo');
    expect(discoverExtensions(fs, proc)).toEqual({ candidates: [], rejected: [] });
  });

  it('returns empty result for an empty extensions dir', () => {
    const fs = new FakeFs({}, { [BASE]: [] });
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo'))).toEqual({
      candidates: [],
      rejected: [],
    });
  });

  it('resolves a folder via extension.ts (the canonical entry)', () => {
    const fs = new FakeFs({ [`${BASE}/hello/extension.ts`]: '// hello' }, { [BASE]: ['hello'] });
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo'))).toEqual({
      candidates: [`${BASE}/hello/extension.ts`],
      rejected: [],
    });
  });

  it('resolves the per-folder chain: manifest → extension.ts → extension.js → index.ts → index.js', () => {
    /*
    Test Doc:
    - Why: AC-6 fixes the resolution chain so authors know exactly which file wins; the
      manifest stays the explicit override, `extension.ts` is the convention entry.
    - Contract: within one folder the FIRST hit of
      package.json harness.extensions[] → extension.ts → extension.js → index.ts → index.js
      is the only candidate.
    - Worked Example: four folders, each one rung lower on the chain.
    */
    const fs = new FakeFs(
      {
        // manifest beats extension.ts
        [`${BASE}/a-manifest/package.json`]: JSON.stringify({
          harness: { extensions: ['main.ts'] },
        }),
        [`${BASE}/a-manifest/main.ts`]: '// main',
        [`${BASE}/a-manifest/extension.ts`]: '// shadowed',
        // extension.ts beats extension.js + index.ts
        [`${BASE}/b-ext-ts/extension.ts`]: '// ts',
        [`${BASE}/b-ext-ts/extension.js`]: '// js',
        [`${BASE}/b-ext-ts/index.ts`]: '// idx',
        // extension.js beats index.ts
        [`${BASE}/c-ext-js/extension.js`]: '// js',
        [`${BASE}/c-ext-js/index.ts`]: '// idx',
        // index.ts beats index.js
        [`${BASE}/d-index/index.ts`]: '// idx-ts',
        [`${BASE}/d-index/index.js`]: '// idx-js',
        // index.js is the last rung
        [`${BASE}/e-index-js/index.js`]: '// idx-js',
      },
      { [BASE]: ['a-manifest', 'b-ext-ts', 'c-ext-js', 'd-index', 'e-index-js'] },
    );
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo'))).toEqual({
      candidates: [
        `${BASE}/a-manifest/main.ts`,
        `${BASE}/b-ext-ts/extension.ts`,
        `${BASE}/c-ext-js/extension.js`,
        `${BASE}/d-index/index.ts`,
        `${BASE}/e-index-js/index.js`,
      ],
      rejected: [],
    });
  });

  it('rejects a flat code file with the flat-layout reason (move to <name>/extension.ts)', () => {
    /*
    Test Doc:
    - Why: flat files are no longer a supported layout (spec AC-6); silently ignoring them
      would strand existing extensions — discovery must report them so doctor can wail.
    - Contract: a direct *.ts|*.tsx|*.js|*.mjs|*.cjs file under .harness/extensions/ is never
      a candidate; it lands in rejected[] with reason
      'unsupported flat layout — move to <name>/extension.ts'.
    - Quality Contribution: pins the D1 rejection path the registry turns into E143 records.
    */
    const fs = new FakeFs({}, { [BASE]: ['hello.ts'] });
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo'))).toEqual({
      candidates: [],
      rejected: [
        {
          path: `${BASE}/hello.ts`,
          reason: 'unsupported flat layout — move to hello/extension.ts',
        },
      ],
    });
  });

  it('rejects every flat code-file extension type, sorted, with per-name reasons', () => {
    const fs = new FakeFs({}, { [BASE]: ['z.mjs', 'hello.ts', 'a.tsx', 'build.js', 'm.cjs'] });
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo'))).toEqual({
      candidates: [],
      rejected: [
        { path: `${BASE}/a.tsx`, reason: 'unsupported flat layout — move to a/extension.ts' },
        {
          path: `${BASE}/build.js`,
          reason: 'unsupported flat layout — move to build/extension.ts',
        },
        {
          path: `${BASE}/hello.ts`,
          reason: 'unsupported flat layout — move to hello/extension.ts',
        },
        { path: `${BASE}/m.cjs`, reason: 'unsupported flat layout — move to m/extension.ts' },
        { path: `${BASE}/z.mjs`, reason: 'unsupported flat layout — move to z/extension.ts' },
      ],
    });
  });

  it('mixes folders and flats: folders resolve, flats reject, non-code files stay silent', () => {
    const fs = new FakeFs(
      { [`${BASE}/greet/extension.ts`]: '// greet' },
      { [BASE]: ['notes.md', 'README', 'greet', 'legacy.ts', 'empty-sub'] },
    );
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo'))).toEqual({
      candidates: [`${BASE}/greet/extension.ts`],
      rejected: [
        {
          path: `${BASE}/legacy.ts`,
          reason: 'unsupported flat layout — move to legacy/extension.ts',
        },
      ],
    });
  });

  it('reaches .tsx/.mjs/.cjs entries ONLY via a manifest (never via the convention chain)', () => {
    const fs = new FakeFs(
      {
        [`${BASE}/fancy/package.json`]: JSON.stringify({
          harness: { extensions: ['main.tsx', 'worker.mjs'] },
        }),
        [`${BASE}/fancy/main.tsx`]: '// tsx',
        [`${BASE}/fancy/worker.mjs`]: '// mjs',
        // no manifest → extension.tsx is NOT on the chain → folder unresolved (silent)
        [`${BASE}/plain/extension.tsx`]: '// tsx',
      },
      { [BASE]: ['fancy', 'plain'] },
    );
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo'))).toEqual({
      candidates: [`${BASE}/fancy/main.tsx`, `${BASE}/fancy/worker.mjs`],
      rejected: [],
    });
  });

  it('rejects manifest entries that escape the extension subdir (path traversal) (F004)', () => {
    /*
    Test Doc:
    - Why: a package.json manifest must not be able to point the loader at files OUTSIDE its own
      extension subdir (`../escape.ts`, or a sibling-prefix like `../lint-evil/x.ts`) (F004).
    - Contract: manifest entries that resolve outside the subdir are dropped (silently — they are
      a manifest authoring bug, not a layout violation); in-subdir entries kept.
    - Quality Contribution: pins lexical containment of manifest-resolved candidates.
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
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo'))).toEqual({
      candidates: [`${BASE}/lint/ok.ts`],
      rejected: [],
    });
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
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo'))).toEqual({
      candidates: [`${BASE}/lint/main.ts`],
      rejected: [],
    });
  });

  it('manifest can reach files in nested package subfolders (little-package internals)', () => {
    const fs = new FakeFs(
      {
        [`${BASE}/pkg/package.json`]: JSON.stringify({
          harness: { extensions: ['src/entry.ts'] },
        }),
        [`${BASE}/pkg/src/entry.ts`]: '// nested entry',
      },
      { [BASE]: ['pkg'] },
    );
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo'))).toEqual({
      candidates: [`${BASE}/pkg/src/entry.ts`],
      rejected: [],
    });
  });

  it('processes folders in sorted name order (stable first-wins for the registry)', () => {
    const fs = new FakeFs(
      {
        [`${BASE}/zeta/extension.ts`]: '// z',
        [`${BASE}/alpha/extension.ts`]: '// a',
      },
      { [BASE]: ['zeta', 'alpha'] },
    );
    expect(discoverExtensions(fs, new FakeProcess({}, '/repo')).candidates).toEqual([
      `${BASE}/alpha/extension.ts`,
      `${BASE}/zeta/extension.ts`,
    ]);
  });

  it('resolves the base against the process cwd', () => {
    const fs = new FakeFs(
      { '/other/.harness/extensions/x/extension.ts': '// x' },
      { '/other/.harness/extensions': ['x'] },
    );
    expect(discoverExtensions(fs, new FakeProcess({}, '/other'))).toEqual({
      candidates: ['/other/.harness/extensions/x/extension.ts'],
      rejected: [],
    });
  });
});
