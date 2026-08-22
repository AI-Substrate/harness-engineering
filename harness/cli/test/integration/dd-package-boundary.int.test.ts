import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ConventionSchemaResolver,
  type DdDoc,
  type DocLoader,
  FsDocLoader,
  MemoizingDocLoader,
  parse,
  resolveAddressFile,
  type SchemaFs,
  validateWalk,
} from '@ai-substrate/dd';
import { describe, expect, it } from 'vitest';

/*
Test Doc:
- Why: plan 080 phase 1 (tk-0002 / bp-000e). Harness now consumes dd as an INSTALLED
  package pinned by git sha, so the seam that used to be a relative import is a
  published contract that can move underneath us on any re-pin. The POC that proved
  the route green lived in a session scratchpad and died with the session; this file
  is that proof promoted into the suite, so the next re-pin re-runs it instead of
  trusting it.
- Contract: four properties of the package AS INSTALLED, none of them re-derivable
  from harness source — (1) it PACKS: the tarball carries `dist/` and no `src/`, so
  "exported" and "shipped" are the same claim; (2) the exports map is CLOSED, so a
  symbol that lost its public home fails loudly rather than resolving through a deep
  path; (3) foreign, consumer-owned ports (`SchemaFs`, a hash port, a `DocLoader`)
  flow inward through the published constructors and are annotated AT THE
  DECLARATION, so a contract change lands as a type error where the object is
  written; (4) A-2 holds — `tracked` is `null`, not `false`, when the host has no
  tracking concept; and (5) D7 holds — a drive-rooted address resolves to itself
  rather than being appended to the citer's directory.
- Usage Notes: everything here reads the REAL `node_modules/@ai-substrate/dd`. There
  are no fakes of the package — the fakes are the consumer-owned ports, which is the
  repo standard (constitution P3, fakes over mocks; no `vi.mock`/`spyOn`). The
  fixture filesystem is a plain object literal typed `SchemaFs`, so it is the type
  checker, not a runtime assertion, that catches a widened port contract.
- Quality Contribution: bp-000e is a FAILURE MODE, not a feature — an SDK-boundary
  behavioural regression arriving on a re-pin, which a POSIX unit suite is blind to
  because it never types a drive letter or a non-repo host. This is the only place
  in the suite where that class can fail.
- Worked Example: re-pin dd, run `just test`. A dropped `./node` export, a `SchemaFs`
  that grew an `isFile`, an A-2 regression back to `tracked: false`, or a D7
  regression to `/repo/docs/C:/other/e.dd.json` each fail here by name.
*/

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const PACKAGE_ROOT = join(REPO_ROOT, 'node_modules/@ai-substrate/dd');

const require_ = createRequire(import.meta.url);

/** The pinned spec as the ROOT manifest declares it — the repo's single manifest. */
function pinnedSpec(): string {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  return manifest.dependencies['@ai-substrate/dd'] ?? '';
}

describe('@ai-substrate/dd — the installed package', () => {
  /**
   * The dependency is provenance, so the SHA is part of the contract this file
   * proves. A floating `github:AI-Substrate/dd` (or a `file:` path, which skips
   * packing entirely) makes every assertion below unreproducible an hour later.
   */
  it('is pinned by a full 40-character git sha, never a floating ref', () => {
    const spec = pinnedSpec();
    expect(spec).toMatch(/^github:AI-Substrate\/dd#[0-9a-f]{40}$/);
  });

  /**
   * The pack-shape probe. `file:` and a bare tarball both hide the
   * exported-but-not-in-tarball class; a git install does not, because npm runs
   * `prepare` and then packs. `dist/` present with `src/` absent is the whole
   * claim: what resolves at runtime is what shipped.
   */
  it('packs built output only — dist present, src/test/scripts absent', () => {
    const top = readdirSync(PACKAGE_ROOT).sort();
    expect(top).toContain('dist');
    expect(top).toContain('package.json');
    expect(existsSync(join(PACKAGE_ROOT, 'dist/lib.js'))).toBe(true);

    for (const excluded of ['src', 'test', 'scripts', '.github']) {
      expect(existsSync(join(PACKAGE_ROOT, excluded))).toBe(false);
    }
  });

  /**
   * NEGATIVE CONTROL (dw-0003). Everything else in this file would still pass if
   * the exports map were wide open and harness were reaching past it — so this
   * asserts the map REFUSES. A deep path that is not exported must fail with
   * `ERR_PACKAGE_PATH_NOT_EXPORTED`; that refusal is what makes "this symbol has a
   * public home" a falsifiable claim rather than a filesystem accident.
   *
   * Asked through Node's OWN resolver rather than an `import()`: vitest's
   * transform resolves a literal specifier before any test runs, so a bare
   * `await expect(import(...)).rejects` fails the whole FILE to load instead of
   * failing one assertion — the control would be indistinguishable from a broken
   * suite. `createRequire().resolve` consults the same `exports` map with no
   * bundler in the way.
   */
  it('refuses a path outside the exports map (negative control)', () => {
    let code: string | undefined;
    try {
      require_.resolve('@ai-substrate/dd/dist/core/parse.js');
    } catch (error) {
      code = (error as NodeJS.ErrnoException).code;
    }
    expect(code).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');

    // The positive half: a specifier that IS in the map resolves without throwing.
    expect(() => require_.resolve('@ai-substrate/dd/links')).not.toThrow();
  });

  /**
   * The other half of the negative control: every symbol the four rewired
   * consumers import must be reachable at the home they import it from. A dropped
   * export fails HERE, at the boundary, instead of as a confusing type error in
   * whichever act happened to name it.
   */
  it('exports every symbol the rewired consumers import, at its named home', async () => {
    const barrel = await import('@ai-substrate/dd');
    for (const symbol of [
      'isAddressFailure',
      'parseAddress',
      'parse',
      'resolveAddressFile',
      'validateWalk',
      'FsDocLoader',
      'MemoizingDocLoader',
      'ConventionSchemaResolver',
    ]) {
      expect(barrel, `barrel export ${symbol}`).toHaveProperty(symbol);
    }

    const links = await import('@ai-substrate/dd/links');
    for (const symbol of ['resolveMapSeed', 'traverseCorpus']) {
      expect(links, `./links export ${symbol}`).toHaveProperty(symbol);
    }

    const renderer = await import('@ai-substrate/dd/render/renderer');
    for (const symbol of ['escapeCell', 'headingSlug']) {
      expect(renderer, `./render/renderer export ${symbol}`).toHaveProperty(symbol);
    }

    // The host-bound tier: the five symbols that let `acts/plan/index.ts` come off
    // the relative `../dd/` modules entirely.
    const node = await import('@ai-substrate/dd/node');
    for (const symbol of ['DD_ISSUE_CODES', 'renderDocument', 'NodeSchemaFs', 'trackedPaths']) {
      expect(node, `./node export ${symbol}`).toHaveProperty(symbol);
    }
  });
});

/**
 * A schema package on a filesystem harness owns, not one dd owns. `.dd/schemas/
 * <pkg>/<schema>/schema.json` is the convention the resolver deep-scans; serving
 * it from a literal is what makes this an INJECTION test rather than a fixture-dir
 * test.
 */
const SCHEMA_JSON = JSON.stringify({
  dd_schema: 1,
  description: 'A minimal schema owned by this fixture, not by dd.',
  sections: {
    tasks: {
      shape: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id'],
          fields: { id: { type: 'string' }, title: { type: 'string' }, state: { type: 'state' } },
        },
      },
    },
  },
});

const DOC_JSON = JSON.stringify({
  dd: { schema: 'probe/plan', spec: 'dd@1' },
  sections: [
    { name: 'tasks', value: [{ id: 'tk-a1b2', title: 'Prove the seam', state: 'checked' }] },
  ],
  references: [],
});

const DIRECTORIES: Readonly<Record<string, readonly string[]>> = {
  '/repo/docs': [],
  '/repo/.dd': ['schemas'],
  '/repo/.dd/schemas': ['probe'],
  '/repo/.dd/schemas/probe': ['plan'],
  '/repo/.dd/schemas/probe/plan': ['schema.json'],
  '/repo/.harness/.dd': [],
  '/home/probe/.dd': [],
};

const FILES: Readonly<Record<string, string>> = {
  '/repo/.dd/schemas/probe/plan/schema.json': SCHEMA_JSON,
  '/repo/docs/plan.dd.json': DOC_JSON,
};

/**
 * Typed AT THE DECLARATION, deliberately (plan 080 hard rule 3). Annotating the
 * const rather than casting at the call site is what makes a widened `SchemaFs`
 * — dd growing an `isFile`, say — a compile error on THIS object instead of a
 * silent runtime `undefined is not a function` inside the scan.
 */
function makeFs(reads: string[]): SchemaFs {
  const fs: SchemaFs = {
    readdir(path: string): string[] {
      return [...(DIRECTORIES[path] ?? [])];
    },
    exists(path: string): boolean {
      return path in FILES || path in DIRECTORIES;
    },
    readText(path: string): string | null {
      reads.push(path);
      return FILES[path] ?? null;
    },
  };
  return fs;
}

/** The hash port, likewise annotated where it is written. `sha256Hex`, nothing else. */
interface ProbeHash {
  sha256Hex(input: string): string;
}

function makeHash(): ProbeHash {
  const hash: ProbeHash = {
    sha256Hex(input: string): string {
      // Deterministic and cheap — the loader only needs a stable identity, and a
      // real digest here would prove nothing this test is asking about.
      let acc = 0;
      for (let i = 0; i < input.length; i += 1) acc = (acc * 31 + input.charCodeAt(i)) | 0;
      return `probe${(acc >>> 0).toString(16).padStart(8, '0')}`;
    },
  };
  return hash;
}

describe('@ai-substrate/dd — foreign ports flow inward', () => {
  /**
   * The whole composition harness performs in `acts/`, built from PUBLIC exports
   * alone and driven by ports this fixture owns: resolver + loader + walk, with
   * dd never naming an adapter.
   */
  it('resolves a schema and validates a walk through consumer-owned ports', () => {
    const reads: string[] = [];
    const resolver = new ConventionSchemaResolver({
      fs: makeFs(reads),
      repoRoot: '/repo',
      home: '/home/probe',
    });

    const resolution = resolver.resolveDetailed('probe/plan', '/repo/docs/plan.dd.json');
    expect(resolution.issues.filter((issue) => issue.severity === 'ERROR')).toEqual([]);
    expect(resolution.record?.name).toBe('probe/plan');
    expect(resolution.record?.root).toBe('gitroot');

    const doc = parse(DOC_JSON);
    expect(Array.isArray(doc)).toBe(false);

    const loader: DocLoader = new MemoizingDocLoader(
      new FsDocLoader(makeFs(reads), makeHash(), null),
    );
    const issues = validateWalk(
      doc as DdDoc,
      '/repo/docs/plan.dd.json',
      {
        schemaResolver: resolver,
        docLoader: loader,
      },
      { repoRoot: '/repo' },
    );

    expect(issues.filter((issue) => issue.severity === 'ERROR')).toEqual([]);
  });

  /**
   * The decorator earns its place or it does not ship: two loads of one path must
   * cost one read. This is the property `acts/` relies on when the doctor reads
   * the same document from three angles.
   */
  it('memoises a repeated load into a single read of the underlying port', () => {
    const reads: string[] = [];
    const loader = new MemoizingDocLoader(new FsDocLoader(makeFs(reads), makeHash(), null));

    const first = loader.load('/repo/docs/plan.dd.json');
    const second = loader.load('/repo/docs/plan.dd.json');

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(reads.filter((path) => path === '/repo/docs/plan.dd.json')).toHaveLength(1);
  });

  /**
   * A-2. A null tracking snapshot means "this host has no tracking concept" and
   * must survive as `null` all the way into the result — NOT collapse to `false`,
   * which is a confident wrong answer. `acts/flow.ts` branches on `=== false`
   * precisely because `null` is a third state, so a regression here silently
   * changes what that act reports on a non-repo host.
   */
  it('carries tracked === null (not false) when the host has no tracking concept', () => {
    const loader = new FsDocLoader(makeFs([]), makeHash(), null);
    const result = loader.load('/repo/docs/plan.dd.json');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tracked).toBeNull();
    expect(result.tracked).not.toBe(false);
  });

  /** The positive control for the above: a real snapshot still answers true/false. */
  it('reports tracked truthfully when a snapshot exists', () => {
    const tracked = new Set(['/repo/docs/plan.dd.json']);
    const loader = new FsDocLoader(makeFs([]), makeHash(), tracked);

    const inside = loader.load('/repo/docs/plan.dd.json');
    expect(inside.ok && inside.tracked).toBe(true);
  });
});

describe('@ai-substrate/dd — D7 address resolution', () => {
  /**
   * The D7 class: absoluteness tested with `startsWith('/')`, which a drive-letter
   * path does not satisfy, so `C:/other/e.dd.json` cited from `/repo/docs` used to
   * resolve to `/repo/docs/C:/other/e.dd.json`. The POSIX suite is structurally
   * blind to this — it never types a drive letter — which is exactly why the
   * probe is here and not left to CI on a Windows runner we do not have.
   */
  it('leaves a drive-rooted target alone instead of appending it to the citer', () => {
    expect(resolveAddressFile('/repo/docs/plan.dd.json', 'C:/other/e.dd.json')).toBe(
      'C:/other/e.dd.json',
    );
    expect(resolveAddressFile('/repo/docs/plan.dd.json', 'C:/other/e.dd.json')).not.toContain(
      '/repo/docs/C:',
    );
  });

  /** Controls — the two cases a naive fix would break while making the above pass. */
  it('still anchors a relative target and passes a posix-absolute one through', () => {
    expect(resolveAddressFile('/repo/docs/plan.dd.json', 'sibling.dd.json')).toBe(
      '/repo/docs/sibling.dd.json',
    );
    expect(resolveAddressFile('/repo/docs/plan.dd.json', '/abs/e.dd.json')).toBe('/abs/e.dd.json');
  });
});

describe('@ai-substrate/dd — the host-bound tier', () => {
  /**
   * `NodeSchemaFs` is the one port dd ships bound to a real host, and the reason it
   * exists is a distinction the shared `NodeFs` collapses: "I found nothing" and
   * "I could not look" are different answers. A missing directory is `[]`; anything
   * else must propagate so the scan can report `scan-failed` instead of a confident
   * `schema-not-found`.
   */
  it('NodeSchemaFs answers an absent directory with [] and satisfies SchemaFs', async () => {
    const { NodeSchemaFs } = await import('@ai-substrate/dd/node');
    const fs: SchemaFs = new NodeSchemaFs();

    expect(fs.readdir(join(REPO_ROOT, 'no/such/directory'))).toEqual([]);
    expect(fs.exists(join(REPO_ROOT, 'package.json'))).toBe(true);
    expect(fs.readText(join(REPO_ROOT, 'no/such/file'))).toBeNull();
    expect(fs.readText(join(REPO_ROOT, 'package.json'))).toContain('@ai-substrate/dd');
  });

  /** The installed package's own manifest must agree with the lockfile's pin. */
  it('resolves from the sha the lockfile records', () => {
    const lock = JSON.parse(readFileSync(join(REPO_ROOT, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { resolved?: string }>;
    };
    const resolved = lock.packages['node_modules/@ai-substrate/dd']?.resolved ?? '';
    const sha = pinnedSpec().split('#')[1];

    expect(resolved).toContain('git+ssh://git@github.com/AI-Substrate/dd.git');
    expect(resolved.endsWith(`#${sha}`)).toBe(true);
    expect(require_(join(PACKAGE_ROOT, 'package.json')).name).toBe('@ai-substrate/dd');
  });
});
