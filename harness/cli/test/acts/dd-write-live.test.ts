import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSyntheticPlan, type SyntheticCorpus } from '../support/dd-corpus.js';
import { failWriteMidWay } from '../support/partial-write.js';
import { runCli } from '../support/run-cli.js';

/**
 * The writer verbs live (ac-7019 / tk-7028).
 *
 * Every assertion here is about a property that only exists once real bytes are
 * on a real disk: that a refused mutation wrote NOTHING, that a successful one
 * left the sibling current, and that the CLI — not the caller — chose the id.
 */
describe('harness dd get/set/add/rm — live', () => {
  let corpus: SyntheticCorpus;
  let previousCwd = '';

  beforeEach(() => {
    corpus = createSyntheticPlan({
      acceptance: [{ id: 'ac-0001', claim: 'the thing works' }],
      phases: [
        {
          id: 'ph-0001',
          title: 'core',
          tasks: [
            {
              id: 'tk-0001',
              title: 'build it',
              satisfies: ['ac-0001'],
              assertions: [{ id: 'dw-0001', assertion: 'it builds', pressure: 'not-applicable' }],
            },
            { id: 'tk-0002', title: 'prove it' },
          ],
        },
      ],
    });
    previousCwd = process.cwd();
    process.chdir(corpus.root);
  });

  afterEach(() => {
    // Restore FIRST, and only if we actually moved: vitest reuses a worker across
    // files, so a suite that leaves the process parked in a deleted temp
    // directory poisons whatever file runs next in that worker.
    if (previousCwd.length > 0) process.chdir(previousCwd);
    previousCwd = '';
    corpus?.cleanup();
  });

  const tasks = () => corpus.taskFileRelative('ph-0001');

  it('reads section, instance and part addresses (dw-0281)', async () => {
    const section = await runCli(['dd', 'get', `${tasks()}#tasks`]);
    expect(section.code).toBe(0);
    expect((section.envelope?.data as { kind: string }).kind).toBe('section');
    expect((section.envelope?.data as { value: unknown[] }).value).toHaveLength(2);

    const instance = await runCli(['dd', 'get', `${tasks()}#tasks/tk-0002`]);
    expect((instance.envelope?.data as { kind: string }).kind).toBe('instance');

    const part = await runCli(['dd', 'get', `${tasks()}#tasks/tk-0002/state`]);
    expect((part.envelope?.data as { value: string }).value).toBe('unchecked');
  });

  it('reads the same values in human mode (dw-0281)', async () => {
    const human = await runCli(['dd', 'get', `${tasks()}#tasks/tk-0002/title`], 'human');
    expect(human.code).toBe(0);
    expect(human.out).toContain('prove it');
  });

  it('refuses a schema-violating set and writes NOTHING (dw-0282)', async () => {
    const before = readFileSync(corpus.taskFiles['ph-0001'] as string, 'utf8');
    const result = await runCli(['dd', 'set', `${tasks()}#tasks/tk-0001/state`, 'donezo']);
    expect(result.code).toBe(1);
    expect(result.envelope?.error?.code).toBe('E451');
    expect((result.envelope?.error?.details as { written: boolean }).written).toBe(false);
    const issues = (result.envelope?.error?.details as { issues: { class: string }[] }).issues;
    expect(issues[0]?.class).toBe('enum-invalid');
    expect(readFileSync(corpus.taskFiles['ph-0001'] as string, 'utf8')).toBe(before);
  });

  it('refuses a schema-violating add and writes NOTHING (dw-0282)', async () => {
    const before = readFileSync(corpus.taskFiles['ph-0001'] as string, 'utf8');
    const result = await runCli([
      'dd',
      'add',
      `${tasks()}#tasks`,
      '{"id":"tk-0001","title":"clash","state":"unchecked"}',
    ]);
    expect(result.code).toBe(1);
    expect(result.envelope?.error?.code).toBe('E451');
    expect(readFileSync(corpus.taskFiles['ph-0001'] as string, 'utf8')).toBe(before);
  });

  it('rebuilds the .dd.md sibling in the same operation (dw-0283)', async () => {
    const sibling = `${(corpus.taskFiles['ph-0001'] as string).replace(/\.json$/, '')}.md`;
    expect(existsSync(sibling)).toBe(false);

    const result = await runCli(['dd', 'set', `${tasks()}#tasks/tk-0002/title`, 'proven']);
    expect(result.code).toBe(0);
    expect((result.envelope?.data as { sibling_regenerated: boolean }).sibling_regenerated).toBe(
      true,
    );
    expect(readFileSync(sibling, 'utf8')).toContain('proven');
  });

  it('refuses the mutation and restores the source when the sibling cannot be written (dw-0283)', async () => {
    // Best-effort regeneration is what this replaces: the verb used to write the
    // source, warn that the sibling failed, and still report `written: true` —
    // manufacturing exactly the source/sibling drift `dd build --check` exists to
    // catch. A directory parked on the sibling path makes that write fail for
    // real, on any platform, without chmod games.
    const source = corpus.taskFiles['ph-0001'] as string;
    const sibling = `${source.replace(/\.json$/, '')}.md`;
    const before = readFileSync(source, 'utf8');
    mkdirSync(sibling);

    const result = await runCli(['dd', 'set', `${tasks()}#tasks/tk-0002/title`, 'proven']);

    // (a) the envelope is a refusal, not a warning attached to a success
    expect(result.code).toBe(1);
    expect(result.envelope?.error?.code).toBe('E452');
    expect(result.envelope?.error?.details).toMatchObject({
      stage: 'sibling',
      written: false,
      source_restored: true,
    });
    // (b) the source on disk is byte-identical to before the call
    expect(readFileSync(source, 'utf8')).toBe(before);
    // (c) nothing stale was left where the sibling would have gone
    expect(statSync(sibling).isDirectory()).toBe(true);
    expect(readdirSync(sibling)).toEqual([]);
  });

  it('leaves the sibling UNTOUCHED when its write gives way MID-WAY (dw-0283)', async () => {
    // The control above parks a directory on the sibling path, so the write fails
    // at `open` and the file is never touched — all-or-nothing by luck. This one
    // injects the failure that actually happens on a full or failing disk: some
    // bytes land, then the write throws. `writeFileSync` opens with `O_TRUNC`, so
    // writing the live `.dd.md` destroys the old bytes BEFORE the new ones are
    // committed. Without staging, the rollback restores only the `.dd.json` and
    // the verb returns E452 saying the document was left unchanged — while the
    // repo carries a half-written sibling, the exact drift the either-both-or-
    // neither contract exists to make impossible.
    const source = corpus.taskFiles['ph-0001'] as string;
    const sibling = `${source.replace(/\.json$/, '')}.md`;

    // A first, clean mutation so there IS an existing sibling to be truncated.
    expect((await runCli(['dd', 'set', `${tasks()}#tasks/tk-0002/title`, 'first'])).code).toBe(0);
    const sourceBefore = readFileSync(source, 'utf8');
    const siblingBefore = readFileSync(sibling, 'utf8');
    expect(siblingBefore.length).toBeGreaterThan(0);

    // Matches the staging temp too — a matcher pinned to `.dd.md` would inject
    // nothing once the write moved to `.dd.md.tmp`.
    failWriteMidWay(/\.dd\.md(\.[^/\\]+)?$/);
    const result = await runCli(['dd', 'set', `${tasks()}#tasks/tk-0002/title`, 'second']);

    expect(result.code).toBe(1);
    expect(result.envelope?.error?.code).toBe('E452');
    expect(result.envelope?.error?.details).toMatchObject({
      stage: 'sibling',
      written: false,
      source_restored: true,
    });
    // The refusal's claim, checked against the disk rather than taken on trust.
    expect(readFileSync(source, 'utf8')).toBe(sourceBefore);
    expect(readFileSync(sibling, 'utf8')).toBe(siblingBefore);
    // ...and no half-written scrap survives the refusal.
    expect(readdirSync(dirname(sibling)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('mints the next collision-free id under a registered prefix (dw-0284)', async () => {
    const first = await runCli([
      'dd',
      'add',
      `${tasks()}#tasks`,
      '{"title":"third","state":"unchecked"}',
      '--mint',
      'tk',
    ]);
    expect((first.envelope?.data as { minted: string }).minted).toBe('tk-0003');

    const second = await runCli([
      'dd',
      'add',
      `${tasks()}#tasks`,
      '{"title":"fourth","state":"unchecked"}',
      '--mint',
      'tk',
    ]);
    expect((second.envelope?.data as { minted: string }).minted).toBe('tk-0004');

    const doc = JSON.parse(readFileSync(corpus.taskFiles['ph-0001'] as string, 'utf8')) as {
      sections: { name: string; value: { id: string }[] }[];
    };
    const ids = doc.sections.find((s) => s.name === 'tasks')?.value.map((row) => row.id);
    expect(ids).toStrictEqual(['tk-0001', 'tk-0002', 'tk-0003', 'tk-0004']);
    expect(new Set(ids).size).toBe(4);
  });

  it('refuses an unregistered mint prefix rather than inventing one (dw-0284)', async () => {
    const result = await runCli([
      'dd',
      'add',
      `${tasks()}#tasks`,
      '{"title":"x","state":"unchecked"}',
      '--mint',
      'zz',
    ]);
    expect(result.code).toBe(1);
    expect(result.envelope?.error?.code).toBe('E454');
  });

  it('creates a JIT-born assertion list, then appends to it with a minted id', async () => {
    const born = await runCli([
      'dd',
      'add',
      `${tasks()}#done_when/tk-0002`,
      '[{"id":"dw-0002","assertion":"first","state":"unchecked","pressure":"not-applicable"}]',
    ]);
    expect(born.code).toBe(0);

    const appended = await runCli([
      'dd',
      'add',
      `${tasks()}#done_when/tk-0002`,
      '{"assertion":"second","state":"unchecked","pressure":"not-applicable"}',
      '--mint',
      'dw',
    ]);
    expect((appended.envelope?.data as { minted: string }).minted).toBe('dw-0003');

    const doc = JSON.parse(readFileSync(corpus.taskFiles['ph-0001'] as string, 'utf8')) as {
      sections: { name: string; value: Record<string, { id: string }[]> }[];
    };
    const entries = doc.sections.find((s) => s.name === 'done_when')?.value['tk-0002'];
    expect(entries?.map((entry) => entry.id)).toStrictEqual(['dw-0002', 'dw-0003']);
  });

  it('removes an array member and a whole map entry', async () => {
    const removed = await runCli(['dd', 'rm', `${tasks()}#tasks/tk-0002`]);
    expect(removed.code).toBe(0);
    const doc = JSON.parse(readFileSync(corpus.taskFiles['ph-0001'] as string, 'utf8')) as {
      sections: { name: string; value: { id: string }[] }[];
    };
    expect(doc.sections.find((s) => s.name === 'tasks')?.value).toHaveLength(1);
  });

  it('refuses a bare-# address, an unknown section and a path escape', async () => {
    const bare = await runCli(['dd', 'get', '#tasks']);
    expect(bare.envelope?.error?.code).toBe('E405');

    const unknown = await runCli(['dd', 'get', `${tasks()}#nowhere`]);
    expect(unknown.envelope?.error?.code).toBe('E450');

    const outside = await runCli(['dd', 'get', '../outside.dd.json#tasks']);
    expect(outside.envelope?.error?.code).toBe('E433');
  });
});
