import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORE = join(CLI_ROOT, 'src', 'services', 'dd', 'core');
const SRC = join(CLI_ROOT, 'src');

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

function classifyImport(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith('node:')) return 'node builtin';
  if (!specifier.startsWith('.')) return null;
  const target = normalize(resolve(dirname(fromFile), specifier.replace(/\.js$/, '.ts')));
  const relativeTarget = relative(SRC, target).replaceAll('\\', '/');
  if (relativeTarget.startsWith('output/')) return 'output';
  if (relativeTarget.startsWith('acts/')) return 'acts';
  if (relativeTarget.startsWith('adapters/')) return 'adapters';
  return null;
}

function isolationViolations(fromFile: string, source: string): string[] {
  return importSpecifiers(source).flatMap((specifier) => {
    const kind = classifyImport(fromFile, specifier);
    return kind ? [`${kind}: ${specifier}`] : [];
  });
}

describe('architecture — dd-core isolation', () => {
  it('detects a deliberate output/act/adapter violation fixture', () => {
    const fixture = `
      import '../../../output/envelope.js';
      import '../../../acts/flow.js';
      import '../../../adapters/fs/node-fs.js';
    `;
    expect(isolationViolations(join(CORE, 'violation.ts'), fixture)).toEqual([
      'output: ../../../output/envelope.js',
      'acts: ../../../acts/flow.js',
      'adapters: ../../../adapters/fs/node-fs.js',
    ]);
  });

  it('keeps production dd-core free of harness output, acts, adapters, and node builtins', () => {
    const offenders = tsFiles(CORE).flatMap((file) =>
      isolationViolations(file, readFileSync(file, 'utf8')).map(
        (violation) => `${relative(CLI_ROOT, file)} -> ${violation}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
