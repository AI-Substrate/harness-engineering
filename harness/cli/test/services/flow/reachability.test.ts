import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import {
  checkReachability,
  type ReachabilityDeps,
} from '../../../src/services/flow/reachability.js';

/**
 * Plan 081 phase 2 — the reachability CHECK, red-first (ac-0002/3/4/5).
 *
 * Two clauses, one reading: does this stream's plan document VALIDATE (clause 1,
 * obtained by shelling this same binary's `plan validate --json` — CLI-is-the-API,
 * never an import from `services/dd/**`), and does a flight plan EXIST and READ
 * BACK (clause 2, via `readFlowDoc`). The verdict composes them: plan
 * missing/invalid is an ERROR, a plan that validates with an unusable flight plan
 * is a DEGRADED warning (Jordan's ruling: a missing flight plan is a warning,
 * never a default-on gate), both good is OK.
 *
 * Every case asserts BOTH clauses. The failure mode this guards against is a
 * check that short-circuits on the first bad clause and then reports only the
 * survivors — which is exactly how the pij wave (AI-Substrate/pij#227) merged
 * 9/9 green with 0/9 flight plans.
 *
 * Pure over injected ports (FakeFs/FakeExec/FakeClock/FakeGit/FakeEnv); the
 * sibling `reachability-real-cli.test.ts` runs the same matrix against the real
 * built binary and the phase-1 fixtures.
 */

const REPO = '/repo';
const BIN = '/repo/harness/cli/bin/harness.js';
const PLAN_DIR = '/repo/docs/plans/081-flow-reachability';
const PLAN_DOC = `${PLAN_DIR}/plan.dd.json`;
const FLOW = `${PLAN_DIR}/the-flow.json`;

/** A `plan validate --json` success envelope, as the real CLI prints it. */
const PLAN_OK = JSON.stringify({
  command: 'plan validate',
  status: 'ok',
  timestamp: '2026-08-09T03:00:00.000Z',
  data: { path: PLAN_DOC, counts: { error: 0, warn: 0 } },
  next_action: 'Nothing to fix.',
});

/** The real envelope for a plan folder with no `plan.dd.json` (measured). */
const PLAN_ABSENT = JSON.stringify({
  command: 'plan validate',
  status: 'error',
  timestamp: '2026-08-09T03:00:00.000Z',
  error: { code: 'E400', message: `no plan document at ${PLAN_DOC}` },
  next_action: 'Scaffold one with `harness plan new <slug>`, or point at an existing plan folder.',
});

/** The real envelope for a `plan.dd.json` that exists but is not a dd document. */
const PLAN_INVALID = JSON.stringify({
  command: 'plan validate',
  status: 'error',
  timestamp: '2026-08-09T03:00:00.000Z',
  error: { code: 'E400', message: `${PLAN_DOC} is not a dd document` },
  next_action: 'Fix the reported location, then re-run.',
});

/** A CLI-stamped flight plan: has `provenance`, so it is not legacy. */
const GOOD_FLOW = JSON.stringify({
  schema_version: 1,
  kind: 'flight-plan',
  slug: '081-flow-reachability',
  provenance: { record_kind: 'flow', harness_version: '0.13.0' },
  events: [],
  nodes: [{ id: 'research', type: 'research', label: 'Research', status: 'in_progress' }],
});

/** Flow-shaped with NO `provenance` — the E308 legacy signature. */
const LEGACY_FLOW = JSON.stringify({
  nodes: [{ id: 'research', label: 'Research' }],
  cursor: 'research',
});

/** Valid JSON, valid provenance, but a major this CLI does not understand (E306). */
const FUTURE_FLOW = JSON.stringify({
  schema_version: 99,
  kind: 'flight-plan',
  slug: '081-flow-reachability',
  provenance: { record_kind: 'flow', harness_version: '99.0.0' },
  events: [],
  nodes: [],
});

function deps(
  files: Record<string, string>,
  planEnvelope: string,
  planCode = 0,
): { d: ReachabilityDeps; exec: FakeExec } {
  const exec = new FakeExec({ node: { code: planCode, stdout: planEnvelope } });
  const d: ReachabilityDeps = {
    fs: new FakeFs(files),
    clock: new FakeClock('2026-08-09T03:00:00.000Z'),
    git: new FakeGit({ isRepo: true, branch: 's081/flow-reachability' }),
    env: new FakeEnv({}),
    exec,
  };
  return { d, exec };
}

const OPTS = { planDir: PLAN_DIR, cwd: REPO, nodePath: 'node', binPath: BIN };

describe('ac-0004 — both good: plan validates AND the flight plan reads back', () => {
  it('is ok, with both clauses positive and nothing excluded', async () => {
    const { d } = deps({ [PLAN_DOC]: '{}', [FLOW]: GOOD_FLOW }, PLAN_OK);
    const res = await checkReachability(OPTS, d);

    expect(res.verdict).toBe('ok');
    expect(res.plan.present).toBe(true);
    expect(res.plan.validates).toBe(true);
    expect(res.flow.present).toBe(true);
    expect(res.flow.readable).toBe(true);
    expect(res.flow.reason).toBeUndefined();
    expect(res.examined).toEqual([PLAN_DOC, FLOW]);
    expect(res.excluded).toEqual([]);
  });
});

describe('ac-0003 — plan ok, flight plan absent: the degraded WARNING class', () => {
  it('is degraded (never error) with an `absent` reason and the bare create line', async () => {
    const { d } = deps({ [PLAN_DOC]: '{}' }, PLAN_OK);
    const res = await checkReachability(OPTS, d);

    expect(res.verdict).toBe('degraded');
    expect(res.plan.validates).toBe(true);
    expect(res.flow.present).toBe(false);
    expect(res.flow.readable).toBe(false);
    expect(res.flow.reason).toBe('absent');
    expect(res.next_action).toBe(
      'harness flow create flight-plan --slug 081-flow-reachability --path docs/plans/081-flow-reachability/the-flow.json --plan-dir docs/plans/081-flow-reachability',
    );
  });

  it('counts what was looked at AND what was missing, never only the survivors', async () => {
    const { d } = deps({ [PLAN_DOC]: '{}' }, PLAN_OK);
    const res = await checkReachability(OPTS, d);

    expect(res.examined).toEqual([PLAN_DOC, FLOW]);
    expect(res.excluded).toEqual([FLOW]);
  });
});

describe('ac-0005 — every unusable-flow class gets a DISTINCT reason', () => {
  it('E308 legacy is degraded and reads `legacy`, NOT `absent`', async () => {
    const { d } = deps({ [PLAN_DOC]: '{}', [FLOW]: LEGACY_FLOW }, PLAN_OK);
    const res = await checkReachability(OPTS, d);

    expect(res.verdict).toBe('degraded');
    expect(res.flow.reason).toBe('legacy');
    expect(res.flow.code).toBe('E308');
    // The file is THERE — a legacy flow is present-but-unusable, not missing.
    expect(res.flow.present).toBe(true);
    expect(res.flow.readable).toBe(false);
    // Not the bare create line: a legacy flow is a file that needs deciding
    // about, so the guidance is readFlowDoc's own clean-break message.
    expect(res.next_action).toContain('does not migrate legacy flows');
  });

  it('E300 malformed JSON reads `malformed`', async () => {
    const { d } = deps({ [PLAN_DOC]: '{}', [FLOW]: '{ not json' }, PLAN_OK);
    const res = await checkReachability(OPTS, d);

    expect(res.verdict).toBe('degraded');
    expect(res.flow.reason).toBe('malformed');
    expect(res.flow.code).toBe('E300');
    expect(res.flow.present).toBe(true);
  });

  it('E306 future-version reads `future-version`', async () => {
    const { d } = deps({ [PLAN_DOC]: '{}', [FLOW]: FUTURE_FLOW }, PLAN_OK);
    const res = await checkReachability(OPTS, d);

    expect(res.verdict).toBe('degraded');
    expect(res.flow.reason).toBe('future-version');
    expect(res.flow.code).toBe('E306');
    expect(res.flow.present).toBe(true);
  });

  it('the four classes are four DIFFERENT reasons AND four different next steps', async () => {
    const cases: Array<[string | undefined, string]> = [
      [undefined, 'absent'],
      [LEGACY_FLOW, 'legacy'],
      ['{ not json', 'malformed'],
      [FUTURE_FLOW, 'future-version'],
    ];
    const seen: string[] = [];
    const actions: string[] = [];
    for (const [content, expected] of cases) {
      const files: Record<string, string> = { [PLAN_DOC]: '{}' };
      if (content !== undefined) files[FLOW] = content;
      const { d } = deps(files, PLAN_OK);
      const res = await checkReachability(OPTS, d);
      expect(res.flow.reason).toBe(expected);
      seen.push(res.flow.reason as string);
      actions.push(res.next_action);
    }
    expect(new Set(seen).size).toBe(4);
    expect(new Set(actions).size).toBe(4);
  });
});

describe('the plan clause decides the error polarity (098/099-shaped streams)', () => {
  it('a missing plan document is an ERROR, and BOTH artifacts are excluded', async () => {
    const { d } = deps({}, PLAN_ABSENT, 1);
    const res = await checkReachability(OPTS, d);

    expect(res.verdict).toBe('error');
    expect(res.plan.present).toBe(false);
    expect(res.plan.validates).toBe(false);
    expect(res.plan.code).toBe('E400');
    expect(res.excluded).toEqual([PLAN_DOC, FLOW]);
    expect(res.next_action).toBe(
      'Scaffold one with `harness plan new <slug>`, or point at an existing plan folder.',
    );
  });

  it('a plan document that exists but does not validate is an ERROR that says so', async () => {
    const { d } = deps({ [PLAN_DOC]: 'not a dd document' }, PLAN_INVALID, 1);
    const res = await checkReachability(OPTS, d);

    expect(res.verdict).toBe('error');
    expect(res.plan.present).toBe(true);
    expect(res.plan.validates).toBe(false);
    expect(res.plan.detail).toContain('is not a dd document');
  });

  it('still READS the flow clause when the plan clause failed (no short-circuit)', async () => {
    const { d } = deps({ [FLOW]: GOOD_FLOW }, PLAN_ABSENT, 1);
    const res = await checkReachability(OPTS, d);

    expect(res.verdict).toBe('error');
    expect(res.flow.present).toBe(true);
    expect(res.flow.readable).toBe(true);
    expect(res.examined).toEqual([PLAN_DOC, FLOW]);
    expect(res.excluded).toEqual([PLAN_DOC]);
  });

  it('reports the flow reason even when the plan clause already decided error', async () => {
    const { d } = deps({ [FLOW]: LEGACY_FLOW }, PLAN_ABSENT, 1);
    const res = await checkReachability(OPTS, d);

    expect(res.verdict).toBe('error');
    expect(res.flow.reason).toBe('legacy');
  });
});

describe('the CLI seam — clause 1 is a child process, not an import', () => {
  it('shells THIS binary: `node <bin> plan validate <planDir> --json` in the repo root', async () => {
    const { d, exec } = deps({ [PLAN_DOC]: '{}', [FLOW]: GOOD_FLOW }, PLAN_OK);
    await checkReachability(OPTS, d);

    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0]?.command).toBe('node');
    expect(exec.calls[0]?.args).toEqual([BIN, 'plan', 'validate', PLAN_DIR, '--json']);
    expect(exec.calls[0]?.cwd).toBe(REPO);
    expect(exec.calls[0]?.timeoutMs).toBeGreaterThan(0);
  });

  it('an unparseable child envelope is an honest ERROR, never a silent pass', async () => {
    const { d } = deps({ [PLAN_DOC]: '{}', [FLOW]: GOOD_FLOW }, 'Killed: 9\n', 137);
    const res = await checkReachability(OPTS, d);

    expect(res.verdict).toBe('error');
    expect(res.plan.validates).toBe(false);
    expect(res.plan.detail).toMatch(/envelope/i);
  });

  it('a child that times out is an ERROR that names the timeout, not a pass', async () => {
    const exec = new FakeExec(
      { node: { code: 0, stdout: PLAN_OK, hang: true } },
      new FakeClock('2026-08-09T03:00:00.000Z'),
    );
    const d: ReachabilityDeps = {
      fs: new FakeFs({ [PLAN_DOC]: '{}', [FLOW]: GOOD_FLOW }),
      clock: new FakeClock('2026-08-09T03:00:00.000Z'),
      git: new FakeGit({ isRepo: true }),
      env: new FakeEnv({}),
      exec,
    };
    const res = await checkReachability({ ...OPTS, timeoutMs: 1000 }, d);

    expect(res.verdict).toBe('error');
    expect(res.plan.validates).toBe(false);
    expect(exec.kills).toHaveLength(1);
  });

  it('an ok-status envelope that still counts errors does NOT read as valid', async () => {
    const contradictory = JSON.stringify({
      command: 'plan validate',
      status: 'ok',
      timestamp: '2026-08-09T03:00:00.000Z',
      data: { counts: { error: 3, warn: 0 } },
    });
    const { d } = deps({ [PLAN_DOC]: '{}', [FLOW]: GOOD_FLOW }, contradictory);
    const res = await checkReachability(OPTS, d);

    expect(res.verdict).toBe('error');
    expect(res.plan.validates).toBe(false);
  });

  it('a degraded plan envelope with zero errors still validates (warnings are not errors)', async () => {
    const degraded = JSON.stringify({
      command: 'plan validate',
      status: 'degraded',
      timestamp: '2026-08-09T03:00:00.000Z',
      data: { counts: { error: 0, warn: 2 } },
      next_action: 'Review the warnings.',
    });
    const { d } = deps({ [PLAN_DOC]: '{}', [FLOW]: GOOD_FLOW }, degraded);
    const res = await checkReachability(OPTS, d);

    expect(res.verdict).toBe('ok');
    expect(res.plan.validates).toBe(true);
  });
});

describe('a child that FAILED is never a pass, however JSON-shaped its stdout', () => {
  it('exit 127 with a bare `{}` on stdout is an ERROR that names the exit code', async () => {
    // The reviewer's probe (p2-fix-1): `{}` parses as an object, so a check that
    // reads only `status`/`counts` sees status undefined and no error count and
    // calls it valid — while the child actually died before it ran anything.
    const { d } = deps({ [PLAN_DOC]: '{}', [FLOW]: GOOD_FLOW }, '{}', 127);
    const res = await checkReachability(OPTS, d);

    expect(res.verdict).toBe('error');
    expect(res.plan.validates).toBe(false);
    expect(res.plan.detail).toContain('127');
  });

  it('JSON without a `status` discriminator is not an envelope, even at exit 0', async () => {
    const shapeless = JSON.stringify({ data: { counts: { error: 0, warn: 0 } } });
    const { d } = deps({ [PLAN_DOC]: '{}', [FLOW]: GOOD_FLOW }, shapeless);
    const res = await checkReachability(OPTS, d);

    expect(res.verdict).toBe('error');
    expect(res.plan.validates).toBe(false);
    expect(res.plan.detail).toMatch(/envelope/i);
  });

  it('a well-formed ok envelope at an exit code that contradicts it is an ERROR', async () => {
    // The envelope says ok (exit 0 by the kernel's own status → exit table), the
    // child exited 3. They cannot both be true, so neither is evidence.
    const { d } = deps({ [PLAN_DOC]: '{}', [FLOW]: GOOD_FLOW }, PLAN_OK, 3);
    const res = await checkReachability(OPTS, d);

    expect(res.verdict).toBe('error');
    expect(res.plan.validates).toBe(false);
    expect(res.plan.detail).toContain('3');
  });

  it('the supported error pairing (exit 1 + `error`) still reads the real envelope', async () => {
    const { d } = deps({ [PLAN_DOC]: 'not a dd document' }, PLAN_INVALID, 1);
    const res = await checkReachability(OPTS, d);

    expect(res.plan.code).toBe('E400');
    expect(res.plan.detail).toContain('is not a dd document');
    expect(res.next_action).toBe('Fix the reported location, then re-run.');
  });

  it('`unconfigured` (exit 2) is "nothing was evaluated", not a validated plan', async () => {
    const unconfigured = JSON.stringify({
      command: 'plan validate',
      status: 'unconfigured',
      timestamp: '2026-08-09T03:00:00.000Z',
      next_action: 'No behaviour is mapped here yet.',
    });
    const { d } = deps({ [PLAN_DOC]: '{}', [FLOW]: GOOD_FLOW }, unconfigured, 2);
    const res = await checkReachability(OPTS, d);

    expect(res.verdict).toBe('error');
    expect(res.plan.validates).toBe(false);
  });
});

describe('flow path resolution', () => {
  it('defaults the flight plan to <planDir>/the-flow.json', async () => {
    const { d } = deps({ [PLAN_DOC]: '{}', [FLOW]: GOOD_FLOW }, PLAN_OK);
    const res = await checkReachability(OPTS, d);

    expect(res.flow.path).toBe(FLOW);
  });

  it('honours an explicit --flow override', async () => {
    const other = '/repo/.harness/flows/s081.json';
    const { d } = deps({ [PLAN_DOC]: '{}', [other]: GOOD_FLOW }, PLAN_OK);
    const res = await checkReachability({ ...OPTS, flowPath: other }, d);

    expect(res.verdict).toBe('ok');
    expect(res.flow.path).toBe(other);
    expect(res.examined).toEqual([PLAN_DOC, other]);
  });

  it('resolves a repo-relative planDir against the repo root', async () => {
    const { d, exec } = deps({ [PLAN_DOC]: '{}', [FLOW]: GOOD_FLOW }, PLAN_OK);
    const res = await checkReachability(
      { ...OPTS, planDir: 'docs/plans/081-flow-reachability' },
      d,
    );

    expect(res.verdict).toBe('ok');
    expect(res.plan.path).toBe(PLAN_DOC);
    expect(exec.calls[0]?.args).toEqual([BIN, 'plan', 'validate', PLAN_DIR, '--json']);
  });
});
