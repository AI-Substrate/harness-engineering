import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../src/output/error-codes.js';
import { BUILTIN_RELS } from '../../src/services/dd/core/constants.js';
import { PLAN_CHECK_KINDS } from '../../src/services/dd/plan/index.js';

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
  {
    file: 'write',
    codeNeedles: ["command('get <address>')"],
    manifestNeedle: '`dd get <address> [--json]`',
  },
  {
    file: 'write',
    codeNeedles: ["command('set <address> <value>')", ".option('--value-json'"],
    manifestNeedle: '`dd set <address> <value> [--value-json] [--json]`',
  },
  {
    file: 'write',
    codeNeedles: ["command('add <address> <json>')", ".option('--mint <prefix>'"],
    manifestNeedle: '`dd add <address> <json> [--mint <prefix>] [--json]`',
  },
  {
    file: 'write',
    codeNeedles: ["command('rm <address>')"],
    manifestNeedle: '`dd rm <address> [--json]`',
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

  it('records every E400-E459 name and value', () => {
    const entries = Object.entries(ErrorCodes).filter(([, value]) => /^E4\d\d$/.test(value));
    // Sixty-three, not sixty: plan 070 Phase 1 opened E450-E459, plan 071
    // ph-7103 opened E460-E469, and plan 072 took E462 for the readiness gate —
    // each by the one-line renegotiation recorded in the manifest. The count is
    // adjusted DELIBERATELY — never loosened to a range — so a code that ships
    // without a manifest row still fails here.
    expect(entries).toHaveLength(63);
    for (const [name, value] of entries) {
      expect(MANIFEST).toContain(`| ${value} | \`${name}\``);
    }
  });

  it('freezes exactly the five built-in link relations, and fails on a sixth', () => {
    // The manifest is the registry; the code follows it. Counting the rows is what
    // makes adding a rel a DELIBERATE renegotiation rather than an import away.
    const table = MANIFEST.split('## Frozen link relations')[1]?.split(
      '## Frozen flow gate kinds',
    )[0];
    const rows = [...(table ?? '').matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1]);
    expect(rows).toStrictEqual([...BUILTIN_RELS]);
    expect(rows).toHaveLength(5);
  });

  it('freezes the flow gate kinds, and fails on an unregistered one', () => {
    // Same discipline as the rels, for the same reason: a second gate kind changes
    // what a departure MEANS, so it arrives by renegotiation or not at all. The
    // completion kind is listed too — an unnamed default is how a surface quietly
    // acquires a second one.
    const table = MANIFEST.split('## Frozen flow gate kinds')[1]?.split('## Error allocation')[0];
    const rows = [...(table ?? '').matchAll(/^\| (?:`([a-z-]+)`|(completion)) \|/gm)].map(
      (match) => match[1] ?? match[2],
    );
    expect(rows).toStrictEqual(['completion', ...PLAN_CHECK_KINDS]);
    expect(rows).toHaveLength(2);
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
