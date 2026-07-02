import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import {
  buildReport,
  FLOW_STAGE_MAP_VERSION,
  type Rollup,
  semanticStage,
} from '../../../src/services/telemetry/report.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import {
  type CombineSessionDeps,
  combineSession,
  type SessionExport,
} from '../../../src/services/telemetry/session-export.js';

/**
 * 048 Phase 1 · T1.4 (AC-02) — the `flow_stage` lens becomes FlowEvent-PRIMARY.
 *
 * D3 (WS001): stage labels come from nav-derived `flow` events (`stage` = nav node
 * id) when present; the `/the-flow` skill-digit bracket is the FALLBACK; the
 * `unlabeled` bucket only when NEITHER exists. A versioned semantic stage map
 * (node-id → research|plan|implement|review|ship) lives in the report layer and
 * its version + the per-window labeling mechanism (flow|digit|unlabeled) counts
 * are recorded in report provenance.
 *
 * Named mutations: `lens-ignores-FlowEvent` (keying by the digit while a flow
 * event exists) ⇒ RED; `map-version-dropped-from-provenance` ⇒ RED.
 */

const tel = (root: string): string => `${root}/.harness/temp/telemetry`;

function makeDeps(
  files: Record<string, string>,
  dirs: Record<string, string[]>,
): CombineSessionDeps {
  return {
    fs: new FakeFs(files, dirs),
    proc: new FakeProcess({}, '/nowhere'),
    env: new FakeEnv({}, '/home/dev'),
  };
}

function seg(events: Event[], over: Partial<SegmentInput> = {}) {
  return serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'sX',
      timecode: '2026-07-01T00:00:00Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      event_stream: events,
      ...over,
    },
    '/repo',
  );
}

function exportOf(sub: string, segments: object[]): SessionExport {
  const files: Record<string, string> = {};
  const names: string[] = [];
  segments.forEach((s, i) => {
    files[`${tel('/work')}/${sub}/${i}.json`] = JSON.stringify(s);
    names.push(`${i}.json`);
  });
  return combineSession(sub, makeDeps(files, { [`${tel('/work')}/${sub}`]: names }), {
    root: '/work',
  });
}

function byKey(
  r: Rollup,
): Record<
  string,
  { count: number; time_s?: number; input: number; output: number; semantic?: string }
> {
  const out: Record<
    string,
    { count: number; time_s?: number; input: number; output: number; semantic?: string }
  > = {};
  for (const e of r.entries) {
    out[e.key] = {
      count: e.count,
      time_s: e.time_s,
      input: e.tokens.input,
      output: e.tokens.output,
      semantic: (e as { semantic_stage?: string }).semantic_stage,
    };
  }
  return out;
}

const T = (n: number): string => `2026-07-01T09:${String(n).padStart(2, '0')}:00Z`;
const flow = (t: string, stage: string, from?: string): Event =>
  ({
    t,
    kind: 'flow',
    flow: 'the-flow',
    stage,
    status: 'in_progress',
    ...(from ? { from } : {}),
  }) as Event;
const theFlow = (t: string, arg?: string): Event =>
  ({ t, kind: 'skill', name: 'the-flow', status: 'completed', ...(arg ? { arg } : {}) }) as Event;
const turn = (t: string, i: number, o: number): Event =>
  ({ t, kind: 'turn', dur_s: 5, in: i, out: o }) as Event;

// ── FlowEvent-primary (mutation: lens-ignores-FlowEvent) ─────────────────────

describe('T1.4 — flow_stage is FlowEvent-primary', () => {
  it('keys by nav flow stages even when a /the-flow digit call is also present', () => {
    // A flow event AND a digit skill call co-exist: flow wins the stage label.
    const s = exportOf('a', [
      seg([
        flow(T(0), 'research'),
        theFlow(T(1), '01'),
        turn(T(2), 100, 50),
        flow(T(3), 'phase-2', 'research'),
        turn(T(4), 200, 80),
      ]),
    ]);
    const report = buildReport([s]);
    const fs = byKey(report.rollups.flow_stage);
    // MUTATION lens-ignores-FlowEvent: falling back to the digit ⇒ key '01' ⇒ RED.
    expect(Object.keys(fs).sort()).toEqual(['phase-2', 'research']);
    expect(fs['01']).toBeUndefined();
    expect(report.provenance.flow_stage_mechanism.flow).toBe(2);
    expect(report.provenance.flow_stage_mechanism.digit).toBe(0);
    // Tokens attribute to the stage window: research → [t0,t3) has turn(100,50).
    expect(fs.research.input).toBe(100);
    expect(fs['phase-2'].output).toBe(80);
  });

  it('semantic_stage rides alongside the raw stage label via the versioned map', () => {
    const s = exportOf('b', [
      seg([
        flow(T(0), 'research'),
        turn(T(1), 10, 5),
        flow(T(2), 'phase-3', 'research'),
        turn(T(3), 10, 5),
        flow(T(4), 'review-1', 'phase-3'),
        turn(T(5), 10, 5),
        flow(T(6), 'ship', 'review-1'),
        turn(T(7), 10, 5),
      ]),
    ]);
    const fs = byKey(buildReport([s]).rollups.flow_stage);
    expect(fs.research.semantic).toBe('research');
    expect(fs['phase-3'].semantic).toBe('implement');
    expect(fs['review-1'].semantic).toBe('review');
    expect(fs.ship.semantic).toBe('ship');
  });
});

// ── Digit fallback (no flow events) ──────────────────────────────────────────

describe('T1.4 — digit fallback when no flow events exist', () => {
  it('brackets by /the-flow digit args; mechanism = digit; digits are semantically unmapped', () => {
    const s = exportOf('c', [
      seg([theFlow(T(0), '05'), turn(T(1), 100, 50), theFlow(T(2), '07'), turn(T(3), 200, 80)]),
    ]);
    const report = buildReport([s]);
    const fs = byKey(report.rollups.flow_stage);
    expect(Object.keys(fs).sort()).toEqual(['05', '07']);
    expect(report.provenance.flow_stage_mechanism).toEqual({ flow: 0, digit: 2, unlabeled: 0 });
    expect(fs['05'].semantic).toBeUndefined(); // a bare digit maps to nothing (honest)
  });

  it('unlabeled bucket only for a /the-flow call with no digit and no flow event', () => {
    const s = exportOf('d', [seg([theFlow(T(0)), turn(T(1), 30, 10)])]);
    const report = buildReport([s]);
    expect(Object.keys(byKey(report.rollups.flow_stage))).toEqual(['unlabeled']);
    expect(report.provenance.flow_stage_mechanism).toEqual({ flow: 0, digit: 0, unlabeled: 1 });
  });

  it('no flow rows at all when neither a flow event nor a /the-flow call exists', () => {
    const s = exportOf('e', [
      seg([
        { t: T(0), kind: 'skill', name: 'grill-me', status: 'completed' } as Event,
        turn(T(1), 5, 5),
      ]),
    ]);
    const report = buildReport([s]);
    expect(report.rollups.flow_stage.entries).toEqual([]);
    expect(report.provenance.flow_stage_mechanism).toEqual({ flow: 0, digit: 0, unlabeled: 0 });
  });
});

// ── Semantic map + provenance versioning (mutation: map-version-dropped) ─────

describe('T1.4 — versioned semantic stage map', () => {
  it('exposes a pinned map version and records it in report provenance', () => {
    const s = exportOf('f', [seg([flow(T(0), 'plan'), turn(T(1), 10, 10)])]);
    const report = buildReport([s]);
    // MUTATION map-version-dropped-from-provenance ⇒ undefined ⇒ RED.
    expect(report.provenance.flow_stage_map_version).toBe(FLOW_STAGE_MAP_VERSION);
    expect(FLOW_STAGE_MAP_VERSION).toMatch(/\/v\d+$/);
  });

  it('maps node-id patterns to the five semantic stages (workshops → plan)', () => {
    expect(semanticStage('research')).toBe('research');
    expect(semanticStage('plan')).toBe('plan');
    expect(semanticStage('workshops')).toBe('plan');
    expect(semanticStage('phase-5')).toBe('implement');
    expect(semanticStage('review-2')).toBe('review');
    expect(semanticStage('ship')).toBe('ship');
    expect(semanticStage('08')).toBeNull(); // an unmapped label is honest null
    expect(semanticStage('unlabeled')).toBeNull();
  });
});
