import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SRC = join(CLI_ROOT, 'src');
const RENDER = join(SRC, 'services', 'dd', 'render');
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

function classifyTarget(target: string): string | null {
  const relativeTarget = relative(SRC, target).replaceAll('\\', '/');
  if (relativeTarget.startsWith('output/')) return 'output';
  if (relativeTarget.startsWith('acts/')) return 'acts';
  if (relativeTarget.startsWith('adapters/')) return 'adapters';
  return null;
}

/**
 * Transitive boundary scan, deliberately identical in shape to
 * `dd-core-isolation.test.ts`: a renderer that imports something clean which
 * imports `output/` is just as impure as one that imports it directly, and only a
 * reachable-style walk catches that.
 */
function isolationViolations(
  entryFiles: readonly string[],
  sources: ReadonlyMap<string, string>,
): string[] {
  const violations: string[] = [];
  const visited = new Set<string>();

  const visit = (file: string, trace: readonly string[]): void => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = sources.get(file);
    if (source === undefined) return;

    for (const specifier of importSpecifiers(source)) {
      if (specifier.startsWith('node:')) {
        violations.push(`node builtin: ${[...trace, specifier].join(' -> ')}`);
        continue;
      }
      const target = importTarget(file, specifier);
      if (target === null) continue;
      const kind = classifyTarget(target);
      const targetLabel = relative(SRC, target).replaceAll('\\', '/');
      if (kind) {
        violations.push(`${kind}: ${[...trace, targetLabel].join(' -> ')}`);
        continue;
      }
      visit(target, [...trace, targetLabel]);
    }
  };

  for (const entry of entryFiles) {
    visit(entry, [relative(SRC, entry).replaceAll('\\', '/')]);
  }
  return violations;
}

describe('architecture — dd render purity', () => {
  it('detects deliberate direct and transitive renderer boundary violations', () => {
    const direct = join(RENDER, 'direct-violation.ts');
    const transitive = join(RENDER, 'transitive-violation.ts');
    const intermediary = join(SRC, 'services', 'sensors', 'snapshot.ts');
    const sources = new Map([
      [
        direct,
        `
      import '../../../output/envelope.js';
      import '../../../acts/dd/build.js';
      import '../../../adapters/fs/node-fs.js';
      import 'node:fs';
        `,
      ],
      [transitive, `import '../../sensors/snapshot.js';`],
      [intermediary, `import '../../output/envelope.js';`],
    ]);
    expect(isolationViolations([direct, transitive], sources)).toEqual([
      'output: services/dd/render/direct-violation.ts -> output/envelope.ts',
      'acts: services/dd/render/direct-violation.ts -> acts/dd/build.ts',
      'adapters: services/dd/render/direct-violation.ts -> adapters/fs/node-fs.ts',
      'node builtin: services/dd/render/direct-violation.ts -> node:fs',
      'output: services/dd/render/transitive-violation.ts -> services/sensors/snapshot.ts -> output/envelope.ts',
    ]);
  });

  it('keeps the production renderer transitively free of output, acts, adapters, and node builtins', () => {
    const files = tsFiles(SRC);
    const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
    expect(isolationViolations(tsFiles(RENDER), sources)).toEqual([]);
  });

  it('marks every dependency-cruiser dd-render boundary as transitive', () => {
    const config = require(join(CLI_ROOT, '..', '..', '.dependency-cruiser.cjs')) as {
      forbidden: Array<{ name: string; to?: { reachable?: boolean }; from?: { path?: string } }>;
    };
    for (const name of [
      'dd-render-never-imports-output',
      'dd-render-never-imports-acts',
      'dd-render-never-imports-node-adapters',
    ]) {
      const rule = config.forbidden.find((entry) => entry.name === name);
      expect(rule?.to?.reachable).toBe(true);
      expect(rule?.from?.path).toBe('^harness/cli/src/services/dd/render');
    }
  });
});
