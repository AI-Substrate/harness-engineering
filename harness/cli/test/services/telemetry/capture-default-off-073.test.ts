import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { Envelope } from '../../../src/output/envelope.js';
import type { HarnessAdapter } from '../../../src/services/telemetry/adapters/harness-adapter.js';
import { isCaptureEnabled } from '../../../src/services/telemetry/capture-gate.js';
import {
  type CaptureDeps,
  captureTelemetry,
} from '../../../src/services/telemetry/capture-service.js';
import { buildHousekeepingDecorator } from '../../../src/services/telemetry/housekeeping.js';
import { syncTelemetry } from '../../../src/services/telemetry/sync-service.js';

/**
 * Plan 073 · ac-0001 + ac-0019 — a SHIPPED harness collects no telemetry.
 *
 * The flip is only real if all THREE enforcement points short-circuit on a
 * default install, not just the one that happens to read the setting. So this
 * file proves each of them separately, with a tree that WOULD produce output if
 * the gate were open: a live harness session with a live adapter (capture), a
 * populated buffer with a writable git remote (publish), and a `checks` envelope
 * over that same buffer (housekeeping).
 *
 * "Default install" here means literally no telemetry environment variable — not
 * `HARNESS_NO_TELEMETRY=1`. That distinction is the whole point of ac-0001.
 */

const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';

/** Env as a fresh machine has it: nothing telemetry-related set at all. */
function defaultInstallEnv(extra: Record<string, string> = {}): FakeEnv {
  return new FakeEnv(extra);
}

const liveAdapter: HarnessAdapter = {
  harness: 'claude-code',
  handles: (id) => id === 'claude-code',
  currentPosition: () => 240,
  extract: () => ({ tools: { Bash: 1 } }),
};

function bufferedFs(): FakeFs {
  const seg = `${JSON.stringify({ command: 'flow', timecode: '2026-03-23T10:00:00.000Z' })}\n`;
  return new FakeFs(
    { [`${TEL}/sessA/1.json`]: seg, [`${TEL}/sessA/2.json`]: seg },
    { [TEL]: ['sessA'], [`${TEL}/sessA`]: ['1.json', '2.json'] },
  );
}

describe('plan 073 — enforcement point 1/3: capture (ac-0001, ac-0019)', () => {
  it('a live session with a live adapter captures NOTHING on a default install', () => {
    const fs = new FakeFs();
    const deps: CaptureDeps = {
      fs,
      env: defaultInstallEnv({ CLAUDE_CODE_SESSION_ID: 'sess1' }),
      clock: new FakeClock('2026-08-06T04:58:00.000Z'),
      proc: new FakeProcess({}, REPO),
      git: new FakeGit({ isRepo: true, branch: 'main', remoteUrl: 'github.com/x/y' }),
      command: 'flow',
      adapters: [liveAdapter],
    };

    captureTelemetry(deps);

    expect(fs.writes).toEqual([]);
    expect(fs.mkdirs).toEqual([]);
    expect(fs.renames).toEqual([]);
  });
});

describe('plan 073 — enforcement point 2/3: publish (ac-0001, ac-0019)', () => {
  it('a populated buffer publishes NOTHING on a default install', () => {
    const fs = bufferedFs();
    const git = new FakeGitWrite();

    const result = syncTelemetry({
      fs,
      env: defaultInstallEnv(),
      proc: new FakeProcess({}, REPO),
      git,
    });

    expect(result).toEqual({ ok: true, pushed: false, segments: 0, sessions: 0, plans: [] });
    expect(git.calls).toEqual([]); // not even a ref read
    expect(fs.writes).toEqual([]);
  });

  it('is a no-op even though the SAME buffer publishes when opted in (the gate is the difference)', () => {
    const git = new FakeGitWrite();
    const opted = syncTelemetry({
      fs: bufferedFs(),
      env: defaultInstallEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }),
      proc: new FakeProcess({}, REPO),
      git,
    });

    expect(opted.segments).toBe(2);
    expect(git.pushed.length).toBe(1);
  });
});

describe('plan 073 — enforcement point 3/3: housekeeping (ac-0001, ac-0019)', () => {
  it('`checks` neither nudges nor auto-pushes on a default install', () => {
    const fs = bufferedFs();
    const git = new FakeGitWrite();
    const envelope: Envelope = {
      command: 'checks',
      status: 'ok',
      timestamp: '2026-08-06T00:00:00.000Z',
    };

    buildHousekeepingDecorator({
      fs,
      env: defaultInstallEnv(),
      proc: new FakeProcess({}, REPO),
      gitWrite: git,
      mode: 'json',
      writers: { out: () => {}, err: () => {} },
    })(envelope);

    expect(envelope.housekeeping).toBeUndefined();
    expect(git.calls).toEqual([]);
    expect(fs.writes).toEqual([]); // no `checks` verdict capture either
  });

  it('`boot` produces no unpushed nudge on a default install', () => {
    const envelope: Envelope = {
      command: 'boot',
      status: 'ok',
      timestamp: '2026-08-06T00:00:00.000Z',
    };

    buildHousekeepingDecorator({
      fs: bufferedFs(),
      env: defaultInstallEnv(),
      proc: new FakeProcess({}, REPO),
      gitWrite: new FakeGitWrite(),
      mode: 'json',
      writers: { out: () => {}, err: () => {} },
    })(envelope);

    expect(envelope.housekeeping).toBeUndefined();
  });
});

describe('plan 073 — the gate itself', () => {
  it('reads closed on a default install and open only on an explicit opt-in', () => {
    expect(isCaptureEnabled(defaultInstallEnv())).toBe(false);
    expect(isCaptureEnabled(defaultInstallEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }))).toBe(true);
    expect(
      isCaptureEnabled(
        defaultInstallEnv({ HARNESS_TELEMETRY_CAPTURE: '1', HARNESS_NO_TELEMETRY: '1' }),
      ),
    ).toBe(false);
  });
});
