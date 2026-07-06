import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Event } from '../../../src/services/telemetry/events.js';
import { rollupToOtlpMetrics } from '../../../src/services/telemetry/otlp/metrics.js';
import { A, GENAI_TOKEN_TYPE } from '../../../src/services/telemetry/otlp/semconv.js';
import { attrMap } from '../../../src/services/telemetry/otlp/types.js';
import {
  classifyGap,
  collapseToolBursts,
  computeRollup,
  inferSkillStatuses,
} from '../../../src/services/telemetry/rollup.js';
import {
  type SegmentInput,
  serializeEvent,
  serializeSegment,
} from '../../../src/services/telemetry/segment.js';

/**
 * Phase 5 · T5.1 + T5.3 — the v2 event substrate + rollup engine.
 *
 * Covers: AC-15 (every event field is counts/names/timestamps only; a planted
 * secret in a non-allowlisted event field never serializes), AC-16 (rollup is a
 * pure function of `events[]` — no drift), AC-17 (gap classification yields
 * agent/human/idle summing to wall-clock, working_ratio excludes idle), and the
 * burst + skill-status helpers (groundwork for AC-18 / 5.4–5.6).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(
  readFileSync(join(HERE, '../../../src/services/telemetry/segment.schema.json'), 'utf8'),
) as {
  properties: {
    event_stream: { items: { properties: Record<string, unknown> } };
    rollup: { required: string[] };
  };
};

const REPO = '/repo';

function baseInput(): SegmentInput {
  return {
    command: 'flow',
    harness: 'claude-code',
    harness_session_id: 'sess-v2',
    timecode: '2026-06-24T09:12:00Z',
    window: { since: 'last-command', from: 0, to: 100 },
    branch: 'telemetry-enhancements',
    branch_changed: false,
  };
}

describe('T5.1 — serializeEvent: per-kind allowlist (AC-15 privacy)', () => {
  it('drops non-allowlisted fields and content planted on any event', () => {
    const SECRET = 'sk-ant-api03-LEAKED';
    const tainted = {
      t: '2026-06-24T09:00:00Z',
      kind: 'tools',
      name: 'Bash',
      count: 1,
      span_s: 0,
      // None of these are allowlisted event fields — model an adapter copying raw args.
      rawArgs: `curl -H "Authorization: ${SECRET}"`,
      secret: SECRET,
      promptText: 'the user said: my password is hunter2',
    } as unknown as Event;

    const out = serializeEvent(tainted);
    const json = JSON.stringify(out);

    expect(Object.keys(out).sort()).toEqual(['count', 'kind', 'name', 'span_s', 't']);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain('hunter2');
    expect(json).not.toContain('Authorization');
  });

  it('a prompt event carries only a word count — never the text', () => {
    const out = serializeEvent({
      t: '2026-06-24T09:00:00Z',
      kind: 'prompt',
      words: 12,
      text: 'my password is hunter2',
    } as unknown as Event);
    expect(out).toEqual({ t: '2026-06-24T09:00:00Z', kind: 'prompt', words: 12 });
  });

  it('keeps a valid t_precision, drops an invalid one, omits optional numbers that are null', () => {
    const ok = serializeEvent({
      t: '2026-06-24T09:00:00Z',
      t_precision: 'anchored',
      kind: 'turn',
      dur_s: 5,
      out: 100,
      in: null,
    } as unknown as Event);
    expect(ok).toEqual({
      t: '2026-06-24T09:00:00Z',
      t_precision: 'anchored',
      kind: 'turn',
      dur_s: 5,
      out: 100,
    });

    const bad = serializeEvent({
      t: '2026-06-24T09:00:00Z',
      t_precision: 'wobbly',
      kind: 'compaction',
    } as unknown as Event);
    expect(bad).toEqual({ t: '2026-06-24T09:00:00Z', kind: 'compaction' });
  });
});

describe('T5.3 — classifyGap', () => {
  it('agent for any non-prompt gap; never capped', () => {
    expect(classifyGap(9999, false)).toBe('agent');
  });
  it('human for a short pre-prompt gap, idle past the cap', () => {
    expect(classifyGap(120, true)).toBe('human');
    expect(classifyGap(301, true)).toBe('idle');
    expect(classifyGap(50, true, 30)).toBe('idle'); // configurable cap
  });
});

describe('T5.3 — computeRollup activity (AC-17)', () => {
  // 09:00:00 prompt | +10s turn (agent) | +50s prompt (human) | +600s prompt (idle) | +30s turn (agent)
  const events: Event[] = [
    { t: '2026-06-24T09:00:00Z', kind: 'prompt', words: 5 },
    { t: '2026-06-24T09:00:10Z', kind: 'turn', dur_s: 10, out: 100 },
    { t: '2026-06-24T09:01:00Z', kind: 'prompt', words: 8 },
    { t: '2026-06-24T09:11:00Z', kind: 'prompt', words: 3 },
    { t: '2026-06-24T09:11:30Z', kind: 'turn', dur_s: 30, out: 200 },
  ];

  it('classifies agent/human/idle and they sum to wall-clock', () => {
    const r = computeRollup(events);
    expect(r.activity.agent_working_s).toBe(40);
    expect(r.activity.human_s).toBe(50);
    expect(r.activity.idle_s).toBe(600);
    expect(r.activity.wall_s).toBe(690);
    expect(r.activity.agent_working_s + r.activity.human_s + r.activity.idle_s).toBe(
      r.activity.wall_s,
    );
  });

  it('working_ratio excludes idle', () => {
    const r = computeRollup(events);
    expect(r.activity.working_ratio).toBeCloseTo(40 / 90, 2); // 0.44 — idle NOT in the denominator
  });

  it('is order-independent (sorts by t)', () => {
    const shuffled = [events[3], events[0], events[4], events[1], events[2]];
    expect(computeRollup(shuffled)).toEqual(computeRollup(events));
  });
});

describe('T5.3 — computeRollup tokens / tools / flow-stage / outcomes', () => {
  it('sums token buckets across turns; null when no turn carries any', () => {
    const withTok = computeRollup([
      { t: '2026-06-24T09:00:00Z', kind: 'turn', dur_s: 1, in: 10, out: 20, cache_read: 5 },
      { t: '2026-06-24T09:00:05Z', kind: 'turn', dur_s: 1, out: 30, cache_create: 2 },
    ]);
    expect(withTok.tokens).toEqual({ in: 10, out: 50, cache_read: 5, cache_create: 2 });

    const noTok = computeRollup([
      { t: '2026-06-24T09:00:00Z', kind: 'turn', dur_s: 1 },
      { t: '2026-06-24T09:00:05Z', kind: 'prompt', words: 1 },
    ]);
    expect(noTok.tokens).toBeNull(); // Cursor ceiling — never zero-filled
  });

  it('counts tool bursts, attributes gap-time per flow stage, records outcomes', () => {
    const r = computeRollup([
      { t: '2026-06-24T09:00:00Z', kind: 'flow', flow: 'the-flow', stage: 'plan', status: 'x' },
      { t: '2026-06-24T09:00:40Z', kind: 'tools', name: 'Read', count: 4, span_s: 30 },
      {
        t: '2026-06-24T09:02:00Z',
        kind: 'flow',
        flow: 'the-flow',
        stage: 'implement',
        status: 'x',
        from: 'plan',
      },
      { t: '2026-06-24T09:03:00Z', kind: 'tools', name: 'Edit', count: 9, span_s: 50 },
      { t: '2026-06-24T09:03:10Z', kind: 'checks', status: 'degraded' },
      { t: '2026-06-24T09:03:10Z', kind: 'command_exit', verb: 'checks', exit: 1 },
    ]);
    expect(r.tools).toEqual({ Read: 4, Edit: 9 });
    // plan held 09:00:00→09:02:00 = 120s; implement 09:02:00→09:03:10 = 70s
    expect(r.flow_stage_time_s).toEqual({ plan: 120, implement: 70 });
    expect(r.outcomes).toEqual({ checks: 'degraded', exits: { checks: 1 } });
  });

  it('tallies skill outcomes', () => {
    const r = computeRollup([
      { t: '2026-06-24T09:00:00Z', kind: 'skill', name: 'the-flow', status: 'superseded' },
      { t: '2026-06-24T09:01:00Z', kind: 'skill', name: 'validate-v2', status: 'completed' },
      { t: '2026-06-24T09:02:00Z', kind: 'skill', name: 'the-flow', status: 'abandoned' },
    ]);
    expect(r.skills['the-flow']).toEqual({ runs: 2, abandoned: 1, superseded: 1 });
    expect(r.skills['validate-v2']).toEqual({ runs: 1, abandoned: 0, superseded: 0 });
  });
});

describe('T004 — a mark event contributes ZERO to the rollup (plan 053 · AC-03)', () => {
  // A mark carries a CAPTURE-TIME `t`; like `artifact`/`flow_log` it must be
  // EXCLUDED from gap/time math or its wall-clock instant would re-sort into the
  // stream and fabricate a mis-attributed gap. It is annotation, never work.
  const work: Event[] = [
    { t: '2026-06-24T09:00:00Z', kind: 'prompt', words: 5 },
    { t: '2026-06-24T09:00:10Z', kind: 'turn', dur_s: 10, out: 100 },
  ];
  const mark: Event = {
    t: '2026-06-24T10:00:00Z',
    kind: 'mark',
    mark_kind: 'review',
    verdict: 'fix-required',
    counts: { findings_critical: 1 },
  };

  it('inserting a mark leaves activity/tokens/flow-stage math byte-identical', () => {
    const base = computeRollup(work);
    const withMark = computeRollup([...work, mark]);
    expect(withMark).toEqual(base);
  });

  it('a mark-only stream produces the empty rollup (no wall time, no tokens)', () => {
    const r = computeRollup([mark]);
    expect(r.activity.wall_s).toBe(0);
    expect(r.activity.agent_working_s).toBe(0);
    expect(r.activity.human_s).toBe(0);
    expect(r.activity.idle_s).toBe(0);
    expect(r.tokens).toBeNull();
    expect(r.flow_stage_time_s).toEqual({});
  });

  it('a mark between two turns does not open an idle gap (it is filtered before gap math)', () => {
    const r = computeRollup([
      { t: '2026-06-24T09:00:00Z', kind: 'turn', dur_s: 1, out: 10 },
      mark, // 10:00:00 — an hour later; would be a huge idle gap if NOT excluded
      { t: '2026-06-24T09:00:05Z', kind: 'turn', dur_s: 1, out: 20 },
    ]);
    expect(r.activity.idle_s).toBe(0);
    expect(r.activity.wall_s).toBe(5);
  });
});

describe('T5.3 — collapseToolBursts', () => {
  it('collapses same-tool calls inside the window, splits across a long gap', () => {
    const bursts = collapseToolBursts(
      [
        { name: 'Edit', t: '2026-06-24T09:00:00Z' },
        { name: 'Edit', t: '2026-06-24T09:00:05Z' },
        { name: 'Edit', t: '2026-06-24T09:00:10Z' },
        { name: 'Edit', t: '2026-06-24T09:05:00Z' }, // >30s later → new burst
      ],
      30,
    );
    expect(bursts).toEqual([
      { t: '2026-06-24T09:00:00Z', name: 'Edit', count: 3, span_s: 10 },
      { t: '2026-06-24T09:05:00Z', name: 'Edit', count: 1, span_s: 0 },
    ]);
  });

  it('splits a name change into separate bursts (no lossy "mixed" — keeps per-tool counts)', () => {
    const bursts = collapseToolBursts([
      { name: 'Read', t: '2026-06-24T09:00:00Z' },
      { name: 'Read', t: '2026-06-24T09:00:01Z' },
      { name: 'Grep', t: '2026-06-24T09:00:02Z' },
    ]);
    expect(bursts).toEqual([
      { t: '2026-06-24T09:00:00Z', name: 'Read', count: 2, span_s: 1 },
      { t: '2026-06-24T09:00:02Z', name: 'Grep', count: 1, span_s: 0 },
    ]);
  });
});

describe('T5.6 groundwork — inferSkillStatuses (AC-18)', () => {
  it('same-skill restart → prior abandoned; different → superseded; last → active/completed', () => {
    const opens = [
      { name: 'the-flow', t: '2026-06-24T09:00:00Z' },
      { name: 'the-flow', t: '2026-06-24T09:01:00Z' }, // restart ⇒ prior abandoned
      { name: 'validate-v2', t: '2026-06-24T09:02:00Z' }, // different next ⇒ prior superseded
      { name: 'grill-me', t: '2026-06-24T09:03:00Z' }, // last
    ];
    expect(inferSkillStatuses(opens, true)).toEqual([
      'abandoned',
      'superseded',
      'superseded',
      'active',
    ]);
    expect(inferSkillStatuses(opens, false)[3]).toBe('completed');
  });
});

describe('T5.1/T5.2 — segment v2.0: derived rollup + schema shape (AC-16)', () => {
  const event_stream: Event[] = [
    { t: '2026-06-24T09:00:00Z', kind: 'prompt', words: 12 },
    {
      t: '2026-06-24T09:00:03Z',
      kind: 'flow',
      flow: 'the-flow',
      stage: 'implement',
      status: 'in_progress',
    },
    {
      t: '2026-06-24T09:00:41Z',
      kind: 'turn',
      dur_s: 38,
      out: 8120,
      cache_read: 280110,
      model: 'claude-opus-4-8',
    },
    { t: '2026-06-24T09:00:41Z', kind: 'tools', name: 'Edit', count: 9, span_s: 30 },
  ];

  it('rollup on the serialized segment equals a fresh computeRollup (no drift)', () => {
    const seg = serializeSegment({ ...baseInput(), event_stream }, REPO);
    expect(seg.rollup).not.toBeNull();
    expect(seg.rollup).toEqual(computeRollup(seg.event_stream));
  });

  it('every serialized event uses only schema-allowlisted keys', () => {
    const seg = serializeSegment({ ...baseInput(), event_stream }, REPO);
    const allowed = new Set(Object.keys(SCHEMA.properties.event_stream.items.properties));
    for (const e of seg.event_stream) {
      for (const k of Object.keys(e)) expect(allowed.has(k), `event key "${k}"`).toBe(true);
    }
    expect([...SCHEMA.properties.rollup.required].sort()).toEqual(
      ['activity', 'flow_stage_time_s', 'outcomes', 'skills', 'tokens', 'tools'].sort(),
    );
  });
});

describe('T014 — the rollup → OTLP Metrics datapoint attributes stay in the frozen harness.* contract', () => {
  it('every metric datapoint attribute key is a frozen harness.* / gen_ai.* name (no smuggled attr)', () => {
    // A rich stream → a fully-populated rollup → metrics whose datapoints carry
    // discriminator attributes (tool/skill/flow-stage/token-type). Those keys must
    // all live in the frozen vocabulary the harness-otlp.schema.json freeze pins.
    const frozen = new Set<string>([...Object.values(A), GENAI_TOKEN_TYPE]);
    const stream: Event[] = [
      { t: '2026-06-24T09:00:00Z', kind: 'prompt', words: 5 },
      {
        t: '2026-06-24T09:00:05Z',
        kind: 'turn',
        dur_s: 4,
        in: 100,
        out: 40,
        cache_read: 7,
        cache_create: 3,
        model: 'claude-opus-4-8',
      },
      { t: '2026-06-24T09:00:10Z', kind: 'tools', name: 'Bash', count: 2, span_s: 3 },
      { t: '2026-06-24T09:00:14Z', kind: 'skill', name: 'the-flow', status: 'completed', dur_s: 6 },
      {
        t: '2026-06-24T09:00:20Z',
        kind: 'flow',
        flow: 'the-flow',
        stage: 'implement',
        status: 'done',
        from: 'plan',
      },
      { t: '2026-06-24T09:00:25Z', kind: 'command_exit', verb: 'build', exit: 0, status: 'ok' },
    ];
    const seg = serializeSegment({ ...baseInput(), event_stream: stream }, REPO);
    const metrics = rollupToOtlpMetrics(seg);

    const attrKeys = new Set<string>();
    for (const rm of metrics.resourceMetrics) {
      for (const sm of rm.scopeMetrics) {
        for (const m of sm.metrics) {
          const dps = m.sum?.dataPoints ?? m.gauge?.dataPoints ?? [];
          for (const dp of dps) for (const k of attrMap(dp.attributes).keys()) attrKeys.add(k);
        }
      }
    }

    expect(attrKeys.size).toBeGreaterThan(0); // the rich stream really did attach discriminators
    for (const k of attrKeys) expect(frozen, `attr "${k}" must be a frozen name`).toContain(k);
  });
});
