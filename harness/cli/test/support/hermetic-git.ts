import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { devNull } from 'node:os';

/**
 * ONE hermetic environment for every fixture that drives REAL git.
 *
 * This exists because of a class of bug, not a bug. Two separate contaminations
 * have now reached this suite from the machine it runs on:
 *
 * 1. **Ambient `GIT_CONFIG_*` env-config.** Some environments (agent sessions in
 *    this repo among them) export `GIT_CONFIG_COUNT` plus `GIT_CONFIG_KEY_n`/
 *    `GIT_CONFIG_VALUE_n`. Git reads that as a config source, and a plain
 *    `git config <key> <value>` write then dies with `fatal: not in a git
 *    directory` — a failure of the HOST, not of the code under test.
 *
 * 2. **git-ai's global `trace2.eventTarget`** (plan 073). Once git-ai's hooks are
 *    installed anywhere on the box, its daemon observes EVERY git command on the
 *    machine and writes `refs/notes/ai` into whatever repository just committed —
 *    including throwaway fixtures. That breaks ref-purity assertions with a ref
 *    nothing in the harness created, which reads as a harness bug and is really a
 *    machine-wide side effect of an external collector.
 *
 * Both were found one fixture at a time, and that is the actual defect: each
 * fixture opted into hermeticity individually, so the next one someone wrote was
 * exposed again. Hence this module — and hence `vitest.config.ts`, which sets the
 * trace2 disables for the WHOLE test run so a new fixture inherits them without
 * knowing they exist. This helper is the stronger, opt-in form: it additionally
 * cuts the fixture off from the developer's global and system git config.
 *
 * `GIT_TRACE2_EVENT=0` overrides the config rather than editing it. Nothing here
 * ever writes to, or deletes from, anyone's real git configuration.
 */

/** Ambient env-config git would read as a config source — always stripped. */
const AMBIENT_GIT_CONFIG_ENV = /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/;

/**
 * The trace2 disables, as data. `vitest.config.ts` declares the same three keys
 * for the whole run; a control test asserts these are the only definition of
 * them in the test tree, so the two can never drift into disagreement.
 */
export const GIT_TRACE2_DISABLED: Readonly<Record<string, string>> = {
  GIT_TRACE2: '0',
  GIT_TRACE2_EVENT: '0',
  GIT_TRACE2_PERF: '0',
};

/** A committer identity that needs no config file to exist. */
const FIXTURE_IDENTITY: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: 'Harness Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Harness Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

export interface HermeticGitOptions {
  /**
   * Cut the fixture off from the developer's global/system git config. Default
   * true. Set false ONLY in a fixture that specifically exercises global-config
   * handling — there, the config plumbing IS the subject, and pinning it from
   * out here would test the helper instead of the code.
   */
  isolateGlobalConfig?: boolean;
}

/**
 * The environment a disposable-repo fixture should hand to every real `git`.
 *
 * Starts from `process.env` (git needs PATH, HOME and friends), strips the
 * ambient config sources, disables trace2, and — by default — points the global
 * and system config at nothing.
 */
export function hermeticGitEnv(
  overrides: NodeJS.ProcessEnv = {},
  opts: HermeticGitOptions = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (AMBIENT_GIT_CONFIG_ENV.test(key)) delete env[key];
  }
  Object.assign(env, GIT_TRACE2_DISABLED);
  if (opts.isolateGlobalConfig !== false) {
    Object.assign(env, FIXTURE_IDENTITY, {
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : devNull,
      GIT_CONFIG_NOSYSTEM: '1',
    });
  }
  return { ...env, ...overrides };
}

/**
 * THE LIVE-DAEMON PAIR (plan 082 tk-0006).
 *
 * `vitest.config.ts` sets `GIT_TRACE2_EVENT='0'` for the WHOLE run, which makes a
 * negative-only fixture trivially true: of course no note appeared — trace2 was
 * discarded before git even started. A fixture that asserted only that would pass
 * on a machine where the entire feature was broken.
 *
 * So the pair is the point. The NEGATIVE proves a note does not appear when the
 * events go nowhere; the POSITIVE proves one DOES appear when the same events
 * reach a live daemon. Only together do they establish that the note is caused by
 * what we sent.
 *
 * This override lives HERE because `hermetic-git-fixtures.test.ts` walks every
 * `.ts` under `test/` and fails any file other than this one that names a
 * `GIT_TRACE2*` key — a guard that exists because copy-pasted disables are how the
 * contamination bug survived the first time.
 */

/** Where git records the machine's collector ingress. Read, never recomputed. */
export function globalTrace2Target(): string | null {
  const result = spawnSync('git', ['config', '--global', '--get', 'trace2.eventTarget'], {
    encoding: 'utf8',
    env: hermeticGitEnv({}, { isolateGlobalConfig: false }),
  });
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

/**
 * The live collector socket, or `null` when there is none.
 *
 * `null` is the SKIPPED signal for the positive half. A fixture that could not
 * find a daemon must record SKIPPED — never PASSED — because "no note appeared"
 * and "nothing was listening" are different facts and only one of them is a
 * result.
 */
export function liveCollectorSocket(): string | null {
  const target = globalTrace2Target();
  if (target === null) return null;
  const match = /^af_unix:(?:stream:|dgram:)?(.+)$/.exec(target.trim());
  if (match === null) return null;
  const path = match[1];
  try {
    return statSync(path).isSocket() ? path : null;
  } catch {
    return null;
  }
}
