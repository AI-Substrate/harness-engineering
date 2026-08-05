import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkFence,
  type FenceRow,
  fenceMatches,
  readFenceRows,
} from '../../src/acts/plan/fence.js';
import type { DdDoc } from '../../src/services/dd/core/model.js';
import { runCli } from '../support/run-cli.js';

/**
 * tk-7171 / dw-000c, ac-7120 — dispatch fences are data.
 *
 * This plan's own phase 1 shipped a fence violation that only a human reviewer
 * caught, because the brief instructed a mechanism and left out the file the
 * mechanism lived in. Prose cannot be checked; rows can. These controls hold the
 * two properties that make the difference real: an out-of-fence path is refused
 * by NAMING the row that refused it, and a rule that has outlived its cause is
 * visible as data rather than remembered.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FENCE = 'docs/how/dd/exemplar/fence/dispatch.dd.json';

const row = (over: Partial<FenceRow> & Pick<FenceRow, 'id' | 'pattern' | 'mode'>): FenceRow => ({
  owner: 'orchestrator',
  cause: 'because',
  ...over,
});

describe('dw-000c — the glob is small enough to predict', () => {
  it.each([
    ['harness/cli/src/**', 'harness/cli/src/acts/plan/fence.ts', true],
    ['harness/cli/src/**', 'harness/cli/src/index.ts', true],
    ['harness/cli/src/**', 'harness/cli/test/x.ts', false],
    ['docs/plans/**', 'docs/plans/071-x/plan.dd.json', true],
    ['**/the-flow.json', 'docs/plans/071-x/the-flow.json', true],
    ['**/the-flow.json', 'the-flow.json', true],
    ['**/the-flow.json', 'docs/the-flow.json.bak', false],
    // A single star stops at a separator; that is the whole difference.
    ['docs/*.md', 'docs/README.md', true],
    ['docs/*.md', 'docs/how/README.md', false],
    ['docs/?.md', 'docs/a.md', true],
    ['docs/?.md', 'docs/ab.md', false],
    // Unanchored patterns match from the repository root, so a row cannot mean
    // different things depending on where the reader stands.
    ['plan.dd.json', 'docs/plans/071-x/plan.dd.json', false],
  ])('%s vs %s → %s', (pattern, path, expected) => {
    expect(fenceMatches(pattern, path)).toBe(expected);
  });

  it('matches a trailing ** against the directory itself, not only its children', () => {
    // The bug this pins: `harness/cli/src/**` first compiled to a pattern that
    // required a trailing slash, so every in-fence file was reported OUT of
    // fence and every forbid row silently missed. A fence that refuses
    // everything is as useless as one that refuses nothing, and both look like
    // the tool working.
    expect(fenceMatches('a/b/**', 'a/b/c.ts')).toBe(true);
    expect(fenceMatches('a/b/**', 'a/b/c/d.ts')).toBe(true);
    expect(fenceMatches('a/b/**', 'a/bc.ts')).toBe(false);
  });
});

describe('dw-000c — the check refuses, and says which row refused', () => {
  const rows: FenceRow[] = [
    row({ id: 'fn-0001', pattern: 'src/**', mode: 'allow' }),
    row({ id: 'fn-0003', pattern: 'docs/plans/**', mode: 'forbid', cause: 'not yours to write' }),
  ];

  it('passes a path an allow row covers', () => {
    const reading = checkFence(rows, ['src/a.ts']);
    expect(reading.violations).toEqual([]);
  });

  it('FIRES on a forbidden path, naming the row and its cause', () => {
    const reading = checkFence(rows, ['docs/plans/071/plan.dd.json']);
    expect(reading.violations).toHaveLength(1);
    expect(reading.violations[0]).toMatchObject({
      row: 'fn-0003',
      reason: 'forbidden',
      cause: 'not yours to write',
    });
  });

  it('FIRES on a path no allow row covers — an allow-list is a fence, not a hint', () => {
    const reading = checkFence(rows, ['scripts/whatever.mjs']);
    expect(reading.violations).toHaveLength(1);
    expect(reading.violations[0]?.reason).toBe('not-allowed');
  });

  it('lets FORBID beat ALLOW — a prohibition cannot be widened away', () => {
    // The ordering that fails safe. Written the other way round, adding a broad
    // allow row later would quietly unlock everything an earlier forbid row
    // named, and nobody amending the fence would see it happen.
    const overlapping = [
      row({ id: 'fn-0001', pattern: '**', mode: 'allow' }),
      row({ id: 'fn-0003', pattern: 'docs/plans/**', mode: 'forbid' }),
    ];
    expect(checkFence(overlapping, ['docs/plans/x.json']).violations[0]?.row).toBe('fn-0003');
    expect(checkFence(overlapping, ['anything/else.ts']).violations).toEqual([]);
  });

  it('treats a forbid-ONLY fence as a blocklist, not a total prohibition', () => {
    // With no allow rows, "not covered" must not mean "refused" — otherwise a
    // partial fence silently becomes a total one.
    const blocklist = [row({ id: 'fn-0003', pattern: 'docs/**', mode: 'forbid' })];
    expect(checkFence(blocklist, ['src/a.ts']).violations).toEqual([]);
    expect(checkFence(blocklist, ['docs/a.md']).violations).toHaveLength(1);
  });

  it('reports a row that has outlived its cause', () => {
    const expiring = [
      row({ id: 'fn-0004', pattern: 'src/**', mode: 'allow', expiry: '2026-01-01' }),
    ];
    const reading = checkFence(expiring, ['src/a.ts'], { now: '2026-08-04' });
    expect(reading.violations).toEqual([]);
    expect(reading.expired).toEqual([
      { row: 'fn-0004', expiry: '2026-01-01', owner: 'orchestrator' },
    ]);
    // Still in date → silent.
    expect(checkFence(expiring, ['src/a.ts'], { now: '2025-12-01' }).expired).toEqual([]);
  });
});

describe('dw-000c — a half-written fence refuses to act as one', () => {
  const doc = (rows: unknown): DdDoc =>
    ({ dd: { schema: 'builder/fence' }, sections: [{ name: 'rows', value: rows }] }) as DdDoc;

  it('refuses a document with no rows section', () => {
    const result = readFenceRows({ dd: { schema: 'x' }, sections: [] } as unknown as DdDoc);
    expect(result.ok).toBe(false);
  });

  it('refuses a row missing the fields that make a refusal explainable', () => {
    // A fence row without an owner or a cause can still REFUSE work — and then
    // nobody knows who may lift it or why it exists. That is worse than no
    // fence, because it is unarguable.
    const result = readFenceRows(doc([{ id: 'fn-0001', pattern: 'src/**', mode: 'allow' }]));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('fn-0001');
  });
});

describe('dw-000c — the shipped fence document, end to end', () => {
  // The `plan` and `dd` acts are their own composition roots: they build a
  // NodeFs and read `process.cwd()` rather than taking the injected process
  // port. Driven from anywhere else these controls measure the test runner's own
  // directory and pass vacuously.
  let previousCwd = '';
  beforeEach(() => {
    previousCwd = process.cwd();
    process.chdir(REPO_ROOT);
  });
  afterEach(() => {
    if (previousCwd.length > 0) process.chdir(previousCwd);
    previousCwd = '';
  });

  it('validates as a builder/fence document', async () => {
    const validated = await runCli(['dd', 'validate', FENCE]);
    expect(validated.code).toBe(0);
  });

  it('passes in-fence paths and REFUSES an out-of-fence one at the CLI', async () => {
    const ok = await runCli([
      'plan',
      'fence',
      FENCE,
      '--paths',
      'harness/cli/src/acts/plan/fence.ts',
      '--now',
      '2026-08-04',
    ]);
    expect(ok.code).toBe(0);

    const refused = await runCli([
      'plan',
      'fence',
      FENCE,
      '--paths',
      'docs/plans/071-dd-native-builder/plan.dd.json',
      '--now',
      '2026-08-04',
    ]);
    expect(refused.code).not.toBe(0);
    expect(refused.envelope?.error?.code).toBe('E460');
    // The two things a refusal must carry to be actionable rather than annoying.
    expect(refused.envelope?.error?.message).toContain(
      'docs/plans/071-dd-native-builder/plan.dd.json',
    );
    expect(refused.envelope?.error?.message).toContain('fn-0003');
    expect(refused.envelope?.next_action).toContain('Do not widen the fence yourself');
  });

  it('carries owner, cause and expiry on every row — an amendment has an author', () => {
    const fence = JSON.parse(readFileSync(`${REPO_ROOT}${FENCE}`, 'utf8')) as {
      sections: Array<{ name: string; value: unknown }>;
    };
    const rows = fence.sections.find((section) => section.name === 'rows')?.value as Array<
      Record<string, unknown>
    >;
    expect(rows.length).toBeGreaterThan(0);
    for (const fenceRow of rows) {
      expect(typeof fenceRow.owner).toBe('string');
      expect(typeof fenceRow.cause).toBe('string');
      expect(typeof fenceRow.expiry).toBe('string');
    }
  });
});
