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
    expect(seg?.skills).toEqual({});
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
