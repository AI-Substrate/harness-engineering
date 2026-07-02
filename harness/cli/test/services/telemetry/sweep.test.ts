import { describe, expect, it } from 'vitest';
import {
  fingerprintBlobs,
  monthRefPrefix,
  nextSweepCache,
  parseMonth,
  parseTelemetryRef,
  planMonthSweep,
  refInMonth,
  type SweepCache,
  type SweepRefInput,
} from '../../../src/services/telemetry/sweep.js';

/**
 * 048 Phase 1 · T1.6 (AC-01) — the PURE month-sweep planner. The sweep is a
 * composition over committed `refs/harness-telemetry/YYYY/MM/*` shards: enumerate →
 * group by session → decide reuse-vs-reexport by a content fingerprint. This suite
 * pins the planning + the per-session export cache (the act does the git/fs I/O).
 *
 * Named mutation: `re-sweep-re-exports-unchanged-ref` (planner ignores the cache
 * and marks an unchanged session fresh) ⇒ RED.
 */

const ref = (datePath: string, session: string, fingerprint: string): SweepRefInput => ({
  ref: `refs/harness-telemetry/${datePath}/${session}`,
  session,
  datePath,
  fingerprint,
});

describe('T1.6 — month + ref parsing', () => {
  it('parseMonth validates YYYY-MM and rejects garbage / impossible months', () => {
    expect(parseMonth('2026-07')).toEqual({ yyyy: '2026', mm: '07' });
    expect(parseMonth('2026-7')).toBeNull();
    expect(parseMonth('2026/07')).toBeNull();
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('2026-00')).toBeNull();
    expect(parseMonth('nope')).toBeNull();
  });

  it('monthRefPrefix builds the enumerated glob prefix', () => {
    expect(monthRefPrefix('2026-07')).toBe('refs/harness-telemetry/2026/07/');
    expect(monthRefPrefix('bad')).toBe('');
  });

  it('parseTelemetryRef extracts session + date shard, rejecting non-telemetry refs', () => {
    expect(parseTelemetryRef('refs/harness-telemetry/2026/07/01/abc-123')).toEqual({
      session: 'abc-123',
      datePath: '2026/07/01',
    });
    expect(parseTelemetryRef('refs/heads/main')).toBeNull();
    expect(parseTelemetryRef('refs/harness-telemetry/2026/07/abc')).toBeNull(); // too short
  });

  it('refInMonth matches only the requested month', () => {
    expect(refInMonth('2026/07/01', '2026-07')).toBe(true);
    expect(refInMonth('2026/07/31', '2026-07')).toBe(true);
    expect(refInMonth('2026/06/30', '2026-07')).toBe(false);
    expect(refInMonth('2026/08/01', '2026-07')).toBe(false);
  });
});

describe('T1.6 — fingerprintBlobs (the tip proxy)', () => {
  it('is order-independent but content-sensitive', () => {
    const a = fingerprintBlobs([
      { name: '0.logs.jsonl', content: 'AAA' },
      { name: '0.metrics.jsonl', content: 'BBB' },
    ]);
    const reordered = fingerprintBlobs([
      { name: '0.metrics.jsonl', content: 'BBB' },
      { name: '0.logs.jsonl', content: 'AAA' },
    ]);
    const changed = fingerprintBlobs([
      { name: '0.logs.jsonl', content: 'AAA!' },
      { name: '0.metrics.jsonl', content: 'BBB' },
    ]);
    expect(reordered).toBe(a); // enumeration order must not matter
    expect(changed).not.toBe(a); // any content change invalidates
  });
});

describe('T1.6 — planMonthSweep', () => {
  it('keeps only in-month refs, groups by session, and sorts', () => {
    const plan = planMonthSweep(
      '2026-07',
      [
        ref('2026/07/01', 'sess-b', 'fb'),
        ref('2026/07/02', 'sess-a', 'fa'),
        ref('2026/06/30', 'sess-c', 'fc'), // wrong month → dropped
      ],
      {},
    );
    expect(plan.sessions.map((s) => s.session)).toEqual(['sess-a', 'sess-b']);
    expect(plan.total_sessions).toBe(2);
    expect(plan.month_prefix).toBe('refs/harness-telemetry/2026/07/');
  });

  it('groups a session spanning multiple days into ONE export unit', () => {
    const plan = planMonthSweep(
      '2026-07',
      [ref('2026/07/01', 'sess-a', 'f1'), ref('2026/07/03', 'sess-a', 'f3')],
      {},
    );
    expect(plan.sessions).toHaveLength(1);
    expect(plan.sessions[0].refs).toEqual([
      'refs/harness-telemetry/2026/07/01/sess-a',
      'refs/harness-telemetry/2026/07/03/sess-a',
    ]);
  });

  it('marks a session cached when its combined fingerprint matches the prior cache', () => {
    const refs = [ref('2026/07/01', 'sess-a', 'f1'), ref('2026/07/03', 'sess-a', 'f3')];
    const first = planMonthSweep('2026-07', refs, {});
    expect(first.sessions[0].cached).toBe(false); // no prior cache → fresh
    const cache: SweepCache = nextSweepCache(first);
    // Re-sweep with the SAME refs + the cache the first sweep produced.
    const second = planMonthSweep('2026-07', refs, cache);
    // MUTATION re-sweep-re-exports-unchanged-ref: ignoring the cache ⇒ cached=false ⇒ RED.
    expect(second.sessions[0].cached).toBe(true);
    expect(second.reused).toBe(1);
    expect(second.fresh).toBe(0);
  });

  it('re-exports a session whose shard tip CHANGED (a new segment appended)', () => {
    const refsV1 = [ref('2026/07/01', 'sess-a', 'f1')];
    const cache = nextSweepCache(planMonthSweep('2026-07', refsV1, {}));
    // Same session, but the shard content changed (new fingerprint) ⇒ not cached.
    const refsV2 = [ref('2026/07/01', 'sess-a', 'f1-CHANGED')];
    const plan = planMonthSweep('2026-07', refsV2, cache);
    expect(plan.sessions[0].cached).toBe(false);
    expect(plan.fresh).toBe(1);
  });

  it('an empty month yields an empty, non-crashing plan', () => {
    const plan = planMonthSweep('2026-07', [], {});
    expect(plan).toMatchObject({ total_sessions: 0, reused: 0, fresh: 0, sessions: [] });
  });
});
