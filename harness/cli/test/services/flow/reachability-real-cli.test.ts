import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { NodeExec } from '../../../src/adapters/exec/node-exec.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import {
  checkReachability,
  type ReachabilityDeps,
} from '../../../src/services/flow/reachability.js';

/**
 * Plan 081 phase 2 — the reachability check against the REAL built binary and
 * the phase-1 fixtures, one row per line of the fixture README's table
 * (`fixtures/reachability/README.md`). The sibling `reachability.test.ts` pins
 * the composition logic with fakes; this file proves the same verdicts hold when
 * the plan clause is a real `plan validate --json` child process — the surface
 * pij workteam verbs will actually call.
 *
 * `fs` and `exec` are the real adapters. `clock`/`git`/`env` are fakes on
 * purpose: the flow READ path (`readFlowDoc`) touches none of them, so injecting
 * real ones would imply a dependency this check does not have.
 *
 * Requires `dist/` (the repo builds before tests; CI builds first) — asserted as
 * a prerequisite rather than skipped silently, per the phase-1 precedent.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_DIR = resolve(HERE, '../../..');
const REPO_ROOT = resolve(CLI_DIR, '../..');
const BIN = join(CLI_DIR, 'bin/harness.js');
const FX = join(CLI_DIR, 'test/services/flow/fixtures/reachability');

function realDeps(): ReachabilityDeps {
  return {
    fs: new NodeFs(),
    clock: new FakeClock('2026-08-09T03:00:00.000Z'),
    git: new FakeGit({ isRepo: true }),
    env: new FakeEnv({}),
    exec: new NodeExec(),
  };
}

function check(fixture: string) {
  return checkReachability(
    {
      planDir: join(FX, fixture),
      cwd: REPO_ROOT,
      nodePath: process.execPath,
      binPath: BIN,
    },
    realDeps(),
  );
}

describe('reachability vs the real CLI (plan 081 phase 2)', () => {
  it('dist is built (prerequisite, not a silent skip)', () => {
    expect(existsSync(join(CLI_DIR, 'dist/index.js'))).toBe(true);
  });

  it.each([
    '098-shaped',
    '099-shaped',
  ])('%s: no plan, no flight plan → error, and BOTH artifacts are excluded', async (fixture) => {
    const res = await check(fixture);

    expect(res.verdict).toBe('error');
    expect(res.plan.present).toBe(false);
    expect(res.plan.validates).toBe(false);
    expect(res.plan.code).toBe('E400');
    expect(res.flow.present).toBe(false);
    expect(res.flow.reason).toBe('absent');
    expect(res.examined).toHaveLength(2);
    expect(res.excluded).toHaveLength(2);
  });

  it('plan-without-flow: the plan validates, the flight plan is missing → degraded warning', async () => {
    const res = await check('plan-without-flow');

    expect(res.verdict).toBe('degraded');
    expect(res.plan.present).toBe(true);
    expect(res.plan.validates).toBe(true);
    expect(res.flow.reason).toBe('absent');
    expect(res.excluded).toEqual([join(FX, 'plan-without-flow/the-flow.json').replace(/\\/g, '/')]);
    expect(res.next_action).toContain('harness flow create flight-plan --slug plan-without-flow');
  });

  it('both-good: plan validates AND the flight plan reads back → ok', async () => {
    const res = await check('both-good');

    expect(res.verdict).toBe('ok');
    expect(res.plan.validates).toBe(true);
    expect(res.flow.present).toBe(true);
    expect(res.flow.readable).toBe(true);
    expect(res.excluded).toEqual([]);
  });

  it('legacy-flow: the plan clause decides (error), the flow reason is `legacy`', async () => {
    const res = await check('legacy-flow');

    expect(res.verdict).toBe('error');
    expect(res.flow.reason).toBe('legacy');
    expect(res.flow.code).toBe('E308');
    expect(res.flow.present).toBe(true);
  });

  it('malformed-flow: the plan clause decides (error), the flow reason is `malformed`', async () => {
    const res = await check('malformed-flow');

    expect(res.verdict).toBe('error');
    expect(res.flow.reason).toBe('malformed');
    expect(res.flow.code).toBe('E300');
  });

  it('future-version-flow: reads `future-version` (E306), the fourth distinct reason', async () => {
    const res = await check('future-version-flow');

    expect(res.verdict).toBe('error');
    expect(res.flow.reason).toBe('future-version');
    expect(res.flow.code).toBe('E306');
    expect(res.flow.present).toBe(true);
  });

  it('a repo-relative planDir resolves against the repo root exactly like an absolute one', async () => {
    const relative = 'harness/cli/test/services/flow/fixtures/reachability/both-good';
    const res = await checkReachability(
      { planDir: relative, cwd: REPO_ROOT, nodePath: process.execPath, binPath: BIN },
      realDeps(),
    );

    expect(res.verdict).toBe('ok');
    expect(res.next_action).not.toContain('harness flow create');
  });

  it('the next_action for a missing flight plan is a runnable, repo-relative create line', async () => {
    const res = await check('plan-without-flow');

    expect(res.next_action).toBe(
      'harness flow create flight-plan --slug plan-without-flow' +
        ' --path harness/cli/test/services/flow/fixtures/reachability/plan-without-flow/the-flow.json' +
        ' --plan-dir harness/cli/test/services/flow/fixtures/reachability/plan-without-flow',
    );
  });

  it('the real fs is what answers presence (FakeFs would not see these fixtures)', async () => {
    const blind: ReachabilityDeps = { ...realDeps(), fs: new FakeFs({}) };
    const res = await checkReachability(
      { planDir: join(FX, 'both-good'), cwd: REPO_ROOT, nodePath: process.execPath, binPath: BIN },
      blind,
    );

    // The CLI still validates the plan (it reads its own disk), but the flow
    // clause reads through the injected fs — so this asserts the port is real.
    expect(res.plan.validates).toBe(true);
    expect(res.flow.readable).toBe(false);
  });
});
