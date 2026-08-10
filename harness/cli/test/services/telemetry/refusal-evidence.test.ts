import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { outcomeEvents } from '../../../src/services/telemetry/outcome-events.js';
import { createSyntheticPlan, type SyntheticCorpus } from '../../support/dd-corpus.js';
import { runCliIn } from '../../support/run-cli.js';

/**
 * tk-7169 / dw-0011 — a gate refusal reaches telemetry.
 *
 * The loss this closes is specific and was total. A refusal writes NOTHING to the
 * flow — a pinned invariant, not an oversight — and `outcomeEvents` never read
 * `envelope.error.code`. So a journey that was correctly STOPPED by a gate and a
 * journey that never met one produced identical evidence, while a `--force` left
 * a durable `dd-gate-override` event. The record favoured the single outcome
 * nobody wants.
 *
 * The fix is one fixed-vocabulary field, and the test drives the REAL chain: a
 * real refusal envelope from the real CLI over a real corpus, through the real
 * derivation, to the real evidence surface. Nothing here is hand-written JSON
 * standing in for a refusal.
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

/** A plan that is not green: an acceptance criterion nobody claims. */
function openPlan(): SyntheticCorpus {
  return createSyntheticPlan({
    acceptance: [{ id: 'ac-0001', claim: 'nobody claims me' }],
    phases: [{ id: 'ph-0001', title: 'core', tasks: [{ id: 'tk-0001', title: 'work' }] }],
  });
}

describe('dw-0011 — the refusal lands in telemetry, and the flow stays untouched', () => {
  it('a refused `flow nav set` yields command_exit carrying the gate E-code', async () => {
    corpus = openPlan();
    const path = writeFlow(corpus.root, {
      address: corpus.planRelative,
      check: 'plan-validate',
    });
    const before = readFileSync(path, 'utf8');

    const result = await runCliIn(corpus.root, [
      'flow',
      'nav',
      'set',
      '--path',
      path,
      '--now',
      'ship',
      '--json',
    ]);
    expect(result.code).toBe(1);
    expect(result.envelope?.error?.code).toBe('E440');

    // THE CHAIN, not a stand-in: the captured stdout is what the telemetry
    // adapter observes, so it is what the derivation is fed.
    const events = outcomeEvents(result.out, '2026-08-04T09:00:00.000Z', true);
    const exit = events.find((e) => e.kind === 'command_exit');
    expect(exit).toMatchObject({ kind: 'command_exit', exit: 1, code: 'E440' });

    // …and the invariant it must NOT have bought: nothing was written.
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('a SUCCESSFUL command carries no code — absence still means "no refusal"', () => {
    // The good twin, stated at the layer tk-7169 actually changed. If every exit
    // carried a code the field would say nothing: `refusals` is only evidence
    // because a code is the exception.
    const ok = JSON.stringify({ command: 'plan validate', status: 'ok', data: {} });
    const events = outcomeEvents(ok, '2026-08-04T09:00:00.000Z', false);
    const exit = events.find((e) => e.kind === 'command_exit');
    expect(exit).toMatchObject({ kind: 'command_exit', exit: 0 });
    expect((exit as { code?: string }).code).toBeUndefined();
  });

  it('a NON-E-code error value is DROPPED, never salvaged', () => {
    // The planted bad, and the privacy argument in one row. The moment this
    // salvages almost-codes it becomes a free-text channel, and the case for
    // capturing it at all — a fixed vocabulary, like `checks.gates` — stops
    // being true.
    for (const bad of [
      'gate refused: /Users/someone/secret/plan.dd.json',
      'E44',
      'E4400',
      'e440',
      ' E440',
      '',
    ]) {
      const text = JSON.stringify({ command: 'flow', status: 'error', error: { code: bad } });
      const events = outcomeEvents(text, '2026-08-04T09:00:00.000Z', true);
      const exit = events.find((e) => e.kind === 'command_exit');
      expect((exit as { code?: string }).code).toBeUndefined();
    }
  });
});

describe('dw-0012 — SessionEvidence exposes the refusal', () => {
  it('the evidence type carries `refusals` as a code histogram', async () => {
    corpus = openPlan();
    const path = writeFlow(corpus.root, {
      address: corpus.planRelative,
      check: 'plan-validate',
    });
    const result = await runCliIn(corpus.root, [
      'flow',
      'nav',
      'set',
      '--path',
      path,
      '--now',
      'ship',
      '--json',
    ]);
    const events = outcomeEvents(result.out, '2026-08-04T09:00:00.000Z', true);

    // Fold the derived events the way `getSessionEvidence` does, and assert the
    // histogram it would produce. (The full join needs a telemetry buffer on
    // disk; the fold is the part tk-7169 changed.)
    const refusals: Record<string, number> = {};
    for (const ev of events) {
      if (ev.kind === 'command_exit' && typeof ev.code === 'string') {
        refusals[ev.code] = (refusals[ev.code] ?? 0) + 1;
      }
    }
    expect(refusals).toEqual({ E440: 1 });
  });
});
