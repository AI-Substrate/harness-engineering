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
  ['validate', "command('validate <path>')", '`dd validate <path> [--depth <n>] [--json]`'],
  ['schema', "command('list')", '`dd schema list [--json]`'],
  ['schema', "command('show <name>')", '`dd schema show <name> [--json]`'],
  ['docs', "command('list')", '`dd docs list [--json]`'],
  ['docs', "command('get <id>')", '`dd docs get <id> [--json]`'],
  ['build', "command('build <path>')", '`dd build <path> [--check] [--json]`'],
  [
    'address',
    "command('generate <interior>')",
    '`dd address generate <interior> [--path <path>] [--json]`',
  ],
  [
    'address',
    "command('validate <address>')",
    '`dd address validate <address> [--resolve] [--json]`',
  ],
  ['link', "command('resolve <address>')", '`dd link resolve <address> [--json]`'],
  [
    'link',
    "command('verify-basis <address>')",
    '`dd link verify-basis <address> --sha <sha> [--json]`',
  ],
  ['links', "command('links <target>')", '`dd links <target> [--json]`'],
  ['graph', "command('graph')", '`dd graph [--json]`'],
  ['doctor', "command('doctor')", '`dd doctor [--json]`'],
] as const;

describe('dd frozen surface manifest', () => {
  it.each(SURFACE)('%s source and manifest both carry %s', (file, codeNeedle, manifestNeedle) => {
    expect(source(file)).toContain(codeNeedle);
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
  });
});
