import { afterEach, describe, expect, it } from 'vitest';
import { createSyntheticPlan, type SyntheticCorpus } from '../support/dd-corpus.js';
import { runCli } from '../support/run-cli.js';

/**
 * `harness plan validate` — the SEMANTIC layer (tk-7021..tk-7024).
 *
 * Every check here is proven against the shipped `builder/*` schemas via the
 * synthetic corpus factory, never a mock schema: a contradiction engine written
 * perfectly against relations ships INERT if the real schema stops declaring
 * them, and only a test that goes through the real package can notice.
 */
describe('harness plan validate — semantics', () => {
  let corpus: SyntheticCorpus;
  let previousCwd = '';

  const build = (options: Parameters<typeof createSyntheticPlan>[0]) => {
    corpus = createSyntheticPlan(options);
    previousCwd = process.cwd();
    process.chdir(corpus.root);
  };

  afterEach(() => {
    // Restore FIRST, and only if we actually moved: vitest reuses a worker across
    // files, so a suite that leaves the process parked in a deleted temp
    // directory poisons whatever file runs next in that worker.
    if (previousCwd.length > 0) process.chdir(previousCwd);
    previousCwd = '';
    corpus?.cleanup();
  });

  const validate = (...args: string[]) =>
    runCli(['plan', 'validate', corpus.planRelative, ...args]);

  interface Data {
    mode: string;
    summary?: string;
    counts: {
      error: number;
      warn: number;
      semantic?: { open: number; contradictions: number; orphans: number; in_scope: number };
    };
    findings: Array<{ class: string; address: string; rel?: string; counterpart?: string }>;
  }

  const data = (result: Awaited<ReturnType<typeof runCli>>): Data =>
    (result.envelope?.status === 'error'
      ? result.envelope.error?.details
      : result.envelope?.data) as Data;

  /** The relations that currently contradict — the sharpest reading of a walk step. */
  const rels = (result: Awaited<ReturnType<typeof runCli>>): string[] =>
    data(result)
      .findings.filter((finding) => finding.class === 'contradiction')
      .map((finding) => finding.rel ?? '')
      .sort();

  /** A plan whose single task claims to be done while its assertion is not. */
  const CONTRADICTORY = {
    acceptance: [{ id: 'ac-0001', claim: 'it works' }],
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
            assertions: [{ id: 'dw-0001', assertion: 'it holds', pressure: 'not-applicable' }],
          },
        ],
      },
    ],
  };

  const CONSISTENT = {
    acceptance: [{ id: 'ac-0001', claim: 'it works' }],
    phases: [
      {
        id: 'ph-0001',
        title: 'core',
        tasks: [
          {
            id: 'tk-0001',
            title: 'build it',
            satisfies: ['ac-0001'],
            assertions: [{ id: 'dw-0001', assertion: 'it holds', pressure: 'not-applicable' }],
          },
        ],
      },
    ],
  };

  describe('the contradiction engine (tk-7021)', () => {
    it('PLANTED BAD: a done task resting on an open assertion warns, via `derives`', async () => {
      build(CONTRADICTORY);
      const result = await validate();
      expect(result.code).toBe(0);
      expect(result.envelope?.status).toBe('degraded');
      const contradiction = data(result).findings.find(
        (finding) => finding.class === 'contradiction' && finding.rel === 'derives',
      );
      expect(contradiction?.address).toContain('tasks/tk-0001');
      // The target is the assertion LIST, which has no state of its own — its
      // doneness is derived from its members, and that is what `derives` means.
      expect(contradiction?.counterpart).toContain('done_when/tk-0001');
    });

    it('PLANTED BAD: fires through `satisfies` too — the check is rel-generic', async () => {
      build({
        acceptance: [{ id: 'ac-0001', claim: 'it works' }],
        phases: [
          {
            id: 'ph-0001',
            title: 'core',
            // A CLOSED task claiming to satisfy an OPEN criterion. Written once
            // against relations, so this fires from the same code path as the
            // `derives` case with nothing rel-specific in it.
            tasks: [{ id: 'tk-0001', title: 'build it', state: 'checked', satisfies: ['ac-0001'] }],
          },
        ],
      });
      const result = await validate();
      const contradiction = data(result).findings.find(
        (finding) => finding.class === 'contradiction',
      );
      expect(contradiction?.rel).toBe('satisfies');
      expect(contradiction?.counterpart).toContain('acceptance_criteria/ac-0001');
    });

    it('GOOD TWIN: consistent-open stays silent — an open plan is not a wrong plan', async () => {
      build(CONSISTENT);
      const result = await validate();
      expect(result.code).toBe(0);
      expect(result.envelope?.status).toBe('ok');
      expect(data(result).findings).toStrictEqual([]);
    });

    it('GOOD TWIN: evidence-ready-but-unclaimed stays silent', async () => {
      // The assertion is proven; the task has not yet said so. That is a person
      // being careful, not a document contradicting itself.
      build({
        acceptance: [{ id: 'ac-0001', claim: 'it works' }],
        phases: [
          {
            id: 'ph-0001',
            title: 'core',
            tasks: [
              {
                id: 'tk-0001',
                title: 'build it',
                state: 'unchecked',
                satisfies: ['ac-0001'],
                assertions: [
                  {
                    id: 'dw-0001',
                    assertion: 'it holds',
                    state: 'checked',
                    pressure: 'not-applicable',
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(data(await validate()).findings).toStrictEqual([]);
    });

    it('reports a contradiction under EVERY mode — it is wrong now, not merely unfinished', async () => {
      build(CONTRADICTORY);
      for (const args of [[], ['--complete']]) {
        expect(rels(await validate(...args))).toStrictEqual(['derives', 'satisfies']);
      }
    });
  });

  describe('the mid-flight summary line (tk-7022)', () => {
    it('emits ONE info line and ZERO per-row warnings', async () => {
      build(CONSISTENT);
      const result = await validate();
      expect(result.envelope?.status).toBe('ok');
      const body = data(result);
      expect(body.mode).toBe('summary');
      expect(body.findings).toStrictEqual([]);
      expect(body.summary).toContain('completable item(s) are still open');
      expect(body.summary).toContain('--complete');
      expect(result.envelope?.next_action).toBe(body.summary);
    });

    it('says nothing at all when there is nothing open', async () => {
      build({
        acceptance: [{ id: 'ac-0001', claim: 'it works', state: 'checked' }],
        phases: [
          {
            id: 'ph-0001',
            title: 'core',
            state: 'checked',
            tasks: [
              {
                id: 'tk-0001',
                title: 'build it',
                state: 'checked',
                satisfies: ['ac-0001'],
                assertions: [
                  {
                    id: 'dw-0001',
                    assertion: 'it holds',
                    state: 'checked',
                    pressure: 'not-applicable',
                  },
                ],
              },
            ],
          },
        ],
      });
      const result = await validate();
      expect(result.envelope?.status).toBe('ok');
      expect(data(result).summary).toBeUndefined();
    });
  });

  describe('--complete (tk-7023)', () => {
    it('green means EXACTLY zero errors and zero warnings', async () => {
      build({
        acceptance: [{ id: 'ac-0001', claim: 'it works', state: 'checked' }],
        phases: [
          {
            id: 'ph-0001',
            title: 'core',
            state: 'checked',
            tasks: [
              {
                id: 'tk-0001',
                title: 'build it',
                state: 'checked',
                satisfies: ['ac-0001'],
                assertions: [
                  {
                    id: 'dw-0001',
                    assertion: 'it holds',
                    state: 'checked',
                    pressure: 'not-applicable',
                  },
                ],
              },
            ],
          },
        ],
      });
      const result = await validate('--complete');
      expect(result.code).toBe(0);
      expect(result.envelope?.status).toBe('ok');
      expect(data(result).counts).toMatchObject({ error: 0, warn: 0 });
    });

    it('warns per row for every open completable', async () => {
      build(CONSISTENT);
      const body = data(await validate('--complete'));
      const opens = body.findings.filter((finding) => finding.class === 'open-completable');
      // The phase, the task and the assertion are each open in their own right.
      expect(opens.map((finding) => finding.address.split('#')[1]).sort()).toStrictEqual([
        'acceptance_criteria/ac-0001',
        'done_when/tk-0001/dw-0001',
        'phases/ph-0001',
        'tasks/tk-0001',
      ]);
      expect(body.summary).toBeUndefined();
    });

    it('PLANTED BAD: an orphan criterion warns under --complete only', async () => {
      build({
        // Nothing satisfies ac-0002 — a criterion no work accounts for.
        acceptance: [
          { id: 'ac-0001', claim: 'it works' },
          { id: 'ac-0002', claim: 'nobody claims me' },
        ],
        phases: [
          {
            id: 'ph-0001',
            title: 'core',
            tasks: [{ id: 'tk-0001', title: 'a', satisfies: ['ac-0001'] }],
          },
        ],
      });
      const mid = data(await validate());
      expect(mid.findings.filter((finding) => finding.class === 'orphan-claim')).toStrictEqual([]);

      const strict = data(await validate('--complete'));
      const orphans = strict.findings.filter((finding) => finding.class === 'orphan-claim');
      expect(orphans).toHaveLength(1);
      expect(orphans[0]?.address).toContain('acceptance_criteria/ac-0002');
    });
  });

  describe('--address scoping (tk-7024)', () => {
    const TWO_PHASES = {
      acceptance: [
        { id: 'ac-0001', claim: 'phase one claim' },
        { id: 'ac-0002', claim: 'phase two claim' },
      ],
      phases: [
        {
          id: 'ph-0001',
          title: 'first',
          tasks: [
            {
              id: 'tk-0001',
              title: 'one',
              satisfies: ['ac-0001'],
              assertions: [{ id: 'dw-0001', assertion: 'a', pressure: 'not-applicable' }],
            },
          ],
        },
        {
          id: 'ph-0002',
          title: 'second',
          tasks: [
            {
              id: 'tk-0002',
              title: 'two',
              satisfies: ['ac-0002'],
              assertions: [{ id: 'dw-0002', assertion: 'b', pressure: 'not-applicable' }],
            },
          ],
        },
      ],
    };

    it("a phase-scoped run cannot see another phase's open rows", async () => {
      build(TWO_PHASES);
      const body = data(await validate('--address', `${corpus.planRelative}#phases/ph-0001`));
      const addresses = body.findings.map((finding) => finding.address);
      expect(addresses.some((address) => address.includes('phase-1'))).toBe(true);
      expect(addresses.some((address) => address.includes('phase-2'))).toBe(false);
      expect(addresses.some((address) => address.includes('ph-0002'))).toBe(false);
    });

    it('is per-row WITHOUT --complete: a scoped question deserves a scoped answer', async () => {
      build(TWO_PHASES);
      const body = data(await validate('--address', `${corpus.planRelative}#phases/ph-0001`));
      expect(body.mode).toBe('scoped');
      expect(body.summary).toBeUndefined();
      expect(body.findings.some((finding) => finding.class === 'open-completable')).toBe(true);
    });

    it('an AC-scoped run pulls in the INCOMING work that accounts for it', async () => {
      build(TWO_PHASES);
      const body = data(
        await validate('--address', `${corpus.planRelative}#acceptance_criteria/ac-0001`),
      );
      const addresses = body.findings.map((finding) => finding.address);
      // Outbound from an AC reaches nothing; the interesting arm points the other
      // way, which is exactly why the closure takes one inbound `satisfies` step.
      expect(addresses.some((address) => address.includes('tasks/tk-0001'))).toBe(true);
      expect(addresses.some((address) => address.includes('tk-0002'))).toBe(false);
    });

    it('refuses an address that resolves outside the plan rather than answering about nothing', async () => {
      build(TWO_PHASES);
      const result = await validate('--address', `${corpus.planRelative}#meta`);
      expect(result.code).toBe(0);
      const outside = await validate('--address', `${corpus.planRelative}#nowhere/x`);
      expect(outside.code).toBe(1);
      expect(outside.envelope?.error?.code).toBe('E458');
    });
  });

  /**
   * The lifecycle-mutation suite (tk-7027): drive one corpus through the state
   * transitions a real journey makes, asserting the verdict at every step.
   *
   * Point fixtures prove a rule at one moment. A plan is a thing that MOVES, and
   * the interesting failures are transitions — a tick that should have cleared a
   * warning and did not, an untick that should have re-opened one and did not.
   */
  describe('lifecycle mutations (tk-7027)', () => {
    const tasks = () => corpus.taskFileRelative('ph-0001');
    const set = (address: string, value: string) => runCli(['dd', 'set', address, value]);

    it('walks tick -> contradiction -> resolve -> untick -> block -> human-skip', async () => {
      build(CONSISTENT);

      // 0. Consistent and open: silent.
      expect(data(await validate()).findings).toStrictEqual([]);

      // 1. TICK the task while its assertion is open — TWO contradictions
      //    appear, one per relation the task claims through.
      await set(`${tasks()}#tasks/tk-0001/state`, 'checked');
      expect(rels(await validate())).toStrictEqual(['derives', 'satisfies']);

      // 2. TICK the assertion — the `derives` contradiction clears. The
      //    `satisfies` one does NOT: the task still claims to close a criterion
      //    that is open, and each relation is answered on its own terms.
      await set(`${tasks()}#done_when/tk-0001/dw-0001/state`, 'checked');
      expect(rels(await validate())).toStrictEqual(['satisfies']);

      // 3. TICK the criterion too — now nothing is inconsistent.
      await set(`${corpus.planRelative}#acceptance_criteria/ac-0001/state`, 'checked');
      expect(data(await validate()).findings).toStrictEqual([]);

      // 4. UNTICK the assertion — it comes straight back. A cleared warning that
      //    cannot return is a warning that was never really computed.
      await set(`${tasks()}#done_when/tk-0001/dw-0001/state`, 'unchecked');
      expect(rels(await validate())).toStrictEqual(['derives']);

      // 5. BLOCK the assertion (with the note its state requires). Blocked is not
      //    terminal, so the task claiming done still contradicts it.
      await set(`${tasks()}#done_when/tk-0001/dw-0001/note`, 'waiting on an upstream fix');
      await set(`${tasks()}#done_when/tk-0001/dw-0001/state`, 'blocked');
      expect(rels(await validate())).toStrictEqual(['derives']);

      // 6. HUMAN-SKIP it, with the verbatim receipt the rule demands. That IS
      //    terminal, so the contradiction clears — a human's recorded decision
      //    closes a row exactly as evidence does.
      await set(
        `${tasks()}#done_when/tk-0001/dw-0001/receipt`,
        'Jordan, 2026-08-04: skip it, the smoke test covers this.',
      );
      await set(`${tasks()}#done_when/tk-0001/dw-0001/state`, 'human-skipped');
      expect(data(await validate()).findings).toStrictEqual([]);
    });

    it('JIT-birth of an assertion list re-opens a task that had nothing to prove', async () => {
      build({
        acceptance: [{ id: 'ac-0001', claim: 'it works', state: 'checked' }],
        phases: [
          {
            id: 'ph-0001',
            title: 'core',
            state: 'checked',
            tasks: [{ id: 'tk-0001', title: 'build it', state: 'checked', satisfies: ['ac-0001'] }],
          },
        ],
      });
      // Nothing is open and nothing is unclaimed: --complete is green.
      expect((await validate('--complete')).envelope?.status).toBe('ok');

      // Now the task's proof is born — open, and pointed at by the task row.
      const born = await runCli([
        'dd',
        'add',
        `${tasks()}#done_when/tk-0001`,
        '[{"id":"dw-0001","assertion":"born late","state":"unchecked","pressure":"not-applicable"}]',
      ]);
      expect(born.envelope?.status).toBe('ok');
      const linked = await set(`${tasks()}#tasks/tk-0001/done`, '#done_when/tk-0001');
      expect(linked.envelope?.status).toBe('ok');

      const after = await validate('--complete');
      expect(after.envelope?.status).toBe('degraded');
      const classes = data(after).findings.map((finding) => finding.class);
      expect(classes).toContain('contradiction');
      expect(classes).toContain('open-completable');
    });

    it('adding an unclaimed criterion turns a green --complete red, and claiming it turns it back', async () => {
      build({
        acceptance: [{ id: 'ac-0001', claim: 'it works', state: 'checked' }],
        phases: [
          {
            id: 'ph-0001',
            title: 'core',
            state: 'checked',
            tasks: [{ id: 'tk-0001', title: 'build it', state: 'checked', satisfies: ['ac-0001'] }],
          },
        ],
      });
      expect((await validate('--complete')).envelope?.status).toBe('ok');

      const minted = await runCli([
        'dd',
        'add',
        `${corpus.planRelative}#acceptance_criteria`,
        '{"claim":"a late claim","state":"checked"}',
        '--mint',
        'ac',
      ]);
      const id = (minted.envelope?.data as { minted: string }).minted;
      expect(id).toBe('ac-0002');

      const orphaned = await validate('--complete');
      expect(orphaned.envelope?.status).toBe('degraded');
      expect(data(orphaned).findings.map((finding) => finding.class)).toContain('orphan-claim');

      // Claim it, and --complete goes green again.
      await runCli([
        'dd',
        'set',
        `${tasks()}#tasks/tk-0001/satisfies`,
        '["../../../plan.dd.json#acceptance_criteria/ac-0001","../../../plan.dd.json#acceptance_criteria/ac-0002"]',
        '--value-json',
      ]);
      expect((await validate('--complete')).envelope?.status).toBe('ok');
    });
  });
});
