import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DdReportedIssue, nextActionFor } from '../../src/acts/dd/shared.js';
import type { VerbActDeps } from '../../src/acts/verb.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { buildProgram } from '../../src/app.js';
import type { Envelope } from '../../src/output/envelope.js';
import type { CliIo, Writers } from '../../src/output/output-port.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';
import { createSyntheticPlan, type SyntheticCorpus } from '../support/dd-corpus.js';
import { runCli } from '../support/run-cli.js';

/**
 * The FACT-ADDRESS control.
 *
 * > **One shared fact has one address in the envelope.**
 * > Flow position is at `data.now` — in every command that reports flow position.
 *
 * The invariant deliberately is NOT "families are uniform". Legitimate divergence
 * exists — `dd set <value>` vs `dd add <json>` is designed and frozen — and a test
 * whose failures are usually exemptions is a test people learn to silence. Facts
 * have canonical addresses; families do not have canonical uniformity. So no
 * exemption list is needed here: there is no command for which "position lives
 * somewhere else" is ever correct.
 *
 * ## RATCHET, NOT DETECTOR
 *
 * **This freezes facts we have been bitten by; it cannot find the next one —
 * FX012 was found by a human in the field.** Read the pass as "these two facts
 * cannot drift again", never as "the class of envelope-address drift is closed".
 * Adding a fact here is a deliberate act after a finding, not a sweep this file
 * performs on its own. That limit is stated HERE, in the control, because a
 * control whose limits live in a doc gets read as closing the class.
 *
 * ## Canonical PRESENCE, never EXCLUSIVITY
 *
 * Every assertion below says "the fact IS at its canonical address". None says
 * "and nowhere else". FX012's fix is ADDITIVE — `nav show` keeps its nested
 * `data.nav` object and gains flat `data.now`/`data.next` alongside it — so the
 * value legitimately lives at two addresses afterwards, and an exclusivity
 * assertion would fail the fix on the day it lands.
 */

const EMPTY: VerbRegistry = { verbs: [], records: [] };
const FLOW_DIR = '/repo/.harness';

function fakeDeps(fs: FakeFs): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs,
    env: new FakeEnv({}, '/home/u'),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    clock: new FakeClock('2026-08-06T00:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

async function runFlow(deps: VerbActDeps, argv: string[]): Promise<Envelope> {
  let out = '';
  const writers: Writers = {
    out: (text) => {
      out += text;
    },
    err: () => {},
  };
  const io: CliIo = { mode: 'json', writers };
  vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exit');
  }) as never);
  await expect(
    buildProgram('0.0.0-test', io, deps, EMPTY).parseAsync(['node', 'harness', ...argv]),
  ).rejects.toThrow(/^exit/);
  vi.restoreAllMocks();
  return JSON.parse(out.trim()) as Envelope;
}

async function seed(bare = false): Promise<VerbActDeps> {
  const fs = new FakeFs();
  fs.mkdirp(FLOW_DIR);
  const deps = fakeDeps(fs);
  const argv = ['flow', 'create', 'harness-loop', '--slug', 'demo'];
  if (bare) argv.push('--bare');
  await runFlow(deps, argv);
  return deps;
}

/** The canonical address, read positionally: `data.now`, present or not. */
function positionAt(envelope: Envelope): { present: boolean; value: unknown } {
  const data = (envelope.data ?? {}) as Record<string, unknown>;
  return { present: Object.hasOwn(data, 'now'), value: data.now };
}

describe('fact-address control: flow position is at `data.now`', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * The whole family in one pass. `nav show` is the member FX012 caught reporting
   * position at `data.nav.now` while every sibling reported it at `data.now`;
   * `test/acts/flow.test.ts` asserted both shapes nine lines apart without
   * noticing, which is exactly the failure a fact-address control exists to make
   * loud.
   */
  it('reports position at data.now in every command that reports position', async () => {
    // A BARE flow carries no `nav` at all — the state where `data.nav.now` is a
    // null dereference and the flat, `?? null`-normalised address is the only
    // safe read.
    const empty = await seed(true);
    const unpositioned = new Map<string, Envelope>([
      ['flow show', await runFlow(empty, ['flow', 'show', '--slug', 'demo'])],
      ['flow nav show', await runFlow(empty, ['flow', 'nav', 'show', '--slug', 'demo'])],
      ['flow orient --json', await runFlow(empty, ['flow', 'orient', '--slug', 'demo', '--json'])],
    ]);
    for (const [command, envelope] of unpositioned) {
      const { present, value } = positionAt(envelope);
      expect(present, `${command} must report position at data.now`).toBe(true);
      expect(value, `${command} must normalise "no position" to null`).toBeNull();
    }

    const deps = await seed();
    const positioned = new Map<string, Envelope>([
      [
        'flow nav set',
        await runFlow(deps, ['flow', 'nav', 'set', '--slug', 'demo', '--now', 'backpressure']),
      ],
      ['flow show', await runFlow(deps, ['flow', 'show', '--slug', 'demo'])],
      ['flow nav show', await runFlow(deps, ['flow', 'nav', 'show', '--slug', 'demo'])],
      ['flow orient --json', await runFlow(deps, ['flow', 'orient', '--slug', 'demo', '--json'])],
    ]);
    for (const [command, envelope] of positioned) {
      const { present, value } = positionAt(envelope);
      expect(present, `${command} must report position at data.now`).toBe(true);
      expect(value, `${command} must report the position it was moved to`).toBe('backpressure');
    }
  });

  /**
   * PRESENCE, not exclusivity — stated as its own case so a later reader cannot
   * "tighten" the family assertion above into an exclusivity check without
   * deleting this one on purpose.
   */
  it('leaves the nested `data.nav` object in place — the fix is additive', async () => {
    const deps = await seed();
    await runFlow(deps, ['flow', 'nav', 'set', '--slug', 'demo', '--now', 'backpressure']);
    const show = await runFlow(deps, ['flow', 'nav', 'show', '--slug', 'demo']);
    const data = show.data as { nav: { now: string } | null };
    expect(data.nav?.now).toBe('backpressure');
  });
});

describe('fact-address control: a typed link failure carries a class-specific remedy', () => {
  let corpus: SyntheticCorpus;
  let previousCwd = '';

  afterEach(() => {
    if (previousCwd.length > 0) process.chdir(previousCwd);
    previousCwd = '';
    corpus?.cleanup();
    vi.restoreAllMocks();
  });

  /**
   * The remedy for a typed dd finding is addressed at the envelope's
   * `next_action`, and it is the SHARED mapper's answer — on every surface that
   * reports one. FX013: `dd validate` was the one surface that never routed
   * through `nextActionFor`, so a bad address inside an authored document — the
   * likeliest way to meet one — answered with generic text while the same failure
   * on `dd address validate` / `dd link resolve` answered with its remedy.
   */
  it('answers with the shared mapper on every surface that reports one', async () => {
    corpus = createSyntheticPlan({
      phases: [
        {
          id: 'ph-0001',
          title: 'core',
          tasks: [
            // A malformed address, planted where a real one belongs: the failure a
            // reader actually meets, inside an authored document.
            { id: 'tk-0001', title: 'build it', satisfies: ['not an address'] },
          ],
        },
      ],
    });
    previousCwd = process.cwd();
    process.chdir(corpus.root);

    // Each surface: how it is invoked, and the SUBJECT it reports on (the
    // address it was asked about, or the document it was asked to validate).
    const surfaces = new Map<string, { argv: string[]; subject: string }>([
      [
        'dd address validate',
        {
          argv: ['dd', 'address', 'validate', 'gone.dd.json#rows/x', '--resolve'],
          subject: 'gone.dd.json#rows/x',
        },
      ],
      [
        'dd link resolve',
        { argv: ['dd', 'link', 'resolve', 'not an address'], subject: 'not an address' },
      ],
      [
        'dd validate',
        {
          argv: ['dd', 'validate', corpus.taskFileRelative('ph-0001')],
          subject: corpus.taskFileRelative('ph-0001'),
        },
      ],
    ]);

    for (const [command, { argv, subject }] of surfaces) {
      const run = await runCli(argv);
      expect(run.envelope?.status, `${command} must report the planted failure`).toBe('error');
      const details = (run.envelope?.error?.details ?? {}) as {
        issues?: DdReportedIssue[];
      };
      // The remedy must answer the finding the envelope actually REPORTED — the
      // one whose message became the error message — not merely some finding in
      // the list.
      const reported = (details.issues ?? []).filter(
        (issue) => issue.message === run.envelope?.error?.message,
      );
      expect(reported.length, `${command} must carry the typed finding it reported`).toBe(1);
      expect(
        run.envelope?.next_action,
        `${command} must answer with the shared remedy mapper, not verb-local generic text`,
      ).toBe(nextActionFor(reported, subject));
    }
  });
});
