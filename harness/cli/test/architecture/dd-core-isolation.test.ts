import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORE = join(CLI_ROOT, 'src', 'services', 'dd', 'core');
const SRC = join(CLI_ROOT, 'src');
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

describe('architecture — dd-core isolation', () => {
  it('detects deliberate direct and transitive boundary violations', () => {
    const direct = join(CORE, 'direct-violation.ts');
    const transitive = join(CORE, 'transitive-violation.ts');
    const intermediary = join(SRC, 'services', 'sensors', 'snapshot.ts');
    const sources = new Map([
      [
        direct,
        `
      import '../../../output/envelope.js';
      import '../../../acts/flow.js';
      import '../../../adapters/fs/node-fs.js';
        `,
      ],
      [transitive, `import '../../sensors/snapshot.js';`],
      [intermediary, `import '../../output/envelope.js';`],
    ]);
    expect(isolationViolations([direct, transitive], sources)).toEqual([
      'output: services/dd/core/direct-violation.ts -> output/envelope.ts',
      'acts: services/dd/core/direct-violation.ts -> acts/flow.ts',
      'adapters: services/dd/core/direct-violation.ts -> adapters/fs/node-fs.ts',
      'output: services/dd/core/transitive-violation.ts -> services/sensors/snapshot.ts -> output/envelope.ts',
    ]);
  });

  it('marks every dependency-cruiser dd-core boundary as transitive', () => {
    const config = require(join(CLI_ROOT, '..', '..', '.dependency-cruiser.cjs')) as {
      forbidden: Array<{ name: string; to?: { reachable?: boolean } }>;
    };
    for (const name of [
      'dd-core-never-imports-output',
      'dd-core-never-imports-acts',
      'dd-core-never-imports-node-adapters',
    ]) {
      expect(config.forbidden.find((rule) => rule.name === name)?.to?.reachable).toBe(true);
    }
  });

  it('keeps production dd-core transitively free of output, acts, adapters, and node builtins', () => {
    const files = tsFiles(SRC);
    const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
    expect(isolationViolations(tsFiles(CORE), sources)).toEqual([]);
  });
});
