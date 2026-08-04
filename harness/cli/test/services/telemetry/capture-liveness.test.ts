import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import {
  type CaptureProbe,
  classifyAttempt,
  evaluateCaptureLiveness,
  isResidueLoss,
  LIVENESS_RESIDUE_IDLE_MS,
  LIVENESS_STALL_THRESHOLD,
  type LivenessRecord,
  livenessPathFor,
  mergeAttempt,
  newCaptureProbe,
  parseLivenessRecord,
  readLivenessRecords,
  recordCaptureAttempt,
  sourceExtent,
} from '../../../src/services/telemetry/capture-liveness.js';

/**
 * Plan 070 · deliverable 1 — the capture-liveness detector, unit level.
 *
 * The defect this instrument exists for is invisible BY CONSTRUCTION: capture
 * swallows its own failures (the zero-host-impact contract), so a session that
 * stops capturing commits a plausible, non-zero, badly wrong number instead of
 * an obvious gap. These tests pin the classification rules, the marker's
 * fold-forward arithmetic, and — critically — every shape the detector must
 * stay QUIET for (AC-3), because a detector that fires on healthy sessions gets
 * turned off and then proves nothing at all.
 */

const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';

function probe(over: Partial<CaptureProbe>): CaptureProbe {
  return { ...newCaptureProbe(), ...over };
}

function record(over: Partial<LivenessRecord>): LivenessRecord {
  return {
    session: 'sess',
    harness: 'cursor-agent',
    last_attempt_at: '2026-08-03T10:00:00.000Z',
    last_command: 'doctor',
    last_outcome: 'captured',
    cursor: 2,
    position: 2,
    captures: 1,
    anomalies: 0,
    consecutive_uncaptured: 0,
    last_capture_at: '2026-08-03T10:00:00.000Z',
    ...over,
  };
}

describe('capture liveness — classifying one attempt', () => {
  it('calls a written segment captured', () => {
    expect(classifyAttempt(probe({ captured: true, positionSupported: true }), false)).toBe(
      'captured',
    );
  });

  it('calls a swallowed throw an error even when the attempt looked healthy', () => {
    // The throw wins over every other observation: a capture that died mid-way
    // may well have read a position and still written nothing.
    expect(classifyAttempt(probe({ positionSupported: true, position: 56, cursor: 2 }), true)).toBe(
      'error',
    );
  });

  it('calls an available-but-unconsumed window unread-window', () => {
    // The defensive classification: no throw, a window plainly available, and
    // nothing written. Unreachable through today's capture branches — which is
    // exactly why it is here, to NAME a future silent-skip path instead of
    // letting it look healthy the way the 1a501a09 stall did.
    expect(
      classifyAttempt(probe({ positionSupported: true, position: 56, cursor: 2 }), false),
    ).toBe('unread-window');
  });

  it('calls an unreadable source source-unreadable, not an empty window', () => {
    expect(
      classifyAttempt(probe({ positionSupported: true, position: null, cursor: 2 }), false),
    ).toBe('source-unreadable');
  });

  it('calls a genuinely idle window no-window', () => {
    expect(classifyAttempt(probe({ positionSupported: true, position: 2, cursor: 2 }), false)).toBe(
      'no-window',
    );
  });

  it('refuses to judge an adapter that cannot report a position', () => {
    // The null-default adapter (and any future harness without a source) must
    // never be reported as stalled — we do not claim a defect we cannot see.
    expect(classifyAttempt(probe({ positionSupported: false, position: null }), false)).toBe(
      'position-unsupported',
    );
  });

  it('treats a first capture (no prior watermark) as an available window, not an idle one', () => {
    expect(
      classifyAttempt(probe({ positionSupported: true, position: 5, cursor: null }), false),
    ).toBe('unread-window');
  });
});

describe('capture liveness — folding attempts into the marker', () => {
  const base = {
    session: 'sess',
    harness: 'cursor-agent',
    command: 'doctor',
    at: '2026-08-03T10:00:00.000Z',
    cursor: 2,
    position: 56,
  };

  it('counts consecutive un-captured attempts', () => {
    const first = mergeAttempt(null, { ...base, outcome: 'error' });
    const second = mergeAttempt(first, { ...base, outcome: 'source-unreadable' });
    expect(second.consecutive_uncaptured).toBe(2);
    expect(second.anomalies).toBe(2);
  });

  it('resets the consecutive counter on a capture but never forgets the lost windows', () => {
    const stalled = mergeAttempt(mergeAttempt(null, { ...base, outcome: 'error' }), {
      ...base,
      outcome: 'error',
    });
    const recovered = mergeAttempt(stalled, { ...base, outcome: 'captured' });
    expect(recovered.consecutive_uncaptured).toBe(0);
    // The windows already lost stay on the record — recovery is not amnesia.
    expect(recovered.anomalies).toBe(2);
    expect(recovered.captures).toBe(1);
  });

  it('keeps a source path learned earlier when a later attempt cannot resolve one', () => {
    const known = mergeAttempt(null, {
      ...base,
      outcome: 'captured',
      sourcePath: '/t/conv/conv.jsonl',
    });
    const blind = mergeAttempt(known, { ...base, outcome: 'source-unreadable', sourcePath: null });
    // Losing the path exactly when the source became unreadable would erase the
    // residue check at the moment it matters most.
    expect(blind.source).toBe('/t/conv/conv.jsonl');
  });

  it('records the error class only — never a message', () => {
    const folded = mergeAttempt(null, { ...base, outcome: 'error', errorKind: 'TypeError' });
    expect(folded.last_error_kind).toBe('TypeError');
    expect(JSON.stringify(folded)).not.toContain('/repo');
  });
});

describe('capture liveness — the marker file', () => {
  const attempt = {
    session: 'sess-1',
    harness: 'cursor-agent',
    command: 'doctor',
    at: '2026-08-03T10:00:00.000Z',
    cursor: 2,
    position: 56,
  };

  function deps(files: Record<string, string> = {}) {
    const fs = new FakeFs(files);
    return { fs, proc: new FakeProcess({}, REPO) };
  }

  it('persists an anomalous attempt', () => {
    const d = deps();
    recordCaptureAttempt(d, REPO, { ...attempt, outcome: 'error', errorKind: 'RangeError' });
    const written = d.fs.readText(livenessPathFor(REPO, 'sess-1'));
    expect(written).not.toBeNull();
    expect(parseLivenessRecord(written)?.last_outcome).toBe('error');
  });

  it('writes nothing at all for a neutral idle attempt', () => {
    // The hot path must stay as write-free as it was before this module existed:
    // an idle `flow rail` poll captured nothing and had nothing to capture.
    const d = deps();
    recordCaptureAttempt(d, REPO, { ...attempt, outcome: 'no-window' });
    recordCaptureAttempt(d, REPO, { ...attempt, outcome: 'position-unsupported' });
    expect(d.fs.writes).toEqual([]);
  });

  it('never throws when the filesystem does', () => {
    const proc = new FakeProcess({}, REPO);
    const hostile = {
      ...new FakeFs(),
      readText: () => null,
      exists: () => true,
      mkdirp: () => {},
      writeText: () => {
        throw new Error('ENOSPC');
      },
      rename: () => {},
    } as unknown as FakeFs;
    expect(() =>
      recordCaptureAttempt({ fs: hostile, proc }, REPO, { ...attempt, outcome: 'error' }),
    ).not.toThrow();
  });

  it('reads a corrupt marker as absent rather than exploding', () => {
    expect(parseLivenessRecord('{not json')).toBeNull();
    expect(parseLivenessRecord('{"harness":"x"}')).toBeNull(); // no session key
    expect(parseLivenessRecord(null)).toBeNull();
  });

  it('collects every session lane in the telemetry dir', () => {
    const marker = `${JSON.stringify(record({ session: 'a' }))}\n`;
    const fs = new FakeFs(
      { [`${TEL}/a.liveness.json`]: marker, [`${TEL}/a.cursor`]: '2' },
      { [TEL]: ['a.liveness.json', 'a.cursor', 'a'] },
    );
    const found = readLivenessRecords(fs, REPO);
    expect(found.map((r) => r.session)).toEqual(['a']);
  });
});

describe('capture liveness — the detector fires', () => {
  it('fires on a lane at the stall threshold', () => {
    const verdict = evaluateCaptureLiveness([
      record({
        consecutive_uncaptured: LIVENESS_STALL_THRESHOLD,
        last_outcome: 'error',
        cursor: 2,
        position: 56,
        anomalies: 2,
      }),
    ]);
    expect(verdict.stalled).toHaveLength(1);
    expect(verdict.stalled[0]).toMatchObject({ cursor: 2, position: 56, last_outcome: 'error' });
  });

  it('stays quiet at one anomaly but still reports it', () => {
    // One blip is not an alarm — but it is not hidden either.
    const verdict = evaluateCaptureLiveness([
      record({ consecutive_uncaptured: 1, anomalies: 1, last_outcome: 'error' }),
    ]);
    expect(verdict.stalled).toEqual([]);
    expect(verdict.anomalies).toBe(1);
  });
});

describe('capture liveness — the detector stays quiet on healthy shapes (AC-3)', () => {
  it('is quiet for a fresh session that captured on its first command', () => {
    expect(
      evaluateCaptureLiveness([record({ captures: 1, consecutive_uncaptured: 0 })]).stalled,
    ).toEqual([]);
  });

  it('is quiet when no lane has ever been recorded', () => {
    // Zero-harness runs and kill-switched runs are never eligible, so they leave
    // no marker at all — absence of a lane is not a stall.
    const verdict = evaluateCaptureLiveness([]);
    expect(verdict.stalled).toEqual([]);
    expect(verdict.sessions).toBe(0);
  });

  it('is quiet for a lane that recovered', () => {
    expect(
      evaluateCaptureLiveness([record({ anomalies: 3, consecutive_uncaptured: 0, captures: 4 })])
        .stalled,
    ).toEqual([]);
  });
});

describe('capture liveness — unconsumed residue on a finished lane', () => {
  const IDLE = '2026-08-03T10:00:00.000Z';
  const LATER = new Date(Date.parse(IDLE) + LIVENESS_RESIDUE_IDLE_MS + 1000).toISOString();
  const SOON = new Date(Date.parse(IDLE) + 60_000).toISOString();

  it('flags a quiet lane that left behind more than it ever captured', () => {
    // The 1a501a09 shape as it looks AFTER the session ends: every attempt was
    // individually plausible, and the transcript reached 56 lines with the
    // watermark still at 2.
    const verdict = evaluateCaptureLiveness(
      [record({ cursor: 2, source: '/t/conv.jsonl', source_unit: 'nonempty-lines' })],
      () => 56,
      LATER,
    );
    expect(verdict.residue).toHaveLength(1);
    expect(verdict.residue[0]).toMatchObject({ cursor: 2, extent: 56, residue: 54 });
  });

  it('does not call a LIVE lane a loss', () => {
    // A working agent is always a few lines ahead of its last capture. That is
    // the steady state, not a defect.
    const verdict = evaluateCaptureLiveness(
      [record({ cursor: 2, source: '/t/conv.jsonl' })],
      () => 56,
      SOON,
    );
    expect(verdict.residue).toEqual([]);
  });

  it('does not fire on a normal end-of-session tail', () => {
    // The turns after a session's last harness command are ALWAYS unconsumed;
    // a detector that calls that a defect would fire on every healthy session.
    const verdict = evaluateCaptureLiveness(
      [record({ cursor: 200, source: '/t/conv.jsonl' })],
      () => 203,
      LATER,
    );
    expect(verdict.residue).toEqual([]);
  });

  it('does not fire on a tiny session with a tiny tail', () => {
    expect(isResidueLoss(2, 5)).toBe(false); // 3 unconsumed — below the floor
    expect(isResidueLoss(2, 56)).toBe(true); // 54 unconsumed, 27x the watermark
    expect(isResidueLoss(200, 203)).toBe(false); // long session, ordinary tail
  });

  it('makes no residue claim when the source cannot be re-measured or was never named', () => {
    expect(
      evaluateCaptureLiveness([record({ cursor: 2, source: '/gone.jsonl' })], () => null, LATER)
        .residue,
    ).toEqual([]);
    expect(evaluateCaptureLiveness([record({ cursor: 2 })], () => 56, LATER).residue).toEqual([]);
  });

  it('reports a stalled lane once, as a stall rather than twice', () => {
    const verdict = evaluateCaptureLiveness(
      [record({ consecutive_uncaptured: 5, cursor: 2, source: '/t/conv.jsonl' })],
      () => 56,
      LATER,
    );
    expect(verdict.stalled).toHaveLength(1);
    expect(verdict.residue).toEqual([]);
  });

  it('measures a source in the same unit the adapters do — non-empty lines', () => {
    const fs = new FakeFs({ '/t/conv.jsonl': '{"a":1}\n\n{"b":2}\n   \n{"c":3}\n' });
    expect(sourceExtent(fs, '/t/conv.jsonl')).toBe(3);
    expect(sourceExtent(fs, '/t/missing.jsonl')).toBeNull();
  });
});
