import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import { otlpLogsToEvents, segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import { computeRollup } from '../../../src/services/telemetry/rollup.js';
import type { Segment } from '../../../src/services/telemetry/segment.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import {
  type CombineSessionDeps,
  combineSession,
  normalizeV1ToEvents,
  SESSION_EXPORT_SCHEMA_VERSION,
} from '../../../src/services/telemetry/session-export.js';

/**
 * Phase 1 (plan 047) — `combineSession` → `SessionExport`.
 *
 * TDD for the load-bearing combine (T002), the round-trip non-vacuity oracle
 * (T004), and the v1 (no-`event_stream`) crash-guard (T007). Real segments are
 * built through the REAL `serializeSegment` (never a bespoke shape) so the combine
 * is proven against the actual on-disk contract; the committed golden pins the
 * real-corpus shape.
 */

const GOLDEN = (rel: string): Segment =>
  JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')) as Segment;

const CLAUDE = GOLDEN('./fixtures/real/claude/2026-06-25-static-site/expected-segment.json');

const tel = (root: string): string => `${root}/.harness/temp/telemetry`;

/** Lay segments (+ optional `.logs.jsonl` companions) into a FakeFs buffer under one session subdir. */
function layout(
  root: string,
  sub: string,
  segments: object[],
  companions: Record<number, unknown> = {},
): { files: Record<string, string>; dirs: Record<string, string[]> } {
  const files: Record<string, string> = {};
  const names: string[] = [];
  segments.forEach((seg, i) => {
    files[`${tel(root)}/${sub}/${i}.json`] = JSON.stringify(seg);
    names.push(`${i}.json`);
    if (companions[i] !== undefined) {
      files[`${tel(root)}/${sub}/${i}.logs.jsonl`] = JSON.stringify(companions[i]);
      names.push(`${i}.logs.jsonl`);
    }
  });
  return { files, dirs: { [`${tel(root)}/${sub}`]: names } };
}

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

/** A real serialized v2 segment carrying a chosen event stream. */
function seg(events: Event[], over: Partial<SegmentInput> = {}): Segment {
  return serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'sessX',
      timecode: '2026-06-29T00:00:00Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      event_stream: events,
      ...over,
    },
    '/repo',
  );
}

const turn = (t: string, inTok: number): Event => ({ t, kind: 'turn', dur_s: 1, in: inTok });

describe('T002 — combineSession: merge a session into one SessionExport (temp source)', () => {
  it('produces a schema-valid envelope with ONE merged resourceLogs, ordered by event time', () => {
    // Two segments, out of time order across the seqs, to prove the merge sorts.
    const a = seg([turn('2026-06-29T00:00:10Z', 100)]);
    const b = seg([turn('2026-06-29T00:00:05Z', 50)]);
    const { files, dirs } = layout('/work', 'sessX', [a, b]);
    const exp = combineSession('sessX', makeDeps(files, dirs), { root: '/work' });

    expect(exp.schema_version).toBe(SESSION_EXPORT_SCHEMA_VERSION);
    expect(exp.identity.harness_session_id).toBe('sessX');
    expect(exp.identity.harness).toBe('claude-code');
    expect(exp.identity.branch).toBe('main');
    expect(exp.source.kind).toBe('temp');
    expect(exp.source.segment_count).toBe(2);

    // ONE merged resourceLogs; every event present; ordered by timeUnixNano ascending.
    expect(exp.signals.logs.resourceLogs).toHaveLength(1);
    const recs = exp.signals.logs.resourceLogs[0].scopeLogs[0].logRecords ?? [];
    expect(recs).toHaveLength(2);
    const ts = recs.map((r) => BigInt(r.timeUnixNano ?? '0'));
    expect(ts[0] < ts[1]).toBe(true); // 00:00:05 before 00:00:10 — merge re-sorted
  });

  it('reads segments from the real corpus golden without crashing and records its schema version', () => {
    const { files, dirs } = layout('/work', 'sessReal', [CLAUDE]);
    const exp = combineSession('sessReal', makeDeps(files, dirs), { root: '/work' });
    expect(exp.source.segment_count).toBe(1);
    expect(Object.values(exp.summary.segment_schema_versions).reduce((s, n) => s + n, 0)).toBe(1);
    expect(exp.signals.logs.resourceLogs).toHaveLength(1);
  });
});

describe('T004 — round-trip non-vacuity: Logs are the lossless substrate', () => {
  it('otlpLogsToEvents(merged logs) reconstructs the exact merged event stream', () => {
    const events = [turn('2026-06-29T00:00:05Z', 50), turn('2026-06-29T00:00:10Z', 100)];
    const { files, dirs } = layout('/work', 'sessX', [seg(events)]);
    const exp = combineSession('sessX', makeDeps(files, dirs), { root: '/work' });

    const reconstructed = otlpLogsToEvents(exp.signals.logs);
    expect(reconstructed).toEqual(events);
    // computeRollup(reconstruction) equals the rollup baked into the metrics path.
    expect(computeRollup(reconstructed).tokens?.in).toBe(150);
  });

  it('is NON-VACUOUS: a mutated event stream no longer reconstructs equal (the assertion discriminates)', () => {
    const events = [turn('2026-06-29T00:00:05Z', 50), turn('2026-06-29T00:00:10Z', 100)];
    const { files, dirs } = layout('/work', 'sessX', [seg(events)]);
    const exp = combineSession('sessX', makeDeps(files, dirs), { root: '/work' });
    const reconstructed = otlpLogsToEvents(exp.signals.logs);

    // Flip a token bucket: the round-trip equality and the rollup total both move.
    const mutated = events.map((e, i) => (i === 0 ? { ...e, in: 999 } : e));
    expect(reconstructed).not.toEqual(mutated);
    expect(computeRollup(mutated).tokens?.in).not.toBe(150);
  });
});

describe('T007 — v1 (no event_stream) segments combine without crashing (F-02)', () => {
  // A raw v1.1 segment shape as it exists on disk: flat histograms, NO event_stream.
  const v1raw = {
    schema_version: '1.1',
    command: 'flow',
    harness: 'claude-code',
    harness_session_id: 'sessV1',
    timecode: '2026-06-20T00:00:00Z',
    window: { since: 'session-start', from: 0, to: 1 },
    branch: null,
    tokens: {
      input: 10,
      output: 20,
      cache_read: 0,
      cache_create: 0,
      total: 30,
      subagent_tokens: 5,
      grand_total: 35,
    },
    skills: { 'the-flow': 2 },
    tools: { Bash: 3 },
    harness_commands: { flow: 4 },
    models: { 'claude-opus-4-8': { turns: 1, output_tokens: 20 } },
  };

  it('proves the crash is real: segmentToOtlpLogs on a raw v1 segment throws (the guard is load-bearing)', () => {
    expect(() => segmentToOtlpLogs(v1raw as unknown as Segment)).toThrow();
  });

  it('combines a v1 segment without throwing; records its version + degraded marker; preserves counts', () => {
    const { files, dirs } = layout('/work', 'sessV1', [v1raw]);
    let exp: ReturnType<typeof combineSession>;
    expect(() => {
      exp = combineSession('sessV1', makeDeps(files, dirs), { root: '/work' });
    }).not.toThrow();
    // biome-ignore lint/style/noNonNullAssertion: assigned above inside the assertion
    exp = exp!;

    expect(exp.summary.segment_schema_versions['1.1']).toBe(1);
    expect(exp.summary.degraded).toContain('v1_segments');
    // The flat counts survived into the merged logs (skill×2, tools Bash, harness flow×4).
    const kinds = otlpLogsToEvents(exp.signals.logs).map((e) => e.kind);
    expect(kinds.filter((k) => k === 'skill')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'harness')).toHaveLength(4);
    expect(kinds).toContain('tools');
    // A v2-only assumption — "every combined segment had an event_stream" — is FALSE here.
    expect(normalizeV1ToEvents(v1raw as unknown as Segment).length).toBeGreaterThan(0);
  });

  it('degrades subagent tokens to "unknown" (never 0) when a segment lacks them', () => {
    // A v2 segment with tokens=null → subagent tokens unknown.
    const noTokens = seg([turn('2026-06-29T00:00:01Z', 0)], { tokens: null });
    const { files, dirs } = layout('/work', 'sessNo', [noTokens]);
    const exp = combineSession('sessNo', makeDeps(files, dirs), { root: '/work' });
    expect(exp.summary.tokens.subagent_tokens).toBe('unknown');
    expect(exp.summary.degraded).toContain('subagent_tokens');
  });
});

/**
 * N2 (review note) — `session-export.schema.json` ↔ emitted-shape contract.
 *
 * The repo carries no JSON-schema validator (ajv), so — like `segment-schema.test.ts` — this
 * pins the contract structurally: the pinned version const, the required-key sets at every
 * level, the `integer | "unknown"` token union, and that a REAL `combineSession` output
 * carries every required key the schema declares (producer ⊨ contract).
 */
const SCHEMA = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../src/services/telemetry/session-export.schema.json', import.meta.url),
    ),
    'utf8',
  ),
) as {
  required: string[];
  properties: Record<
    string,
    { const?: string; required?: string[]; properties?: Record<string, unknown> }
  >;
};

describe('N2 — session-export.schema.json structural contract', () => {
  it('pins schema_version const to SESSION_EXPORT_SCHEMA_VERSION', () => {
    expect(SCHEMA.properties.schema_version?.const).toBe('harness.session-export/v1');
    expect(SESSION_EXPORT_SCHEMA_VERSION).toBe('harness.session-export/v1');
  });

  it('declares the top-level required keys', () => {
    expect([...SCHEMA.required].sort()).toEqual(
      ['identity', 'schema_version', 'signals', 'source', 'summary'].sort(),
    );
  });

  it('allows subagent_tokens to be an integer OR the "unknown" string (never 0-faked)', () => {
    const tok = SCHEMA.properties.summary?.properties?.tokens as {
      properties?: { subagent_tokens?: { oneOf?: Array<{ type?: string; const?: string }> } };
    };
    const oneOf = tok.properties?.subagent_tokens?.oneOf ?? [];
    expect(oneOf.some((o) => o.type === 'integer')).toBe(true);
    expect(oneOf.some((o) => o.const === 'unknown')).toBe(true);
  });

  it('a real combineSession output carries every required key the schema declares', () => {
    const { files, dirs } = layout('/work', 'sessX', [seg([turn('2026-06-29T00:00:01Z', 5)])]);
    const exp = combineSession('sessX', makeDeps(files, dirs), {
      root: '/work',
    }) as unknown as Record<string, Record<string, unknown>>;
    // Top-level required keys present.
    for (const k of SCHEMA.required) expect(exp[k]).toBeDefined();
    // Nested required keys present at each declared level.
    for (const level of ['identity', 'source', 'summary', 'signals'] as const) {
      const req = SCHEMA.properties[level]?.required ?? [];
      for (const k of req) expect(exp[level][k]).toBeDefined();
    }
    // The tokens sub-object's required keys too.
    const tokReq =
      (SCHEMA.properties.summary?.properties?.tokens as { required?: string[] })?.required ?? [];
    const tokens = (exp.summary as { tokens: Record<string, unknown> }).tokens;
    for (const k of tokReq) expect(tokens[k]).toBeDefined();
  });
});
