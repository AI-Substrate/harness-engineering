import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { claudeTranscriptPath } from '../../../src/services/telemetry/adapters/claude-adapter.js';
import { coreTelemetryAdapters } from '../../../src/services/telemetry/adapters/index.js';
import {
  type CaptureDeps,
  captureTelemetry,
} from '../../../src/services/telemetry/capture-service.js';
import { cursorPathFor, readCursor, telemetryDir } from '../../../src/services/telemetry/cursor.js';

/**
 * T005 (plan 034 Phase 3 · AC-01 · M-K6) — the STRUCTURAL perf sensor for the
 * capture path. NOT a wall-clock threshold (grill-agent-done reshaped that). The
 * honest, buildable guarantee (the Claude adapter reads the whole transcript via
 * a port with no range read — M1) is:
 *   1. bounded read-COUNT — the transcript is read a small constant number of
 *      times per capture (currentPosition + extract = 2), never O(history); and
 *   2. cursor-incremental PARSE — a repeat capture with no new lines re-counts
 *      nothing (the cursor window bounds what is parsed).
 * Plus the AC-06 PR-invisibility guard: every write lands under the gitignored
 * `.harness/temp/telemetry/` tree, nothing else.
 */

const REPO = '/repo';
const HOME = '/home/u';
const SESSION = 'sess-perf-1';
const TRANSCRIPT_PATH = claudeTranscriptPath(HOME, REPO, SESSION);
const TRANSCRIPT = readFileSync(
  new URL('./fixtures/claude-transcript.jsonl', import.meta.url),
  'utf8',
);

function seededFs(): FakeFs {
  return new FakeFs({ [TRANSCRIPT_PATH]: TRANSCRIPT });
}

/** The most-recently written buffer segment (via the rename history — robust to
 *  FakeFs.readdir not listing written files, so it doesn't hinge on nextSeq). */
// biome-ignore lint/suspicious/noExplicitAny: test reads an opaque serialized segment
function latestSegment(fs: FakeFs): any {
  const target = [...fs.renames].reverse().find((r) => r.endsWith('.json'));
  if (target === undefined) throw new Error('no segment was written');
  return JSON.parse(fs.readText(target.split('->')[1] ?? '') as string);
}

function captureDeps(fs: FakeFs): CaptureDeps {
  return {
    fs,
    env: new FakeEnv({ CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_EFFORT: 'high' }, HOME),
    clock: new FakeClock('2026-06-23T00:00:00.000Z'),
    proc: new FakeProcess({}, REPO),
    git: new FakeGit({ isRepo: true, branch: 'b', remoteUrl: 'github.com/x/y' }),
    command: 'doctor',
    adapters: coreTelemetryAdapters,
  };
}

describe('capture path — structural perf sensor (plan 034 Phase 3 · M-K6)', () => {
  it('reads the transcript a bounded constant (2: currentPosition + extract), never O(history)', () => {
    const fs = seededFs();
    const spy = vi.spyOn(fs, 'readText');
    captureTelemetry(captureDeps(fs));
    const transcriptReads = spy.mock.calls.filter(([p]) => p === TRANSCRIPT_PATH).length;
    // M-K6.1: the M1 debt is exactly two whole-file reads — bounded, not per-line.
    expect(transcriptReads).toBe(2);
  });

  it('is cursor-incremental: a repeat capture with no new lines re-counts nothing (M-K6.2)', () => {
    const fs = seededFs();
    captureTelemetry(captureDeps(fs)); // run 1: cursor null → full window [0..8) → counts present
    const seg1 = latestSegment(fs);
    expect(seg1.tokens).not.toBeNull(); // first capture counted the window
    // The watermark advanced to all 8 non-empty transcript lines (quirk-independent proof).
    expect(readCursor(fs, cursorPathFor(REPO, SESSION))).toBe(8);

    captureTelemetry(captureDeps(fs)); // run 2: cursor at 8, position 8 → empty window
    const seg2 = latestSegment(fs);
    expect(seg2.tokens).toBeNull(); // repeat: windowed parse yields nothing → no history re-count
  });

  it('AC-06 PR-invisibility: every write lands under the gitignored .harness/temp tree', () => {
    const fs = seededFs();
    captureTelemetry(captureDeps(fs));
    // The whole temp tree self-ignores (ensureTemp writes temp/.gitignore = `*`), so
    // both the buffer (telemetry/…) and that .gitignore live under .harness/temp.
    const tempRoot = telemetryDir(REPO).replace(/\/telemetry$/, ''); // …/.harness/temp
    const written = [...fs.writes, ...fs.renames.map((r) => r.split('->')[1] ?? '')];
    expect(written.length).toBeGreaterThan(0);
    for (const path of written) {
      expect(path.startsWith(`${tempRoot}/`)).toBe(true);
    }
  });
});
