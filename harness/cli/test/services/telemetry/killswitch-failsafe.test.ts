import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { HarnessAdapter } from '../../../src/services/telemetry/adapters/harness-adapter.js';
import {
  type CaptureDeps,
  captureTelemetry,
} from '../../../src/services/telemetry/capture-service.js';

/**
 * T009 (plan 1.8 · AC-05, AC-09) — the kill-switch + fail-safe wrapper.
 *
 * AC-05: `HARNESS_NO_TELEMETRY=1` → ZERO side effects. AC-09: an adapter that
 * throws (corrupt source / parse error) is swallowed — capture can NEVER break
 * the host command. This last-resort catch-all is DISTINCT from T005's designed
 * edge no-ops (zero-harness / missing source / corrupt cursor).
 */

const REPO = '/repo';

function deps(
  envVars: Record<string, string>,
  adapters: HarnessAdapter[],
): {
  d: CaptureDeps;
  fs: FakeFs;
} {
  const fs = new FakeFs();
  const d: CaptureDeps = {
    fs,
    env: new FakeEnv(envVars),
    clock: new FakeClock('2026-06-23T04:58:00.000Z'),
    proc: new FakeProcess({}, REPO),
    git: new FakeGit({ isRepo: true, branch: '034-x', remoteUrl: 'github.com/x/y' }),
    command: 'flow',
    adapters,
  };
  return { d, fs };
}

const liveAdapter: HarnessAdapter = {
  harness: 'claude-code',
  handles: (id) => id === 'claude-code',
  currentPosition: () => 240,
  extract: () => ({ tools: { Bash: 1 } }),
};

describe('T009 — kill-switch (AC-05)', () => {
  it('HARNESS_NO_TELEMETRY=1 produces ZERO side effects (not even ensureTemp)', () => {
    const { d, fs } = deps({ CLAUDE_CODE_SESSION_ID: 'sess1', HARNESS_NO_TELEMETRY: '1' }, [
      liveAdapter,
    ]);
    captureTelemetry(d);
    expect(fs.writes).toEqual([]);
    expect(fs.mkdirs).toEqual([]);
    expect(fs.renames).toEqual([]);
  });

  it('default (unset) still captures — buffer segment AND the OTLP spool pair', () => {
    const { d, fs } = deps({ CLAUDE_CODE_SESSION_ID: 'sess1' }, [liveAdapter]);
    captureTelemetry(d);
    expect(fs.writes.some((p) => p.includes('/telemetry/'))).toBe(true);
    // T015: the spool .jsonl pair is part of the captured output (T010) — so the
    // kill-switch test above (writes === []) also proves the spool is suppressed.
    expect(fs.writes.some((p) => p.includes('.logs.jsonl'))).toBe(true);
    expect(fs.writes.some((p) => p.includes('.metrics.jsonl'))).toBe(true);
  });
});

describe('T009 — fail-safe wrapper (AC-09)', () => {
  it('a throwing adapter.extract never propagates (host command unharmed)', () => {
    const throwing: HarnessAdapter = {
      harness: 'claude-code',
      handles: () => true,
      currentPosition: () => 10,
      extract: () => {
        throw new Error('corrupt transcript');
      },
    };
    const { d } = deps({ CLAUDE_CODE_SESSION_ID: 'sess1' }, [throwing]);
    expect(() => captureTelemetry(d)).not.toThrow();
  });

  it('a throwing adapter.currentPosition never propagates', () => {
    const throwing: HarnessAdapter = {
      harness: 'claude-code',
      handles: () => true,
      currentPosition: () => {
        throw new Error('missing dir');
      },
      extract: () => ({}),
    };
    const { d } = deps({ CLAUDE_CODE_SESSION_ID: 'sess1' }, [throwing]);
    expect(() => captureTelemetry(d)).not.toThrow();
  });
});
