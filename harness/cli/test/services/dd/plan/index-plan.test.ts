import { describe, expect, it } from 'vitest';
import { isAddressFailure, parseAddress } from '../../../../src/services/dd/core/address.js';
import type { DdDoc, ResolvedDdSchema } from '../../../../src/services/dd/core/model.js';
import {
  resolveAddressFile,
  type SchemaResolveResult,
  type SchemaResolver,
} from '../../../../src/services/dd/core/validate.js';
import type { DocLoader, DocLoadResult } from '../../../../src/services/dd/core/walk.js';
import { indexDocument } from '../../../../src/services/dd/links/map.js';
import { traverseCorpus } from '../../../../src/services/dd/links/traverse.js';
import {
  buildPlanIndex,
  displayAddress,
  itemKey,
  type PlanDocument,
} from '../../../../src/services/dd/plan/index-plan.js';

/**
 * A1/A2 — plan 108, dlg-0003.
 *
 * `itemKey` and `displayAddress` are the identity two producers of a plan item
 * must agree on: a filesystem walk (native separators on Windows) and a parsed
 * dd address (always forward slashes). Both are LATENT on the current CLI —
 * every ingress into `buildPlanIndex` is traced POSIX (`acts/plan/index.ts`,
 * `acts/dd/shared.ts` both call `toPosix(cwd())`; `check.ts`'s
 * `resolveInRepo`/`isWithin` gate every document before it ever reaches this
 * layer) — so nothing here claims a shipped, user-visible defect. These tests
 * pin the invariant at the function boundary, which is a legitimate way to
 * prove the code is WRONG WHEN REACHED even though no route reaches it today.
 */

const SCHEMA: ResolvedDdSchema = {
  name: 'boundary/plan',
  sections: {
    rows: {
      shape: {
        type: 'array',
        items: {
          type: 'object',
          fields: {
            id: { type: 'string' },
            state: { type: 'state' },
            satisfies: { type: 'link', rel: 'satisfies' },
          },
        },
      },
    },
  },
};

function doc(sections: DdDoc['sections']): DdDoc {
  return { dd: { schema: SCHEMA.name }, sections, references: [] };
}

class FixtureDocLoader implements DocLoader {
  constructor(private readonly docs: ReadonlyMap<string, DdDoc>) {}
  load(path: string): DocLoadResult {
    const found = this.docs.get(path);
    return found
      ? { ok: true, path, doc: found, sha: `sha-${path}`, tracked: true }
      : { ok: false, path, reason: 'missing', message: `missing: ${path}` };
  }
}

class FixtureSchemaResolver implements SchemaResolver {
  resolve(schemaRef: string): SchemaResolveResult {
    return schemaRef === SCHEMA.name
      ? { ok: true, schema: SCHEMA }
      : { ok: false, message: `no schema: ${schemaRef}` };
  }
}

describe('displayAddress — A1 (plan 108)', () => {
  /** The pre-fix logic verbatim: a hard-coded forward slash. */
  function unfixedDisplayAddress(
    repoRoot: string,
    path: string,
    interior: readonly string[],
  ): string {
    const root = repoRoot.replace(/\/+$/, '');
    const relative = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
    return interior.length === 0 ? relative : `${relative}#${interior.join('/')}`;
  }

  it('unfixed renders the full absolute path on Windows; fixed renders repo-relative', () => {
    const repoRoot = 'C:\\repo';
    const path = 'C:\\repo\\docs\\p.dd.md';

    // WRONG: `startsWith('C:\repo/')` is never true against a backslash path,
    // so the ternary falls through to the raw absolute path — quietly.
    expect(unfixedDisplayAddress(repoRoot, path, [])).toBe(path);

    // RIGHT: posixRelative normalises both sides before comparing.
    expect(displayAddress(repoRoot, path, [])).toBe('docs/p.dd.md');
  });

  it('an interior-qualified address renders the same way', () => {
    expect(displayAddress('C:\\repo', 'C:\\repo\\docs\\p.dd.md', ['rows', 'ac-0001'])).toBe(
      'docs/p.dd.md#rows/ac-0001',
    );
  });
});

describe('itemKey — A2 (plan 108)', () => {
  /** The pre-fix logic verbatim: the raw path IS the key. */
  const unfixedItemKey = (path: string, interior: readonly string[]): string =>
    `${path}#${interior.join('/')}`;

  it('unfixed spells one document two ways; fixed collapses to one key', () => {
    const nativeSpelling = 'C:\\repo\\docs\\p.dd.md';
    const posixSpelling = 'C:/repo/docs/p.dd.md';

    // WRONG: two spellings of one document mint two different keys.
    expect(unfixedItemKey(nativeSpelling, [])).not.toBe(unfixedItemKey(posixSpelling, []));

    // RIGHT: toPosix collapses both spellings to one key.
    expect(itemKey(nativeSpelling, [])).toBe(itemKey(posixSpelling, []));
  });

  it('a lowercase drive letter collapses to the same key too — case-fold, not just slash-fold', () => {
    expect(itemKey('c:\\repo\\docs\\p.dd.md', [])).toBe(itemKey('C:/repo/docs/p.dd.md', []));
  });
});

describe('buildPlanIndex — the boundary (A2, satisfies edge resolves; plan 108)', () => {
  const REPO_WIN = 'C:\\repo';
  const CRITERION_PATH_WIN = 'C:\\repo\\docs\\criterion.dd.json';
  const TASK_PATH_WIN = 'C:\\repo\\docs\\task.dd.json';

  const CRITERION_DOC = doc([{ name: 'rows', value: [{ id: 'ac-0001', state: 'checked' }] }]);
  const TASK_DOC = doc([
    {
      name: 'rows',
      value: [{ id: 'tk-0001', state: 'checked', satisfies: 'criterion.dd.json#rows/ac-0001' }],
    },
  ]);

  /**
   * A real `traverseCorpus` walk (not hand-built edges) so `edge.from`/`.to`
   * are exactly what the production pipeline (`check.ts`) would hand
   * `buildPlanIndex` — the same shape `resolveAddressFile` always
   * POSIX-normalises regardless of the walk's own path spelling, which is the
   * actual mechanism A2 breaks.
   */
  function nativeCorpus(repoRoot: string, criterionPath: string, taskPath: string) {
    const docs = new Map<string, DdDoc>([
      [criterionPath, CRITERION_DOC],
      [taskPath, TASK_DOC],
    ]);
    const fixtureDeps = {
      schemaResolver: new FixtureSchemaResolver(),
      docLoader: new FixtureDocLoader(docs),
    };
    const graph = traverseCorpus([criterionPath, taskPath], fixtureDeps, {
      repoRoot,
      mode: 'direct',
      follow: false,
    });
    const documents: PlanDocument[] = [
      { path: criterionPath, doc: CRITERION_DOC, schema: SCHEMA },
      { path: taskPath, doc: TASK_DOC, schema: SCHEMA },
    ];
    return { documents, edges: graph.edges };
  }

  it('a native-spelled repoRoot and document paths still resolve the satisfies edge', () => {
    const { documents, edges } = nativeCorpus(REPO_WIN, CRITERION_PATH_WIN, TASK_PATH_WIN);

    const index = buildPlanIndex(documents, edges, REPO_WIN);

    const satisfiesEdge = index.edges.find((edge) => edge.rel === 'satisfies');
    // RIGHT: the edge resolves to the criterion item's exact key — asserting
    // the VALUE, not merely `.not.toBeNull()`, which would pass just as
    // happily if `satisfiesEdge` were `undefined` (no edge found at all: a
    // `.find()` miss is `undefined`, and `undefined !== null`).
    expect(satisfiesEdge?.to).toBe('C:/repo/docs/criterion.dd.json#rows/ac-0001');
  });

  it('a lowercase drive letter in repoRoot AND document paths still resolves the edge', () => {
    // Proves the property is not an accident of always-uppercase fixtures:
    // `resolveAddressFile`'s own `normalizeFilePath` does NOT upper-case a
    // drive letter — the guarantee holds only because `buildPlanIndex` runs
    // `toPosix` on `edge.from` BEFORE handing it to `resolveAddressFile`, so
    // the case-fold happens once, at the one boundary, and every downstream
    // computation inherits it. If a future edit ever reverted to passing the
    // raw `edge.from` through, this is the test that goes red.
    const repoLower = 'c:\\repo';
    const criterionLower = 'c:\\repo\\docs\\criterion.dd.json';
    const taskLower = 'c:\\repo\\docs\\task.dd.json';
    const { documents, edges } = nativeCorpus(repoLower, criterionLower, taskLower);

    const index = buildPlanIndex(documents, edges, repoLower);

    const satisfiesEdge = index.edges.find((edge) => edge.rel === 'satisfies');
    // The expected key's drive letter is UPPER-CASE even though every input
    // here is lower-case — that is itself the property under test.
    expect(satisfiesEdge?.to).toBe('C:/repo/docs/criterion.dd.json#rows/ac-0001');
  });

  it('positive control: the unfixed Map-lookup mechanism leaves the same edge unresolved', () => {
    // Isolates exactly the mechanism A2 broke — `indexes` keyed by the RAW
    // (native) document path, looked up with `resolveAddressFile`'s output,
    // which is ALWAYS POSIX-normalised regardless of input spelling — without
    // re-testing all ninety lines of the pre-fix `buildPlanIndex`.
    const { documents, edges } = nativeCorpus(REPO_WIN, CRITERION_PATH_WIN, TASK_PATH_WIN);
    const unfixedIndexes = new Map(
      documents.map((entry) => [entry.path, indexDocument(entry.path, entry.doc, entry.schema)]),
    );
    const taskEdge = edges.find((edge) => edge.rel === 'satisfies');
    if (!taskEdge) throw new Error('fixture must produce a satisfies edge');
    const parsed = parseAddress(taskEdge.address);
    if (isAddressFailure(parsed) || parsed.file === null) {
      throw new Error('fixture address must parse to a file target');
    }
    const targetPath = resolveAddressFile(taskEdge.from, parsed.file);

    // WRONG: native-keyed Map, POSIX-normalised lookup key — a miss.
    expect(unfixedIndexes.has(targetPath)).toBe(false);
  });
});

describe('buildPlanIndex — the isWithin boundary assertion (plan 108)', () => {
  it('throws, by name, when a document path is outside repoRoot', () => {
    // This precondition is what makes `displayAddress`'s out-of-repo fallback
    // branch unreachable BY CONSTRUCTION rather than by accident of what the
    // CLI happens to send today — see the docstring on both functions.
    const outside: PlanDocument = { path: '/elsewhere/doc.dd.json', doc: doc([]), schema: SCHEMA };

    expect(() => buildPlanIndex([outside], [], '/repo')).toThrow(/outside repoRoot/);
  });
});
