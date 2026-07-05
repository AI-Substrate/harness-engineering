import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ArtifactEvent, Event } from '../../../src/services/telemetry/events.js';
import {
  buildFleetEvidence,
  type FleetEvidence,
  type FleetRoster,
} from '../../../src/services/telemetry/fleet-evidence.js';
import type { Segment } from '../../../src/services/telemetry/segment.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';

/**
 * Plan 052 · T009/T010 — the FLEET SEMANTIC ROLLUP + its closed schema.
 *
 * Phase 1 gave every lane an honest COST; this proves the same lanes carry an honest
 * QUALITY/PROCESS rollup, aggregated from their `artifact` events + `flow_stage_time_s`.
 *
 * THE load-bearing invariant (AC-07, hard requirement #1): a lane with no semantic
 * capture is `semantics_measured:false` and OMITS every dimension — NEVER a `0`. The
 * negative test below proves a blind lane is DISTINGUISHABLE from a lane that measured
 * zero findings (the `false ≠ zeros` contract, at the semantic layer).
 */

const ROOT = 'pij-orch';

/** A review/plan/workshop/flight-plan artifact event carrying counts/enums (the plan-050 shape). */
function artifact(
  t: string,
  type: ArtifactEvent['artifact_type'],
  path: string,
  counts: ArtifactEvent['counts'],
  enums: ArtifactEvent['enums'] = {},
): ArtifactEvent {
  return {
    t,
    kind: 'artifact',
    path,
    artifact_type: type,
    change: 'written',
    counts,
    enums,
    size: { lines: 10, bytes: 100 },
  };
}

/** A peer self-attestation mark event (plan 053 shape). */
function mark(
  t: string,
  markKind: string,
  verdict?: string,
  counts: Record<string, number> = {},
): Event {
  const e: Event = { t, kind: 'mark', mark_kind: markKind, counts };
  if (verdict !== undefined) (e as { verdict?: string }).verdict = verdict;
  return e;
}

/** Build a real-shaped serialized segment with pij join keys + an event stream. */
function seg(opts: {
  sid: string;
  parent?: string | null;
  harness?: string;
  pijHarness?: string;
  events: Event[];
  tokens?: SegmentInput['tokens'];
}): Segment {
  const env: Record<string, string> = { PIJ_SESSION_ID: opts.sid };
  if (opts.parent) env.PIJ_PARENT_ID = opts.parent;
  if (opts.pijHarness) env.PIJ_HARNESS = opts.pijHarness;
  const input: SegmentInput = {
    command: 'flow',
    harness: opts.harness ?? 'claude-code',
    harness_session_id: `hs-${opts.sid}`,
    timecode: opts.events[0]?.t ?? '2026-07-04T00:00:00Z',
    window: { since: 'session-start', from: 0, to: 1 },
    branch: null,
    tokens:
      opts.tokens === undefined
        ? {
            input: 1,
            output: 1,
            cache_create: 0,
            cache_read: 0,
            total: 2,
            subagent_tokens: 0,
            grand_total: 2,
          }
        : opts.tokens,
    event_stream: opts.events,
    captured_env: env,
  };
  return serializeSegment(input, '/repo');
}

const ROSTER: FleetRoster = {
  members: [
    { role: 'orchestrator', pij_id: ROOT },
    { role: 'coder', pij_id: 'pij-coder' },
    { role: 'reviewer', pij_id: 'pij-reviewer' },
  ],
};

/** A fully-instrumented orchestrator lane: review + plan + workshop + flight-plan + flow stage time. */
function instrumentedOrchestratorEvents(): Event[] {
  return [
    {
      t: '2026-07-04T04:00:00Z',
      kind: 'flow',
      flow: 'the-flow',
      stage: 'phase-1',
      status: 'active',
    },
    artifact(
      '2026-07-04T04:01:00Z',
      'plan',
      'docs/plans/052/plan.md',
      { phases: 1, cs: 3, gate_pass: 6, gate_na: 1 },
      { mode: 'SIMPLE', status: 'READY' },
    ),
    artifact('2026-07-04T04:02:00Z', 'workshop', 'docs/plans/052/workshops/1.md', {
      sections: 9,
      decisions: 4,
      open: 2,
    }),
    artifact(
      '2026-07-04T04:03:00Z',
      'review',
      'docs/plans/052/reviews/review.phase-1.md',
      { findings_critical: 1 },
      { verdict: 'FIX_REQUIRED' },
    ),
    artifact('2026-07-04T04:04:00Z', 'flight-plan', 'docs/plans/052/the-flow.json', {
      nodes: 11,
      done: 9,
      chores_done: 4,
      chores_todo: 1,
    }),
    { t: '2026-07-04T04:05:00Z', kind: 'turn', dur_s: 0, out: 1 },
  ];
}

describe('T009 — a lane aggregates its artifact events into an honest semantic rollup', () => {
  function orchLane(events: Event[]): FleetEvidence['sessions'][number] {
    const fleet = buildFleetEvidence(ROOT, [seg({ sid: ROOT, events })], ROSTER);
    if (fleet === null) throw new Error('expected a fleet');
    const lane = fleet.sessions.find((l) => l.pij_id === ROOT);
    if (lane === undefined) throw new Error('expected the orchestrator lane');
    return lane;
  }

  it('a fully-instrumented lane reports every dimension it captured', () => {
    const s = orchLane(instrumentedOrchestratorEvents()).semantics;
    expect(s.semantics_measured).toBe(true);
    expect(s.artifact_events).toBe(4);
    expect(s.findings).toEqual({ critical: 1, high: 0, med: 0, low: 0 });
    expect(s.verdicts).toEqual(['FIX_REQUIRED']);
    expect(s.fix_cycles).toBe(0);
    expect(s.plan_phases).toBe(1);
    expect(s.plan_cs).toBe(3);
    expect(s.workshop_decisions).toBe(4);
    expect(s.nodes).toBe(11);
    expect(s.nodes_done).toBe(9);
    expect(s.chores_done).toBe(4);
    expect(s.chores_todo).toBe(1);
    // a flow event followed by a 5-minute gap of events → stage time accrues to phase-1.
    expect(s.flow_stage_time_s?.['phase-1']).toBeGreaterThan(0);
  });

  it('a lane that captured a plan but NO review OMITS findings (the review ran elsewhere) — not a 0', () => {
    const s = orchLane([
      artifact('2026-07-04T04:01:00Z', 'plan', 'docs/plans/052/plan.md', { phases: 2, cs: 4 }),
    ]).semantics;
    expect(s.semantics_measured).toBe(true);
    expect(s.plan_phases).toBe(2);
    // the review dimension is ABSENT — the lane never saw a review, so it says nothing.
    expect(s.findings).toBeUndefined();
    expect(s.verdicts).toBeUndefined();
    expect(s.fix_cycles).toBeUndefined();
    expect(s.workshop_decisions).toBeUndefined();
    expect(s.nodes).toBeUndefined();
  });

  it('detects a FIX_REQUIRED→APPROVE fix cycle across re-saved review snapshots (latest wins for counts)', () => {
    const s = orchLane([
      artifact(
        '2026-07-04T04:03:00Z',
        'review',
        'docs/plans/052/reviews/review.phase-1.md',
        { findings_critical: 1 },
        { verdict: 'FIX_REQUIRED' },
      ),
      artifact(
        '2026-07-04T04:20:00Z',
        'review',
        'docs/plans/052/reviews/review.phase-1.md',
        {},
        { verdict: 'APPROVE' },
      ),
    ]).semantics;
    expect(s.verdicts).toEqual(['FIX_REQUIRED', 'APPROVE']);
    expect(s.fix_cycles).toBe(1);
    // findings come from the LATEST snapshot per path (the APPROVE re-review, 0 criticals).
    expect(s.findings).toEqual({ critical: 0, high: 0, med: 0, low: 0 });
  });
});

describe('T009 — honesty invariant: a blind lane is DISTINGUISHABLE from a measured-zero lane (hard req #1)', () => {
  it('a lane that measured a review with zero findings ≠ a lane that never measured a review', () => {
    // Lane A: a review WAS captured, but it recorded 0 findings (empty counts).
    const measuredZero = buildFleetEvidence(
      ROOT,
      [
        seg({
          sid: ROOT,
          events: [artifact('2026-07-04T04:03:00Z', 'review', 'r.md', {}, { verdict: 'APPROVE' })],
        }),
      ],
      { members: [{ role: 'orchestrator', pij_id: ROOT }] },
    );
    // Lane B: a copilot child with tokens:null and only a turn event — NO artifact capture.
    const blind = buildFleetEvidence(
      'pij-b',
      [
        seg({
          sid: 'pij-b',
          harness: 'copilot',
          pijHarness: 'copilot',
          tokens: null,
          events: [{ t: '2026-07-04T04:03:00Z', kind: 'turn', dur_s: 0, out: 1 }],
        }),
      ],
      { members: [{ role: 'orchestrator', pij_id: 'pij-b' }] },
    );
    if (measuredZero === null || blind === null) throw new Error('expected fleets');

    const a = measuredZero.sessions[0].semantics;
    const b = blind.sessions[0].semantics;

    // A is MEASURED with an explicit all-zero findings block.
    expect(a.semantics_measured).toBe(true);
    expect(a.findings).toEqual({ critical: 0, high: 0, med: 0, low: 0 });

    // B is BLIND — findings is ABSENT, not zeros. This is the distinguishing signal.
    expect(b.semantics_measured).toBe(false);
    expect(b.findings).toBeUndefined();
    expect(b.artifact_events).toBe(0);

    // The mutation that would COLLAPSE the two (zero-filling the blind lane) is exactly
    // what this asserts against: `a.findings` is defined, `b.findings` is not.
    expect(a.findings !== undefined && b.findings === undefined).toBe(true);
  });
});

describe('T009 — the fleet-level rollup carries honest lane COVERAGE', () => {
  it('measured/blind lane counts + dimensions present only from measured lanes', () => {
    const fleet = buildFleetEvidence(
      ROOT,
      [
        seg({ sid: ROOT, events: instrumentedOrchestratorEvents() }),
        // two blind copilot children (tokens:null, no artifacts).
        seg({
          sid: 'pij-coder',
          parent: ROOT,
          harness: 'copilot',
          pijHarness: 'copilot',
          tokens: null,
          events: [{ t: '2026-07-04T04:03:00Z', kind: 'turn', dur_s: 0, out: 1 }],
        }),
        seg({
          sid: 'pij-reviewer',
          parent: ROOT,
          harness: 'copilot',
          pijHarness: 'copilot',
          tokens: null,
          events: [{ t: '2026-07-04T04:03:00Z', kind: 'turn', dur_s: 0, out: 1 }],
        }),
      ],
      ROSTER,
    );
    if (fleet === null) throw new Error('expected a fleet');
    const s = fleet.semantics;
    expect(s.measured_lanes).toBe(1);
    expect(s.blind_lanes).toBe(2);
    // dimensions the ONE measured (orchestrator) lane carried surface fleet-wide.
    expect(s.findings).toEqual({ critical: 1, high: 0, med: 0, low: 0 });
    expect(s.verdicts).toEqual(['FIX_REQUIRED']);
    expect(s.workshop_decisions).toBe(4);
    expect(s.nodes).toBe(11);
    expect(s.nodes_done).toBe(9);
    expect(s.plan_phases).toBe(1);
    expect(s.plan_cs).toBe(3);
  });

  it('a fully-blind fleet reports blind_lanes only — NO zero-filled dimensions', () => {
    const fleet = buildFleetEvidence(
      ROOT,
      [
        seg({
          sid: ROOT,
          harness: 'copilot',
          pijHarness: 'copilot',
          tokens: null,
          events: [{ t: '2026-07-04T04:03:00Z', kind: 'turn', dur_s: 0, out: 1 }],
        }),
      ],
      { members: [{ role: 'orchestrator', pij_id: ROOT }] },
    );
    if (fleet === null) throw new Error('expected a fleet');
    const s = fleet.semantics;
    expect(s.measured_lanes).toBe(0);
    expect(s.blind_lanes).toBe(1);
    expect(s.findings).toBeUndefined();
    expect(s.verdicts).toBeUndefined();
    expect(s.nodes).toBeUndefined();
    expect(s.plan_phases).toBeUndefined();
    expect(s.plan_cs).toBeUndefined();
    expect(s.flow_stage_time_s).toBeUndefined();
  });
});

// ── plan 053 · T006/T007: peer self-attestation marks surface per-lane ────────
describe('T006 — a mark-only lane surfaces its mark (not blind); cost/tokens untouched', () => {
  it('a read-only reviewer that ONLY marks is semantics_measured (the target case)', () => {
    // A copilot reviewer (tokens:null) that ran no harness command and wrote no
    // file — its ONLY event is a mark. Pre-053 this lane read semantics_measured:false.
    const fleet = buildFleetEvidence(
      'pij-rev',
      [
        seg({
          sid: 'pij-rev',
          harness: 'copilot',
          pijHarness: 'copilot',
          tokens: null,
          events: [
            mark('2026-07-04T05:00:00Z', 'review', 'fix-required', { findings_critical: 1 }),
          ],
        }),
      ],
      { members: [{ role: 'reviewer', pij_id: 'pij-rev' }] },
    );
    if (fleet === null) throw new Error('expected a fleet');
    const lane = fleet.sessions[0];
    const s = lane.semantics;

    // NOT blind — the mark is measured semantic evidence.
    expect(s.semantics_measured).toBe(true);
    expect(s.mark).toEqual({
      marks: 1,
      kinds: ['review'],
      verdicts: ['fix-required'],
      findings: { critical: 1, high: 0, med: 0, low: 0 },
    });
    // artifact_events stays 0 — a mark is NOT an artifact.
    expect(s.artifact_events).toBe(0);
    expect(s.findings).toBeUndefined(); // the artifact-review dimension is still absent

    // COST is untouched by the mark — a tokens:null lane stays unmeasured, {0,0}.
    expect(lane.cost_measured).toBe(false);
    expect(lane.tokens).toEqual({ grand_total: 0, output: 0 });
  });

  it('a mark does NOT inflate a measured lane cost, and its verdict path dedupes across re-marks', () => {
    const fleet = buildFleetEvidence(
      ROOT,
      [
        seg({
          sid: ROOT,
          tokens: {
            input: 10,
            output: 20,
            cache_create: 0,
            cache_read: 0,
            total: 30,
            subagent_tokens: 0,
            grand_total: 30,
          },
          events: [
            { t: '2026-07-04T04:00:00Z', kind: 'turn', dur_s: 1, in: 10, out: 20 },
            mark('2026-07-04T04:10:00Z', 'review', 'fix-required', { findings_high: 2 }),
            mark('2026-07-04T04:20:00Z', 'review', 'fix-required'),
            mark('2026-07-04T04:30:00Z', 'review', 'approve'),
          ],
        }),
      ],
      { members: [{ role: 'orchestrator', pij_id: ROOT }] },
    );
    if (fleet === null) throw new Error('expected a fleet');
    const lane = fleet.sessions[0];

    expect(lane.cost_measured).toBe(true);
    // cost reflects ONLY the turn's tokens — the marks contribute nothing.
    expect(lane.tokens.output).toBe(20);
    expect(lane.semantics.mark).toEqual({
      marks: 3,
      kinds: ['review'],
      verdicts: ['fix-required', 'approve'], // consecutive-deduped
      findings: { critical: 0, high: 2, med: 0, low: 0 },
    });
  });

  it('a mark with no verdict/findings still surfaces (kinds + count only)', () => {
    const fleet = buildFleetEvidence(
      'pij-x',
      [
        seg({
          sid: 'pij-x',
          harness: 'copilot',
          pijHarness: 'copilot',
          tokens: null,
          events: [mark('2026-07-04T05:00:00Z', 'checkpoint')],
        }),
      ],
      { members: [{ role: 'reviewer', pij_id: 'pij-x' }] },
    );
    if (fleet === null) throw new Error('expected a fleet');
    const s = fleet.sessions[0].semantics;
    expect(s.semantics_measured).toBe(true);
    expect(s.mark).toEqual({ marks: 1, kinds: ['checkpoint'] });
    expect(s.mark?.verdicts).toBeUndefined();
    expect(s.mark?.findings).toBeUndefined();
  });
});

describe('T007 — consumer proof: a mark-only reviewer lane + a coder lane', () => {
  it('the mark surfaces on the reviewer lane ONLY; the coder lane is unaffected; cost intact', () => {
    const roster: FleetRoster = {
      members: [
        { role: 'orchestrator', pij_id: ROOT },
        { role: 'coder', pij_id: 'pij-coder' },
        { role: 'reviewer', pij_id: 'pij-reviewer' },
      ],
    };
    const fleet = buildFleetEvidence(
      ROOT,
      [
        seg({ sid: ROOT, events: instrumentedOrchestratorEvents() }),
        // A coder lane: real inference, NO mark.
        seg({
          sid: 'pij-coder',
          parent: ROOT,
          tokens: {
            input: 100,
            output: 200,
            cache_create: 0,
            cache_read: 0,
            total: 300,
            subagent_tokens: 0,
            grand_total: 300,
          },
          events: [{ t: '2026-07-04T04:03:00Z', kind: 'turn', dur_s: 5, in: 100, out: 200 }],
        }),
        // A read-only reviewer lane: tokens:null, its ONLY event is a mark.
        seg({
          sid: 'pij-reviewer',
          parent: ROOT,
          harness: 'copilot',
          pijHarness: 'copilot',
          tokens: null,
          events: [
            mark('2026-07-04T04:40:00Z', 'review', 'fix-required', {
              findings_critical: 2,
              findings_med: 1,
            }),
          ],
        }),
      ],
      roster,
    );
    if (fleet === null) throw new Error('expected a fleet');

    const reviewer = fleet.sessions.find((l) => l.pij_id === 'pij-reviewer');
    const coder = fleet.sessions.find((l) => l.pij_id === 'pij-coder');
    if (reviewer === undefined || coder === undefined) throw new Error('expected both lanes');

    // The reviewer's mark is on ITS lane, distinct, and it is NOT blind.
    expect(reviewer.semantics.semantics_measured).toBe(true);
    expect(reviewer.semantics.mark).toEqual({
      marks: 1,
      kinds: ['review'],
      verdicts: ['fix-required'],
      findings: { critical: 2, high: 0, med: 1, low: 0 },
    });
    expect(reviewer.cost_measured).toBe(false); // cost-excluded (tokens:null)

    // The coder lane carries NO mark and its cost is intact.
    expect(coder.semantics.mark).toBeUndefined();
    expect(coder.cost_measured).toBe(true);
    expect(coder.tokens.output).toBe(200);

    // Fleet cost aggregation is unchanged by the mark — the reviewer is an
    // unmeasured lane, the coder + orchestrator carry the measured cost.
    expect(fleet.totals.cost.unmeasured_lanes).toBe(1);
    expect(fleet.totals.cost.output).toBeGreaterThanOrEqual(200);
  });
});

// ── T010: the closed-schema extension rejects an un-enumerated semantics key ──────
const FLEET_SCHEMA = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../src/services/telemetry/fleet-export.schema.json', import.meta.url),
    ),
    'utf8',
  ),
);

type JsonSchema = Record<string, unknown> & {
  $ref?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  $defs?: Record<string, JsonSchema>;
};

function resolveRef(ref: string, root: JsonSchema): JsonSchema {
  const def = root.$defs?.[ref.replace('#/$defs/', '')];
  if (!def) throw new Error(`unresolved $ref ${ref}`);
  return def;
}

function closedViolations(
  schema: JsonSchema,
  value: unknown,
  root: JsonSchema,
  path = '$',
): string[] {
  if (schema.$ref) return closedViolations(resolveRef(schema.$ref, root), value, root, path);
  const out: string[] = [];
  if (Array.isArray(value) && schema.items) {
    value.forEach((v, i) => {
      out.push(...closedViolations(schema.items as JsonSchema, v, root, `${path}[${i}]`));
    });
    return out;
  }
  if (value !== null && typeof value === 'object' && schema.properties) {
    for (const [k, v] of Object.entries(value)) {
      const child = schema.properties[k];
      if (child) out.push(...closedViolations(child, v, root, `${path}.${k}`));
      else if (schema.additionalProperties === false) out.push(`${path}.${k}`);
      else if (typeof schema.additionalProperties === 'object')
        out.push(...closedViolations(schema.additionalProperties, v, root, `${path}.${k}`));
    }
  }
  return out;
}

describe('T010 — the semantics block is CLOSED (an un-enumerated key fails)', () => {
  function fleetWithSemantics(): FleetEvidence {
    const fleet = buildFleetEvidence(
      ROOT,
      [seg({ sid: ROOT, events: instrumentedOrchestratorEvents() })],
      {
        members: [{ role: 'orchestrator', pij_id: ROOT }],
      },
    );
    if (fleet === null) throw new Error('expected a fleet');
    return fleet;
  }

  it('a real payload with a lane + fleet semantics block validates clean', () => {
    expect(closedViolations(FLEET_SCHEMA, fleetWithSemantics(), FLEET_SCHEMA)).toEqual([]);
  });

  it('a lane carrying a mark validates clean against the closed schema (plan 053)', () => {
    const fleet = buildFleetEvidence(
      ROOT,
      [
        seg({
          sid: ROOT,
          events: [
            mark('2026-07-04T05:00:00Z', 'review', 'fix-required', { findings_critical: 1 }),
          ],
        }),
      ],
      { members: [{ role: 'reviewer', pij_id: ROOT }] },
    );
    if (fleet === null) throw new Error('expected a fleet');
    expect(closedViolations(FLEET_SCHEMA, fleet, FLEET_SCHEMA)).toEqual([]);
  });

  it('rejects an un-enumerated key inside a LANE mark block (P12)', () => {
    const fleet = buildFleetEvidence(
      ROOT,
      [seg({ sid: ROOT, events: [mark('2026-07-04T05:00:00Z', 'review', 'fix-required')] })],
      { members: [{ role: 'reviewer', pij_id: ROOT }] },
    );
    if (fleet === null) throw new Error('expected a fleet');
    const bad = structuredClone(fleet) as unknown as {
      sessions: Array<{ semantics: { mark?: Record<string, unknown> } }>;
    };
    (bad.sessions[0].semantics.mark as Record<string, unknown>).leaked_prose = 'nope';
    expect(closedViolations(FLEET_SCHEMA, bad, FLEET_SCHEMA)).toContain(
      '$.sessions[0].semantics.mark.leaked_prose',
    );
  });

  it('rejects an un-enumerated key inside a LANE semantics block (P12)', () => {
    const bad = structuredClone(fleetWithSemantics()) as unknown as {
      sessions: Array<{ semantics: Record<string, unknown> }>;
    };
    bad.sessions[0].semantics.leaked_prose = 'nope';
    expect(closedViolations(FLEET_SCHEMA, bad, FLEET_SCHEMA)).toContain(
      '$.sessions[0].semantics.leaked_prose',
    );
  });

  it('rejects an un-enumerated key inside the FLEET semantics block (P12)', () => {
    const bad = structuredClone(fleetWithSemantics()) as unknown as {
      semantics: Record<string, unknown>;
    };
    bad.semantics.secret_dimension = 42;
    expect(closedViolations(FLEET_SCHEMA, bad, FLEET_SCHEMA)).toContain(
      '$.semantics.secret_dimension',
    );
  });

  it('rejects an un-enumerated key inside the findings sub-block (P12)', () => {
    const bad = structuredClone(fleetWithSemantics()) as unknown as {
      semantics: { findings?: Record<string, unknown> };
    };
    bad.semantics.findings = { critical: 0, high: 0, med: 0, low: 0, leaked: 1 };
    expect(closedViolations(FLEET_SCHEMA, bad, FLEET_SCHEMA)).toContain(
      '$.semantics.findings.leaked',
    );
  });
});
