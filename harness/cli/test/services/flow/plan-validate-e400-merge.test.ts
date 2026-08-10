import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { NodeExec } from '../../../src/adapters/exec/node-exec.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import {
  checkReachability,
  type ReachabilityDeps,
} from '../../../src/services/flow/reachability.js';

/**
 * `plan validate` returns E400 for BOTH "no plan document" and "present but not a
 * readable dd document" — and that merge is INTENTIONAL for the life of s080,
 * not an oversight nobody has gotten to. This file exists to say which of those
 * two it is, because the difference is invisible from the code alone and the
 * next reader would otherwise have to guess.
 *
 * WHY it is merged (the basis, relayed from koala via prime — a constraint, not
 * a preference): s080 phase 2's acceptance bar is BEHAVIOURAL IDENTITY WITH THE
 * FORK. Goldens pin findings/counts/refusals, and a live-corpus test proved the
 * promoted implementation equals the fork across the real 541-item corpus. An
 * E400 split is therefore excluded BY CONSTRUCTION: it cannot ship without
 * failing s080's own gate. No phase-3 item touches `plan validate`'s codes. So
 * the workaround below stays correct for the life of s080 — a dated contract
 * with a named expiry, not a permanent law.
 *
 * WHAT DEPENDS ON IT: `checkReachability` cannot use the code to tell the two
 * apart, so it probes the filesystem for the plan document and reports
 * `plan.present` (`reachability.ts`, `validatePlan`). That probe is the
 * workaround. The `detail` strings are the OTHER consumer — they are what a
 * human reads to find out which failure they hit, since the code will not say.
 *
 * HOW WIDE THE MERGE ACTUALLY IS — measured, because it is narrower than
 * "absent or invalid" suggests, and the difference matters to anyone planning a
 * split. `E400` covers *absent* and *not a dd document*. A plan document that IS
 * a readable dd document but violates the plan schema does NOT return E400: a
 * `meta.status` outside the declared enum returns **E407** (`enum-invalid`). So
 * the conflation is specifically "nothing to read" vs "unreadable", not "nothing
 * to read" vs "everything that fails validation". The third test pins that
 * boundary so a future split knows its real size.
 *
 * IF A FUTURE PLAN SPLITS THE CODES, it must name both consumers as callers to
 * update: this probe matrix, and the detail strings. koala captured the
 * conflation as observe DL-005 in the 080 worktree; it is the same root cause as
 * dd's E450 at `locate.ts:33/36`, one layer up. Do not delete this file to make
 * a split go green — change it, and let the diff show the contract moved.
 *
 * The invalid plan document is built in an OS TEMP DIR rather than committed
 * beside the other fixtures. That is forced, not stylistic: `dd doctor` sweeps
 * this package for `*.dd.json`, and its fixture-path exclusion
 * (`shouldExcludeFromSweep`) takes the PARSED document, so a file that does not
 * parse never reaches the exclusion and is reported as `E436
 * link-scan-incomplete`. Committing one here turns `dd doctor` degraded and
 * fails `test/acts/dd.test.ts`. See the fixtures README.
 *
 * Requires `dist/` (the repo builds before tests; CI builds first), like the
 * sibling real-CLI suite.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_DIR = resolve(HERE, '../../..');
const REPO_ROOT = resolve(CLI_DIR, '../..');
const BIN = join(CLI_DIR, 'bin/harness.js');
const FX = join(CLI_DIR, 'test/services/flow/fixtures/reachability');

/** The plan folder with NO `plan.dd.json` at all (a real measured stream shape). */
const ABSENT = join(FX, '098-shaped');

/** A plan folder whose `plan.dd.json` exists but is not a readable dd document. */
let INVALID: string;

beforeAll(() => {
  INVALID = mkdtempSync(join(tmpdir(), 'harness-e400-'));
  writeFileSync(join(INVALID, 'plan.dd.json'), '{ "dd": broken', 'utf8');
});

afterAll(() => {
  rmSync(INVALID, { recursive: true, force: true });
});

interface Envelope {
  status: string;
  error?: { code?: string; message?: string };
}

/** Run the REAL binary's `plan validate --json` and return its envelope. */
async function validate(planDir: string): Promise<{ code: number; env: Envelope }> {
  const exec = new NodeExec();
  const res = await exec.run(process.execPath, [BIN, 'plan', 'validate', planDir, '--json'], {
    cwd: REPO_ROOT,
    timeoutMs: 60_000,
  });
  return { code: res.code, env: JSON.parse(res.stdout.trim()) as Envelope };
}

function realDeps(): ReachabilityDeps {
  return {
    fs: new NodeFs(),
    clock: new FakeClock('2026-08-09T03:00:00.000Z'),
    git: new FakeGit({ isRepo: true }),
    env: new FakeEnv({}),
    exec: new NodeExec(),
  };
}

function check(planDir: string) {
  return checkReachability(
    { planDir, cwd: REPO_ROOT, nodePath: process.execPath, binPath: BIN },
    realDeps(),
  );
}

describe('plan validate E400 is MERGED on purpose (s080 behavioural-identity bar)', () => {
  it('both probes ran and read different folders — a stuck reader would fail here', async () => {
    const [absent, invalid] = await Promise.all([validate(ABSENT), validate(INVALID)]);

    // Vacuity guard. The load-bearing assertion below is an EQUALITY between two
    // readings, and an equality passes trivially when both readings are the same
    // stuck value. So prove first that these are two distinct LIVE readings:
    // same code, different message.
    expect(absent.env.status).toBe('error');
    expect(invalid.env.status).toBe('error');
    expect(absent.env.error?.message).toContain('no plan document');
    expect(invalid.env.error?.message).toContain('is not a dd document');
    expect(absent.env.error?.message).not.toBe(invalid.env.error?.message);
  });

  it('returns the SAME E400 for an absent plan document and an unreadable one', async () => {
    const [absent, invalid] = await Promise.all([validate(ABSENT), validate(INVALID)]);

    // The merge itself: two categorically different failures — nothing to read,
    // versus something to read that is not a dd document — under one code.
    expect(absent.env.error?.code).toBe('E400');
    expect(invalid.env.error?.code).toBe('E400');
    expect(absent.env.error?.code).toBe(invalid.env.error?.code);
  });

  it('does NOT extend to a readable dd document that fails the plan schema — that is E407', async () => {
    const schemaInvalid = mkdtempSync(join(tmpdir(), 'harness-e407-'));
    try {
      writeFileSync(
        join(schemaInvalid, 'plan.dd.json'),
        JSON.stringify({
          dd: { schema: 'builder/plan' },
          sections: [
            {
              name: 'meta',
              value: { title: 't', slug: 's', status: 'not-a-declared-status', summary: '' },
            },
          ],
          references: [],
        }),
        'utf8',
      );

      const res = await validate(schemaInvalid);

      expect(res.env.error?.code).toBe('E407');
      expect(res.env.error?.code).not.toBe('E400');
    } finally {
      rmSync(schemaInvalid, { recursive: true, force: true });
    }
  });

  it('so checkReachability separates them by plan.present (the fs probe), never by the code', async () => {
    const [absent, invalid] = await Promise.all([check(ABSENT), check(INVALID)]);

    // Same code, same verdict, same `validates` — the code carries no signal.
    expect(absent.plan.code).toBe('E400');
    expect(invalid.plan.code).toBe('E400');
    expect(absent.plan.validates).toBe(false);
    expect(invalid.plan.validates).toBe(false);
    expect(absent.verdict).toBe('error');
    expect(invalid.verdict).toBe('error');

    // The ONE field that does. This is the workaround, pinned.
    expect(absent.plan.present).toBe(false);
    expect(invalid.plan.present).toBe(true);
  });

  it('the detail strings are the human-facing discriminator, and the other consumer of a split', async () => {
    const [absent, invalid] = await Promise.all([check(ABSENT), check(INVALID)]);

    expect(absent.plan.detail).toContain('no plan document');
    expect(invalid.plan.detail).toContain('is not a dd document');
  });
});
