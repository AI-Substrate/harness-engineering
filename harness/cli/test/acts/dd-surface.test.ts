import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../src/output/error-codes.js';

const MANIFEST = readFileSync(
  new URL(
    '../../../../docs/plans/065-deterministic-documents/tasks/phase-1-dd-core-foundations/dd-surface.md',
    import.meta.url,
  ),
  'utf8',
);

function source(name: string): string {
  return readFileSync(new URL(`../../src/acts/dd/${name}.ts`, import.meta.url), 'utf8');
}

const SURFACE = [
  {
    file: 'validate',
    codeNeedles: [
      "command('validate <path>')",
      ".option('--depth <n>', 'outbound traversal depth (0 = this document only)', '3')",
    ],
    manifestNeedle: '`dd validate <path> [--depth <n>] [--json]`',
  },
  {
    file: 'schema',
    codeNeedles: ["command('list')"],
    manifestNeedle: '`dd schema list [--json]`',
  },
  {
    file: 'schema',
    codeNeedles: ["command('show <name>')"],
    manifestNeedle: '`dd schema show <name> [--json]`',
  },
  {
    file: 'docs',
    codeNeedles: ["command('list')"],
    manifestNeedle: '`dd docs list [--json]`',
  },
  {
    file: 'docs',
    codeNeedles: ["command('get <id>')"],
    manifestNeedle: '`dd docs get <id> [--json]`',
  },
  {
    file: 'build',
    codeNeedles: ["command('build <path>')", ".option('--check'"],
    manifestNeedle: '`dd build <path> [--check] [--json]`',
  },
  {
    file: 'address',
    codeNeedles: ["command('generate <interior>')", ".option('--path <path>'"],
    manifestNeedle: '`dd address generate <interior> [--path <path>] [--json]`',
  },
  {
    file: 'address',
    codeNeedles: ["command('validate <address>')", ".option('--resolve'"],
    manifestNeedle: '`dd address validate <address> [--resolve] [--json]`',
  },
  {
    file: 'link',
    codeNeedles: ["command('resolve <address>')"],
    manifestNeedle: '`dd link resolve <address> [--json]`',
  },
  {
    file: 'link',
    codeNeedles: ["command('verify-basis <address>')", ".requiredOption('--sha <sha>'"],
    manifestNeedle: '`dd link verify-basis <address> --sha <sha> [--json]`',
  },
  {
    file: 'links',
    codeNeedles: ["command('links <target>')"],
    manifestNeedle: '`dd links <target> [--json]`',
  },
  {
    file: 'graph',
    codeNeedles: ["command('graph')"],
    manifestNeedle: '`dd graph [--json]`',
  },
  {
    file: 'doctor',
    codeNeedles: ["command('doctor')"],
    manifestNeedle: '`dd doctor [--json]`',
  },
] as const;

describe('dd frozen surface manifest', () => {
  it.each(SURFACE)('$file source and manifest carry the complete frozen signature', ({
    file,
    codeNeedles,
    manifestNeedle,
  }) => {
    const actSource = source(file);
    for (const codeNeedle of codeNeedles) {
      expect(actSource).toContain(codeNeedle);
    }
    expect(MANIFEST).toContain(manifestNeedle);
  });

  it('records every E400-E449 name and value', () => {
    const entries = Object.entries(ErrorCodes).filter(([, value]) => /^E4\d\d$/.test(value));
    expect(entries).toHaveLength(50);
    for (const [name, value] of entries) {
      expect(MANIFEST).toContain(`| ${value} | \`${name}\``);
    }
  });

  it('records the one-way extension reservations', () => {
    expect(MANIFEST).toContain('`dd doctor` scope/options');
    expect(MANIFEST).toContain('`dd graph` emit/scope options');
    expect(MANIFEST).toContain(
      '`dd link verify-basis` explicit re-verification mutation semantics',
    );
    expect(MANIFEST).toContain('`dd address validate --resolve` segment classification');
  });
});
