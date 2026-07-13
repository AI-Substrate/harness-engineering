import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { observeKindFromCommand } from '../../../src/services/telemetry/command-signature.js';
import type { Event, HarnessEvent } from '../../../src/services/telemetry/events.js';
import { otlpLogsToEvents, segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import { type Segment, serializeEvent } from '../../../src/services/telemetry/segment.js';

/*
Test Doc:
- Why: plan 056 adds `observe_kind` to HarnessEvent (present only on verb=observe). V-01 flagged
  that the serializer's per-field pick (segment.ts harness case) and the OTLP lane would DROP a
  field not explicitly carried. This pins the full wire path — TS event → segment serializer →
  OTLP encode → OTLP decode — so the field can never be silently lost on one lane.
- Contract: serializeEvent carries observe_kind on observe events and OMITS it elsewhere; the OTLP
  round-trip reconstructs it byte-faithfully; the emitted key set is counts/enums-only (workshop
  D5: fp + any prose field stay OUT of telemetry).
- Quality Contribution: guards AC-05 (additive + private) and the V-01 wire-path regression.
*/

const T = '2026-07-09T11:00:00Z';

function loadGolden(): Segment {
  const p = fileURLToPath(
    new URL('./fixtures/real/claude/2026-06-25-static-site/expected-segment.json', import.meta.url),
  );
  return JSON.parse(readFileSync(p, 'utf8')) as Segment;
}

describe('observe_kind — segment serializer lane (V-01)', () => {
  it('carries observe_kind on an observe harness event', () => {
    const ev: HarnessEvent = { t: T, kind: 'harness', verb: 'observe', observe_kind: 'difficulty' };
    const out = serializeEvent(ev) as HarnessEvent;
    expect(out.verb).toBe('observe');
    expect(out.observe_kind).toBe('difficulty');
  });

  it('omits observe_kind on a non-observe harness event', () => {
    const out = serializeEvent({ t: T, kind: 'harness', verb: 'checks' }) as HarnessEvent;
    expect(out.observe_kind).toBeUndefined();
    expect('observe_kind' in out).toBe(false);
  });

  it('DROPS a stray observe_kind carried on a non-observe verb (boundary gate)', () => {
    // The contract is verb-gated, not merely presence-gated: even if a non-observe
    // event arrives carrying observe_kind, the serializer must NOT copy it through.
    const stray = {
      t: T,
      kind: 'harness',
      verb: 'checks',
      observe_kind: 'difficulty',
    } as HarnessEvent;
    const out = serializeEvent(stray) as HarnessEvent;
    expect(out.verb).toBe('checks');
    expect(out.observe_kind).toBeUndefined();
    expect('observe_kind' in out).toBe(false);
  });

  it('emits ONLY the allowlisted keys — no fp, no prose field (workshop D5 guard)', () => {
    const ev: HarnessEvent = { t: T, kind: 'harness', verb: 'observe', observe_kind: 'magic-wand' };
    const out = serializeEvent(ev);
    expect(new Set(Object.keys(out))).toEqual(new Set(['t', 'kind', 'verb', 'observe_kind']));
    const json = JSON.stringify(out);
    expect(json).not.toContain('"fp"');
    expect(json).not.toContain('"description"');
    expect(json).not.toContain('"reason"');
  });
});

describe('observe_kind — OTLP round-trip lane (V-01)', () => {
  it('survives segment → OTLP encode → decode byte-faithfully', () => {
    const seg = loadGolden();
    const anchor = seg.event_stream[0]?.t ?? T;
    const observe: HarnessEvent = {
      t: anchor,
      kind: 'harness',
      verb: 'observe',
      observe_kind: 'improvement-suggestion',
    };
    const spliced: Segment = { ...seg, event_stream: [...seg.event_stream, observe] };
    const recon = otlpLogsToEvents(segmentToOtlpLogs(spliced));
    const back = recon.find(
      (e): e is HarnessEvent => e.kind === 'harness' && (e as HarnessEvent).verb === 'observe',
    );
    expect(back?.observe_kind).toBe('improvement-suggestion');
  });

  it('a plain harness event round-trips with no observe_kind', () => {
    const seg = loadGolden();
    const anchor = seg.event_stream[0]?.t ?? T;
    const checks: Event = { t: anchor, kind: 'harness', verb: 'checks' };
    const spliced: Segment = { ...seg, event_stream: [...seg.event_stream, checks] };
    const recon = otlpLogsToEvents(segmentToOtlpLogs(spliced));
    const back = recon.find(
      (e): e is HarnessEvent => e.kind === 'harness' && (e as HarnessEvent).verb === 'checks',
    );
    expect(back).toBeDefined();
    expect(back?.observe_kind).toBeUndefined();
  });

  it('DROPS a stray observe_kind carried on a non-observe verb through the OTLP encode', () => {
    const seg = loadGolden();
    const anchor = seg.event_stream[0]?.t ?? T;
    const stray = {
      t: anchor,
      kind: 'harness',
      verb: 'checks',
      observe_kind: 'difficulty',
    } as HarnessEvent;
    const spliced: Segment = { ...seg, event_stream: [...seg.event_stream, stray] };
    const recon = otlpLogsToEvents(segmentToOtlpLogs(spliced));
    const back = recon.find(
      (e): e is HarnessEvent => e.kind === 'harness' && (e as HarnessEvent).verb === 'checks',
    );
    expect(back).toBeDefined();
    expect(back?.observe_kind).toBeUndefined();
  });
});

describe('observeKindFromCommand — closed-enum extraction', () => {
  it('extracts a known kind from `harness observe … --kind X` (space or =)', () => {
    expect(observeKindFromCommand('harness observe "friction" --kind difficulty')).toBe(
      'difficulty',
    );
    expect(observeKindFromCommand('harness observe --kind=magic-wand "wish"')).toBe('magic-wand');
    expect(observeKindFromCommand('harness observe --kind improvement-suggestion "x"')).toBe(
      'improvement-suggestion',
    );
  });

  it('returns null for a non-observe command or an unknown kind', () => {
    expect(observeKindFromCommand('harness checks')).toBeNull();
    expect(observeKindFromCommand('harness observe --kind bogus "x"')).toBeNull();
    expect(observeKindFromCommand('git commit -m "observe --kind difficulty"')).toBeNull();
  });
});
