import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSyntheticPlan, type SyntheticCorpus } from '../support/dd-corpus.js';
import { runCliIn } from '../support/run-cli.js';

/**
 * tk-7135 / dw-0008 — `harness flow orient` over a REAL check gate.
 *
 * `orient` evaluates LIVE (it can resolve, so it does), and for a check gate that
 * means running the plan validator at the moment the agent asks what to do next.
 * The block it prints is the findings, not pips: a check gate's single item would
 * render as one square saying nothing, whereas the findings ARE the work standing
 * between the agent and departure — the same list the refusal would print, shown
 * before they hit it.
 *
 * Real disk, real program, real builder schemas. The flow act takes its filesystem
 * from the injected port, so this uses `runCliIn` rather than the fake-rooted
 * runner.
 */

let corpus: SyntheticCorpus | undefined;

afterEach(() => {
  corpus?.cleanup();
  corpus = undefined;
});

const FLOW_RELATIVE = '.harness/flows/gate.json';

function writeFlow(root: string, link: Record<string, unknown>): string {
  const path = join(root, FLOW_RELATIVE);
  mkdirSync(join(root, '.harness', 'flows'), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        schema_version: 1,
        kind: 'flight-plan',
        slug: 'gate',
        nav: { now: 'review-1', next: null },
        created_at: '2026-08-04T00:00:00.000Z',
        provenance: {
          record_kind: 'flow',
          harness_version: '0.4.0',
          branch: 'main',
          repo: null,
          created_at: '2026-08-04T00:00:00.000Z',
          agent: null,
          plan_id: null,
        },
        events: [],
        nodes: [
          {
            id: 'review-1',
            type: 'review',
            label: 'Review: P1',
            status: 'in_progress',
            next: ['ship'],
            dd_link: link,
          },
          { id: 'ship', type: 'ship', label: 'Ship', status: 'assumed', next: [] },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return path;
}

/** A plan that does NOT hang together: an AC nobody claims. */
function openPlan(): SyntheticCorpus {
  return createSyntheticPlan({
    acceptance: [{ id: 'ac-0001', claim: 'nobody claims me' }],
    phases: [{ id: 'ph-0001', title: 'core', tasks: [{ id: 'tk-0001', title: 'work' }] }],
  });
}

describe('dw-0008 — orient surfaces a check gate live', () => {
  it('prints the check by name, the verdict, and every finding', async () => {
    corpus = openPlan();
    const path = writeFlow(corpus.root, {
      address: corpus.planRelative,
      check: 'plan-validate',
    });
    const result = await runCliIn(corpus.root, ['flow', 'orient', '--path', path], 'human');

    expect(result.code).toBe(0);
    expect(result.out).toContain('dd gate (plan-validate)');
    expect(result.out).toContain('✕ holds');
    // The findings are the block's content — and each one's own sentence, not a
    // count of them.
    expect(result.out).toContain('open-completable');
  });

  it('--json carries the findings structurally, for an agent that parses', async () => {
    corpus = openPlan();
    const path = writeFlow(corpus.root, {
      address: corpus.planRelative,
      check: 'plan-validate',
    });
    const result = await runCliIn(corpus.root, ['flow', 'orient', '--path', path, '--json']);

    const gate = (result.envelope?.data as { dd_gate?: Record<string, unknown> }).dd_gate;
    expect(gate).toBeDefined();
    expect(gate?.check).toBe('plan-validate');
    expect(gate?.status).toBe('incomplete');
    expect(Array.isArray(gate?.findings)).toBe(true);
    expect((gate?.findings as unknown[]).length).toBeGreaterThan(0);
    // The rail above the block agrees with it — the whole reason `railDoc` swaps in
    // the live reading. A rail saying `✓` over a block saying `holds` is the surface
    // telling a reader they may depart.
    expect(result.envelope?.data).toMatchObject({ rail: expect.stringContaining('plan-validate') });
  });

  it('a GREEN plan orients as open, with no findings — the good twin', async () => {
    corpus = createSyntheticPlan({
      acceptance: [{ id: 'ac-0001', claim: 'the thing works', state: 'checked' }],
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
                  assertion: 'it builds',
                  state: 'checked',
                  pressure: 'not-applicable',
                },
              ],
            },
          ],
        },
      ],
    });
    const path = writeFlow(corpus.root, {
      address: corpus.planRelative,
      check: 'plan-validate',
    });
    const result = await runCliIn(corpus.root, ['flow', 'orient', '--path', path, '--json']);

    const gate = (result.envelope?.data as { dd_gate?: Record<string, unknown> }).dd_gate;
    expect(gate?.status).toBe('complete');
    expect(gate?.findings).toEqual([]);
  });

  it('an unimplemented check orients as unevaluable, never as open', async () => {
    corpus = openPlan();
    const path = writeFlow(corpus.root, { address: corpus.planRelative, check: 'plan-vibes' });
    const result = await runCliIn(corpus.root, ['flow', 'orient', '--path', path, '--json']);

    const gate = (result.envelope?.data as { dd_gate?: Record<string, unknown> }).dd_gate;
    expect(gate?.status).toBe('unevaluable');
    expect(String(gate?.problem)).toContain('does not implement');
  });
});
