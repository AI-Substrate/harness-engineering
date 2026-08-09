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

/**
 * What the walk actually looked at, so a PASS can say so.
 *
 * `violations` alone cannot distinguish "examined 400 specifiers and found no
 * boundary crossing" from "examined nothing". Both render as `[]`. Plan 108's
 * D6 was exactly that: a filter discarded every candidate and the guard reported
 * PASS. So the funnel is counted, and the counts are asserted at the stage that
 * can silently empty — not at the walk, which was never the fragile part.
 *
 * `packageSpecifiers` is the one that matters and the one no assertion can
 * usefully bound. `importTarget` resolves ONLY relative specifiers, so a package
 * import is not a miss — it is deliberately out of scope, and correct while `dd`
 * is in-tree. The moment `dd` is consumed AS A PACKAGE the same line silently
 * retires this entire boundary, and every assertion here still passes. Counting
 * exclusions rather than survivors is what puts that on the record: a survivor
 * count stays healthy on the strength of the remaining in-tree imports and says
 * nothing about the category it never considered.
 */
interface IsolationReading {
  violations: string[];
  entryFiles: number;
  specifiers: number;
  /** Specifiers deliberately NOT resolved because they name a package, not a path. */
  packageSpecifiers: number;
  /** Relative specifiers resolved to a target — the last narrowing stage before the verdict. */
  resolvedTargets: number;
}

function isolationViolations(
  entryFiles: readonly string[],
  sources: ReadonlyMap<string, string>,
): IsolationReading {
  const violations: string[] = [];
  const visited = new Set<string>();
  let specifiers = 0;
  let packageSpecifiers = 0;
  let resolvedTargets = 0;

  const visit = (file: string, trace: readonly string[]): void => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = sources.get(file);
    if (source === undefined) return;

    for (const specifier of importSpecifiers(source)) {
      specifiers += 1;
      if (specifier.startsWith('node:')) {
        violations.push(`node builtin: ${[...trace, specifier].join(' -> ')}`);
        continue;
      }
      const target = importTarget(file, specifier);
      if (target === null) {
        packageSpecifiers += 1;
        continue;
      }
      resolvedTargets += 1;
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
  return {
    violations,
    entryFiles: entryFiles.length,
    specifiers,
    packageSpecifiers,
    resolvedTargets,
  };
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
    expect(isolationViolations([direct, transitive], sources).violations).toEqual([
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
    const entries = tsFiles(CORE);
    const reading = isolationViolations(entries, sources);

    // The corpus, and then the stage that can silently empty. `entryFiles > 0`
    // alone would not have caught plan 108's D6 shape — there the WALK was fine
    // and the FILTER discarded everything, so the guard passed having classified
    // nothing. Assert at the last narrowing stage before the predicate whose
    // emptiness means PASS, which here is "relative specifiers resolved to a
    // target", not "violations" (violations going to zero IS the green state).
    expect(reading.entryFiles).toBeGreaterThan(0);
    expect(reading.resolvedTargets).toBeGreaterThan(0);

    // PRINTED, never asserted. An asserted denominator churns on every file added
    // and a floor is a threshold nobody maintains — both rot. Printing makes a
    // silent success legible without pretending to be a control: it catches the
    // 3-of-300 case that no non-zero assertion can express, at the cost of
    // needing a human to read it. That limit is real and is the point of saying
    // so here rather than letting a green tick imply coverage.
    //
    // `packages` is the number to watch. It is deliberately unasserted: package
    // specifiers are correctly out of scope while `dd` is in-tree, and the day
    // `dd` is consumed as a package that count carries the whole boundary — every
    // assertion above still passes.
    console.error(
      `dd-core isolation — examined ${reading.entryFiles} entry file(s), ` +
        `${reading.specifiers} specifier(s): ${reading.resolvedTargets} resolved, ` +
        `${reading.packageSpecifiers} package(s) NOT resolved (out of scope while dd is in-tree), ` +
        `${reading.violations.length} violation(s)`,
    );

    expect(reading.violations).toEqual([]);
  });
});
