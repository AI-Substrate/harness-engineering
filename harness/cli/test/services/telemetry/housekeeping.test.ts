import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { Envelope } from '../../../src/output/envelope.js';
import type { Writers } from '../../../src/output/output-port.js';
import {
  buildHousekeepingDecorator,
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
  over: { env?: Record<string, string>; mode?: 'json' | 'human'; writers?: Writers } = {},
) {
  return buildHousekeepingDecorator({
    fs,
    env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', ...(over.env ?? {}) }),
    proc: new FakeProcess({}, REPO),
    gitWrite: git,
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
