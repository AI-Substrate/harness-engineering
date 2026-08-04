import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SRC = join(CLI_ROOT, 'src');
const LINKS = join(SRC, 'services', 'dd', 'links');
const require = createRequire(import.meta.url);

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? tsFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)].flatMap(
    (match) => (typeof match[1] === 'string' ? [match[1]] : []),
  );
}

function importTarget(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  return normalize(resolve(dirname(fromFile), specifier.replace(/\.js$/, '.ts')));
}

/**
 * Every file reachable from an entry point, following relative imports.
 *
 * Transitive, not direct: a rule that only checks direct imports is satisfied by
 * one indirection, which is exactly how the coupling this guards against would
 * come back.
 */
function reachable(entries: readonly string[], sources: ReadonlyMap<string, string>): string[] {
  const visited = new Set<string>();
  const visit = (file: string): void => {
    if (visited.has(file)) return;
    visited.add(file);
    for (const specifier of importSpecifiers(sources.get(file) ?? '')) {
      const target = importTarget(file, specifier);
      if (target !== null) visit(target);
    }
  };
  for (const entry of entries) visit(entry);
  return [...visited].map((file) => relative(SRC, file).replaceAll('\\', '/'));
}

function allSources(): Map<string, string> {
  return new Map(tsFiles(SRC).map((file) => [file, readFileSync(file, 'utf8')]));
}

describe('architecture — the links layer stays independent of the render layer', () => {
  it('dd graph never reaches dd/render, however indirectly', () => {
    // This is what keeps Phase 3 and Phase 4 parallel. `dd graph` emits its
    // mermaid as a string, built in the links layer, precisely so that the graph
    // family never needs the renderer — and a single import anywhere along its
    // dependency chain would silently undo that.
    const entries = [join(SRC, 'acts', 'dd', 'graph.ts'), join(SRC, 'acts', 'dd', 'links.ts')];
    const render = reachable(entries, allSources()).filter((file) =>
      file.startsWith('services/dd/render/'),
    );
    expect(render).toEqual([]);
  });

  it('the links service never reaches dd/render, output, or acts', () => {
    const sources = allSources();
    const forbidden = reachable(tsFiles(LINKS), sources).filter(
      (file) =>
        file.startsWith('services/dd/render/') ||
        file.startsWith('output/') ||
        file.startsWith('acts/'),
    );
    expect(forbidden).toEqual([]);
  });

  it('detects the coupling it is meant to detect', () => {
    // A guard nobody has seen fail is a guard nobody knows works: feed it a file
    // that does the forbidden thing, transitively, and require it to complain.
    const entry = join(SRC, 'acts', 'dd', 'graph-violation.ts');
    const middle = join(LINKS, 'graph-violation.ts');
    const sources = new Map([
      [entry, `import '../../services/dd/links/graph-violation.js';`],
      [middle, `import '../render/renderer.js';`],
    ]);
    expect(
      reachable([entry], sources).filter((file) => file.startsWith('services/dd/render/')),
    ).toEqual(['services/dd/render/renderer.ts']);
  });

  it('states the rule in dependency-cruiser as a transitive one', () => {
    const config = require(join(CLI_ROOT, '..', '..', '.dependency-cruiser.cjs')) as {
      forbidden: Array<{ name: string; to?: { reachable?: boolean } }>;
    };
    for (const name of ['dd-graph-never-imports-render', 'dd-links-never-imports-render']) {
      expect(config.forbidden.find((rule) => rule.name === name)?.to?.reachable).toBe(true);
    }
  });
});
