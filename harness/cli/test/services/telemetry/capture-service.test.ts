import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type {
  HarnessAdapter,
  HarnessCapabilities,
} from '../../../src/services/telemetry/adapters/harness-adapter.js';
import {
  type CaptureDeps,
  captureTelemetry,
  computeWindow,
  detectHarness,
} from '../../../src/services/telemetry/capture-service.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import type { Segment } from '../../../src/services/telemetry/segment.js';

/**
 * T005 (plan 1.4 · AC-01 · C3) — innermost-harness detection, cursor windowing,
 * and the DESIGNED edge no-ops (not the T009 catch-all). Tests-first → T006.
 */

const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';

/** A test adapter with a controllable source extent + caps (stands in for Phase 2). */
function testAdapter(
  harness: string,
  position: number | null,
  caps: HarnessCapabilities,
): HarnessAdapter {
  return {
    harness,
    handles: (id) => id === harness,
    currentPosition: () => position,
    extract: () => caps,
  };
}

function deps(
  over: Partial<CaptureDeps> & { files?: Record<string, string>; env?: Record<string, string> },
): { d: CaptureDeps; fs: FakeFs } {
  const fs = new FakeFs(over.files ?? {});
  const d: CaptureDeps = {
    fs,
    env: new FakeEnv(over.env ?? {}),
    clock: new FakeClock('2026-06-23T04:58:00.000Z'),
    proc: new FakeProcess({}, REPO),
    git: new FakeGit({ isRepo: true, branch: '034-x', remoteUrl: 'github.com/x/y' }),
    command: 'flow',
    adapters: over.adapters ?? [],
  };
  return { d, fs };
}

/**
 * Read the first segment buffer entry a single capture wrote, or null. (Each
 * test does ONE capture → seq 1; FakeFs.readdir doesn't enumerate written files,
 * so we read the deterministic `1.json` path directly.)
 */
function readWrittenSegment(fs: FakeFs, sessionId: string): Segment | null {
  const raw = fs.readText(`${TEL}/${sessionId}/1.json`);
  return raw === null ? null : (JSON.parse(raw) as Segment);
}

describe('T005 — detectHarness (innermost wins)', () => {
  it('Copilot beats Claude when both env vars are set (nested)', () => {
    const env = new FakeEnv({
      COPILOT_AGENT_SESSION_ID: 'cop-1',
      CLAUDE_CODE_SESSION_ID: 'cl-1',
    });
    expect(detectHarness(env)).toEqual({ harness: 'copilot-cli', sessionId: 'cop-1' });
  });

  it('detects Claude when only its var is set', () => {
    const env = new FakeEnv({ CLAUDE_CODE_SESSION_ID: 'cl-1' });
    expect(detectHarness(env)).toEqual({ harness: 'claude-code', sessionId: 'cl-1' });
  });

  it('Cursor beats Claude when both are set (cursor-agent embeds a Claude runtime)', () => {
    const env = new FakeEnv({
      CURSOR_CONVERSATION_ID: 'cur-1',
      CLAUDE_CODE_SESSION_ID: 'cl-1',
    });
    expect(detectHarness(env)).toEqual({ harness: 'cursor-agent', sessionId: 'cur-1' });
  });

  it('returns null when no harness env is present (zero-harness)', () => {
    expect(detectHarness(new FakeEnv({}))).toBeNull();
  });
});

describe('T005 — computeWindow', () => {
  it('first run (no prior cursor) = session-start from 0', () => {
    expect(computeWindow(null, 240)).toEqual({ since: 'session-start', from: 0, to: 240 });
  });
  it('subsequent run = last-command delta', () => {
    expect(computeWindow(100, 240)).toEqual({ since: 'last-command', from: 100, to: 240 });
  });
  it('source shrank (rotation/truncation) → reset to session-start', () => {
    expect(computeWindow(100, 50)).toEqual({ since: 'session-start', from: 0, to: 50 });
  });
  it('no current position (missing source) → empty window at the watermark', () => {
    expect(computeWindow(100, null)).toEqual({ since: 'last-command', from: 100, to: 100 });
  });
});

describe('T005 — captureTelemetry happy path', () => {
  it('writes a buffer segment for the since-last window and advances the cursor', () => {
    const { d, fs } = deps({
      env: { CLAUDE_CODE_SESSION_ID: 'sess1' },
      files: { [`${TEL}/sess1.cursor`]: '100' },
      adapters: [
        testAdapter('claude-code', 240, { tools: { Bash: 3 }, skills: { 'the-flow': 1 } }),
      ],
    });

    captureTelemetry(d);

    const seg = readWrittenSegment(fs, 'sess1');
    expect(seg).not.toBeNull();
    expect(seg?.harness).toBe('claude-code');
    expect(seg?.harness_session_id).toBe('sess1');
    expect(seg?.window).toEqual({ since: 'last-command', from: 100, to: 240 });
    expect(seg?.tools.Bash).toBe(3);
    expect(seg?.command).toBe('flow');
    // cursor advanced to the new high-water mark
    expect(fs.readText(`${TEL}/sess1.cursor`)).toBe('240');
  });

  it('with no real adapter, the null-default writes a schema-valid all-null segment', () => {
    const { d, fs } = deps({ env: { CLAUDE_CODE_SESSION_ID: 'sessN' }, adapters: [] });
    captureTelemetry(d);
    const seg = readWrittenSegment(fs, 'sessN');
    expect(seg).not.toBeNull();
    expect(seg?.tokens).toBeNull();
    expect(seg?.skills).toBeUndefined(); // empty v1-compat collections are omitted (v2)
    expect(seg?.harness).toBe('claude-code');
  });
});

describe('T005 — designed edge no-ops (C3)', () => {
  it('zero-harness env → clean no-op (no buffer, no writes at all)', () => {
    const { d, fs } = deps({ env: {}, adapters: [] });
    captureTelemetry(d);
    expect(fs.writes.filter((p) => p.includes('/telemetry/'))).toEqual([]);
  });

  it('missing/truncated source → empty window, segment still written (not a no-op)', () => {
    const { d, fs } = deps({
      env: { CLAUDE_CODE_SESSION_ID: 'sessE' },
      files: { [`${TEL}/sessE.cursor`]: '100' },
      adapters: [testAdapter('claude-code', null, {})], // source unreadable → null position
    });
    captureTelemetry(d);
    const seg = readWrittenSegment(fs, 'sessE');
    expect(seg?.window).toEqual({ since: 'last-command', from: 100, to: 100 });
  });

  it('corrupt cursor → reset to session-start', () => {
    const { d, fs } = deps({
      env: { CLAUDE_CODE_SESSION_ID: 'sessC' },
      files: { [`${TEL}/sessC.cursor`]: 'not-a-number' },
      adapters: [testAdapter('claude-code', 240, {})],
    });
    captureTelemetry(d);
    const seg = readWrittenSegment(fs, 'sessC');
    expect(seg?.window).toEqual({ since: 'session-start', from: 0, to: 240 });
  });
});

describe('T5.8 — session-end flush (the tail is captured by a follow-up capture)', () => {
  it('a second capture records the TAIL delta + advances the cursor (no new path)', () => {
    // The SessionEnd hook runs `harness telemetry sync`; its capture preamble is
    // just another captureTelemetry call. Model that: the source grows after the
    // first command's capture, and a second capture records the tail window.
    let position = 120;
    const adapter: HarnessAdapter = {
      harness: 'claude-code',
      handles: (id) => id === 'claude-code',
      currentPosition: () => position,
      extract: () => ({ tools: { Bash: 1 } }),
    };
    const { d, fs } = deps({ env: { CLAUDE_CODE_SESSION_ID: 'sessTail' }, adapters: [adapter] });

    captureTelemetry(d); // first command → session-start [0,120]
    expect(readWrittenSegment(fs, 'sessTail')?.window).toEqual({
      since: 'session-start',
      from: 0,
      to: 120,
    });
    expect(fs.readText(`${TEL}/sessTail.cursor`)).toBe('120');

    // work continues; the session-end flush captures the tail [120,170].
    position = 170;
    captureTelemetry(d);
    // (real FS increments <seq> via readdir; FakeFs lists dirs not files, so the
    // tail overwrites 1.json — the WINDOW + cursor are what prove the flush.)
    expect(readWrittenSegment(fs, 'sessTail')?.window).toEqual({
      since: 'last-command',
      from: 120,
      to: 170,
    });
    expect(fs.readText(`${TEL}/sessTail.cursor`)).toBe('170');
  });

  it('session ends with no tail (source unchanged) → empty-window segment, safe', () => {
    const { d, fs } = deps({
      env: { CLAUDE_CODE_SESSION_ID: 'sessNoTail' },
      files: { [`${TEL}/sessNoTail.cursor`]: '90' },
      adapters: [testAdapter('claude-code', 90, {})],
    });
    captureTelemetry(d);
    expect(readWrittenSegment(fs, 'sessNoTail')?.window).toEqual({
      since: 'last-command',
      from: 90,
      to: 90,
    });
  });
});

describe('branch-change detection + branch event', () => {
  const STREAM: Event[] = [
    { t: '2026-06-24T09:00:00Z', kind: 'prompt', words: 3 },
    { t: '2026-06-24T09:01:00Z', kind: 'turn', dur_s: 50 },
  ];

  function depsOn(fs: FakeFs, branch: string): CaptureDeps {
    return {
      fs,
      env: new FakeEnv({ CLAUDE_CODE_SESSION_ID: 'sbr' }),
      clock: new FakeClock('2026-06-24T09:02:00.000Z'),
      proc: new FakeProcess({}, REPO),
      git: new FakeGit({ isRepo: true, branch, remoteUrl: 'github.com/x/y' }),
      command: 'flow',
      adapters: [testAdapter('claude-code', 240, { event_stream: STREAM })],
    };
  }

  function branchEvent(fs: FakeFs): (Event & { to?: string; from?: string }) | undefined {
    return readWrittenSegment(fs, 'sbr')?.event_stream.find((e) => e.kind === 'branch') as
      | (Event & { to?: string; from?: string })
      | undefined;
  }

  it('records the branch; first capture is NOT a change and emits no branch event', () => {
    const fs = new FakeFs({});
    captureTelemetry(depsOn(fs, 'main'));
    const seg = readWrittenSegment(fs, 'sbr');
    expect(seg?.branch).toBe('main');
    // no `branch_changed` boolean exists — the branch event is the single signal
    expect((seg as unknown as Record<string, unknown>).branch_changed).toBeUndefined();
    expect(branchEvent(fs)).toBeUndefined();
    expect(fs.readText(`${TEL}/sbr.branch`)).toBe('main'); // persisted for next capture
  });

  it('a branch switch → a branch event (to/from), anchored to the window start, is the only signal', () => {
    const fs = new FakeFs({});
    captureTelemetry(depsOn(fs, 'main')); // 1st: records `main`
    captureTelemetry(depsOn(fs, 'feature-x')); // 2nd: now on a different branch

    const seg = readWrittenSegment(fs, 'sbr');
    expect(seg?.branch).toBe('feature-x');
    expect((seg as unknown as Record<string, unknown>).branch_changed).toBeUndefined();
    const be = branchEvent(fs);
    expect(be).toMatchObject({
      kind: 'branch',
      to: 'feature-x',
      from: 'main',
      t_precision: 'anchored',
    });
    expect(be?.t).toBe(STREAM[0].t); // anchored to the window start (non-empty stream)
    expect(seg?.event_stream[0].kind).toBe('branch'); // prepended
  });

  it('no switch (same branch) → no branch event', () => {
    const fs = new FakeFs({});
    captureTelemetry(depsOn(fs, 'main'));
    captureTelemetry(depsOn(fs, 'main'));
    expect(branchEvent(fs)).toBeUndefined();
  });

  it('a switch on an EMPTY window still emits the branch event (anchored to timecode)', () => {
    // adapter yields NO event_stream → the switch would have nothing to anchor to;
    // it now anchors to the window-end timecode and becomes the sole event.
    function emptyDeps(fs: FakeFs, branch: string): CaptureDeps {
      return {
        fs,
        env: new FakeEnv({ CLAUDE_CODE_SESSION_ID: 'sbr' }),
        clock: new FakeClock('2026-06-24T09:02:00.000Z'),
        proc: new FakeProcess({}, REPO),
        git: new FakeGit({ isRepo: true, branch, remoteUrl: 'github.com/x/y' }),
        command: 'boot',
        adapters: [testAdapter('claude-code', 240, {})], // no event_stream
      };
    }
    const fs = new FakeFs({});
    captureTelemetry(emptyDeps(fs, 'main'));
    captureTelemetry(emptyDeps(fs, 'feature-x'));
    const be = branchEvent(fs);
    expect(be).toMatchObject({
      kind: 'branch',
      to: 'feature-x',
      from: 'main',
      t_precision: 'anchored',
    });
    expect(be?.t).toBe('2026-06-24T09:02:00.000Z'); // the capture clock (no stream to anchor to)
  });
});

describe('triggering-command harness event (timeline visibility)', () => {
  const STREAM: Event[] = [
    { t: '2026-06-24T09:00:00Z', kind: 'prompt', words: 3 },
    { t: '2026-06-24T09:01:00Z', kind: 'turn', dur_s: 50 },
  ];

  function depsWith(fs: FakeFs, stream: Event[]): CaptureDeps {
    return {
      fs,
      env: new FakeEnv({ CLAUDE_CODE_SESSION_ID: 'shc' }),
      clock: new FakeClock('2026-06-24T09:02:00.000Z'),
      proc: new FakeProcess({}, REPO),
      git: new FakeGit({ isRepo: true, branch: 'main', remoteUrl: 'github.com/x/y' }),
      command: 'boot',
      adapters: [testAdapter('claude-code', 240, { event_stream: stream })],
    };
  }

  it('appends the triggering command as a zero-gap `harness` event at the window end', () => {
    const fs = new FakeFs({});
    captureTelemetry(depsWith(fs, STREAM));
    const stream = readWrittenSegment(fs, 'shc')?.event_stream ?? [];
    const last = stream[stream.length - 1];
    expect(last).toMatchObject({ kind: 'harness', verb: 'boot', t_precision: 'anchored' });
    // anchored to the LAST work event's t (zero gap) — never the capture clock, so
    // the trailing span isn't mis-attributed as working time.
    expect(last.t).toBe(STREAM[STREAM.length - 1].t);
    expect(last.t).not.toBe('2026-06-24T09:02:00Z'); // not the timecode
  });

  it('does NOT append to an empty window (stays empty, rollup null preserved)', () => {
    const fs = new FakeFs({});
    captureTelemetry(depsWith(fs, []));
    const seg = readWrittenSegment(fs, 'shc');
    expect(seg?.event_stream).toEqual([]);
    expect(seg?.rollup).toBeNull();
  });
});
