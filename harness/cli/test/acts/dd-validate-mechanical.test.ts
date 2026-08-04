import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSyntheticPlan, type SyntheticCorpus } from '../support/dd-corpus.js';
import { runCli } from '../support/run-cli.js';

/**
 * `dd validate` stays MECHANICAL (tk-7026 / dw-0261).
 *
 * Plan 070 gave `harness plan validate` opinions — contradictions, open rows,
 * unclaimed criteria. This pin is the other half of that bargain: `dd validate`
 * answers exactly one question, "is this document well-formed against its
 * schema?", and its answer did not move. The separation is what lets a gate
 * choose which question it is asking; a mechanical check that quietly started
 * reporting judgement calls would break every consumer that trusted it not to.
 */
describe('dd validate — byte-for-byte mechanical (dw-0261)', () => {
  let corpus: SyntheticCorpus;
  let previousCwd = '';

  beforeEach(() => {
    corpus = createSyntheticPlan({
      // Deliberately full of things the SEMANTIC layer has opinions about: a task
      // ticked over an open assertion, and a criterion nothing claims.
      acceptance: [
        { id: 'ac-0001', claim: 'claimed' },
        { id: 'ac-0002', claim: 'nobody claims me' },
      ],
      phases: [
        {
          id: 'ph-0001',
          title: 'core',
          tasks: [
            {
              id: 'tk-0001',
              title: 'build it',
              state: 'checked',
              satisfies: ['ac-0001'],
              assertions: [{ id: 'dw-0001', assertion: 'open', pressure: 'not-applicable' }],
            },
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

  it('reports ZERO findings on a corpus the semantic layer objects to', async () => {
    const mechanical = await runCli([
      'dd',
      'validate',
      corpus.taskFileRelative('ph-0001'),
      '--depth',
      '0',
    ]);
    expect(mechanical.code).toBe(0);
    expect(mechanical.envelope?.status).toBe('ok');
    const data = mechanical.envelope?.data as {
      counts: { error: number; warn: number };
      issues: unknown[];
    };
    expect(data.counts).toStrictEqual({ error: 0, warn: 0 });
    expect(data.issues).toStrictEqual([]);

    // The same corpus, asked the semantic question, is loud.
    const semantic = await runCli(['plan', 'validate', corpus.planRelative, '--complete']);
    expect(semantic.envelope?.status).toBe('degraded');
    expect(
      ((semantic.envelope?.data as { findings: unknown[] }).findings ?? []).length,
    ).toBeGreaterThan(0);
  });

  it('keeps its envelope shape: counts and issues, and no semantic keys', async () => {
    const result = await runCli(['dd', 'validate', corpus.planRelative, '--depth', '0']);
    const data = result.envelope?.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toStrictEqual(['counts', 'depth', 'issues', 'path', 'schema']);
    // Named explicitly: these are the keys `plan validate` grew, and `dd validate`
    // must never grow them. A weaker assertion would pass the day one leaks in.
    expect(data.findings).toBeUndefined();
    expect(data.summary).toBeUndefined();
    expect(data.mode).toBeUndefined();
  });

  it('still fails a document that is genuinely malformed', async () => {
    // The pin is "unchanged", not "toothless". Planted by hand rather than
    // through `dd set`, because the writer's own gate refuses to produce this.
    const target = join(corpus.folder, 'plan.dd.json');
    const doc = JSON.parse(readFileSync(target, 'utf8')) as {
      sections: Array<{ name: string; value: unknown }>;
    };
    const criteria = doc.sections.find((section) => section.name === 'acceptance_criteria');
    (criteria?.value as Array<Record<string, unknown>>)[0] = {
      id: 'ac-0001',
      claim: 'broken',
      state: 'donezo',
    };
    writeFileSync(target, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

    const broken = await runCli(['dd', 'validate', corpus.planRelative, '--depth', '0']);
    expect(broken.code).toBe(1);
    expect(broken.envelope?.error?.code).toBe('E407');
  });
});
