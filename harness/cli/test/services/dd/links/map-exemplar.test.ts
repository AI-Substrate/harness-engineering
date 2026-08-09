import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from '../../../../src/services/dd/core/parse.js';
import type { DocLoader, DocLoadResult } from '../../../../src/services/dd/core/walk.js';
import { mapAddress, resolveMapSeed } from '../../../../src/services/dd/links/map.js';
import { linksFor } from '../../../../src/services/dd/links/report.js';
import { scanCorpus } from '../../../../src/services/dd/links/scan.js';
import { traverseCorpus } from '../../../../src/services/dd/links/traverse.js';
import type { SchemaFs } from '../../../../src/services/dd/schema/model.js';
import { ConventionSchemaResolver } from '../../../../src/services/dd/schema/resolve.js';
import { toPosix } from '../../../../src/services/shared/posix-path.js';

/**
 * The corpus root as a LOGICAL path (plan 017), converted ONCE here at the
 * boundary — exactly what production does with `toPosix(proc.cwd())`.
 *
 * `fileURLToPath` returns a NATIVE path, so on win32 this constant used to be
 * `C:\\…\\repo\\`: the trailing-separator strip missed a back-slash, and every
 * address built from it was native-shaped. It is not merely passed to
 * `readFileSync` (which tolerates mixed separators) — it is handed to
 * `scanCorpus` and `traverseCorpus` as `repoRoot`, where containment checks and
 * address resolution compare it against POSIX-shaped paths. `scanCorpus` builds
 * its paths with `posixJoin`, so `linksFor`'s `edge.from === path` compared a
 * native key against POSIX-logical edges, matched nothing, and reported
 * `outbound: []` (plan 077 · #108, and plan 108 · C2 — the same defect was found
 * twice, independently, from both ends).
 *
 * `toPosix` rather than an inline `replaceAll('\\', '/')`: it ALSO upper-cases the
 * drive letter, and `edge.from === path` is an exact string compare — so `c:` vs
 * `C:` would still mismatch after a separator-only fix.
 *
 * On POSIX `toPosix` is the identity, so this changes nothing here and everything
 * there — EXPECTED, UNVERIFIED: nobody on this plan has a Windows box.
 */
const REPO_ROOT = toPosix(fileURLToPath(new URL('../../../../../../', import.meta.url))).replace(
  /\/$/,
  '',
);
const EXEMPLAR = `${REPO_ROOT}/docs/how/dd/exemplar`;
const AC_0201 = `${EXEMPLAR}/plan.dd.json#acceptance_criteria/ac-0201`;

const NOT_A_DIRECTORY = new Set(['ENOENT', 'ENOTDIR']);

class RealFs implements SchemaFs {
  readdir(path: string): string[] {
    try {
      return readdirSync(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== undefined && NOT_A_DIRECTORY.has(code)) return [];
      throw error;
    }
  }

  exists(path: string): boolean {
    return existsSync(path);
  }

  readText(path: string): string | null {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  }
}

class RealDocLoader implements DocLoader {
  constructor(private readonly fs: SchemaFs) {}

  load(path: string): DocLoadResult {
    const text = this.fs.readText(path);
    if (text === null) {
      return { ok: false, path, reason: 'missing', message: `missing: ${path}` };
    }
    const doc = parse(text);
    if (Array.isArray(doc)) {
      return { ok: false, path, reason: 'missing', message: `unparseable: ${path}` };
    }
    return { ok: true, path, doc, sha: `sha-${path}`, tracked: true };
  }
}

function exemplarGraph() {
  const fs = new RealFs();
  const deps = {
    schemaResolver: new ConventionSchemaResolver({ fs, repoRoot: REPO_ROOT }),
    docLoader: new RealDocLoader(fs),
  };
  const scan = scanCorpus(fs, EXEMPLAR);
  const graph = traverseCorpus(scan.paths, deps, { repoRoot: REPO_ROOT, mode: 'sweep' });
  return { deps, graph };
}

/**
 * The gap this phase closes, proven on the corpus it was found on.
 *
 * These assertions run against the tracked exemplar rather than a fixture on
 * purpose: the defect was FOUND by running the shipped command on real data, and
 * a fixture that reproduces it only proves the fixture.
 */
describe('dd graph map — the real exemplar corpus', () => {
  it('is the corpus the gap was found on', () => {
    const { graph } = exemplarGraph();
    expect(graph.nodes.length).toBeGreaterThan(3);
    expect(graph.issues.filter((issue) => issue.severity === 'ERROR')).toEqual([]);
  });

  it('shows the whole-document answer `dd links` still gives for a row address', () => {
    // Not a regression guard on the old behaviour — a statement of the gap.
    // `dd links` reports edges per DOCUMENT (D11), so the `meta` section's own
    // link comes back for an address that named one acceptance-criteria row.
    const { graph } = exemplarGraph();
    const report = linksFor(`${EXEMPLAR}/plan.dd.json`, graph, AC_0201);
    expect(report.outbound.map((edge) => edge.location)).toContain(
      '$.sections[meta].value.backpressure',
    );
  });

  it('answers about ac-0201 itself, with `meta` absent', () => {
    const { deps, graph } = exemplarGraph();
    const seed = resolveMapSeed(AC_0201, deps, { repoRoot: REPO_ROOT });
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    expect(seed.interior).toEqual(['acceptance_criteria', 'ac-0201']);

    const result = mapAddress(seed, graph.edges, deps, {
      repoRoot: REPO_ROOT,
      depth: 1,
      maxNodes: 20,
      direction: 'out',
    });
    expect(result.seed.location).toBe('$.sections[acceptance_criteria].value[0]');
    expect(result.nodes.filter((node) => node.arm === 'out').map((node) => node.address)).toEqual([
      'docs/how/dd/exemplar/backpressure.dd.json#rows/bp-0201',
      'docs/how/dd/exemplar/execution-log.dd.json#entries/lg-0201',
    ]);
    // The `meta` edges — `#rows` and `#entries`, the whole sections — are the
    // ones a document-scoped answer wrongly includes.
    for (const node of result.nodes) {
      expect(node.address).not.toMatch(/#rows$/);
      expect(node.address).not.toMatch(/#entries$/);
    }
  });

  it('reaches the pressure row through the log entry — two hops out', () => {
    const { deps, graph } = exemplarGraph();
    const seed = resolveMapSeed(AC_0201, deps, { repoRoot: REPO_ROOT });
    if (!seed.ok) throw new Error('seed did not resolve');
    const result = mapAddress(seed, graph.edges, deps, {
      repoRoot: REPO_ROOT,
      depth: 3,
      maxNodes: 40,
      direction: 'out',
    });
    const log = result.nodes.find((node) => node.address.endsWith('#entries/lg-0201'));
    expect(log?.distance).toBe(1);
    const secondHop = result.edges.filter((edge) => edge.from === log?.key && edge.arm === 'out');
    expect(secondHop.map((edge) => edge.address)).toContain('backpressure.dd.json#rows/bp-0201');
  });

  it('names the citing rows on the inbound arm, from more than one document', () => {
    const { deps, graph } = exemplarGraph();
    const seed = resolveMapSeed(AC_0201, deps, { repoRoot: REPO_ROOT });
    if (!seed.ok) throw new Error('seed did not resolve');
    const result = mapAddress(seed, graph.edges, deps, {
      repoRoot: REPO_ROOT,
      depth: 1,
      maxNodes: 40,
      direction: 'in',
    });
    const inbound = result.nodes.filter((node) => node.arm === 'in').map((node) => node.address);
    expect(inbound).toContain('docs/how/dd/exemplar/execution-log.dd.json#entries/lg-0201');
    expect(inbound).toContain('docs/how/dd/exemplar/execution-log.dd.json#entries/lg-0202');
    // Every one of them is a ROW, not a bare file path.
    expect(inbound.every((address) => address.includes('#'))).toBe(true);
  });
});
