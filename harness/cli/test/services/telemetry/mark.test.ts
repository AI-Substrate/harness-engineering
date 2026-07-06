import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { buildMarkEvent, MARK_SLUG_RE, runMark } from '../../../src/services/telemetry/mark.js';
import type { Segment } from '../../../src/services/telemetry/segment.js';

/**
 * T001 (plan 053 · AC-02/AC-05) — the `mark` shape-guard.
 *
 * A peer's self-attestation is COUNTS-ONLY and LEAK-PROOF BY CONSTRUCTION: the
 * `kind`/`verdict` are identifier SLUGS (`^[a-z][a-z0-9-]{0,31}$`, the
 * `record-service` slug family + a 32-char bound) and the finding buckets are
 * non-negative INTEGERS. There is NO free-text field — a prose `verdict`, an
 * uppercase `kind`, a value with whitespace, or an over-long slug is REJECTED,
 * so no prose can ride the marker onto the wire (Constitution P12).
 */
describe('T001 — mark slug guard: valid identifiers accepted', () => {
  it('accepts a lowercase slug kind + verdict', () => {
    const r = buildMarkEvent({
      t: '2026-07-05T00:00:00Z',
      kind: 'review',
      verdict: 'fix-required',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.event.kind).toBe('mark');
      expect(r.event.mark_kind).toBe('review');
      expect(r.event.verdict).toBe('fix-required');
    }
  });

  it('accepts a kind with digits and hyphens', () => {
    const r = buildMarkEvent({ t: '2026-07-05T00:00:00Z', kind: 'phase-1-review' });
    expect(r.ok).toBe(true);
  });

  it('accepts a 32-char slug (the boundary) and omits verdict when absent', () => {
    const kind = `a${'b'.repeat(31)}`; // 32 chars
    expect(kind.length).toBe(32);
    const r = buildMarkEvent({ t: '2026-07-05T00:00:00Z', kind });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.event.verdict).toBeUndefined();
  });

  it('the exported slug regex matches the documented shape', () => {
    expect(MARK_SLUG_RE.source).toBe('^[a-z][a-z0-9-]{0,31}$');
  });
});

describe('T001 — mark slug guard: invalid inputs rejected with a shaped next_action', () => {
  const bad: Array<[string, string]> = [
    ['uppercase', 'Review'],
    ['whitespace', 'fix required'],
    ['prose', 'this needs a fix please'],
    ['leading digit', '1review'],
    ['leading hyphen', '-review'],
    ['empty', ''],
    ['over 32 chars', `a${'b'.repeat(32)}`],
    ['newline', 'review\n'],
    ['underscore', 'fix_required'],
  ];
  for (const [label, kind] of bad) {
    it(`rejects a ${label} kind`, () => {
      const r = buildMarkEvent({ t: '2026-07-05T00:00:00Z', kind });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.next_action).toContain('^[a-z][a-z0-9-]{0,31}$');
    });
  }

  it('rejects a valid kind but an invalid verdict', () => {
    const r = buildMarkEvent({
      t: '2026-07-05T00:00:00Z',
      kind: 'review',
      verdict: 'Fix Required',
    });
    expect(r.ok).toBe(false);
  });
});

describe('T001 — mark counts: integer-only, non-negative, closed vocab', () => {
  it('accepts integer finding buckets', () => {
    const r = buildMarkEvent({
      t: '2026-07-05T00:00:00Z',
      kind: 'review',
      counts: { findings_critical: 1, findings_high: 2 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.event.counts).toEqual({ findings_critical: 1, findings_high: 2 });
  });

  it('drops zero-valued buckets (parity with the artifact serializer)', () => {
    const r = buildMarkEvent({
      t: '2026-07-05T00:00:00Z',
      kind: 'review',
      counts: { findings_critical: 0, findings_high: 3 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.event.counts).toEqual({ findings_high: 3 });
  });

  it('rejects a non-integer count', () => {
    const r = buildMarkEvent({
      t: '2026-07-05T00:00:00Z',
      kind: 'review',
      counts: { findings_critical: 1.5 },
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a negative count', () => {
    const r = buildMarkEvent({
      t: '2026-07-05T00:00:00Z',
      kind: 'review',
      counts: { findings_high: -1 },
    });
    expect(r.ok).toBe(false);
  });
});

// ── T005: the runMark service wiring (emit onto the caller's own lane) ─────────
const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';

function markDeps(env: Record<string, string>): {
  fs: FakeFs;
  deps: Parameters<typeof runMark>[0];
} {
  const fs = new FakeFs({});
  return {
    fs,
    deps: {
      fs,
      env: new FakeEnv(env),
      proc: new FakeProcess({}, REPO),
      clock: new FakeClock('2026-07-05T08:00:00.000Z'),
    },
  };
}

describe('T005 — runMark emits a marker segment onto the caller session lane (AC-01)', () => {
  it('writes a <seq>.json segment carrying the MarkEvent with tokens:null', () => {
    const { fs, deps } = markDeps({ CLAUDE_CODE_SESSION_ID: 'cl-42' });
    const r = runMark(deps, {
      kind: 'review',
      verdict: 'fix-required',
      counts: { findings_critical: 1 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sessionId).toBe('cl-42');

    const raw = fs.readText(`${TEL}/cl-42/1.json`);
    expect(raw).not.toBeNull();
    const seg = JSON.parse(raw as string) as Segment;
    // cost-excluded by construction.
    expect(seg.tokens).toBeNull();
    // exactly one event: the mark.
    expect(seg.event_stream).toHaveLength(1);
    const ev = seg.event_stream[0];
    expect(ev.kind).toBe('mark');
    expect(ev).toMatchObject({
      kind: 'mark',
      mark_kind: 'review',
      verdict: 'fix-required',
      counts: { findings_critical: 1 },
    });
  });

  it('does NOT write an OTLP sidecar (mark rides get-fleet .json, not the shard transport)', () => {
    const { fs, deps } = markDeps({ CLAUDE_CODE_SESSION_ID: 'cl-42' });
    runMark(deps, { kind: 'review' });
    expect(fs.readText(`${TEL}/cl-42/1.logs.jsonl`)).toBeNull();
    expect(fs.readText(`${TEL}/cl-42/1.metrics.jsonl`)).toBeNull();
  });

  it('carries the PIJ join keys into captured_env so get-fleet can attribute the lane', () => {
    const { fs, deps } = markDeps({ CLAUDE_CODE_SESSION_ID: 'cl-42', PIJ_SESSION_ID: 'pij-rev' });
    runMark(deps, { kind: 'review' });
    const seg = JSON.parse(fs.readText(`${TEL}/cl-42/1.json`) as string) as Segment;
    expect(seg.captured_env?.PIJ_SESSION_ID).toBe('pij-rev');
  });

  it('no active harness session → unconfigured (best-effort, non-blocking; AC-02)', () => {
    const { deps } = markDeps({});
    const r = runMark(deps, { kind: 'review' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe('unconfigured');
  });

  it('a bad --kind slug → unconfigured with the shape hint, no segment written (AC-02)', () => {
    const { fs, deps } = markDeps({ CLAUDE_CODE_SESSION_ID: 'cl-42' });
    const r = runMark(deps, { kind: 'Fix This Please' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe('unconfigured');
      expect(r.next_action).toContain('^[a-z][a-z0-9-]{0,31}$');
    }
    expect(fs.readText(`${TEL}/cl-42/1.json`)).toBeNull();
  });
});
