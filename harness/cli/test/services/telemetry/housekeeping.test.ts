import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { Envelope } from '../../../src/output/envelope.js';
import type { Writers } from '../../../src/output/output-port.js';
import { COLLECTOR_OPT_OUT_ENV as COLLECTOR_OPT_OUT_ENV_SOURCE } from '../../../src/services/doctor/collector/auto-install.js';
import {
  buildHousekeepingDecorator,
  COLLECTOR_OPT_OUT_ENV,
  type CollectorHooksReading,
  TELEMETRY_AUTOSYNC_OFF_ENV,
} from '../../../src/services/telemetry/housekeeping.js';

/**
 * The boot/checks telemetry housekeeping decorator (plan 034 follow-on). Pins the
 * defensive contract: it NEVER changes the host envelope's status, only ADDS
 * housekeeping notices; `checks` auto-pushes (best-effort) while `boot` only
 * nudges; a failed auto-push is reported (not thrown); the kill-switch and the
 * narrow autosync opt-out disable it; non-well-known commands are untouched.
 */

const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';

function seg(): string {
  return `${JSON.stringify({ command: 'flow', timecode: '2026-03-23T10:00:00.000Z' })}\n`;
}

function bufferedFs(): FakeFs {
  return new FakeFs(
    { [`${TEL}/sessA/1.json`]: seg(), [`${TEL}/sessA/2.json`]: seg() },
    { [TEL]: ['sessA'], [`${TEL}/sessA`]: ['1.json', '2.json'] },
  );
}

function capturingWriters(): { writers: Writers; err: () => string; out: () => string } {
  let e = '';
  let o = '';
  return {
    writers: {
      out: (t) => {
        o += t;
      },
      err: (t) => {
        e += t;
      },
    },
    err: () => e,
    out: () => o,
  };
}

function envFor(command: string, status: Envelope['status'] = 'ok'): Envelope {
  return { command, status, timestamp: '2026-06-24T00:00:00.000Z' };
}

function decorator(
  fs: FakeFs,
  git: FakeGitWrite,
  over: {
    env?: Record<string, string>;
    mode?: 'json' | 'human';
    writers?: Writers;
    collectorHooks?: () => CollectorHooksReading | null;
  } = {},
) {
  return buildHousekeepingDecorator({
    fs,
    env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', ...(over.env ?? {}) }),
    proc: new FakeProcess({}, REPO),
    gitWrite: git,
    ...(over.collectorHooks !== undefined && { collectorHooks: over.collectorHooks }),
    mode: over.mode ?? 'json',
    writers: over.writers ?? { out: () => {}, err: () => {} },
  });
}

describe('buildHousekeepingDecorator — boot/checks telemetry housekeeping', () => {
  it('boot: nudges (no push) when telemetry is unpushed', () => {
    const git = new FakeGitWrite();
    const env = envFor('boot');
    decorator(bufferedFs(), git)(env);

    expect(env.housekeeping).toEqual([
      {
        kind: 'telemetry-unpushed',
        message: '2 telemetry segment(s) not yet pushed',
        command: 'harness telemetry sync',
        details: { count: 2, sessions: 1 },
      },
    ]);
    expect(git.calls).toEqual([]); // boot NEVER pushes
    expect(env.status).toBe('ok'); // status untouched
  });

  it('boot: silent when nothing is buffered', () => {
    const env = envFor('boot');
    decorator(new FakeFs(), new FakeGitWrite())(env);
    expect(env.housekeeping).toBeUndefined();
  });

  it('doctor: nudges (no push) when telemetry is unpushed', () => {
    const git = new FakeGitWrite();
    const env = envFor('doctor');
    decorator(bufferedFs(), git)(env);
    expect(env.housekeeping?.[0]?.kind).toBe('telemetry-unpushed');
    expect(git.calls).toEqual([]); // doctor warns, never pushes
  });

  it('checks: auto-pushes buffered telemetry and reports it', () => {
    const fs = bufferedFs();
    const git = new FakeGitWrite();
    const env = envFor('checks');
    decorator(fs, git)(env);

    expect(git.pushed.length).toBe(1); // a real push happened
    expect(env.housekeeping).toEqual([
      {
        kind: 'telemetry-synced',
        message: 'auto-pushed 2 telemetry segment(s)',
        details: { count: 2, sessions: 1 },
      },
    ]);
    // buffer consumed (watermark advanced) — a real flush, not just a nudge
    expect(fs.readText(`${TEL}/sessA.flushed`)?.trim()).toBe('2');
    expect(env.status).toBe('ok');
  });

  it('checks: a failed auto-push is REPORTED, not thrown, and never changes status', () => {
    const git = new FakeGitWrite();
    git.failPush = true;
    const env = envFor('checks', 'error'); // checks itself failed
    expect(() => decorator(bufferedFs(), git)(env)).not.toThrow();

    expect(env.housekeeping?.[0]).toMatchObject({
      kind: 'telemetry-autosync-failed',
      command: 'harness telemetry sync',
    });
    expect(env.status).toBe('error'); // the host command's status is untouched
  });

  it('checks: silent when nothing is buffered', () => {
    const git = new FakeGitWrite();
    const env = envFor('checks');
    decorator(new FakeFs(), git)(env);
    expect(env.housekeeping).toBeUndefined();
    expect(git.calls).toEqual([]);
  });

  it('checks: autosync opt-out falls back to a nudge (no push)', () => {
    const git = new FakeGitWrite();
    const env = envFor('checks');
    decorator(bufferedFs(), git, { env: { [TELEMETRY_AUTOSYNC_OFF_ENV]: '1' } })(env);

    expect(git.calls).toEqual([]); // did NOT push
    expect(env.housekeeping?.[0]?.kind).toBe('telemetry-unpushed');
  });

  it('kill-switch disables housekeeping entirely (both boot and checks)', () => {
    for (const command of ['boot', 'checks']) {
      const git = new FakeGitWrite();
      const env = envFor(command);
      decorator(bufferedFs(), git, { env: { HARNESS_NO_TELEMETRY: '1' } })(env);
      expect(env.housekeeping).toBeUndefined();
      expect(git.calls).toEqual([]);
    }
  });

  it('is dormant for non-well-known commands', () => {
    const git = new FakeGitWrite();
    const env = envFor('flow'); // a normal command — no telemetry housekeeping
    decorator(bufferedFs(), git)(env);
    expect(env.housekeeping).toBeUndefined();
    expect(git.calls).toEqual([]);
  });

  it('human mode writes one stderr line per notice (side-channel)', () => {
    const cap = capturingWriters();
    const env = envFor('boot');
    decorator(bufferedFs(), new FakeGitWrite(), { mode: 'human', writers: cap.writers })(env);
    expect(cap.err()).toBe(
      'housekeeping: 2 telemetry segment(s) not yet pushed — run: harness telemetry sync\n',
    );
    expect(cap.out()).toBe(''); // never pollutes stdout
  });
});

/**
 * The `checks` collector-hooks nudge (packet 3d) and its fail-safe proof.
 *
 * The requirement it serves is "telemetry must be working, and FAILURE MUST NOT
 * BREAK THINGS". That is a claim, so it is exercised here by fault injection
 * rather than asserted by reading the code: the reading throws, the reading is
 * absent, the reading is empty, the reading is populated — and in every case the
 * gate's status, the gate's exit and the telemetry auto-push are unaffected.
 *
 * BOTH DIRECTIONS ARE PINNED ON PURPOSE. A nudge that is silent when healthy is
 * indistinguishable from a nudge that never runs, so the silence is asserted as
 * explicitly as the firing is. A control that can only be observed failing is
 * half a control.
 */
describe('buildHousekeepingDecorator — collector hooks nudge', () => {
  const uncovered = (over: Partial<CollectorHooksReading> = {}): CollectorHooksReading => ({
    missing: ['cursor'],
    command: 'harness doctor',
    ...over,
  });

  it('names the uncovered agents and the exact command that fixes it', () => {
    const env = envFor('checks');
    decorator(new FakeFs(), new FakeGitWrite(), {
      collectorHooks: () => uncovered({ missing: ['cursor', 'codex'] }),
    })(env);

    expect(env.housekeeping).toEqual([
      {
        kind: 'collector-hooks-incomplete',
        message:
          'cursor, codex are installed but not instrumented — their edits are not being attributed',
        command: 'harness doctor',
        details: { agents: ['cursor', 'codex'] },
      },
    ]);
    expect(env.status).toBe('ok');
  });

  it('fires on the DEFAULT checks path, alongside the auto-push', () => {
    // The regression guard for a real trap: the auto-sync branch RETURNS, so a
    // nudge placed beside `nudgeIfPending` at the bottom of the decorator is
    // unreachable whenever auto-sync is on — the shipped default. That mistake
    // reviews as correct and ships silent. Moving the call back down there turns
    // this test red, which is the only reason the mistake is now catchable.
    const env = envFor('checks');
    const git = new FakeGitWrite();
    decorator(bufferedFs(), git, { collectorHooks: () => uncovered() })(env);

    expect(git.pushed.length).toBe(1); // the auto-push still happened
    expect(env.housekeeping?.map((n) => n.kind)).toEqual([
      'collector-hooks-incomplete',
      'telemetry-synced',
    ]);
  });

  it('SILENT when every detected agent is covered', () => {
    const env = envFor('checks');
    decorator(new FakeFs(), new FakeGitWrite(), { collectorHooks: () => ({ missing: [] }) })(env);
    expect(env.housekeeping).toBeUndefined();
  });

  it('SILENT when the reading could not be taken — absent is never a warning', () => {
    const env = envFor('checks');
    decorator(new FakeFs(), new FakeGitWrite(), { collectorHooks: () => null })(env);
    expect(env.housekeeping).toBeUndefined();
  });

  it('SILENT when no reader is wired at all', () => {
    const env = envFor('checks');
    expect(() => decorator(new FakeFs(), new FakeGitWrite())(env)).not.toThrow();
    expect(env.housekeeping).toBeUndefined();
  });

  it('FAULT INJECTION: a throwing reader costs neither the gate nor the auto-push', () => {
    // The isolation that matters. The nudge runs BEFORE the auto-push, so an
    // unhandled throw would be swallowed by the decorator's outer catch and the
    // push would be silently skipped — a green gate whose telemetry quietly
    // stopped shipping. Asserting `not.toThrow()` alone would MISS that; the
    // push assertion is the one doing the work.
    const env = envFor('checks', 'error');
    const git = new FakeGitWrite();
    expect(() =>
      decorator(bufferedFs(), git, {
        collectorHooks: () => {
          throw new Error('collector state unreadable');
        },
      })(env),
    ).not.toThrow();

    expect(git.pushed.length).toBe(1); // the auto-push SURVIVED the throw
    expect(env.housekeeping?.map((n) => n.kind)).toEqual(['telemetry-synced']);
    expect(env.status).toBe('error'); // the gate's own verdict is untouched
  });

  it('omits the command clause rather than inventing advice', () => {
    const env = envFor('checks');
    decorator(new FakeFs(), new FakeGitWrite(), {
      collectorHooks: () => ({ missing: ['cursor'] }),
    })(env);

    expect(env.housekeeping?.[0]).toEqual({
      kind: 'collector-hooks-incomplete',
      message: 'cursor is installed but not instrumented — its edits are not being attributed',
      details: { agents: ['cursor'] },
    });
  });

  it('is dormant on boot and doctor — `checks` is the constantly-run gate', () => {
    for (const command of ['boot', 'doctor']) {
      const env = envFor(command);
      decorator(new FakeFs(), new FakeGitWrite(), { collectorHooks: () => uncovered() })(env);
      expect(env.housekeeping, command).toBeUndefined();
    }
  });

  it('never names a POSIX-only recovery path in the command clause', () => {
    // Windows's ingress is a NAMED PIPE — `drainable: false`, `replayInto: false`
    // — so `harness doctor telemetry-nudge` refuses there on platform grounds.
    // The reading's prose may legitimately mention it (health.ts composes that
    // sentence for the ingress-blocked case); the `command` clause may not,
    // because it renders as `— run: <command>` and would be advice that cannot
    // work for every Windows user.
    //
    // This assertion runs identically on win32: it drives fakes only, with no
    // real fs, no exec and no platform branch of its own.
    const env = envFor('checks');
    const cap = capturingWriters();
    decorator(new FakeFs(), new FakeGitWrite(), {
      mode: 'human',
      writers: cap.writers,
      collectorHooks: () => ({
        missing: ['cursor'],
        command: 'harness doctor',
        next_action: 'Run `harness doctor telemetry-nudge` from an UNSANDBOXED shell.',
      }),
    })(env);

    const notice = env.housekeeping?.[0];
    expect(notice?.command).toBe('harness doctor');
    expect(notice?.command).not.toContain('telemetry-nudge');
    // The rendered human line is what an operator actually copies.
    expect(cap.err()).toBe(
      'housekeeping: cursor is installed but not instrumented — its edits are not being attributed — run: harness doctor\n',
    );
    // The case-correct prose still reaches the operator, just not as a command.
    expect(notice?.details).toMatchObject({
      next_action: 'Run `harness doctor telemetry-nudge` from an UNSANDBOXED shell.',
    });
  });

  it('HARNESS_NO_COLLECTOR=1 silences it — a different consent from the kill-switch', () => {
    // Someone who declined the install must not be nagged every gate run to go
    // and do the thing they declined. The opt-out IS the resolution, so there
    // is no action the nudge could name.
    const env = envFor('checks');
    decorator(new FakeFs(), new FakeGitWrite(), {
      env: { [COLLECTOR_OPT_OUT_ENV]: '1' },
      collectorHooks: () => uncovered(),
    })(env);
    expect(env.housekeeping).toBeUndefined();
  });

  it('the two consents are independent — capture ON + collector OFF is still silent', () => {
    // The distinction that matters: HARNESS_NO_TELEMETRY stops CAPTURE,
    // HARNESS_NO_COLLECTOR stops INSTALLING SOMEONE ELSE'S SOFTWARE. A
    // developer may want the second without the first, so telemetry stays fully
    // on here and the nudge must still be silent.
    const env = envFor('checks');
    const git = new FakeGitWrite();
    decorator(bufferedFs(), git, {
      env: { HARNESS_TELEMETRY_CAPTURE: '1', [COLLECTOR_OPT_OUT_ENV]: '1' },
      collectorHooks: () => uncovered(),
    })(env);

    // Telemetry itself is untouched — the auto-push still happened.
    expect(git.pushed.length).toBe(1);
    expect(env.housekeeping?.map((n) => n.kind)).toEqual(['telemetry-synced']);
  });

  it('the telemetry kill-switch silences it too', () => {
    const env = envFor('checks');
    decorator(new FakeFs(), new FakeGitWrite(), {
      env: { HARNESS_NO_TELEMETRY: '1' },
      collectorHooks: () => uncovered(),
    })(env);
    expect(env.housekeeping).toBeUndefined();
  });
});

/**
 * The opt-out name is declared in TWO modules on purpose — `services/telemetry`
 * must not import `services/doctor`. A duplicated constant is a silent-drift
 * hazard, so it is pinned rather than trusted: rename one and this fails.
 */
describe('COLLECTOR_OPT_OUT_ENV — duplicated deliberately, pinned against drift', () => {
  it('matches the collector module that owns it', () => {
    expect(COLLECTOR_OPT_OUT_ENV).toBe(COLLECTOR_OPT_OUT_ENV_SOURCE);
    expect(COLLECTOR_OPT_OUT_ENV).toBe('HARNESS_NO_COLLECTOR');
  });
});
